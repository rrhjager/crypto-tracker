import type { NextApiRequest, NextApiResponse } from 'next'
import { kvRefreshIfStale } from '@/lib/kv'
import { getYahooDailyOHLC } from '@/lib/providers/quote'

type Resp = {
  symbol: string
  period: number
  volume: number|null
  avg20: number|null
  ratio: number|null
  status?: 'BUY'|'SELL'|'HOLD'
  points?: number|null|string
}

const TTL_SEC = 300
const REVALIDATE_SEC = 30

function toVolumes(ohlc: any): number[] {
  if (!ohlc) return []
  if (Array.isArray(ohlc)) {
    return ohlc
      .map((b: any) => (typeof b?.volume === 'number' ? b.volume : null))
      .filter((x: any) => typeof x === 'number') as number[]
  }
  if (Array.isArray(ohlc.volumes)) {
    return ohlc.volumes.filter((x: any) => typeof x === 'number') as number[]
  }
  return []
}

function avgN(vals: number[], n: number): number | null {
  if (!Array.isArray(vals) || vals.length < n) return null
  const slice = vals.slice(-n)
  return slice.reduce((a, b) => a + b, 0) / n
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const symbol = String(req.query.symbol || '').trim().toUpperCase()
    const period = Number(req.query.period || 20) || 20
    if (!symbol) return res.status(400).json({ error: 'Missing symbol' })

    const key = `ind:vol20:${symbol}:${period}`

    const data = await kvRefreshIfStale<Resp>(
      key,
      TTL_SEC,
      REVALIDATE_SEC,
      async () => {
        const ohlc = await getYahooDailyOHLC(symbol, '1y')
        const vols = toVolumes(ohlc)
        if (vols.length < period) throw new Error('Not enough data')

        const volume = vols[vols.length - 1] ?? null
        const avg20 = avgN(vols, period)
        const ratio = (typeof volume === 'number' && typeof avg20 === 'number' && avg20 > 0) ? volume / avg20 : null
        let status: 'BUY'|'SELL'|'HOLD' = 'HOLD'
        let points = 0
        if (typeof ratio === 'number') {
          if (ratio > 1.2) { status = 'BUY'; points =  1 }
          else if (ratio < 0.8) { status = 'SELL'; points = -1 }
        }
        return { symbol, period, volume, avg20, ratio, status, points }
      }
    )

    if (!data) return res.status(500).json({ error: 'Failed to compute' })
    res.status(200).json(data)
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) })
  }
}