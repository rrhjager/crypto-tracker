// src/pages/index.tsx
import Head from 'next/head'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import { mutate } from 'swr'
import useSWR from 'swr'
import { AEX } from '@/lib/aex'
import ScoreBadge from '@/components/ScoreBadge'

import { SP500 } from '@/lib/sp500'
import { NASDAQ } from '@/lib/nasdaq'
import { DOWJONES } from '@/lib/dowjones'
import { DAX as DAX_FULL } from '@/lib/dax'
import { FTSE100 } from '@/lib/ftse100'
import { NIKKEI225 } from '@/lib/nikkei225'
import { HANGSENG } from '@/lib/hangseng'
import { SENSEX } from '@/lib/sensex'

/* ---------------- config ---------------- */
const TTL_MS = 5 * 60 * 1000 // 5 min cache
const CARD_CONTENT_H = 'h-[280px]'
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '') || ''

/* ---------------- types ---------------- */
type Advice = 'BUY' | 'HOLD' | 'SELL'
type NewsItem = { title: string; url: string; source?: string; published?: string; image?: string | null }

type MarketLabel =
  | 'AEX' | 'S&P 500' | 'NASDAQ' | 'Dow Jones'
  | 'DAX' | 'FTSE 100' | 'Nikkei 225' | 'Hang Seng' | 'Sensex'

type ScoredEq   = { symbol: string; name: string; market: MarketLabel; score: number; signal: Advice }
type ScoredCoin = { symbol: string; name: string; score: number; signal: Advice }

type CongressTrade = {
  person?: string; ticker?: string; side?: 'BUY'|'SELL'|string;
  amount?: string|number; price?: string|number|null; date?: string; url?: string;
}

type HomeSnapshot = {
  newsCrypto: NewsItem[];
  newsEq: NewsItem[];
  topBuy: ScoredEq[];
  topSell: ScoredEq[];
  coinTopBuy: ScoredCoin[];
  coinTopSell: ScoredCoin[];
  academy: { title: string; href: string }[];
  congress: CongressTrade[];
}
type HomeProps = { snapshot: HomeSnapshot | null }

/* ---------------- utils ---------------- */
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))
function statusFromScore(score: number): Advice {
  if (score >= 66) return 'BUY'
  if (score <= 33) return 'SELL'
  return 'HOLD'
}

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

/* ---------------- constituents per markt ---------------- */
const MARKET_ORDER: MarketLabel[] = ['AEX','S&P 500','NASDAQ','Dow Jones','DAX','FTSE 100','Nikkei 225','Hang Seng','Sensex']

function constituentsForMarket(label: MarketLabel) {
  if (label === 'AEX') return AEX.map(x => ({ symbol: x.symbol, name: x.name }))
  if (label === 'S&P 500' && Array.isArray(SP500) && SP500.length)
    return SP500.map((x: any) => ({ symbol: x.symbol, name: x.name }))
  if (label === 'NASDAQ' && Array.isArray(NASDAQ) && NASDAQ.length)
    return NASDAQ.map((x: any) => ({ symbol: x.symbol, name: x.name }))
  if (label === 'Dow Jones' && Array.isArray(DOWJONES) && DOWJONES.length)
    return DOWJONES.map((x: any) => ({ symbol: x.symbol, name: x.name }))
  if (label === 'DAX' && Array.isArray(DAX_FULL) && DAX_FULL.length)
    return DAX_FULL.map((x: any) => ({ symbol: x.symbol, name: x.name }))
  if (label === 'FTSE 100' && Array.isArray(FTSE100) && FTSE100.length)
    return FTSE100.map((x: any) => ({ symbol: x.symbol, name: x.name }))
  if (label === 'Nikkei 225' && Array.isArray(NIKKEI225) && NIKKEI225.length)
    return NIKKEI225.map((x: any) => ({ symbol: x.symbol, name: x.name }))
  if (label === 'Hang Seng' && Array.isArray(HANGSENG) && HANGSENG.length)
    return HANGSENG.map((x: any) => ({ symbol: x.symbol, name: x.name }))
  if (label === 'Sensex' && Array.isArray(SENSEX) && SENSEX.length)
    return SENSEX.map((x: any) => ({ symbol: x.symbol, name: x.name }))
  return []
}

