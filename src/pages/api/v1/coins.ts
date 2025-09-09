// src/pages/api/v1/coins.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { getCache } from '@/lib/cache'
import { fetchSafe } from '@/lib/fetchSafe' // robuuste fetch met timeout/retry

type CoinsPayload = any // compatibel met je bestaande shape { updatedAt, results, ... }

function baseUrl(req: NextApiRequest) {
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost:3000'
  const proto = (req.headers['x-forwarded-proto'] as string) || 'http'
  return `${proto}://${host}`
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function triggerRefresh(req: NextApiRequest) {
  try {
    const url = `${baseUrl(req)}/api/v1/refresh`
    await fetchSafe(url, { cache: 'no-store' }, 7000, 1)
  } catch {
    // negeren: fallback hieronder handelt het af
  }
}

/** Zet expliciet korte cache headers (werken in prod, bijv. op Vercel/CDN) */
function setCacheHeaders(res: NextApiResponse, smaxage = 10, swr = 30) {
  const value = `public, s-maxage=${smaxage}, stale-while-revalidate=${swr}`
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', value)
  // extra hints voor diverse CDNs/deploys
  res.setHeader('CDN-Cache-Control', value)
  res.setHeader('Vercel-CDN-Cache-Control', value)
  // optioneel: inzicht in timings in devtools
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
    // 1) Probeer direct uit servercache
    let cached = getCache<CoinsPayload>('SUMMARY')
    if (cached) {
      const filtered = stripKaspa(cached)
      setCacheHeaders(res, 10, 30) // heel kort, voorkomt stuiteren
      return res.status(200).json(filtered)
    }

    // 2) Geen cache? Start een refresh en poll héél even
    await triggerRefresh(req)

    const deadline = Date.now() + 3000 // max ~3s wachten
    while (!cached && Date.now() < deadline) {
      await sleep(150)
      cached = getCache<CoinsPayload>('SUMMARY')
    }

    if (cached) {
      const filtered = stripKaspa(cached)
      setCacheHeaders(res, 10, 30)
      return res.status(200).json(filtered)
    }

    // 3) Nog steeds niets → gracieus fallback (GEEN 503), frontend blijft draaien
    setCacheHeaders(res, 5, 20)
    return res.status(200).json({
      updatedAt: Date.now(),
      results: [],
      message: 'Initialisatie bezig (refresh gestart).',
    })
  } catch {
    // Altijd 200 houden; UI toont “Nog geen data” en herstelt vanzelf via SWR
    setCacheHeaders(res, 5, 20)
    return res.status(200).json({
      updatedAt: Date.now(),
      results: [],
      message: 'Onbekende fout — tijdelijke lege set.',
    })
  }
}