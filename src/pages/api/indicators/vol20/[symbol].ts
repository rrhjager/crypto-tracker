// src/pages/api/indicators/vol20/[symbol].ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { kvRefreshIfStale, kvSetJSON } from '@/lib/kv'
import { getYahooDailyOHLC } from '@/lib/providers/quote'
import { vol20 as vol20Calc } from '@/lib/ta'

const TTL_SEC = 300
const REVALIDATE_SEC = 20
const RANGE: '1y' | '2y' = '1y'
const PERIOD = 20

type Resp = { symbol: string; period: number; volume: number | null; avg20: number | null; ratio: number | null; status?: 'BUY' | 'SELL' | 'HOLD'; points?: number | null | string }
type Snap = { updatedAt: number; value: Resp }

function normalizeVolumes(ohlc: any): number[] {
  if (Array.isArray(ohlc)) {
    return ohlc
      .map((b) => (typeof b?.volume === 'number' ? b.volume : null))
      .filter((n): n is number => typeof n === 'number')
  }
  if (ohlc && Array.isArray(ohlc.volumes)) {
    return (ohlc.volumes as any[]).filter((n): n is number => typeof n === 'number')
  }
  return []
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const symbol = String(req.query.symbol || '').trim().toUpperCase()
    if (!symbol) return res.status(400).json({ error: 'Missing symbol' })

    const key = `ind:vol:${symbol}:${RANGE}:${PERIOD}`
    const snapKey = `ind:snap:vol:${symbol}`

    const data = await kvRefreshIfStale<Resp>(
      key,
      TTL_SEC,
      REVALIDATE_SEC,
      async () => {
        const ohlc = await getYahooDailyOHLC(symbol, RANGE)
        const volumes = normalizeVolumes(ohlc)

        if (volumes.length < PERIOD + 1) {
          const value: Resp = { symbol, period: PERIOD, volume: null, avg20: null, ratio: null, status: 'HOLD', points: 0 }
          try { await kvSetJSON(snapKey, { updatedAt: Date.now(), value }, TTL_SEC) } catch {}
          return value
        }

        const { volume, avg20, ratio, status, points } = vol20Calc(volumes, PERIOD)
        const value: Resp = { symbol, period: PERIOD, volume, avg20, ratio, status, points }
        try { await kvSetJSON(snapKey, { updatedAt: Date.now(), value }, TTL_SEC) } catch {}
        return value
      }
    )

    if (!data) return res.status(500).json({ error: 'Failed to compute vol20' })
    return res.status(200).json(data)
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}