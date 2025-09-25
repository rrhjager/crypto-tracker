// src/pages/index.tsx
import Head from 'next/head'
import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import { mutate } from 'swr'
import { AEX } from '@/lib/aex'

const HERO_IMG = '/images/hero-crypto-tracker.png'

type Quote = {
  symbol: string
  regularMarketPrice: number | null
  regularMarketChange: number | null
  regularMarketChangePercent: number | null
  currency?: string
}

type CryptoRow = { symbol: string; name?: string; pct?: number }
type NewsItem = { title: string; url: string; source?: string; published?: string; image?: string | null }
type EquityCon = { symbol: string; name: string; market: string }
type EquityPick = { symbol: string; name: string; market: string; pct: number }

const num = (v: number | null | undefined, d = 2) =>
  (v ?? v === 0) && Number.isFinite(v as number) ? (v as number).toFixed(d) : '—'

const STATIC_CONS: Record<string, { symbol: string; name: string }[]> = {
  'AEX': [],
  'S&P 500': [
    { symbol: 'AAPL', name: 'Apple' },
    { symbol: 'MSFT', name: 'Microsoft' },
    { symbol: 'NVDA', name: 'NVIDIA' },
    { symbol: 'AMZN', name: 'Amazon' },
    { symbol: 'META', name: 'Meta Platforms' },
  ],
  'NASDAQ': [
    { symbol: 'GOOGL', name: 'Alphabet' },
    { symbol: 'TSLA', name: 'Tesla' },
    { symbol: 'AVGO', name: 'Broadcom' },
    { symbol: 'AMD', name: 'Advanced Micro Devices' },
    { symbol: 'ADBE', name: 'Adobe' },
  ],
  'Dow Jones': [
    { symbol: 'UNH', name: 'UnitedHealth' },
    { symbol: 'JPM', name: 'JPMorgan Chase' },
    { symbol: 'MRK', name: 'Merck' },
    { symbol: 'V', name: 'Visa' },
    { symbol: 'PG', name: 'Procter & Gamble' },
  ],
  'DAX': [
    { symbol: 'SAP.DE', name: 'SAP' },
    { symbol: 'SIE.DE', name: 'Siemens' },
    { symbol: 'MBG.DE', name: 'Mercedes-Benz Group' },
    { symbol: 'BAS.DE', name: 'BASF' },
    { symbol: 'BMW.DE', name: 'BMW' },
  ],
  'FTSE 100': [
    { symbol: 'AZN.L', name: 'AstraZeneca' },
    { symbol: 'SHEL.L', name: 'Shell' },
    { symbol: 'HSBA.L', name: 'HSBC' },
    { symbol: 'ULVR.L', name: 'Unilever' },
    { symbol: 'BATS.L', name: 'BAT' },
  ],
  'Nikkei 225': [
    { symbol: '7203.T', name: 'Toyota' },
    { symbol: '6758.T', name: 'Sony' },
    { symbol: '9984.T', name: 'SoftBank Group' },
    { symbol: '8035.T', name: 'Tokyo Electron' },
    { symbol: '4063.T', name: 'Shin-Etsu Chemical' },
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
    { symbol: 'TCS.NS', name: 'TCS' },
    { symbol: 'HDFCBANK.NS', name: 'HDFC Bank' },
    { symbol: 'INFY.NS', name: 'Infosys' },
    { symbol: 'ICICIBANK.NS', name: 'ICICI Bank' },
  ],
}

function constituentsForMarket(label: string): EquityCon[] {
  if (label === 'AEX') {
    return AEX.map(x => ({ symbol: x.symbol, name: x.name, market: 'AEX' }))
  }
  const rows = STATIC_CONS[label] || []
  return rows.map(r => ({ ...r, market: label }))
}

