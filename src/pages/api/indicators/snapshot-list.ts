// src/pages/api/indicators/snapshot-list.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { getYahooDailyOHLC, type YahooRange } from '@/lib/providers/quote'
import { kvGetJSON, kvSetJSON } from '@/lib/kv'
import { computeScoreStatus } from '@/lib/taScore'

import { AEX } from '@/lib/aex'
import { SP500 } from '@/lib/sp500'
import { NASDAQ } from '@/lib/nasdaq'
import { DOWJONES } from '@/lib/dowjones'
import { DAX as DAX_FULL } from '@/lib/dax'
import { FTSE100 } from '@/lib/ftse100'
import { NIKKEI225 } from '@/lib/nikkei225'
import { HANGSENG } from '@/lib/hangseng'
import { SENSEX } from '@/lib/sensex'

export const config = { runtime: 'nodejs' }

type Advice = 'BUY' | 'HOLD' | 'SELL'
type Bar = { close?: number; c?: number; volume?: number; v?: number }

type SnapItem = {
  symbol: string
  ma: { ma50: number | null; ma200: number | null; status: Advice }
  rsi: { period: number; rsi: number | null; status: Advice }
  macd: { macd: number | null; signal: number | null; hist: number | null; status: Advice }
  volume: { volume: number | null; avg20d: number | null; ratio: number | null; status: Advice }
  score: number
}
type Resp = { items: SnapItem[]; updatedAt: number }

const EDGE_MAX_AGE = 30
const KV_TTL_SEC = 600
const RANGE: YahooRange = '1y'

/* ---------- helpers (zelfde als snapshot.ts stijl) ---------- */
function normCloses(ohlc: any): number[] {
  if (Array.isArray(ohlc)) {
    return (ohlc as Bar[])
      .map(b => (typeof b?.close === 'number' ? b.close : typeof b?.c === 'number' ? b.c : null))
      .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
  }
  if (ohlc && Array.isArray((ohlc as any).closes)) {
    return ((ohlc as any).closes as any[]).filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
  }
  if (ohlc && Array.isArray((ohlc as any).c)) {
    return ((ohlc as any).c as any[]).filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
  }
  return []
}

function normVolumes(ohlc: any): number[] {
  if (Array.isArray(ohlc)) {
    return (ohlc as Bar[])
      .map(b => (typeof b?.volume === 'number' ? b.volume : typeof b?.v === 'number' ? b.v : null))
      .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
  }
  if (ohlc && Array.isArray((ohlc as any).volumes)) {
    return ((ohlc as any).volumes as any[]).filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
  }
  if (ohlc && Array.isArray((ohlc as any).v)) {
    return ((ohlc as any).v as any[]).filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
  }
  return []
}

const sma = (arr: number[], p: number): number | null => {
  if (!Array.isArray(arr) || arr.length < p) return null
  const s = arr.slice(-p)
  return s.reduce((a, b) => a + b, 0) / p
}

function rsiWilder(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null
  let gains = 0,
    losses = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d >= 0) gains += d
    else losses -= d
  }
  let avgGain = gains / period
  let avgLoss = losses / period
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    const g = d > 0 ? d : 0
    const l = d < 0 ? -d : 0
    avgGain = (avgGain * (period - 1) + g) / period
    avgLoss = (avgLoss * (period - 1) + l) / period
  }
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  const v = 100 - 100 / (1 + rs)
  return Number.isFinite(v) ? v : null
}

function emaLast(arr: number[], period: number): number | null {
  if (arr.length < period) return null
  const k = 2 / (period + 1)
  let ema = arr.slice(0, period).reduce((a, b) => a + b, 0) / period
  for (let i = period; i < arr.length; i++) ema = arr[i] * k + ema * (1 - k)
  return ema
}

function macdLast(arr: number[], fast = 12, slow = 26, signal = 9) {
  if (arr.length < slow + signal) return { macd: null as number | null, signal: null as number | null, hist: null as number | null }
  const series: number[] = []
  for (let i = slow; i <= arr.length; i++) {
    const slice = arr.slice(0, i)
    const f = emaLast(slice, fast)
    const s = emaLast(slice, slow)
    if (f != null && s != null) series.push(f - s)
  }
  if (series.length < signal) return { macd: null, signal: null, hist: null }
  const m = series[series.length - 1]
  const sig = emaLast(series, signal)
  const h = sig != null ? m - sig : null
  return { macd: m ?? null, signal: sig ?? null, hist: h ?? null }
}

