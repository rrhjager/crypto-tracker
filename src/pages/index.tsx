// src/pages/index.tsx
import Head from 'next/head'
import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import { mutate } from 'swr'
import { AEX } from '@/lib/aex'

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

// Screener API types (match /api/screener/top-signals)
type MarketLabel =
  | 'AEX' | 'S&P 500' | 'NASDAQ' | 'Dow Jones'
  | 'DAX' | 'FTSE 100' | 'Nikkei 225' | 'Hang Seng' | 'Sensex'
type Signal = 'BUY' | 'HOLD' | 'SELL'
type Scored = { symbol: string; name: string; market: MarketLabel; score: number; signal: Signal }
type ScreenerResp = { markets: Array<{ market: MarketLabel; topBuy: Scored | null; topSell: Scored | null }> }

/* ---------------- utils ---------------- */
const num = (v: number | null | undefined, d = 0) =>
  (v ?? v === 0) && Number.isFinite(v as number) ? (v as number).toFixed(d) : '—'

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
      `/api/screener/top-signals`,
    ].forEach(prime)
    return () => { aborted = true }
  }, [])

  /* =======================
     EQUITIES — Top BUY/SELL (scores identiek aan detailpagina’s)
     ======================= */
  const MARKET_ORDER: MarketLabel[] = ['AEX','S&P 500','NASDAQ','Dow Jones','DAX','FTSE 100','Nikkei 225','Hang Seng','Sensex']

  const [topBuy, setTopBuy]   = useState<Scored[]>([])
  const [topSell, setTopSell] = useState<Scored[]>([])
  const [screenErr, setScreenErr] = useState<string | null>(null)

  useEffect(() => {
    let aborted = false
    ;(async () => {
      try {
        setScreenErr(null)
        const r = await fetch(`/api/screener/top-signals`, { cache: 'no-store' })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const j: ScreenerResp = await r.json()
        const order = (m: MarketLabel) => MARKET_ORDER.indexOf(m)

        const buys = (j.markets || [])
          .map(x => x.topBuy)
          .filter(Boolean) as Scored[]

        const sells = (j.markets || [])
          .map(x => x.topSell)
          .filter(Boolean) as Scored[]

        if (!aborted) {
          setTopBuy(buys.sort((a,b)=> order(a.market)-order(b.market)))
          setTopSell(sells.sort((a,b)=> order(a.market)-order(b.market)))
        }
      } catch (e: any) {
        if (!aborted) setScreenErr(String(e?.message || e))
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

  /* -------- AEX polling (bestaand) -------- */
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
              <p>
                <strong>SignalHub is where complexity turns into clarity.</strong> By combining carefully selected
                indicators across both crypto and global equities, we deliver a complete market overview that
                cuts through the noise. Every asset is distilled into a clear stoplight signal: BUY, HOLD, or SELL,
                backed by momentum, volume, sentiment, and market insights.
              </p>
              <p>
                Our platform doesn’t just track prices; it highlights what truly matters. From insider trading
                activity in U.S. Congress to market breadth and volatility regimes, SignalHub equips you with the
                context to make smarter portfolio decisions.
              </p>
              <p>
                Already trusted by thousands of investors, SignalHub is the go-to platform for anyone seeking
                sharper insights, faster decisions, and a more confident investment journey.
              </p>
              <p>
                <em>Clarity, confidence, and control. All in one clear buy, hold or sell overview.</em>
              </p>
            </div>
          </div>

          {/* hero */}
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

        {/* line */}
        <div className="mt-8 h-px bg-white/10" />
      </section>

      {/* EQUITIES — Highest BUY (left) & Lowest/strongest SELL (right) — SAME scoring as detail pages */}
      <section className="max-w-6xl mx-auto px-4 pb-10 grid md:grid-cols-2 gap-4">
        {/* BUY */}
        <div className="table-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Equities — Top BUY (by Signal Score)</h2>
            {screenErr && <span className="text-xs text-red-300">Error: {screenErr}</span>}
          </div>
          <ul className="divide-y divide-white/10">
            {topBuy.length===0 ? (
              <li className="py-3 text-white/60">No data yet…</li>
            ) : topBuy.map((r,i)=>(
              <li key={`bb${r.market}-${r.symbol}`} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-white/60 text-xs mb-0.5">{r.market}</div>
                  <div className="font-medium truncate">
                    {r.name} <span className="text-white/60 font-normal">({r.symbol})</span>
                  </div>
                </div>
                <div className="shrink-0 text-sm font-semibold text-green-300 whitespace-nowrap">
                  {r.signal} · {num(r.score, 0)}
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* SELL */}
        <div className="table-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Equities — Top SELL (by Signal Score)</h2>
            {screenErr && <span className="text-xs text-red-300">Error: {screenErr}</span>}
          </div>
          <ul className="divide-y divide-white/10">
            {topSell.length===0 ? (
              <li className="py-3 text-white/60">No data yet…</li>
            ) : topSell.map((r,i)=>(
              <li key={`bs${r.market}-${r.symbol}`} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-white/60 text-xs mb-0.5">{r.market}</div>
                  <div className="font-medium truncate">
                    {r.name} <span className="text-white/60 font-normal">({r.symbol})</span>
                  </div>
                </div>
                <div className="shrink-0 text-sm font-semibold text-red-300 whitespace-nowrap">
                  {r.signal} · {num(r.score, 0)}
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