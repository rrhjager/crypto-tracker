// src/pages/api/indicators/ret-batch.ts
import type { NextApiRequest, NextApiResponse } from 'next'

type Row = { symbol: string; days: number; pct: number | null }

async function yahoo(symbol: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Yahoo HTTP ${r.status}`)
  const j = await r.json()
  const res = j?.chart?.result?.[0]
  const times: number[] = (res?.timestamp || []).map((t: number) => t * 1000)
  const closes: (number | null)[] = res?.indicators?.quote?.[0]?.close || []
  return { times, closes }
}
function lastValid(closes: (number|null)[]) {
  for (let i = closes.length - 1; i >= 0; i--) {
    const v = closes[i]
    if (Number.isFinite(v as number)) return { idx: i, v: v as number }
  }
  return null
}
function closeAround(times: number[], closes: (number|null)[], targetMs: number) {
  let bestIdx = -1
  for (let i = times.length - 1; i >= 0; i--) {
    if (times[i] <= targetMs && Number.isFinite(closes[i] as number)) { bestIdx = i; break }
  }
  if (bestIdx >= 0) return { idx: bestIdx, v: closes[bestIdx] as number }
  for (let i = 0; i < times.length; i++) {
    if (times[i] >= targetMs && Number.isFinite(closes[i] as number)) return { idx: i, v: closes[i] as number }
  }
  return null
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<{ items: Row[] } | { error: string }>) {
  try {
    const symbols = String(req.query.symbols || '').split(',').map(s => s.trim()).filter(Boolean)
    const days = Math.max(1, Math.min(60, Number(req.query.days ?? 7)))

    // eenvoudige pool
    const out: Row[] = new Array(symbols.length)
    let i = 0
    const CONC = 5
    await Promise.all(new Array(Math.min(CONC, symbols.length)).fill(0).map(async () => {
      while (true) {
        const idx = i++
        if (idx >= symbols.length) break
        const sym = symbols[idx]
        try {
          const { times, closes } = await yahoo(sym)
          const cur = lastValid(closes)
          if (!cur || !times.length) { out[idx] = { symbol: sym, days, pct: null }; continue }
          const targetMs = Date.now() - days * 86400000
          const past = closeAround(times, closes, targetMs)
          if (!past) { out[idx] = { symbol: sym, days, pct: null }; continue }
          const pct = ((cur.v / past.v) - 1) * 100
          out[idx] = { symbol: sym, days, pct: Number.isFinite(pct) ? pct : null }
        } catch {
          out[idx] = { symbol: sym, days, pct: null }
        }
      }
    }))

    return res.status(200).json({ items: out })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}