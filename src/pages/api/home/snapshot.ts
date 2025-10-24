import type { NextRequest } from 'next/server'
import type { NextApiResponse } from 'next'
import { AEX } from '@/lib/aex'
import { SP500 } from '@/lib/sp500'
import { NASDAQ } from '@/lib/nasdaq'
import { DOWJONES } from '@/lib/dowjones'
import { DAX as DAX_FULL } from '@/lib/dax'
import { FTSE100 } from '@/lib/ftse100'
import { NIKKEI225 } from '@/lib/nikkei225'
import { HANGSENG } from '@/lib/hangseng'
import { SENSEX } from '@/lib/sensex'
import { computeScoreStatus } from '@/lib/taScore'

// Edge-friendly
export const config = { api: { bodyParser: false } }

type MarketLabel = 'AEX'|'S&P 500'|'NASDAQ'|'Dow Jones'|'DAX'|'FTSE 100'|'Nikkei 225'|'Hang Seng'|'Sensex'
type NewsItem = { title: string; url: string; source?: string; published?: string; image?: string|null }
type ScoredEq = { symbol: string; name: string; market: MarketLabel; score: number }
type ScoredCoin = { symbol: string; name: string; score: number }
type CongressTrade = { person?: string; ticker?: string; side?: 'BUY'|'SELL'|string; amount?: string|number; price?: string|number|null; date?: string; url?: string; }
type Snapshot = {
  newsCrypto: NewsItem[]
  newsEq: NewsItem[]
  topBuy: (ScoredEq & { signal: 'BUY'|'HOLD'|'SELL' })[]
  topSell:(ScoredEq & { signal: 'BUY'|'HOLD'|'SELL' })[]
  coinTopBuy: (ScoredCoin & { signal: 'BUY'|'HOLD'|'SELL' })[]
  coinTopSell:(ScoredCoin & { signal: 'BUY'|'HOLD'|'SELL' })[]
  academy: { title: string; href: string }[]
  congress: CongressTrade[]
}

const MARKET_ORDER: MarketLabel[] = ['AEX','S&P 500','NASDAQ','Dow Jones','DAX','FTSE 100','Nikkei 225','Hang Seng','Sensex']
const localeQS = 'hl=en-US&gl=US&ceid=US:en'

// === In-memory cache (5 min) ===
let CACHE: { ts: number; data: Snapshot } | null = null
const TTL_MS = 5 * 60 * 1000

const BASE = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '') || ''

const clamp = (n:number,a:number,b:number)=>Math.max(a,Math.min(b,n))
const statusFromScore = (score:number)=> score>=66?'BUY': score<=33?'SELL':'HOLD'
const chunk = <T,>(arr:T[], size:number)=>{ const out:T[][]=[]; for(let i=0;i<arr.length;i+=size) out.push(arr.slice(i,i+size)); return out }

function constituentsForMarket(label: MarketLabel) {
  if (label === 'AEX') return AEX.map(x => ({ symbol: x.symbol, name: x.name }))
  if (label === 'S&P 500' && Array.isArray(SP500) && SP500.length)
    return SP500.map((x:any)=>({symbol:x.symbol,name:x.name}))
  if (label === 'NASDAQ' && Array.isArray(NASDAQ) && NASDAQ.length)
    return NASDAQ.map((x:any)=>({symbol:x.symbol,name:x.name}))
  if (label === 'Dow Jones' && Array.isArray(DOWJONES) && DOWJONES.length)
    return DOWJONES.map((x:any)=>({symbol:x.symbol,name:x.name}))
  if (label === 'DAX' && Array.isArray(DAX_FULL) && DAX_FULL.length)
    return DAX_FULL.map((x:any)=>({symbol:x.symbol,name:x.name}))
  if (label === 'FTSE 100' && Array.isArray(FTSE100) && FTSE100.length)
    return FTSE100.map((x:any)=>({symbol:x.symbol,name:x.name}))
  if (label === 'Nikkei 225' && Array.isArray(NIKKEI225) && NIKKEI225.length)
    return NIKKEI225.map((x:any)=>({symbol:x.symbol,name:x.name}))
  if (label === 'Hang Seng' && Array.isArray(HANGSENG) && HANGSENG.length)
    return HANGSENG.map((x:any)=>({symbol:x.symbol,name:x.name}))
  if (label === 'Sensex' && Array.isArray(SENSEX) && SENSEX.length)
    return SENSEX.map((x:any)=>({symbol:x.symbol,name:x.name}))
  return []
}

