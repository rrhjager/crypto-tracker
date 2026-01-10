// src/pages/api/indicators/score/[symbol].ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { kvGetJSON, kvSetJSON } from '@/lib/kv'
import { getYahooDailyOHLC } from '@/lib/providers/quote'
import { computeScoreStatus } from '@/lib/taScore'

export const config = { runtime: 'nodejs' }

// match met snapshot.ts
const TTL_SEC = 300
const RANGE: '1y' | '2y' = '1y'

type Bar = { close?: number; volume?: number }
type Advice = 'BUY' | 'HOLD' | 'SELL'

type ScoreResp = {
  symbol: string
  score: number | null
  status?: Advice
  // optioneel debug
  components?: {
    ma50: number | null
    ma200: number | null
    rsi: number | null
    macdHist: number | null
    volRatio: number | null
  }
}

/* ===== helpers (zelfde stijl als snapshot.ts) ===== */
function normCloses(ohlc: any): number[] {
  if (Array.isArray(ohlc)) {
    return (ohlc as Bar[])
      .map(b => (typeof b?.close === 'number' ? b.close : null))
      .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
  }
  if (ohlc && Array.isArray(ohlc.closes)) {
    return (ohlc.closes as any[]).filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
  }
  return []
}

function normVolumes(ohlc: any): number[] {
  if (Array.isArray(ohlc)) {
    return (ohlc as Bar[])
      .map(b => (typeof b?.volume === 'number' ? b.volume : null))
      .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
  }
  if (ohlc && Array.isArray(ohlc.volumes)) {
    return (ohlc.volumes as any[]).filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
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

async function computeScore(symbol: string): Promise<ScoreResp> {
  const ohlc = await getYahooDailyOHLC(symbol, RANGE)
  const closes = normCloses(ohlc)
  const vols = normVolumes(ohlc)

  const ma50 = sma(closes, 50)
  const ma200 = sma(closes, 200)
  const rsi = rsiWilder(closes, 14)
  const { hist } = macdLast(closes, 12, 26, 9)

  const volume = vols.length ? vols[vols.length - 1] : null
  const last20 = vols.slice(-20)
  const avg20d = last20.length === 20 ? last20.reduce((a, b) => a + b, 0) / 20 : null
  const ratio =
    typeof volume === 'number' && typeof avg20d === 'number' && avg20d > 0 ? volume / avg20d : null

  const out = computeScoreStatus({
    ma: { ma50, ma200 },
    rsi,
    macd: { hist },
    volume: { ratio },
  })

  return {
    symbol,
    score: Number.isFinite(out.score) ? Math.round(out.score) : null,
    status: out.status as Advice,
    components: { ma50: ma50 ?? null, ma200: ma200 ?? null, rsi: rsi ?? null, macdHist: hist ?? null, volRatio: ratio ?? null },
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScoreResp | { error: string }>) {
  try {
    const symbol = String(req.query.symbol || '').toUpperCase().trim()
    if (!symbol) return res.status(400).json({ error: 'Missing symbol' })

    // 0) Als snapshot.ts al “ind:snap:all:${symbol}” heeft gevuld, gebruik die (geen extra compute)
    try {
      const snapKey = `ind:snap:all:${symbol}`
      const snap = await kvGetJSON<any>(snapKey)
      const fresh = snap && typeof snap.updatedAt === 'number' && Date.now() - snap.updatedAt < TTL_SEC * 1000
      const score = snap?.value?.score
      const status = snap?.value?.status
      if (fresh && Number.isFinite(score)) {
        res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=300')
        return res.status(200).json({ symbol, score: Math.round(Number(score)), status })
      }
    } catch {}

    // 1) Eigen KV cache voor score endpoint (KV-safe, geen conflict met snapshot.ts)
    const kvKey = `ind:score:${symbol}:${RANGE}`
    try {
      const cached = await kvGetJSON<any>(kvKey)
      const fresh = cached && typeof cached.updatedAt === 'number' && Date.now() - cached.updatedAt < TTL_SEC * 1000
      const score = cached?.value?.score
      const status = cached?.value?.status
      if (fresh && Number.isFinite(score)) {
        res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=300')
        return res.status(200).json({ symbol, score: Math.round(Number(score)), status })
      }
    } catch {}

    // 2) Compute (canonical) via computeScoreStatus
    const computed = await computeScore(symbol)

    // 3) Schrijf alleen naar eigen key (NIET naar ind:snap:all)
    try {
      await kvSetJSON(kvKey, { updatedAt: Date.now(), value: { score: computed.score, status: computed.status } }, TTL_SEC)
    } catch {}

    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=300')
    return res.status(200).json(computed)
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}