// UI-status helpers (momentum-consistent met computeScoreStatus richting)
const statusMA = (ma50: number | null, ma200: number | null): Advice => {
  if (ma50 == null || ma200 == null) return 'HOLD'
  if (ma50 > ma200) return 'BUY'
  if (ma50 < ma200) return 'SELL'
  return 'HOLD'
}
const statusRSI = (rsi: number | null): Advice => {
  if (rsi == null) return 'HOLD'
  if (rsi > 70) return 'BUY'
  if (rsi < 30) return 'SELL'
  return 'HOLD'
}
const statusMACD = (hist: number | null, macd: number | null, signal: number | null): Advice => {
  if (hist != null && Number.isFinite(hist)) return hist > 0 ? 'BUY' : hist < 0 ? 'SELL' : 'HOLD'
  if (macd != null && signal != null && Number.isFinite(macd) && Number.isFinite(signal))
    return macd > signal ? 'BUY' : macd < signal ? 'SELL' : 'HOLD'
  return 'HOLD'
}
const statusVol = (ratio: number | null): Advice => {
  if (ratio == null) return 'HOLD'
  if (ratio > 1.2) return 'BUY'
  if (ratio < 0.8) return 'SELL'
  return 'HOLD'
}

/* ---------- market lists ---------- */
const STATIC_CONS = {
  AEX,
  'S&P 500': SP500,
  NASDAQ,
  'Dow Jones': DOWJONES,
  DAX: DAX_FULL,
  'FTSE 100': FTSE100,
  'Nikkei 225': NIKKEI225,
  'Hang Seng': HANGSENG,
  Sensex: SENSEX,
} as const

const listForMarket = (mkt?: string) => {
  if (!mkt) return [] as Array<{ symbol: string; name: string }>
  const arr = (STATIC_CONS as any)[mkt] || []
  return arr.map((x: any) => ({ symbol: x.symbol, name: x.name }))
}

/* ---------- compute one ---------- */
async function computeOne(symbol: string): Promise<SnapItem> {
  const ohlc = await getYahooDailyOHLC(symbol, RANGE)
  const cs = normCloses(ohlc)
  const vs = normVolumes(ohlc)

  const ma50 = sma(cs, 50)
  const ma200 = sma(cs, 200)

  const rsi = rsiWilder(cs, 14)
  const m = macdLast(cs, 12, 26, 9)

  const vol = vs.length ? vs[vs.length - 1] : null
  const last20 = vs.slice(-20)
  const avg20d = last20.length === 20 ? last20.reduce((a, b) => a + b, 0) / 20 : null
  const ratio = vol != null && avg20d != null && avg20d > 0 ? vol / avg20d : null

  // ✅ Canonical score: EXACT dezelfde engine als crypto
  const { score } = computeScoreStatus({
    ma: { ma50, ma200 },
    rsi,
    macd: { hist: m.hist },
    volume: { ratio },
  })

  return {
    symbol,
    ma: { ma50: ma50 ?? null, ma200: ma200 ?? null, status: statusMA(ma50 ?? null, ma200 ?? null) },
    rsi: { period: 14, rsi: rsi ?? null, status: statusRSI(rsi ?? null) },
    macd: {
      macd: m.macd ?? null,
      signal: m.signal ?? null,
      hist: m.hist ?? null,
      status: statusMACD(m.hist ?? null, m.macd ?? null, m.signal ?? null),
    },
    volume: {
      volume: vol ?? null,
      avg20d: avg20d ?? null,
      ratio: ratio ?? null,
      status: statusVol(ratio ?? null),
    },
    score,
  }
}

/* ---------- concurrency pool ---------- */
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

/* ---------- handler ---------- */
export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp | { error: string }>) {
  res.setHeader('Cache-Control', `public, s-maxage=${EDGE_MAX_AGE}, stale-while-revalidate=300`)

  try {
    const rawSyms = String(req.query.symbols || '').trim()
    const market = String(req.query.market || '').trim()

    let symbols: string[] = []
    if (rawSyms) {
      symbols = rawSyms.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    } else if (market) {
      symbols = listForMarket(market).map(x => x.symbol.toUpperCase())
    } else {
      return res.status(400).json({ error: 'Provide ?symbols=A,B or ?market=AEX|DAX|...' })
    }

    if (!symbols.length) return res.status(200).json({ items: [], updatedAt: Date.now() })
    if (symbols.length > 60) symbols = symbols.slice(0, 60)

    const keyId = symbols.join(',')
    const kvKey = `ind:snap:list:${RANGE}:${keyId}`

    try {
      const cached = await kvGetJSON<Resp>(kvKey)
      if (cached && Array.isArray(cached.items) && cached.items.length) {
        return res.status(200).json(cached)
      }
    } catch {}

    // Concurrency = 6 (Yahoo-vriendelijk)
    const items = await pool(symbols, 6, async (sym) => computeOne(sym))

    const updatedAt = Date.now()
    try {
      await kvSetJSON(kvKey, { items, updatedAt }, KV_TTL_SEC)
    } catch {}

    return res.status(200).json({ items, updatedAt })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}