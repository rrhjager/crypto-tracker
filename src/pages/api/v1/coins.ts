// src/pages/api/v1/coins.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { getCache } from '@/lib/cache'
import { fetchSafe } from '@/lib/fetchSafe' // robuuste fetch met timeout/retry

type CoinsPayload = any // compatibel met je bestaande shape { updatedAt, results, ... }

// Iets ruimer zodat we desnoods op /refresh kunnen wachten (al wachten we in principe niet)
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
    return payload
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CoinsPayload | { updatedAt: number; results: any[]; message?: string }>
) {
  try {
    // 1) Probeer directe (process-local) cache
    const cached = getCache<CoinsPayload>('SUMMARY')
    if (cached?.results?.length) {
      const filtered = stripKaspa(cached)
      setCacheHeaders(res, 10, 30)
      return res.status(200).json(filtered)
    }

    // 2) Geen cache? Trap /refresh "fire-and-forget" af (NIET awaiten).
    const qs = req.query.debug ? `?debug=${encodeURIComponent(String(req.query.debug))}` : ''
    const url = `${baseUrl(req)}/api/v1/refresh${qs}`
    void fetchSafe(url, { cache: 'no-store' }, 60000, 0).catch(() => {})

    // 3) MINI-wachtlus: geef /refresh heel even tijd om cache te zetten (totale max ~2s)
    //    Dit maakt lokaal ontwikkelen weer “snappy”, zonder de route echt te blokkeren.
    const deadline = Date.now() + 2000
    while (Date.now() < deadline) {
      await sleep(200)
      const warm = getCache<CoinsPayload>('SUMMARY')
      if (warm?.results?.length) {
        const filtered = stripKaspa(warm)
        setCacheHeaders(res, 10, 30)
        return res.status(200).json(filtered)
      }
    }

    // 4) Nog steeds geen data? Geef niet-blokkerend antwoord terug; UI haalt later opnieuw op.
    setCacheHeaders(res, 5, 60)
    return res.status(200).json({
      updatedAt: Date.now(),
      results: [],
      message: 'Warming up cache — try again shortly.',
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