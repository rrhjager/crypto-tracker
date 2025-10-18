import type { NextApiRequest, NextApiResponse } from 'next'
import { kvRefreshIfStale, kvSetJSON } from '@/lib/kv'
import { getYahooDailyOHLC } from '@/lib/providers/quote'

type Resp = {
  symbol: string
  ma50: number | null
  ma200: number | null
  status?: 'BUY' | 'SELL' | 'HOLD'
  points?: number | string | null
}

const TTL_SEC = 300
const REVALIDATE_SEC = 25

function sma(arr: number[], n: number): number | null {
  const slice = arr.slice(-n)
  if (slice.length < n) return null
  const s = slice.reduce((a, b) => a + b, 0)
  return +(s / n).toFixed(2)
}

function maCrossFromCloses(closes: number[]) {
  const ma50 = sma(closes, 50)
  const ma200 = sma(closes, 200)
  let status: Resp['status'] = 'HOLD'
  let points = 0
  if (ma50 != null && ma200 != null) {
    if (ma50 > ma200) { status = 'BUY'; points = 2 }
    else if (ma50 < ma200) { status = 'SELL'; points = -2 }
  }
  return { ma50, ma200, status, points }
}

/** --- NEW: normalize helper (accepteert array of object) --- */
function extractCloses(data: any): number[] {
  if (!data) return []
  if (Array.isArray(data)) {
    // array van candles { close: number }
    return data
      .map((c) => (c && typeof c.close === 'number' ? c.close : null))
      .filter((x): x is number => typeof x === 'number')
  }
  if (Array.isArray(data.closes)) {
    return data.closes.filter((x: any) => typeof x === 'number')
  }
  return []
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const symbol = String(req.query.symbol || '').trim()
    if (!symbol) return res.status(400).json({ error: 'Missing symbol' })

    const key = `ind:ma:${symbol}`
    const snapKey = `${key}__snap`

    const data = await kvRefreshIfStale<Resp>(
      key,
      TTL_SEC,
      REVALIDATE_SEC,
      async () => {
        const ohlc = await getYahooDailyOHLC(symbol, '1y') // jouw helper
        const closes = extractCloses(ohlc)

        if (closes.length < 50) {
          const empty: Resp = { symbol, ma50: null, ma200: null, status: 'HOLD', points: 0 }
          await kvSetJSON(key, empty, TTL_SEC)
          return empty
        }

        const { ma50, ma200, status, points } = maCrossFromCloses(closes)
        const value: Resp = { symbol, ma50, ma200, status, points }
        await kvSetJSON(snapKey, { updatedAt: Date.now(), value }, TTL_SEC)
        return value
      }
    )

    if (!data) return res.status(500).json({ error: 'Failed to compute MA cross' })
    return res.status(200).json(data)
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}