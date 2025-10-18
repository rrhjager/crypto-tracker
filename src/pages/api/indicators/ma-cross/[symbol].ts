// src/pages/api/indicators/ma-cross/[symbol].ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { kvRefreshIfStale, kvSetJSON } from '@/lib/kv'
import { getYahooDailyOHLC } from '@/lib/providers/quote'
import { maCross } from '@/lib/ta'

// Inline config (no _config import)
const TTL_SEC = 300;          // cache in KV for 5 min
const REVALIDATE_SEC = 20;    // refresh in background when ~about to expire
const RANGE: '1y' | '2y' = '1y';

type Resp = { symbol: string; ma50: number | null; ma200: number | null; status?: 'BUY' | 'SELL' | 'HOLD'; points?: number | null | string }
type Snap = { updatedAt: number; value: Resp }

// Normalize provider output (array bars or object arrays)
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

    const key = `ind:ma:${symbol}:${RANGE}`
    const snapKey = `ind:snap:ma:${symbol}`

    const data = await kvRefreshIfStale<Resp>(
      key,
      TTL_SEC,
      REVALIDATE_SEC,
      async () => {
        const ohlc = await getYahooDailyOHLC(symbol, RANGE)
        const closes = normalizeCloses(ohlc)

        if (closes.length < 50) {
          // Not enough data — still return a valid shape
          const value: Resp = { symbol, ma50: null, ma200: null, status: 'HOLD', points: 0 }
          try { await kvSetJSON(snapKey, { updatedAt: Date.now(), value }, TTL_SEC) } catch {}
          return value
        }

        const { ma50, ma200, status, points } = maCross(closes)
        const value: Resp = { symbol, ma50, ma200, status, points }
        try { await kvSetJSON(snapKey, { updatedAt: Date.now(), value }, TTL_SEC) } catch {}
        return value
      }
    )

    if (!data) return res.status(500).json({ error: 'Failed to compute ma-cross' })
    return res.status(200).json(data)
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}