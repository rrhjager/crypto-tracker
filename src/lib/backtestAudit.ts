import type { ScoreMarket, Status } from '@/lib/taScore'
import { computeScoreStatus } from '@/lib/taScore'

const WINDOW = 200

type SignalSide = 'BUY' | 'SELL'
type StrategyKey = 'status_flip' | 'strength_70' | 'strength_80' | 'entry_70' | 'entry_80'

type TrendSnapshot = {
  ret20: number | null
  ret60?: number | null
  rangePos20: number | null
  efficiency14?: number | null
}

type VolSnapshot = { stdev20: number | null }

type IndicatorSnapshot = {
  ma: { ma50: number | null; ma200: number | null }
  rsi: number | null
  macd: { hist: number | null }
  volume: { ratio: number | null }
  trend: TrendSnapshot
  volatility: VolSnapshot
}

type IndicatorComputer = (closes: number[], volumes: number[]) => IndicatorSnapshot

export type DailySignalPoint = {
  index: number
  date: string
  close: number
  score: number
  status: Status
  strength: number | null
  entryScore70: number | null
  entryScore80: number | null
  entryQualifies70: boolean
  entryQualifies80: boolean
}

export type BacktestTrade = {
  symbol: string
  name: string
  market: ScoreMarket
  strategy: StrategyKey
  side: SignalSide
  entryDate: string
  exitDate: string
  entryScore: number
  exitScore: number
  daysHeld: number
  returnPct: number
}

export type OpenPosition = {
  symbol: string
  name: string
  side: SignalSide
  entryDate: string
  daysOpen: number
  returnPctToNow: number
}

export type StrategyStats = {
  key: StrategyKey
  label: string
  closedTrades: number
  wins: number
  losses: number
  winrate: number | null
  avgReturnPct: number | null
  medianReturnPct: number | null
  avgDaysHeld: number | null
  flatProfitOn100Each: number | null
  compoundedValueOf100: number | null
  maxDrawdownPct: number | null
  openPositions: number
  recentTrades: BacktestTrade[]
  topAssets: Array<{
    symbol: string
    name: string
    closedTrades: number
    winrate: number | null
    avgReturnPct: number | null
    compoundedValueOf100: number | null
  }>
}

export type AssetAuditInput = {
  symbol: string
  name: string
  market: ScoreMarket
  times: number[]
  closes: number[]
  volumes: number[]
}

type AssetAuditState = {
  symbol: string
  name: string
  points: DailySignalPoint[]
  byStrategy: Record<StrategyKey, { trades: BacktestTrade[]; open: OpenPosition | null }>
}

const STRATEGY_ORDER: StrategyKey[] = ['status_flip', 'strength_70', 'strength_80', 'entry_70', 'entry_80']

const STRATEGY_META: Record<StrategyKey, { label: string; threshold: 0 | 70 | 80; entrySafe: boolean }> = {
  status_flip: { label: 'Ruwe statusflips', threshold: 0, entrySafe: false },
  strength_70: { label: 'Sterkte 70+', threshold: 70, entrySafe: false },
  strength_80: { label: 'Sterkte 80+', threshold: 80, entrySafe: false },
  entry_70: { label: 'Entry-safe 70+', threshold: 70, entrySafe: true },
  entry_80: { label: 'Entry-safe 80+', threshold: 80, entrySafe: true },
}

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))

function pct(from: number, to: number) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0) return null
  return ((to / from) - 1) * 100
}

function signalAlign(side: SignalSide, raw: number | null) {
  if (raw == null) return null
  return side === 'BUY' ? raw : -raw
}

function toISODate(ms: number) {
  return new Date(ms).toISOString().slice(0, 10)
}

function median(nums: number[]) {
  if (!nums.length) return null
  const a = [...nums].sort((x, y) => x - y)
  const mid = Math.floor(a.length / 2)
  if (a.length % 2) return a[mid] ?? null
  const left = a[mid - 1]
  const right = a[mid]
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null
  return (left + right) / 2
}

