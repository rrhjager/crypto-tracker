// src/pages/api/news/google.ts
export const config = { runtime: 'nodejs' }

import type { NextApiRequest, NextApiResponse } from 'next'

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

    // Sommige items hebben een <guid> met URL, gebruik die als link leeg is
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const q = String(req.query.q || '').trim()
    if (!q) return res.status(400).json({ error: 'Missing ?q=search+terms' })

    // NL feed (headline language)
    const params = new URLSearchParams({
      q,
      hl: 'nl',
      gl: 'NL',
      ceid: 'NL:nl',
    })
    const url = `https://news.google.com/rss/search?${params.toString()}`
    const r = await fetch(url, {
      headers: {
        'cache-control': 'no-cache',
        // Eenvoudige UA om bots te vermijden
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      },
    })
    if (!r.ok) return res.status(r.status).json({ error: `Fetch failed: HTTP ${r.status}` })
    const xml = await r.text()
    const items = parseRss(xml).slice(0, 12)

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=1800')
    return res.status(200).json({ items })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Internal error' })
  }
}