// src/pages/api/indicators/macd/[symbol].ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { kvGetJSON, kvSetJSON, kvRefreshIfStale } from '@/lib/kv'
import { getYahooDailyOHLC } from '@/lib/providers/quote'
import { macd } from '@/lib/ta'
import { TTL_SEC, REVALIDATE_SEC, RANGE } from '../_config'

type Resp = { symbol: string; fast: number; slow: number; signalPeriod: number; macd: number|null; signal: number|null; hist: number|null; status?: 'BUY'|'SELL'|'HOLD'; points?: number|null|string }
type Snap = { updatedAt: number; value: Resp }

export const config = { runtime: 'nodejs' }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const symbol = String(req.query.symbol || '').trim()
    const key = `ind:macd:${symbol}`
    const snapKey = `snap:macd:${symbol}`

    const data = await kvRefreshIfStale<Resp>(key, TTL_SEC, REVALIDATE_SEC, async () => {
      const ohlc = await getYahooDailyOHLC(symbol, RANGE)
      const closes = ohlc.map(x => x.close)
      const m = macd(closes, 12, 26, 9)
      const value: Resp = { symbol, fast: m.fast, slow: m.slow, signalPeriod: m.signalPeriod, macd: m.macd, signal: m.signal, hist: m.hist, status: m.status, points: m.points }
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