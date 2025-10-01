// src/pages/index.tsx
import Head from 'next/head'
import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import { mutate } from 'swr'

// === lists per market
import { AEX } from '@/lib/aex'
import { SP500 } from '@/lib/sp500'
import { NASDAQ100 } from '@/lib/nasdaq'
import { DOWJONES } from '@/lib/dowjones'
import { DAX } from '@/lib/dax'
import { FTSE100 } from '@/lib/ftse100'
import { NIKKEI225 } from '@/lib/nikkei225'
import { HANGSENG } from '@/lib/hangseng'
import { SENSEX } from '@/lib/sensex'

// === SAME scoring as detail pages
import { combineScores, statusFromScore, type Advice } from '@/lib/scoring'

/* ---------------- config ---------------- */
const HERO_IMG = '/images/hero-crypto-tracker.png'

/* ---------------- small types (existing) ---------------- */
type Quote = {
  symbol: string
  regularMarketPrice: number | null
  regularMarketChange: number | null
  regularMarketChangePercent: number | null
  currency?: string
}
type CryptoRow = { symbol: string; name?: string; pct?: number }
type NewsItem = { title: string; url: string; source?: string; published?: string; image?: string | null }

/* ---------------- helper utils ---------------- */
const num = (v: number | null | undefined, d = 2) =>
  (v ?? v === 0) && Number.isFinite(v as number) ? (v as number).toFixed(d) : '—'

/* ---------------- market config ---------------- */
type MarketLabel =
  | 'AEX' | 'S&P 500' | 'NASDAQ' | 'Dow Jones'
  | 'DAX' | 'FTSE 100' | 'Nikkei 225' | 'Hang Seng' | 'Sensex'

type StockMeta = { symbol: string; name: string }
const MARKETS: { label: MarketLabel; list: StockMeta[]; basePath: string }[] = [
  { label: 'AEX',        list: AEX,        basePath: '/stocks' },     // your AEX page
  { label: 'S&P 500',    list: SP500,      basePath: '/sp500' },
  { label: 'NASDAQ',     list: NASDAQ100,  basePath: '/nasdaq' },
  { label: 'Dow Jones',  list: DOWJONES,   basePath: '/dow' },
  { label: 'DAX',        list: DAX,        basePath: '/dax' },
  { label: 'FTSE 100',   list: FTSE100,    basePath: '/ftse' },
  { label: 'Nikkei 225', list: NIKKEI225,  basePath: '/nikkei' },
  { label: 'Hang Seng',  list: HANGSENG,   basePath: '/hangseng' },
  { label: 'Sensex',     list: SENSEX,     basePath: '/sensex' },
]

/* ---------------- indicator API response types (same as detail pages) ---------------- */
type MaCrossResp = { symbol: string; ma50: number | null; ma200: number | null; status: Advice; points: number | null }
type RsiResp    = { symbol: string; period: number; rsi: number | null; status: Advice; points: number | null }
type MacdResp   = { symbol: string; fast: number; slow: number; signalPeriod: number; macd: number | null; signal: number | null; hist: number | null; status: Advice; points: number | null }
type Vol20Resp  = { symbol: string; period: number; volume: number | null; avg20: number | null; ratio: number | null; status: Advice; points: number | null }

type ScoredRow = {
  symbol: string
  name: string
  market: MarketLabel
  score: number     // 0..100 (combineScores)
  signal: Advice    // derived via statusFromScore(score)
}

/* ---------------- small helpers ---------------- */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function fetchScoreForSymbol(sym: string): Promise<number | null> {
  try {
    const [rMa, rRsi, rMacd, rVol] = await Promise.all([
      fetch(`/api/indicators/ma-cross/${encodeURIComponent(sym)}`,                  { cache: 'no-store' }),
      fetch(`/api/indicators/rsi/${encodeURIComponent(sym)}?period=14`,            { cache: 'no-store' }),
      fetch(`/api/indicators/macd/${encodeURIComponent(sym)}?fast=12&slow=26&signal=9`, { cache: 'no-store' }),
      fetch(`/api/indicators/vol20/${encodeURIComponent(sym)}?period=20`,          { cache: 'no-store' }),
    ])
    if (!(rMa.ok && rRsi.ok && rMacd.ok && rVol.ok)) return null

    const [ma, rsi, macd, vol] = await Promise.all([
      rMa.json(), rRsi.json(), rMacd.json(), rVol.json()
    ]) as [MaCrossResp, RsiResp, MacdResp, Vol20Resp]

    // EXACT SAME AGGREGATION as detail pages: combineScores()
    const score = combineScores({
      maCross: { status: ma?.status,   points: ma?.points },
      rsi:     { status: rsi?.status,  points: rsi?.points },
      macd:    { status: macd?.status, points: macd?.points },
      vol20:   { status: vol?.status,  points: vol?.points },
    })
    return Number.isFinite(score) ? score : null
  } catch {
    return null
  }
}

// simple concurrency pool
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

/* ---------------- page ---------------- */
export default function Homepage() {
  const router = useRouter()

  // Prefetch
  useEffect(() => {
    router.prefetch('/stocks').catch(()=>{})
    router.prefetch('/index').catch(()=>{})
  }, [router])

  // SWR warm-up (unchanged + add indicator endpoints to get caches hot)
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
      // touch a handful of indicator endpoints so caches are warm
      `/api/indicators/rsi/AAPL?period=14`,
      `/api/indicators/macd/AAPL?fast=12&slow=26&signal=9`,
      `/api/indicators/ma-cross/AAPL`,
      `/api/indicators/vol20/AAPL?period=20`,
    ].forEach(prime)
    return () => { aborted = true }
  }, [])

  /* =======================
     EQUITIES — highest BUY & lowest SELL per market
     ======================= */
  const MARKET_ORDER: MarketLabel[] = ['AEX','S&P 500','NASDAQ','Dow Jones','DAX','FTSE 100','Nikkei 225','Hang Seng','Sensex']
  const [topBuy,  setTopBuy]  = useState<ScoredRow[]>([])
  const [topSell, setTopSell] = useState<ScoredRow[]>([])

  useEffect(() => {
    let aborted = false

    ;(async () => {
      // compute for each market using SAME scoring as detail pages
      const perMarketResults: Array<{ market: MarketLabel; best: ScoredRow | null; worst: ScoredRow | null }> = []

      for (const m of MARKET_ORDER) {
        const cfg = MARKETS.find(x => x.label === m)
        if (!cfg || !cfg.list || cfg.list.length === 0) {
          perMarketResults.push({ market: m, best: null, worst: null })
          continue
        }

        const list = cfg.list.slice() // symbols + names
        // Limit concurrency so we don’t explode the browser/network.
        // (If you have background ISR caching this will still be snappy.)
        const results = await pool(list, |oai:code-citation|