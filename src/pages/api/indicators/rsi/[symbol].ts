import type { NextApiRequest, NextApiResponse } from 'next'
import { kvRefreshIfStale, kvSetJSON } from '@/lib/kv'
import { getYahooDailyOHLC } from '@/lib/providers/quote'

type Resp = {
  symbol: string
  period: number
  rsi: number | null
  status?: 'BUY' | 'SELL' | 'HOLD'
  points?: number | string | null
}

const TTL_SEC = 300
const REVALIDATE_SEC = 25

function rsiFromCloses(closes: number[], period = 14): number | null {
  if (closes.length <= period) return null
  const gains: number[] = []
  const losses: number[] = []
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    gains.push(Math.max(0, diff))
    losses.push(Math.max(0, -diff))
  }
  const g = gains.slice(-(period)).reduce((a, b) => a + b, 0) / period
  const l = losses.slice(-(period)).reduce((a, b) => a + b, 0) / period
  if (l === 0) return 100
  const rs = g / l
  return +((100 - 100 / (1 + rs)).toFixed(2))
}

function statusFromRsi(rsi: number | null): { status: Resp['status']; points: number } {
  if (rsi == null) return { status: 'HOLD', points: 0 }
  if (rsi <= 30) return { status: 'BUY', points: 2 }
  if (rsi >= 70) return { status: 'SELL', points: -2 }
  return { status: 'HOLD', points: 0 }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const symbol = String(req.query.symbol || '').trim()
    const period = Math.max(2, Number(req.query.period || 14))
    if (!symbol) return res.status(400).json({ error: 'Missing symbol' })

    const key = `ind:rsi:${symbol}:${period}`
    const snapKey = `${key}__snap`

    const data = await kvRefreshIfStale<Resp>(
      key,
      TTL_SEC,
      REVALIDATE_SEC,
      async () => {
        const ohlc = await getYahooDailyOHLC(symbol, '6mo')
        const closes = (ohlc || [])
          .map((c: any) => (typeof c?.close === 'number' ? c.close : null))
          .filter((x: any) => typeof x === 'number') as number[]

        if (closes.length <= period) {
          const empty: Resp = { symbol, period, rsi: null, status: 'HOLD', points: 0 }
          await kvSetJSON(key, empty, TTL_SEC)
          return empty
        }

        const rsi = rsiFromCloses(closes, period)
        const { status, points } = statusFromRsi(rsi)
        const value: Resp = { symbol, period, rsi, status, points }
        await kvSetJSON(snapKey, { updatedAt: Date.now(), value }, TTL_SEC)
        return value
      }
    )

    if (!data) return res.status(500).json({ error: 'Failed to compute RSI' })
    return res.status(200).json(data)
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}