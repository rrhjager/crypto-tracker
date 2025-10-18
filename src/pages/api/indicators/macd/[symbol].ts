// src/pages/api/indicators/macd/[symbol].ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { kvRefreshIfStale, kvSetJSON } from '@/lib/kv'
import { getYahooDailyOHLC } from '@/lib/providers/quote'
import { macd as macdCalc } from '@/lib/ta'

const TTL_SEC = 300
const REVALIDATE_SEC = 20
const RANGE: '1y' | '2y' = '1y'
const FAST = 12, SLOW = 26, SIGNAL = 9

type Resp = { symbol: string; fast: number; slow: number; signalPeriod: number; macd: number | null; signal: number | null; hist: number | null; status?: 'BUY' | 'SELL' | 'HOLD'; points?: number | null | string }
type Snap = { updatedAt: number; value: Resp }

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

    const key = `ind:macd:${symbol}:${RANGE}:${FAST}-${SLOW}-${SIGNAL}`
    const snapKey = `ind:snap:macd:${symbol}`

    const data = await kvRefreshIfStale<Resp>(
      key,
      TTL_SEC,
      REVALIDATE_SEC,
      async () => {
        const ohlc = await getYahooDailyOHLC(symbol, RANGE)
        const closes = normalizeCloses(ohlc)

        if (closes.length < SLOW + SIGNAL) {
          const value: Resp = { symbol, fast: FAST, slow: SLOW, signalPeriod: SIGNAL, macd: null, signal: null, hist: null, status: 'HOLD', points: 0 }
          try { await kvSetJSON(snapKey, { updatedAt: Date.now(), value }, TTL_SEC) } catch {}
          return value
        }

        const { macd, signal, hist, status, points } = macdCalc(closes, FAST, SLOW, SIGNAL)
        const value: Resp = { symbol, fast: FAST, slow: SLOW, signalPeriod: SIGNAL, macd, signal, hist, status, points }
        try { await kvSetJSON(snapKey, { updatedAt: Date.now(), value }, TTL_SEC) } catch {}
        return value
      }
    )

    if (!data) return res.status(500).json({ error: 'Failed to compute macd' })
    return res.status(200).json(data)
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}