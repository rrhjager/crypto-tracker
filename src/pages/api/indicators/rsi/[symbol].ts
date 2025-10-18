// src/pages/api/indicators/rsi/[symbol].ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { kvGetJSON, kvSetJSON, kvRefreshIfStale } from '@/lib/kv'
import { getYahooDailyOHLC } from '@/lib/providers/quote'
import { rsi14 } from '@/lib/ta'
import { TTL_SEC, REVALIDATE_SEC, RANGE } from '../_config'

type Resp = { symbol: string; period: number; rsi: number|null; status?: 'BUY'|'SELL'|'HOLD'; points?: number|null|string }
type Snap = { updatedAt: number; value: Resp }

export const config = { runtime: 'nodejs' }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const symbol = String(req.query.symbol || '').trim()
    const key = `ind:rsi:${symbol}`
    const snapKey = `snap:rsi:${symbol}`

    const data = await kvRefreshIfStale<Resp>(key, TTL_SEC, REVALIDATE_SEC, async () => {
      const ohlc = await getYahooDailyOHLC(symbol, RANGE)
      const closes = ohlc.map(x => x.close)
      const r = rsi14(closes)
      const value: Resp = { symbol, period: r.period, rsi: r.rsi, status: r.status, points: r.points }
      await kvSetJSON(snapKey, { updatedAt: Date.now(), value }, TTL_SEC)
      return value
    })

    if (data) return res.status(200).json(data)
    const snap = await kvGetJSON<Snap>(snapKey)
    if (snap?.value) return res.status(200).json(snap.value)
    return res.status(500).json({ error: 'unable to compute' })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}