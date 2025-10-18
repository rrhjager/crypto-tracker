// src/pages/api/indicators/rsi/[symbol].ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { kvRefreshIfStale, kvSetJSON } from '@/lib/kv'
import { getYahooDailyOHLC } from '@/lib/providers/quote'

const TTL_SEC = 300
const REVALIDATE_SEC = 20
const RANGE: '1y' | '2y' = '1y'
const PERIOD = 14

type Resp = {
  symbol: string
  period: number
  rsi: number | null
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

// Wilder's RSI
function rsi(closes: number[], period: number): number | null {
  if (!Array.isArray(closes) || closes.length < period + 1) return null
  let gains = 0, losses = 0
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff >= 0) gains += diff
    else losses -= diff
  }
  let avgGain = gains / period
  let avgLoss = losses / period

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? -diff : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
  }
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  const val = 100 - 100 / (1 + rs)
  return Number.isFinite(val) ? val : null
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const symbol = String(req.query.symbol || '').trim().toUpperCase()
    if (!symbol) return res.status(400).json({ error: 'Missing symbol' })

    const key = `ind:rsi:${symbol}:${RANGE}:${PERIOD}`
    const snapKey = `ind:snap:rsi:${symbol}`

    const data = await kvRefreshIfStale<Resp>(key, TTL_SEC, REVALIDATE_SEC, async () => {
      const ohlc = await getYahooDailyOHLC(symbol, RANGE)
      const closes = normalizeCloses(ohlc)
      const r = rsi(closes, PERIOD)
      const value: Resp = { symbol, period: PERIOD, rsi: r ?? null }
      try { await kvSetJSON(snapKey, { updatedAt: Date.now(), value }, TTL_SEC) } catch {}
      return value
    })

    if (!data) return res.status(500).json({ error: 'Failed to compute rsi' })
    return res.status(200).json(data)
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}