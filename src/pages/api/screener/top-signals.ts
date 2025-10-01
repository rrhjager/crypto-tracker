// src/pages/api/screener/top-signals.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { AEX } from '@/lib/aex'

type MarketLabel =
  | 'AEX' | 'S&P 500' | 'NASDAQ' | 'Dow Jones'
  | 'DAX' | 'FTSE 100' | 'Nikkei 225' | 'Hang Seng' | 'Sensex'

type EquityCon = { symbol: string; name: string; market: MarketLabel }

type Signal = 'BUY' | 'HOLD' | 'SELL'
type Scored = {
  symbol: string
  name: string
  market: MarketLabel
  score: number // 0..100
  signal: Signal
}

// ---------- Constituents (zelfde fallback als homepage) ----------
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

function constituentsForMarket(label: MarketLabel): EquityCon[] {
  if (label === 'AEX') {
    return AEX.map(x => ({ symbol: x.symbol, name: x.name, market: 'AEX' as const }))
  }
  const rows = STATIC_CONS[label] || []
  return rows.map(r => ({ ...r, market: label }))
}

// ---------- Helpers ----------
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// micro-cache per symbool (3 minuten)
const CACHE_TTL = 180_000
const cache = new Map<string, { t: number; val: Scored | null }>()
const getCache = (k: string) => {
  const v = cache.get(k)
  if (!v) return null
  if (Date.now() - v.t > CACHE_TTL) return null
  return v.val
}
const setCache = (k: string, val: Scored | null) => cache.set(k, { t: Date.now(), val })

async function fetchChart(symbol: string, range: string, interval: string) {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`
  const r = await fetch(url, { headers: { 'User-Agent': UA }, cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const j: any = await r.json()
  const res = j?.chart?.result?.[0]
  if (!res) throw new Error('no result')
  return res
}

// math utils
const sma = (arr: number[], n: number) => {
  if (arr.length < n) return NaN
  let sum = 0
  for (let i = arr.length - n; i < arr.length; i++) sum += arr[i]
  return sum / n
}
const rsi14 = (closes: number[]) => {
  const n = 14
  if (closes.length < n + 1) return NaN
  let gains = 0, losses = 0
  for (let i = closes.length - n; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff >= 0) gains += diff
    else losses -= diff
  }
  const rs = (gains / n) / Math.max(1e-9, (losses / n))
  return 100 - 100 / (1 + rs)
}

// Composite score (0..100) uit lichte indicatoren
function scoreFromSeries(closes1d: number[], closes1dDaily: number[]): number {
  const c = closes1d.filter(Number.isFinite) as number[]
  const d = closes1dDaily.filter(Number.isFinite) as number[]
  if (c.length < 20 || d.length < 30) return 0

  const last = c[c.length - 1]
  const sma20 = sma(c, 20)
  const sma50 = sma(d, 50) // uit daily serie
  const rsi = rsi14(c)
  const last7 = d.slice(-8) // 7d momentum uit daily
  const m7 = last7.length >= 2 ? ((last7[last7.length - 1] / last7[0]) - 1) * 100 : 0

  // 52w range approx: gebruik daily 1y als het er is; met 6mo gebruiken we min/max daar
  const hi = Math.max(...d.slice(-252)) || Math.max(...d)
  const lo = Math.min(...d.slice(-252)) || Math.min(...d)
  const pct52 = hi === lo ? 50 : ((last - lo) / (hi - lo)) * 100

  // Weging — simpel en snel
  const wTrend = Number(isFinite(sma20) && isFinite(sma50) ? (sma20 > sma50 ? 1 : -1) : 0) * 25
  const wRsi = isFinite(rsi) ? ((rsi - 50) / 50) * 25 : 0
  const wM7 = Math.max(-10, Math.min(10, m7)) * 1.5 // cap op ±10%
  const w52 = ((pct52 - 50) / 50) * 25

  const raw = 50 + wTrend + wRsi + wM7 + w52
  return Math.max(0, Math.min(100, raw))
}

function toSignal(score: number): Signal {
  if (score >= 70) return 'BUY'
  if (score <= 30) return 'SELL'
  return 'HOLD'
}

// Bereken score voor één symbool (met cache)
async function scoreSymbol(sym: string, meta: { name: string; market: MarketLabel }): Promise<Scored | null> {
  const hit = getCache(sym)
  if (hit !== null) return hit

  try {
    // 1d/1m voor korte rsi/sma20 en 6mo/1d voor sma50/52w-benadering en 7d momentum
    const [intraday, daily] = await Promise.all([
      fetchChart(sym, '1d', '1m'),
      fetchChart(sym, '6mo', '1d'),
    ])

    const c1m: number[] = (intraday?.indicators?.quote?.[0]?.close || []).map(Number)
    const c1d: number[] = (daily?.indicators?.quote?.[0]?.close || []).map(Number)

    const score = scoreFromSeries(c1m, c1d)
    const out: Scored = {
      symbol: sym,
      name: meta.name,
      market: meta.market,
      score,
      signal: toSignal(score),
    }
    setCache(sym, out)
    return out
  } catch {
    setCache(sym, null)
    return null
  }
}

// simpele pool limiter
async function mapWithPool<T, R>(arr: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(arr.length) as any
  let i = 0
  const workers = new Array(Math.min(n, arr.length)).fill(0).map(async () => {
    while (true) {
      const idx = i++
      if (idx >= arr.length) break
      out[idx] = await fn(arr[idx])
      await sleep(50) // mini backoff
    }
  })
  await Promise.all(workers)
  return out
}

type ApiOut = {
  markets: Array<{
    market: MarketLabel
    topBuy: Scored | null
    topSell: Scored | null
  }>
  meta: { used: string }
}

const DEFAULT_MARKETS: MarketLabel[] = [
  'AEX','S&P 500','NASDAQ','Dow Jones','DAX','FTSE 100','Nikkei 225','Hang Seng','Sensex'
]

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiOut | { error: string }>) {
  try {
    const listParam = String(req.query.markets || '').trim()
    const markets: MarketLabel[] = listParam
      ? (listParam.split(',').map(s => s.trim()) as MarketLabel[])
      : DEFAULT_MARKETS

    const result: ApiOut['markets'] = []

    for (const m of markets) {
      const cons = constituentsForMarket(m)
      if (!cons.length) {
        result.push({ market: m, topBuy: null, topSell: null })
        continue
      }

      const scored = (await mapWithPool(cons, 5, async (c) => scoreSymbol(c.symbol, { name: c.name, market: c.market })))
        .filter(Boolean) as Scored[]

      if (!scored.length) {
        result.push({ market: m, topBuy: null, topSell: null })
        continue
      }

      const sorted = scored.sort((a, b) => b.score - a.score)
      const topBuy = sorted[0] ?? null
      const topSell = sorted[sorted.length - 1] ?? null

      result.push({ market: m, topBuy, topSell })
    }

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120')
    return res.status(200).json({ markets: result, meta: { used: 'yahoo:chart 1d/1m + 6mo/1d' } })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}