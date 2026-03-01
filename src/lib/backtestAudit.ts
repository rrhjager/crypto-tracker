import type { ScoreMarket, Status } from '@/lib/taScore'
import { computeScoreStatus } from '@/lib/taScore'
import { latestRangeStrengthFeatures, latestRelativeStrengthFeatures } from '@/lib/taExtras'

const WINDOW = 200

type SignalSide = 'BUY' | 'SELL'
type StrategyKey = 'status_flip' | 'strength_70' | 'strength_80' | 'entry_70' | 'entry_80'
type ExitProfile = {
  key: string
  label: string
  maxHoldDays: number | null
  takeProfitPct: number | null
  stopLossPct: number | null
}

type VariantTrade = {
  side: SignalSide
  returnPct: number
  daysHeld: number
}

type TrendSnapshot = {
  ret20: number | null
  ret60?: number | null
  rangePos20: number | null
  rangePos55?: number | null
  efficiency14?: number | null
  breakout20?: number | null
  breakout55?: number | null
  stretch20?: number | null
  adx14?: number | null
  relBench20?: number | null
  relBench60?: number | null
}

type VolSnapshot = { stdev20: number | null; atrPct14?: number | null }

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
  highs?: number[]
  lows?: number[]
  closes: number[]
  volumes: number[]
  benchmarkCloses?: number[] | null
}

type AssetAuditState = {
  symbol: string
  name: string
  market: ScoreMarket
  points: DailySignalPoint[]
  byStrategy: Record<StrategyKey, { trades: BacktestTrade[]; open: OpenPosition | null }>
}

export type QualifiedLivePick = {
  symbol: string
  name: string
  market: ScoreMarket
  status: SignalSide
  strategy: StrategyKey
  strategyLabel: string
  currentScore: number
  strength: number
  validationWinrate: number
  validationAvgReturnPct: number
  trainingTrades: number
  validationTrades: number
}

const STRATEGY_ORDER: StrategyKey[] = ['status_flip', 'strength_70', 'strength_80', 'entry_70', 'entry_80']

const STRATEGY_META: Record<StrategyKey, { label: string; threshold: 0 | 70 | 80; entrySafe: boolean }> = {
  status_flip: { label: 'Ruwe statusflips', threshold: 0, entrySafe: false },
  strength_70: { label: 'Sterkte 70+', threshold: 70, entrySafe: false },
  strength_80: { label: 'Sterkte 80+', threshold: 80, entrySafe: false },
  entry_70: { label: 'Entry-safe 70+', threshold: 70, entrySafe: true },
  entry_80: { label: 'Entry-safe 80+', threshold: 80, entrySafe: true },
}

