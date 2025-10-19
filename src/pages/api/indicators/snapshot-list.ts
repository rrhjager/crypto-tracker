// src/pages/api/indicators/snapshot-list.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { getYahooDailyOHLC } from '@/lib/providers/quote'
import { maCross, rsi14, macd, vol20 } from '@/lib/ta'

import { AEX } from '@/lib/aex'
import { SP500 } from '@/lib/sp500'
import { NASDAQ } from '@/lib/nasdaq'
import { DOWJONES } from '@/lib/dowjones'
import { DAX as DAX_FULL } from '@/lib/dax'
import { FTSE100 } from '@/lib/ftse100'
import { NIKKEI225 } from '@/lib/nikkei225'
import { HANGSENG } from '@/lib/hangseng'
import { SENSEX } from '@/lib/sensex'

type Advice = 'BUY' | 'HOLD' | 'SELL'
type MarketLabel =
  | 'AEX' | 'S&P 500' | 'NASDAQ' | 'Dow Jones'
  | 'DAX' | 'FTSE 100' | 'Nikkei 225' | 'Hang Seng' | 'Sensex'

type Item = { symbol: string; name?: string; score: number | null }

const RANGE = '1y'
const TTL_MIN_BARS = 60

/* ---------- helpers (exact als homepage) ---------- */
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))
const scoreToPts = (s: number) => clamp((s / 100) * 4 - 2, -2, 2)
const toNum = (x: unknown) => (typeof x === 'string' ? Number(x) : (x as number))
const isFiniteNum = (x: unknown) => Number.isFinite(toNum(x))
const toPtsSmart = (
  status?: Advice | string,
  pts?: number | string | null,
  fallback: () => number | null = () => null
) => {
  if (isFiniteNum(pts)) return clamp(toNum(pts), -2, 2)
  const s = String(status || '').toUpperCase()
  if (s === 'BUY')  return  2
  if (s === 'SELL') return -2
  const f = fallback()
  return f == null ? 0 : clamp(f, -2, 2)
}

function deriveMaPoints(ma?: { ma50: number|null; ma200: number|null }): number | null {
  const ma50 = ma?.ma50, ma200 = ma?.ma200
  if (ma50 == null || ma200 == null) return null
  let maScore = 50
  if (ma50 > ma200) {
    const spread = clamp(ma50 / Math.max(1e-9, ma200) - 1, 0, 0.2)
    maScore = 60 + (spread / 0.2) * 40
  } else if (ma50 < ma200) {
    const spread = clamp(ma200 / Math.max(1e-9, ma50) - 1, 0, 0.2)
    maScore = 40 - (spread / 0.2) * 40
  }
  return scoreToPts(maScore)
}
function deriveRsiPoints(r: number | null | undefined): number | null {
  if (typeof r !== 'number') return null
  const rsiScore = clamp(((r - 30) / 40) * 100, 0, 100)
  return scoreToPts(rsiScore)
}
function deriveMacdPoints(hist: number | null | undefined, ma50?: number | null): number | null {
  if (typeof hist !== 'number') return null
  if (ma50 && ma50 > 0) {
    const t = 0.01
    const relClamped = clamp((hist / ma50) / t, -1, 1)
    const macdScore = 50 + relClamped * 20
    return scoreToPts(macdScore)
  }
  const macdScore = hist > 0 ? 60 : hist < 0 ? 40 : 50
  return scoreToPts(macdScore)
}
function deriveVolPoints(ratio: number | null | undefined): number | null {
  if (typeof ratio !== 'number') return null
  const delta = clamp((ratio - 1) / 1, -1, 1)
  const volScore = clamp(50 + delta * 30, 0, 100)
  return scoreToPts(volScore)
}

/* ---------- universum helpers ---------- */
const STATIC_CONS: Record<MarketLabel, { symbol: string; name: string }[]> = {
  AEX: [],
  'S&P 500': SP500 as any,
  NASDAQ: NASDAQ as any,
  'Dow Jones': DOWJONES as any,
  DAX: DAX_FULL as any,
  'FTSE 100': FTSE100 as any,
  'Nikkei 225': NIKKEI225 as any,
  'Hang Seng': HANGSENG as any,
  Sensex: SENSEX as any,
}

function constituentsForMarket(label: MarketLabel) {
  if (label === 'AEX') return AEX.map(x => ({ symbol: x.symbol, name: x.name }))
  const arr = (STATIC_CONS[label] || []) as any[]
  return arr.map(x => ({ symbol: x.symbol, name: x.name }))
}