/* ---------------- page ---------------- */
export default function Homepage(props: HomeProps) {
  const router = useRouter()

  // minute tag
  const [minuteTag, setMinuteTag] = useState(Math.floor(Date.now() / 60_000))
  useEffect(() => {
    const id = setInterval(() => setMinuteTag(Math.floor(Date.now() / 60_000)), 60_000)
    return () => clearInterval(id)
  }, [])
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (!e.key || !e.key.startsWith('home:eq:')) return
      setMinuteTag(Math.floor(Date.now() / 60_000))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  /* ---------- Prefetch routes ---------- */
  useEffect(() => {
    const routes = [
      '/crypto',
      '/aex','/sp500','/nasdaq','/dowjones','/dax','/ftse100','/nikkei225','/hangseng','/sensex','/etfs',
      '/intel','/intel/hedgefunds','/intel/macro','/intel/sectors','/academy','/about'
    ]
    routes.forEach(r => router.prefetch(r).catch(()=>{}))
  }, [router])

  /* ---------- hydrateer met snapshot/cache (instant render) ---------- */
  const [newsCrypto, setNewsCrypto] = useState<NewsItem[]>(
    props.snapshot?.newsCrypto ?? getCache<NewsItem[]>('home:news:crypto') ?? []
  )
  const [newsEq, setNewsEq] = useState<NewsItem[]>(
    props.snapshot?.newsEq ?? getCache<NewsItem[]>('home:news:eq') ?? []
  )
  const [topBuy, setTopBuy]   = useState<ScoredEq[]>(
    props.snapshot?.topBuy ?? getCache<ScoredEq[]>('home:eq:topBuy') ?? []
  )
  const [topSell, setTopSell] = useState<ScoredEq[]>(
    props.snapshot?.topSell ?? getCache<ScoredEq[]>('home:eq:topSell') ?? []
  )
  const [coinTopBuy, setCoinTopBuy]   = useState<ScoredCoin[]>(
    props.snapshot?.coinTopBuy ?? getCache<ScoredCoin[]>('home:coin:topBuy') ?? []
  )
  const [coinTopSell, setCoinTopSell] = useState<ScoredCoin[]>(
    props.snapshot?.coinTopSell ?? getCache<ScoredCoin[]>('home:coin:topSell') ?? []
  )
  const [academy, setAcademy] = useState<{ title: string; href: string }[]>(
    props.snapshot?.academy ?? getCache<{title:string;href:string}[]>('home:academy') ?? []
  )
  const [trades, setTrades] = useState<CongressTrade[]>(
    props.snapshot?.congress ?? getCache<CongressTrade[]>('home:congress') ?? []
  )

  const [loadingEq, setLoadingEq] = useState(topBuy.length===0 || topSell.length===0)
  const [loadingCoin, setLoadingCoin] = useState(coinTopBuy.length===0 || coinTopSell.length===0)
  const [loadingNewsCrypto, setLoadingNewsCrypto] = useState(newsCrypto.length===0)
  const [loadingNewsEq, setLoadingNewsEq] = useState(newsEq.length===0)
  const [loadingCongress, setLoadingCongress] = useState(trades.length===0)
  const [loadingAcademy, setLoadingAcademy] = useState(academy.length===0)

  /* ---------- Zachte refresh van hele snapshot (NIET wissen) ---------- */
  useEffect(() => {
    let stop = false
    ;(async () => {
      try {
        const r = await fetch('/api/home/snapshot', { cache: 'no-store' })
        if (!r.ok) return
        const s = await r.json() as HomeSnapshot
        if (stop) return
        setNewsCrypto(v => (v.length ? v : s.newsCrypto)); setCache('home:news:crypto', s.newsCrypto); setLoadingNewsCrypto(false)
        setNewsEq(v => (v.length ? v : s.newsEq));         setCache('home:news:eq',     s.newsEq);     setLoadingNewsEq(false)
        setAcademy(v => (v.length ? v : s.academy));       setCache('home:academy',     s.academy);    setLoadingAcademy(false)
        setTrades(v => (v.length ? v : s.congress));       setCache('home:congress',    s.congress);   setLoadingCongress(false)
        if (!(topBuy.length && topSell.length)) {
          setTopBuy(s.topBuy);   setCache('home:eq:topBuy',  s.topBuy)
          setTopSell(s.topSell); setCache('home:eq:topSell', s.topSell)
          setLoadingEq(false)
        }
        if (!(coinTopBuy.length && coinTopSell.length)) {
          setCoinTopBuy(s.coinTopBuy);   setCache('home:coin:topBuy',  s.coinTopBuy)
          setCoinTopSell(s.coinTopSell); setCache('home:coin:topSell', s.coinTopSell)
          setLoadingCoin(false)
        }
      } catch {}
    })()
    return () => { stop = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------- NEWS warm-up (SWR) ---------- */
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

  /* ========= NEWS fallback (alleen als nog leeg) ========= */
  useEffect(()=>{
    if (newsCrypto.length && newsEq.length) return
    let aborted=false
    async function load(topic: 'crypto'|'equities', setter:(x:NewsItem[])=>void, setLoading:(f:boolean)=>void){
      try{
        setLoading(true)
        const query =
          topic === 'crypto'
            ? 'crypto OR bitcoin OR ethereum OR blockchain'
            : 'equities OR stocks OR stock market OR aandelen OR beurs'
        const locale = 'hl=en-US&gl=US&ceid=US:en'
        const r = await fetch(`/api/news/google?q=${encodeURIComponent(query)}&${locale}&v=${minuteTag}`, { cache:'no-store' })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const j = await r.json()
        const arr:NewsItem[] = (j.items || []).slice(0,6).map((x:any)=>({
          title: x.title || '',
          url: x.link,
          source: x.source || '',
          published: x.pubDate || '',
          image: null,
        }))
        if (!aborted) {
          setter(arr)
          setCache(topic==='crypto' ? 'home:news:crypto' : 'home:news:eq', arr)
        }
      }catch{
        if (!aborted) setter([])
      } finally {
        if (!aborted) setLoading(false)
      }
    }
    if (!newsCrypto.length) load('crypto', setNewsCrypto, setLoadingNewsCrypto)
    if (!newsEq.length)     load('equities', setNewsEq,   setLoadingNewsEq)
    return ()=>{aborted=true}
  },[minuteTag, newsCrypto.length, newsEq.length])

  /* =======================
     EQUITIES — snelle, consistente herberekening
     via /api/indicators/snapshot-list?market=...
     (één call per markt, geen placeholders, geen flicker)
     ======================= */

  type HomeSnap = { symbol: string; score?: number|null; status?: string|null }
  const marketsForApi: Record<MarketLabel,string> = {
    'AEX':'AEX', 'S&P 500':'SP500', 'NASDAQ':'NASDAQ', 'Dow Jones':'DOWJONES',
    'DAX':'DAX', 'FTSE 100':'FTSE100', 'Nikkei 225':'NIKKEI225', 'Hang Seng':'HANGSENG', 'Sensex':'SENSEX'
  }

  function pickTopBottom(market: MarketLabel, snaps: HomeSnap[]) {
    const cons = constituentsForMarket(market)
    if (!cons.length || !snaps.length) return { top: null as ScoredEq|null, bot: null as ScoredEq|null }
    const scoreMap = new Map<string, number>()
    for (const s of snaps) {
      const v = typeof s.score === 'number' ? Math.round(clamp(((s.score + 2)/4)*100,0,100)) // als API -2..+2 teruggeeft
              : s.status ? (String(s.status).toUpperCase()==='BUY'?75:String(s.status).toUpperCase()==='SELL'?25:50)
              : NaN
      if (Number.isFinite(v)) scoreMap.set(String(s.symbol), v)
    }
    const rows = cons
      .map(c => ({ symbol: c.symbol, name: c.name, market, score: scoreMap.get(c.symbol)! }))
      .filter(r => Number.isFinite(r.score)) as ScoredEq[]

    if (!rows.length) return { top: null, bot: null }
    const top = [...rows].sort((a,b)=> b.score - a.score)[0]
    const bot = [...rows].sort((a,b)=> a.score - b.score)[0]
    return {
      top: top ? { ...top, signal: statusFromScore(top.score) } : null,
      bot: bot ? { ...bot, signal: statusFromScore(bot.score) } : null,
    }
  }

  // Background refresh zonder state te wissen
  useEffect(() => {
    let aborted = false
    ;(async () => {
      try {
        const results = await Promise.allSettled(
          MARKET_ORDER.map(async (mkt) => {
            const key = marketsForApi[mkt]
            const r = await fetch(`/api/indicators/snapshot-list?market=${encodeURIComponent(key)}&v=${minuteTag}`, { cache: 'no-store' })
            if (!r.ok) throw new Error(`HTTP ${r.status}`)
            const j = await r.json() as { items?: HomeSnap[] }
            return { mkt, snaps: Array.isArray(j.items) ? j.items : [] }
          })
        )

        const buys: ScoredEq[] = []
        const sells: ScoredEq[] = []
        for (const res of results) {
          if (res.status !== 'fulfilled') continue
          const { mkt, snaps } = res.value
          const { top, bot } = pickTopBottom(mkt, snaps)
          if (top) buys.push(top)
          if (bot) sells.push(bot)
        }

        const order = (m: MarketLabel) => MARKET_ORDER.indexOf(m)
        const finalBuy = buys.sort((a,b)=> order(a.market)-order(b.market))
        const finalSell = sells.sort((a,b)=> order(a.market)-order(b.market))

        if (!aborted && finalBuy.length && finalSell.length) {
          setTopBuy(prev => (prev.length ? prev : finalBuy)) // alleen vullen als leeg (voorkomt flicker)
          setTopSell(prev => (prev.length ? prev : finalSell))
          setCache('home:eq:topBuy',  finalBuy)
          setCache('home:eq:topSell', finalSell)
          setLoadingEq(false)
        }
      } catch {
        // stil falen; we laten bestaande UI staan
      }
    })()
    return () => { aborted = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minuteTag])

  /* =======================
     CRYPTO — zoals je had (ongewijzigd gedrag, met cache)
     ======================= */

  type IndResp = {
    symbol: string
    ma?: { ma50: number|null; ma200: number|null; cross?: string }
    rsi?: number|null
    macd?: { macd: number|null; signal: number|null; hist: number|null }
    volume?: { volume: number|null; avg20d: number|null; ratio: number|null }
    error?: string
  }

  const COINS: { symbol: string; name: string }[] = [
    { symbol: 'BTC-USD',  name: 'Bitcoin' }, { symbol: 'ETH-USD',  name: 'Ethereum' },
    { symbol: 'BNB-USD',  name: 'BNB' },     { symbol: 'SOL-USD',  name: 'Solana' },
    { symbol: 'XRP-USD',  name: 'XRP' },     { symbol: 'ADA-USD',  name: 'Cardano' },
    { symbol: 'DOGE-USD', name: 'Dogecoin' },{ symbol: 'TON-USD',  name: 'Toncoin' },
    { symbol: 'TRX-USD',  name: 'TRON' },    { symbol: 'AVAX-USD', name: 'Avalanche' },
    { symbol: 'DOT-USD',  name: 'Polkadot' },{ symbol: 'LINK-USD', name: 'Chainlink' },
    { symbol: 'BCH-USD',  name: 'Bitcoin Cash' }, { symbol: 'LTC-USD',  name: 'Litecoin' },
    { symbol: 'MATIC-USD', name: 'Polygon' },{ symbol: 'XLM-USD',  name: 'Stellar' },
    { symbol: 'NEAR-USD', name: 'NEAR' },    { symbol: 'ICP-USD',  name: 'Internet Computer' },
    { symbol: 'ETC-USD',  name: 'Ethereum Classic' }, { symbol: 'FIL-USD',  name: 'Filecoin' },
    { symbol: 'XMR-USD',  name: 'Monero' },  { symbol: 'APT-USD',  name: 'Aptos' },
    { symbol: 'ARB-USD',  name: 'Arbitrum' },{ symbol: 'OP-USD',   name: 'Optimism' },
    { symbol: 'SUI-USD',  name: 'Sui' },     { symbol: 'HBAR-USD', name: 'Hedera' },
    { symbol: 'ALGO-USD', name: 'Algorand' },{ symbol: 'VET-USD',  name: 'VeChain' },
    { symbol: 'EGLD-USD', name: 'MultiversX' }, { symbol: 'AAVE-USD', name: 'Aave' },
    { symbol: 'INJ-USD',  name: 'Injective' },{ symbol: 'MKR-USD',  name: 'Maker' },
    { symbol: 'RUNE-USD', name: 'THORChain' },{ symbol: 'IMX-USD',  name: 'Immutable' },
    { symbol: 'FLOW-USD', name: 'Flow' },    { symbol: 'SAND-USD', name: 'The Sandbox' },
    { symbol: 'MANA-USD', name: 'Decentraland' }, { symbol: 'AXS-USD',  name: 'Axie Infinity' },
    { symbol: 'QNT-USD',  name: 'Quant' },   { symbol: 'GRT-USD',  name: 'The Graph' },
    { symbol: 'CHZ-USD',  name: 'Chiliz' },  { symbol: 'CRV-USD',  name: 'Curve DAO' },
    { symbol: 'ENJ-USD',  name: 'Enjin Coin' },{ symbol: 'FTM-USD',  name: 'Fantom' },
    { symbol: 'XTZ-USD',  name: 'Tezos' },   { symbol: 'LDO-USD',  name: 'Lido DAO' },
    { symbol: 'SNX-USD',  name: 'Synthetix' },{ symbol: 'STX-USD',  name: 'Stacks' },
    { symbol: 'AR-USD',   name: 'Arweave' }, { symbol: 'GMX-USD',  name: 'GMX' },
  ]

  const PAIR_OVERRIDES: Record<string, string> = { 'MKR-USD': 'MKRUSDT', 'VET-USD': 'VETUSDT' }
  const toBinancePair = (symbol: string) => {
    const s = (symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    const skip = new Set(['USDT','USDC','BUSD','DAI','TUSD'])
    if (!s || skip.has(s)) return null
    return `${s}USDT`
  }
  const pairs = useMemo(() => {
    return COINS.map(c => {
      const ov = PAIR_OVERRIDES[c.symbol]
      if (ov) return { c, pair: ov }
      const base = c.symbol.replace('-USD', '')
      const p1 = toBinancePair(base)
      if (p1) return { c, pair: p1 }
      const p2 = toBinancePair(c.symbol)
      return { c, pair: p2 || '' }
    }).filter(x => !!x.pair) as { c:{symbol:string; name:string}; pair:string }[]
  }, [])

  useEffect(() => {
    if (coinTopBuy.length && coinTopSell.length) return
    let aborted = false
    ;(async () => {
      try {
        setLoadingCoin(true)
        const out = await Promise.allSettled(
          pairs.map(async ({ c, pair }) => {
            const url = `/api/crypto-light/indicators?symbols=${encodeURIComponent(pair)}&v=${minuteTag}`
            const r = await fetch(url, { cache: 'no-store' })
            if (!r.ok) throw new Error(`HTTP ${r.status}`)
            const j = await r.json() as { results?: IndResp[] }
            const ind = (j?.results || [])[0]
            // eenvoudige composite score: identiek aan server (component gebruikt compute server-side)
            const score =
              typeof ind?.rsi === 'number' || ind?.ma || ind?.macd || ind?.volume
                ? Math.max(0, Math.min(100,
                    Math.round(
                      ((ind?.rsi ?? 50) * 0.34) + // rsi gewogen
                      ((ind?.macd?.hist ?? 0) > 0 ? 20 : -20) + // macd sign
                      ((ind?.ma?.ma50 ?? 0) > (ind?.ma?.ma200 ?? 0) ? 20 : -20) + // trend
                      ((ind?.volume?.ratio ?? 1) > 1 ? 10 : 0) // volume
                    )
                  ))
                : null
            return { symbol: c.symbol, name: c.name, score }
          })
        )
        const rows = out
          .filter(r => r.status==='fulfilled')
          .map((r:any)=>r.value)
          .filter((r:any)=> Number.isFinite(r.score)) as { symbol:string; name:string; score:number }[]

        const sortedDesc = [...rows].sort((a,b)=> b.score - a.score)
        const sortedAsc  = [...rows].sort((a,b)=> a.score - b.score)
        const buys  = sortedDesc.slice(0, 5).map(r => ({ ...r, signal: statusFromScore(r.score) }))
        const sells = sortedAsc.slice(0, 5).map(r => ({ ...r, signal: statusFromScore(r.score) }))

        if (!aborted && buys.length && sells.length) {
          setCoinTopBuy(prev => (prev.length ? prev : buys))
          setCoinTopSell(prev => (prev.length ? prev : sells))
          setCache('home:coin:topBuy',  buys)
          setCache('home:coin:topSell', sells)
        }
      } catch {
      } finally {
        if (!aborted) setLoadingCoin(false)
      }
    })()
    return () => { aborted = true }
  }, [pairs, minuteTag, coinTopBuy.length, coinTopSell.length])

  /* ---- helpers for news UI ---- */
  function decodeHtml(s: string) {
    return (s || '')
      .replaceAll('&amp;', '&')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
  }
  const SOURCE_DOMAIN_MAP: Record<string, string> = {
    'reuters': 'reuters.com','yahoo finance': 'finance.yahoo.com','cnbc': 'cnbc.com','the wall street journal': 'wsj.com',
    'wall street journal': 'wsj.com','investopedia': 'investopedia.com','marketwatch': 'marketwatch.com',
    "investor's business daily": 'investors.com','investors business daily': 'investors.com','cointelegraph': 'cointelegraph.com',
    'investing.com': 'investing.com','bloomberg': 'bloomberg.com','financial times': 'ft.com','the verge': 'theverge.com',
    'forbes': 'forbes.com','techcrunch': 'techcrunch.com',
  }
  function sourceToDomain(src?: string): string | null {
    if (!src) return null
    const key = src.trim().toLowerCase()
    if (SOURCE_DOMAIN_MAP[key]) return SOURCE_DOMAIN_MAP[key]
    for (const k of Object.keys(SOURCE_DOMAIN_MAP)) if (key.includes(k)) return SOURCE_DOMAIN_MAP[k]
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

  const renderNews = (items: NewsItem[], keyPrefix: string, loading = false) => (
    <ul className={`grid gap-2 overflow-y-auto ${CARD_CONTENT_H} pr-1`}>
      {loading ? (
        <li className="text-white/60">Loading…</li>
      ) : items.length === 0 ? (
        <li className="text-white/60">No news…</li>
      ) : items.map((n, i) => {
        const { domain, favicon } = realDomainFromUrl(n.url, n.source)
        const title = decodeHtml(n.title || '')
        return (
          <li
            key={`${keyPrefix}${i}`}
            className="flex items-start gap-3 p-2 rounded-lg bg-white/5 hover:bg-white/10 transition hover:shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
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
                className="block font-medium text-white hover:underline truncate text-[13px]"
                title={title}
              >
                {title}
              </a>
              <div className="text-[11px] text-white/60 mt-0.5 truncate">
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

  /* ---------------- render ---------------- */
  return (
    <>
      <Head>
        <title>SignalHub — Clarity in Markets</title>
        <meta name="description" content="Real-time BUY / HOLD / SELL signals across crypto and global equities — all in one stoplight view." />
        <link rel="preconnect" href="https://query2.finance.yahoo.com" crossOrigin="" />
        <link rel="preconnect" href="https://api.coingecko.com" crossOrigin="" />
        <link rel="dns-prefetch" href="https://query2.finance.yahoo.com" />
        <link rel="dns-prefetch" href="https://api.coingecko.com" />
      </Head>

      <main className="max-w-screen-2xl mx-auto px-4 pt-8 pb-14">
        <div className="grid gap-5 lg:grid-cols-3">
          {/* 1) Hero */}
          <Card title="Cut the noise. Catch the signal." actionHref="/about" actionLabel="About us">
            <div className={`flex-1 overflow-y-auto ${CARD_CONTENT_H} pr-1`}>
              <div className="text-white/80 space-y-3 leading-relaxed">
                <p className="text-[13px]">
                  SignalHub provides a clean, actionable view of crypto and equities — built for clarity and speed.
                  Less noise, more direction: momentum, volume, and trend in one place.
                </p>
                <ul className="space-y-1">
                  <li className="flex items-center gap-2 text-[13px]">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/60" />
                    Unified BUY / HOLD / SELL signals across major cryptos and stock markets → spot high-conviction setups in seconds
                  </li>
                  <li className="flex items-center gap-2 text-[13px]">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/60" />
                    Momentum, volume & trend analytics → understand why assets move and predict future movements
                  </li>
                  <li className="flex items-center gap-2 text-[13px]">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/60" />
                    Market Intel feeds → track hedge funds, congress trades, and macro trends as they unfold
                  </li>
                </ul>
                <div className="pt-1 flex gap-2">
                  <Link href="/crypto" className="px-3 py-2 rounded-md bg-white/10 hover:bg-white/20 text-white transition text-[13px]">
                    Open crypto →
                  </Link>
                  <Link href="/aex" className="px-3 py-2 rounded-md bg-white/5 hover:bg-white/10 text-white transition text-[13px]">
                    Open AEX →
                  </Link>
                </div>
              </div>
            </div>
          </Card>

          {/* 2) Crypto — Top BUY */}
          <Card title="Crypto — Top 5 BUY" actionHref="/crypto" actionLabel="All crypto →">
            <ul className={`divide-y divide-white/8 overflow-y-auto ${CARD_CONTENT_H} pr-1`}>
              {loadingCoin ? (
                <li className="py-3 text-white/60 text-[13px]">Loading…</li>
              ) : coinTopBuy.length===0 ? (
                <li className="py-3 text-white/60 text-[13px]">No data…</li>
              ) : coinTopBuy.map((r)=>(
                <li key={`cb-${r.symbol}`}>
                  <Row
                    href={coinHref(r.symbol)}
                    left={
                      <div className="truncate">
                        <div className="font-medium truncate text-[13px]">{r.name}</div>
                        <div className="text-white/60 text-[11px]">{r.symbol}</div>
                      </div>
                    }
                    right={<div className="origin-right scale-90 sm:scale-100"><ScoreBadge score={r.score} /></div>}
                  />
                </li>
              ))}
            </ul>
          </Card>

          {/* 3) Crypto — Top SELL */}
          <Card title="Crypto — Top 5 SELL" actionHref="/crypto" actionLabel="All crypto →">
            <ul className={`divide-y divide-white/8 overflow-y-auto ${CARD_CONTENT_H} pr-1`}>
              {loadingCoin ? (
                <li className="py-3 text-white/60 text-[13px]">Loading…</li>
              ) : coinTopSell.length===0 ? (
                <li className="py-3 text-white/60 text-[13px]">No data…</li>
              ) : coinTopSell.map((r)=>(
                <li key={`cs-${r.symbol}`}>
                  <Row
                    href={coinHref(r.symbol)}
                    left={
                      <div className="truncate">
                        <div className="font-medium truncate text-[13px]">{r.name}</div>
                        <div className="text-white/60 text-[11px]">{r.symbol}</div>
                      </div>
                    }
                    right={<div className="origin-right scale-90 sm:scale-100"><ScoreBadge score={r.score} /></div>}
                  />
                </li>
              ))}
            </ul>
          </Card>

          {/* 4) Equities — Top BUY */}
          <Card title="Equities — Top BUY" actionHref="/sp500" actionLabel="Browse markets →">
            <ul className={`divide-y divide-white/8 overflow-y-auto ${CARD_CONTENT_H} pr-1`}>
              {loadingEq ? (
                <li className="py-3 text-white/60 text-[13px]">Loading…</li>
              ) : topBuy.length===0 ? (
                <li className="py-3 text-white/60 text-[13px]">No data…</li>
              ) : topBuy.map((r)=>(
                <li key={`bb-${r.market}-${r.symbol}`}>
                  <Row
                    href={equityHref(r.symbol)}
                    left={
                      <div className="min-w-0">
                        <div className="text-white/60 text-[11px] mb-0.5">{r.market}</div>
                        <div className="font-medium truncate text-[13px]">
                          {r.name} <span className="text-white/60 font-normal">({r.symbol})</span>
                        </div>
                      </div>
                    }
                    right={<div className="origin-right scale-90 sm:cale-100"><ScoreBadge score={r.score} /></div>}
                  />
                </li>
              ))}
            </ul>
          </Card>

          {/* 5) Equities — Top SELL */}
          <Card title="Equities — Top SELL" actionHref="/sp500" actionLabel="Browse markets →">
            <ul className={`divide-y divide-white/8 overflow-y-auto ${CARD_CONTENT_H} pr-1`}>
              {loadingEq ? (
                <li className="py-3 text-white/60 text-[13px]">Loading…</li>
              ) : topSell.length===0 ? (
                <li className="py-3 text-white/60 text-[13px]">No data…</li>
              ) : topSell.map((r)=>(
                <li key={`bs-${r.market}-${r.symbol}`}>
                  <Row
                    href={equityHref(r.symbol)}
                    left={
                      <div className="min-w-0">
                        <div className="text-white/60 text-[11px] mb-0.5">{r.market}</div>
                        <div className="font-medium truncate text-[13px]">
                          {r.name} <span className="text-white/60 font-normal">({r.symbol})</span>
                        </div>
                      </div>
                    }
                    right={<div className="origin-right scale-90 sm:scale-100"><ScoreBadge score={r.score} /></div>}
                  />
                </li>
              ))}
            </ul>
          </Card>

          {/* 6) Congress Trading — Latest */}
          <Card title="Congress Trading — Latest" actionHref="/intel" actionLabel="Open dashboard →">
            <div className={`overflow-y-auto ${CARD_CONTENT_H} pr-1`}>
              <div className="grid grid-cols-12 text-[10px] text-white/60 px-2 pb-1">
                <div className="col-span-4">Person</div>
                <div className="col-span-3">Ticker</div>
                <div className="col-span-2">Side</div>
                <div className="col-span-3 text-right">Amount / Price</div>
              </div>
              <ul className="divide-y divide-white/8">
                {loadingCongress ? (
                  <li className="py-3 text-white/60 text-[12px]">Loading…</li>
                ) : trades.length === 0 ? (
                  <li className="py-3 text-white/60 text-[12px]">No trades…</li>
                ) : trades.slice(0, 14).map((t, i) => (
                  <li key={`tr-${i}-${t.person}-${t.ticker}`} className="px-2">
                    <div
                      className="grid grid-cols-12 items-center gap-2 py-2 px-2 rounded-lg hover:bg-white/6 transition"
                      title={t.date ? new Date(t.date).toLocaleString('nl-NL') : undefined}
                    >
                      <div className="col-span-4 min-w-0 truncate text-[12px]">
                        {t.url ? (
                          <a href={t.url} target="_blank" rel="noreferrer" className="hover:underline">{t.person || '-'}</a>
                        ) : <span>{t.person || '-'}</span>}
                      </div>
                      <div className="col-span-3 text-[11px] leading-tight">
                        <div className="font-semibold tracking-wide">{(t.ticker || '').toUpperCase()}</div>
                      </div>
                      <div className={`col-span-2 text-[11px] font-semibold ${
                        String(t.side).toUpperCase()==='BUY' ? 'text-emerald-400' :
                        String(t.side).toUpperCase()==='SELL' ? 'text-rose-400' : 'text-white/70'
                      }`}>
                        {String(t.side || '-').toUpperCase()}
                      </div>
                      <div className="col-span-3 text-right text-[12px]">
                        <span className="text-white/80">{t.amount || '-'}</span>
                        {t.price != null && t.price !== '' && (
                          <span className="text-white/50 ml-1">
                            • {typeof t.price === 'number' ? `$${t.price.toFixed(2)}` : t.price}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </Card>

          {/* 7) Crypto News */}
          <Card title="Crypto News" actionHref="/crypto" actionLabel="Open crypto →">
            {renderNews(newsCrypto, 'nC', loadingNewsCrypto)}
          </Card>

          {/* 8) Equities News */}
          <Card title="Equities News" actionHref="/aex" actionLabel="Open AEX →">
            {renderNews(newsEq, 'nE', loadingNewsEq)}
          </Card>

          {/* 9) Academy */}
          <Card title="Academy" actionHref="/academy" actionLabel="All articles →">
            <ul className={`text-[13px] grid gap-2 overflow-y-auto ${CARD_CONTENT_H} pr-1`}>
              {loadingAcademy ? (
                <li className="text-white/60">Loading…</li>
              ) : academy.length===0 ? (
                <li className="text-white/60">No articles found…</li>
              ) : academy.map((a, i) => (
                <li key={`ac-${i}`}>
                  <Link href={a.href} className="block p-2 rounded bg-white/5 hover:bg-white/10 transition">
                    {a.title}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </main>
    </>
  )
}

export async function getStaticProps() {
  try {
    const base =
      BASE_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')

    // Server side: gebruik je bestaande snapshot die al topBuy/topSell bevat
    const res = await fetch(`${base}/api/home/snapshot`, { cache: 'no-store' })
    if (!res.ok) throw new Error('snapshot failed')
    const snapshot = await res.json() as HomeSnapshot
    return { props: { snapshot }, revalidate: 120 }
  } catch {
    return { props: { snapshot: null }, revalidate: 120 }
  }
}