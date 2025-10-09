// src/pages/index.tsx
import Head from 'next/head'
import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { mutate } from 'swr'
import { AEX } from '@/lib/aex'
import ScoreBadge from '@/components/ScoreBadge'

/* ---------------- config ---------------- */
const HERO_IMG = '/images/hero-crypto-tracker.png'
const TTL_MS = 5 * 60 * 1000 // 5 min cache

/* ---------------- types ---------------- */
type Advice = 'BUY' | 'HOLD' | 'SELL'
type NewsItem = { title: string; url: string; source?: string; published?: string; image?: string | null }

type MarketLabel =
  | 'AEX' | 'S&P 500' | 'NASDAQ' | 'Dow Jones'
  | 'DAX' | 'FTSE 100' | 'Nikkei 225' | 'Hang Seng' | 'Sensex'

type ScoredEq   = { symbol: string; name: string; market: MarketLabel; score: number; signal: Advice }
type ScoredCoin = { symbol: string; name: string; score: number; signal: Advice }

/* ---------------- utils ---------------- */
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))
function statusFromScore(score: number): Advice {
  if (score >= 66) return 'BUY'
  if (score <= 33) return 'SELL'
  return 'HOLD'
}
const toNum = (x: unknown) => (typeof x === 'string' ? Number(x) : (x as number))
const isFiniteNum = (x: unknown) => Number.isFinite(toNum(x))

/* ---------- localStorage cache helpers ---------- */
function getCache<T>(key: string): T | null {
  try {
    if (typeof window === 'undefined') return null
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const j = JSON.parse(raw) as { ts: number; data: T }
    if (!j?.ts) return null
    if (Date.now() - j.ts > TTL_MS) return null
    return j.data
  } catch { return null }
}
function setCache<T>(key: string, data: T) {
  try {
    if (typeof window === 'undefined') return
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }))
  } catch {}
}

/* ---------- pool helper (concurrency) ---------- */
async function pool<T, R>(arr: T[], size: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(arr.length) as any
  let i = 0
  const workers = new Array(Math.min(size, arr.length)).fill(0).map(async () => {
    while (true) {
      const idx = i++
      if (idx >= arr.length) break
      out[idx] = await fn(arr[idx], idx)
    }
  })
  await Promise.all(workers)
  return out
}

/* =======================
   AANDELEN — aggregatie
   ======================= */
type MaCrossResp = { symbol: string; ma50: number | null; ma200: number | null; status?: Advice | string; points?: number | string | null }
type RsiResp    = { symbol: string; period: number; rsi: number | null; status?: Advice | string; points?: number | string | null }
type MacdResp   = { symbol: string; fast: number; slow: number; signalPeriod: number; macd: number | null; signal: number | null; hist: number | null; status?: Advice | string; points?: number | string | null }
type Vol20Resp  = { symbol: string; period: number; volume: number | null; avg20: number | null; ratio: number | null; status?: Advice | string; points?: number | string | null }

const scoreToPts = (s: number) => clamp((s / 100) * 4 - 2, -2, 2)
function deriveMaPoints(ma?: MaCrossResp): number | null {
  const ma50 = ma?.ma50, ma200 = ma?.ma200
  if (ma50 == null || ma200 == null) return null
  let maScore = 50
  if (ma50 > ma200) {
    const spread = clamp(ma50 / Math.max(1e-9, ma200) - 1, 0, 0.2)
    maScore = 60 + (spread / 0.2) * 40
  } else if (ma50 < ma200) {
    const spread = clamp(ma200 / Math.max(1e-9, ma50) - 1, 0, 0.2)
    maScore = 40 - (spread / 0.2) * 40
  }
  return scoreToPts(maScore)
}
function deriveRsiPoints(rsiResp?: RsiResp): number | null {
  const r = rsiResp?.rsi
  if (typeof r !== 'number') return null
  const rsiScore = clamp(((r - 30) / 40) * 100, 0, 100)
  return scoreToPts(rsiScore)
}
function deriveMacdPoints(macd?: MacdResp, ma?: MaCrossResp): number | null {
  const hist = macd?.hist
  const ma50 = ma?.ma50 ?? null
  if (typeof hist !== 'number') return null
  if (ma50 && ma50 > 0) {
    const t = 0.01
    const relClamped = clamp((hist / ma50) / t, -1, 1)
    const macdScore = 50 + relClamped * 20
    return scoreToPts(macdScore)
  }
  const macdScore = hist > 0 ? 60 : hist < 0 ? 40 : 50
  return scoreToPts(macdScore)
}
function deriveVolPoints(vol?: Vol20Resp): number | null {
  const ratio = vol?.ratio
  if (typeof ratio !== 'number') return null
  const delta = clamp((ratio - 1) / 1, -1, 1)
  const volScore = clamp(50 + delta * 30, 0, 100)
  return scoreToPts(volScore)
}
const toPtsSmart = (status?: Advice | string, pts?: number | string | null, fallback: () => number | null = () => null) => {
  if (isFiniteNum(pts)) return clamp(toNum(pts), -2, 2)
  const s = String(status || '').toUpperCase()
  if (s === 'BUY')  return  2
  if (s === 'SELL') return -2
  const f = fallback()
  return f == null ? 0 : clamp(f, -2, 2)
}

