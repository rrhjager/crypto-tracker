import type { NextApiRequest, NextApiResponse } from 'next'
import { kvRefreshIfStale } from '@/lib/kv'
import { getYahooDailyOHLC } from '@/lib/providers/quote'

type Resp = {
  symbol: string
  fast: number; slow: number; signalPeriod: number
  macd: number|null; signal: number|null; hist: number|null
  status?: 'BUY'|'SELL'|'HOLD'; points?: number|null|string
}

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

function ema(values: number[], p: number): number[] {
  const k = 2 / (p + 1)
  const out: number[] = []
  let prev = values[0]
  out.push(prev)
  for (let i = 1; i < values.length; i++) {
    const v = values[i] * k + prev * (1 - k)
    out.push(v)
    prev = v
  }
  return out
}

function computeMACD(closes: number[], fast=12, slow=26, signalP=9) {
  if (closes.length < slow + signalP) return { macd: null, signal: null, hist: null }
  const emaFast = ema(closes, fast)
  const emaSlow = ema(closes, slow)
  const macdLine = emaFast.map((v, i) => v - (emaSlow[i] ?? v))
  const signalLine = ema(macdLine.slice(-(slow + signalP)), signalP) // voldoende staart
  const macd = macdLine[macdLine.length - 1]
  const signal = signalLine[signalLine.length - 1]
  const hist = (macd != null && signal != null) ? macd - signal : null
  return { macd, signal, hist }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const symbol = String(req.query.symbol || '').trim().toUpperCase()
    const fast = Number(req.query.fast || 12) || 12
    const slow = Number(req.query.slow || 26) || 26
    const signalPeriod = Number(req.query.signal || 9) || 9
    if (!symbol) return res.status(400).json({ error: 'Missing symbol' })

    const key = `ind:macd:${symbol}:${fast}:${slow}:${signalPeriod}`

    const data = await kvRefreshIfStale<Resp>(
      key,
      TTL_SEC,
      REVALIDATE_SEC,
      async () => {
        const ohlc = await getYahooDailyOHLC(symbol, '1y')
        const closes = toCloses(ohlc)
        const { macd, signal, hist } = computeMACD(closes, fast, slow, signalPeriod)
        let status: 'BUY'|'SELL'|'HOLD' = 'HOLD'
        let points = 0
        if (typeof hist === 'number') { status = hist > 0 ? 'BUY' : hist < 0 ? 'SELL' : 'HOLD'; points = hist > 0 ? 1 : hist < 0 ? -1 : 0 }
        return { symbol, fast, slow, signalPeriod, macd, signal, hist, status, points }
      }
    )

    if (!data) return res.status(500).json({ error: 'Failed to compute' })
    res.status(200).json(data)
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) })
  }
}