import type { NextApiRequest, NextApiResponse } from 'next'
import { kvGetJSON, kvSetJSON } from '@/lib/kv'
import { getYahooDailyOHLC, type YahooRange } from '@/lib/providers/quote'
import { buildEquityExactSeries, type EquityScorePoint } from '@/lib/pastPerformance/equityIndicatorsExact'

export const config = { runtime: 'nodejs' }

type Resp = {
  symbol: string
  range: YahooRange
  updatedAt: number
  points: Array<{
    i: number
    score: number
    status: 'BUY' | 'HOLD' | 'SELL'
    ma50: number | null
    ma200: number | null
    rsi14: number | null
    macd: { macd: number | null; signal: number | null; hist: number | null }
    volume: { volume: number | null; avg20d: number | null; ratio: number | null }
  }>
}

const EDGE_MAX_AGE = 60
const KV_TTL_SEC = 600
const RANGE: YahooRange = '1y'
const KV_VER = 'v1'

type Bar = { close?: number; c?: number; volume?: number; v?: number }

function normCloses(ohlc: any): number[] {
  if (Array.isArray(ohlc)) {
    return (ohlc as Bar[])
      .map(b => (typeof b?.close === 'number' ? b.close : typeof b?.c === 'number' ? b.c : null))
      .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
  }
  if (ohlc && Array.isArray(ohlc.closes)) {
    return (ohlc.closes as any[]).filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
  }
  if (ohlc && Array.isArray(ohlc.c)) {
    return (ohlc.c as any[]).filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
  }
  return []
}

function normVolumes(ohlc: any): number[] {
  if (Array.isArray(ohlc)) {
    return (ohlc as Bar[])
      .map(b => (typeof b?.volume === 'number' ? b.volume : typeof b?.v === 'number' ? b.v : null))
      .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
  }
  if (ohlc && Array.isArray(ohlc.volumes)) {
    return (ohlc.volumes as any[]).filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
  }
  if (ohlc && Array.isArray(ohlc.v)) {
    return (ohlc.v as any[]).filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
  }
  return []
}

function toAexYahooSymbol(raw: string): string {
  const s = String(raw || '').trim().toUpperCase()
  if (!s) return ''
  if (s.includes('.')) return s
  return `${s}.AS`
}

function pickSymbol(req: NextApiRequest): string {
  // 1) /api/past-performance/aex/ASML  -> req.query.symbol = ['ASML']
  const fromPath =
    Array.isArray(req.query.symbol) ? req.query.symbol[0] : typeof req.query.symbol === 'string' ? req.query.symbol : ''

  // 2) /api/past-performance/aex?symbol=ASML
  const fromQuery =
    typeof req.query.ticker === 'string'
      ? req.query.ticker
      : typeof req.query.s === 'string'
        ? req.query.s
        : typeof req.query.symbol === 'string'
          ? req.query.symbol
          : ''

  const raw = fromPath || fromQuery
  return toAexYahooSymbol(raw)
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp | { error: string }>) {
  res.setHeader('Cache-Control', `public, s-maxage=${EDGE_MAX_AGE}, stale-while-revalidate=300`)

  try {
    const symbol = pickSymbol(req)
    if (!symbol) {
      return res.status(400).json({ error: 'Missing symbol (use /aex/ASML or ?symbol=ASML)' })
    }

    const kvKey = `pp:aex:${KV_VER}:${RANGE}:${symbol}`
    try {
      const cached = await kvGetJSON<Resp>(kvKey)
      if (cached && cached.symbol === symbol && Array.isArray(cached.points) && cached.points.length) {
        return res.status(200).json(cached)
      }
    } catch {}

    const ohlc = await getYahooDailyOHLC(symbol, RANGE)
    const closes = normCloses(ohlc)
    const volumes = normVolumes(ohlc)

    if (!closes.length) {
      const empty: Resp = { symbol, range: RANGE, updatedAt: Date.now(), points: [] }
      return res.status(200).json(empty)
    }

    const series: EquityScorePoint[] = buildEquityExactSeries(closes, volumes)

    const points = series.map((p, i) => ({
      i,
      score: p.score,
      status: p.status,
      ma50: p.ma50,
      ma200: p.ma200,
      rsi14: p.rsi14,
      macd: p.macd,
      volume: p.volume,
    }))

    const payload: Resp = { symbol, range: RANGE, updatedAt: Date.now(), points }

    try {
      await kvSetJSON(kvKey, payload, KV_TTL_SEC)
    } catch {}

    return res.status(200).json(payload)
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}