// src/pages/api/indicators/macd/[symbol].ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { kvRefreshIfStale, kvSetJSON } from '@/lib/kv'
import { getYahooDailyOHLC } from '@/lib/providers/quote'

const TTL_SEC = 300
const REVALIDATE_SEC = 20
const RANGE: '1y' | '2y' = '1y'
const FAST = 12, SLOW = 26, SIGNAL = 9

type Resp = {
  symbol: string
  fast: number
  slow: number
  signalPeriod: number
  macd: number | null
  signal: number | null
  hist: number | null
  status?: 'BUY' | 'SELL' | 'HOLD'
  points?: number | null | string
}
type Bar = { close?: number }
type Snap = { updatedAt: number; value: Resp }

function normalizeCloses(ohlc: any): number[] {
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
function emaLast(arr: number[], period: number): number | null {
  if (!Array.isArray(arr) || arr.length < period) return null
  const k = 2 / (period + 1)
  let ema = arr.slice(0, period).reduce((a, b) => a + b, 0) / period
  for (let i = period; i < arr.length; i++) ema = arr[i] * k + ema * (1 - k)
  return ema
}
function macdLast(arr: number[], fast: number, slow: number, signal: number) {
  if (arr.length < slow + signal) return { macd: null, signal: null, hist: null }
  const macdSeries: number[] = []
  // Build series to compute signal EMA accurately
  for (let i = slow; i <= arr.length; i++) {
    const slice = arr.slice(0, i)
    const fastE = emaLast(slice, fast)
    const slowE = emaLast(slice, slow)
    const m = fastE != null && slowE != null ? fastE - slowE : null
    if (m != null) macdSeries.push(m)
  }
  if (macdSeries.length < signal) return { macd: null, signal: null, hist: null }
  const lastMacd = macdSeries[macdSeries.length - 1]
  const sig = emaLast(macdSeries, signal)
  const hist = sig != null ? lastMacd - sig : null
  return { macd: lastMacd ?? null, signal: sig ?? null, hist: hist ?? null }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const symbol = String(req.query.symbol || '').trim().toUpperCase()
    if (!symbol) return res.status(400).json({ error: 'Missing symbol' })

    const key = `ind:macd:${symbol}:${RANGE}:${FAST}-${SLOW}-${SIGNAL}`
    const snapKey = `ind:snap:macd:${symbol}`

    const data = await kvRefreshIfStale<Resp>(key, TTL_SEC, REVALIDATE_SEC, async () => {
      const ohlc = await getYahooDailyOHLC(symbol, RANGE)
      const closes = normalizeCloses(ohlc)
      const { macd, signal, hist } = macdLast(closes, FAST, SLOW, SIGNAL)
      const value: Resp = { symbol, fast: FAST, slow: SLOW, signalPeriod: SIGNAL, macd, signal, hist }
      try { await kvSetJSON(snapKey, { updatedAt: Date.now(), value }, TTL_SEC) } catch {}
      return value
    })

    if (!data) return res.status(500).json({ error: 'Failed to compute macd' })
    return res.status(200).json(data)
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}