// src/pages/api/past-performance/crypto.ts
export const config = { runtime: 'nodejs' }

import type { NextApiRequest, NextApiResponse } from 'next'
import { cache5min } from '@/lib/cacheHeaders'
import { getOrRefreshSnap, snapKey } from '@/lib/kvSnap'
import { COINS } from '@/lib/coins'
import { computeScoreStatus, Status as UiStatus } from '@/lib/taScore'

// exact same indicator calc + same source chain (copied from existing code)
import { fetchMarketDataFor, computeIndicators } from '@/lib/pastPerformance/cryptoIndicatorsExact'

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms))
const toISODate = (ms: number) => new Date(ms).toISOString().slice(0, 10)

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
  coin: string
  name: string
  pair: string
  source?: string

  current: { date: string; status: Status; score: number; close: number } | null

  lastSignal: { date: string; status: 'BUY' | 'SELL'; score: number; close: number } | null

  // Returns are computed FROM the signal day close to the close X days later,
  // but only if the signal stayed active for that long (otherwise null).
  perf: {
    d7Raw: number | null
    d7Signal: number | null
    d30Raw: number | null
    d30Signal: number | null
  }

  // First day AFTER the signal where the model changes away from BUY/SELL (to HOLD or opposite).
  nextSignal: NextSignal | null

  // ✅ Added: path stats until next signal (direction-aligned)
  untilNext: {
    days: number | null
    mfeSignal: number | null // max favorable excursion (best)
    maeSignal: number | null // max adverse excursion (worst)
  }

  // ✅ NEW (additive): enter AFTER 7 days, exit at next status change (closed only)
  // Filled only when there is a nextSignal and the original signal lasted >= 7 days.
  enterAfter7dUntilNext: {
    entryDate: string
    entryClose: number
    exitDate: string
    exitClose: number
    daysFromEntry: number
    rawReturnPct: number | null
    signalReturnPct: number | null
  } | null

  error?: string
}

function pct(from: number, to: number) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0) return null
  return ((to / from) - 1) * 100
}

function signalAlign(status: 'BUY' | 'SELL', raw: number | null): number | null {
  if (raw == null) return null
  return status === 'BUY' ? raw : -raw
}

