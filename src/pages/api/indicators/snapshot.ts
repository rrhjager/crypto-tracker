// src/pages/api/indicators/snapshot.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { kvRefreshIfStale, kvSetJSON } from '@/lib/kv'
import { getYahooDailyOHLC } from '@/lib/providers/quote'

export const config = { runtime: 'nodejs' }

const TTL_SEC = 300          // 5 min cache in KV
const REVALIDATE_SEC = 20    // bij ≤20s resterend, achtergrond refresh
const RANGE: '1y' | '2y' = '1y'

type Bar = { close?: number; volume?: number }
type Advice = 'BUY'|'SELL'|'HOLD'

type SnapResp = {
  symbol: string
  // ✨ nieuw:
  price?: number | null
  change?: number | null
  changePct?: number | null
  // bestaand:
  ma?: { ma50: number | null; ma200: number | null; status?: Advice }
  rsi?: number | null
  macd?: { macd: number | null; signal: number | null; hist: number | null }
  volume?: { volume: number | null; avg20d: number | null; ratio: number | null }
  // ✨ nieuw:
  score?: number
}

type ApiResp = { items: SnapResp[] }

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

// Wilder's RSI(14)
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

// ✨ score-helpers (zelfde weging als je snapshot-list)
const adv = (v:number|null, lo:number, hi:number): Advice => v==null?'HOLD':(v<lo?'SELL':v>hi?'BUY':'HOLD')
const scoreFrom = (ma:Advice, macd:Advice, rsi:Advice, vol:Advice) => {
  const pts = (s:Advice)=> s==='BUY'?2:s==='SELL'?-2:0
  const n = (p:number)=> (p+2)/4
  const W_MA=.40, W_MACD=.30, W_RSI=.20, W_VOL=.10
  const agg = W_MA*n(pts(ma)) + W_MACD*n(pts(macd)) + W_RSI*n(pts(rsi)) + W_VOL*n(pts(vol))
  return Math.round(Math.max(0, Math.min(1, agg)) * 100)
}

async function computeOne(symbol: string): Promise<SnapResp> {
  const ohlc = await getYahooDailyOHLC(symbol, RANGE)
  const closes = normCloses(ohlc)
  const vols = normVolumes(ohlc)

  const ma50 = sma(closes, 50)
  const ma200 = sma(closes, 200)
  const maStatus: Advice | undefined =
    typeof ma50 === 'number' && typeof ma200 === 'number'
      ? (ma50 > ma200 ? 'BUY' : ma50 < ma200 ? 'SELL' : 'HOLD')
      : undefined

  const rsi = rsiWilder(closes, 14)
  const { macd, signal, hist } = macdLast(closes, 12, 26, 9)

  const volume = vols.length ? vols[vols.length - 1] : null
  const last20 = vols.slice(-20)
  const avg20d = last20.length === 20 ? last20.reduce((a, b) => a + b, 0) / 20 : null
  const ratio =
    typeof volume === 'number' && typeof avg20d === 'number' && avg20d > 0
      ? volume / avg20d
      : null

  // ✨ prijs en dag% uit close→close (zoals AEX effectief doet)
  const last = closes.length ? closes[closes.length - 1] : null
  const prev = closes.length > 1 ? closes[closes.length - 2] : null
  const change = (last != null && prev != null) ? last - prev : null
  const changePct = (change != null && prev) ? (change / prev * 100) : null

  // ✨ samengestelde score (zelfde weging als snapshot-list)
  const macdStatus: Advice = (macd!=null && signal!=null)
    ? (macd > signal ? 'BUY' : macd < signal ? 'SELL' : 'HOLD')
    : 'HOLD'
  const rsiStatus: Advice = rsi==null ? 'HOLD' : rsi < 30 ? 'BUY' : rsi > 70 ? 'SELL' : 'HOLD'
  const volStatus: Advice = adv(ratio, 0.8, 1.2)
  const score = scoreFrom(maStatus ?? 'HOLD', macdStatus, rsiStatus, volStatus)

  return {
    symbol,
    price: last ?? null,
    change,
    changePct,
    ma: { ma50: ma50 ?? null, ma200: ma200 ?? null, status: maStatus },
    rsi: rsi ?? null,
    macd: { macd: macd ?? null, signal: signal ?? null, hist: hist ?? null },
    volume: { volume: volume ?? null, avg20d: avg20d ?? null, ratio: ratio ?? null },
    score,
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResp | { error: string }>) {
  try {
    const listRaw = (req.query.symbols ?? req.query.symbol ?? '').toString().trim()
    if (!listRaw) return res.status(400).json({ error: 'Missing symbol(s)' })

    const symbols = listRaw
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(Boolean)

    if (symbols.length === 0) return res.status(400).json({ error: 'No valid symbols' })

    // Per symbool een KV-cache + refresh
    const items = await Promise.all(
      symbols.map(async (sym) => {
        const key = `ind:snapshot:${sym}:${RANGE}`
        const snapKey = `ind:snap:all:${sym}`
        const data = await kvRefreshIfStale<SnapResp>(key, TTL_SEC, REVALIDATE_SEC, async () => {
          const v = await computeOne(sym)
          try { await kvSetJSON(snapKey, { updatedAt: Date.now(), value: v }, TTL_SEC) } catch {}
          return v
        })
        return data ?? { symbol: sym, ma: { ma50: null, ma200: null }, rsi: null, macd: { macd: null, signal: null, hist: null }, volume: { volume: null, avg20d: null, ratio: null } }
      })
    )

    return res.status(200).json({ items })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}