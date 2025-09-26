// src/pages/api/stocks/news.ts
import type { NextApiRequest, NextApiResponse } from 'next'

type NewsItem = {
  title: string
  link: string
  publishedAt: string // ISO
  source?: string
}

type Resp = { items: NewsItem[] }

async function fetchText(url: string) {
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return await r.text()
}

// Heel eenvoudige Google News RSS parser
function parseGoogleNewsRSS(xml: string, max = 15): NewsItem[] {
  const items: NewsItem[] = []
  const itemRegex = /<item>([\s\S]*?)<\/item>/g
  const pick = (block: string, tag: string) => {
    const m = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block)
    return m ? m[1] : ''
  }
  let m: RegExpExecArray | null
  while ((m = itemRegex.exec(xml)) && items.length < max) {
    const block = m[1]
    const rawTitle = decodeHTMLEntities(pick(block, 'title')).trim()
    const link = decodeHTMLEntities(pick(block, 'link')).trim()
    const pubDate = pick(block, 'pubDate').trim()

    // "Titel - Bron" → splits bron
    let title = rawTitle
    let source: string | undefined
    const dash = rawTitle.lastIndexOf(' - ')
    if (dash > 0 && dash > rawTitle.length - 80) {
      source = rawTitle.slice(dash + 3).trim()
      title  = rawTitle.slice(0, dash).trim()
    }

    if (title && link) {
      items.push({
        title,
        link,
        source,
        publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      })
    }
  }
  return items
}

function decodeHTMLEntities(s: string) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Resp | { error: string }>
) {
  try {
    // AEX / Euronext Amsterdam nieuws (NL), laatste 7 dagen
    const q = encodeURIComponent('AEX OR "Euronext Amsterdam"')
    const url = `https://news.google.com/rss/search?q=${q}%20when:7d&hl=nl&gl=NL&ceid=NL:nl`

    const xml = await fetchText(url)
    const items = parseGoogleNewsRSS(xml, 15)
    res.status(200).json({ items })
  } catch (e: any) {
    res.status(502).json({ error: String(e?.message || e) })
  }
}