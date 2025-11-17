// src/pages/api/trump/quotes.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { getYahooDailyOHLC } from '@/lib/providers/quote'

export const config = { runtime: 'nodejs' }

type TrumpQuote = {
  symbol: string
  name: string
  price: number | null
  change: number | null
  changePercent: number | null
  currency: string
}

type Resp = {
  quotes: Record<string, TrumpQuote>
}

const MAP: Record<
  string,
  { yahoo: string; name: string; currency: string }
> = {
  DJT: { yahoo: 'DJT', name: 'Trump Media & Technology Group', currency: 'USD' },
  DOMH: { yahoo: 'DOMH', name: 'Dominari Holdings', currency: 'USD' },
  HUT: { yahoo: 'HUT', name: 'Hut 8 Mining', currency: 'USD' },
  BTC: { yahoo: 'BTC-USD', name: 'Bitcoin', currency: 'USD' },
}

async function fetchOne(sym: string): Promise<TrumpQuote> {
  const cfg = MAP[sym]
  if (!cfg) {
    return {
      symbol: sym,
      name: sym,
      price: null,
      change: null,
      changePercent: null,
      currency: 'USD',
    }
  }

  try {
    const { closes } = await getYahooDailyOHLC(cfg.yahoo, '1mo', 60)
    const valid = (closes || []).filter(
      (v) => typeof v === 'number' && Number.isFinite(v)
    ) as number[]
    const n = valid.length
    const price = n > 0 ? valid[n - 1] : null
    const prev = n > 1 ? valid[n - 2] : null
    const change =
      price != null && prev != null ? price - prev : null
    const changePercent =
      change != null && prev && prev !== 0
        ? (change / prev) * 100
        : null

    return {
      symbol: sym,
      name: cfg.name,
      price,
      change,
      changePercent,
      currency: cfg.currency,
    }
  } catch (e) {
    console.error('TRUMP_QUOTES_ERROR', sym, e)
    return {
      symbol: sym,
      name: cfg.name,
      price: null,
      change: null,
      changePercent: null,
      currency: cfg.currency,
    }
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Resp | { error: string }>
) {
  try {
    const raw =
      (req.query.symbols as string | undefined) ||
      Object.keys(MAP).join(',')
    const wanted = raw
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => !!MAP[s])

    if (!wanted.length) {
      return res
        .status(400)
        .json({ error: 'No valid symbols requested' })
    }

    const pairs = await Promise.all(
      wanted.map(async (s) => [s, await fetchOne(s)] as const)
    )

    const quotes: Record<string, TrumpQuote> = {}
    for (const [s, q] of pairs) quotes[s] = q

    res.setHeader(
      'Cache-Control',
      'public, max-age=20, s-maxage=20, stale-while-revalidate=40'
    )
    return res.status(200).json({ quotes })
  } catch (e: any) {
    console.error('TRUMP_QUOTES_FATAL', e)
    return res.status(500).json({ error: String(e?.message || e) })
  }
}