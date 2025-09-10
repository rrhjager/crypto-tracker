// src/pages/api/v1/coins.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { getCache } from '@/lib/cache'
import { fetchSafe } from '@/lib/fetchSafe' // robuuste fetch met timeout/retry

type CoinsPayload = any // compatibel met je bestaande shape { updatedAt, results, ... }

// Iets ruimer zodat we desnoods op /refresh kunnen wachten
export const config = { maxDuration: 60 }

function baseUrl(req: NextApiRequest) {
  const host =
    (req.headers['x-forwarded-host'] as string) ||
    req.headers.host ||
    'localhost:3000'
  const protoHeader = (req.headers['x-forwarded-proto'] as string) || ''
  const proto = protoHeader || (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

/** Zet expliciet korte cache headers (werken in prod, bijv. op Vercel/CDN) */
function setCacheHeaders(res: NextApiResponse, smaxage = 10, swr = 30) {
  const value = `public, s-maxage=${smaxage}, stale-while-revalidate=${swr}`
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', value)
  res.setHeader('CDN-Cache-Control', value)
  res.setHeader('Vercel-CDN-Cache-Control', value)
  res.setHeader('Timing-Allow-Origin', '*')
}

/** Verwijder Kaspa zonder de rest te beïnvloeden. */
function stripKaspa(payload: CoinsPayload): CoinsPayload {
  try {
    const results = Array.isArray(payload?.results)
      ? payload.results.filter((c: any) => {
          const sym = String(c?.symbol ?? '').toUpperCase()
          const slug = String(c?.slug ?? '').toLowerCase()
          return sym !== 'KAS' && sym !== 'KASPA' && slug !== 'kaspa'
        })
      : []
    return { ...payload, results }
  } catch {
    // In geval van onverwachte shape: laat payload ongewijzigd
    return payload
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CoinsPayload | { updatedAt: number; results: any[]; message?: string }>
) {
  try {
    // 1) Probeer directe (process-local) cache — werkt lokaal / bij warme instance
    const cached = getCache<CoinsPayload>('SUMMARY')
    if (cached?.results?.length) {
      const filtered = stripKaspa(cached)
      setCacheHeaders(res, 10, 30)
      return res.status(200).json(filtered)
    }

    // 2) Serverless instances delen geen geheugen → haal live data op van /refresh
    const qs = req.query.debug ? `?debug=${encodeURIComponent(String(req.query.debug))}` : ''
    const url = `${baseUrl(req)}/api/v1/refresh${qs}`

    // fetchSafe(url, init, timeoutMs, retries)
    const resp = await fetchSafe(url, { cache: 'no-store' }, 60000, 0)

    if (resp && typeof (resp as any).json === 'function') {
      const live: CoinsPayload = await (resp as any).json()
      const filtered = stripKaspa(live)
      setCacheHeaders(res, 5, 20)
      return res.status(200).json(filtered)
    }

    // 3) Fallback zonder 5xx: UI blijft netjes draaien en haalt later weer op
    setCacheHeaders(res, 5, 20)
    return res.status(200).json({
      updatedAt: Date.now(),
      results: [],
      message: 'Geen data van /refresh — tijdelijke lege set.',
    })
  } catch (e: any) {
    setCacheHeaders(res, 5, 20)
    return res.status(200).json({
      updatedAt: Date.now(),
      results: [],
      message: e?.message || 'Onbekende fout — tijdelijke lege set.',
    })
  }
}