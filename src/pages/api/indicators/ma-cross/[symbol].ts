// src/pages/api/indicators/ma-cross/[symbol].ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { kvRefreshIfStale, kvSetJSON } from '@/lib/kv'
import { getYahooDailyOHLC } from '@/lib/providers/quote'

const TTL_SEC = 300
const REVALIDATE_SEC = 20
const RANGE: '1y' | '2y' = '1y'

type Resp = {
  symbol: string
  ma50: number | null
  ma200: number | null
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
const sma = (arr: number[], period: number): number | null => {
  if (!Array.isArray(arr) || arr.length < period) return null
  const slice = arr.slice(-period)
  const sum = slice.reduce((a, b) => a + b, 0)
  return sum / period
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const symbol = String(req.query.symbol || '').trim().toUpperCase()
    if (!symbol) return res.status(400).json({ error: 'Missing symbol' })

    const key = `ind:ma:${symbol}:${RANGE}`
    const snapKey = `ind:snap:ma:${symbol}`

    const data = await kvRefreshIfStale<Resp>(key, TTL_SEC, REVALIDATE_SEC, async () => {
      const ohlc = await getYahooDailyOHLC(symbol, RANGE)
      const closes = normalizeCloses(ohlc)

      const ma50 = sma(closes, 50)
      const ma200 = sma(closes, 200)

      let status: 'BUY' | 'SELL' | 'HOLD' | undefined = undefined
      if (typeof ma50 === 'number' && typeof ma200 === 'number') {
        status = ma50 > ma200 ? 'BUY' : ma50 < ma200 ? 'SELL' : 'HOLD'
      }

      const value: Resp = { symbol, ma50, ma200, status }
      try { await kvSetJSON(snapKey, { updatedAt: Date.now(), value }, TTL_SEC) } catch {}
      return value
    })

    if (!data) return res.status(500).json({ error: 'Failed to compute ma-cross' })
    return res.status(200).json(data)
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}