export default function Homepage() {
  const router = useRouter()

  useEffect(() => {
    router.prefetch('/stocks').catch(() => {})
    router.prefetch('/crypto').catch(() => {})
  }, [router])

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
    ;['/api/coin/top-movers', '/api/news/google?topic=crypto', '/api/news/google?topic=equities'].forEach(prime)
    return () => {
      aborted = true
    }
  }, [])

  const MARKET_ORDER = ['AEX','S&P 500','NASDAQ','Dow Jones','DAX','FTSE 100','Nikkei 225','Hang Seng','Sensex'] as const
  const [bestBuyPerMarket, setBestBuyPerMarket] = useState<EquityPick[]>([])
  const [bestSellPerMarket, setBestSellPerMarket] = useState<EquityPick[]>([])

  useEffect(() => {
    let aborted = false
    ;(async () => {
      const buys: EquityPick[] = []
      const sells: EquityPick[] = []
      for (const label of MARKET_ORDER) {
        const cons = constituentsForMarket(label)
        if (!cons.length) continue
        const symbols = cons.map(c => c.symbol).join(',')
        try {
          const r = await fetch(`/api/quotes?symbols=${encodeURIComponent(symbols)}`, { cache: 'no-store' })
          if (!r.ok) continue
          const j: { quotes: Record<string, Quote> } = await r.json()
          const arr = cons.map(c => {
            const q = j.quotes?.[c.symbol]
            const pct = Number(q?.regularMarketChangePercent)
            return { ...c, pct: Number.isFinite(pct) ? pct : NaN }
          }).filter(x => Number.isFinite(x.pct))
          if (!arr.length) continue
          const top = [...arr].sort((a,b)=> b.pct - a.pct)[0]
          const bot = [...arr].sort((a,b)=> a.pct - b.pct)[0]
          if (top) buys.push({ ...top })
          if (bot) sells.push({ ...bot })
        } catch {}
      }
      if (!aborted) {
        const orderIndex = (m:string)=> MARKET_ORDER.indexOf(m as any)
        setBestBuyPerMarket(buys.sort((a,b)=> orderIndex(a.market)-orderIndex(b.market)))
        setBestSellPerMarket(sells.sort((a,b)=> orderIndex(a.market)-orderIndex(b.market)))
      }
    })()
    return () => { aborted = true }
  }, [])

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

  const [newsCrypto, setNewsCrypto] = useState<NewsItem[]>([])
  const [newsEq, setNewsEq] = useState<NewsItem[]>([])
  useEffect(()=>{
    let aborted=false
    async function load(topic: 'crypto'|'equities', setter:(x:NewsItem[])=>void){
      try{
        const r = await fetch(`/api/news/google?topic=${topic}`, { cache:'no-store' })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const j = await r.json()
        const arr:NewsItem[] = (j.items || []).slice(0,6).map((x:any)=>({
          title: x.title || x.headline || '',
          url: x.url || x.link,
          source: x.source || x.publisher || '',
          published: x.published || x.time || x.date || '',
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
              <p><strong>SignalHub is where complexity turns into clarity.</strong> ...</p>
            </div>
          </div>
          <div className="table-card overflow-hidden">
            <Image src={HERO_IMG} alt="Crypto Tracker — SignalHub" width={1280} height={960} priority unoptimized className="w-full h-auto"/>
          </div>
        </div>
        <div className="mt-8 h-px bg-white/10" />
      </section>

      {/* EQUITIES */}
      <section className="max-w-6xl mx-auto px-4 pb-10 grid md:grid-cols-2 gap-4">
        <div className="table-card p-5">
          <h2 className="text-lg font-semibold mb-3">Equities — Top BUY</h2>
          ...
        </div>
        <div className="table-card p-5">
          <h2 className="text-lg font-semibold mb-3">Equities — Top SELL</h2>
          <ul className="divide-y divide-white/10">
            {bestSellPerMarket.length===0 ? (
              <li className="py-3 text-white/60">Nog geen data…</li>
            ) : bestSellPerMarket.map((r,i)=>(
              <li key={`bs${i}`} className="py-2 flex items-center justify-between gap-3"> {/* ✅ typo gefixt */}
                <div className="min-w-0">
                  <div className="text-white/60 text-xs mb-0.5">{r.market}</div>
                  <div className="font-medium truncate">
                    {r.name} <span className="text-white/60 font-normal">({r.symbol})</span> {/* ✅ typo gefixt */}
                  </div>
                </div>
                <div className="shrink-0 text-sm font-medium text-red-300 whitespace-nowrap">
                  {num(r.pct, 2)}%
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
          ...
          <div className="mt-3 text-sm">
            <Link href="/crypto" className="text-white/70 hover:text-white">Open crypto →</Link>
          </div>
        </div>
        <div className="table-card p-5">
          <h2 className="text-lg font-semibold mb-3">Crypto — Biggest Losers</h2>
          ...
          <div className="mt-3 text-sm">
            <Link href="/crypto" className="text-white/70 hover:text-white">Open crypto →</Link> {/* ✅ typo gefixt */}
          </div>
        </div>
      </section>

      {/* NEWS */}
      <section className="max-w-6xl mx-auto px-4 pb-16 grid md:grid-cols-2 gap-4">
        <div className="table-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Crypto News</h2>
            <Link href="/crypto" className="text-sm text-white/70 hover:text-white">Open crypto →</Link>
          </div>
          ...
        </div>
      </section>
    </>
  )
}