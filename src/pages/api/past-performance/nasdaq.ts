// src/pages/api/past-performance/nasdaq.ts
export const config = { runtime: 'nodejs' }

import type { NextApiRequest, NextApiResponse } from 'next'
import { NASDAQ } from '@/lib/nasdaq'
import { cache5min } from '@/lib/cacheHeaders'
import { computeScoreStatus } from '@/lib/taScore'
import { lookbackReturnPctAt, rangePositionAt, realizedVolatilityAt } from '@/lib/taExtras'

type Advice = 'BUY' | 'HOLD' | 'SELL'

type NextSignal = {
  date: string
  status: Advice
  score: number
  close: number
  daysFromSignal: number
  rawReturnPct: number | null
  signalReturnPct: number | null
}

type Row = {
  symbol: string
  name: string

  current: { date: string; status: Advice; score: number; close: number } | null
  lastSignal: { date: string; status: 'BUY' | 'SELL'; score: number; close: number } | null

  perf: {
    d7Raw: number | null
    d7Signal: number | null
    d30Raw: number | null
    d30Signal: number | null
  }

  nextSignal: NextSignal | null

  error?: string
}

function toISODate(sec: number) {
  return new Date(sec * 1000).toISOString().slice(0, 10)
}

function pct(from: number, to: number) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0) return null
  return ((to / from) - 1) * 100
}

function signalFromRaw(side: 'BUY' | 'SELL', raw: number | null) {
  if (raw == null) return null
  return side === 'BUY' ? raw : -raw
}

function smaAt(arr: number[], i: number, period: number) {
  if (i + 1 < period) return null
  let s = 0
  for (let k = i - period + 1; k <= i; k++) s += arr[k]
  return s / period
}

function emaSeries(arr: number[], period: number) {
  const out: Array<number | null> = new Array(arr.length).fill(null)
  if (arr.length < period) return out
  const k = 2 / (period + 1)

  let seed = 0
  for (let i = 0; i < period; i++) seed += arr[i]
  seed /= period
  out[period - 1] = seed

  let prev = seed
  for (let i = period; i < arr.length; i++) {
    const v = arr[i]
    const next = v * k + prev * (1 - k)
    out[i] = next
    prev = next
  }
  return out
}

function rsiSeries(closes: number[], period = 14) {
  const out: Array<number | null> = new Array(closes.length).fill(null)
  if (closes.length < period + 1) return out

  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1]
    if (ch >= 0) gain += ch
    else loss += -ch
  }

  let avgGain = gain / period
  let avgLoss = loss / period

  const rs0 = avgLoss === 0 ? Infinity : avgGain / avgLoss
  out[period] = 100 - 100 / (1 + rs0)

  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1]
    const g = ch > 0 ? ch : 0
    const l = ch < 0 ? -ch : 0

    avgGain = (avgGain * (period - 1) + g) / period
    avgLoss = (avgLoss * (period - 1) + l) / period

    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss
    out[i] = 100 - 100 / (1 + rs)
  }

  return out
}

function macdHistSeries(closes: number[]) {
  const ema12 = emaSeries(closes, 12)
  const ema26 = emaSeries(closes, 26)

  const macd: Array<number | null> = closes.map((_, i) => {
    const a = ema12[i]
    const b = ema26[i]
    if (a == null || b == null) return null
    return a - b
  })

  const macdVals: number[] = []
  const idxMap: number[] = []
  for (let i = 0; i < macd.length; i++) {
    if (macd[i] != null) {
      macdVals.push(macd[i] as number)
      idxMap.push(i)
    }
  }

  const sigCompact = emaSeries(macdVals, 9)
  const signal: Array<number | null> = new Array(closes.length).fill(null)
  for (let j = 0; j < sigCompact.length; j++) {
    const idx = idxMap[j]
    signal[idx] = sigCompact[j]
  }

  const hist: Array<number | null> = closes.map((_, i) => {
    const m = macd[i]
    const s = signal[i]
    if (m == null || s == null) return null
    return m - s
  })

  return hist
}

