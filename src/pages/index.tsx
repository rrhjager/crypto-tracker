// src/pages/index.tsx
import Head from 'next/head'
import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import { mutate } from 'swr'
import { AEX } from '@/lib/aex'
import ScoreBadge from '@/components/ScoreBadge'  // ⬅️ use the same badge as list/detail pages

/* ---------------- config ---------------- */
const HERO_IMG = '/images/hero-crypto-tracker.png'

/* ---------------- types ---------------- */
type Quote = {
  symbol: string
  regularMarketPrice: number | null
  regularMarketChange: number | null
  regularMarketChangePercent: number | null
  currency?: string
}

type CryptoRow = { symbol: string; name?: string; pct?: number }

type NewsItem = {
  title: string
  url: string
  source?: string
  published?: string
  image?: string | null
}

type Advice = 'BUY' | 'HOLD' | 'SELL'
type MaCrossResp = { symbol: string; ma50: number | null; ma200: number | null; status: Advice; points: number | null }
type RsiResp    = { symbol: string; period: number; rsi: number | null; status: Advice; points: number | null }
type MacdResp   = { symbol: string; fast: number; slow: number; signalPeriod: number; macd: number | null; signal: number | null; hist: number | null; status: Advice; points: number | null }
type Vol20Resp  = { symbol: string; period: number; volume: number | null; avg20: number | null; ratio: number | null; status: Advice; points: number | null }

type MarketLabel =
  | 'AEX' | 'S&P 500' | 'NASDAQ' | 'Dow Jones'
  | 'DAX' | 'FTSE 100' | 'Nikkei 225' | 'Hang Seng' | 'Sensex'

type Scored = { symbol: string; name: string; market: MarketLabel; score: number; signal: Advice }

/* ---------------- utils ---------------- */
const num = (v: number | null | undefined, d = 0) =>
  (v ?? v === 0) && Number.isFinite(v as number) ? (v as number).toFixed(d) : '—'

function statusFromScore(score: number): Advice {
  if (score >= 66) return 'BUY'
  if (score <= 33) return 'SELL'
  return 'HOLD'
}

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/* ---- EXACT same aggregation as detail pages ---- */
async function calcScoreForSymbol(symbol: string): Promise<number | null> {
  try {
    const [rMa, rRsi, rMacd, rVol] = await Promise.all([
      fetch(`/api/indicators/ma-cross/${encodeURIComponent(symbol)}`, { cache: 'no-store' }),
      fetch(`/api/indicators/rsi/${encodeURIComponent(symbol)}?period=14`, { cache: 'no-store' }),
      fetch(`/api/indicators/macd/${encodeURIComponent(symbol)}?fast=12&slow=26&signal=9`, { cache: 'no-store' }),
      fetch(`/api/indicators/vol20/${encodeURIComponent(symbol)}?period=20`, { cache: 'no-store' }),
    ])
    if (!(rMa.ok && rRsi.ok && rMacd.ok && rVol.ok)) return null

    const [ma, rsi, macd, vol] = await Promise.all([
      rMa.json(), rRsi.json(), rMacd.json(), rVol.json()
    ]) as [MaCrossResp, RsiResp, MacdResp, Vol20Resp]

    const toPts = (status?: Advice, pts?: number | null) => {
      if (Number.isFinite(pts as number)) return clamp(Number(pts), -2, 2)
      if (status === 'BUY') return 2
      if (status === 'SELL') return -2
      return 0
    }

    const W_MA = 0.40, W_MACD = 0.30, W_RSI = 0.20, W_VOL = 0.10
    const pMA   = toPts(ma?.status,   ma?.points)
    const pMACD = toPts(macd?.status, macd?.points)
    const pRSI  = toPts(rsi?.status,  rsi?.points)
    const pVOL  = toPts(vol?.status,  vol?.points)

    const nMA   = (pMA   + 2) / 4
    const nMACD = (pMACD + 2) / 4
    const nRSI  = (pRSI  + 2) / 4
    const nVOL  = (pVOL  + 2) / 4

    const agg = W_MA*nMA + W_MACD*nMACD + W_RSI*nRSI + W_VOL*nVOL
    const pct = clamp(Math.round(agg * 100), 0, 100)
    return pct
  } catch {
    return null
  }
}

/* pool helper */
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

/* ---------------- simple constituents per index ---------------- */
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