const EXIT_PROFILES: ExitProfile[] = [
  { key: 'flip', label: 'Flip exit', maxHoldDays: null, takeProfitPct: null, stopLossPct: null },
  { key: 'tp4_sl6_h5', label: 'TP 4% / SL 6% / max 5d', maxHoldDays: 5, takeProfitPct: 4, stopLossPct: 6 },
  { key: 'tp6_sl6_h8', label: 'TP 6% / SL 6% / max 8d', maxHoldDays: 8, takeProfitPct: 6, stopLossPct: 6 },
  { key: 'tp8_sl5_h10', label: 'TP 8% / SL 5% / max 10d', maxHoldDays: 10, takeProfitPct: 8, stopLossPct: 5 },
  { key: 'tp12_sl6_h14', label: 'TP 12% / SL 6% / max 14d', maxHoldDays: 14, takeProfitPct: 12, stopLossPct: 6 },
  { key: 'time3', label: 'Max 3 dagen', maxHoldDays: 3, takeProfitPct: null, stopLossPct: null },
]

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
  const readNum = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN

  let score = 0
  let maxScore = 0

  const strengthRoom = Math.max(1, 100 - threshold)
  maxScore += 16
  score += clamp(((strength - threshold) / strengthRoom) * 16, 0, 16)

  const ret20 = readNum(ind.trend?.ret20)
  const ret60 = readNum(ind.trend?.ret60)
  const rangePos20 = readNum(ind.trend?.rangePos20)
  const rangePos55 = readNum(ind.trend?.rangePos55)
  const breakout20 = readNum(ind.trend?.breakout20)
  const breakout55 = readNum(ind.trend?.breakout55)
  const stretch20 = readNum(ind.trend?.stretch20)
  const volumeRatio = readNum(ind.volume?.ratio)
  const stdev20 = readNum(ind.volatility?.stdev20)
  const atrPct14 = readNum(ind.volatility?.atrPct14)
  const adx14 = readNum(ind.trend?.adx14)
  const relBench20 = readNum(ind.trend?.relBench20)
  const relBench60 = readNum(ind.trend?.relBench60)
  const rsi = readNum(ind.rsi)
  const ma50 = readNum(ind.ma?.ma50)
  const ma200 = readNum(ind.ma?.ma200)
  const macdHist = readNum(ind.macd?.hist)

  maxScore += 24
  if (Number.isFinite(ret20)) {
    const favorable = (status === 'BUY' && ret20 > 0) || (status === 'SELL' && ret20 < 0)
    if (favorable && Math.abs(ret20) >= 2.5) score += 12
    else if (favorable) score += 8
    else score += 1
  } else {
    score += 5
  }
  if (Number.isFinite(ret60)) {
    const favorable = (status === 'BUY' && ret60 > 0) || (status === 'SELL' && ret60 < 0)
    if (favorable && Math.abs(ret60) >= 4) score += 12
    else if (favorable) score += 8
    else score += 1
  } else {
    score += 5
  }

  maxScore += 16
  if (Number.isFinite(rangePos20)) {
    if (status === 'BUY') {
      if (rangePos20 >= 0.58) score += 6
      else if (rangePos20 >= 0.48) score += 4
      else score += 1
    } else {
      if (rangePos20 <= 0.42) score += 6
      else if (rangePos20 <= 0.52) score += 4
      else score += 1
    }
  } else {
    score += 3
  }
  if (Number.isFinite(rangePos55)) {
    if (status === 'BUY') score += rangePos55 >= 0.55 ? 3 : rangePos55 >= 0.48 ? 2 : 0
    else score += rangePos55 <= 0.45 ? 3 : rangePos55 <= 0.52 ? 2 : 0
  } else {
    score += 1.5
  }
  if (Number.isFinite(breakout20)) {
    if ((status === 'BUY' && breakout20 >= 0.18) || (status === 'SELL' && breakout20 <= -0.18)) score += 5
    else if ((status === 'BUY' && breakout20 > 0) || (status === 'SELL' && breakout20 < 0)) score += 3
  } else {
    score += 1.5
  }
  if (Number.isFinite(breakout55)) {
    if ((status === 'BUY' && breakout55 >= 0.12) || (status === 'SELL' && breakout55 <= -0.12)) score += 2
    else if ((status === 'BUY' && breakout55 > 0) || (status === 'SELL' && breakout55 < 0)) score += 1
  } else {
    score += 1
  }

  maxScore += 14
  if (Number.isFinite(relBench20)) {
    if ((status === 'BUY' && relBench20 >= 1.0) || (status === 'SELL' && relBench20 <= -1.0)) score += 9
    else if ((status === 'BUY' && relBench20 >= 0) || (status === 'SELL' && relBench20 <= 0)) score += 5
    else score += 0
  } else {
    score += 4
  }
  if (Number.isFinite(relBench60)) {
    if ((status === 'BUY' && relBench60 >= 1.5) || (status === 'SELL' && relBench60 <= -1.5)) score += 5
    else if ((status === 'BUY' && relBench60 >= 0) || (status === 'SELL' && relBench60 <= 0)) score += 2
  } else {
    score += 2
  }

  maxScore += 16
  if (Number.isFinite(adx14)) {
    if (adx14 >= 24) score += 7
    else if (adx14 >= 18) score += 5
    else if (adx14 >= 14) score += 2
    else score += 0
  } else {
    score += 4
  }
  let volScore = 0
  let volCount = 0
  if (Number.isFinite(stdev20)) {
    volCount += 1
    if (stdev20 >= 0.008 && stdev20 <= 0.09) volScore += 9
    else if (stdev20 <= 0.12) volScore += 5
    else volScore += 1
  }
  if (Number.isFinite(atrPct14)) {
    volCount += 1
    if (atrPct14 >= 0.6 && atrPct14 <= 8.5) volScore += 9
    else if (atrPct14 <= 11) volScore += 5
    else volScore += 1
  }
  if (volCount) score += volScore / volCount
  else score += 5

  maxScore += 6
  let timingScore = 0
  if (Number.isFinite(rsi)) {
    if (status === 'BUY') {
      if (rsi >= 46 && rsi <= 64) timingScore = 6
      else if ((rsi >= 40 && rsi < 46) || (rsi > 64 && rsi <= 72)) timingScore = 4
      else timingScore = 1
    } else {
      if (rsi >= 36 && rsi <= 54) timingScore = 6
      else if ((rsi >= 28 && rsi < 36) || (rsi > 54 && rsi <= 62)) timingScore = 4
      else timingScore = 1
    }
  } else {
    timingScore = 3
  }
  if (Number.isFinite(stretch20) && Math.abs(stretch20) > 9) timingScore = Math.max(0, timingScore - 2)
  score += timingScore

  maxScore += 4
  if (Number.isFinite(volumeRatio)) {
    if (volumeRatio >= 0.95 && volumeRatio <= 2.4) score += 4
    else if (volumeRatio >= 0.70) score += 2
    else score += 1
  } else {
    score += 2
  }

  maxScore += 4
  if (Number.isFinite(ma50) && Number.isFinite(ma200)) {
    if ((status === 'BUY' && ma50 > ma200) || (status === 'SELL' && ma50 < ma200)) score += 2
  } else {
    score += 1
  }
  if (Number.isFinite(macdHist)) {
    if ((status === 'BUY' && macdHist >= 0) || (status === 'SELL' && macdHist <= 0)) score += 2
  } else {
    score += 1
  }

  const qualityScore = Math.round((score / Math.max(1, maxScore)) * 100)
  const minQuality = threshold === 80 ? 72 : 64

  return {
    qualityScore,
    qualifies: qualityScore >= minQuality,
  }
}

