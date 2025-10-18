// src/pages/api/indicators/rsi/[symbol].ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { rsi } from '@/lib/ta'

// ⬇️ NIEUW: KV snapshot helpers (zelfde als indicators.ts)
import { getOrRefreshSnap, snapKey } from '@/lib/kvSnap'

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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Resp | { error: string }>
) {
  try {
    const raw = String(req.query.symbol || '').trim()
    const periodQ = Number(req.query.period || 14)
    const period = Number.isFinite(periodQ) && periodQ > 0 ? periodQ : 14

    if (!raw) {
      res.status(400).json({ error: 'symbol is required' } as any)
      return
    }

    // Unieke KV-key (symbol + period)
    const kvKey = snapKey.rsi(`${raw.toUpperCase()}:${period}`)

    // Originele logica ongewijzigd, alleen in compute() gezet
    const compute = async (): Promise<Resp> => {
      // 1 jaar, dag-candles — zelfde bron als MA-cross endpoint
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(raw)}?interval=1d&range=1y`
      const r = await fetch(url, { cache: 'no-store' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j: any = await okJson(r)

      const closes: number[] = (j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [])
        .map((v: any) => Number(v))
        .filter((v: number) => Number.isFinite(v))

      const rsiArr = rsi(closes, period)
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

      return {
        symbol: raw,
        period,
        rsi: Number.isFinite(last) ? (last as number) : null,
        status,
        points,
      }
    }

    // Serve-from-KV + background revalidate
    const { data } = await getOrRefreshSnap(kvKey, compute)
    res.status(200).json(data)
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) } as any)
  }
}