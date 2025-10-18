// src/pages/api/indicators/rsi/[symbol].ts
export const config = { runtime: 'nodejs' }

import type { NextApiRequest, NextApiResponse } from 'next'
import { kvGetJSON, kvSetJSON, kvRefreshIfStale } from '@/lib/kv'
import { getYahooDailyCloses } from '@/lib/providers/quote'
import { rsi as rsiCalc } from '@/lib/ta'

type Resp = { symbol: string; period: number; rsi: number|null; status?: 'BUY'|'SELL'|'HOLD'; points?: number|null|string }
type Snap = { updatedAt: number; value: Resp }

const PERIOD = 14
const TTL_SEC = 60 * 5
const REVALIDATE_SEC = 20

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const symbol = decodeURIComponent(String(req.query.symbol || '')).trim()
  if (!symbol) return res.status(400).json({ error: 'missing symbol' })

  const kvKey   = `ind:rsi:${symbol}:${PERIOD}`
  const snapKey = `ind:snap:rsi:${symbol}`

  try {
    const resp = await kvRefreshIfStale<Resp>(
      kvKey,
      TTL_SEC,
      REVALIDATE_SEC,
      async () => {
        const closes = await getYahooDailyCloses(symbol, 270)
        const r = rsiCalc(closes, PERIOD)
        const value: Resp = { symbol, period: PERIOD, ...r }
        await kvSetJSON<Snap>(snapKey, { updatedAt: Date.now(), value }, TTL_SEC)
        return value
      }
    )

    if (resp) {
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
      return res.status(200).json(resp)
    }

    const closes = await getYahooDailyCloses(symbol, 270)
    const r = rsiCalc(closes, PERIOD)
    const value: Resp = { symbol, period: PERIOD, ...r }

    await kvSetJSON<Resp>(kvKey, value, TTL_SEC)
    await kvSetJSON<Snap>(snapKey, { updatedAt: Date.now(), value }, TTL_SEC)

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
    return res.status(200).json(value)
  } catch (e:any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}