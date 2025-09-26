// src/pages/api/indicators/macd/[symbol].ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { macd } from '@/lib/ta'

type Resp = {
  symbol: string
  fast: number
  slow: number
  signalPeriod: number
  macd: number | null
  signal: number | null
  hist: number | null
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
    const fast = Number(req.query.fast || 12)
    const slow = Number(req.query.slow || 26)
    const signalPeriod = Number(req.query.signal || 9)
    if (!raw) return res.status(400).json({ error: 'symbol is required' } as any)

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(raw)}?interval=1d&range=1y`
    const r = await fetch(url, { cache: 'no-store' })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const j: any = await okJson(r)

    const closes: number[] = (j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [])
      .map((v: any) => Number(v))
      .filter((v: number) => Number.isFinite(v))

    const { macd: m, signal: s, hist: h } = macd(
      closes,
      Number.isFinite(fast) ? fast : 12,
      Number.isFinite(slow) ? slow : 26,
      Number.isFinite(signalPeriod) ? signalPeriod : 9
    )

    const macdLast = m.at(-1)
    const signalLast = s.at(-1)
    const histLast = h.at(-1)

    let status: 'BUY' | 'HOLD' | 'SELL' = 'HOLD'
    let points = 0
    if (Number.isFinite(macdLast) && Number.isFinite(signalLast)) {
      if ((macdLast as number) > (signalLast as number)) { status = 'BUY'; points = 1 }
      else if ((macdLast as number) < (signalLast as number)) { status = 'SELL'; points = -1 }
      else { status = 'HOLD'; points = 0 }
    }

    res.status(200).json({
      symbol: raw,
      fast: Number.isFinite(fast) ? fast : 12,
      slow: Number.isFinite(slow) ? slow : 26,
      signalPeriod: Number.isFinite(signalPeriod) ? signalPeriod : 9,
      macd: Number.isFinite(macdLast) ? (macdLast as number) : null,
      signal: Number.isFinite(signalLast) ? (signalLast as number) : null,
      hist: Number.isFinite(histLast) ? (histLast as number) : null,
      status,
      points,
    })
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) } as any)
  }
}