/* ✅ nu met echte cache hint voor CDN/browser */
async function calcScoreForSymbol(symbol: string): Promise<number | null> {
  try {
    const [rMa, rRsi, rMacd, rVol] = await Promise.all([
      fetch(`/api/indicators/ma-cross/${encodeURIComponent(symbol)}`, { cache: 'force-cache' }),
      fetch(`/api/indicators/rsi/${encodeURIComponent(symbol)}?period=14`, { cache: 'force-cache' }),
      fetch(`/api/indicators/macd/${encodeURIComponent(symbol)}?fast=12&slow=26&signal=9`, { cache: 'force-cache' }),
      fetch(`/api/indicators/vol20/${encodeURIComponent(symbol)}?period=20`, { cache: 'force-cache' }),
    ])
    if (!(rMa.ok && rRsi.ok && rMacd.ok && rVol.ok)) return null

    const [ma, rsi, macd, vol] = await Promise.all([
      rMa.json(), rRsi.json(), rMacd.json(), rVol.json()
    ]) as [MaCrossResp, RsiResp, MacdResp, Vol20Resp]

    const pMA   = toPtsSmart(ma?.status,   ma?.points,   () => deriveMaPoints(ma))
    const pMACD = toPtsSmart(macd?.status, macd?.points, () => deriveMacdPoints(macd, ma))
    const pRSI  = toPtsSmart(rsi?.status,  rsi?.points,  () => deriveRsiPoints(rsi))
    const pVOL  = toPtsSmart(vol?.status,  vol?.points,  () => deriveVolPoints(vol))

    const nMA   = (pMA   + 2) / 4
    const nMACD = (pMACD + 2) / 4
    const nRSI  = (pRSI  + 2) / 4
    const nVOL  = (pVOL  + 2) / 4

    const W_MA = 0.40, W_MACD = 0.30, W_RSI = 0.20, W_VOL = 0.10
    const agg = W_MA*nMA + W_MACD*nMACD + W_RSI*nRSI + W_VOL*nVOL
    const pct = clamp(Math.round(agg * 100), 0, 100)
    return pct
  } catch {
    return null
  }
}

/* =======================
   CRYPTO — light score (universally fixed)
   ======================= */
type IndResp = {
  symbol: string
  ma?: { ma50: number|null; ma200: number|null; cross?: string }
  rsi?: number|null
  macd?: { macd: number|null; signal: number|null; hist: number|null }
  volume?: { volume: number|null; avg20d: number|null; ratio: number|null }
  error?: string
}

function statusFromOverall(score: number): Advice {
  if (score >= 66) return 'BUY'
  if (score <= 33) return 'SELL'
  return 'HOLD'
}

function overallScore(ind?: IndResp): { score: number, status: Advice } {
  if (!ind || ind.error) return { score: 50, status: 'HOLD' }

  // MA
  let maScore = 50
  if (ind.ma?.ma50 != null && ind.ma?.ma200 != null) {
    if (ind.ma.ma50 > ind.ma.ma200) {
      const spread = Math.max(0, Math.min(0.2, ind.ma.ma50 / Math.max(1e-9, ind.ma.ma200) - 1))
      maScore = 60 + (spread / 0.2) * 40
    } else if (ind.ma.ma50 < ind.ma.ma200) {
      const spread = Math.max(0, Math.min(0.2, ind.ma.ma200 / Math.max(1e-9, ind.ma.ma50) - 1))
      maScore = 40 - (spread / 0.2) * 40
    }
  }

  // RSI
  let rsiScore = 50
  if (typeof ind.rsi === 'number') {
    rsiScore = Math.max(0, Math.min(100, ((ind.rsi - 30) / 40) * 100))
  }

  // MACD (hist t.o.v. MA50)
  let macdScore = 50
  const hist = ind.macd?.hist
  const ma50 = ind.ma?.ma50 ?? null
  if (typeof hist === 'number') {
    if (ma50 && ma50 > 0) {
      const t = 0.01
      const relClamped = Math.max(-1, Math.min(1, (hist / ma50) / t))
      macdScore = Math.round(50 + relClamped * 20) // 30..70
    } else {
      macdScore = hist > 0 ? 60 : hist < 0 ? 40 : 50
    }
  }

  // Volume (ratio gecentreerd op 1)
  let volScore = 50
  const ratio = ind.volume?.ratio
  if (typeof ratio === 'number') {
    const delta = Math.max(-1, Math.min(1, (ratio - 1) / 1))
    volScore = Math.max(0, Math.min(100, 50 + delta * 30))
  }

  const score = Math.round(0.35 * maScore + 0.25 * rsiScore + 0.25 * macdScore + 0.15 * volScore)
  return { score, status: statusFromOverall(score) }
}

