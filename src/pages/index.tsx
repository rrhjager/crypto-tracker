// src/pages/index.tsx
import Head from 'next/head'
import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import { mutate } from 'swr'
import { AEX } from '@/lib/aex'

/* ---------------- config (hero image in /public/images) ---------------- */
const HERO_IMG = '/images/hero-crypto-tracker.png' // <- correct pad nu het bestand in /public/images staat

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

// Multi-market types
type EquityCon = { symbol: string; name: string; market: string }
type EquityPick = { symbol: string; name: string; market: string; pct: number }

/* ---------------- utils ---------------- */
const num = (v: number | null | undefined, d = 2) =>
  (v ?? v === 0) && Number.isFinite(v as number) ? (v as number).toFixed(d) : '—'

function classNames(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(' ')
}

/** 🆕 Fallback voor %: gebruik change% als die er is, anders bereken uit change en price. */
function pctFromQuote(q?: Quote): number | null {
  if (!q) return null
  const pct = Number(q.regularMarketChangePercent)
  if (Number.isFinite(pct)) return pct
  const chg = Number(q.regularMarketChange)
  const price = Number(q.regularMarketPrice)
  if (Number.isFinite(chg) && Number.isFinite(price)) {
    const prev = price - chg
    if (prev !== 0 && Number.isFinite(prev)) {
      return (chg / prev) * 100
    }
  }
  return null
}

/* ---------------- static fallbacks per index ---------------- */
const STATIC_CONS: Record<string, { symbol: string; name: string }[]> = {
  'AEX': [],
  'S&P 500': [
    { symbol: 'AAPL',  name: 'Apple' },
    { symbol: 'MSFT',  name: 'Microsoft' },
    { symbol: 'NVDA',  name: 'NVIDIA' },
    { symbol: 'AMZN',  name: 'Amazon' },
    { symbol: 'META',  name: 'Meta Platforms' },
  ],
  'NASDAQ': [
    { symbol: 'GOOGL', name: 'Alphabet' },
    { symbol: 'TSLA',  name: 'Tesla' },
    { symbol: 'AVGO',  name: 'Broadcom' },
    { symbol: 'AMD',   name: 'Advanced Micro Devices' },
    { symbol: 'ADBE',  name: 'Adobe' },
  ],
  'Dow Jones': [
    { symbol: 'UNH', name: 'UnitedHealth' },
    { symbol: 'JPM', name: 'JPMorgan Chase' },
    { symbol: 'MRK', name: 'Merck' },
    { symbol: 'V',   name: 'Visa' },
    { symbol: 'PG',  name: 'Procter & Gamble' },
  ],
  'DAX': [
    { symbol: 'SAP.DE',  name: 'SAP' },
    { symbol: 'SIE.DE',  name: 'Siemens' },
    { symbol: 'MBG.DE',  name: 'Mercedes-Benz Group' },
    { symbol: 'BAS.DE',  name: 'BASF' },
    { symbol: 'BMW.DE',  name: 'BMW' },
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

function constituentsForMarket(label: string): EquityCon[] {
  if (label === 'AEX') {
    return AEX.map(x => ({ symbol: x.symbol, name: x.name, market: 'AEX' }))
  }
  const rows = STATIC_CONS[label] || []
  return rows.map(r => ({ ...r, market: label }))
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
    // 🆕 Forceer US-EN nieuws via query params
    const locale = 'hl=en-US&gl=US&ceid=US:en'
    ;[
      '/api/coin/top-movers',
      `/api/news/google?q=crypto&${locale}`,
      `/api/news/google?q=equities&${locale}`,
    ].forEach(prime)
    return () => { aborted = true }
  }, [])

  /* =======================
     EQUITIES — per beurs BEST BUY/SELL (via grootste % dagstijger/daler)
     ======================= */
  const MARKET_ORDER = ['AEX','S&P 500','NASDAQ','Dow Jones','DAX','FTSE 100','Nikkei 225','Hang Seng','Sensex'] as const

  const [bestBuyPerMarket, setBestBuyPerMarket]   = useState<EquityPick[]>([])
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
            const pct = pctFromQuote(q)