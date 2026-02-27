// src/pages/api/past-performance/aex.ts
export const config = { runtime: 'nodejs' }

import type { NextApiRequest, NextApiResponse } from 'next'
import { cache5min } from '@/lib/cacheHeaders'
import { getOrRefreshSnap, snapKey } from '@/lib/kvSnap'
import { AEX } from '@/lib/aex'
import { computeScoreStatus, Status as UiStatus } from '@/lib/taScore'
import { fetchMarketDataForEquity, computeIndicators } from '@/lib/pastPerformance/equityIndicatorsExact'

type Status = UiStatus // 'BUY' | 'HOLD' | 'SELL'

type NextSignal = {
  date: string
  status: Status
  score: number
  close: number
  daysFromSignal: number
  rawReturnPct: number | null
  signalReturnPct: number | null
}

type Row = {
  symbol: string
  name: string
  source?: string

  current: { date: string; status: Status; score: number; close: number } | null
  lastSignal: { date: string; status: 'BUY' | 'SELL'; score: number; close: number } | null

  perf: {
    d7Raw: number | null
    d7Signal: number | null
    d30Raw: number | null
    d30Signal: number | null
  }

  nextSignal: NextSignal | null

  untilNext: {
    days: number | null
    mfeSignal: number | null
    maeSignal: number | null
  }

  error?: string
}

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms))
const toISODate = (ms: number) => new Date(ms).toISOString().slice(0, 10)

function pct(from: number, to: number) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0) return null
  return ((to / from) - 1) * 100
}

function signalAlign(status: 'BUY' | 'SELL', raw: number | null): number | null {
  if (raw == null) return null
  return status === 'BUY' ? raw : -raw
}

function toAexYahooSymbol(raw: string): string {
  const s = String(raw || '').trim().toUpperCase()
  if (!s) return ''
  if (s.includes('.')) return s
  return `${s}.AS`
}