// SYM → SYMUSDT (stablecoins overslaan)
const toBinancePair = (symbol: string) => {
  const s = (symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const skip = new Set(['USDT','USDC','BUSD','DAI','TUSD'])
  if (!s || skip.has(s)) return null
  return `${s}USDT`
}

/* ---------------- constituents per markt ---------------- */
const STATIC_CONS: Record<MarketLabel, { symbol: string; name: string }[]> = {
  'AEX': [],
  'S&P 500': [
    { symbol: 'AAPL',  name: 'Apple' },
    { symbol: 'MSFT',  name: 'Microsoft' },
    { symbol: 'NVDA',  name: 'NVIDIA' },
    { symbol: 'AMZN',  name: 'Amazon' },
    { symbol: 'META',  name: 'Meta Platforms' },
  ],
  'NASDAQ': [
    { symbol: 'TSLA',  name: 'Tesla' },
    { symbol: 'GOOGL', name: 'Alphabet' },
    { symbol: 'ADBE',  name: 'Adobe' },
    { symbol: 'AVGO',  name: 'Broadcom' },
    { symbol: 'AMD',   name: 'Advanced Micro Devices' },
  ],
  'Dow Jones': [
    { symbol: 'MRK', name: 'Merck' },
    { symbol: 'PG',  name: 'Procter & Gamble' },
    { symbol: 'V',   name: 'Visa' },
    { symbol: 'JPM', name: 'JPMorgan Chase' },
    { symbol: 'UNH', name: 'UnitedHealth' },
  ],
  'DAX': [
    { symbol: 'SAP.DE',  name: 'SAP' },
    { symbol: 'SIE.DE',  name: 'Siemens' },
    { symbol: 'BMW.DE',  name: 'BMW' },
    { symbol: 'BAS.DE',  name: 'BASF' },
    { symbol: 'MBG.DE',  name: 'Mercedes-Benz Group' },
  ],
  'FTSE 100': [
    { symbol: 'AZN.L',   name: 'AstraZeneca' },
    { symbol: 'SHEL.L',  name: 'Shell' },
    { symbol: 'HSBA.L',  name: 'HSBC' },
    { symbol: 'ULVR.L',  name: 'Unilever' },
    { symbol: 'BATS.L',  name: 'BAT' },
  ],
  'Nikkei 225': [
    { symbol: '7203.T',  name: 'Toyota' },
    { symbol: '6758.T',  name: 'Sony' },
    { symbol: '9984.T',  name: 'SoftBank Group' },
    { symbol: '8035.T',  name: 'Tokyo Electron' },
    { symbol: '4063.T',  name: 'Shin-Etsu Chemical' },
  ],
  'Hang Seng': [
    { symbol: '0700.HK', name: 'Tencent' },
    { symbol: '0939.HK', name: 'China Construction Bank' },
    { symbol: '2318.HK', name: 'Ping An' },
    { symbol: '1299.HK', name: 'AIA Group' },
    { symbol: '0005.HK', name: 'HSBC Holdings' },
  ],
  'Sensex': [
    { symbol: 'RELIANCE.NS', name: 'Reliance Industries' },
    { symbol: 'TCS.NS',      name: 'TCS' },
    { symbol: 'HDFCBANK.NS', name: 'HDFC Bank' },
    { symbol: 'INFY.NS',     name: 'Infosys' },
    { symbol: 'ICICIBANK.NS',name: 'ICICI Bank' },
  ],
}

function constituentsForMarket(label: MarketLabel) {
  if (label === 'AEX') return AEX.map(x => ({ symbol: x.symbol, name: x.name }))
  return STATIC_CONS[label] || []
}

/* ------- crypto universum (Yahoo tickers) — TOP 50 ------- */
const COINS: { symbol: string; name: string }[] = [
  { symbol: 'BTC-USD',  name: 'Bitcoin' },
  { symbol: 'ETH-USD',  name: 'Ethereum' },
  { symbol: 'BNB-USD',  name: 'BNB' },
  { symbol: 'SOL-USD',  name: 'Solana' },
  { symbol: 'XRP-USD',  name: 'XRP' },
  { symbol: 'ADA-USD',  name: 'Cardano' },
  { symbol: 'DOGE-USD', name: 'Dogecoin' },
  { symbol: 'TON-USD',  name: 'Toncoin' },
  { symbol: 'TRX-USD',  name: 'TRON' },
  { symbol: 'AVAX-USD', name: 'Avalanche' },
  { symbol: 'DOT-USD',  name: 'Polkadot' },
  { symbol: 'LINK-USD', name: 'Chainlink' },
  { symbol: 'BCH-USD',  name: 'Bitcoin Cash' },
  { symbol: 'LTC-USD',  name: 'Litecoin' },
  { symbol: 'MATIC-USD', name: 'Polygon' },
  { symbol: 'XLM-USD',  name: 'Stellar' },
  { symbol: 'NEAR-USD', name: 'NEAR' },
  { symbol: 'ICP-USD',  name: 'Internet Computer' },
  { symbol: 'ETC-USD',  name: 'Ethereum Classic' },
  { symbol: 'FIL-USD',  name: 'Filecoin' },
  { symbol: 'XMR-USD',  name: 'Monero' },
  { symbol: 'APT-USD',  name: 'Aptos' },
  { symbol: 'ARB-USD',  name: 'Arbitrum' },
  { symbol: 'OP-USD',   name: 'Optimism' },
  { symbol: 'SUI-USD',  name: 'Sui' },
  { symbol: 'HBAR-USD', name: 'Hedera' },
  { symbol: 'ALGO-USD', name: 'Algorand' },
  { symbol: 'VET-USD',  name: 'VeChain' },
  { symbol: 'EGLD-USD', name: 'MultiversX' },
  { symbol: 'AAVE-USD', name: 'Aave' },
  { symbol: 'INJ-USD',  name: 'Injective' },
  { symbol: 'MKR-USD',  name: 'Maker' },
  { symbol: 'RUNE-USD', name: 'THORChain' },
  { symbol: 'IMX-USD',  name: 'Immutable' },
  { symbol: 'FLOW-USD', name: 'Flow' },
  { symbol: 'SAND-USD', name: 'The Sandbox' },
  { symbol: 'MANA-USD', name: 'Decentraland' },
  { symbol: 'AXS-USD',  name: 'Axie Infinity' },
  { symbol: 'QNT-USD',  name: 'Quant' },
  { symbol: 'GRT-USD',  name: 'The Graph' },
  { symbol: 'CHZ-USD',  name: 'Chiliz' },
  { symbol: 'CRV-USD',  name: 'Curve DAO' },
  { symbol: 'ENJ-USD',  name: 'Enjin Coin' },
  { symbol: 'FTM-USD',  name: 'Fantom' },
  { symbol: 'XTZ-USD',  name: 'Tezos' },
  { symbol: 'LDO-USD',  name: 'Lido DAO' },
  { symbol: 'SNX-USD',  name: 'Synthetix' },
  { symbol: 'STX-USD',  name: 'Stacks' },
  { symbol: 'AR-USD',   name: 'Arweave' },
  { symbol: 'GMX-USD',  name: 'GMX' },
]

/* ---------------- page ---------------- */
export default function Homepage() {
  const router = useRouter()

  /* ---------- Achtergrond-prefetch van routes ---------- */
  useEffect(() => {
    const routes = [
      '/crypto',
      '/aex','/sp500','/nasdaq','/dowjones','/dax','/ftse100','/nikkei225','/hangseng','/sensex','/etfs',
      '/intel','/intel/hedgefunds','/intel/macro','/intel/sectors'
    ]
    routes.forEach(r => router.prefetch(r).catch(()=>{}))
  }, [router])

  /* ---------- WARM-UP CACHE ---------- */
  useEffect(() => {
    let aborted = false
    const ric = (cb: () => void) => {
      if (typeof window === 'undefined') return
      const _ric = (window as any).requestIdleCallback as ((cb: any, opts?: any)=>any) | undefined
      if (_ric) _ric(cb, { timeout: 100 })
      else setTimeout(cb, 0)
    }

    ric(async () => {
      try {
        const hadEqBuy  = !!getCache<ScoredEq[]>('home:eq:topBuy')
        const hadEqSell = !!getCache<ScoredEq[]>('home:eq:topSell')
        const hadCBuy   = !!getCache<ScoredCoin[]>('home:coin:topBuy')
        const hadCSell  = !!getCache<ScoredCoin[]>('home:coin:topSell')

        // --- Equities warmen (zonder sleeps) ---
        if (!(hadEqBuy && hadEqSell)) {
          const WARM_MARKET_ORDER: MarketLabel[] = ['AEX','S&P 500','NASDAQ','Dow Jones','DAX','FTSE 100','Nikkei 225','Hang Seng','Sensex']
          const outBuy: ScoredEq[] = []
          const outSell: ScoredEq[] = []

          for (const market of WARM_MARKET_ORDER) {
            if (aborted) return
            const cons = constituentsForMarket(market)
            if (!cons.length) continue
            const symbols = cons.map(c => c.symbol)

            const scores = await pool(symbols, 4, async (sym) => {
              return await calcScoreForSymbol(sym)
            })

            const rows = cons.map((c, i) => ({
              symbol: c.symbol, name: c.name, market, score: scores[i] ?? (null as any)
            })).filter(r => Number.isFinite(r.score as number)) as Array<ScoredEq>

            if (rows.length) {
              const top = [...rows].sort((a,b)=> b.score - a.score)[0]
              const bot = [...rows].sort((a,b)=> a.score - b.score)[0]
              if (top) outBuy.push({ ...top, signal: statusFromScore(top.score) })
              if (bot) outSell.push({ ...bot, signal: statusFromScore(bot.score) })
            }
          }

          const order = (m: MarketLabel) => WARM_MARKET_ORDER.indexOf(m)
          const finalBuy  = outBuy.sort((a,b)=> order(a.market)-order(b.market))
          const finalSell = outSell.sort((a,b)=> order(a.market)-order(b.market))
          if (!aborted) {
            if (!hadEqBuy)  setCache('home:eq:topBuy',  finalBuy)
            if (!hadEqSell) setCache('home:eq:topSell', finalSell)
          }
        }

        // --- Crypto warmen (force-cache op indicators) ---
        if (!(hadCBuy && hadCSell)) {
          const pairs = COINS.map(c => ({ c, pair: toBinancePair(c.symbol.replace('-USD','')) }))
            .map(x => ({ ...x, pair: x.pair || toBinancePair(x.c.symbol) }))
            .filter(x => !!x.pair) as { c:{symbol:string; name:string}; pair:string }[]

          const batchScores = await pool(pairs, 8, async ({ c, pair }) => {
            try {
              const url = `/api/crypto-light/indicators?symbols=${encodeURIComponent(pair)}`
              const r = await fetch(url, { cache: 'force-cache' })
              if (!r.ok) throw new Error(`HTTP ${r.status}`)
              const j = await r.json() as { results?: IndResp[] }
              const ind = (j.results || [])[0]
              const { score } = overallScore(ind)
              try {
                localStorage.setItem(`ta:${pair}`, JSON.stringify({ score, ts: Date.now() }))
              } catch {}
              return { symbol: c.symbol, name: c.name, score }
            } catch {
              return { symbol: c.symbol, name: c.name, score: null as any }
            }
          })

          const rows = batchScores.filter(r => Number.isFinite(r.score as number)) as { symbol:string; name:string; score:number }[]
          const buys  = [...rows].sort((a,b)=> b.score - a.score).slice(0,5).map(r => ({ ...r, signal: statusFromScore(r.score) as Advice }))
          const sells = [...rows].sort((a,b)=> a.score - b.score).slice(0,5).map(r => ({ ...r, signal: statusFromScore(r.score) as Advice }))
          if (!aborted) {
            if (!hadCBuy)  setCache('home:coin:topBuy',  buys)
            if (!hadCSell) setCache('home:coin:topSell', sells)
          }
        }
      } catch {}
    })

    return () => { aborted = true }
  }, [])

  // SWR warm-up (news) – blijft no-store
  useEffect(() => {
    let aborted = false
    async function prime(key: string) {
      try {
        const r = await fetch(key, { cache: 'no-store' })
        if (!r.ok) return
        const data = await r.json()
        if (!aborted) mutate(key, data, { revalidate: false })
      } catch {}
    }
    const locale = 'hl=en-US&gl=US&ceid=US:en'
    ;[
      `/api/news/google?q=crypto&${locale}`,
      `/api/news/google?q=equities&${locale}`,
    ].forEach(prime)
    return () => { aborted = true }
  }, [])

  /* ========= NEWS ========= */
  const [newsCrypto, setNewsCrypto] = useState<NewsItem[]>([])
  const [newsEq, setNewsEq] = useState<NewsItem[]>([])
  useEffect(()=>{
    let aborted=false
    async function load(topic: 'crypto'|'equities', setter:(x:NewsItem[])=>void){
      try{
        const query =
          topic === 'crypto'
            ? 'crypto OR bitcoin OR ethereum OR blockchain'
            : 'equities OR stocks OR stock market OR aandelen OR beurs'
        const locale = 'hl=en-US&gl=US&ceid=US:en'
        const r = await fetch(`/api/news/google?q=${encodeURIComponent(query)}&${locale}`, { cache:'no-store' })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const j = await r.json()
        const arr:NewsItem[] = (j.items || []).slice(0,6).map((x:any)=>({
          title: x.title || '',
          url: x.link,
          source: x.source || '',
          published: x.pubDate || '',
          image: null,
        }))
        if (!aborted) setter(arr)
      }catch{
        if (!aborted) setter([])
      }
    }
    load('crypto', setNewsCrypto)
    load('equities', setNewsEq)
    return ()=>{aborted=true}
  },[])

  /* =======================
     EQUITIES — Top BUY/SELL
     ======================= */
  const MARKET_ORDER: MarketLabel[] = ['AEX','S&P 500','NASDAQ','Dow Jones','DAX','FTSE 100','Nikkei 225','Hang Seng','Sensex']
  const [topBuy, setTopBuy]   = useState<ScoredEq[]>([])
  const [topSell, setTopSell] = useState<ScoredEq[]>([])
  const [scoreErr, setScoreErr] = useState<string | null>(null)

  useEffect(() => {
    let aborted = false
    ;(async () => {
      try {
        setScoreErr(null)
        const cacheKeyBuy  = 'home:eq:topBuy'
        const cacheKeySell = 'home:eq:topSell'

        // 1) cache tonen
        const cachedBuy  = getCache<ScoredEq[]>(cacheKeyBuy)
        const cachedSell = getCache<ScoredEq[]>(cacheKeySell)
        if (cachedBuy)  setTopBuy(cachedBuy)
        if (cachedSell) setTopSell(cachedSell)

        // 2) opnieuw berekenen op achtergrond (zonder sleeps)
        const outBuy: ScoredEq[] = []
        const outSell: ScoredEq[] = []

        for (const market of MARKET_ORDER) {
          const cons = constituentsForMarket(market)
          if (!cons.length) continue
          const symbols = cons.map(c => c.symbol)

          const scores = await pool(symbols, 4, async (sym) => {
            return await calcScoreForSymbol(sym) // cache: 'force-cache'
          })

          const rows = cons.map((c, i) => ({
            symbol: c.symbol, name: c.name, market, score: scores[i] ?? (null as any)
          })).filter(r => Number.isFinite(r.score as number)) as Array<ScoredEq>

          if (rows.length) {
            const top = [...rows].sort((a,b)=> b.score - a.score)[0]
            const bot = [...rows].sort((a,b)=> a.score - b.score)[0]
            if (top) outBuy.push({ ...top, signal: statusFromScore(top.score) })
            if (bot) outSell.push({ ...bot, signal: statusFromScore(bot.score) })
          }
        }

        const order = (m: MarketLabel) => MARKET_ORDER.indexOf(m)
        const finalBuy  = outBuy.sort((a,b)=> order(a.market)-order(b.market))
        const finalSell = outSell.sort((a,b)=> order(a.market)-order(b.market))

        if (!aborted) {
          setTopBuy(finalBuy)
          setTopSell(finalSell)
          setCache(cacheKeyBuy, finalBuy)
          setCache(cacheKeySell, finalSell)
        }
      } catch (e: any) {
        if (!aborted) setScoreErr(String(e?.message || e))
      }
    })()
    return () => { aborted = true }
  }, [])

  /* =======================
     CRYPTO — Top 5 BUY/SELL
     ======================= */
  const [coinTopBuy, setCoinTopBuy]   = useState<ScoredCoin[]>([])
  const [coinTopSell, setCoinTopSell] = useState<ScoredCoin[]>([])
  const [coinErr, setCoinErr] = useState<string | null>(null)

  useEffect(() => {
    let aborted = false
    ;(async () => {
      try {
        setCoinErr(null)

        // cache eerst tonen
        const cacheKeyB = 'home:coin:topBuy'
        const cacheKeyS = 'home:coin:topSell'
        const cB = getCache<ScoredCoin[]>(cacheKeyB)
        const cS = getCache<ScoredCoin[]>(cacheKeyS)
        if (cB) setCoinTopBuy(cB)
        if (cS) setCoinTopSell(cS)

        const pairs = COINS.map(c => ({ c, pair: toBinancePair(c.symbol.replace('-USD','')) }))
          .map(x => ({ ...x, pair: x.pair || toBinancePair(x.c.symbol) }))
          .filter(x => !!x.pair) as { c:{symbol:string; name:string}; pair:string }[]

        // Indicators ophalen (force-cache i.p.v. no-store)
        const batchScores = await pool(pairs, 8, async ({ c, pair }) => {
          try {
            const url = `/api/crypto-light/indicators?symbols=${encodeURIComponent(pair)}`
            const r = await fetch(url, { cache: 'force-cache' })
            if (!r.ok) throw new Error(`HTTP ${r.status}`)
            const j = await r.json() as { results?: IndResp[] }
            const ind = (j.results || [])[0]
            const { score } = overallScore(ind)
            return { symbol: c.symbol, name: c.name, score }
          } catch {
            // quick-path met evt. lokale score
            try {
              const raw = localStorage.getItem(`ta:${pair}`)
              if (raw) {
                const jj = JSON.parse(raw) as { score?: number; ts?: number }
                if (Number.isFinite(jj?.score) && (Date.now() - (jj.ts||0) < TTL_MS)) {
                  return { symbol: c.symbol, name: c.name, score: Math.round(Number(jj.score)) }
                }
              }
            } catch {}
            return { symbol: c.symbol, name: c.name, score: (null as any) }
          }
        })

        const rows = batchScores
          .filter(r => Number.isFinite(r.score as number)) as { symbol:string; name:string; score:number }[]

        const sortedDesc = [...rows].sort((a,b)=> b.score - a.score)
        const sortedAsc  = [...rows].sort((a,b)=> a.score - b.score)

        const buys  = sortedDesc.slice(0, 5).map(r => ({ ...r, signal: statusFromScore(r.score) }))
        const sells = sortedAsc.slice(0, 5).map(r => ({ ...r, signal: statusFromScore(r.score) }))

        if (!aborted) {
          setCoinTopBuy(buys)
          setCoinTopSell(sells)
          setCache(cacheKeyB, buys)
          setCache(cacheKeyS, sells)
        }
      } catch (e:any) {
        if (!aborted) setCoinErr(String(e?.message || e))
      }
    })()
    return () => { aborted = true }
  }, [])

  /* ---- helpers voor nieuws (favicon + decode + source→domain fallback) ---- */
  function decodeHtml(s: string) {
    return (s || '')
      .replaceAll('&amp;', '&')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
  }

  const SOURCE_DOMAIN_MAP: Record<string, string> = {
    'reuters': 'reuters.com',
    'yahoo finance': 'finance.yahoo.com',
    'cnbc': 'cnbc.com',
    'the wall street journal': 'wsj.com',
    'wall street journal': 'wsj.com',
    'investopedia': 'investopedia.com',
    'marketwatch': 'marketwatch.com',
    "investor's business daily": 'investors.com',
    'investors business daily': 'investors.com',
    'cointelegraph': 'cointelegraph.com',
    'investing.com': 'investing.com',
    'bloomberg': 'bloomberg.com',
    'financial times': 'ft.com',
    'the verge': 'theverge.com',
    'forbes': 'forbes.com',
    'techcrunch': 'techcrunch.com',
  }

  function sourceToDomain(src?: string): string | null {
    if (!src) return null
    const key = src.trim().toLowerCase()
    if (SOURCE_DOMAIN_MAP[key]) return SOURCE_DOMAIN_MAP[key]
    for (const k of Object.keys(SOURCE_DOMAIN_MAP)) {
      if (key.includes(k)) return SOURCE_DOMAIN_MAP[k]
    }
    return null
  }

  function realDomainFromUrl(raw: string, src?: string): { domain: string; favicon: string } {
    try {
      const u = new URL(raw)
      if (u.hostname.endsWith('news.google.com')) {
        const orig = u.searchParams.get('url')
        if (orig) {
          const ou = new URL(orig)
          const d = ou.hostname.replace(/^www\./, '')
          return { domain: d, favicon: `https://www.google.com/s2/favicons?sz=64&domain=${d}` }
        }
        const d2 = sourceToDomain(src || '')
        if (d2) return { domain: d2, favicon: `https://www.google.com/s2/favicons?sz=64&domain=${d2}` }
      }
      const d = u.hostname.replace(/^www\./, '')
      return { domain: d, favicon: `https://www.google.com/s2/favicons?sz=64&domain=${d}` }
    } catch {
      const d2 = sourceToDomain(src || '')
      return d2 ? { domain: d2, favicon: `https://www.google.com/s2/favicons?sz=64&domain=${d2}` } : { domain: '', favicon: '' }
    }
  }

  const renderNews = (items: NewsItem[], keyPrefix: string) => (
    <ul className="grid gap-2">
      {items.length === 0 ? (
        <li className="text-white/60">No news…</li>
      ) : items.map((n, i) => {
        const { domain, favicon } = realDomainFromUrl(n.url, n.source)
        const title = decodeHtml(n.title || '')
        return (
          <li
            key={`${keyPrefix}${i}`}
            className="flex items-start gap-3 p-2 rounded-lg bg-white/5 hover:bg-white/10 transition"
          >
            {favicon ? (
              <img src={favicon} alt={domain} className="w-4 h-4 mt-1 rounded-sm" />
            ) : (
              <div className="w-4 h-4 mt-1 rounded-sm bg-white/10" />
            )}
            <div className="min-w-0 flex-1">
              <a
                href={n.url}
                target="_blank"
                rel="noreferrer"
                className="block font-medium text-white hover:underline truncate"
                title={title}
              >
                {title}
              </a>
              <div className="text-xs text-white/60 mt-0.5 truncate">
                {(n.source || domain || '').trim()}
                {n.published ? ` • ${new Date(n.published).toLocaleString('nl-NL')}` : ''}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )

  const equityHref = (symbol: string) => `/stocks/${encodeURIComponent(symbol)}`
  const coinHref = (symbol: string) => `/crypto/${symbol.toLowerCase()}`

  return (
    <>
      <Head>
        <title>SignalHub — Clarity in Markets</title>
        <meta name="description" content="Real-time BUY / HOLD / SELL signals across crypto and global equities — all in one stoplight view." />
        <link rel="preconnect" href="https://query2.finance.yahoo.com" crossOrigin="" />
        <link rel="preconnect" href="https://api.coingecko.com" crossOrigin="" />
      </Head>

      {/* INTRO / WHY SIGNALHUB */}
      <section className="max-w-6xl mx-auto px-4 pt-16 pb-8">
        <div className="grid md:grid-cols-2 gap-8 items-center">
          <div>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-white">
              Cut the noise. Catch the signal.
            </h1>

            <div className="text-white/80 mt-3 space-y-4">
              <h2 className="text-xl font-semibold text-white">Why SignalHub?</h2>

              <p>
                SignalHub is where complexity turns into clarity. We cut through the endless
                stream of charts, news, and hype to give you a clean, actionable view of the
                markets. Whether you’re trading crypto, ETFs, or global equities, our platform
                highlights exactly what matters most: momentum, volume, sentiment, and context.
              </p>

              <p><strong>No guesswork. No noise. Just signals you can actually use.</strong></p>

              <p>
                Already trusted by thousands of investors worldwide, SignalHub turns uncertainty
                into confidence. With our intuitive buy/hold/sell insights, you’ll know where the
                market stands, and where it’s headed.
              </p>

              <p>
                <strong>Clarity. Confidence. Control.</strong><br />
                <span className="text-white/70">That’s SignalHub. Your edge in every market.</span>
              </p>
            </div>
          </div>

          <div className="table-card overflow-hidden">
            <Image
              src={HERO_IMG}
              alt="Crypto Tracker — SignalHub"
              width={1280}
              height={960}
              priority
              unoptimized
              className="w-full h-auto"
            />
          </div>
        </div>

        <div className="mt-8 h-px bg-white/10" />
      </section>

      {/* EQUITIES — Top BUY/SELL */}
      <section className="max-w-6xl mx-auto px-4 pb-10 grid md:grid-cols-2 gap-4">
        {/* BUY */}
        <div className="table-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Equities — Top BUY (by Signal Score)</h2>
            {scoreErr && <span className="text-xs text-red-300">Error: {scoreErr}</span>}
          </div>
          <ul className="divide-y divide-white/10">
            {topBuy.length===0 ? (
              <li className="py-3 text-white/60">No data yet…</li>
            ) : topBuy.map((r)=>(
              <li key={`bb-${r.market}-${r.symbol}`} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-white/60 text-xs mb-0.5">{r.market}</div>
                  <div className="font-medium truncate">
                    <Link href={equityHref(r.symbol)} className="hover:underline">
                      {r.name} <span className="text-white/60 font-normal">({r.symbol})</span>
                    </Link>
                  </div>
                </div>
                <Link href={equityHref(r.symbol)} className="shrink-0 origin-right scale-90 sm:scale-100">
                  <ScoreBadge score={r.score} />
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* SELL */}
        <div className="table-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Equities — Top SELL (by Signal Score)</h2>
            {scoreErr && <span className="text-xs text-red-300">Error: {scoreErr}</span>}
          </div>
          <ul className="divide-y divide-white/10">
            {topSell.length===0 ? (
              <li className="py-3 text-white/60">No data yet…</li>
            ) : topSell.map((r)=>(
              <li key={`bs-${r.market}-${r.symbol}`} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-white/60 text-xs mb-0.5">{r.market}</div>
                  <div className="font-medium truncate">
                    <Link href={equityHref(r.symbol)} className="hover:underline">
                      {r.name} <span className="text-white/60 font-normal">({r.symbol})</span>
                    </Link>
                  </div>
                </div>
                <Link href={equityHref(r.symbol)} className="shrink-0 origin-right scale-90 sm:scale-100">
                  <ScoreBadge score={r.score} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* CRYPTO — Top 5 BUY/SELL */}
      <section className="max-w-6xl mx-auto px-4 pb-10 grid md:grid-cols-2 gap-4">
        {/* BUY top 5 */}
        <div className="table-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Crypto — Top 5 BUY (by Signal Score)</h2>
            {coinErr && <span className="text-xs text-red-300">Error: {coinErr}</span>}
          </div>
          <ul className="divide-y divide-white/10">
            {coinTopBuy.length===0 ? (
              <li className="py-3 text-white/60">No data yet…</li>
            ) : coinTopBuy.map((r)=>(
              <li key={`cb-${r.symbol}`} className="py-2 flex items-center justify-between gap-3">
                <div className="truncate">
                  <div className="font-medium truncate">
                    <Link href={coinHref(r.symbol)} className="hover:underline">{r.name}</Link>
                  </div>
                  <div className="text-white/60 text-xs">
                    <Link href={coinHref(r.symbol)} className="hover:underline">{r.symbol}</Link>
                  </div>
                </div>
                <Link href={coinHref(r.symbol)} className="shrink-0 origin-right scale-90 sm:scale-100">
                  <ScoreBadge score={r.score} />
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* SELL top 5 */}
        <div className="table-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Crypto — Top 5 SELL (by Signal Score)</h2>
            {coinErr && <span className="text-xs text-red-300">Error: {coinErr}</span>}
          </div>
          <ul className="divide-y divide-white/10">
            {coinTopSell.length===0 ? (
              <li className="py-3 text-white/60">No data yet…</li>
            ) : coinTopSell.map((r)=>(
              <li key={`cs-${r.symbol}`} className="py-2 flex items-center justify-between gap-3">
                <div className="truncate">
                  <div className="font-medium truncate">
                    <Link href={coinHref(r.symbol)} className="hover:underline">{r.name}</Link>
                  </div>
                  <div className="text-white/60 text-xs">
                    <Link href={coinHref(r.symbol)} className="hover:underline">{r.symbol}</Link>
                  </div>
                </div>
                <Link href={coinHref(r.symbol)} className="shrink-0 origin-right scale-90 sm:scale-100">
                  <ScoreBadge score={r.score} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* NEWS — compact */}
      <section className="max-w-6xl mx-auto px-4 pb-16 grid md:grid-cols-2 gap-4">
        <div className="table-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Crypto News</h2>
            <Link href="/index" className="text-sm text-white/70 hover:text-white">Open crypto →</Link>
          </div>
          {renderNews(newsCrypto, 'nC')}
        </div>

        <div className="table-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Equities News</h2>
            <Link href="/stocks" className="text-sm text-white/70 hover:text-white">Open AEX →</Link>
          </div>
          {renderNews(newsEq, 'nE')}
        </div>
      </section>
    </>
  )
}

// onderaan src/pages/index.tsx
export async function getStaticProps() {
  return {
    props: {}, // jouw page gebruikt SWR, dus geen data nodig hier
    revalidate: 300, // hergenereer elke 5 minuten op Vercel
  };
}