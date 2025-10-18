import type { NextApiRequest, NextApiResponse } from 'next'
import { kvGetJSON, kvSetJSON, kvRefreshIfStale } from '@/lib/kv'
import { getYahooDailyOHLC } from '@/lib/providers/quote'

type Resp = { symbol: string; ma50: number|null; ma200: number|null; status?: 'BUY'|'SELL'|'HOLD'; points?: number|null|string }

const TTL_SEC = 300        // 5m cache in KV
const REVALIDATE_SEC = 30  // treshold om background refresh te trigggeren

// Eenvoudige SMA
function sma(vals: number[], n: number): number | null {
  if (!Array.isArray(vals) || vals.length < n) return null
  const slice = vals.slice(-n)
  const sum = slice.reduce((a, b) => a + b, 0)
  return sum / n
}

// Ma-cross berekening
function computeMaCross(closes: number[]): { ma50: number|null; ma200: number|null; status: 'BUY'|'SELL'|'HOLD'; points: number } {
  const ma50 = sma(closes, 50)
  const ma200 = sma(closes, 200)
  let status: 'BUY'|'SELL'|'HOLD' = 'HOLD'
  let points = 0
  if (ma50 != null && ma200 != null) {
    if (ma50 > ma200) { status = 'BUY';  points =  2 }
    else if (ma50 < ma200) { status = 'SELL'; points = -2 }
  }
  return { ma50, ma200, status, points }
}

// Normaliseer OHLC → closes[]
function toCloses(ohlc: any): number[] {
  if (!ohlc) return []
  // vorm 1: array van bars
  if (Array.isArray(ohlc)) {
    return ohlc
      .map((b: any) => (typeof b?.close === 'number' ? b.close : null))
      .filter((x: any) => typeof x === 'number') as number[]
  }
  // vorm 2: object met arrays
  if (Array.isArray(ohlc.closes)) {
    return ohlc.closes.filter((x: any) => typeof x === 'number') as number[]
  }
  return []
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const symbol = String(req.query.symbol || '').trim().toUpperCase()
    if (!symbol) return res.status(400).json({ error: 'Missing symbol' })

    const key = `ind:ma:${symbol}`
    const snapKey = `ind:ma:snap:${symbol}`

    const data = await kvRefreshIfStale<Resp>(
      key,
      TTL_SEC,
      REVALIDATE_SEC,
      async () => {
        const ohlc = await getYahooDailyOHLC(symbol, '1y')
        const closes = toCloses(ohlc)
        if (closes.length < 50) throw new Error('Not enough data')

        const { ma50, ma200, status, points } = computeMaCross(closes)
        const value: Resp = { symbol, ma50, ma200, status, points }
        // snapshot voor snelle fallback elders
        await kvSetJSON(snapKey, { updatedAt: Date.now(), value }, TTL_SEC)
        return value
      }
    )

    if (!data) return res.status(500).json({ error: 'Failed to compute' })
    res.status(200).json(data)
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) })
  }
}