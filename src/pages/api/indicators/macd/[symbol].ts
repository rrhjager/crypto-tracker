import type { NextApiRequest, NextApiResponse } from 'next'
import { kvRefreshIfStale, kvSetJSON } from '@/lib/kv'
import { getYahooDailyOHLC } from '@/lib/providers/quote'

type Resp = {
  symbol: string
  fast: number
  slow: number
  signalPeriod: number
  macd: number | null
  signal: number | null
  hist: number | null
  status?: 'BUY' | 'SELL' | 'HOLD'
  points?: number | string | null
}

const TTL_SEC = 300
const REVALIDATE_SEC = 25

function extractCloses(data: any): number[] {
  if (!data) return []
  if (Array.isArray(data)) {
    return data
      .map((c) => (c && typeof c.close === 'number' ? c.close : null))
      .filter((x): x is number => typeof x === 'number')
  }
  if (Array.isArray(data.closes)) {
    return data.closes.filter((x: any) => typeof x === 'number')
  }
  return []
}

function ema(values: number[], p: number): number[] {
  if (values.length === 0) return []
  const k = 2 / (p + 1)
  const out: number[] = []
  let prev = values[0]
  out.push(prev)
  for (let i = 1; i < values.length; i++) {
    const cur = values[i] * k + prev * (1 - k)
    out.push(cur)
    prev = cur
  }
  return out
}

function macdFromCloses(closes: number[], fast = 12, slow = 26, signalP = 9) {
  if (closes.length < slow + signalP) return { macd: null, signal: null, hist: null }
  const emaFast = ema(closes, fast)
  const emaSlow = ema(closes, slow)
  const macdLine = emaFast.map((v, i) => v - (emaSlow[i] ?? v))
  const signalLine = ema(macdLine, signalP)
  const macd = macdLine[macdLine.length - 1]
  const signal = signalLine[signalLine.length - 1]
  const hist = macd - signal
  return { macd: +macd.toFixed(4), signal: +signal.toFixed(4), hist: +hist.toFixed(4) }
}

function statusFromHist(hist: number | null): { status: Resp['status']; points: number } {
  if (hist == null) return { status: 'HOLD', points: 0 }
  if (hist > 0) return { status: 'BUY', points: 1 }
  if (hist < 0) return { status: 'SELL', points: -1 }
  return { status: 'HOLD', points: 0 }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const symbol = String(req.query.symbol || '').trim()
    const fast = Math.max(2, Number(req.query.fast || 12))
    const slow = Math.max(fast + 1, Number(req.query.slow || 26))
    const signalPeriod = Math.max(2, Number(req.query.signal || 9))
    if (!symbol) return res.status(400).json({ error: 'Missing symbol' })

    const key = `ind:macd:${symbol}:${fast}:${slow}:${signalPeriod}`
    const snapKey = `${key}__snap`

    const data = await kvRefreshIfStale<Resp>(
      key,
      TTL_SEC,
      REVALIDATE_SEC,
      async () => {
        const ohlc = await getYahooDailyOHLC(symbol, '1y')
        const closes = extractCloses(ohlc)

        const { macd, signal, hist } = macdFromCloses(closes, fast, slow, signalPeriod)
        const { status, points } = statusFromHist(hist)
        const value: Resp = { symbol, fast, slow, signalPeriod, macd, signal, hist, status, points }
        await kvSetJSON(snapKey, { updatedAt: Date.now(), value }, TTL_SEC)
        return value
      }
    )

    if (!data) return res.status(500).json({ error: 'Failed to compute MACD' })
    return res.status(200).json(data)
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}