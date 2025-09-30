// src/pages/api/social/masto.ts
export const config = { runtime: 'nodejs' }

import type { NextApiRequest, NextApiResponse } from 'next'

type MastoStatus = {
  id: string
  url: string
  created_at: string
  content: string
  language?: string | null
  reblogs_count: number
  favourites_count: number
  account: {
    id: string
    username: string
    acct: string
    display_name: string
    url: string
    avatar: string
    followers_count: number
  }
  media_attachments?: Array<{
    preview_url?: string
    url?: string
    type?: string
    description?: string | null
  }>
}

type Item = {
  id: string
  url: string
  author: string
  handle: string
  avatar: string
  followers: number
  createdAt: string
  contentHtml: string
  favourites: number
  reblogs: number
  image?: string | null
}

// ---- simpele in-memory cache (2 min) ----
const G: any = globalThis as any
if (!G.__MASTO_CACHE__) {
  G.__MASTO_CACHE__ = new Map<string, { ts: number; data: any }>()
}
const putCache = (key: string, data: any, ttlMs = 120_000) =>
  G.__MASTO_CACHE__.set(key, { ts: Date.now() + ttlMs, data })
const getCache = (key: string) => {
  const hit = G.__MASTO_CACHE__.get(key)
  if (!hit) return null
  if (Date.now() > hit.ts) return null
  return hit.data
}

async function fetchTag(instance: string, tag: string, limit: number): Promise<MastoStatus[]> {
  const url = `https://${instance}/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=${Math.min(
    Math.max(limit, 1),
    40
  )}`
  const r = await fetch(url, {
    headers: {
      // simpele UA; Mastodon accepteert anoniem, maar een nette UA helpt soms bij rate limiting
      'user-agent':
        'SignalHubBot/1.0 (+https://signalhub.tech) Mozilla/5.0 (compatible; MastodonFetcher)',
      'cache-control': 'no-cache',
      accept: 'application/json',
    },
    cache: 'no-store',
  })
  if (!r.ok) throw new Error(`HTTP ${r.status} @ ${url}`)
  const j = (await r.json()) as MastoStatus[]
  return Array.isArray(j) ? j : []
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Query opties
    const tagOne = (req.query.tag as string) || ''
    const tagsMulti = (req.query.tags as string) || ''
    const instance = (req.query.instance as string) || 'mastodon.social'
    const minFollowers = Math.max(0, Number(req.query.minFollowers ?? 50000)) // default 50k
    const limit = Math.max(1, Math.min(40, Number(req.query.limit ?? 20)))    // per-tag fetch

    // Tags bepalen
    let tags: string[] = []
    if (tagsMulti) {
      tags = tagsMulti
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    } else if (tagOne) {
      tags = [tagOne.trim()]
    } else {
      return res.status(400).json({ error: 'Provide ?tags=a,b,c or ?tag=x' })
    }

    // Cache key
    const cacheKey = JSON.stringify({ tags, instance, minFollowers, limit })
    const cached = getCache(cacheKey)
    if (cached) {
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120')
      return res.status(200).json(cached)
    }

    // Alle tags ophalen (parallel), fouten negeren per tag
    const lists = await Promise.all(
      tags.map(async (t) => {
        try {
          return await fetchTag(instance, t, limit)
        } catch {
          return [] as MastoStatus[]
        }
      })
    )

    // Flatten + filter op volgers + de-dup (op url/id) + sorteren op tijd
    const seen = new Set<string>()
    const items: Item[] = []
    for (const arr of lists) {
      for (const s of arr) {
        const uid = s.url || s.id
        if (!uid || seen.has(uid)) continue
        if ((s.account?.followers_count ?? 0) < minFollowers) continue

        seen.add(uid)
        items.push({
          id: s.id,
          url: s.url,
          author: s.account?.display_name || s.account?.username || s.account?.acct || 'Unknown',
          handle: s.account?.acct || '',
          avatar: s.account?.avatar || '',
          followers: Number(s.account?.followers_count || 0),
          createdAt: s.created_at,
          contentHtml: s.content || '',
          favourites: Number(s.favourites_count || 0),
          reblogs: Number(s.reblogs_count || 0),
          image:
            (s.media_attachments?.[0]?.preview_url ||
              s.media_attachments?.[0]?.url) ??
            null,
        })
      }
    }

    // Sorteer recent → oud
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    const payload = { items, meta: { instance, tags, minFollowers, count: items.length } }
    putCache(cacheKey, payload, 120_000)

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120')
    return res.status(200).json(payload)
  } catch (e: any) {
    return res.status(502).json({ error: String(e?.message || e) })
  }
}