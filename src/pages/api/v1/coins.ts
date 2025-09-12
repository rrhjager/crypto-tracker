// src/pages/api/v1/coins.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { COINS } from '@/lib/coins'
import { getCache } from '@/lib/cache'

// Bouw een lichte, altijd-beschikbare fallback zodat de UI direct iets kan tonen
function buildBootstrap() {
  const now = Date.now()
  const results = COINS.map((c) => ({
    symbol: c.symbol,
    name: c.name,
    slug: c.slug || c.santimentSlug || c.symbol.toLowerCase(),
    status: 'HOLD',
    score: 50,
    breakdown: {
      tvSignal: null,
      momentum: null,
      volatilityRegime: null,
      funding: null,
      openInterest: null,
      longShortSkew: null,
      breadth: null,
      fearGreed: null,
      yield: null,
    },
    price: null,
    perf: { d: 0, w: 0, m: 0 },
    meta: {
      fng: null,
      breadth: { green: 0, total: COINS.length, pct: 0 },
      pools: [],
    },
  }))

  return { updatedAt: now, results, stale: true }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // 1) Altijd snel antwoord: geef snapshot als die bestaat
    const cached = await getCache('SUMMARY').catch(() => null) as any

    // Edge-cache headers (delen tussen bezoekers) + SWR
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60')

    if (cached && Array.isArray(cached.results) && cached.results.length) {
      return res.status(200).json(cached)
    }

    // 2) Geen snapshot? Geef een lichte bootstrap terug (instant)
    const bootstrap = buildBootstrap()

    // 3) Best-effort: background refresh triggeren zonder te blocken
    try {
      const proto = (req.headers['x-forwarded-proto'] as string) || 'https'
      const host =
        (req.headers['x-forwarded-host'] as string) ||
        (req.headers['host'] as string)
      const url = `${proto}://${host}/api/v1/refresh`

      // Fire-and-forget (niet awaiten!)
      fetch(url, { method: 'POST' }).catch(() => {})
    } catch { /* ignore */ }

    return res.status(200).json(bootstrap)
  } catch (e: any) {
    return res.status(200).json(buildBootstrap())
  }
}