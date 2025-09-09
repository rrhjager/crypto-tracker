// src/pages/api/v1/news/[symbol].ts
import type { NextApiRequest, NextApiResponse } from 'next'
import Parser from 'rss-parser'
import { fetchSafe, setMicroCache } from '@/lib/fetchSafe'

type Item = {
  id: string
  title: string
  link: string
  source?: string
  pubDate?: string
}
type ApiResp = {
  updatedAt: number
  query: string
  items: Item[]
}

const parser = new Parser()

function newsUrl(query: string, lang: 'nl' | 'en' = 'nl') {
  // NL standaard; EN als fallback mogelijk
  if (lang === 'en') {
    // VS/EN
    return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`
  }
  // NL
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=nl&gl=NL&ceid=NL:nl`
}

function splitTitleForSource(title: string) {
  // Vaak is Google News titel "Kop - Uitgever"
  const idx = title.lastIndexOf(' - ')
  if (idx > 0 && idx < title.length - 3) {
    const clean = title.slice(0, idx).trim()
    const source = title.slice(idx + 3).trim()
    // Heuristiek: als "source" te lang is, houd toch de originele titel aan
    if (source.length <= 40) return { title: clean || title, source }
  }
  return { title, source: undefined }
}

async function fetchFeed(url: string) {
  // Robuuste fetch met timeout/retry, zonder warm-up
  const r = await fetchSafe(url, { cache: 'no-store' }, 7000, 1)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const xml = await r.text()
  const feed = await parser.parseString(xml)
  return feed?.items || []
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResp | { error: string }>) {
  try {
    const raw = req.query.symbol
    const symbol = (Array.isArray(raw) ? raw[0] : raw || '').toString().toUpperCase()
    const name = (req.query.name ? (Array.isArray(req.query.name) ? req.query.name[0] : req.query.name) : '').toString().trim()
    const lang = (req.query.lang === 'en' ? 'en' : 'nl') as 'nl' | 'en'
    const limit = Math.max(1, Math.min(30, Number(req.query.limit ?? 12) || 12))

    if (!symbol) {
      setMicroCache(res, 30, 120)
      res.status(200).json({ updatedAt: Date.now(), query: '', items: [] })
      return
    }

    // Bouw een paar queries; eerst de meest gerichte
    const queries: string[] = []
    if (name) queries.push(`"${name}" OR ${symbol} (crypto OR cryptocurrency) when:7d`)
    queries.push(`${symbol} (crypto OR cryptocurrency) when:7d`)

    // Probeer NL, desnoods EN fallback als NL niets oplevert
    let found: any[] = []
    let usedQuery = ''
    for (const q of queries) {
      try {
        const itemsNl = await fetchFeed(newsUrl(q, lang))
        if (itemsNl.length) { found = itemsNl; usedQuery = q; break }
      } catch { /* probeer volgende */ }
    }
    if (!found.length) {
      for (const q of queries) {
        try {
          const itemsEn = await fetchFeed(newsUrl(q, 'en'))
          if (itemsEn.length) { found = itemsEn; usedQuery = q; break }
        } catch { /* laatste redmiddel gefaald */ }
      }
    }

    // Normaliseren + deduplicatie
    const seen = new Set<string>()
    const items: Item[] = []
    for (const it of found) {
      const link = (it.link || '').toString()
      const guid = (it.guid || link || '').toString()
      const id = guid || link
      if (!id || seen.has(id)) continue
      seen.add(id)

      const rawTitle = (it.title || '').toString().trim()
      const { title, source } = splitTitleForSource(rawTitle)

      items.push({
        id,
        title: title || rawTitle || '—',
        link,
        source: source || undefined,
        pubDate: (it.isoDate || it.pubDate || '').toString() || undefined,
      })

      if (items.length >= limit) break
    }

    setMicroCache(res, 120, 600) // kort cachebaar zodat first view snel is, maar vrij vers
    res.status(200).json({
      updatedAt: Date.now(),
      query: usedQuery || queries[0] || symbol,
      items,
    })
  } catch (e) {
    setMicroCache(res, 30, 120)
    res.status(200).json({
      updatedAt: Date.now(),
      query: '',
      items: [],
    })
  }
}