/* ---------------- page ---------------- */
export default function Homepage() {
  const router = useRouter()

  // Prefetch
  useEffect(() => {
    router.prefetch('/stocks').catch(()=>{})
    router.prefetch('/index').catch(()=>{})
  }, [router])

  // SWR warm-up
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
      '/api/coin/top-movers',
      `/api/news/google?q=crypto&${locale}`,
      `/api/news/google?q=equities&${locale}`,
    ].forEach(prime)
    return () => { aborted = true }
  }, [])

  /* =======================
     EQUITIES — Top BUY/SELL (identical scoring)
     ======================= */
  const MARKET_ORDER: MarketLabel[] = ['AEX','S&P 500','NASDAQ','Dow Jones','DAX','FTSE 100','Nikkei 225','Hang Seng','Sensex']
  const [topBuy, setTopBuy]   = useState<Scored[]>([])
  const [topSell, setTopSell] = useState<Scored[]>([])
  const [scoreErr, setScoreErr] = useState<string | null>(null)

  useEffect(() => {
    let aborted = false
    ;(async () => {
      try {
        setScoreErr(null)
        const outBuy: Scored[] = []
        const outSell: Scored[] = []

        for (const market of MARKET_ORDER) {
          const cons = constituentsForMarket(market)
          if (!cons.length) continue
          const symbols = cons.map(c => c.symbol)

          const scores = await pool(symbols, 4, async (sym, idx) => {
            if (idx) await sleep(60)
            return await calcScoreForSymbol(sym)
          })

          const rows = cons.map((c, i) => ({
            symbol: c.symbol, name: c.name, market, score: scores[i] ?? (null as any)
          })).filter(r => Number.isFinite(r.score as number)) as Array<Scored>

          if (rows.length) {
            const top = [...rows].sort((a,b)=> b.score - a.score)[0]
            const bot = [...rows].sort((a,b)=> a.score - b.score)[0]
            if (top) outBuy.push({ ...top, signal: statusFromScore(top.score) })
            if (bot) outSell.push({ ...bot, signal: statusFromScore(bot.score) })
          }
        }

        if (!aborted) {
          const order = (m: MarketLabel) => MARKET_ORDER.indexOf(m)
          setTopBuy(outBuy.sort((a,b)=> order(a.market)-order(b.market)))
          setTopSell(outSell.sort((a,b)=> order(a.market)-order(b.market)))
        }
      } catch (e: any) {
        if (!aborted) setScoreErr(String(e?.message || e))
      }
    })()
    return () => { aborted = true }
  }, [])

  /* -------- Crypto movers -------- */
  const [cryptoMovers, setCryptoMovers] = useState<{gainers:CryptoRow[]; losers:CryptoRow[]}>({gainers:[], losers:[]})
  useEffect(()=>{
    let aborted=false
    ;(async()=>{
      try{
        const r = await fetch('/api/coin/top-movers', { cache:'no-store' })
        if (!r.ok) return
        const j = await r.json()
        const gainers = (j.gainers || []).slice(0,5).map((x:any)=>({ symbol:x.symbol, name:x.name, pct: Number(x.pct) }))
        const losers  = (j.losers  || []).slice(0,5).map((x:any)=>({ symbol:x.symbol, name:x.name, pct: Number(x.pct) }))
        if (!aborted) setCryptoMovers({ gainers, losers })
      }catch{}
    })()
    return ()=>{aborted=true}
  },[])

  /* -------- News -------- */
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

  /* -------- AEX polling (existing) -------- */
  const symbols = useMemo(()=> AEX.map(a=>a.symbol), [])
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})
  useEffect(() => {
    let timer:any, aborted=false
    async function load() {
      try {
        const url = `/api/quotes?symbols=${encodeURIComponent(symbols.join(','))}`
        const r = await fetch(url, { cache:'no-store' })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const j: { quotes: Record<string, Quote> } = await r.json()
        if (!aborted) setQuotes(j.quotes || {})
      } catch {} finally {
        if (!aborted) timer = setTimeout(load, 20000)
      }
    }
    load()
    return ()=> { aborted=true; if (timer) clearTimeout(timer) }
  }, [symbols])

  /* ---------------- render ---------------- */
  return (
    <>
      <Head>
        <title>SignalHub — Clarity in Markets</title>
        <meta name="description" content="Real-time BUY / HOLD / SELL signals across crypto and global equities — all in one stoplight view." />
        <link rel="preconnect" href="https://query2.finance.yahoo.com" crossOrigin="" />
        <link rel="preconnect" href="https://api.coingecko.com" crossOrigin="" />
      </Head>

      {/* WHY SIGNALHUB */}
      <section className="max-w-6xl mx-auto px-4 pt-16 pb-8">
        <div className="grid md:grid-cols-2 gap-8 items-center">
          <div>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-white">Why SignalHub?</h1>
            <div className="text-white/80 mt-3 space-y-4">
              <p><strong>SignalHub is where complexity turns into clarity.</strong> …</p>
              <p>Our platform doesn’t just track prices; it highlights what truly matters…</p>
              <p>Already trusted by thousands of investors…</p>
              <p><em>Clarity, confidence, and control…</em></p>
            </div>
          </div>
          <div className="table-card overflow-hidden">
            <Image src={HERO_IMG} alt="Crypto Tracker — SignalHub" width={1280} height={960} priority unoptimized className="w-full h-auto" />
          </div>
        </div>
        <div className="mt-8 h-px bg-white/10" />
      </section>

      {/* EQUITIES — Top BUY/SELL with the same badge UI */}
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
                    {r.name} <span className="text-white/60 font-normal">({r.symbol})</span>
                  </div>
                </div>
                <div className="shrink-0 origin-right scale-90 sm:scale-100">
                  <ScoreBadge score={r.score} />
                </div>
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
                    {r.name} <span className="text-white/60 font-normal">({r.symbol})</span>
                  </div>
                </div>
                <div className="shrink-0 origin-right scale-90 sm:scale-100">
                  <ScoreBadge score={r.score} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* BIGGEST CRYPTO MOVERS */}
      <section className="max-w-6xl mx-auto px-4 pb-10 grid md:grid-cols-2 gap-4">
        <div className="table-card p-5">
          <h2 className="text-lg font-semibold mb-3">Crypto — Biggest Gainers</h2>
          <ul className="divide-y divide-white/10">
            {cryptoMovers.gainers.length===0 ? (
              <li className="py-3 text-white/60">Geen data…</li>
            ) : cryptoMovers.gainers.map((m,i)=>(
              <li key={`cg${i}`} className="py-2 flex items-center justify-between gap-3">
                <div className="truncate">
                  <div className="font-medium truncate">{m.name || m.symbol}</div>
                  <div className="text-white/60 text-xs">{m.symbol}</div>
                </div>
                <div className="text-green-300 text-sm font-medium">
                  {num(m.pct ?? null, 2)}%
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 text-sm">
            <Link href="/index" className="text-white/70 hover:text-white">Open crypto →</Link>
          </div>
        </div>

        <div className="table-card p-5">
          <h2 className="text-lg font-semibold mb-3">Crypto — Biggest Losers</h2>
          <ul className="divide-y divide-white/10">
            {cryptoMovers.losers.length===0 ? (
              <li className="py-3 text-white/60">Geen data…</li>
            ) : cryptoMovers.losers.map((m,i)=>(
              <li key={`cl${i}`} className="py-2 flex items-center justify-between gap-3">
                <div className="truncate">
                  <div className="font-medium truncate">{m.name || m.symbol}</div>
                  <div className="text-white/60 text-xs">{m.symbol}</div>
                </div>
                <div className="text-red-300 text-sm font-medium">
                  {num(m.pct ?? null, 2)}%
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 text-sm">
            <Link href="/index" className="text-white/70 hover:text-white">Open crypto →</Link>
          </div>
        </div>
      </section>

      {/* NEWS */}
      <section className="max-w-6xl mx-auto px-4 pb-16 grid md:grid-cols-2 gap-4">
        <div className="table-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Crypto News</h2>
            <Link href="/index" className="text-sm text-white/70 hover:text-white">Open crypto →</Link>
          </div>
          <ul className="grid gap-2">
            {newsCrypto.length===0 ? <li className="text-white/60">No news…</li> :
              newsCrypto.map((n,i)=>(
                <li key={i} className="leading-tight">
                  <a href={n.url} target="_blank" rel="noreferrer" className="hover:underline">
                    {n.title}
                  </a>
                  <div className="text-xs text-white/60 mt-0.5">
                    {n.source || ''}{n.published ? ` • ${n.published}` : ''}
                  </div>
                </li>
              ))
            }
          </ul>
        </div>

        <div className="table-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Equities News</h2>
            <Link href="/stocks" className="text-sm text-white/70 hover:text-white">Open AEX →</Link>
          </div>
          <ul className="grid gap-2">
            {newsEq.length===0 ? <li className="text-white/60">No news…</li> :
              newsEq.map((n,i)=>(
                <li key={i} className="leading-tight">
                  <a href={n.url} target="_blank" rel="noreferrer" className="hover:underline">
                    {n.title}
                  </a>
                  <div className="text-xs text-white/60 mt-0.5">
                    {n.source || ''}{n.published ? ` • ${n.published}` : ''}
                  </div>
                </li>
              ))
            }
          </ul>
        </div>
      </section>
    </>
  )
}