/* ---------- normalisatie van provider output ---------- */
type Bar = { time?: number; t?: number; close?: number; c?: number; volume?: number; v?: number }

function normCloses(ohlc: any): number[] {
  if (Array.isArray(ohlc)) {
    // array van candles
    return (ohlc as Bar[])
      .map(b => (typeof b?.close === 'number' ? b.close : (typeof b?.c === 'number' ? b.c : null)))
      .filter((n): n is number => Number.isFinite(n))
  }
  // object met arrays
  if (Array.isArray(ohlc?.closes)) return (ohlc.closes as number[]).filter(n => Number.isFinite(n))
  if (Array.isArray(ohlc?.c)) return (ohlc.c as number[]).filter(n => Number.isFinite(n))
  return []
}
function normVolumes(ohlc: any): number[] {
  if (Array.isArray(ohlc)) {
    return (ohlc as Bar[])
      .map(b => (typeof b?.volume === 'number' ? b.volume : (typeof b?.v === 'number' ? b.v : null)))
      .filter((n): n is number => Number.isFinite(n))
  }
  if (Array.isArray(ohlc?.volumes)) return (ohlc.volumes as number[]).filter(n => Number.isFinite(n))
  if (Array.isArray(ohlc?.v)) return (ohlc.v as number[]).filter(n => Number.isFinite(n))
  return []
}

/* ---------- snelle score (zelfde weging als homepage) ---------- */
function computeScoreFromSeries(closes: number[], volumes: number[]): number | null {
  if (!Array.isArray(closes) || closes.length < TTL_MIN_BARS) return null

  const ma = maCross(closes)
  const rsi = rsi14(closes)
  const mac = macd(closes, 12, 26, 9)
  const vol = vol20(volumes || [])

  const ma50 = (ma as any)?.ma50 ?? null
  const ma200 = (ma as any)?.ma200 ?? null
  const rsiValue = typeof (rsi as any)?.rsi === 'number' ? (rsi as any).rsi : (typeof rsi === 'number' ? rsi : null)
  const hist = (mac as any)?.hist ?? null
  const ratio = (vol as any)?.ratio ?? null

  const pMA   = toPtsSmart((ma as any)?.status,  (ma as any)?.points,  () => deriveMaPoints({ ma50, ma200 }))
  const pMACD = toPtsSmart((mac as any)?.status, (mac as any)?.points, () => deriveMacdPoints(hist, ma50))
  const pRSI  = toPtsSmart((rsi as any)?.status, (rsi as any)?.points, () => deriveRsiPoints(rsiValue))
  const pVOL  = toPtsSmart((vol as any)?.status, (vol as any)?.points, () => deriveVolPoints(ratio))

  const nMA   = (pMA   + 2) / 4
  const nMACD = (pMACD + 2) / 4
  const nRSI  = (pRSI  + 2) / 4
  const nVOL  = (pVOL  + 2) / 4

  const W_MA = 0.40, W_MACD = 0.30, W_RSI = 0.20, W_VOL = 0.10
  const agg = W_MA*nMA + W_MACD*nMACD + W_RSI*nRSI + W_VOL*nVOL
  return clamp(Math.round(agg * 100), 0, 100)
}

/* ---------- pool helper ---------- */
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

export const config = { runtime: 'nodejs' }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const marketParam = String(req.query.market || '').trim() as MarketLabel | ''
    const symbolsParam = String(req.query.symbols || '').trim()

    let list: { symbol: string; name?: string }[] = []
    if (symbolsParam) {
      list = symbolsParam.split(',').map(s => ({ symbol: s.trim(), name: s.trim() })).filter(x => x.symbol)
    } else if (marketParam) {
      list = constituentsForMarket(marketParam)
    }

    if (!list.length) {
      return res.status(200).json({ items: [] as Item[] })
    }

    // beperkte concurrency; snel maar memory-zuinig
    const results = await pool(list, 6, async (c) => {
      try {
        const ohlc = await getYahooDailyOHLC(c.symbol, RANGE)
        const closes = normCloses(ohlc)
        const volumes = normVolumes(ohlc)
        const score = computeScoreFromSeries(closes, volumes)
        return { symbol: c.symbol, name: c.name, score } as Item
      } catch {
        return { symbol: c.symbol, name: c.name, score: null } as Item
      }
    })

    // filter op scores die numeriek zijn
    const items = results.filter(r => Number.isFinite(r.score as number)) as Item[]
    return res.status(200).json({ items })
  } catch (e: any) {
    return res.status(200).json({ items: [], error: String(e?.message || e) })
  }
}