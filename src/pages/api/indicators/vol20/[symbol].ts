import type { NextApiRequest, NextApiResponse } from 'next'
import { kvRefreshIfStale, kvSetJSON } from '@/lib/kv'
import { getYahooDailyOHLC } from '@/lib/providers/quote'

type Resp = {
  symbol: string
  period: number
  volume: number | null
  avg20: number | null
  ratio: number | null
  status?: 'BUY' | 'SELL' | 'HOLD'
  points?: number | string | null
}

const TTL_SEC = 300
const REVALIDATE_SEC = 25
const PERIOD = 20

function volStatus(ratio: number | null): { status: Resp['status']; points: number } {
  if (ratio == null || !Number.isFinite(ratio)) return { status: 'HOLD', points: 0 }
  if (ratio >= 1.3) return { status: 'BUY', points: 2 }
  if (ratio <= 0.7) return { status: 'SELL', points: -2 }
  return { status: 'HOLD', points: 0 }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const symbol = String(req.query.symbol || '').trim()
    if (!symbol) return res.status(400).json({ error: 'Missing symbol' })

    const key = `ind:vol20:${symbol}`
    const snapKey = `${key}__snap`

    const data = await kvRefreshIfStale<Resp>(
      key,
      TTL_SEC,
      REVALIDATE_SEC,
      async () => {
        const ohlc = await getYahooDailyOHLC(symbol, '6mo')
        const volumes = (ohlc || [])
          .map((c: any) => (typeof c?.volume === 'number' ? c.volume : null))
          .filter((x: any) => typeof x === 'number') as number[]

        const volume = volumes.length ? volumes[volumes.length - 1] : null
        const slice = volumes.slice(-PERIOD)
        const avg20 = slice.length ? Math.round(slice.reduce((a, b) => a + b, 0) / slice.length) : null
        const ratio = volume != null && avg20 != null && avg20 > 0 ? Number((volume / avg20).toFixed(2)) : null

        const { status, points } = volStatus(ratio)
        const value: Resp = { symbol, period: PERIOD, volume, avg20, ratio, status, points }
        await kvSetJSON(snapKey, { updatedAt: Date.now(), value }, TTL_SEC)
        return value
      }
    )

    if (!data) return res.status(500).json({ error: 'Failed to compute vol20' })
    return res.status(200).json(data)
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}