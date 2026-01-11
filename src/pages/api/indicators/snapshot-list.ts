// src/pages/api/indicators/snapshot-list.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { getYahooDailyOHLC, type YahooRange } from '@/lib/providers/quote'
import { kvGetJSON, kvSetJSON } from '@/lib/kv'

import { computeScoreStatus } from '@/lib/taScore'
import { sma, rsi as rsiWilder, macd as macdCalc, avgVolume } from '@/lib/ta-light'

import { AEX } from '@/lib/aex'
import { SP500 } from '@/lib/sp500'
import { NASDAQ } from '@/lib/nasdaq'
import { DOWJONES } from '@/lib/dowjones'
import { DAX as DAX_FULL } from '@/lib/dax'
import { FTSE100 } from '@/lib/ftse100'
import { NIKKEI225 } from '@/lib/nikkei225'
import { HANGSENG } from '@/lib/hangseng'
import { SENSEX } from '@/lib/sensex'
import { ETFS } from '@/lib/etfs'

export const config = { runtime: 'nodejs' }

type Advice = 'BUY' | 'HOLD' | 'SELL'

type SnapItem = {
  symbol: string
  ma: { ma50: number | null; ma200: number | null; status: Advice }
  rsi: { period: number; rsi: number | null; status: Advice }
  macd: { macd: number | null; signal: number | null; hist: number | null; status: Advice }
  volume: { volume: number | null; avg20d: number | null; ratio: number | null; status: Advice }
  score: number
  status: Advice
}

type Resp = { items: SnapItem[]; updatedAt: number }

const EDGE_MAX_AGE = 30
const KV_TTL_SEC = 600
const RANGE: YahooRange = '1y'

// bump als je caching wil breken na score-wijziging
const KV_VER = 'v5'

// ----- static lists for ?market= -----
const STATIC_CONS = {
  AEX,
  'S&P 500': SP500,
  NASDAQ,
  'Dow Jones': DOWJONES,
  DAX: DAX_FULL,
  'FTSE 100': FTSE100,
  'Nikkei 225': NIKKEI225,
  'Hang Seng': HANGSENG,
  Sensex: SENSEX,
  ETFS,
} as const

const listForMarket = (mkt?: string) => {
  if (!mkt) return [] as Array<{ symbol: string; name: string }>
  const arr = (STATIC_CONS as any)[mkt] || []
  return arr.map((x: any) => ({ symbol: x.symbol, name: x.name }))
}

/* ---------- helpers ---------- */
type Bar = { close?: number; c?: number; volume?: number; v?: number }

const closes = (arr: any): number[] =>
  Array.isArray(arr)
    ? (arr as Bar[])
        .map(b => (typeof b.close === 'number' ? b.close : typeof b.c === 'number' ? b.c : null))
        .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
    : Array.isArray(arr?.closes)
      ? (arr.closes as any[]).filter((n: any): n is number => typeof n === 'number' && Number.isFinite(n))
      : Array.isArray(arr?.c)
        ? (arr.c as any[]).filter((n: any): n is number => typeof n === 'number' && Number.isFinite(n))
        : []

const volumes = (arr: any): number[] =>
  Array.isArray(arr)
    ? (arr as Bar[])
        .map(b => (typeof b.volume === 'number' ? b.volume : typeof b.v === 'number' ? b.v : null))
        .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
    : Array.isArray(arr?.volumes)
      ? (arr.volumes as any[]).filter((n: any): n is number => typeof n === 'number' && Number.isFinite(n))
      : Array.isArray(arr?.v)
        ? (arr.v as any[]).filter((n: any): n is number => typeof n === 'number' && Number.isFinite(n))
        : []

// per-indicator badge statuses (UI). Score komt uit computeScoreStatus (crypto-identiek).
const statusMA = (ma50: number | null, ma200: number | null): Advice => {
  if (ma50 == null || ma200 == null) return 'HOLD'
  if (ma50 > ma200) return 'BUY'
  if (ma50 < ma200) return 'SELL'
  return 'HOLD'
}
const statusRSI = (r: number | null): Advice => {
  if (r == null) return 'HOLD'
  if (r > 70) return 'SELL'
  if (r < 30) return 'BUY'
  return 'HOLD'
}
const statusMACD = (hist: number | null): Advice => {
  if (hist == null) return 'HOLD'
  if (hist > 0) return 'BUY'
  if (hist < 0) return 'SELL'
  return 'HOLD'
}
const statusVOL = (ratio: number | null): Advice => {
  if (ratio == null) return 'HOLD'
  if (ratio > 1.2) return 'BUY'
  if (ratio < 0.8) return 'SELL'
  return 'HOLD'
}

