// src/lib/cacheHeaders.ts
import type { NextApiResponse } from 'next'

/**
 * Zet CDN-cache headers voor Vercel:
 * - s-maxage: hoeveel seconden de CDN de response mag cachen
 * - stale-while-revalidate: hoe lang verouderde content nog mag worden geserveerd
 */
export function cache5min(res: NextApiResponse, sMaxAge = 300, swr = 1800) {
  const v = `public, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`
  res.setHeader('Cache-Control', v)
  // Sommige setups respecteren ook deze expliciet:
  res.setHeader('CDN-Cache-Control', v)
  res.setHeader('Vercel-CDN-Cache-Control', v)
}