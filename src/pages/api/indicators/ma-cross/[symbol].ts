// src/pages/api/indicators/ma-cross/[symbol].ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { kvGetJSON, kvSetJSON, kvRefreshIfStale } from '@/lib/kv'
import { getYahooDailyOHLC } from '@/lib/providers/quote'
import { maCross } from '@/lib/ta'
import { TTL_SEC, REVALIDATE_SEC, RANGE } from '../_config'

type Resp = { symbol: string; ma50: number|null; ma200: number|null; status?: 'BUY'|'SELL'|'HOLD'; points?: number|null|string }
type Snap = { updatedAt: number; value: Resp }

export const config = { runtime: 'nodejs' }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const symbol = String(req.query.symbol || '').trim()
    if (!symbol) return res.status(400).json({ error: 'symbol required' })

    const key = `ind:ma:${symbol}`
    const snapKey = `snap:ma:${symbol}`

    const data = await kvRefreshIfStale<Resp>(
      key,
      TTL_SEC,
      REVALIDATE_SEC,
      async () => {
        const ohlc = await getYahooDailyOHLC(symbol, RANGE)
        const closes = ohlc.map(x => x.close).filter(n => typeof n === 'number') as number[]
        if (closes.length < 50) {
          const value: Resp = { symbol, ma50: null, ma200: null }
          await kvSetJSON(snapKey, { updatedAt: Date.now(), value }, TTL_SEC)
          return value
        }
        const { ma50, ma200, status, points } = maCross(closes)
        const value: Resp = { symbol, ma50, ma200, status, points }
        await kvSetJSON(snapKey, { updatedAt: Date.now(), value }, TTL_SEC)
        return value
      }
    )

    if (data) return res.status(200).json(data)

    // Fallback: last snapshot if present
    const snap = await kvGetJSON<Snap>(snapKey)
    if (snap?.value) return res.status(200).json(snap.value)

    return res.status(500).json({ error: 'unable to compute' })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}