// src/pages/api/market/intel-aggregate.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { kvRefreshIfStale, kvSetJSON } from '@/lib/kv'

type AnyObj = Record<string, any>
type IntelAggregate = {
  sectors?: AnyObj | null
  macro?: AnyObj | null
  breadth?: AnyObj | null
  hedgefunds?: AnyObj | null
  congress?: AnyObj | null
  news?: AnyObj[] | null
  updatedAt: number
  meta: { errors?: string[]; source: 'fresh' | 'kv' }
}

const EDGE_S_MAXAGE = 30           // CDN: 30s
const KV_TTL = 120                 // KV: 120s houdbaar
const KV_REVALIDATE = 30           // BG-refresh wanneer binnen 30s van expiratie
const KEY = 'intel:aggregate:v1'

// Bepaal base URL robuust (werkt voor Vercel/SSR/localhost)
function baseUrl(req: NextApiRequest) {
  const hdr = (name: string) => (req.headers[name] as string | undefined) || ''
  const proto = hdr('x-forwarded-proto') || 'https'
  const host = hdr('x-forwarded-host') || hdr('host') || process.env.VERCEL_URL || 'localhost:3000'
  return `${proto}://${host}`
}

// Kleine helper met timeout & no-store (één compute → KV → CDN; daarna zelden gebruikt)
async function fetchJSON<T = any>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', signal })
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`)
  return (await r.json()) as T
}

function compact<T>(o: T): T {
  // strip undefineds voor kleinere JSON
  return JSON.parse(JSON.stringify(o)) as T
}

async function compute(req: NextApiRequest): Promise<IntelAggregate> {
  const base = baseUrl(req)
  const errors: string[] = []
  const ctrl = new AbortController()
  const to = setTimeout(() => ctrl.abort(), 12_000) // 12s budget voor alle bronnen samen

  // ⬇️ Pas deze paden aan als jouw projectenamen verschillen (ik gebruik jouw bestaande routes)
  const endpoints = {
    sectors: `${base}/api/market/sectors`,
    macro: `${base}/api/market/macro`,
    breadth: `${base}/api/screener/market-scores`,
    hedgefunds: `${base}/api/market/hedgefunds`,
    congress: `${base}/api/market/congress`,
    news: `${base}/api/stocks/news`,
  }

  const [sectors, macro, breadth, hedgefunds, congress, news] = await Promise.allSettled([
    fetchJSON(endpoints.sectors, ctrl.signal),
    fetchJSON(endpoints.macro, ctrl.signal),
    fetchJSON(endpoints.breadth, ctrl.signal),
    fetchJSON(endpoints.hedgefunds, ctrl.signal),
    fetchJSON(endpoints.congress, ctrl.signal),
    fetchJSON(endpoints.news, ctrl.signal),
  ])

  clearTimeout(to)

  const get = (res: PromiseSettledResult<any>, key: string) => {
    if (res.status === 'fulfilled') return res.value
    errors.push(`${key}: ${res.reason?.message || String(res.reason)}`)
    return null
  }

  const payload: IntelAggregate = {
    sectors: get(sectors, 'sectors'),
    macro: get(macro, 'macro'),
    breadth: get(breadth, 'breadth'),
    hedgefunds: get(hedgefunds, 'hedgefunds'),
    congress: get(congress, 'congress'),
    news: get(news, 'news'),
    updatedAt: Date.now(),
    meta: { errors: errors.length ? errors : undefined, source: 'fresh' },
  }

  return compact(payload)
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<IntelAggregate | { error: string }>) {
  // Edge-cache (CDN) voor snelle hits zónder function invocations
  res.setHeader('Cache-Control', `public, s-maxage=${EDGE_S_MAXAGE}, stale-while-revalidate=300`)

  try {
    // Serve cached; revalidate vlak vóór TTL (goedkoop)
    const fromKv = await kvRefreshIfStale<IntelAggregate>(KEY, KV_TTL, KV_REVALIDATE, () => compute(req))
    if (fromKv) {
      // Zorg dat meta aangeeft dat dit uit KV kwam
      if (fromKv.meta) fromKv.meta.source = 'kv'
      return res.status(200).json(fromKv)
    }

    // Fallback: compute nu en zet in KV
    const fresh = await compute(req)
    try { await kvSetJSON(KEY, fresh, KV_TTL) } catch {}
    return res.status(200).json(fresh)
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}