/* ---------- compute ---------- */
async function computeOne(symbol: string): Promise<SnapItem> {
  const o = await getYahooDailyOHLC(symbol, RANGE)
  const cs = closes(o)
  const vs = volumes(o)

  const ma50 = sma(cs, 50)
  const ma200 = sma(cs, 200)
  const rsi = rsiWilder(cs, 14)

  const m = macdCalc(cs, 12, 26, 9)
  const macd = m?.macd ?? null
  const signal = m?.signal ?? null
  const hist = m?.hist ?? null

  const volNow = vs.length ? (vs.at(-1) ?? null) : null
  const avg20d = avgVolume(vs, 20)
  const ratio =
    typeof volNow === 'number' && typeof avg20d === 'number' && avg20d > 0 ? volNow / avg20d : null

  // ✅ EXACT dezelfde inputs als crypto-light/indicators.ts gebruikt
  const overall = computeScoreStatus({
    ma: { ma50: ma50 ?? null, ma200: ma200 ?? null },
    rsi: rsi ?? null,
    macd: { hist: hist ?? null },
    volume: { ratio: ratio ?? null },
  })

  const score =
    typeof overall.score === 'number' && Number.isFinite(overall.score) ? overall.score : 50

  // ✅ status exact zoals crypto: gebruik overall.status als die BUY/SELL/HOLD is, anders derive
  const status: Advice =
    overall.status === 'BUY' || overall.status === 'SELL' || overall.status === 'HOLD'
      ? overall.status
      : score >= 66
        ? 'BUY'
        : score <= 33
          ? 'SELL'
          : 'HOLD'

  // UI statuses (los van score-engine)
  const maS = statusMA(ma50 ?? null, ma200 ?? null)
  const rsiS = statusRSI(rsi ?? null)
  const macdS = statusMACD(hist)
  const volS = statusVOL(ratio)

  return {
    symbol,
    ma: { ma50: ma50 ?? null, ma200: ma200 ?? null, status: maS },
    rsi: { period: 14, rsi: rsi ?? null, status: rsiS },
    macd: { macd, signal, hist, status: macdS },
    volume: { volume: volNow ?? null, avg20d: avg20d ?? null, ratio: ratio ?? null, status: volS },
    score,
    status,
  }
}

/* ---------- concurrency pool ---------- */
async function pool<T, R>(arr: T[], size: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(arr.length) as any
  let i = 0
  const workers = new Array(Math.min(size, arr.length)).fill(0).map(async () => {
    while (true) {
      const idx = i++
      if (idx >= arr.length) break
      out[idx] = await fn(arr[idx], idx)
    }
  })
  await Promise.all(workers)
  return out
}

/* ---------- handler ---------- */
export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp | { error: string }>) {
  res.setHeader('Cache-Control', `public, s-maxage=${EDGE_MAX_AGE}, stale-while-revalidate=300`)

  try {
    const rawSyms = String(req.query.symbols || '').trim()
    const market = String(req.query.market || '').trim()

    let symbols: string[] = []

    if (rawSyms) {
      symbols = rawSyms.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    } else if (market) {
      symbols = listForMarket(market).map(x => x.symbol.toUpperCase())
    } else {
      return res.status(400).json({ error: 'Provide ?symbols=A,B or ?market=AEX|DAX|...' })
    }

    if (!symbols.length) return res.status(200).json({ items: [], updatedAt: Date.now() })
    if (symbols.length > 60) symbols = symbols.slice(0, 60)

    const keyId = symbols.join(',')
    const kvKey = `ind:snap:list:${KV_VER}:${RANGE}:${keyId}`

    try {
      const cached = await kvGetJSON<Resp>(kvKey)
      if (cached && Array.isArray(cached.items) && cached.items.length) {
        return res.status(200).json(cached)
      }
    } catch {}

    const items = await pool(symbols, 8, async (sym) => computeOne(sym))

    const updatedAt = Date.now()
    try {
      await kvSetJSON(kvKey, { items, updatedAt }, KV_TTL_SEC)
    } catch {}

    return res.status(200).json({ items, updatedAt })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}