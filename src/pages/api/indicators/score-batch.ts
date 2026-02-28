import type { NextApiRequest, NextApiResponse } from 'next'
import { computeLiveScore } from '@/lib/liveScore'

type Item = {
  symbol: string
  score: number | null
  status: 'BUY' | 'HOLD' | 'SELL' | 'NA'
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function calcFor(sym: string, marketHint?: string, modeHint?: string): Promise<Item> {
  try {
    const result = await computeLiveScore(sym, marketHint, modeHint)
    return {
      symbol: sym,
      score: result.score,
      status: result.status ?? 'NA',
    }
  } catch {
    return { symbol: sym, score: null, status: 'NA' }
  }
}

async function pool<T, R>(arr: T[], size: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(arr.length) as R[]
  let i = 0
  const workers = new Array(Math.min(size, arr.length)).fill(0).map(async () => {
    while (true) {
      const idx = i++
      if (idx >= arr.length) break
      out[idx] = await fn(arr[idx], idx)
      if (idx) await sleep(40)
    }
  })
  await Promise.all(workers)
  return out
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const raw = String(req.query.symbols || '').trim()
  if (!raw) return res.status(400).json({ error: 'symbols query param is required' })

  const marketHint = String(req.query.market || '').trim() || undefined
  const modeHint = String(req.query.mode || '').trim() || undefined
  const symbols = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))]
  const items = await pool(symbols, 4, (s) => calcFor(s, marketHint, modeHint))

  res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=40')
  return res.status(200).json({ items })
}
