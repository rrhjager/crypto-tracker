// API: Congress Trading (cached via Vercel KV)
import type { NextApiRequest, NextApiResponse } from 'next'
import { withCache } from '@/lib/kv'

// ---- Types (pas aan waar nodig) ----
type CongressRow = {
  name: string
  ticker: string
  action: string
  date: string
  amount?: string
  chamber?: 'House' | 'Senate'
  party?: 'R' | 'D' | 'I' | string
}
type Resp = { results: CongressRow[]; cachedAt: number }

// ---- Cache instellingen ----
const CACHE_KEY = 'intel:congress:v1'  // bump 'v1' -> 'v2' als je schema wijzigt
const TTL_SEC   = 15 * 60               // 15 minuten

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const forceFresh = String(req.query.fresh || '') === '1'

  try {
    const data = forceFresh
      ? await fetchFreshAndCache()
      : await withCache<Resp>(CACHE_KEY, TTL_SEC, fetchFresh)

    // CDN hint: 1m edge cache, 5m stale
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
    res.status(200).json(data)
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) })
  }
}

// --- helpers ---
async function fetchFresh(): Promise<Resp> {
  // ⬇️ Zet hier je bestaande scraper/fetcher neer
  const rows: CongressRow[] = await fetchCongressSomehow()
  return { results: rows, cachedAt: Date.now() }
}

async function fetchFreshAndCache(): Promise<Resp> {
  const fresh = await fetchFresh()
  // Los van withCache: bij ?fresh=1 direct opslaan en teruggeven
  try {
    const { kvSetJSON } = await import('@/lib/kv')
    await kvSetJSON(CACHE_KEY, fresh, TTL_SEC)
  } catch {}
  return fresh
}

// TODO: vervang door jouw echte implementatie of import
async function fetchCongressSomehow(): Promise<CongressRow[]> {
  // ... jouw bestaande scraping / data-ophaal code ...
  return []
}