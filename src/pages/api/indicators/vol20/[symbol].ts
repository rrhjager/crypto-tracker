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
    }

    // 3) Geen snapshot → berekenen en cachen
    const value = await compute(raw, period)
    await kvSetJSON(kvKey, { value, updatedAt: Date.now() })
    return res.status(200).json(value)
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}