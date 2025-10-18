import type { NextApiRequest, NextApiResponse } from 'next'
import { kvRefreshIfStale } from '@/lib/kv'
import { getYahooDailyOHLC } from '@/lib/providers/quote'

type Resp = { symbol: string; period: number; rsi: number|null; status?: 'BUY'|'SELL'|'HOLD'; points?: number|null|string }

const TTL_SEC = 300
const REVALIDATE_SEC = 30

function toCloses(ohlc: any): number[] {
  if (!ohlc) return []
  if (Array.isArray(ohlc)) {
    return ohlc
      .map((b: any) => (typeof b?.close === 'number' ? b.close : null))
      .filter((x: any) => typeof x === 'number') as number[]
  }
  if (Array.isArray(ohlc.closes)) {
    return ohlc.closes.filter((x: any) => typeof x === 'number') as number[]
  }
  return []
}

function computeRSI(closes: number[], period = 14): number | null {
  if (!Array.isArray(closes) || closes.length <= period) return null
  let gains = 0, losses = 0
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff >= 0) gains += diff
    else losses -= diff
  }
  const avgGain = gains / period
  const avgLoss = losses / period
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - (100 / (1 + rs))
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const symbol = String(req.query.symbol || '').trim().toUpperCase()
    const period = Number(req.query.period || 14) || 14
    if (!symbol) return res.status(400).json({ error: 'Missing symbol' })

    const key = `ind:rsi:${symbol}:${period}`

    const data = await kvRefreshIfStale<Resp>(
      key,
      TTL_SEC,
      REVALIDATE_SEC,
      async () => {
        const ohlc = await getYahooDailyOHLC(symbol, '1y')
        const closes = toCloses(ohlc)
        if (closes.length <= period) throw new Error('Not enough data')
        const rsi = computeRSI(closes, period)
        let status: 'BUY'|'SELL'|'HOLD' = 'HOLD'
        let points: number = 0
        if (rsi != null) {
          if (rsi < 30) { status = 'BUY'; points =  1 }
          else if (rsi > 70) { status = 'SELL'; points = -1 }
        }
        return { symbol, period, rsi, status, points }
      }
    )

    if (!data) return res.status(500).json({ error: 'Failed to compute' })
    res.status(200).json(data)
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) })
  }
}