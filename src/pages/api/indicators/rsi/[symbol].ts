// src/pages/api/indicators/rsi/[symbol].ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { kvRefreshIfStale, kvSetJSON } from '@/lib/kv'
import { getYahooDailyOHLC } from '@/lib/providers/quote'
import { rsi as rsiCalc } from '@/lib/ta'

const TTL_SEC = 300
const REVALIDATE_SEC = 20
const RANGE: '1y' | '2y' = '1y'
const PERIOD = 14

type Resp = { symbol: string; period: number; rsi: number | null; status?: 'BUY' | 'SELL' | 'HOLD'; points?: number | null | string }
type Snap = { updatedAt: number; value: Resp }

function normalizeCloses(ohlc: any): number[] {
  if (Array.isArray(ohlc)) {
    return ohlc
      .map((b) => (typeof b?.close === 'number' ? b.close : null))
      .filter((n): n is number => typeof n === 'number')
  }
  if (ohlc && Array.isArray(ohlc.closes)) {
    return (ohlc.closes as any[]).filter((n): n is number => typeof n === 'number')
  }
  return []
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const symbol = String(req.query.symbol || '').trim().toUpperCase()
    if (!symbol) return res.status(400).json({ error: 'Missing symbol' })

    const key = `ind:rsi:${symbol}:${RANGE}:${PERIOD}`
    const snapKey = `ind:snap:rsi:${symbol}`

    const data = await kvRefreshIfStale<Resp>(
      key,
      TTL_SEC,
      REVALIDATE_SEC,
      async () => {
        const ohlc = await getYahooDailyOHLC(symbol, RANGE)
        const closes = normalizeCloses(ohlc)

        if (closes.length < PERIOD + 1) {
          const value: Resp = { symbol, period: PERIOD, rsi: null, status: 'HOLD', points: 0 }
          try { await kvSetJSON(snapKey, { updatedAt: Date.now(), value }, TTL_SEC) } catch {}
          return value
        }

        const { rsi, status, points } = rsiCalc(closes, PERIOD)
        const value: Resp = { symbol, period: PERIOD, rsi, status, points }
        try { await kvSetJSON(snapKey, { updatedAt: Date.now(), value }, TTL_SEC) } catch {}
        return value
      }
    )

    if (!data) return res.status(500).json({ error: 'Failed to compute rsi' })
    return res.status(200).json(data)
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}