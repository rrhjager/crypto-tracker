// src/pages/api/indicators/ma-cross/[symbol].ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { sma } from '@/lib/ta'

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

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp | { error: string }>) {
  try {
    const raw = String(req.query.symbol || '').trim()
    if (!raw) {
      res.status(400).json({ error: 'symbol is required' } as any)
      return
    }

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(raw)}?interval=1d&range=1y`
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

    res.status(200).json({
      symbol: raw,
      ma50: Number.isFinite(ma50) ? (ma50 as number) : null,
      ma200: Number.isFinite(ma200) ? (ma200 as number) : null,
      status,
      points,
    })
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) } as any)
  }
}