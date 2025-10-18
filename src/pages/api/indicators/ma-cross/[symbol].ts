// src/pages/api/indicators/ma-cross/[symbol].ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { sma } from '@/lib/ta'
import { kvGetJSON, kvSetJSON, kvRefreshIfStale } from '@/lib/kv'

type Resp = {
  symbol: string
  ma50: number | null
  ma200: number | null
  status: 'BUY' | 'HOLD' | 'SELL'
  points: number
}

async function okJson<T>(r: Response): Promise<T> {
  const j = await r.json()
  return j as T
}

const STALE_MS = 20_000 // ~20s: snelle SWR-verversing zonder extra cron

async function compute(symbol: string): Promise<Resp> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y`
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const j: any = await okJson(r)

  const closes: number[] = (j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [])
    .map((v: any) => Number(v))
    .filter((v: number) => Number.isFinite(v))

  const ma50Arr = sma(closes, 50)
  const ma200Arr = sma(closes, 200)
  const ma50 = ma50Arr.at(-1)
  const ma200 = ma200Arr.at(-1)

  let status: 'BUY' | 'HOLD' | 'SELL' = 'HOLD'
  let points = 0
  if (Number.isFinite(ma50) && Number.isFinite(ma200)) {
    if ((ma50 as number) > (ma200 as number)) { status = 'BUY';  points = 2 }
    else if ((ma50 as number) < (ma200 as number)) { status = 'SELL'; points = -2 }
    else { status = 'HOLD'; points = 0 }
  }

  return {
    symbol,
    ma50: Number.isFinite(ma50) ? (ma50 as number) : null,
    ma200: Number.isFinite(ma200) ? (ma200 as number) : null,
    status,
    points,
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Resp | { error: string }>
) {
  try {
    const raw = String(req.query.symbol || '').trim()
    if (!raw) {
      res.status(400).json({ error: 'symbol is required' } as any)
      return
    }

    const kvKey = `ind:ma:${raw.toUpperCase()}`

    // 1) Probeer directe hit uit KV (ms-response)
    const snap = await kvGetJSON<{ value: Resp; updatedAt: number }>(kvKey)

    // 2) Als snapshot bestaat: serveer direct, en refresh asynchroon indien stale
    if (snap && snap.value) {
      // kick SWR refresh (achtergrond) als verouderd
      kvRefreshIfStale(kvKey, snap.updatedAt, STALE_MS, async () => {
        const value = await compute(raw)
        await kvSetJSON(kvKey, { value, updatedAt: Date.now() })
      }).catch(() => {})

      res.status(200).json(snap.value)
      return
    }

    // 3) Geen snapshot → compute nu (éénmalig) en cache
    const value = await compute(raw)
    await kvSetJSON(kvKey, { value, updatedAt: Date.now() })
    res.status(200).json(value)
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) } as any)
  }
}