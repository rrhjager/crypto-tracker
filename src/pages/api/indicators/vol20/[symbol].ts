// src/pages/api/indicators/vol20/[symbol].ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { sma } from '@/lib/ta'
import { kvGetJSON, kvSetJSON, kvRefreshIfStale } from '@/lib/kv'

type Resp = {
  symbol: string
  period: number
  volume: number | null
  avg20: number | null
  ratio: number | null
  status: 'BUY' | 'HOLD' | 'SELL'
  points: number
}

async function okJson<T>(r: Response): Promise<T> {
  const j = await r.json()
  return j as T
}

const STALE_MS = 20_000 // ~20s SWR-refresh

async function compute(raw: string, perIn: number): Promise<Resp> {
  const period = Number.isFinite(perIn) && perIn > 0 ? perIn : 20

  // 1 jaar, dag-candles — zelfde bron/logica als huidige endpoint
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(raw)}?interval=1d&range=1y`
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const j: any = await okJson(r)

  const vols: number[] = (j?.chart?.result?.[0]?.indicators?.quote?.[0]?.volume || [])
    .map((v: any) => Number(v))
    .filter((v: number) => Number.isFinite(v))

  const avgArr = sma(vols, period)
  const lastVol = vols.at(-1)
  const lastAvg = avgArr.at(-1)

  // Simple regels:
  // ratio >= 1.5 => BUY
  // ratio <= 0.5 => SELL
  // anders HOLD
  const ratio = (Number.isFinite(lastVol) && Number.isFinite(lastAvg) && (lastAvg as number) > 0)
    ? (lastVol as number) / (lastAvg as number)
    : NaN

  let status: 'BUY' | 'HOLD' | 'SELL' = 'HOLD'
  let points = 0
  if (Number.isFinite(ratio)) {
    if ((ratio as number) >= 1.5) { status = 'BUY'; points = 1 }
    else if ((ratio as number) <= 0.5) { status = 'SELL'; points = -1 }
    else { status = 'HOLD'; points = 0 }
  }

  return {
    symbol: raw,
    period,
    volume: Number.isFinite(lastVol) ? (lastVol as number) : null,
    avg20: Number.isFinite(lastAvg) ? (lastAvg as number) : null,
    ratio: Number.isFinite(ratio) ? (ratio as number) : null,
    status,
    points,
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Resp | { error: string } | any>
) {
  try {
    const raw = String(req.query.symbol || '').trim()
    const period = Number(req.query.period || 20)
    if (!raw) return res.status(400).json({ error: 'symbol is required' })

    // KV key bevat ook de period-parameter
    const kvKey = `ind:vol20:${raw.toUpperCase()}:${Number.isFinite(period) && period > 0 ? period : 20}`

    // 1) Directe snapshot uit KV voor snelle response
    const snap = await kvGetJSON<{ value: Resp; updatedAt: number }>(kvKey)

    if (snap && snap.value) {
      // 2) SWR: asynchroon verversen als stale
      kvRefreshIfStale(kvKey, snap.updatedAt, STALE_MS, async () => {
        const value = await compute(raw, period)
        await kvSetJSON(kvKey, { value, updatedAt: Date.now() })
      }).catch(() => {})

      return res.status(200).json(snap.value)
    }import type { NextApiRequest, NextApiResponse } from 'next'
    import { kvRefreshIfStale, kvSetJSON } from '@/lib/kv'
    import { getYahooDailyOHLC } from '@/lib/providers/quote'
    
    type Resp = {
      symbol: string
      period: number
      volume: number | null
      avg20: number | null
      ratio: number | null
      status?: 'BUY' | 'SELL' | 'HOLD'
      points?: number | string | null
    }
    
    const TTL_SEC = 300
    const REVALIDATE_SEC = 25
    const PERIOD = 20
    
    function extractVolumes(data: any): number[] {
      if (!data) return []
      if (Array.isArray(data)) {
        return data
          .map((c) => (c && typeof c.volume === 'number' ? c.volume : null))
          .filter((x): x is number => typeof x === 'number')
      }
      if (Array.isArray(data.volumes)) {
        return data.volumes.filter((x: any) => typeof x === 'number')
      }
      return []
    }
    
    function volStatus(ratio: number | null): { status: Resp['status']; points: number } {
      if (ratio == null || !Number.isFinite(ratio)) return { status: 'HOLD', points: 0 }
      if (ratio >= 1.3) return { status: 'BUY', points: 2 }
      if (ratio <= 0.7) return { status: 'SELL', points: -2 }
      return { status: 'HOLD', points: 0 }
    }
    
    export default async function handler(req: NextApiRequest, res: NextApiResponse) {
      try {
        const symbol = String(req.query.symbol || '').trim()
        if (!symbol) return res.status(400).json({ error: 'Missing symbol' })
    
        const key = `ind:vol20:${symbol}`
        const snapKey = `${key}__snap`
    
        const data = await kvRefreshIfStale<Resp>(
          key,
          TTL_SEC,
          REVALIDATE_SEC,
          async () => {
            const ohlc = await getYahooDailyOHLC(symbol, '6mo')
            const volumes = extractVolumes(ohlc)
    
            const volume = volumes.length ? volumes[volumes.length - 1] : null
            const slice = volumes.slice(-PERIOD)
            const avg20 = slice.length ? Math.round(slice.reduce((a, b) => a + b, 0) / slice.length) : null
            const ratio = volume != null && avg20 != null && avg20 > 0 ? Number((volume / avg20).toFixed(2)) : null
    
            const { status, points } = volStatus(ratio)
            const value: Resp = { symbol, period: PERIOD, volume, avg20, ratio, status, points }
            await kvSetJSON(snapKey, { updatedAt: Date.now(), value }, TTL_SEC)
            return value
          }
        )
    
        if (!data) return res.status(500).json({ error: 'Failed to compute vol20' })
        return res.status(200).json(data)
      } catch (e: any) {
        return res.status(500).json({ error: String(e?.message || e) })
      }
    }

    // 3) Geen snapshot → berekenen en cachen
    const value = await compute(raw, period)
    await kvSetJSON(kvKey, { value, updatedAt: Date.now() })
    return res.status(200).json(value)
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}