async function fetchYahooDaily(symbol: string) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=2y&interval=1d&includePrePost=false&events=div%7Csplit`

  const r = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'Mozilla/5.0 (SignalHub) past-performance',
    },
  })

  if (!r.ok) throw new Error(`Yahoo HTTP ${r.status}`)
  const j = await r.json()

  const res = j?.chart?.result?.[0]
  const ts: number[] = Array.isArray(res?.timestamp) ? res.timestamp : []
  const quote = res?.indicators?.quote?.[0]
  const closeRaw: Array<number | null> = Array.isArray(quote?.close) ? quote.close : []
  const volRaw: Array<number | null> = Array.isArray(quote?.volume) ? quote.volume : []

  const times: number[] = []
  const closes: number[] = []
  const volumes: number[] = []

  for (let i = 0; i < ts.length; i++) {
    const c = closeRaw[i]
    const v = volRaw[i]
    if (c == null || !Number.isFinite(c)) continue
    times.push(ts[i])
    closes.push(c)
    volumes.push(v != null && Number.isFinite(v) ? v : 0)
  }

  if (closes.length < 260) throw new Error('Not enough daily history')
  return { times, closes, volumes }
}

function computeStates(times: number[], closes: number[], volumes: number[]) {
  const rsi = rsiSeries(closes, 14)
  const hist = macdHistSeries(closes)

  const states: Array<{ status: Advice; score: number }> = new Array(closes.length).fill(null as any)

  for (let i = 0; i < closes.length; i++) {
    const ma50 = smaAt(closes, i, 50)
    const ma200 = smaAt(closes, i, 200)
    const rsi14 = rsi[i]
    const macdHist = hist[i]

    const volAvg20 = smaAt(volumes, i, 20)
    const volRatio = volAvg20 && volAvg20 > 0 ? volumes[i] / volAvg20 : null
    const trend = {
      ret20: lookbackReturnPctAt(closes, i, 20),
      rangePos20: rangePositionAt(closes, i, 20),
    }
    const volatility = { stdev20: realizedVolatilityAt(closes, i, 20) }

    const { score, status } = computeScoreStatus({
      ma: { ma50, ma200 },
      rsi: rsi14,
      macd: { hist: macdHist },
      volume: { ratio: volRatio },
      trend,
      volatility,
    })

    states[i] = { score, status }
  }

  return states
}

async function computeRow(symbol: string, name: string): Promise<Row> {
  try {
    const { times, closes, volumes } = await fetchYahooDaily(symbol)
    const states = computeStates(times, closes, volumes)

    const lastIdx = closes.length - 1
    const cur = states[lastIdx]
    const current = {
      date: toISODate(times[lastIdx]),
      status: cur.status,
      score: cur.score,
      close: closes[lastIdx],
    }

    const MIN_I = 220
    let eventIdx: number | null = null
    let eventStatus: Advice | null = null
    let eventScore = 50

    let curIdx = lastIdx
    let curState = states[lastIdx]

    for (let i = lastIdx - 1; i >= MIN_I; i--) {
      const prevState = states[i]
      if (curState.status !== prevState.status && (curState.status === 'BUY' || curState.status === 'SELL')) {
        eventIdx = curIdx
        eventStatus = curState.status
        eventScore = curState.score
        break
      }
      curIdx = i
      curState = prevState
    }

    if (eventIdx == null || eventStatus == null) {
      return {
        symbol,
        name,
        current,
        lastSignal: null,
        perf: { d7Raw: null, d7Signal: null, d30Raw: null, d30Signal: null },
        nextSignal: null,
      }
    }

    const side = eventStatus as 'BUY' | 'SELL'
    const eventClose = closes[eventIdx]

    const lastSignal = {
      date: toISODate(times[eventIdx]),
      status: side,
      score: eventScore,
      close: eventClose,
    }

    const d7Raw = eventIdx + 7 < closes.length ? pct(eventClose, closes[eventIdx + 7]) : null
    const d30Raw = eventIdx + 30 < closes.length ? pct(eventClose, closes[eventIdx + 30]) : null

    let nextSignal: NextSignal | null = null
    for (let j = eventIdx + 1; j < closes.length; j++) {
      const st = states[j]
      if (st.status !== eventStatus) {
        const raw = pct(eventClose, closes[j])
        nextSignal = {
          date: toISODate(times[j]),
          status: st.status,
          score: st.score,
          close: closes[j],
          daysFromSignal: j - eventIdx,
          rawReturnPct: raw,
          signalReturnPct: signalFromRaw(side, raw),
        }
        break
      }
    }

    // ✅ CHANGE ONLY: if still open, count it "as of now" (so winrate includes open positions)
    if (!nextSignal) {
      const raw = pct(eventClose, closes[lastIdx])
      nextSignal = {
        date: toISODate(times[lastIdx]),
        status: current.status,
        score: current.score,
        close: closes[lastIdx],
        daysFromSignal: lastIdx - eventIdx,
        rawReturnPct: raw,
        signalReturnPct: signalFromRaw(side, raw),
      }
    }

    return {
      symbol,
      name,
      current,
      lastSignal,
      perf: {
        d7Raw,
        d7Signal: signalFromRaw(side, d7Raw),
        d30Raw,
        d30Signal: signalFromRaw(side, d30Raw),
      },
      nextSignal,
    }
  } catch (e: any) {
    return {
      symbol,
      name,
      current: null,
      lastSignal: null,
      perf: { d7Raw: null, d7Signal: null, d30Raw: null, d30Signal: null },
      nextSignal: null,
      error: String(e?.message || e),
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

    const symbols = NASDAQ.map(x => ({ symbol: x.symbol, name: x.name }))
    const rows: Row[] = []

    const batches = chunk(symbols, 6)
    for (let bi = 0; bi < batches.length; bi++) {
      const group = batches[bi]
      const part = await Promise.all(group.map(x => computeRow(x.symbol, x.name)))
      rows.push(...part)
      if (bi < batches.length - 1) await new Promise(r => setTimeout(r, 250))
    }

    res.status(200).json({
      meta: { market: 'NASDAQ', computedAt: Date.now() },
      rows,
    })
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) })
  }
}
