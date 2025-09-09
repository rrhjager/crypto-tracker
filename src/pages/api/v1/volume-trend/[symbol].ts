// src/pages/api/v1/volume-trend/[symbol].ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { fetchSafe, okJson } from '@/lib/fetchSafe'

type Out = {
  symbol: string
  updatedAt: number
  volumeTrend: number | null // 0..1 of null als N/A
  // debug?: any
}

// ─────────────────────────────────────────────────────────────
// Helpers: mappings & maths
// ─────────────────────────────────────────────────────────────

// Uitzonderingen voor tickers die anders heten op beurzen
const BINANCE_SYMBOL_MAP: Record<string, string> = {
  KASPA: 'KAS', // ← belangrijk voor Kaspa op Binance
  XBT: 'BTC',
  MIOTA: 'IOTA',
}

const COINBASE_SYMBOL_MAP: Record<string, string> = {
  KASPA: 'KAS', // Coinbase product wordt dan KAS-USD
  XBT: 'BTC',
  MIOTA: 'IOTA',
}

function toBinancePair(sym: string) {
  const base = (BINANCE_SYMBOL_MAP[sym] || sym).toUpperCase()
  return `${base}USDT`
}

function toCoinbaseProduct(sym: string) {
  const base = (COINBASE_SYMBOL_MAP[sym] || sym).toUpperCase()
  return `${base}-USD`
}

// Sigmoid die de verhouding t.o.v. MA netjes centreert op 0.5
function logisticFromRatio(ratio: number, k = 1.35) {
  if (!Number.isFinite(ratio) || ratio <= 0) return 0.5
  const x = Math.log(ratio)
  const s = 1 / (1 + Math.exp(-k * x))
  return Math.min(1, Math.max(0, s))
}

// Tanh mapping voor trend-slope: 0 = vlak → 0.5 ; positief → >0.5 ; negatief → <0.5
function tanh01(x: number) {
  const t = Math.tanh(x)
  return 0.5 * (1 + t)
}

function mean(a: number[]) {
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN
}

// Lineaire regressie-slope op log(MA) (per dag)
function slopePerDay(series: number[]) {
  const n = series.length
  if (n < 2) return 0
  const xs = Array.from({ length: n }, (_, i) => i)
  const xMean = mean(xs)
  const yMean = mean(series)
  let num = 0, den = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - xMean
    const dy = series[i] - yMean
    num += dx * dy
    den += dx * dx
  }
  if (den === 0) return 0
  return num / den
}

/** CDN-vriendelijke cache headers (werkt op Vercel/NGINX/CDN). */
function setCacheHeaders(res: NextApiResponse, smaxage = 15, swr = 60) {
  const value = `public, s-maxage=${smaxage}, stale-while-revalidate=${swr}`
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', value)
  res.setHeader('CDN-Cache-Control', value)
  res.setHeader('Vercel-CDN-Cache-Control', value)
  res.setHeader('Timing-Allow-Origin', '*')
}

// Kernberekening volumeTrend (gebruikt 20/60 MA wanneer mogelijk)
function computeVolumeTrend(vols: number[]): number | null {
  const n = vols.length
  if (n < 70) return null // te weinig voor 20/60 + trend-window

  // MA helper (snel)
  const maN = (arr: number[], n: number, endIdx: number) => {
    const start = endIdx - n + 1
    if (start < 0) return NaN
    let s = 0
    for (let i = start; i <= endIdx; i++) s += arr[i]
    return s / n
  }

  const last = n - 1
  const ma20_now = maN(vols, 20, last)
  const ma60_now = maN(vols, 60, last)
  const curVol = vols[last]
  if (!Number.isFinite(ma20_now) || !Number.isFinite(ma60_now) || !Number.isFinite(curVol)) {
    return null
  }

  // A: huidig volume vs MA20
  const ratioCur = curVol / (ma20_now || 1)
  const compA = logisticFromRatio(ratioCur, 1.35)

  // B: trend van MA20 over laatste ~40 dagen
  const ma20_series: number[] = []
  for (let i = last - 39; i <= last; i++) {
    if (i >= 19) {
      const v = maN(vols, 20, i)
      if (Number.isFinite(v)) ma20_series.push(v)
    }
  }

  let compB = 0.5
  if (ma20_series.length >= 10) {
    const logSeries = ma20_series.map(v => Math.log(Math.max(v, 1e-9)))
    const slope = slopePerDay(logSeries)
    const scaled = slope * 120
    compB = tanh01(scaled)
  }

  // C: regime MA20 vs MA60
  const compRegime = logisticFromRatio(ma20_now / (ma60_now || 1), 1.0)

  // Eindsignaal
  const volumeTrend = Math.max(0, Math.min(1, 0.65 * compA + 0.25 * compB + 0.10 * compRegime))
  return volumeTrend
}