async function computeOne(pair: string): Promise<{ row: Row }> {
  const coinObj = COINS.find(c => c.pairUSD?.binance?.toUpperCase() === pair.toUpperCase())
  const coin = coinObj?.symbol || pair.replace(/USDT$/, '')
  const name = coinObj?.name || coin

  const LOOKBACK = 900
  const WINDOW = 200

  const got = await fetchMarketDataFor(pair.toUpperCase(), { limit: LOOKBACK })

  if (got.ok === false) {
    const err = got.error
    return {
      row: {
        coin,
        name,
        pair,
        current: null,
        lastSignal: null,
        perf: { d7Raw: null, d7Signal: null, d30Raw: null, d30Signal: null },
        nextSignal: null,
        untilNext: { days: null, mfeSignal: null, maeSignal: null },
        enterAfter7dUntilNext: null,
        error: err,
      },
    }
  }

  const { times, closes, volumes } = got.data
  const n = Math.min(times.length, closes.length, volumes.length)

  if (n < WINDOW + 2) {
    return {
      row: {
        coin,
        name,
        pair,
        source: got.source,
        current: null,
        lastSignal: null,
        perf: { d7Raw: null, d7Signal: null, d30Raw: null, d30Signal: null },
        nextSignal: null,
        untilNext: { days: null, mfeSignal: null, maeSignal: null },
        enterAfter7dUntilNext: null,
        error: 'Not enough history',
      },
    }
  }

  // compute status/score for day index i using last 200 candles ending at i
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
    })

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
    if (
      curState.status !== prevState.status &&
      (curState.status === 'BUY' || curState.status === 'SELL')
    ) {
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
      row: {
        coin,
        name,
        pair,
        source: got.source,
        current,
        lastSignal: null,
        perf: { d7Raw: null, d7Signal: null, d30Raw: null, d30Signal: null },
        nextSignal: null,
        untilNext: { days: null, mfeSignal: null, maeSignal: null },
        enterAfter7dUntilNext: null,
      },
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
  let nextIdx: number | null = null
  let endIdxExclusive = n // if no next signal, holding period runs to last candle

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
      nextIdx = j
      endIdxExclusive = j + 1 // include day j in the scan range below
      break
    }
  }

  // ✅ Only show horizon returns if the signal actually lasted that long
  const lastedAtLeast = (days: number) => !nextSignal || nextSignal.daysFromSignal >= days

  const d7Raw = eventIdx + 7 < n && lastedAtLeast(7) ? pct(eventClose, closes[eventIdx + 7]) : null
  const d30Raw =
    eventIdx + 30 < n && lastedAtLeast(30) ? pct(eventClose, closes[eventIdx + 30]) : null

  // ✅ MFE/MAE until next signal (direction-aligned)
  // Range: from day AFTER signal (eventIdx+1) up to next signal day (inclusive),
  // or up to last candle if no next signal yet.
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

  const untilNext = {
    days: nextSignal ? nextSignal.daysFromSignal : n - 1 - eventIdx,
    mfeSignal: mfe,
    maeSignal: mae,
  }

  // ✅ NEW: enter AFTER 7 days, exit at next status change (closed only)
  let enterAfter7dUntilNext: Row['enterAfter7dUntilNext'] = null
  if (nextIdx != null) {
    const daysFromSignal = nextIdx - eventIdx
    const entryIdx = eventIdx + 7
    // must have lasted >= 7d and have entry candle
    if (daysFromSignal >= 7 && entryIdx < n && entryIdx <= nextIdx) {
      const entryClose = closes[entryIdx]
      const exitClose = closes[nextIdx]
      const raw = pct(entryClose, exitClose)
      enterAfter7dUntilNext = {
        entryDate: toISODate(times[entryIdx]),
        entryClose,
        exitDate: toISODate(times[nextIdx]),
        exitClose,
        daysFromEntry: nextIdx - entryIdx,
        rawReturnPct: raw,
        signalReturnPct: signalAlign(signalSide, raw),
      }
    }
  }

  return {
    row: {
      coin,
      name,
      pair,
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
      untilNext,
      enterAfter7dUntilNext,
    },
  }
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function median(nums: number[]) {
  if (!nums.length) return null
  const a = [...nums].sort((x, y) => x - y)
  return a[Math.floor(a.length / 2)] ?? null
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    cache5min(res, 300, 1800)

    const kvKey = snapKey.custom('pastperf:crypto:v5') // bump: score model updated with trend/vol filters

    const compute = async () => {
      const pairs = COINS.map(c => c.pairUSD?.binance).filter(Boolean) as string[]

      const rows: Row[] = []
      const batches = chunk(pairs, 3)

      for (let bi = 0; bi < batches.length; bi++) {
        const group = batches[bi]
        const groupRows = await Promise.all(group.map(async pair => (await computeOne(pair)).row))
        rows.push(...groupRows)

        if (bi < batches.length - 1) await sleep(650)
      }

      // ✅ NEW: Aggregate stats for "Enter after 7d → Until next status (closed)"
      const elig = rows
        .map(r => r.enterAfter7dUntilNext?.signalReturnPct)
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))

      const eligible = rows.filter(r => r.enterAfter7dUntilNext != null).length
      const included = elig.length
      const wins = elig.filter(v => v > 0).length

      const enterAfter7dUntilNextStats = {
        eligible, // rows where metric is applicable (closed + lasted >=7d + has entry/exit)
        included, // should match eligible; kept separate for safety
        winrate: included ? wins / included : null, // 0..1
        avg: included ? elig.reduce((s, x) => s + x, 0) / included : null, // in pct points
        median: median(elig), // in pct points
      }

      return {
        meta: {
          computedAt: Date.now(),
          note:
            'Signals use the exact same indicator calculation as crypto-light/indicators (copied unchanged) and the exact same score/status via lib/taScore.computeScoreStatus(). Signals are evaluated on DAILY candles with a rolling 200-candle window. 7d/30d returns are only shown if the signal stayed active for at least that many days. "Signal return" is direction-aligned: BUY = long return, SELL = short/avoid return (sign flipped). "MFE/MAE" show the best/worst direction-aligned move until the next signal.',
          horizons: [
            '7d (if active)',
            '30d (if active)',
            'until next signal',
            'MFE/MAE until next signal',
            'ENTER after 7d → until next signal (closed)',
          ],
        },
        rows,
        // ✅ NEW top-level field
        enterAfter7dUntilNextStats,
      }
    }

    const { data } = await getOrRefreshSnap(kvKey, compute)
    return res.status(200).json(data)
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Internal error' })
  }
}
