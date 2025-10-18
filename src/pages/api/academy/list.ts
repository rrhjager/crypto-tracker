// src/pages/api/academy/list.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { kvGetJSON, kvSetJSON } from '@/lib/kv'

export const config = { runtime: 'nodejs' }

type Item = { title: string; href: string }
type Resp = { items: Item[] }

const FALLBACK: Item[] = [
  { title: 'What is RSI? A practical guide', href: '/academy' },
  { title: 'MACD signals explained simply', href: '/academy' },
  { title: 'Position sizing 101', href: '/academy' },
  { title: 'Support & resistance basics', href: '/academy' },
  { title: 'Trend vs. mean reversion', href: '/academy' },
  { title: 'Risk management checklists', href: '/academy' },
  { title: 'How to read volume properly', href: '/academy' },
  { title: 'Backtesting pitfalls to avoid', href: '/academy' },
]

export default async function handler(_req: NextApiRequest, res: NextApiResponse<Resp | { error: string }>) {
  try {
    const key = 'academy:list'
    const cached = await kvGetJSON<Resp>(key)
    if (cached?.items?.length) return res.status(200).json(cached)

    // TODO: if you have a real content source, fetch it here and kvSetJSON(key, { items }, 300)
    const payload = { items: FALLBACK }
    await kvSetJSON(key, payload, 300)
    return res.status(200).json(payload)
  } catch (e: any) {
    // last-ditch fallback: never break the page
    return res.status(200).json({ items: FALLBACK })
  }
}