export function buildDailySignalSeries(input: AssetAuditInput, computeIndicators: IndicatorComputer) {
  const { times, highs, lows, closes, volumes, market, benchmarkCloses } = input
  const n = Math.min(times.length, closes.length, volumes.length, highs?.length ?? Infinity, lows?.length ?? Infinity)
  if (n < WINDOW + 2) return [] as DailySignalPoint[]

  const points: DailySignalPoint[] = []

  for (let i = WINDOW - 1; i < n; i++) {
    const from = i - (WINDOW - 1)
    const cWin = closes.slice(from, i + 1)
    const vWin = volumes.slice(from, i + 1)
    const hWin = highs?.slice(from, i + 1) ?? []
    const lWin = lows?.slice(from, i + 1) ?? []
    const ind = computeIndicators(cWin, vWin)
    const remaining = (n - 1) - i
    const benchmarkEnd = benchmarkCloses?.length ? benchmarkCloses.length - 1 - remaining : -1
    const benchmarkWin =
      benchmarkCloses?.length && benchmarkEnd >= 0
        ? benchmarkCloses.slice(Math.max(0, benchmarkEnd - (cWin.length - 1)), benchmarkEnd + 1)
        : null
    const rangeStrength = latestRangeStrengthFeatures(hWin, lWin, cWin)
    const relStrength = latestRelativeStrengthFeatures(cWin, benchmarkWin)
    const trend = {
      ...ind.trend,
      adx14: rangeStrength.adx14,
      relBench20: relStrength.relBench20,
      relBench60: relStrength.relBench60,
    }
    const volatility = {
      ...ind.volatility,
      atrPct14: rangeStrength.atrPct14,
    }
    const { score, status } = computeScoreStatus(
      {
        ma: { ma50: ind.ma.ma50, ma200: ind.ma.ma200 },
        rsi: ind.rsi,
        macd: { hist: ind.macd.hist },
        volume: { ratio: ind.volume.ratio },
        trend,
        volatility,
      },
      { market }
    )

    const roundedScore = Math.round(score)
    const strength = status === 'BUY' ? roundedScore : status === 'SELL' ? Math.round(100 - roundedScore) : null
    const q70 =
      status === 'BUY' || status === 'SELL'
        ? computeEntryQualification(status, strength ?? 0, 70, { ...ind, trend, volatility })
        : { qualityScore: null, qualifies: false }
    const q80 =
      status === 'BUY' || status === 'SELL'
        ? computeEntryQualification(status, strength ?? 0, 80, { ...ind, trend, volatility })
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

function simulateVariant(
  strategy: StrategyKey,
  points: DailySignalPoint[],
  exitProfile: ExitProfile
) {
  const trades: VariantTrade[] = []
  let open:
    | {
        side: SignalSide
        entryClose: number
        entryIndex: number
      }
    | null = null

  for (let i = 0; i < points.length; i++) {
    const point = points[i]
    const prev = i > 0 ? points[i - 1] : null
    const eligible = isEligible(point, strategy)
    let exitedThisBar = false

    if (open) {
      const daysHeld = Math.max(0, point.index - open.entryIndex)
      const raw = pct(open.entryClose, point.close)
      const aligned = signalAlign(open.side, raw)
      const hitTakeProfit =
        exitProfile.takeProfitPct != null && aligned != null && aligned >= exitProfile.takeProfitPct
      const hitStopLoss =
        exitProfile.stopLossPct != null && aligned != null && aligned <= -exitProfile.stopLossPct
      const hitMaxHold =
        exitProfile.maxHoldDays != null && daysHeld >= exitProfile.maxHoldDays
      const invalidSignal =
        point.status !== open.side ||
        (strategy !== 'status_flip' && !eligible)

      if (hitTakeProfit || hitStopLoss || hitMaxHold || invalidSignal) {
        if (aligned != null && Number.isFinite(aligned)) {
          trades.push({
            side: open.side,
            returnPct: aligned,
            daysHeld,
          })
        }
        open = null
        exitedThisBar = true
      }
    }

    if (!open && !exitedThisBar && eligible) {
      const prevEligibleSameSide = prev ? prev.status === point.status && isEligible(prev, strategy) : false
      if (!prevEligibleSameSide) {
        open = {
          side: point.status as SignalSide,
          entryClose: point.close,
          entryIndex: point.index,
        }
      }
    }
  }

  return {
    trades,
    openSide: open?.side ?? null,
  }
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
    market: input.market,
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

function summarizeReturns(returns: number[]) {
  const wins = returns.filter((v) => v > 0).length
  const avg = returns.length ? returns.reduce((sum, v) => sum + v, 0) / returns.length : null
  const compounded = returns.length
    ? returns.reduce((equity, ret) => equity * (1 + ret / 100), 100)
    : null
  return {
    count: returns.length,
    wins,
    winrate: returns.length ? wins / returns.length : null,
    avgReturnPct: avg,
    maxDrawdownPct: computeMaxDrawdownPct(returns),
    compoundedValueOf100: compounded,
  }
}

function rankQualifiedStrategy(
  strategy: StrategyKey,
  train: ReturnType<typeof summarizeReturns>,
  test: ReturnType<typeof summarizeReturns>,
  exitProfile: ExitProfile,
  side: SignalSide
) {
  const threshold = STRATEGY_META[strategy].threshold
  const isEntrySafe = STRATEGY_META[strategy].entrySafe
  const minTrainWinrate = threshold >= 80 ? 0.58 : 0.55
  const minTestWinrate = threshold >= 80 ? 0.66 : 0.60
  const minTrainAvg = threshold >= 80 ? 0.2 : 0.05
  const minTestAvg = threshold >= 80 ? 0.4 : 0.15
  const maxDd = threshold >= 80 ? 26 : 34

  const qualifies =
    train.count >= 4 &&
    test.count >= 3 &&
    (train.winrate ?? 0) >= minTrainWinrate &&
    (test.winrate ?? 0) >= minTestWinrate &&
    (train.avgReturnPct ?? -999) >= minTrainAvg &&
    (test.avgReturnPct ?? -999) >= minTestAvg &&
    ((test.maxDrawdownPct ?? 999) <= maxDd)

  const score =
    (test.winrate ?? 0) * 125 +
    (test.avgReturnPct ?? 0) * 8 +
    Math.min(test.count, 8) * 0.75 +
    (train.avgReturnPct ?? 0) * 1.5 +
    (isEntrySafe ? 4 : 0) +
    (threshold >= 80 ? 3 : 0) +
    (side === 'SELL' ? 1 : 0) -
    (exitProfile.maxHoldDays != null && exitProfile.maxHoldDays <= 5 ? 1 : 0) -
    ((test.maxDrawdownPct ?? 0) * 0.25)

  return { qualifies, score }
}

export function findQualifiedLivePicks(assetStates: AssetAuditState[]) {
  const candidates: QualifiedLivePick[] = []
  const candidateStrategies: StrategyKey[] = ['entry_80', 'entry_70', 'strength_80', 'strength_70', 'status_flip']

  for (const state of assetStates) {
    if (!state.points.length) continue
    const latest = state.points[state.points.length - 1]
    let best: (QualifiedLivePick & { _score: number }) | null = null

    for (const strategy of candidateStrategies) {
      for (const exitProfile of EXIT_PROFILES) {
        const variant = simulateVariant(strategy, state.points, exitProfile)
        if (!variant.openSide) continue
        if (strategy === 'status_flip' && (latest.strength ?? 0) < 60) continue

        const sideReturns = variant.trades
          .filter((trade) => trade.side === variant.openSide)
          .map((trade) => trade.returnPct)
        if (sideReturns.length < 7) continue

        const splitIdx = Math.max(4, Math.min(sideReturns.length - 3, Math.floor(sideReturns.length * 0.65)))
        const trainReturns = sideReturns.slice(0, splitIdx)
        const testReturns = sideReturns.slice(splitIdx)
        if (trainReturns.length < 4 || testReturns.length < 3) continue

        const train = summarizeReturns(trainReturns)
        const test = summarizeReturns(testReturns)
        const ranked = rankQualifiedStrategy(strategy, train, test, exitProfile, variant.openSide)
        if (!ranked.qualifies) continue
        if (!Number.isFinite(latest.strength as number)) continue

        const pick: QualifiedLivePick & { _score: number } = {
          symbol: state.symbol,
          name: state.name,
          market: state.market,
          status: variant.openSide,
          strategy,
          strategyLabel: `${STRATEGY_META[strategy].label} · ${exitProfile.label}`,
          currentScore: latest.score,
          strength: Number(latest.strength),
          validationWinrate: Number(test.winrate),
          validationAvgReturnPct: Number(test.avgReturnPct),
          trainingTrades: train.count,
          validationTrades: test.count,
          _score: ranked.score,
        }

        if (!best || pick._score > best._score) best = pick
      }
    }

    if (best) {
      const { _score, ...publicPick } = best
      candidates.push(publicPick)
    }
  }

  return candidates.sort((a, b) => {
    if (b.validationWinrate !== a.validationWinrate) return b.validationWinrate - a.validationWinrate
    if (b.validationAvgReturnPct !== a.validationAvgReturnPct) return b.validationAvgReturnPct - a.validationAvgReturnPct
    if (b.strength !== a.strength) return b.strength - a.strength
    return a.symbol.localeCompare(b.symbol)
  })
}

export function findBlindFollowPicks(picks: QualifiedLivePick[]) {
  return picks
    .filter((pick) =>
      pick.trainingTrades >= 8 &&
      pick.validationTrades >= 5 &&
      pick.validationWinrate >= 0.8 &&
      pick.validationAvgReturnPct >= 1.0 &&
      pick.strength >= 75
    )
    .sort((a, b) => {
      if (b.validationWinrate !== a.validationWinrate) return b.validationWinrate - a.validationWinrate
      if (b.validationAvgReturnPct !== a.validationAvgReturnPct) return b.validationAvgReturnPct - a.validationAvgReturnPct
      if (b.validationTrades !== a.validationTrades) return b.validationTrades - a.validationTrades
      if (b.strength !== a.strength) return b.strength - a.strength
      return a.symbol.localeCompare(b.symbol)
    })
}

export function getStrategyMeta(strategy: StrategyKey) {
  return STRATEGY_META[strategy]
}

export function getStrategyOrder() {
  return [...STRATEGY_ORDER]
}
