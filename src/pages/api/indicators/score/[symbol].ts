// src/pages/api/indicators/score/[symbol].ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { kvGetJSON, kvSetJSON } from '@/lib/kv'
import { getYahooDailyOHLC } from '@/lib/providers/quote'

export const config = { runtime: 'nodejs' }

// Zorg dat deze exact matcht met /api/indicators/snapshot.ts
const TTL_SEC = 300
const RANGE: '1y' | '2y' = '1y'

type Advice = 'BUY'|'SELL'|'HOLD'
type Bar = { close?: number; volume?: number }

type ScoreResp = {
  symbol: string
  score: number | null
  // optioneel, handig voor debug
  components?: {
    ma: Advice
    macd: Advice
    rsi: Advice
    vol: Advice
  }
}

// ==== helpers (exacte kopie van je snapshot.ts) ====
function normCloses(ohlc: any): number[] {
  if (Array.isArray(ohlc)) {
    return (ohlc as Bar[])
      .map(b => (typeof b?.close === 'number' ? b.close : null))
      .filter((n): n is number => typeof n === 'number')
  }
  if (ohlc && Array.isArray(ohlc.closes)) {
    return (ohlc.closes as any[]).filter((n): n is number => typeof n === 'number')
  }
  return []
}
function normVolumes(ohlc: any): number[] {
  if (Array.isArray(ohlc)) {
    return (ohlc as Bar[])
      .map(b => (typeof b?.volume === 'number' ? b.volume : null))
      .filter((n): n is number => typeof n === 'number')
  }
  if (ohlc && Array.isArray(ohlc.volumes)) {
    return (ohlc.volumes as any[]).filter((n): n is number => typeof n === 'number')
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
  let gains = 0, losses = 0
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
  if (arr.length < slow + signal) return { macd: null, signal: null, hist: null }
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

// zelfde weging als snapshot.ts
const adv = (v:number|null, lo:number, hi:number): Advice =>
  v==null?'HOLD':(v<lo?'SELL':v>hi?'BUY':'HOLD')
const scoreFrom = (ma:Advice, macd:Advice, rsi:Advice, vol:Advice) => {
  const pts = (s:Advice)=> s==='BUY'?2:s==='SELL'?-2:0
  const n = (p:number)=> (p+2)/4
  const W_MA=.40, W_MACD=.30, W_RSI=.20, W_VOL=.10
  const agg = W_MA*n(pts(ma)) + W_MACD*n(pts(macd)) + W_RSI*n(pts(rsi)) + W_VOL*n(pts(vol))
  return Math.round(Math.max(0, Math.min(1, agg)) * 100)
}

async function computeScore(symbol: string): Promise<ScoreResp> {
  const ohlc = await getYahooDailyOHLC(symbol, RANGE)
  const closes = normCloses(ohlc)
  const vols = normVolumes(ohlc)

  const ma50 = sma(closes, 50)
  const ma200 = sma(closes, 200)
  const maStatus: Advice =
    (ma50 != null && ma200 != null)
      ? (ma50 > ma200 ? 'BUY' : ma50 < ma200 ? 'SELL' : 'HOLD')
      : 'HOLD'

  const rsi = rsiWilder(closes, 14)
  const { macd, signal } = macdLast(closes, 12, 26, 9)
  const macdStatus: Advice = (macd!=null && signal!=null)
    ? (macd > signal ? 'BUY' : macd < signal ? 'SELL' : 'HOLD')
    : 'HOLD'

  const volume = vols.length ? vols[vols.length - 1] : null
  const last20 = vols.slice(-20)
  const avg20d = last20.length === 20 ? last20.reduce((a, b) => a + b, 0) / 20 : null
  const ratio =
    typeof volume === 'number' && typeof avg20d === 'number' && avg20d > 0
      ? volume / avg20d
      : null
  const volStatus: Advice = adv(ratio, 0.8, 1.2)

  const score = scoreFrom(maStatus, macdStatus, rsi==null?'HOLD':(rsi<30?'BUY':rsi>70?'SELL':'HOLD'), volStatus)
  return { symbol, score, components: { ma: maStatus, macd: macdStatus, rsi: rsi==null?'HOLD':(rsi<30?'BUY':rsi>70?'SELL':'HOLD'), vol: volStatus } }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScoreResp | { error: string }>) {
  try {
    const symbol = (req.query.symbol as string || '').toUpperCase().trim()
    if (!symbol) return res.status(400).json({ error: 'Missing symbol' })

    const kvKey = `ind:snap:all:${symbol}` // dezelfde key die je bij snapshot wegschrijft
    // 1) Probeer KV (score staat daar al, mits eerder berekend)
    try {
      const snap = await kvGetJSON<any>(kvKey)
      const fresh = snap && typeof snap.updatedAt==='number' && (Date.now() - snap.updatedAt) < TTL_SEC*1000
      const score = snap?.value?.score
      if (fresh && Number.isFinite(score)) {
        res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=60')
        return res.status(200).json({ symbol, score: Math.round(Number(score)) })
      }
    } catch {}

    // 2) Compute en schrijf terug naar KV, zodat iedereen dezelfde score ziet
    const computed = await computeScore(symbol)
    try {
      await kvSetJSON(kvKey, { updatedAt: Date.now(), value: { score: computed.score } }, TTL_SEC)
    } catch {}
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=60')
    return res.status(200).json(computed)
  } catch (e:any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}