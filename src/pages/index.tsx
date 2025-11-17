// src/pages/index.tsx
import Head from 'next/head'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import { mutate } from 'swr'
import useSWR from 'swr'
import { AEX } from '@/lib/aex'
import ScoreBadge from '@/components/ScoreBadge'
import { computeScoreStatus } from '@/lib/taScore'

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
const CRYPTO_BATCH = 15 // ~50 coins → 4 requests

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

type Briefing = { advice: string }
type HomeProps = { snapshot: HomeSnapshot | null; briefing: Briefing | null }

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

/* ======== relative-date helpers ======== */
function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}
function toISORelative(raw?: string | null): string | null {
  if (!raw) return null
  const t = raw.trim().toLowerCase()
  let m = t.match(/(\d+)\s*day(?:s)?\s*ago/)
  if (m) return isoDaysAgo(parseInt(m[1], 10))
  m = t.match(/(\d+)\s*hour(?:s)?\s*ago/)
  if (m) return isoDaysAgo(0)
  if (/\bjust\s*now\b/.test(t) || /\bminute(?:s)?\s*ago\b/.test(t)) return isoDaysAgo(0)
  return null
}
function coerceISO(raw?: string | null): string | null {
  if (!raw) return null
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(raw)) return raw.slice(0, 10)
  const ts = Date.parse(raw)
  if (!Number.isNaN(ts)) return new Date(ts).toISOString().slice(0, 10)
  return null
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
      if (!e.key || !e.key.startsWith('ta:')) return
      setMinuteTag(Math.floor(Date.now() / 60_000))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // loading flags init vanuit snapshot
  const [loadingEq, setLoadingEq] = useState(!(props.snapshot?.topBuy?.length && props.snapshot?.topSell?.length))
  const [loadingCoin, setLoadingCoin] = useState(!(props.snapshot?.coinTopBuy?.length && props.snapshot?.coinTopSell?.length))
  const [loadingNewsCrypto, setLoadingNewsCrypto] = useState(!(props.snapshot?.newsCrypto?.length))
  const [loadingNewsEq, setLoadingNewsEq] = useState(!(props.snapshot?.newsEq?.length))
  const [loadingCongress, setLoadingCongress] = useState(!(props.snapshot?.congress?.length))
  const [loadingAcademy, setLoadingAcademy] = useState(!(props.snapshot?.academy?.length))

  /* ---------- Prefetch routes ---------- */
  useEffect(() => {
    const routes = [
      '/crypto',
      '/aex','/sp500','/nasdaq','/dowjones','/dax','/ftse100','/nikkei225','/hangseng','/sensex','/etfs',
      '/intel','/intel/hedgefunds','/intel/macro','/intel/sectors','/academy','/about'
    ]
    routes.forEach(r => router.prefetch(r).catch(()=>{}))
  }, [router])

  /* ---------- hydrateer met snapshot/cache ---------- */
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
  const [coinErr, setCoinErr] = useState<string | null>(null)
  const [tradesErr, setTradesErr] = useState<string | null>(null)

  // AI briefing state (SSR + client fallback)
  const [briefing, setBriefing] = useState<string>(props.briefing?.advice || '')
  useEffect(() => {
    if (briefing) return
    let aborted = false
    ;(async () => {
      try {
        const r = await fetch('/api/home/briefing', { cache: 'no-store' })
        if (!r.ok) return
        const j = await r.json() as Briefing
        if (!aborted && j?.advice) setBriefing(j.advice)
      } catch {}
    })()
    return () => { aborted = true }
  }, [briefing])

  // flags bijwerken obv cache/snapshot
  useEffect(() => {
    setLoadingNewsCrypto(newsCrypto.length === 0)
    setLoadingNewsEq(newsEq.length === 0)
    setLoadingEq(topBuy.length === 0 || topSell.length === 0)
    setLoadingCoin(coinTopBuy.length === 0 || coinTopSell.length === 0)
    setLoadingAcademy(academy.length === 0)
    setLoadingCongress(trades.length === 0)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- ZACHTE REFRESH: één call naar snapshot (alleen als cache leeg) ---------- */
  useEffect(() => {
    const hasFresh =
      (getCache<ScoredEq[]>('home:eq:topBuy')?.length || 0) > 0 &&
      (getCache<ScoredEq[]>('home:eq:topSell')?.length || 0) > 0
    if (hasFresh) return

    let stop = false
    ;(async () => {
      try {
        const r = await fetch('/api/home/snapshot', { cache: 'no-store' })
        if (!r.ok) return
        const s = await r.json() as HomeSnapshot
        if (stop) return
        setNewsCrypto(s.newsCrypto); setCache('home:news:crypto', s.newsCrypto); setLoadingNewsCrypto(false)
        setNewsEq(s.newsEq);         setCache('home:news:eq',     s.newsEq);     setLoadingNewsEq(false)
        setAcademy(s.academy);       setCache('home:academy',     s.academy);    setLoadingAcademy(false)
        setTrades(s.congress);       setCache('home:congress',    s.congress);   setLoadingCongress(false)
        // equity/crypto berekenen we elders exact
      } catch {}
    })()
    return () => { stop = true }
  }, [])

  /* ---------- NEWS warm-up (SWR prime) ---------- */
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
    prime(`/api/news/google?q=${encodeURIComponent('crypto OR bitcoin OR ethereum OR blockchain')}&${locale}`)
    prime(`/api/news/google?q=${encodeURIComponent('equities OR stocks OR stock market OR aandelen OR beurs')}&${locale}`)
    return () => { aborted = true }
  }, [])

  /* ---------- NEWS fallback (instant) ---------- */
  useEffect(() => {
    if (newsCrypto.length && newsEq.length) { setLoadingNewsCrypto(false); setLoadingNewsEq(false); return }
    let aborted = false

    async function load(topic: 'crypto' | 'equities') {
      const query =
        topic === 'crypto'
          ? 'crypto OR bitcoin OR ethereum OR blockchain'
          : 'equities OR stocks OR stock market OR aandelen OR beurs'
      const locale = 'hl=en-US&gl=US&ceid=US:en'
      const url = `/api/news/google?q=${encodeURIComponent(query)}&${locale}&v=${minuteTag}`
      try {
        topic === 'crypto' ? setLoadingNewsCrypto(true) : setLoadingNewsEq(true)
        const r = await fetch(url, { cache: 'no-store' })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const j = await r.json()
        const arr: NewsItem[] = (j.items || []).slice(0, 6).map((x: any) => ({
          title: x.title || '',
          url: x.link,
          source: x.source || '',
          published: x.pubDate || '',
          image: null,
        }))
        if (aborted) return
        if (topic === 'crypto') { setNewsCrypto(arr); setCache('home:news:crypto', arr); setLoadingNewsCrypto(false) }
        else { setNewsEq(arr); setCache('home:news:eq', arr); setLoadingNewsEq(false) }
      } catch {
        if (aborted) return
        if (topic === 'crypto') { setNewsCrypto([]); setLoadingNewsCrypto(false) }
        else { setNewsEq([]); setLoadingNewsEq(false) }
      }
    }

    if (!newsCrypto.length) load('crypto')
    if (!newsEq.length) load('equities')

    return () => { aborted = true }
  }, [minuteTag]) // eslint-disable-line react-hooks/exhaustive-deps

  /* =======================
     EQUITIES — Exacte scores (zelfde endpoint als aandeel-pagina)
     ======================= */

  const MARKET_ORDER: MarketLabel[] = ['AEX','S&P 500','NASDAQ','Dow Jones','DAX','FTSE 100','Nikkei 225','Hang Seng','Sensex']

  // cache helpers voor individuele scores
  const getScoreCache = (sym: string): number | null => {
    const j = getCache<{ score: number }>(`score:${sym}`)
    return (j && Number.isFinite(j.score)) ? j.score : null
  }
  const setScoreCache = (sym: string, score: number) => setCache(`score:${sym}`, { score })

  async function fetchStrictScore(sym: string, v: number): Promise<number | null> {
    try {
      const r = await fetch(`/api/indicators/score/${encodeURIComponent(sym)}?v=${v}`, { cache: 'no-store' })
      if (!r.ok) return null
      const j = await r.json() as { score?: number|null }
      if (Number.isFinite(j?.score as number)) {
        const s = Math.round(Number(j.score))
        setScoreCache(sym, s)
        return s
      }
      return null
    } catch { return null }
  }

  // Bereken tops/bottoms per markt op basis van exacte scores
  useEffect(() => {
    let aborted = false

    // ⛔ Skip zware client-run ALLEEN als SSR/ISR-snapshot ook écht equities bevat
    if (props.snapshot?.topBuy?.length && props.snapshot?.topSell?.length) {
      return () => { aborted = true }
    }

    if (!topBuy.length || !topSell.length) setLoadingEq(true)

    ;(async () => {
      try {
        const outBuy: ScoredEq[] = []
        const outSell: ScoredEq[] = []

        for (const market of MARKET_ORDER) {
          const cons = constituentsForMarket(market)
          if (!cons.length) continue
          const scores = await pool(cons, 6, async (c) => {
            const cached = getScoreCache(c.symbol)
            if (Number.isFinite(cached)) return { ...c, score: cached as number }
            const s = await fetchStrictScore(c.symbol, minuteTag)
            return { ...c, score: s as any }
          })

          const rows = scores
            .filter(r => Number.isFinite(r.score as number))
            .map(r => ({ symbol: r.symbol, name: r.name, market, score: r.score as number })) as ScoredEq[]

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
          setTopBuy(finalBuy); setTopSell(finalSell)
          setCache('home:eq:topBuy', finalBuy); setCache('home:eq:topSell', finalSell)
        }
      } finally {
        if (!aborted) setLoadingEq(false)
      }
    })()

    return () => { aborted = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minuteTag])

  /* =======================
     CRYPTO — snelle bulk-batches + SSR skip
     ======================= */

  const PAIR_OVERRIDES: Record<string, string> = { 'MKR-USD': 'MKRUSDT', 'VET-USD': 'VETUSDT' }
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
    // ⛔ Als SSR/ISR snapshot al crypto lijsten heeft, niets client-side doen
    if (props.snapshot?.coinTopBuy?.length && props.snapshot?.coinTopSell?.length) {
      setLoadingCoin(false)
      return
    }
    if (!coinTopBuy.length || !coinTopSell.length) setLoadingCoin(true)

    let aborted = false
    type BatchResp = { results?: IndResp[] }

    async function fetchBatch(symbols: string[], v: number): Promise<BatchResp> {
      const url = `/api/crypto-light/indicators?symbols=${encodeURIComponent(symbols.join(','))}&v=${v}`
      const r = await fetch(url, { cache: 'no-store' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return (await r.json()) as BatchResp
    }

    (async () => {
      try {
        setCoinErr(null)
        const syms = pairs.map(p => p.pair)

        // splits in batches van CRYPTO_BATCH
        const batches: string[][] = []
        for (let i = 0; i < syms.length; i += CRYPTO_BATCH) {
          batches.push(syms.slice(i, i + CRYPTO_BATCH))
        }

        // parallel met pool(4); bij lege result probeer lowercase fallback
        const batchResults = await pool(batches, 4, async (chunk) => {
          try {
            const j = await fetchBatch(chunk, minuteTag)
            if (j?.results?.length) return j
            const lower = chunk.map(s => s.toLowerCase())
            if (lower.join(',') !== chunk.join(',')) {
              try { return await fetchBatch(lower, minuteTag) } catch {}
            }
            return { results: [] }
          } catch {
            return { results: [] }
          }
        })

        // map: pair -> score
        const scoreMap = new Map<string, number>()
        for (const br of batchResults) {
          for (const ind of (br.results || [])) {
            const { score } = computeScoreStatus({
              ma: ind?.ma, rsi: ind?.rsi, macd: ind?.macd, volume: ind?.volume
            } as any)
            if (Number.isFinite(score)) {
              const s = Math.round(Number(score))
              scoreMap.set(ind.symbol, s)
              try { localStorage.setItem(`ta:${ind.symbol}`, JSON.stringify({ score: s, ts: Date.now() })) } catch {}
            }
          }
        }

        // fallback naar localStorage voor missende symbolen
        for (const { pair } of pairs) {
          if (scoreMap.has(pair)) continue
          try {
            const raw = localStorage.getItem(`ta:${pair}`)
            if (raw) {
              const jj = JSON.parse(raw) as { score?: number; ts?: number }
              if (Number.isFinite(jj?.score) && (Date.now() - (jj.ts || 0) < TTL_MS)) {
                scoreMap.set(pair, Math.round(Number(jj.score)))
              }
            }
          } catch {}
        }

        // rows met Yahoo symbols (c.symbol)
        const rows = pairs
          .map(({ c, pair }) => {
            const s = scoreMap.get(pair)
            return Number.isFinite(s) ? { symbol: c.symbol, name: c.name, score: s as number } : null
          })
          .filter(Boolean) as { symbol: string; name: string; score: number }[]

        const sortedDesc = [...rows].sort((a,b)=> b.score - a.score)
        const sortedAsc  = [...rows].sort((a,b)=> a.score - b.score)
        const buys  = sortedDesc.slice(0, 5).map(r => ({ ...r, signal: statusFromScore(r.score) }))
        const sells = sortedAsc.slice(0, 5).map(r => ({ ...r, signal: statusFromScore(r.score) }))

        if (!aborted) {
          setCoinTopBuy(buys); setCoinTopSell(sells)
          setCache('home:coin:topBuy',  buys); setCache('home:coin:topSell', sells)
        }
      } catch (e:any) {
        if (!aborted) setCoinErr(String(e?.message || e))
      } finally {
        if (!aborted) setLoadingCoin(false)
      }
    })()

    return () => { aborted = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairs, minuteTag])

  /* ========= Academy (fallback) ========= */
  type AcademyItem = { title: string; href: string }
  useEffect(() => {
    if (academy.length) { setLoadingAcademy(false); return }
    let aborted = false
    ;(async () => {
      try {
        setLoadingAcademy(true)
        const r = await fetch('/api/academy/list?v='+minuteTag, { cache: 'no-store' })
        if (r.ok) {
          const j = await r.json() as { items?: AcademyItem[] }
          if (!aborted && Array.isArray(j.items) && j.items.length) {
            const items = j.items.slice(0, 8)
            setAcademy(items); setCache('home:academy', items); return
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
        setAcademy(fallback); setCache('home:academy', fallback)
      }
    })().finally(() => { if (!aborted) setLoadingAcademy(false) })
    return () => { aborted = true }
  }, [minuteTag]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ========= Congress Trading (fallback) ========= */
  useEffect(() => {
    if (trades.length) { setLoadingCongress(false); return }
    let aborted = false
    ;(async () => {
      try {
        setLoadingCongress(true); setTradesErr(null)
        const r = await fetch('/api/market/congress?limit=30&v='+minuteTag, { cache: 'no-store' })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const j = await r.json() as { items?: any[] }
        const arr = Array.isArray(j?.items) ? j.items : []
        const norm: CongressTrade[] = (arr || []).map((x: any) => {
          const fallbackISO = toISORelative(x.published || x.traded || x.date) || coerceISO(x.published || x.traded || x.date)
          const iso = x.publishedISO || x.tradedISO || fallbackISO || ''
          return { person: x.person || '', ticker: x.ticker || '', side: String(x.side || '').toUpperCase(),
            amount: x.amount || '', price: x.price ?? null, date: iso, url: x.url || '' }
        })
        norm.sort((a,b) => (b.date ? Date.parse(b.date) : 0) - (a.date ? Date.parse(a.date) : 0))
        setTrades(norm); setCache('home:congress', norm)
      } catch (e:any) {
        setTradesErr(String(e?.message || e))
      } finally {
        setLoadingCongress(false)
      }
    })()
    return () => { aborted = true }
  }, [minuteTag]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- helpers for news ---- */
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
        <div className="grid gap-5 lg:grid-cols-3">

          {/* 1) Hero — vervangen door AI briefing */}
          <Card title="Daily AI Briefing">
            <div className={`flex-1 overflow-y-auto ${CARD_CONTENT_H} pr-1`}>
              {briefing ? (
                <BriefingText text={briefing} />
              ) : (
                <div className="text-white/60 text-[13px]">Generating today’s briefing…</div>
              )}
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

          {/* 3) Crypto — Top 5 SELL */}
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
              {loadingEq && topBuy.length===0 ? (
                <li className="py-3 text-white/60 text-[13px]">Loading…</li>
              ) : topBuy.length===0 ? (
                <li className="py-3 text-white/60 text-[13px]">No data…</li>
              ) : topBuy.map((r)=>(
                <li key={`bb-${r.market}-${r.symbol}`}>
                  <Row
                    href={`/stocks/${encodeURIComponent(r.symbol)}`}
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

          {/* 5) Equities — Top SELL */}
          <Card title="Equities — Top SELL" actionHref="/sp500" actionLabel="Browse markets →">
            <ul className={`divide-y divide-white/8 overflow-y-auto ${CARD_CONTENT_H} pr-1`}>
              {loadingEq && topSell.length===0 ? (
                <li className="py-3 text-white/60 text-[13px]">Loading…</li>
              ) : topSell.length===0 ? (
                <li className="py-3 text-white/60 text-[13px]">No data…</li>
              ) : topSell.map((r)=>(
                <li key={`bs-${r.market}-${r.symbol}`}>
                  <Row
                    href={`/stocks/${encodeURIComponent(r.symbol)}`}
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

const BriefingText: React.FC<{ text: string }> = ({ text }) => {
  // Splits de tekst in bullets + één Takeaway regel
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

  const bulletLines: string[] = []
  let takeaway = ''

  for (const line of lines) {
    if (/^takeaway:/i.test(line)) {
      takeaway = line.replace(/^takeaway:\s*/i, '')
    } else {
      // strip eventueel leading bullet characters
      bulletLines.push(line.replace(/^[-•]\s*/, ''))
    }
  }

  return (
    <div className="text-[13px] text-white/90">
      <ul className="space-y-2">
        {bulletLines.map((line, idx) => {
          // Verwacht formaat: **Topic:** rest
          const m = line.match(/^\*{0,2}([^:*]+)\*{0,2}:\s*(.*)$/)
          const topic = m ? m[1].trim() : ''
          const body = m ? m[2].trim() : line

          return (
            <li key={idx} className="flex items-start gap-2">
              {/* rond bulletje */}
              <span className="mt-[6px] inline-block h-1.5 w-1.5 rounded-full bg-white/70" />
              <div>
                {topic && (
                  <span className="font-semibold">{topic}: </span>
                )}
                <span>{body}</span>
              </div>
            </li>
          )
        })}
      </ul>

      {takeaway && (
        <p className="mt-3 text-[12px] text-white/75">
          <span className="font-semibold">Takeaway:</span>{' '}{takeaway}
        </p>
      )}
    </div>
  )
}

export async function getStaticProps() {
  try {
    const base =
      BASE_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')

    const [resSnap, resBrief] = await Promise.all([
      fetch(`${base}/api/home/snapshot`, { cache: 'no-store' }),
      fetch(`${base}/api/home/briefing`, { cache: 'no-store' }),
    ])

    const snapshot = resSnap.ok ? (await resSnap.json() as HomeSnapshot) : null
    const briefing  = resBrief.ok ? (await resBrief.json()  as Briefing)   : null

    return { props: { snapshot, briefing }, revalidate: 300 }
  } catch {
    return { props: { snapshot: null, briefing: null }, revalidate: 300 }
  }
}