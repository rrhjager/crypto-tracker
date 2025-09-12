// src/pages/api/v1/coins.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { getCache } from '@/lib/cache'
import { fetchSafe } from '@/lib/fetchSafe'
import { COINS } from '@/lib/coins'

type CoinsPayload = any // compatibel met bestaande shape

// we willen vooral snel antwoorden – geen zware taken hier
export const config = { maxDuration: 10 }

// ───────────────────────────────── helpers ──────────────────────────────────
function baseUrl(req: NextApiRequest) {
  const host =
    (req.headers['x-forwarded-host'] as string) ||
    req.headers.host ||
    'localhost:3000'
  const protoHeader = (req.headers['x-forwarded-proto'] as string) || ''
  const proto = protoHeader || (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

function setCacheHeaders(res: NextApiResponse, smaxage = 15, swr = 120) {
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

/** Supersnelle bootstrap: renderbare, minimale rows voor alle COINS. */
function makeBootstrap(): CoinsPayload {
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
  return { updatedAt: Date.now(), stale: true, results }
}

// ───────────────────────────────── handler ───────────────────────────────────
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<
    CoinsPayload | { updatedAt: number; results: any[]; message?: string }
  >
) {
  try {
    // 1) Direct uit process-cache als beschikbaar (snelste pad)
    const cached = getCache<CoinsPayload>('SUMMARY')
    if (cached?.results?.length) {
      const filtered = stripKaspa(cached)
      setCacheHeaders(res, 15, 120)
      return res.status(200).json(filtered)
    }

    // 2) Geen cache? Geef meteen bootstrap terug (instant TTFB)
    const bootstrap = stripKaspa(makeBootstrap())
    setCacheHeaders(res, 15, 120)

    // 3) Start NIET-blokkerend een refresh op de achtergrond (best effort)
    try {
      const qs =
        req.query.debug != null
          ? `?debug=${encodeURIComponent(String(req.query.debug))}`
          : ''
      const url = `${baseUrl(req)}/api/v1/refresh${qs}`
      // fire-and-forget: geen await, korte timeout, 0 retries
      void fetchSafe(url, { cache: 'no-store' }, 2500, 0).catch(() => {})
    } catch {
      // achtergrond-refresh is best effort; negeren bij fouten
    }

    return res.status(200).json(bootstrap)
  } catch (e: any) {
    setCacheHeaders(res, 10, 60)
    return res.status(200).json({
      updatedAt: Date.now(),
      results: [],
      message: e?.message || 'Tijdelijke lege set.',
    })
  }
}