// src/lib/pastPerformance/equityIndicatorsExact.ts
// 1-op-1: zelfde indicatoren + zelfde scoring-engine als je canonical equity score endpoints
// (sma, rsiWilder, macd, avgVolume) + computeScoreStatus

import { computeScoreStatus } from '@/lib/taScore'
import { sma, rsi as rsiWilder, macd as macdCalc, avgVolume } from '@/lib/ta-light'

export type Advice = 'BUY' | 'HOLD' | 'SELL'

export type EquityIndicators = {
  ma50: number | null
  ma200: number | null
  rsi14: number | null
  macd: { macd: number | null; signal: number | null; hist: number | null }
  volume: { volume: number | null; avg20d: number | null; ratio: number | null }
}

export type EquityScorePoint = EquityIndicators & {
  score: number
  status: Advice
}

/**
 * Compute "exact" indicator snapshot + score for the latest point in a close/volume series.
 * This is the single source of truth for equities past-performance, matching /api/indicators/score/[symbol].
 */
export function computeEquityExact(closes: number[], volumes?: number[] | null): EquityScorePoint {
  const cs = Array.isArray(closes) ? closes.filter(n => Number.isFinite(n)) : []
  const vs = Array.isArray(volumes) ? volumes.filter(n => Number.isFinite(n)) : []

  const ma50 = sma(cs, 50) ?? null
  const ma200 = sma(cs, 200) ?? null

  const rsi14 = rsiWilder(cs, 14) ?? null

  const m = macdCalc(cs, 12, 26, 9)
  const macd = {
    macd: m?.macd ?? null,
    signal: m?.signal ?? null,
    hist: m?.hist ?? null,
  }

  const volNow = vs.length ? vs.at(-1)! : null
  const avg20d = avgVolume(vs, 20) ?? null
  const ratio =
    typeof volNow === 'number' &&
    Number.isFinite(volNow) &&
    typeof avg20d === 'number' &&
    Number.isFinite(avg20d) &&
    avg20d > 0
      ? volNow / avg20d
      : null

  const overall = computeScoreStatus({
    ma: { ma50, ma200 },
    rsi: rsi14,
    macd: { hist: macd.hist },
    volume: { ratio },
  })

  const score = Number.isFinite(overall.score) ? Math.round(overall.score) : 50
  const status = (overall.status as Advice) || 'HOLD'

  return {
    ma50,
    ma200,
    rsi14,
    macd,
    volume: { volume: volNow, avg20d, ratio },
    score,
    status,
  }
}

/**
 * Build a historical series of exact equity score points.
 *
 * For each index i, it computes indicators using closes[0..i] (and volumes[0..i] if provided),
 * ensuring the exact same indicator logic as "now".
 *
 * NOTE: This is O(n^2). For 1y daily bars (~252), it's totally fine.
 * If you ever go multi-year + many symbols, we can optimize later.
 */
export function buildEquityExactSeries(
  closes: number[],
  volumes?: number[] | null
): EquityScorePoint[] {
  const cs = Array.isArray(closes) ? closes.filter(n => Number.isFinite(n)) : []
  const vs = Array.isArray(volumes) ? volumes.filter(n => Number.isFinite(n)) : []

  const out: EquityScorePoint[] = []
  for (let i = 0; i < cs.length; i++) {
    const subCloses = cs.slice(0, i + 1)
    const subVolumes = vs.length ? vs.slice(0, Math.min(i + 1, vs.length)) : null
    out.push(computeEquityExact(subCloses, subVolumes))
  }
  return out
}