async function computeOne(rawSymbol: string, name: string): Promise<Row> {
  const symbol = String(rawSymbol || '').trim().toUpperCase()
  const yahooSymbol = toAexYahooSymbol(symbol)

  const LOOKBACK_MIN = 260 // need enough for MA200 + room for signals
  const WINDOW = 200

  const got = await fetchMarketDataForEquity(yahooSymbol, { range: '2y', interval: '1d' })
  if (got.ok === false) {
    return {
      symbol,
      name,
      current: null,
      lastSignal: null,
      perf: { d7Raw: null, d7Signal: null, d30Raw: null, d30Signal: null },
      nextSignal: null,
      untilNext: { days: null, mfeSignal: null, maeSignal: null },
      error: got.error,
    }
  }

  const { times, closes, volumes } = got.data
  const n = Math.min(times.length, closes.length, volumes.length)

  if (n < Math.max(LOOKBACK_MIN, WINDOW + 2)) {
    return {
      symbol,
      name,
      source: got.source,
      current: null,
      lastSignal: null,
      perf: { d7Raw: null, d7Signal: null, d30Raw: null, d30Signal: null },
      nextSignal: null,
      untilNext: { days: null, mfeSignal: null, maeSignal: null },
      error: 'Not enough history',
    }
  }

  // ✅ EXACTLY like crypto: calcAt(i) uses ONLY last 200 candles ending at i
  const calcAt = (i: number): { status: Status; score: number } => {
    const from = i - (WINDOW - 1)
    const cWin = closes.slice(from, i + 1)
    const vWin = volumes.slice(from, i + 1)

    const ind = computeIndicators(cWin, vWin)
    const { score, status } = computeScoreStatus({
      ma: { ma50: ind.ma.ma50, ma200: ind.ma.ma200 },
      rsi: ind.rsi,
      macd: { hist: ind.macd.hist },
      volume: { ratio: ind.volume.ratio },
      trend: ind.trend,
      volatility: ind.volatility,
    }, { market: 'AEX' })

    return { score, status }
  }

  // Current
  const lastIdx = n - 1
  const cur = calcAt(lastIdx)
  const current = {
    date: toISODate(times[lastIdx]),
    status: cur.status,
    score: cur.score,
    close: closes[lastIdx],
  }

  // Find most recent transition INTO BUY or SELL
  let eventIdx: number | null = null
  let eventScore = 50
  let eventStatus: Status | null = null

  let curIdx = lastIdx
  let curState = cur

  for (let i = lastIdx - 1; i >= WINDOW - 1; i--) {
    const prevState = calcAt(i)
    if (curState.status !== prevState.status && (curState.status === 'BUY' || curState.status === 'SELL')) {
      eventIdx = curIdx
      eventScore = curState.score
      eventStatus = curState.status
      break
    }
    curIdx = i
    curState = prevState
  }

  if (eventIdx == null || eventStatus == null) {
    return {
      symbol,
      name,
      source: got.source,
      current,
      lastSignal: null,
      perf: { d7Raw: null, d7Signal: null, d30Raw: null, d30Signal: null },
      nextSignal: null,
      untilNext: { days: null, mfeSignal: null, maeSignal: null },
    }
  }

  const signalSide = eventStatus as 'BUY' | 'SELL'
  const eventClose = closes[eventIdx]

  const lastSignal = {
    date: toISODate(times[eventIdx]),
    status: signalSide,
    score: eventScore,
    close: eventClose,
  }

  // Find first day AFTER signal where status changes away from BUY/SELL
  let nextSignal: NextSignal | null = null
  let endIdxExclusive = n

  for (let j = eventIdx + 1; j < n; j++) {
    if (j < WINDOW - 1) continue
    const st = calcAt(j)
    if (st.status !== eventStatus) {
      const raw = pct(eventClose, closes[j])
      nextSignal = {
        date: toISODate(times[j]),
        status: st.status,
        score: st.score,
        close: closes[j],
        daysFromSignal: j - eventIdx,
        rawReturnPct: raw,
        signalReturnPct: signalAlign(signalSide, raw),
      }
      endIdxExclusive = j + 1
      break
    }
  }

  // ✅ CHANGE: if still open, count it "as of now" (so winrate includes open positions)
  if (!nextSignal) {
    const raw = pct(eventClose, closes[lastIdx])
    nextSignal = {
      date: toISODate(times[lastIdx]),
      status: current.status,
      score: current.score,
      close: closes[lastIdx],
      daysFromSignal: lastIdx - eventIdx,
      rawReturnPct: raw,
      signalReturnPct: signalAlign(signalSide, raw),
    }
  }

  // ✅ Only show horizon returns if the signal stayed active long enough
  const lastedAtLeast = (days: number) => !nextSignal || nextSignal.daysFromSignal >= days
  const d7Raw = eventIdx + 7 < n && lastedAtLeast(7) ? pct(eventClose, closes[eventIdx + 7]) : null
  const d30Raw = eventIdx + 30 < n && lastedAtLeast(30) ? pct(eventClose, closes[eventIdx + 30]) : null

  // ✅ MFE/MAE until next signal (direction-aligned)
  let mfe: number | null = null
  let mae: number | null = null

  const scanFrom = eventIdx + 1
  const scanTo = Math.min(endIdxExclusive - 1, n - 1)

  if (scanFrom <= scanTo) {
    for (let k = scanFrom; k <= scanTo; k++) {
      const raw = pct(eventClose, closes[k])
      const sig = signalAlign(signalSide, raw)
      if (sig == null) continue
      if (mfe == null || sig > mfe) mfe = sig
      if (mae == null || sig < mae) mae = sig
    }
  }

  return {
    symbol,
    name,
    source: got.source,
    current,
    lastSignal,
    perf: {
      d7Raw,
      d7Signal: signalAlign(signalSide, d7Raw),
      d30Raw,
      d30Signal: signalAlign(signalSide, d30Raw),
    },
    nextSignal,
    untilNext: {
      days: nextSignal ? nextSignal.daysFromSignal : n - 1 - eventIdx,
      mfeSignal: mfe,
      maeSignal: mae,
    },
  }
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    cache5min(res, 300, 1800)

    const kvKey = snapKey.custom('pastperf:aex:v4') // score model updated with trend/vol filters

    const compute = async () => {
      const symbols = AEX.map(x => ({ symbol: x.symbol, name: x.name }))
      const rows: Row[] = []

      // gentle to Yahoo
      const batches = chunk(symbols, 6)
      for (let bi = 0; bi < batches.length; bi++) {
        const group = batches[bi]
        const part = await Promise.all(group.map(x => computeOne(x.symbol, x.name)))
        rows.push(...part)
        if (bi < batches.length - 1) await sleep(300)
      }

      return {
        meta: {
          market: 'AEX',
          computedAt: Date.now(),
          note:
            'Signals use the exact same indicator calculation approach as crypto past-performance: DAILY candles, rolling 200-candle window per day, score/status computed ONLY via lib/taScore.computeScoreStatus(). 7d/30d returns are only shown if the signal stayed active that long. Signal return is direction-aligned (SELL flips sign). Includes MFE/MAE until next signal.',
        },
        rows,
      }
    }

    const { data } = await getOrRefreshSnap(kvKey, compute)
    return res.status(200).json(data)
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Internal error' })
  }
}
