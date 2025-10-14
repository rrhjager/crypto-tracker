// src/pages/api/news/google.ts
export const config = { runtime: 'nodejs' }

import type { NextApiRequest, NextApiResponse } from 'next'
import { withCache } from '@/lib/kv' // ✅ KV-cache (gratis tier)

// Superlichte XML parser voor Google News RSS (zonder extra deps)
function parseRss(xml: string) {
  const items: {
    title: string
    link: string
    source?: string
    pubDate?: string
  }[] = []

  const itemBlocks = xml.split('<item>').slice(1)
  for (const raw of itemBlocks) {
    const block = raw.split('</item>')[0] || ''
    const pick = (tag: string) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
      return m ? m[1].trim() : ''
    }
    const title = pick('title').replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1')
    let link = pick('link').replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1')
    const pubDate = pick('pubDate')
    let source = pick('source').replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1')

    if (!link) {
      const guid = pick('guid').replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1')
      if (guid) link = guid
    }

    if (title && link) {
      items.push({ title, link, source, pubDate })
    }
  }

  return items
}

// Losse fetch-functie zodat withCache eromheen kan
async function fetchGoogleNews(q: string) {
  const params = new URLSearchParams({
    q,
    hl: 'en-US',
    gl: 'US',
    ceid: 'US:en',
  })
  const url = `https://news.google.com/rss/search?${params.toString()}`
  const r = await fetch(url, {
    headers: {
      'cache-control': 'no-cache',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
    },
    cache: 'no-store',
  })
  if (!r.ok) throw new Error(`Fetch failed: HTTP ${r.status}`)
  const xml = await r.text()
  const items = parseRss(xml).slice(0, 12)
  return items
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const q = String(req.query.q || '').trim()
    if (!q) return res.status(400).json({ error: 'Missing ?q=search+terms' })

    // ✅ 5 min KV-cache per query; daarna stale-while-revalidate via CDN
    const cacheKey = `news:google:v1:${q.toLowerCase()}`
    const items = await withCache<{ title: string; link: string; source?: string; pubDate?: string }[]>(
      cacheKey,
      300, // 5 min TTL in KV
      () => fetchGoogleNews(q)
    )

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=1800')
    return res.status(200).json({ items })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Internal error' })
  }
}