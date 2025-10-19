// src/pages/index.tsx
import Head from 'next/head'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import { mutate } from 'swr'
import { AEX } from '@/lib/aex'
import ScoreBadge from '@/components/ScoreBadge'
import { computeScoreStatus } from '@/lib/taScore'

/* ===== Volledige constituents per beurs (bestaande libs) ===== */
import { SP500 }    from '@/lib/sp500'
import { NASDAQ }   from '@/lib/nasdaq'
import { DOWJONES } from '@/lib/dowjones'
import { DAX as DAX_FULL } from '@/lib/dax'
import { FTSE100 }  from '@/lib/ftse100'
import { NIKKEI225 } from '@/lib/nikkei225'
import { HANGSENG }  from '@/lib/hangseng'
import { SENSEX }    from '@/lib/sensex'

/* ---------------- config ---------------- */
const TTL_MS = 5 * 60 * 1000 // 5 min cache
const CARD_CONTENT_H = 'h-[280px]' // compact 9 tiles

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

/* =======================
   CRYPTO — API response
   ======================= */
type IndResp = {
  symbol: string
  ma?: { ma50: number|null; ma200: number|null; cross?: string }
  rsi?: number|null
  macd?: { macd: number|null; signal: number|null; hist: number|null }
  volume?: { volume: number|null; avg20d: number|null; ratio: number|null }
  error?: string
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

/* ===== gebruik volledige lijsten per markt (fallback naar STATIC_CONS) ===== */
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

/* ---------------- small UI primitives ---------------- */
const Card: React.FC<{ title: string; actionHref?: string; actionLabel?: string; children: React.ReactNode }> = ({
  title, actionHref, actionLabel, children
}) => (
  <section className="rounded-2xl border border-white/10 bg-white/[0.03] shadow-[0_6px_30px_-10px_rgba(0,0,0,0.25)] transition-all hover:-translate-y-[1px] hover:shadow-[0_10px_40px_-12px_rgba(0,0,0,0.35)]">
    <header className="flex items-center justify-between px-5 pt-4 pb-2">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {actionHref && (
        <Link href={actionHref} className="text-[12px] text-white/70 hover:text-white inline-flex items-center gap-1">
          {actionLabel || 'View all'} <span aria-hidden>→</span>
        </Link>
      )}
    </header>
    <div className="px-4 pb-4">{children}</div>
  </section>
)

const Row: React.FC<{ left: React.ReactNode; right?: React.ReactNode; href?: string; title?: string }> = ({
  left, right, href, title
}) => {
  const Cmp: any = href ? Link : 'div'
  const props: any = href ? { href } : {}
  return (
    <Cmp {...props} title={title} className="flex items-center justify-between gap-3 px-3 py-[10px] rounded-xl hover:bg-white/6 transition-colors">
      <div className="min-w-0">{left}</div>
      {right && <div className="shrink-0">{right}</div>}
    </Cmp>
  )
}

/* ---------------- page ---------------- */
export default function Homepage() {
  const router = useRouter()

  // minute tag voor cache-busting + periodieke refresh
  const [minuteTag, setMinuteTag] = useState(Math.floor(Date.now() / 60_000))
  useEffect(() => {
    const id = setInterval(() => setMinuteTag(Math.floor(Date.now() / 60_000)), 60_000)
    return () => clearInterval(id)
  }, [])
  // luister naar localStorage updates van detailpagina
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (!e.key || !e.key.startsWith('ta:')) return
      setMinuteTag(Math.floor(Date.now() / 60_000))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // loading flags
  const [loadingEq, setLoadingEq] = useState(true)
  const [loadingCoin, setLoadingCoin] = useState(true)
  const [loadingNewsCrypto, setLoadingNewsCrypto] = useState(true)
  const [loadingNewsEq, setLoadingNewsEq] = useState(true)
  const [loadingCongress, setLoadingCongress] = useState(true)
  const [loadingAcademy, setLoadingAcademy] = useState(true)

  /* ---------- Prefetch routes ---------- */
  useEffect(() => {
    const routes = [
      '/crypto',
      '/aex','/sp500','/nasdaq','/dowjones','/dax','/ftse100','/nikkei225','/hangseng','/sensex','/etfs',
      '/intel','/intel/hedgefunds','/intel/macro','/intel/sectors','/academy','/about'
    ]
    routes.forEach(r => router.prefetch(r).catch(()=>{}))
  }, [router])

  /* ---------- Eerste paint versnellen: hydrateer UI met cache ---------- */
  const [newsCrypto, setNewsCrypto] = useState<NewsItem[]>(getCache<NewsItem[]>('home:news:crypto') || [])
  const [newsEq, setNewsEq] = useState<NewsItem[]>(getCache<NewsItem[]>('home:news:eq') || [])
  const [topBuy, setTopBuy]   = useState<ScoredEq[]>(getCache<ScoredEq[]>('home:eq:topBuy') || [])
  const [topSell, setTopSell] = useState<ScoredEq[]>(getCache<ScoredEq[]>('home:eq:topSell') || [])
  const [coinTopBuy, setCoinTopBuy]   = useState<ScoredCoin[]>(getCache<ScoredCoin[]>('home:coin:topBuy') || [])
  const [coinTopSell, setCoinTopSell] = useState<ScoredCoin[]>(getCache<ScoredCoin[]>('home:coin:topSell') || [])
  const [academy, setAcademy] = useState<{ title: string; href: string }[]>(getCache<{title:string;href:string}[]>('home:academy') || [])
  const [trades, setTrades] = useState<{ person?: string; ticker?: string; side?: 'BUY'|'SELL'|string; amount?: string|number; price?: string|number|null; date?: string; url?: string; }[]>(getCache<any[]>('home:congress') || [])
  const [scoreErr, setScoreErr] = useState<string | null>(null)
  const [coinErr, setCoinErr] = useState<string | null>(null)
  const [tradesErr, setTradesErr] = useState<string | null>(null)

  // zet loading flags op basis van of we cache hadden
  useEffect(() => {
    setLoadingNewsCrypto(newsCrypto.length === 0)
    setLoadingNewsEq(newsEq.length === 0)
    setLoadingEq(topBuy.length === 0 || topSell.length === 0)
    setLoadingCoin(coinTopBuy.length === 0 || coinTopSell.length === 0)
    setLoadingAcademy(academy.length === 0)
    setLoadingCongress(trades.length === 0)
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

  /* ========= NEWS ========= */
  useEffect(()=>{
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
    load('crypto', setNewsCrypto, setLoadingNewsCrypto)
    load('equities', setNewsEq, setLoadingNewsEq)
    return ()=>{aborted=true}
  },[minuteTag])

  /* =======================
     EQUITIES — Top BUY/SELL
     ======================= */
  const MARKET_ORDER: MarketLabel[] = ['AEX','S&P 500','NASDAQ','Dow Jones','DAX','FTSE 100','Nikkei 225','Hang Seng','Sensex']

  // >>> Sneller: 1 API-call per symbool (gecachete server-score) i.p.v. 4 losse indicator-calls
  async function calcScoreForSymbol(symbol: string, v: number): Promise<number | null> {
    try {
      const r = await fetch(`/api/indicators/score/${encodeURIComponent(symbol)}?v=${v}`, { cache: 'no-store' })
      if (!r.ok) return null
      const j = await r.json() as { score?: number|null }
      if (Number.isFinite(j?.score as number)) return Math.round(Number(j.score))
      return null
    } catch {
      return null
    }
  }

  useEffect(() => {
    let aborted = false
    ;(async () => {
      try {
        setLoadingEq(true)
        setScoreErr(null)

        const outBuy: ScoredEq[] = []
        const outSell: ScoredEq[] = []

        for (const market of MARKET_ORDER) {
          const cons = constituentsForMarket(market)
          if (!cons.length) continue
          const symbols = cons.map(c => c.symbol)

          // Concurrency bewust gematigd i.v.m. API-limits + snellere server-cache
          const scores = await pool(symbols, 4, async (sym) => await calcScoreForSymbol(sym, minuteTag))
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
          setCache('home:eq:topBuy',  finalBuy)
          setCache('home:eq:topSell', finalSell)
        }
      } catch (e: any) {
        if (!aborted) setScoreErr(String(e?.message || e))
      } finally {
        if (!aborted) setLoadingEq(false)
      }
    })()
    return () => { aborted = true }
  }, [minuteTag])

  /* =======================
     CRYPTO — Top 5 BUY/SELL
     ======================= */
  // pairs memo
  const pairs = useMemo(() => {
    return COINS.map(c => ({ c, pair: toBinancePair(c.symbol.replace('-USD','')) }))
      .map(x => ({ ...x, pair: x.pair || toBinancePair(x.c.symbol) }))
      .filter(x => !!x.pair) as { c:{symbol:string; name:string}; pair:string }[]
  }, [])

  useEffect(() => {
    let aborted = false
    ;(async () => {
      try {
        setLoadingCoin(true)
        setCoinErr(null)

        const batchScores = await pool(pairs, 8, async ({ c, pair }) => {
          try {
            const url = `/api/crypto-light/indicators?symbols=${encodeURIComponent(pair)}&v=${minuteTag}`
            const r = await fetch(url, { cache: 'no-store' })
            if (!r.ok) throw new Error(`HTTP ${r.status}`)
            const j = await r.json() as { results?: IndResp[] }
            const ind = (j.results || [])[0]
            const { score } = computeScoreStatus({
              ma: ind?.ma, rsi: ind?.rsi, macd: ind?.macd, volume: ind?.volume
            } as any)
            try { localStorage.setItem(`ta:${pair}`, JSON.stringify({ score, ts: Date.now() })) } catch {}
            return { symbol: c.symbol, name: c.name, score }
          } catch {
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
          setCache('home:coin:topBuy',  buys)
          setCache('home:coin:topSell', sells)
        }
      } catch (e:any) {
        if (!aborted) setCoinErr(String(e?.message || e))
      } finally {
        if (!aborted) setLoadingCoin(false)
      }
    })()
    return () => { aborted = true }
  }, [pairs, minuteTag])

  /* ========= Academy ========= */
  type AcademyItem = { title: string; href: string }
  useEffect(() => {
    let aborted = false
    ;(async () => {
      try {
        setLoadingAcademy(true)
        const r = await fetch('/api/academy/list?v='+minuteTag, { cache: 'no-store' })
        if (r.ok) {
          const j = await r.json() as { items?: AcademyItem[] }
          if (!aborted && Array.isArray(j.items) && j.items.length) {
            const items = j.items.slice(0, 8)
            setAcademy(items)
            setCache('home:academy', items)
            return
          }
        }
      } catch {}
      if (!aborted) {
        const fallback = [
          { title: 'What is RSI? A practical guide', href: '/academy' },
          { title: 'MACD signals explained simply', href: '/academy' },
          { title: 'Position sizing 101', href: '/academy' },
          { title: 'Support & resistance basics', href: '/academy' },
          { title: 'Trend vs. mean reversion', href: '/academy' },
          { title: 'Risk management checklists', href: '/academy' },
          { title: 'How to read volume properly', href: '/academy' },
          { title: 'Backtesting pitfalls to avoid', href: '/academy' },
        ]
        setAcademy(fallback)
        setCache('home:academy', fallback)
      }
    })().finally(() => { if (!aborted) setLoadingAcademy(false) })
    return () => { aborted = true }
  }, [minuteTag])

  /* ========= Congress Trading ========= */
  type CongressTrade = {
    person?: string;
    ticker?: string;
    side?: 'BUY' | 'SELL' | string;
    amount?: string | number;
    price?: string | number | null;
    date?: string;
    url?: string;
  }

  useEffect(() => {
    let aborted = false
    ;(async () => {
      try {
        setLoadingCongress(true)
        setTradesErr(null)
        const r = await fetch('/api/market/congress?limit=30&v='+minuteTag, { cache: 'no-store' })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const j = await r.json() as { items?: any[] }
        const arr = Array.isArray(j?.items) ? j.items : []
        const norm: CongressTrade[] = (arr || []).map((x: any) => ({
          person: x.person || '',
          ticker: x.ticker || '',
          side: String(x.side || '').toUpperCase(),
          amount: x.amount || '',
          price: x.price ?? null,
          date: x.publishedISO || x.tradedISO || '',
          url: x.url || '',
        }))
        if (!aborted) {
          setTrades(norm)
          setCache('home:congress', norm)
        }
      } catch (e: any) {
        if (!aborted) setTradesErr(String(e?.message || e))
      } finally {
        if (!aborted) setLoadingCongress(false)
      }
    })()
    return () => { aborted = true }
  }, [minuteTag])

  /* ---- helpers for news (favicon + decode + source→domain fallback) ---- */
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
        {/* ======= 3×3 GRID ======= */}
        <div className="grid gap-5 lg:grid-cols-3">
          {/* -------- Row 1 -------- */}
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

          {/* -------- Row 2 -------- */}
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
              {tradesErr && <div className="text-[11px] text-rose-300 mb-2">Error: {tradesErr}</div>}

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

          {/* -------- Row 3 -------- */}
          <Card title="Crypto News" actionHref="/crypto" actionLabel="Open crypto →">
            {renderNews(newsCrypto, 'nC', loadingNewsCrypto)}
          </Card>

          <Card title="Equities News" actionHref="/aex" actionLabel="Open AEX →">
            {renderNews(newsEq, 'nE', loadingNewsEq)}
          </Card>

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

// ISR (blijft zoals je had; page zelf gebruikt client fetch + cache)
export async function getStaticProps() {
  return {
    props: {},
    revalidate: 300,
  };
}