function computeEntryQualification(
  status: SignalSide,
  strength: number,
  threshold: 70 | 80,
  ind: IndicatorSnapshot
) {
  let score = 0
  let maxScore = 0

  const strengthRoom = Math.max(1, 100 - threshold)
  maxScore += 28
  score += clamp(((strength - threshold) / strengthRoom) * 28, 0, 28)

  const ret20 = Number(ind.trend?.ret20)
  const ret60 = Number(ind.trend?.ret60)
  const rangePos20 = Number(ind.trend?.rangePos20)
  const efficiency14 = Number(ind.trend?.efficiency14)
  const volumeRatio = Number(ind.volume?.ratio)
  const stdev20 = Number(ind.volatility?.stdev20)
  const rsi = Number(ind.rsi)

  maxScore += 18
  if (Number.isFinite(ret20)) {
    if ((status === 'BUY' && ret20 > 0) || (status === 'SELL' && ret20 < 0)) score += 10
    else score += 2
  } else {
    score += 5
  }
  if (Number.isFinite(ret60)) {
    if ((status === 'BUY' && ret60 > 0) || (status === 'SELL' && ret60 < 0)) score += 8
    else score += 2
  } else {
    score += 4
  }

  maxScore += 16
  if (Number.isFinite(rangePos20)) {
    if (status === 'BUY') {
      if (rangePos20 >= 0.58) score += 10
      else if (rangePos20 >= 0.48) score += 6
      else score += 2
    } else {
      if (rangePos20 <= 0.42) score += 10
      else if (rangePos20 <= 0.52) score += 6
      else score += 2
    }
  } else {
    score += 5
  }
  if (Number.isFinite(efficiency14)) {
    score += clamp(efficiency14, 0, 1) * 6
  } else {
    score += 3
  }

  maxScore += 12
  if (Number.isFinite(rsi)) {
    if (status === 'BUY') {
      if (rsi >= 48 && rsi <= 69) score += 12
      else if (rsi > 69 && rsi <= 75) score += 6
      else if (rsi >= 40) score += 8
      else score += 2
    } else {
      if (rsi >= 31 && rsi <= 52) score += 12
      else if (rsi >= 25 && rsi < 31) score += 6
      else if (rsi <= 60) score += 8
      else score += 2
    }
  } else {
    score += 6
  }

  maxScore += 10
  if (Number.isFinite(volumeRatio)) {
    if (volumeRatio >= 0.95 && volumeRatio <= 2.2) score += 10
    else if (volumeRatio >= 0.75) score += 6
    else score += 3
  } else {
    score += 5
  }

  maxScore += 16
  if (Number.isFinite(stdev20)) {
    if (stdev20 >= 0.008 && stdev20 <= 0.09) score += 16
    else if (stdev20 <= 0.12) score += 10
    else score += 4
  } else {
    score += 8
  }

  const qualityScore = Math.round((score / Math.max(1, maxScore)) * 100)
  const minQuality = threshold === 80 ? 63 : 55

  return {
    qualityScore,
    qualifies: qualityScore >= minQuality,
  }
}

