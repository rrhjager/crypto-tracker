// src/pages/api/news/google.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { XMLParser } from 'fast-xml-parser'

export const config = { runtime: 'nodejs' }

/**
 * Gratis Google News RSS -> JSON met thumbnail-extractie.
 * topic=crypto  => zoekt op "cryptocurrency OR bitcoin OR crypto"
 * topic=equities=> zoekt op "stocks OR equities OR market"
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const topic = String(req.query.topic || 'crypto').toLowerCase()
  const q = topic === 'equities'
    ? encodeURIComponent('stocks OR equities OR market')
    : encodeURIComponent('cryptocurrency OR bitcoin OR crypto')

  const rssUrl = `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`

  try {
    const r = await fetch(rssUrl, {
      headers: {
        'user-agent': process.env.SEC_USER_AGENT || 'SignalHub/1.0',
        'accept': 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
      },
      cache: 'no-store',
    })
    if (!r.ok) throw new Error(`Google News HTTP ${r.status}`)
    const xml = await r.text()

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
      removeNSPrefix: true,
      htmlEntities: true,
    })
    const j: any = parser.parse(xml)
    const items: any[] = j?.rss?.channel?.item || []

    const out = items.map((it:any) => {
      const title = String(it?.title || '').trim()
      const link  = String(it?.link  || '').trim()
      const sourceName = (typeof it?.source === 'string'
        ? it.source
        : (it?.source?._ || it?.source?.['#text'] || '')).trim()
      const published = String(it?.pubDate || '').trim()

      // Thumbnail uit <description> (bevat vaak <img>)
      let image: string | null = null
      const desc = String(it?.description || '')
      const mImg = desc.match(/<img[^>]+src=["']([^"']+)["']/i)
      if (mImg) image = mImg[1]

      return {
        title,
        url: link,
        source: sourceName,
        published,
        image,
      }
    })

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600')
    return res.status(200).json({ items: out })
  } catch (e:any) {
    return res.status(200).json({ items: [], error: String(e?.message || e) })
  }
}