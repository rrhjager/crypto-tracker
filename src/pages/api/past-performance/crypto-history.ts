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

type PerCoin = {
  coin: string
  pair: string
  nEvents: number
  nClosed: number
  nEligible7d: number
  winrate7d: number | null // 0..1
}

async function computeOneHistory(pair: string) {
  const coinObj = COINS.find(c => c.pairUSD?.binance?.toUpperCase() === pair.toUpperCase())
  const coin = coinObj?.symbol || pair.replace(/USDT$/, '')

  const LOOKBACK = 900
  const WINDOW = 200

  const got = await fetchMarketDataFor(pair.toUpperCase(), { limit: LOOKBACK })
  if (got.ok === false) return { perCoin: null as PerCoin | null, vals7d: [] as number[] }

  const { closes, volumes } = got.data
  const n = Math.min(closes.length, volumes.length)
  if (n < WINDOW + 2) return { perCoin: null as PerCoin | null, vals7d: [] as number[] }

  const statusArr: Status[] = new Array(n).fill('HOLD')

  for (let i = WINDOW - 1; i < n; i++) {
    const from = i - (WINDOW - 1)
    const cWin = closes.slice(from, i + 1)
    const vWin = volumes.slice(from, i + 1)
    const ind = computeIndicators(cWin, vWin)

    const { status } = computeScoreStatus({
      ma: { ma50: ind.ma.ma50, ma200: ind.ma.ma200 },
      rsi: ind.rsi,
      macd: { hist: ind.macd.hist },
      volume: { ratio: ind.volume.ratio },
      trend: ind.trend,
      volatility: ind.volatility,
    }, { market: 'CRYPTO' })

    statusArr[i] = status
  }

  let nEvents = 0
  let nClosed = 0
  let nEligible7d = 0
  let wins7d = 0
  const vals7d: number[] = []

  for (let i = WINDOW; i < n; i++) {
    const prev = statusArr[i - 1]
    const cur = statusArr[i]
    if (cur === prev) continue
    if (cur !== 'BUY' && cur !== 'SELL') continue

    nEvents += 1
    const side = cur as 'BUY' | 'SELL'
    const startIdx = i

    let nextIdx: number | null = null
    for (let j = startIdx + 1; j < n; j++) {
      if (statusArr[j] !== cur) {
        nextIdx = j
        break
      }
    }
    if (nextIdx == null) continue
    nClosed += 1

    const entryIdx = startIdx + 7
    if (nextIdx - startIdx < 7) continue
    if (entryIdx >= n) continue
    if (entryIdx > nextIdx) continue

    const raw = pct(closes[entryIdx], closes[nextIdx])
    const aligned = signalAlign(side, raw)
    if (aligned == null || !Number.isFinite(aligned)) continue

    nEligible7d += 1
    if (aligned > 0) wins7d += 1
    vals7d.push(aligned)
  }

  const perCoin: PerCoin = {
    coin,
    pair,
    nEvents,
    nClosed,
    nEligible7d,
    winrate7d: nEligible7d ? wins7d / nEligible7d : null,
  }

  return { perCoin, vals7d }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    cache5min(res, 300, 1800)

    const kvKey = snapKey.custom('pastperf:crypto:history:v2')

    const compute = async () => {
      const pairs = COINS.map(c => c.pairUSD?.binance).filter(Boolean) as string[]
      const batches = chunk(pairs, 2)

      const perCoin: PerCoin[] = []
      const allVals: number[] = []
      let totalEvents = 0

      for (let bi = 0; bi < batches.length; bi++) {
        const group = batches[bi]
        const results = await Promise.all(group.map(p => computeOneHistory(p)))

        for (const r of results) {
          if (r.perCoin) {
            perCoin.push(r.perCoin)
            totalEvents += r.perCoin.nEvents
          }
          allVals.push(...r.vals7d)
        }

        if (bi < batches.length - 1) await sleep(650)
      }

      const wins = allVals.filter(v => v > 0).length
      const avg = allVals.length ? allVals.reduce((s, x) => s + x, 0) / allVals.length : null

      return {
        meta: {
          computedAt: Date.now(),
          lookbackDays: 900,
          windowDays: 200,
        },
        enterAfter7dUntilNextStats: {
          included: allVals.length,
          winrate: allVals.length ? wins / allVals.length : null,
          avg,
          median: median(allVals),
        },
        sampleSize: {
          totalEvents,
          eligible7d: allVals.length,
        },
        perCoin,
      }
    }

    const { data } = await getOrRefreshSnap(kvKey, compute)
    return res.status(200).json(data)
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Internal error' })
  }
}
