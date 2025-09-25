// src/pages/api/indicators/ret/[symbol].ts
import type { NextApiRequest, NextApiResponse } from 'next'

type RetResp = { symbol: string; days: number; pct: number | null }

async function fetchYahooCloseSeries(symbol: string) {
  // 1 maand dekt 30d prima; dag-interval
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
  // pak de dichtstbijzijnde koers <= targetMs, zo niet, de dichtstbijzijnde erna
  let bestIdx = -1
  for (let i = times.length - 1; i >= 0; i--) {
    if (times[i] <= targetMs && Number.isFinite(closes[i] as number)) { bestIdx = i; break }
  }
  if (bestIdx >= 0) return { idx: bestIdx, v: closes[bestIdx] as number }
  // fallback: eerste koers NA target
  for (let i = 0; i < times.length; i++) {
    if (times[i] >= targetMs && Number.isFinite(closes[i] as number)) return { idx: i, v: closes[i] as number }
  }
  return null
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<RetResp | { error: string }>) {
  try {
    const symbol = String(req.query.symbol || '')
    const days = Math.max(1, Math.min(60, Number(req.query.days ?? 7))) // 1..60

    const { times, closes } = await fetchYahooCloseSeries(symbol)
    if (!times?.length || !closes?.length) return res.status(200).json({ symbol, days, pct: null })

    const cur = lastValid(closes)
    if (!cur) return res.status(200).json({ symbol, days, pct: null })

    const targetMs = Date.now() - days * 24 * 60 * 60 * 1000
    const past = closeAround(times, closes, targetMs)
    if (!past) return res.status(200).json({ symbol, days, pct: null })

    const pct = ((cur.v / past.v) - 1) * 100
    return res.status(200).json({ symbol, days, pct: Number.isFinite(pct) ? pct : null })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}