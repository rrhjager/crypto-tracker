// src/pages/api/past-performance/crypto.ts
export const config = { runtime: 'nodejs' }

import type { NextApiRequest, NextApiResponse } from 'next'
import { cache5min } from '@/lib/cacheHeaders'
import { getOrRefreshSnap, snapKey } from '@/lib/kvSnap'
import { COINS } from '@/lib/coins'
import { computeScoreStatus, Status as UiStatus } from '@/lib/taScore'

// ✅ exact same indicator calc + same source chain (copied from existing code)
import { fetchMarketDataFor, computeIndicators } from '@/lib/pastPerformance/cryptoIndicatorsExact'

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms))
const toISODate = (ms: number) => new Date(ms).toISOString().slice(0, 10)

type Row = {
  coin: string        // BTC
  name: string        // Bitcoin
  pair: string        // BTCUSDT
  source?: string
  current: { date: string; status: UiStatus; score: number; close: number } | null
  lastSignal: { date: string; status: 'BUY' | 'SELL'; score: number; close: number } | null
  perf: {
    h24: number | null
    d7: number | null
    d30: number | null
  }
  error?: string
}

function pct(from: number, to: number) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0) return null
  return ((to / from) - 1) * 100
}

// Find latest event day index where status switched into BUY or SELL.
// We compute day-by-day status using a rolling 200-candle window, scanning backward.
async function computeOne(pair: string): Promise<{ row: Row; debug?: any }> {
  const coinObj = COINS.find(c => c.pairUSD?.binance?.toUpperCase() === pair.toUpperCase())
  const coin = coinObj?.symbol || pair.replace(/USDT$/, '')
  const name = coinObj?.name || coin

  // Enough history so we can find a previous switch and still have forward 30d.
  // We still compute signals using the SAME 200-day window per day.
  const LOOKBACK = 900
  const WINDOW = 200
  const horizons = [1, 7, 30]
  const maxH = 30

  const got = await fetchMarketDataFor(pair.toUpperCase(), { limit: LOOKBACK })
  if (!got.ok) {
    return {
      row: {
        coin, name, pair,
        current: null,
        lastSignal: null,
        perf: { h24: null, d7: null, d30: null },
        error: got.error,
      }
    }
  }

  const { times, closes, volumes } = got.data
  const n = Math.min(times.length, closes.length, volumes.length)

  if (n < WINDOW + 2) {
    return {
      row: {
        coin, name, pair, source: got.source,
        current: null,
        lastSignal: null,
        perf: { h24: null, d7: null, d30: null },
        error: 'Not enough history',
      }
    }
  }

  // helper: compute status/score for day index i using last 200 candles ending at i
  const calcAt = (i: number): { status: UiStatus; score: number } => {
    const from = i - (WINDOW - 1)
    const cWin = closes.slice(from, i + 1)
    const vWin = volumes.slice(from, i + 1)
    const ind = computeIndicators(cWin, vWin)

    const { score, status } = computeScoreStatus({
      ma: { ma50: ind.ma.ma50, ma200: ind.ma.ma200 },
      rsi: ind.rsi,
      macd: { hist: ind.macd.hist },
      volume: { ratio: ind.volume.ratio },
    })

    return { score, status }
  }

  // Compute current (last candle)
  const lastIdx = n - 1
  const cur = calcAt(lastIdx)
  const current = {
    date: toISODate(times[lastIdx]),
    status: cur.status,
    score: cur.score,
    close: closes[lastIdx],
  }

  // Scan backward to find latest day where status switched into BUY or SELL.
  // We need at least WINDOW-1 index to compute.
  // We also need previous day to compare; and for outcomes we might need +30 days (optional).
  let eventIdx: number | null = null
  let eventScore = 50
  let eventStatus: UiStatus | null = null

  // Compute status for most recent day first (cur day)
  let curIdx = lastIdx
  let curState = cur

  for (let i = lastIdx - 1; i >= WINDOW - 1; i--) {
    const prevState = calcAt(i)

    // Transition into BUY/SELL happens on curIdx:
    // status[curIdx] != status[i] where i = curIdx-1
    if (curState.status !== prevState.status && (curState.status === 'BUY' || curState.status === 'SELL')) {
      eventIdx = curIdx
      eventScore = curState.score
      eventStatus = curState.status
      break
    }

    // step backward
    curIdx = i
    curState = prevState
  }

  if (eventIdx == null || eventStatus == null) {
    return {
      row: {
        coin, name, pair,
        source: got.source,
        current,
        lastSignal: null,
        perf: { h24: null, d7: null, d30: null },
      }
    }
  }

  const eventClose = closes[eventIdx]
  const lastSignal = {
    date: toISODate(times[eventIdx]),
    status: eventStatus as 'BUY' | 'SELL',
    score: eventScore,
    close: eventClose,
  }

  const perf = {
    h24: (eventIdx + 1 < n) ? pct(eventClose, closes[eventIdx + 1]) : null,
    d7:  (eventIdx + 7 < n) ? pct(eventClose, closes[eventIdx + 7]) : null,
    d30: (eventIdx + 30 < n) ? pct(eventClose, closes[eventIdx + 30]) : null,
  }

  return {
    row: {
      coin, name, pair,
      source: got.source,
      current,
      lastSignal,
      perf,
    }
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

    const kvKey = snapKey.custom('pastperf:crypto:v1')

    const compute = async () => {
      const pairs = COINS.map(c => c.pairUSD?.binance).filter(Boolean) as string[]

      const rows: Row[] = []
      const batches = chunk(pairs, 3)

      for (let bi = 0; bi < batches.length; bi++) {
        const group = batches[bi]
        const groupRows = await Promise.all(group.map(async (pair) => {
          const { row } = await computeOne(pair)
          return row
        }))
        rows.push(...groupRows)

        // throttle like your existing crypto endpoints
        if (bi < batches.length - 1) await sleep(650)
      }

      return {
        meta: {
          computedAt: Date.now(),
          note:
            'Past performance uses the exact same indicator calculation code as crypto-light/indicators (copied unchanged), and the exact same score/status via lib/taScore.computeScoreStatus(). Signals are evaluated on DAILY candles with a rolling 200-candle window.',
          horizons: ['24h', '7d', '30d'],
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