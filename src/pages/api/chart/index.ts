// src/pages/api/chart/index.ts
import type { NextApiRequest, NextApiResponse } from 'next'

type YahooChart = {
  chart?: {
    result?: Array<{
      timestamp?: number[]
      indicators?: {
        quote?: Array<{ open?: number[]; high?: number[]; low?: number[]; close?: number[]; volume?: number[] }>
      }
    }>
    error?: { code: string; description: string }
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const symbol = String(req.query.symbol || '').trim()
  if (!symbol) return res.status(400).json({ error: 'symbol required' })

  // Standaard: 6 maanden dagdata
  const range = String(req.query.range || '6mo')
  const interval = String(req.query.interval || '1d')

  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}&includePrePost=false&corsDomain=finance.yahoo.com`

  try {
    const yf = await fetch(url, {
      // server-side: geen CORS-issues
      headers: { 'user-agent': 'Mozilla/5.0' },
      cache: 'no-store',
    })
    if (!yf.ok) {
      return res.status(yf.status).json({ error: `upstream ${yf.status}` })
    }
    const j = (await yf.json()) as YahooChart
    const r = j?.chart?.result?.[0]
    const q = r?.indicators?.quote?.[0]

    const t = r?.timestamp || []
    const c = q?.close || []
    const o = q?.open || []
    const h = q?.high || []
    const l = q?.low || []
    const v = q?.volume || []

    // Filter lege punten 1:1 op index
    const out: { t: number; c?: number; o?: number; h?: number; l?: number; v?: number }[] = []
    for (let i = 0; i < t.length; i++) {
      const ti = t[i]
      if (!Number.isFinite(ti)) continue
      const row: any = { t: ti }
      if (Number.isFinite(c[i])) row.c = c[i]
      if (Number.isFinite(o[i])) row.o = o[i]
      if (Number.isFinite(h[i])) row.h = h[i]
      if (Number.isFinite(l[i])) row.l = l[i]
      if (Number.isFinite(v[i])) row.v = v[i]
      out.push(row)
    }

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120')
    return res.status(200).json({ symbol, range, interval, points: out })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}