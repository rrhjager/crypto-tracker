// src/pages/api/indicators/rsi/[symbol].ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { rsi } from '@/lib/ta'

type Resp = {
  symbol: string
  period: number
  rsi: number | null
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
    const period = Number(req.query.period || 14)
    if (!raw) {
      res.status(400).json({ error: 'symbol is required' } as any)
      return
    }

    // 1 jaar, dag-candles — zelfde bron als MA-cross endpoint
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(raw)}?interval=1d&range=1y`
    const r = await fetch(url, { cache: 'no-store' })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const j: any = await okJson(r)

    const closes: number[] = (j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [])
      .map((v: any) => Number(v))
      .filter((v: number) => Number.isFinite(v))

    const rsiArr = rsi(closes, Number.isFinite(period) && period > 0 ? period : 14)
    const last = rsiArr.at(-1)

    // Simple interpretatie:
    // RSI <= 30 => 'BUY'
    // 30 < RSI < 70 => 'HOLD'
    // RSI >= 70 => 'SELL'
    let status: 'BUY' | 'HOLD' | 'SELL' = 'HOLD'
    let points = 0
    if (Number.isFinite(last)) {
      const val = last as number
      if (val <= 30) { status = 'BUY';  points = 1 }
      else if (val >= 70) { status = 'SELL'; points = -1 }
      else { status = 'HOLD'; points = 0 }
    }

    res.status(200).json({
      symbol: raw,
      period: Number.isFinite(period) ? period : 14,
      rsi: Number.isFinite(last) ? (last as number) : null,
      status,
      points,
    })
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) } as any)
  }
}