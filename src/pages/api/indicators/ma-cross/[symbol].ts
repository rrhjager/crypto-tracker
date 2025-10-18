// src/pages/api/indicators/ma-cross/[symbol].ts
export const config = { runtime: 'nodejs' }

import type { NextApiRequest, NextApiResponse } from 'next'
import { kvGetJSON, kvSetJSON, kvRefreshIfStale } from '@/lib/kv'
import { getYahooDailyCloses } from '@/lib/providers/quote' // your yahoo helper
import { maCross } from '@/lib/ta'

type Resp = { symbol: string; ma50: number|null; ma200: number|null; status?: 'BUY'|'SELL'|'HOLD'; points?: number|null|string }
type Snap = { updatedAt: number; value: Resp }

const TTL_SEC = 60 * 5       // 5 min cache in KV
const REVALIDATE_SEC = 20     // SWR background refresh when ≤ 20s remain

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const symbol = decodeURIComponent(String(req.query.symbol || '')).trim()
  if (!symbol) return res.status(400).json({ error: 'missing symbol' })

  const kvKey   = `ind:ma:${symbol}`
  const snapKey = `ind:snap:ma:${symbol}`

  try {
    // ==== 1) try KV + SWR ====
    const resp = await kvRefreshIfStale<Resp>(
      kvKey,
      TTL_SEC,
      REVALIDATE_SEC,
      async () => {
        const closes = await getYahooDailyCloses(symbol, 270) // ~1y
        const { ma50, ma200, status, points } = maCross(closes)
        const value: Resp = { symbol, ma50, ma200, status, points }
        // best effort: snapshot (used on home for "minuteTag" backfill)
        await kvSetJSON<Snap>(snapKey, { updatedAt: Date.now(), value }, TTL_SEC)
        return value
      }
    )

    if (resp) {
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
      return res.status(200).json(resp)
    }

    // ==== 2) fall back to direct compute (and still try to cache) ====
    const closes = await getYahooDailyCloses(symbol, 270)
    const { ma50, ma200, status, points } = maCross(closes)
    const value: Resp = { symbol, ma50, ma200, status, points }

    await kvSetJSON<Resp>(kvKey, value, TTL_SEC)
    await kvSetJSON<Snap>(snapKey, { updatedAt: Date.now(), value }, TTL_SEC)

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
    return res.status(200).json(value)
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}