// ─────────────────────────────────────────────────────────────
// Data fetchers
// ─────────────────────────────────────────────────────────────

async function fetchVolumesFromBinance(symbol: string): Promise<number[] | null> {
  const pair = toBinancePair(symbol)
  const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(pair)}&interval=1d&limit=180`
  try {
    const r = await fetchSafe(url, { cache: 'no-store' }, 7000, 1)
    const json = await okJson<any>(r)
    if (!Array.isArray(json)) return null
    const vols: number[] = json.map((k: any) => Number(k?.[5] ?? 0)).filter((n: any) => Number.isFinite(n))
    return vols.length ? vols : null
  } catch {
    return null
  }
}

async function fetchVolumesFromCoinbase(symbol: string): Promise<number[] | null> {
  // Coinbase market data (publiek) — dagelijkse candles
  const product = toCoinbaseProduct(symbol)
  const url = `https://api.exchange.coinbase.com/products/${encodeURIComponent(product)}/candles?granularity=86400&limit=180`
  try {
    const r = await fetchSafe(url, { cache: 'no-store' }, 7000, 1)
    // Response: [[time, low, high, open, close, volume], ...]
    const arr = await okJson<any>(r)
    if (!Array.isArray(arr)) return null
    // Zorg dat het oploopt in tijd (soms komt Coinbase newest-first)
    const rows = [...arr].sort((a: any, b: any) => Number(a?.[0] ?? 0) - Number(b?.[0] ?? 0))
    const vols: number[] = rows.map((row: any) => Number(row?.[5] ?? 0)).filter((n: any) => Number.isFinite(n))
    return vols.length ? vols : null
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse<Out | { error: string }>) {
  try {
    const raw = req.query.symbol
    const symbol = (Array.isArray(raw) ? raw[0] : raw || '').toString().toUpperCase()
    if (!symbol) {
      setCacheHeaders(res, 5, 30)
      return res.status(200).json({ symbol: '', updatedAt: Date.now(), volumeTrend: null })
    }

    // 1) Probeer Binance (snel + breed)
    let vols = await fetchVolumesFromBinance(symbol)

    // 2) Fallback naar Coinbase als Binance geen (genoeg) data geeft (bv. mapping issues of nieuw listing)
    if (!vols || vols.length < 70) {
      const mapped = (BINANCE_SYMBOL_MAP[symbol] || symbol).toUpperCase()
      vols = await fetchVolumesFromCoinbase(mapped)
    }

    if (!vols || vols.length < 70) {
      setCacheHeaders(res, 5, 30)
      return res.status(200).json({ symbol, updatedAt: Date.now(), volumeTrend: null })
    }

    const volumeTrend = computeVolumeTrend(vols)

    setCacheHeaders(res, 15, 60)
    return res.status(200).json({
      symbol,
      updatedAt: Date.now(),
      volumeTrend: (typeof volumeTrend === 'number' ? volumeTrend : null),
      // debug: { src: vols === null ? 'none' : 'ok', n: vols?.length }
    })
  } catch {
    setCacheHeaders(res, 5, 30)
    return res.status(200).json({ symbol: String((req.query.symbol ?? '') || ''), updatedAt: Date.now(), volumeTrend: null })
  }
}