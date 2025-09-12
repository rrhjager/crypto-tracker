// src/pages/api/v1/coins.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { getCache } from '@/lib/cache'

type CoinsPayload = {
  updatedAt: number
  results: any[]
  stale?: boolean
  source?: string
  message?: string
}

export const config = { maxDuration: 10 } // super kort, want we doen geen zwaar werk

// Cache headers die ook op de CDN van Vercel werken
function setCacheHeaders(res: NextApiResponse, smaxage = 20, swr = 60) {
  const v = `public, s-maxage=${smaxage}, stale-while-revalidate=${swr}`
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', v)
  res.setHeader('CDN-Cache-Control', v)
  res.setHeader('Vercel-CDN-Cache-Control', v)
  res.setHeader('Timing-Allow-Origin', '*')
}

// Kleine util om naar /bootstrap.json te fetchen met korte timeout
async function fetchWithTimeout(url: string, ms = 1500) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store' })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.json()
  } finally {
    clearTimeout(t)
  }
}

// Basis-URL uit headers (werkt lokaal en op Vercel)
function baseUrl(req: NextApiRequest) {
  const host =
    (req.headers['x-forwarded-host'] as string) ||
    (req.headers.host as string) ||
    'localhost:3000'
  const proto =
    (req.headers['x-forwarded-proto'] as string) ||
    (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

// Optioneel: bepaalde coins eruit filteren zonder de rest te breken
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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CoinsPayload>
) {
  // 1) Probeer warme snapshot uit process/KV (instant)
  const cached = getCache<CoinsPayload>('SUMMARY')
  if (cached && Array.isArray(cached.results) && cached.results.length) {
    setCacheHeaders(res, 20, 60)
    return res.status(200).json(stripKaspa(cached))
  }

  // 2) Cold start fallback: statisch bestand uit /public (zonder fs, via fetch)
  try {
    const url = `${baseUrl(req)}/bootstrap.json`
    const bootstrap = await fetchWithTimeout(url, 1500).catch(() => null)
    if (bootstrap && Array.isArray(bootstrap.results)) {
      const payload: CoinsPayload = {
        updatedAt: Number(bootstrap.updatedAt ?? Date.now()),
        results: bootstrap.results,
        stale: true,
        source: 'bootstrap',
      }
      setCacheHeaders(res, 10, 60)
      return res.status(200).json(stripKaspa(payload))
    }
  } catch {
    // negeer; we gaan door naar lege veilige payload
  }

  // 3) Veilig lege maar geldige payload (UI kan renderen en later vernieuwen)
  const empty: CoinsPayload = {
    updatedAt: Date.now(),
    results: [],
    stale: true,
    source: 'empty',
    message: 'Geen snapshot beschikbaar (nog).',
  }
  setCacheHeaders(res, 5, 30)
  return res.status(200).json(empty)
}