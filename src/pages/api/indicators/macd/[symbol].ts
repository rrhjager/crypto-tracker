// src/pages/api/indicators/macd/[symbol].ts
export const config = { runtime: 'nodejs' }

import type { NextApiRequest, NextApiResponse } from 'next'
import { kvGetJSON, kvSetJSON, kvRefreshIfStale } from '@/lib/kv'
import { getYahooDailyCloses } from '@/lib/providers/quote'
import { macd as macdCalc } from '@/lib/ta'

type Resp = { symbol: string; fast: number; slow: number; signalPeriod: number; macd: number|null; signal: number|null; hist: number|null; status?: 'BUY'|'SELL'|'HOLD'; points?: number|null|string }
type Snap = { updatedAt: number; value: Resp }

const FAST = 12, SLOW = 26, SIG = 9
const TTL_SEC = 60 * 5
const REVALIDATE_SEC = 20

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const symbol = decodeURIComponent(String(req.query.symbol || '')).trim()
  if (!symbol) return res.status(400).json({ error: 'missing symbol' })

  const kvKey   = `ind:macd:${symbol}:${FAST}:${SLOW}:${SIG}`
  const snapKey = `ind:snap:macd:${symbol}`

  try {
    const resp = await kvRefreshIfStale<Resp>(
      kvKey,
      TTL_SEC,
      REVALIDATE_SEC,
      async () => {
        const closes = await getYahooDailyCloses(symbol, 270)
        const r = macdCalc(closes, FAST, SLOW, SIG)
        const value: Resp = { symbol, fast: FAST, slow: SLOW, signalPeriod: SIG, ...r }
        await kvSetJSON<Snap>(snapKey, { updatedAt: Date.now(), value }, TTL_SEC)
        return value
      }
    )

    if (resp) {
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
      return res.status(200).json(resp)
    }

    const closes = await getYahooDailyCloses(symbol, 270)
    const r = macdCalc(closes, FAST, SLOW, SIG)
    const value: Resp = { symbol, fast: FAST, slow: SLOW, signalPeriod: SIG, ...r }

    await kvSetJSON<Resp>(kvKey, value, TTL_SEC)
    await kvSetJSON<Snap>(snapKey, { updatedAt: Date.now(), value }, TTL_SEC)

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
    return res.status(200).json(value)
  } catch (e:any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}