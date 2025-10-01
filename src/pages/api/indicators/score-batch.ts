// src/pages/api/indicators/score-batch.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { computeCompositeScore, statusFromScore,
  type MaCrossResp, type RsiResp, type MacdResp, type Vol20Resp } from '@/lib/score'

type Item = {
  symbol: string
  score: number | null
  status: 'BUY' | 'HOLD' | 'SELL' | 'NA'
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function fetchJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json() as Promise<T>
}

async function calcFor(sym: string): Promise<Item> {
  try {
    const [ma, rsi, macd, vol] = await Promise.all([
      fetchJSON<MaCrossResp>(`/api/indicators/ma-cross/${encodeURIComponent(sym)}`),
      fetchJSON<RsiResp>(`/api/indicators/rsi/${encodeURIComponent(sym)}?period=14`),
      fetchJSON<MacdResp>(`/api/indicators/macd/${encodeURIComponent(sym)}?fast=12&slow=26&signal=9`),
      fetchJSON<Vol20Resp>(`/api/indicators/vol20/${encodeURIComponent(sym)}?period=20`),
    ])

    const score = computeCompositeScore(ma, macd, rsi, vol)
    return { symbol: sym, score, status: statusFromScore(score) }
  } catch {
    return { symbol: sym, score: null, status: 'NA' }
  }
}

async function pool<T, R>(arr: T[], size: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(arr.length) as any
  let i = 0
  const workers = new Array(Math.min(size, arr.length)).fill(0).map(async () => {
    while (true) {
      const idx = i++
      if (idx >= arr.length) break
      out[idx] = await fn(arr[idx], idx)
      if (idx) await sleep(60) // kleine throttle
    }
  })
  await Promise.all(workers)
  return out
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const raw = String(req.query.symbols || '').trim()
  if (!raw) return res.status(400).json({ error: 'symbols query param is required' })

  const symbols = [...new Set(raw.split(',').map(s => s.trim()).filter(Boolean))]
  const items = await pool(symbols, 4, (s) => calcFor(s))

  res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=40')
  return res.status(200).json({ items })
}