export function buildDailySignalSeries(input: AssetAuditInput, computeIndicators: IndicatorComputer) {
  const { times, closes, volumes, market } = input
  const n = Math.min(times.length, closes.length, volumes.length)
  if (n < WINDOW + 2) return [] as DailySignalPoint[]

  const points: DailySignalPoint[] = []

  for (let i = WINDOW - 1; i < n; i++) {
    const from = i - (WINDOW - 1)
    const cWin = closes.slice(from, i + 1)
    const vWin = volumes.slice(from, i + 1)
    const ind = computeIndicators(cWin, vWin)
    const { score, status } = computeScoreStatus(
      {
        ma: { ma50: ind.ma.ma50, ma200: ind.ma.ma200 },
        rsi: ind.rsi,
        macd: { hist: ind.macd.hist },
        volume: { ratio: ind.volume.ratio },
        trend: ind.trend,
        volatility: ind.volatility,
      },
      { market }
    )

    const roundedScore = Math.round(score)
    const strength = status === 'BUY' ? roundedScore : status === 'SELL' ? Math.round(100 - roundedScore) : null
    const q70 =
      status === 'BUY' || status === 'SELL'
        ? computeEntryQualification(status, strength ?? 0, 70, ind)
        : { qualityScore: null, qualifies: false }
    const q80 =
      status === 'BUY' || status === 'SELL'
        ? computeEntryQualification(status, strength ?? 0, 80, ind)
        : { qualityScore: null, qualifies: false }

    points.push({
      index: i,
      date: toISODate(times[i]),
      close: closes[i],
      score: roundedScore,
      status,
      strength,
      entryScore70: q70.qualityScore,
      entryScore80: q80.qualityScore,
      entryQualifies70: q70.qualifies,
      entryQualifies80: q80.qualifies,
    })
  }

  return points
}

function isEligible(point: DailySignalPoint, strategy: StrategyKey) {
  if (point.status !== 'BUY' && point.status !== 'SELL') return false

  if (strategy === 'status_flip') return true
  if (point.strength == null) return false

  if (strategy === 'strength_70') return point.strength >= 70
  if (strategy === 'strength_80') return point.strength >= 80
  if (strategy === 'entry_70') return point.strength >= 70 && point.entryQualifies70
  return point.strength >= 80 && point.entryQualifies80
}

function simulateStrategy(input: AssetAuditInput, strategy: StrategyKey, points: DailySignalPoint[]) {
  const trades: BacktestTrade[] = []
  let open:
    | {
        side: SignalSide
        entryDate: string
        entryScore: number
        entryClose: number
        entryIndex: number
      }
    | null = null

  for (let i = 0; i < points.length; i++) {
    const point = points[i]
    const prev = i > 0 ? points[i - 1] : null
    const eligible = isEligible(point, strategy)

    if (open) {
      const mustExit =
        point.status !== open.side ||
        (strategy !== 'status_flip' && (!eligible || point.status !== open.side))

      if (mustExit) {
        const raw = pct(open.entryClose, point.close)
        const aligned = signalAlign(open.side, raw)
        if (aligned != null && Number.isFinite(aligned)) {
          trades.push({
            symbol: input.symbol,
            name: input.name,
            market: input.market,
            strategy,
            side: open.side,
            entryDate: open.entryDate,
            exitDate: point.date,
            entryScore: open.entryScore,
            exitScore: point.score,
            daysHeld: Math.max(0, point.index - open.entryIndex),
            returnPct: aligned,
          })
        }
        open = null
      }
    }

    if (!open && eligible) {
      const prevEligibleSameSide = prev ? prev.status === point.status && isEligible(prev, strategy) : false
      if (!prevEligibleSameSide) {
        open = {
          side: point.status as SignalSide,
          entryDate: point.date,
          entryScore: point.score,
          entryClose: point.close,
          entryIndex: point.index,
        }
      }
    }
  }

  let openPosition: OpenPosition | null = null
  if (open && points.length) {
    const last = points[points.length - 1]
    const raw = pct(open.entryClose, last.close)
    const aligned = signalAlign(open.side, raw)
    if (aligned != null && Number.isFinite(aligned)) {
      openPosition = {
        symbol: input.symbol,
        name: input.name,
        side: open.side,
        entryDate: open.entryDate,
        daysOpen: Math.max(0, last.index - open.entryIndex),
        returnPctToNow: aligned,
      }
    }
  }

  return { trades, open: openPosition }
}