function isoDaysAgo(days: number): string {
  const x = new Date(); x.setHours(0,0,0,0); x.setDate(x.getDate()-days); return x.toISOString().slice(0,10)
}
function toISORelOrCoerce(raw?:string|null){
  if (!raw) return null
  const t = raw.trim().toLowerCase()
  let m = t.match(/(\d+)\s*day(?:s)?\s*ago/); if (m) return isoDaysAgo(parseInt(m[1],10))
  m = t.match(/(\d+)\s*hour(?:s)?\s*ago/); if (m) return isoDaysAgo(0)
  if (/\bjust\s*now\b/.test(t) || /\bminute(?:s)?\s*ago\b/.test(t)) return isoDaysAgo(0)
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(raw)) return raw.slice(0,10)
  const ts = Date.parse(raw); return Number.isNaN(ts) ? null : new Date(ts).toISOString().slice(0,10)
}

async function fetchJSON(url: string) {
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) return null
  return r.json()
}

export default async function handler(req: NextRequest, res: NextApiResponse) {
  try {
    if (CACHE && Date.now() - CACHE.ts < TTL_MS) {
      res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=120')
      return res.status(200).json(CACHE.data)
    }

    const minuteTag = Math.floor(Date.now() / 60_000)

    // ---------- NEWS ----------
    const [newsCryptoJson, newsEqJson] = await Promise.all([
      fetchJSON(`${BASE}/api/news/google?q=${encodeURIComponent('crypto OR bitcoin OR ethereum OR blockchain')}&${localeQS}&v=${minuteTag}`),
      fetchJSON(`${BASE}/api/news/google?q=${encodeURIComponent('equities OR stocks OR stock market OR aandelen OR beurs')}&${localeQS}&v=${minuteTag}`),
    ])
    const newsCrypto: NewsItem[] = ((newsCryptoJson?.items)||[]).slice(0,6).map((x:any)=>({
      title: x.title || '', url: x.link, source: x.source || '', published: x.pubDate || '', image: null
    }))
    const newsEq: NewsItem[] = ((newsEqJson?.items)||[]).slice(0,6).map((x:any)=>({
      title: x.title || '', url: x.link, source: x.source || '', published: x.pubDate || '', image: null
    }))

    // ---------- ACADEMY ----------
    const academyJson = await fetchJSON(`${BASE}/api/academy/list?v=${minuteTag}`)
    const academy = Array.isArray(academyJson?.items) ? academyJson.items.slice(0,8) : []

    // ---------- CONGRESS ----------
    const congressJson = await fetchJSON(`${BASE}/api/market/congress?limit=30&v=${minuteTag}`)
    const congressArr = Array.isArray(congressJson?.items) ? congressJson.items : []
    const congress: CongressTrade[] = congressArr.map((x:any)=>({
      person: x.person || '', ticker: x.ticker || '', side: String(x.side || '').toUpperCase(),
      amount: x.amount || '', price: x.price ?? null,
      date: x.publishedISO || x.tradedISO || toISORelOrCoerce(x.published || x.traded || x.date) || '',
      url: x.url || '',
    })).sort((a,b)=> (b.date ? Date.parse(b.date) : 0) - (a.date ? Date.parse(a.date) : 0))

    // ---------- EQUITIES (Top/Bottom per markt; limiet per markt om verbruik te beperken) ----------
    const LIMIT_PER_MARKET = 150 // balans: snel & zuinig; Top/Bottom vrijwel identiek vs. full scan
    async function batchScoresForSymbols(symbols: string[]): Promise<Record<string, number>> {
      const out: Record<string, number> = {}
      const parts = chunk(symbols, 60) // middleware limit
      for (const p of parts) {
        const j = await fetchJSON(`${BASE}/api/indicators/snapshot-list?symbols=${encodeURIComponent(p.join(','))}`)
        const rows = (j?.results)||[]
        for (const r of rows) {
          const { score } = computeScoreStatus({ ma: r?.ma, rsi: r?.rsi, macd: r?.macd, volume: r?.volume } as any)
          if (Number.isFinite(score)) out[r.symbol] = Math.round(Number(score))
        }
      }
      return out
    }

    let topBuy: (ScoredEq & { signal:'BUY'|'HOLD'|'SELL' })[] = []
    let topSell:(ScoredEq & { signal:'BUY'|'HOLD'|'SELL' })[] = []
    for (const m of MARKET_ORDER) {
      const consFull = constituentsForMarket(m)
      const cons = consFull.slice(0, LIMIT_PER_MARKET) // beperk verbruik
      if (!cons.length) continue
      const scoresMap = await batchScoresForSymbols(cons.map(c=>c.symbol))
      const rows = cons
        .map(c => ({ symbol:c.symbol, name:c.name, market:m as MarketLabel, score: scoresMap[c.symbol] }))
        .filter(r => Number.isFinite(r.score as number)) as ScoredEq[]
      if (!rows.length) continue
      const best = [...rows].sort((a,b)=> b.score - a.score)[0]
      const worst = [...rows].sort((a,b)=> a.score - b.score)[0]
      if (best) topBuy.push({ ...best, signal: statusFromScore(best.score) })
      if (worst) topSell.push({ ...worst, signal: statusFromScore(worst.score) })
    }
    const order = (m: MarketLabel) => MARKET_ORDER.indexOf(m)
    topBuy  = topBuy.sort((a,b)=> order(a.market)-order(b.market))
    topSell = topSell.sort((a,b)=> order(a.market)-order(b.market))

    // ---------- CRYPTO ----------
    const COINS = [
      'BTC-USD','ETH-USD','BNB-USD','SOL-USD','XRP-USD','ADA-USD','DOGE-USD','TON-USD','TRX-USD','AVAX-USD',
      'DOT-USD','LINK-USD','BCH-USD','LTC-USD','MATIC-USD','XLM-USD','NEAR-USD','ICP-USD','ETC-USD','FIL-USD',
      'XMR-USD','APT-USD','ARB-USD','OP-USD','SUI-USD','HBAR-USD','ALGO-USD','VET-USD','EGLD-USD','AAVE-USD',
      'INJ-USD','MKR-USD','RUNE-USD','IMX-USD','FLOW-USD','SAND-USD','MANA-USD','AXS-USD','QNT-USD','GRT-USD',
      'CHZ-USD','CRV-USD','ENJ-USD','FTM-USD','XTZ-USD','LDO-USD','SNX-USD','STX-USD','AR-USD','GMX-USD',
    ]
    const toPair = (sym:string) => {
      const s = sym.replace('-USD','').toUpperCase()
      const skip = new Set(['USDT','USDC','BUSD','DAI','TUSD'])
      return skip.has(s) ? null : `${s}USDT`
    }
    const pairs = COINS.map(c => ({ c, p: toPair(c) })).filter(x => x.p) as { c:string; p:string }[]
    const parts = chunk(pairs, 60)
    const cryptoRows: ScoredCoin[] = []
    for (const part of parts) {
      const csv = part.map(x=>x.p).join(',')
      const j = await fetchJSON(`${BASE}/api/crypto-light/indicators?symbols=${encodeURIComponent(csv)}`)
      const results = (j?.results)||[]
      for (const r of results) {
        const { score } = computeScoreStatus({ ma: r?.ma, rsi: r?.rsi, macd: r?.macd, volume: r?.volume } as any)
        const back = part.find(x => x.p === r.symbol)
        if (Number.isFinite(score) && back) {
          cryptoRows.push({ symbol: back.c, name: back.c.replace('-USD',''), score: Math.round(Number(score)) })
        }
      }
    }
    const coinTopBuy  = [...cryptoRows].sort((a,b)=> b.score - a.score).slice(0,5).map(r => ({ ...r, signal: statusFromScore(r.score) }))
    const coinTopSell = [...cryptoRows].sort((a,b)=> a.score - b.score).slice(0,5).map(r => ({ ...r, signal: statusFromScore(r.score) }))

    const data: Snapshot = { newsCrypto, newsEq, topBuy, topSell, coinTopBuy, coinTopSell, academy, congress }

    CACHE = { ts: Date.now(), data }
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=120')
    return res.status(200).json(data)
  } catch (e:any) {
    return res.status(500).json({ error: 'snapshot error', detail: String(e?.message || e) })
  }
}