// src/pages/api/indicators/snapshot.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { kvRefreshIfStale, kvSetJSON } from '@/lib/kv'
import { getYahooDailyOHLC } from '@/lib/providers/quote'
import { computeScoreStatus } from '@/lib/taScore'
import { sma, rsi as rsiWilder, macd as macdCalc, avgVolume } from '@/lib/ta-light'

export const config = { runtime: 'nodejs' }

const TTL_SEC = 300
const REVALIDATE_SEC = 20
const RANGE: '1y' | '2y' = '1y'

type Bar = { close?: number; volume?: number }
type Advice = 'BUY' | 'SELL' | 'HOLD'

type SnapResp = {
  symbol: string
  // prijs & dag
  price?: number | null
  change?: number | null
  changePct?: number | null
  // ✨ 7/30 "dagen" (bars) performance
  ret7Pct?: number | null
  ret30Pct?: number | null
  // indicatoren
  ma?: { ma50: number | null; ma200: number | null; status?: Advice }
  rsi?: number | null
  macd?: { macd: number | null; signal: number | null; hist: number | null }
  volume?: { volume: number | null; avg20d: number | null; ratio: number | null }
  // samengestelde score
  score?: number
}

type DebugInfo = {
  requestedSymbols: string[]
  itemCount: number
  symbolsWithScore: string[]
  symbolsWithoutScore: string[]
}

type ApiResp = {
  items: SnapResp[]
  _debug?: DebugInfo
}

function normCloses(ohlc: any): number[] {
  if (Array.isArray(ohlc)) {
    return (ohlc as Bar[])
      .map(b => (typeof b?.close === 'number' ? b.close : null))
      .filter((n): n is number => typeof n === 'number')
  }
  if (ohlc && Array.isArray(ohlc.closes)) {
    return (ohlc.closes as any[]).filter((n): n is number => typeof n === 'number')
  }
  return []
}

function normVolumes(ohlc: any): number[] {
  if (Array.isArray(ohlc)) {
    return (ohlc as Bar[])
      .map(b => (typeof b?.volume === 'number' ? b.volume : null))
      .filter((n): n is number => typeof n === 'number')
  }
  if (ohlc && Array.isArray(ohlc.volumes)) {
    return (ohlc.volumes as any[]).filter((n): n is number => typeof n === 'number')
  }
  return []
}

async function computeOne(symbol: string): Promise<SnapResp> {
  const ohlc = await getYahooDailyOHLC(symbol, RANGE)
  const closes = normCloses(ohlc)
  const vols = normVolumes(ohlc)

  // ✅ shared TA helpers (zelfde basis als we straks voor crypto afdwingen)
  const ma50 = sma(closes, 50)
  const ma200 = sma(closes, 200)

  // display-status voor MA (zoals je al had)
  const maStatus: Advice | undefined =
    typeof ma50 === 'number' && typeof ma200 === 'number'
      ? ma50 > ma200
        ? 'BUY'
        : ma50 < ma200
          ? 'SELL'
          : 'HOLD'
      : undefined

  const rsi = rsiWilder(closes, 14)
  const { macd, signal, hist } = macdCalc(closes, 12, 26, 9)

  const volume = vols.length ? (vols[vols.length - 1] ?? null) : null
  const avg20d = avgVolume(vols, 20)
  const ratio =
    typeof volume === 'number' && typeof avg20d === 'number' && avg20d > 0 ? volume / avg20d : null

  // prijs/dag
  const last = closes.length ? (closes[closes.length - 1] ?? null) : null
  const prev = closes.length > 1 ? (closes[closes.length - 2] ?? null) : null
  const change = last != null && prev != null ? last - prev : null
  const changePct = change != null && prev ? (change / prev) * 100 : null

  // ✨ 7/30 bars terug (≈ 7/30 trading days)
  const pctFromBars = (n: number) =>
    closes.length > n ? ((closes[closes.length - 1] / closes[closes.length - 1 - n]) - 1) * 100 : null
  const ret7Pct = pctFromBars(7)
  const ret30Pct = pctFromBars(30)

  // ✅ score met dezelfde engine als crypto (taScore.ts)
  const { score } = computeScoreStatus({
    ma: { ma50, ma200 },
    rsi,
    macd: { hist },
    volume: { ratio },
  })

  return {
    symbol,
    price: last ?? null,
    change,
    changePct,
    ret7Pct,
    ret30Pct,
    ma: { ma50: ma50 ?? null, ma200: ma200 ?? null, status: maStatus },
    rsi: rsi ?? null,
    macd: { macd: macd ?? null, signal: signal ?? null, hist: hist ?? null },
    volume: { volume: volume ?? null, avg20d: avg20d ?? null, ratio: ratio ?? null },
    score,
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResp | { error: string }>
) {
  try {
    const listRaw = (req.query.symbols ?? req.query.symbol ?? '').toString().trim()
    if (!listRaw) return res.status(400).json({ error: 'Missing symbol(s)' })

    // symboollijst normaliseren + dedupen
    const symbols = Array.from(
      new Set(
        listRaw
          .split(',')
          .map(s => s.trim().toUpperCase())
          .filter(Boolean)
      )
    )

    if (symbols.length === 0) return res.status(400).json({ error: 'No valid symbols' })

    // burst-proof concurrency pool
    const items = await pool(symbols, 8, async (sym) => {
      const key = `ind:snapshot:${sym}:${RANGE}`
      const snapKey = `ind:snap:all:${sym}`

      try {
        const data = await kvRefreshIfStale<SnapResp>(key, TTL_SEC, REVALIDATE_SEC, async () => {
          const v = await computeOne(sym)
          try {
            await kvSetJSON(snapKey, { updatedAt: Date.now(), value: v }, TTL_SEC)
          } catch {}
          return v
        })

        return (
          data ?? {
            symbol: sym,
            ma: { ma50: null, ma200: null },
            rsi: null,
            macd: { macd: null, signal: null, hist: null },
            volume: { volume: null, avg20d: null, ratio: null },
            score: 50,
          }
        )
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.error('[snapshot-error]', sym, err)
        }
        return {
          symbol: sym,
          ma: { ma50: null, ma200: null },
          rsi: null,
          macd: { macd: null, signal: null, hist: null },
          volume: { volume: null, avg20d: null, ratio: null },
          score: 50,
        }
      }
    })

    const symbolsWithScore = items
      .filter(it => typeof it.score === 'number' && Number.isFinite(it.score))
      .map(it => it.symbol)

    const symbolsWithoutScore = items
      .filter(it => !(typeof it.score === 'number' && Number.isFinite(it.score)))
      .map(it => it.symbol)

    const debug: DebugInfo = {
      requestedSymbols: symbols,
      itemCount: items.length,
      symbolsWithScore,
      symbolsWithoutScore,
    }

    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.log('[snapshot-debug]', debug)
    }

    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
    return res.status(200).json({ items, _debug: debug })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}

/* ========= concurrency pool helper (lokaal, geen andere imports nodig) ========= */
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