export function runAssetAudit(input: AssetAuditInput, computeIndicators: IndicatorComputer): AssetAuditState {
  const points = buildDailySignalSeries(input, computeIndicators)
  const byStrategy = Object.fromEntries(
    STRATEGY_ORDER.map((strategy) => [strategy, simulateStrategy(input, strategy, points)])
  ) as AssetAuditState['byStrategy']

  return {
    symbol: input.symbol,
    name: input.name,
    points,
    byStrategy,
  }
}

function computeMaxDrawdownPct(returns: number[]) {
  if (!returns.length) return null
  let equity = 100
  let peak = 100
  let maxDd = 0

  for (const ret of returns) {
    equity *= 1 + ret / 100
    if (equity > peak) peak = equity
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0
    if (dd > maxDd) maxDd = dd
  }

  return maxDd
}

function summarizeStrategy(
  strategy: StrategyKey,
  assetStates: AssetAuditState[]
): StrategyStats {
  const trades = assetStates.flatMap((state) => state.byStrategy[strategy].trades)
  const openPositions = assetStates.map((state) => state.byStrategy[strategy].open).filter(Boolean) as OpenPosition[]
  const returns = trades.map((trade) => trade.returnPct)
  const wins = returns.filter((v) => v > 0).length
  const losses = returns.filter((v) => v <= 0).length
  const avgReturnPct = returns.length ? returns.reduce((sum, v) => sum + v, 0) / returns.length : null
  const avgDaysHeld = trades.length ? trades.reduce((sum, trade) => sum + trade.daysHeld, 0) / trades.length : null
  const flatProfitOn100Each = returns.length ? returns.reduce((sum, v) => sum + v, 0) : null
  const compoundedValueOf100 = returns.length
    ? returns.reduce((equity, ret) => equity * (1 + ret / 100), 100)
    : null

  const perAsset = new Map<string, { symbol: string; name: string; returns: number[] }>()
  for (const trade of trades) {
    const key = `${trade.symbol}::${trade.name}`
    const row = perAsset.get(key) || { symbol: trade.symbol, name: trade.name, returns: [] }
    row.returns.push(trade.returnPct)
    perAsset.set(key, row)
  }

  const topAssets = [...perAsset.values()]
    .map((item) => {
      const itemWins = item.returns.filter((v) => v > 0).length
      const avg = item.returns.reduce((sum, v) => sum + v, 0) / item.returns.length
      const compounded = item.returns.reduce((equity, ret) => equity * (1 + ret / 100), 100)
      return {
        symbol: item.symbol,
        name: item.name,
        closedTrades: item.returns.length,
        winrate: item.returns.length ? itemWins / item.returns.length : null,
        avgReturnPct: avg,
        compoundedValueOf100: compounded,
      }
    })
    .sort((a, b) => {
      if (b.closedTrades !== a.closedTrades) return b.closedTrades - a.closedTrades
      const aAvg = a.avgReturnPct ?? -999999
      const bAvg = b.avgReturnPct ?? -999999
      if (bAvg !== aAvg) return bAvg - aAvg
      return a.symbol.localeCompare(b.symbol)
    })
    .slice(0, 8)

  return {
    key: strategy,
    label: STRATEGY_META[strategy].label,
    closedTrades: trades.length,
    wins,
    losses,
    winrate: trades.length ? wins / trades.length : null,
    avgReturnPct,
    medianReturnPct: median(returns),
    avgDaysHeld,
    flatProfitOn100Each,
    compoundedValueOf100,
    maxDrawdownPct: computeMaxDrawdownPct(returns),
    openPositions: openPositions.length,
    recentTrades: trades.slice(-5).reverse(),
    topAssets,
  }
}

export function summarizeMarketAudit(assetStates: AssetAuditState[]) {
  return STRATEGY_ORDER.map((strategy) => summarizeStrategy(strategy, assetStates))
}

export function getStrategyMeta(strategy: StrategyKey) {
  return STRATEGY_META[strategy]
}

export function getStrategyOrder() {
  return [...STRATEGY_ORDER]
}
