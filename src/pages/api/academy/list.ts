// src/pages/api/academy/list.ts
export const config = { runtime: 'nodejs' }

import type { NextApiRequest, NextApiResponse } from 'next'
import { withCache } from '@/lib/kv' // KV helper die we al gebruiken

type Item = { title: string; href: string }

// Zelfde content als op /academy (niet wijzigen van je pagina nodig)
const ARTICLES = [
  { slug: 'what-is-momentum',       title: 'What is momentum' },
  { slug: 'rsi-explained',          title: 'RSI explained' },
  { slug: 'macd-basics',            title: 'MACD basics' },
  { slug: 'volume-as-a-signal',     title: 'Volume as a signal' },
  { slug: 'moving-averages-101',    title: 'Moving averages 101' },
  { slug: 'risk-management',        title: 'Risk management' },
  { slug: 'market-regimes',         title: 'Market regimes' },
  { slug: 'backtesting-quickstart', title: 'Backtesting quickstart' },
]

const TTL_SECONDS = 24 * 60 * 60 // 24 uur (mag langer; is statisch)

async function buildList(): Promise<Item[]> {
  return ARTICLES.map(a => ({ title: a.title, href: `/academy/${a.slug}` }))
}

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  try {
    const items = await withCache<Item[]>('academy:list:v1', TTL_SECONDS, buildList)
    // Snelle CDN-cache met SWR zodat responses ms zijn
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800')
    return res.status(200).json({ items })
  } catch (e:any) {
    // bij KV-fout nog steeds nette 200 met lege lijst
    return res.status(200).json({ items: [], error: String(e?.message || e) })
  }
}