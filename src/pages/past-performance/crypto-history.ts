// src/pages/api/past-performance/crypto-history.ts
export const config = { runtime: 'nodejs' }

import type { NextApiRequest, NextApiResponse } from 'next'
import { cache5min } from '@/lib/cacheHeaders'
import { getOrRefreshSnap, snapKey } from '@/lib/kvSnap'
import { COINS } from '@/lib/coins'
import { computeScoreStatus, Status as UiStatus } from '@/lib/taScore'
import { fetchMarketDataFor, computeIndicators } from '@/lib/pastPerformance/cryptoIndicatorsExact'

type Status = UiStatus // 'BUY' | 'HOLD' | 'SELL'

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms))

function pct(from: number, to: number) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0) return null
  return ((to / from) - 1) * 100
}
function signalAlign(status: 'BUY' | 'SELL', raw: number | null): number | null {
  if (raw == null) return null
  return status === 'BUY' ? raw : -raw
}
function chunk<T>(arr: T[], size: number) {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
function median(nums: number[]) {
  if (!nums.length) return null
  const a = [...nums].sort((x, y) => x - y)
  const mid = Math.floor(a.length / 2)
  return a[mid] ?? null
}

type EventTrade = {
  coin: string
  pair: string
  side: 'BUY' | 'SELL'
  startIdx: number
  nextIdx: number | null
  entryIdx7: number | null
  signalToNextDays: number | null
  entryToNextDays: number | null
  signalReturnPct: number | null            // from signal close -> next close (directional)
  enterAfter7dUntilNextPct: number | null   // from day+7 close -> next close (directional)
}

async function computeOneHistory(pair: string) {
  const coinObj = COINS.find(c => c.pairUSD?.binance?.toUpperCase() === pair.toUpperCase())
  const coin = coinObj?.symbol || pair.replace(/USDT$/, '')

  const LOOKBACK = 900
  const WINDOW = 200

  const got = await fetchMarketDataFor(pair.toUpperCase(), { limit: LOOKBACK })
  if (got.ok === false) {
    return { coin, pair, events: [] as EventTrade[], error: got.error as string }
  }

  const { times, closes, volumes } = got.data
  const n = Math.min(times.length, closes.length, volumes.length)
  if (n < WINDOW + 2) return { coin, pair, events: [] as EventTrade[], error: 'Not enough history' }

  // Precompute status/score per day (so we don’t recalc many times)
  const statusArr: Status[] = new Array(n).fill('HOLD')
  const scoreArr: number[] = new Array(n).fill(50)

  for (let i = WINDOW - 1; i < n; i++) {
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

    statusArr[i] = status
    scoreArr[i] = score
  }

  // Find ALL transitions INTO BUY/SELL
  const events: EventTrade[] = []
  for (let i = WINDOW; i < n; i++) {
    const prev = statusArr[i - 1]
    const cur = statusArr[i]
    if (cur !== prev && (cur === 'BUY' || cur === 'SELL')) {
      const side = cur as 'BUY' | 'SELL'
      const startIdx = i

      // next change away from that side
      let nextIdx: number | null = null
      for (let j = startIdx + 1; j < n; j++) {
        if (statusArr[j] !== cur) {
          nextIdx = j
          break
        }
      }

      // compute returns
      const signalClose = closes[startIdx]

      const signalToNextDays = nextIdx != null ? (nextIdx - startIdx) : null
      const entryIdx7 = startIdx + 7 < n ? startIdx + 7 : null

      // signal -> next
      const rawSignalToNext = nextIdx != null ? pct(signalClose, closes[nextIdx]) : null
      const signalReturnPct = signalAlign(side, rawSignalToNext)

      // enter after 7d -> next (closed only + lasted >=7d)
      let enterAfter7dUntilNextPct: number | null = null
      let entryToNextDays: number | null = null
      if (nextIdx != null && entryIdx7 != null && nextIdx - startIdx >= 7 && entryIdx7 <= nextIdx) {
        const entryClose = closes[entryIdx7]
        const raw = pct(entryClose, closes[nextIdx])
        enterAfter7dUntilNextPct = signalAlign(side, raw)
        entryToNextDays = nextIdx - entryIdx7
      }

      events.push({
        coin,
        pair,
        side,
        startIdx,
        nextIdx,
        entryIdx7,
        signalToNextDays,
        entryToNextDays,
        signalReturnPct,
        enterAfter7dUntilNextPct,
      })
    }
  }

  return { coin, pair, events, error: null as string | null }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    cache5min(res, 300, 1800)

    const kvKey = snapKey.custom('pastperf:crypto:history:v1')

    const compute = async () => {
      const pairs = COINS.map(c => c.pairUSD?.binance).filter(Boolean) as string[]
      const batches = chunk(pairs, 2) // history is heavier; keep it a bit smaller

      const allEvents: EventTrade[] = []
      const perCoin: Array<{ coin: string; pair: string; nEvents: number; nClosed: number; nEligible7d: number; winrate7d: number | null }> = []

      for (let bi = 0; bi < batches.length; bi++) {
        const group = batches[bi]
        const results = await Promise.all(group.map(p => computeOneHistory(p)))

        for (const r of results) {
          const ev = r.events || []
          allEvents.push(...ev)

          const closed = ev.filter(e => e.nextIdx != null)
          const eligible7d = ev.filter(e => e.enterAfter7dUntilNextPct != null)
          const wins7d = eligible7d.filter(e => (e.enterAfter7dUntilNextPct as number) > 0).length

          perCoin.push({
            coin: r.coin,
            pair: r.pair,
            nEvents: ev.length,
            nClosed: closed.length,
            nEligible7d: eligible7d.length,
            winrate7d: eligible7d.length ? wins7d / eligible7d.length : null,
          })
        }

        if (bi < batches.length - 1) await sleep(650)
      }

      // Overall stats for strategy: Enter after 7d -> until next (closed)
      const vals = allEvents
        .map(e => e.enterAfter7dUntilNextPct)
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))

      const wins = vals.filter(v => v > 0).length
      const avg = vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : null

      return {
        meta: {
          computedAt: Date.now(),
          note:
            'Historical backtest: includes ALL transitions INTO BUY/SELL per coin within the lookback window. Strategy metric: enter at (signal start + 7 days) and exit at the moment the status changes. Directional: SELL wins when price drops.',
          lookbackDays: 900,
          windowDays: 200,
        },
        enterAfter7dUntilNextStats: {
          included: vals.length,
          winrate: vals.length ? wins / vals.length : null, // 0..1
          avg: avg, // pct points
          median: median(vals), // pct points
        },
        perCoin,     // optional UI later
        sampleSize: {
          totalEvents: allEvents.length,
          eligible7d: vals.length,
        },
      }
    }

    const { data } = await getOrRefreshSnap(kvKey, compute)
    return res.status(200).json(data)
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Internal error' })
  }
}