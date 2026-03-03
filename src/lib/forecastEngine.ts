import { COINS } from '@/lib/coins'
import { getBenchmarkSpec } from '@/lib/benchmarkSymbols'
import { resolveScoreMarket } from '@/lib/marketResolver'
import { fetchMarketDataForEquity } from '@/lib/pastPerformance/equityIndicatorsExact'
import { fetchMarketDataFor } from '@/lib/pastPerformance/cryptoIndicatorsExact'
import {
  latestRangeStrengthFeatures,
  latestRelativeStrengthFeatures,
  latestTrendFeatures,
  latestVolatilityFeatures,
} from '@/lib/taExtras'
import type { ScoreMarket } from '@/lib/taScore'

export type ForecastAssetType = 'equity' | 'crypto'
export type ForecastHorizon = 7 | 14 | 30
export type ForecastAction = 'LONG' | 'HOLD' | 'EXIT'
export type ForecastRegime = 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL'

export type ForecastCosts = {
  feeBpsEquity: number
  feeBpsCrypto: number
  slippageBps: number
}

export type ForecastInput = {
  symbol: string
  assetType: ForecastAssetType
  horizon: ForecastHorizon
  marketHint?: string | null
  feeBpsEquity?: number
  feeBpsCrypto?: number
  slippageBps?: number
}

export type ForecastOutput = {
  symbol: string
  assetType: ForecastAssetType
  horizon: ForecastHorizon
  probUp: number
  confidence: number
  expectedReturn: number | null
  predictionInterval: { p10: number | null; p50: number | null; p90: number | null }
  positionSize: number
  action: ForecastAction
  regime: ForecastRegime
  topReasons: string[]
  labels: {
    featureWindow: string
    labelDefinition: string
    alignment: string
    thresholds: string
  }
  costs: {
    feeBpsRoundTrip: number
    slippageBpsRoundTrip: number
    totalRoundTripBps: number
  }
  model: {
    ensemble: string
    calibrator: string
    samples: { train: number; calibration: number; walkForwardTest: number }
    agreement: number
  }
  evaluation: {
    classification: {
      auc: number | null
      brier: number | null
      logLoss: number | null
      calibrationError: number | null
    }
    strategy: StrategySummary
    baselines: {
      buyAndHold: StrategySummary
      trendFollow200d: StrategySummary
      simpleMomentum: StrategySummary
    }
    regimes: {
      riskOn: RegimeSummary
      riskOff: RegimeSummary
      neutral: RegimeSummary
    }
  }
  reasonsMeta: {
    market: ScoreMarket
    benchmark: string | null
  }
}

type MarketData = {
  times: number[]
  closes: number[]
  volumes: number[]
  highs: number[]
  lows: number[]
}

type Observation = {
  index: number
  date: string
  close: number
  nextDayReturn: number | null
  futureLogReturn: number
  futureReturnPct: number
  probTarget: 0 | 1
  features: number[]
  featureMap: FeatureMap
  regime: ForecastRegime
}

type FeatureMap = {
  priceVs200dPct: number
  ma50200SpreadPct: number
  ma50SlopePct: number
  breakout20: number
  breakout55: number
  breakoutStrength: number
  ret7: number
  ret20: number
  ret60: number
  rsi14: number
  macdHistNorm: number
  roc14: number
  atrPct14: number
  realizedVol20: number
  drawdown63Pct: number
  volumeZ20: number
  volumeTrend: number
  benchmarkTrend20: number
  benchmarkRisk: number
  relBench20: number
  relBench60: number
}

type Standardizer = {
  means: number[]
  scales: number[]
}

type LogisticModel = {
  bias: number
  weights: number[]
  standardizer: Standardizer
}

type Stump = {
  feature: number
  threshold: number
  leftValue: number
  rightValue: number
}

type TreeEnsembleModel = {
  baseLogit: number
  learningRate: number
  stumps: Stump[]
  standardizer: Standardizer
}

type PlattScaler = {
  a: number
  b: number
}

type FoldPrediction = {
  date: string
  close: number
  nextDayReturn: number | null
  futureReturnPct: number
  target: 0 | 1
  probLogistic: number
  probTree: number
  probUp: number
  regime: ForecastRegime
  ma200Long: boolean
  momentumLong: boolean
  featureMap: FeatureMap
}

type StrategyDailyPoint = {
  date: string
  dailyReturnPct: number
  equity: number
  regime: ForecastRegime
}

type TradeResult = {
  entryDate: string
  exitDate: string
  returnPct: number
  daysHeld: number
}

export type StrategySummary = {
  cagr: number | null
  sharpe: number | null
  maxDrawdownPct: number | null
  hitRate: number | null
  avgTradeReturnPct: number | null
  turnover: number | null
  totalTrades: number
  totalDays: number
  compoundedValueOf100: number | null
}

export type RegimeSummary = {
  samples: number
  avgProbUp: number | null
  brier: number | null
  hitRateAboveEntry: number | null
}

export type ForecastScenarioName = 'baseline' | 'btc_relative' | 'breakout_squeeze' | 'confluence'

export type ForecastScenarioOutput = {
  key: ForecastScenarioName
  label: string
  modelType: string
  probUp: number
  confidence: number
  expectedReturn: number | null
  edgeAfterCosts: number | null
  action: ForecastAction
  positionSize: number
  summary: string
  topReasons: string[]
  evaluation: {
    auc: number | null
    brier: number | null
    hitRate: number | null
    avgTradeReturnPct: number | null
    turnover: number | null
    compoundedValueOf100: number | null
  }
}

export type ForecastCompareOutput = {
  symbol: string
  assetType: ForecastAssetType
  horizon: ForecastHorizon
  regime: ForecastRegime
  benchmark: string | null
  featureSnapshot: {
    relBench20: number
    relBench60: number
    breakoutStrength: number
    atrPct14: number
    realizedVol20: number
    priceVs200dPct: number
    benchmarkTrend20: number
  }
  scenarios: ForecastScenarioOutput[]
}

type WalkForwardResult = {
  predictions: FoldPrediction[]
  classification: ForecastOutput['evaluation']['classification']
  strategy: StrategySummary
  baselines: ForecastOutput['evaluation']['baselines']
  regimes: ForecastOutput['evaluation']['regimes']
}

const ENTRY_THRESHOLD = 0.60
const EXIT_THRESHOLD = 0.50
const MIN_HOLD_DAYS = 3
const FEATURE_START = 220
const FEATURE_NAMES: Array<keyof FeatureMap> = [
  'priceVs200dPct',
  'ma50200SpreadPct',
  'ma50SlopePct',
  'breakout20',
  'breakout55',
  'breakoutStrength',
  'ret7',
  'ret20',
  'ret60',
  'rsi14',
  'macdHistNorm',
  'roc14',
  'atrPct14',
  'realizedVol20',
  'drawdown63Pct',
  'volumeZ20',
  'volumeTrend',
  'benchmarkTrend20',
  'benchmarkRisk',
  'relBench20',
  'relBench60',
]

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))
const EPS = 1e-9

function mean(nums: number[]) {
  if (!nums.length) return 0
  return nums.reduce((sum, n) => sum + n, 0) / nums.length
}

function stddev(nums: number[]) {
  if (nums.length < 2) return 0
  const m = mean(nums)
  const variance = nums.reduce((sum, n) => sum + ((n - m) ** 2), 0) / nums.length
  return Math.sqrt(Math.max(0, variance))
}

function sigmoid(z: number) {
  if (z >= 0) {
    const ez = Math.exp(-z)
    return 1 / (1 + ez)
  }
  const ez = Math.exp(z)
  return ez / (1 + ez)
}

function logit(p: number) {
  const q = clamp(p, 1e-6, 1 - 1e-6)
  return Math.log(q / (1 - q))
}

function quantile(sorted: number[], q: number) {
  if (!sorted.length) return null
  const pos = clamp(q, 0, 1) * (sorted.length - 1)
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo] ?? null
  const w = pos - lo
  return (sorted[lo] ?? 0) * (1 - w) + (sorted[hi] ?? 0) * w
}

function safeNum(value: number | null | undefined, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function toIsoDate(ms: number) {
  return new Date(ms).toISOString().slice(0, 10)
}

function pct(from: number, to: number) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0) return null
  return ((to / from) - 1) * 100
}

function logReturn(from: number, to: number) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to <= 0) return null
  return Math.log(to / from)
}

function rollingSma(arr: number[], endIdx: number, lookback: number) {
  if (endIdx - lookback + 1 < 0) return null
  let sum = 0
  for (let i = endIdx - lookback + 1; i <= endIdx; i++) sum += arr[i]
  return sum / lookback
}

function rollingMeanStd(arr: number[], endIdx: number, lookback: number) {
  if (endIdx - lookback + 1 < 0) return { mean: null as number | null, std: null as number | null }
  const slice = arr.slice(endIdx - lookback + 1, endIdx + 1).filter((v) => Number.isFinite(v))
  if (!slice.length) return { mean: null, std: null }
  return { mean: mean(slice), std: stddev(slice) }
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
    const next = arr[i] * k + prev * (1 - k)
    out[i] = next
    prev = next
  }
  return out
}

function rsiLast(arr: number[], period = 14) {
  if (arr.length < period + 1) return null
  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i++) {
    const ch = arr[i] - arr[i - 1]
    if (ch >= 0) gain += ch
    else loss += -ch
  }
  let avgGain = gain / period
  let avgLoss = loss / period
  for (let i = period + 1; i < arr.length; i++) {
    const ch = arr[i] - arr[i - 1]
    avgGain = ((avgGain * (period - 1)) + (ch > 0 ? ch : 0)) / period
    avgLoss = ((avgLoss * (period - 1)) + (ch < 0 ? -ch : 0)) / period
  }
  const rs = avgLoss <= EPS ? Infinity : avgGain / avgLoss
  return clamp(100 - (100 / (1 + rs)), 0, 100)
}

function macdHistLast(arr: number[]) {
  const ema12 = emaSeries(arr, 12)
  const ema26 = emaSeries(arr, 26)
  const macd: Array<number | null> = arr.map((_, i) => {
    const a = ema12[i]
    const b = ema26[i]
    return a != null && b != null ? a - b : null
  })
  const compact: number[] = []
  const idxMap: number[] = []
  for (let i = 0; i < macd.length; i++) {
    if (macd[i] != null) {
      compact.push(macd[i] as number)
      idxMap.push(i)
    }
  }
  if (compact.length < 9) return null
  const signalCompact = emaSeries(compact, 9)
  const signal: Array<number | null> = new Array(arr.length).fill(null)
  for (let i = 0; i < signalCompact.length; i++) signal[idxMap[i]] = signalCompact[i]
  for (let i = arr.length - 1; i >= 0; i--) {
    if (macd[i] != null && signal[i] != null) return (macd[i] as number) - (signal[i] as number)
  }
  return null
}

function featureVector(map: FeatureMap) {
  return FEATURE_NAMES.map((name) => map[name])
}

function getCosts(input: ForecastInput): ForecastCosts {
  return {
    feeBpsEquity: Number.isFinite(input.feeBpsEquity as number) ? Number(input.feeBpsEquity) : 10,
    feeBpsCrypto: Number.isFinite(input.feeBpsCrypto as number) ? Number(input.feeBpsCrypto) : 20,
    slippageBps: Number.isFinite(input.slippageBps as number) ? Number(input.slippageBps) : 10,
  }
}

function normalizeHorizon(value: number | string | null | undefined): ForecastHorizon {
  const n = Number(value)
  if (n === 7 || n === 14 || n === 30) return n
  return 14
}

function resolveCryptoQuoteSymbol(symbol: string) {
  const raw = String(symbol || '').trim().toUpperCase()
  if (!raw) return ''
  const direct = COINS.find((coin) => coin.symbol.toUpperCase() === raw)
  if (direct?.pairUSD?.binance) return direct.pairUSD.binance
  if (raw.endsWith('USDT')) return raw
  return `${raw}USDT`
}

async function fetchAssetHistory(input: ForecastInput): Promise<{ market: ScoreMarket; benchmark: string | null; data: MarketData }> {
  const symbol = String(input.symbol || '').trim().toUpperCase()
  if (!symbol) throw new Error('Missing symbol')

  if (input.assetType === 'crypto') {
    const quoteSymbol = resolveCryptoQuoteSymbol(symbol)
    const got = await fetchMarketDataFor(quoteSymbol, { limit: 900 })
    if ('error' in got) {
      throw new Error(got.error)
    }
    return {
      market: 'CRYPTO',
      benchmark: 'BTCUSDT',
      data: {
        times: got.data.times,
        closes: got.data.closes,
        volumes: got.data.volumes,
        highs: got.data.highs ?? got.data.closes,
        lows: got.data.lows ?? got.data.closes,
      },
    }
  }

  const market = resolveScoreMarket(input.marketHint, symbol, 'DEFAULT')
  const got = await fetchMarketDataForEquity(symbol, { range: '2y', interval: '1d' })
  if ('error' in got) {
    throw new Error(got.error)
  }
  const benchmark = getBenchmarkSpec(market)
  return {
    market,
    benchmark: benchmark?.symbol ?? null,
    data: {
      times: got.data.times,
      closes: got.data.closes,
      volumes: got.data.volumes,
      highs: got.data.highs,
      lows: got.data.lows,
    },
  }
}

async function fetchBenchmarkHistory(market: ScoreMarket): Promise<number[] | null> {
  const benchmark = getBenchmarkSpec(market)
  if (!benchmark) return null
  try {
    if (benchmark.kind === 'crypto') {
      const got = await fetchMarketDataFor(benchmark.symbol, { limit: 900 })
      return got.ok ? got.data.closes : null
    }
    const got = await fetchMarketDataForEquity(benchmark.symbol, { range: '2y', interval: '1d' })
    return got.ok ? got.data.closes : null
  } catch {
    return null
  }
}

function alignedBenchmarkWindow(benchmarkCloses: number[] | null, assetLength: number, index: number, desiredLength: number) {
  if (!benchmarkCloses?.length) return null
  const remaining = (assetLength - 1) - index
  const benchEnd = benchmarkCloses.length - 1 - remaining
  if (benchEnd < 0) return null
  const benchStart = Math.max(0, benchEnd - (desiredLength - 1))
  return benchmarkCloses.slice(benchStart, benchEnd + 1)
}

function computeDrawdownPct(closes: number[], index: number, lookback = 63) {
  if (index - lookback + 1 < 0) return null
  let peak = -Infinity
  for (let i = index - lookback + 1; i <= index; i++) {
    if (closes[i] > peak) peak = closes[i]
  }
  if (!Number.isFinite(peak) || peak <= 0) return null
  return ((closes[index] / peak) - 1) * 100
}

function computeFeatureRow(data: MarketData, benchmarkCloses: number[] | null, market: ScoreMarket, index: number) {
  const closeWindow = data.closes.slice(0, index + 1)
  const volWindow = data.volumes.slice(0, index + 1)
  const highWindow = data.highs.slice(0, index + 1)
  const lowWindow = data.lows.slice(0, index + 1)
  const benchmarkWindow = alignedBenchmarkWindow(benchmarkCloses, data.closes.length, index, closeWindow.length)

  const trend = latestTrendFeatures(closeWindow, 20)
  const vol = latestVolatilityFeatures(closeWindow, 20)
  const range = latestRangeStrengthFeatures(highWindow, lowWindow, closeWindow)
  const rel = latestRelativeStrengthFeatures(closeWindow, benchmarkWindow)
  const benchTrend = benchmarkWindow?.length ? latestTrendFeatures(benchmarkWindow, 20) : null
  const benchVol = benchmarkWindow?.length ? latestVolatilityFeatures(benchmarkWindow, 20) : null

  const ma50 = rollingSma(closeWindow, closeWindow.length - 1, 50)
  const ma200 = rollingSma(closeWindow, closeWindow.length - 1, 200)
  const ma50Past = closeWindow.length > 10 ? rollingSma(closeWindow, closeWindow.length - 11, 50) : null
  const price = closeWindow[closeWindow.length - 1]
  const volStats = rollingMeanStd(volWindow, volWindow.length - 1, 20)
  const volFast = rollingSma(volWindow, volWindow.length - 1, 5)
  const volSlow = rollingSma(volWindow, volWindow.length - 1, 20)
  const roc14 = closeWindow.length > 14 ? pct(closeWindow[closeWindow.length - 15], price) : null
  const rsi = rsiLast(closeWindow, 14)
  const macdHist = macdHistLast(closeWindow)
  const macdNorm = ma50 && ma50 > 0 && macdHist != null ? clamp((macdHist / ma50) * 400, -1, 1) : safeNum(macdHist)
  const regime = (() => {
    const benchRet = safeNum(benchTrend?.ret20)
    const benchRisk = Math.max(safeNum(benchVol?.stdev20) * 100, safeNum(range.atrPct14))
    if (benchRet > 1.5 && benchRisk < 4.8) return 'RISK_ON' as const
    if (benchRet < -1.5 || benchRisk > 7.5) return 'RISK_OFF' as const
    return 'NEUTRAL' as const
  })()

  const featureMap: FeatureMap = {
    priceVs200dPct: ma200 && ma200 > 0 ? ((price / ma200) - 1) * 100 : 0,
    ma50200SpreadPct: ma50 && ma200 && ma200 > 0 ? ((ma50 / ma200) - 1) * 100 : 0,
    ma50SlopePct: ma50 && ma50Past && ma50Past > 0 ? ((ma50 / ma50Past) - 1) * 100 : 0,
    breakout20: safeNum(trend.breakout20),
    breakout55: safeNum(trend.breakout55),
    breakoutStrength: (0.65 * safeNum(trend.breakout20)) + (0.35 * safeNum(trend.breakout55)),
    ret7: safeNum(closeWindow.length > 7 ? pct(closeWindow[closeWindow.length - 8], price) : null),
    ret20: safeNum(trend.ret20),
    ret60: safeNum(trend.ret60),
    rsi14: safeNum(rsi, 50),
    macdHistNorm: macdNorm,
    roc14: safeNum(roc14),
    atrPct14: safeNum(range.atrPct14),
    realizedVol20: safeNum(vol.stdev20) * 100,
    drawdown63Pct: safeNum(computeDrawdownPct(closeWindow, closeWindow.length - 1, 63)),
    volumeZ20: volStats.mean != null && volStats.std != null && volStats.std > EPS ? (price ? ((volWindow[volWindow.length - 1] - volStats.mean) / volStats.std) : 0) : 0,
    volumeTrend: volFast && volSlow && volSlow > 0 ? ((volFast / volSlow) - 1) * 100 : 0,
    benchmarkTrend20: safeNum(benchTrend?.ret20),
    benchmarkRisk: Math.max(safeNum(benchVol?.stdev20) * 100, safeNum(range.atrPct14)),
    relBench20: safeNum(rel.relBench20),
    relBench60: safeNum(rel.relBench60),
  }

  const reasons = {
    market,
    regime,
    featureMap,
    ma50,
    ma200,
  }

  return { featureMap, features: featureVector(featureMap), regime, reasons }
}

function buildDataset(data: MarketData, benchmarkCloses: number[] | null, market: ScoreMarket, horizon: ForecastHorizon) {
  const rows: Observation[] = []
  const latest = computeFeatureRow(data, benchmarkCloses, market, data.closes.length - 1)

  for (let i = FEATURE_START; i + horizon < data.closes.length; i++) {
    const featureRow = computeFeatureRow(data, benchmarkCloses, market, i)
    const fLog = logReturn(data.closes[i], data.closes[i + horizon])
    const fPct = pct(data.closes[i], data.closes[i + horizon])
    if (fLog == null || fPct == null) continue
    rows.push({
      index: i,
      date: toIsoDate(data.times[i]),
      close: data.closes[i],
      nextDayReturn: i + 1 < data.closes.length ? pct(data.closes[i], data.closes[i + 1]) : null,
      futureLogReturn: fLog,
      futureReturnPct: fPct,
      probTarget: fLog > 0 ? 1 : 0,
      features: featureRow.features,
      featureMap: featureRow.featureMap,
      regime: featureRow.regime,
    })
  }

  return { rows, latest }
}

function fitStandardizer(X: number[][]): Standardizer {
  if (!X.length) return { means: [], scales: [] }
  const dims = X[0].length
  const means = new Array(dims).fill(0)
  const scales = new Array(dims).fill(1)
  for (let d = 0; d < dims; d++) {
    const col = X.map((row) => row[d])
    means[d] = mean(col)
    scales[d] = Math.max(stddev(col), 1e-6)
  }
  return { means, scales }
}

function applyStandardizer(X: number[][], standardizer: Standardizer) {
  return X.map((row) => row.map((v, idx) => (v - (standardizer.means[idx] ?? 0)) / Math.max(standardizer.scales[idx] ?? 1, 1e-6)))
}

function fitLogisticModel(XRaw: number[][], y: number[]): LogisticModel {
  if (!XRaw.length) return { bias: 0, weights: [], standardizer: { means: [], scales: [] } }
  const standardizer = fitStandardizer(XRaw)
  const X = applyStandardizer(XRaw, standardizer)
  const dims = X[0].length
  const weights = new Array(dims).fill(0)
  let bias = logit(clamp(mean(y), 0.05, 0.95))
  const lr = 0.06
  const lambda = 0.015
  const iterations = 220

  for (let step = 0; step < iterations; step++) {
    const grad = new Array(dims).fill(0)
    let gradBias = 0
    for (let i = 0; i < X.length; i++) {
      let z = bias
      const row = X[i]
      for (let d = 0; d < dims; d++) z += row[d] * weights[d]
      const p = sigmoid(z)
      const err = p - y[i]
      gradBias += err
      for (let d = 0; d < dims; d++) grad[d] += err * row[d]
    }
    bias -= (lr * gradBias) / X.length
    for (let d = 0; d < dims; d++) {
      const reg = lambda * weights[d]
      weights[d] -= lr * ((grad[d] / X.length) + reg)
    }
  }

  return { bias, weights, standardizer }
}

function predictLogisticLogits(model: LogisticModel, XRaw: number[][]) {
  if (!XRaw.length) return []
  const X = applyStandardizer(XRaw, model.standardizer)
  return X.map((row) => {
    let z = model.bias
    for (let d = 0; d < row.length; d++) z += row[d] * (model.weights[d] ?? 0)
    return z
  })
}

function featureThresholdCandidates(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const qs = [0.15, 0.3, 0.5, 0.7, 0.85]
  const out: number[] = []
  for (const q of qs) {
    const v = quantile(sorted, q)
    if (typeof v === 'number' && Number.isFinite(v)) out.push(v)
  }
  return [...new Set(out)]
}

function fitTreeEnsembleModel(XRaw: number[][], y: number[]): TreeEnsembleModel {
  if (!XRaw.length) return { baseLogit: 0, learningRate: 0.35, stumps: [], standardizer: { means: [], scales: [] } }
  const standardizer = fitStandardizer(XRaw)
  const X = applyStandardizer(XRaw, standardizer)
  const baseRate = clamp(mean(y), 0.05, 0.95)
  const baseLogit = logit(baseRate)
  const F = new Array(X.length).fill(baseLogit)
  const stumps: Stump[] = []
  const rounds = 8
  const learningRate = 0.35
  const dims = X[0].length

  for (let round = 0; round < rounds; round++) {
    const residuals = F.map((score, idx) => y[idx] - sigmoid(score))
    let best: { stump: Stump; loss: number } | null = null

    for (let d = 0; d < dims; d++) {
      const col = X.map((row) => row[d])
      const thresholds = featureThresholdCandidates(col)
      for (const threshold of thresholds) {
        let leftSum = 0
        let leftN = 0
        let rightSum = 0
        let rightN = 0
        for (let i = 0; i < X.length; i++) {
          if (X[i][d] <= threshold) {
            leftSum += residuals[i]
            leftN += 1
          } else {
            rightSum += residuals[i]
            rightN += 1
          }
        }
        if (!leftN || !rightN) continue
        const leftValue = leftSum / leftN
        const rightValue = rightSum / rightN
        let loss = 0
        for (let i = 0; i < X.length; i++) {
          const pred = X[i][d] <= threshold ? leftValue : rightValue
          const err = residuals[i] - pred
          loss += err * err
        }
        if (!best || loss < best.loss) {
          best = {
            loss,
            stump: { feature: d, threshold, leftValue, rightValue },
          }
        }
      }
    }

    if (!best) break
    stumps.push(best.stump)
    for (let i = 0; i < X.length; i++) {
      const pred = X[i][best.stump.feature] <= best.stump.threshold ? best.stump.leftValue : best.stump.rightValue
      F[i] += learningRate * pred
    }
  }

  return { baseLogit, learningRate, stumps, standardizer }
}

function predictTreeLogits(model: TreeEnsembleModel, XRaw: number[][]) {
  if (!XRaw.length) return []
  const X = applyStandardizer(XRaw, model.standardizer)
  return X.map((row) => {
    let score = model.baseLogit
    for (const stump of model.stumps) {
      score += model.learningRate * (row[stump.feature] <= stump.threshold ? stump.leftValue : stump.rightValue)
    }
    return score
  })
}

function fitPlatt(scores: number[], y: number[]): PlattScaler {
  if (!scores.length) return { a: 1, b: 0 }
  let a = 1
  let b = 0
  const lr = 0.05
  const lambda = 0.001
  for (let iter = 0; iter < 220; iter++) {
    let gradA = 0
    let gradB = 0
    for (let i = 0; i < scores.length; i++) {
      const p = sigmoid((a * scores[i]) + b)
      const err = p - y[i]
      gradA += err * scores[i]
      gradB += err
    }
    gradA = (gradA / scores.length) + (lambda * a)
    gradB = gradB / scores.length
    a -= lr * gradA
    b -= lr * gradB
  }
  return { a, b }
}

function applyPlatt(scores: number[], scaler: PlattScaler) {
  return scores.map((score) => sigmoid((scaler.a * score) + scaler.b))
}

function aucScore(yTrue: number[], probs: number[]) {
  const pairs = yTrue.map((y, i) => ({ y, p: probs[i] })).sort((a, b) => a.p - b.p)
  let pos = 0
  let neg = 0
  for (const item of pairs) {
    if (item.y === 1) pos += 1
    else neg += 1
  }
  if (!pos || !neg) return null
  let rankSum = 0
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i].y === 1) rankSum += i + 1
  }
  return (rankSum - (pos * (pos + 1)) / 2) / (pos * neg)
}

function brierScore(yTrue: number[], probs: number[]) {
  if (!yTrue.length) return null
  let sum = 0
  for (let i = 0; i < yTrue.length; i++) sum += (probs[i] - yTrue[i]) ** 2
  return sum / yTrue.length
}

function logLossScore(yTrue: number[], probs: number[]) {
  if (!yTrue.length) return null
  let sum = 0
  for (let i = 0; i < yTrue.length; i++) {
    const p = clamp(probs[i], 1e-6, 1 - 1e-6)
    sum += -(yTrue[i] * Math.log(p) + (1 - yTrue[i]) * Math.log(1 - p))
  }
  return sum / yTrue.length
}

function calibrationError(yTrue: number[], probs: number[], bins = 10) {
  if (!yTrue.length) return null
  let ece = 0
  for (let b = 0; b < bins; b++) {
    const lo = b / bins
    const hi = (b + 1) / bins
    const idxs = probs.map((p, i) => ({ p, i })).filter((item) => item.p >= lo && (b === bins - 1 ? item.p <= hi : item.p < hi)).map((item) => item.i)
    if (!idxs.length) continue
    const conf = mean(idxs.map((i) => probs[i]))
    const acc = mean(idxs.map((i) => yTrue[i]))
    ece += (idxs.length / yTrue.length) * Math.abs(conf - acc)
  }
  return ece
}

function tradeCostPct(assetType: ForecastAssetType, costs: ForecastCosts) {
  const fee = assetType === 'crypto' ? costs.feeBpsCrypto : costs.feeBpsEquity
  return (fee + costs.slippageBps) / 10000
}

function summarizeStrategy(daily: StrategyDailyPoint[], trades: TradeResult[]): StrategySummary {
  if (!daily.length) {
    return {
      cagr: null,
      sharpe: null,
      maxDrawdownPct: null,
      hitRate: null,
      avgTradeReturnPct: null,
      turnover: null,
      totalTrades: 0,
      totalDays: 0,
      compoundedValueOf100: null,
    }
  }

  const dailyReturns = daily.map((row) => row.dailyReturnPct / 100)
  const avgDaily = mean(dailyReturns)
  const volDaily = stddev(dailyReturns)
  let peak = 100
  let maxDd = 0
  for (const row of daily) {
    if (row.equity > peak) peak = row.equity
    const dd = peak > 0 ? ((peak - row.equity) / peak) * 100 : 0
    if (dd > maxDd) maxDd = dd
  }
  const years = daily.length / 252
  const endEquity = daily[daily.length - 1]?.equity ?? 100
  const cagr = years > 0 && endEquity > 0 ? ((endEquity / 100) ** (1 / years) - 1) * 100 : null
  const sharpe = volDaily > EPS ? (avgDaily / volDaily) * Math.sqrt(252) : null
  const hitRate = trades.length ? mean(trades.map((t) => (t.returnPct > 0 ? 1 : 0))) : null
  const avgTradeReturnPct = trades.length ? mean(trades.map((t) => t.returnPct)) : null
  const turnover = daily.length ? trades.length / daily.length : null

  return {
    cagr,
    sharpe,
    maxDrawdownPct: maxDd,
    hitRate,
    avgTradeReturnPct,
    turnover,
    totalTrades: trades.length,
    totalDays: daily.length,
    compoundedValueOf100: endEquity,
  }
}

function simulateLongCashStrategy(
  rows: FoldPrediction[],
  assetType: ForecastAssetType,
  costs: ForecastCosts,
  longRule: (row: FoldPrediction) => boolean,
  exitRule?: (row: FoldPrediction) => boolean
) {
  const costPct = tradeCostPct(assetType, costs)
  let equity = 100
  let inPosition = false
  let holdDays = 0
  let entryEquity = 100
  let entryDate = ''
  const daily: StrategyDailyPoint[] = []
  const trades: TradeResult[] = []

  for (const row of rows) {
    const shouldEnter = longRule(row)
    const shouldExit = exitRule ? exitRule(row) : !longRule(row)

    if (!inPosition && shouldEnter) {
      equity *= 1 - (costPct / 2)
      inPosition = true
      holdDays = 0
      entryEquity = equity
      entryDate = row.date
    }

    const rawDaily = inPosition && row.nextDayReturn != null ? row.nextDayReturn / 100 : 0
    equity *= 1 + rawDaily
    if (inPosition) holdDays += 1

    let dailyReturnPct = rawDaily * 100

    if (inPosition && shouldExit && holdDays >= MIN_HOLD_DAYS) {
      equity *= 1 - (costPct / 2)
      dailyReturnPct -= (costPct / 2) * 100
      const tradeReturnPct = entryEquity > 0 ? ((equity / entryEquity) - 1) * 100 : 0
      trades.push({
        entryDate,
        exitDate: row.date,
        returnPct: tradeReturnPct,
        daysHeld: holdDays,
      })
      inPosition = false
      holdDays = 0
      entryDate = ''
    }

    daily.push({ date: row.date, dailyReturnPct, equity, regime: row.regime })
  }

  if (inPosition && rows.length) {
    equity *= 1 - (costPct / 2)
    const tradeReturnPct = entryEquity > 0 ? ((equity / entryEquity) - 1) * 100 : 0
    trades.push({
      entryDate,
      exitDate: rows[rows.length - 1].date,
      returnPct: tradeReturnPct,
      daysHeld: holdDays,
    })
    daily[daily.length - 1].dailyReturnPct -= (costPct / 2) * 100
    daily[daily.length - 1].equity = equity
  }

  return summarizeStrategy(daily, trades)
}

function regimeBreakdown(rows: FoldPrediction[]) {
  const groups: Record<ForecastRegime, FoldPrediction[]> = {
    RISK_ON: [],
    RISK_OFF: [],
    NEUTRAL: [],
  }
  for (const row of rows) groups[row.regime].push(row)

  const summarize = (items: FoldPrediction[]): RegimeSummary => {
    if (!items.length) return { samples: 0, avgProbUp: null, brier: null, hitRateAboveEntry: null }
    const y = items.map((row) => row.target)
    const p = items.map((row) => row.probUp)
    const entryRows = items.filter((row) => row.probUp >= ENTRY_THRESHOLD)
    return {
      samples: items.length,
      avgProbUp: mean(p),
      brier: brierScore(y, p),
      hitRateAboveEntry: entryRows.length ? mean(entryRows.map((row) => row.target)) : null,
    }
  }

  return {
    riskOn: summarize(groups.RISK_ON),
    riskOff: summarize(groups.RISK_OFF),
    neutral: summarize(groups.NEUTRAL),
  }
}

function walkForwardEvaluate(rows: Observation[], assetType: ForecastAssetType, horizon: ForecastHorizon, costs: ForecastCosts): WalkForwardResult {
  const predictions: FoldPrediction[] = []
  const minTrain = Math.max(140, horizon * 8)
  const valSize = Math.max(45, horizon * 3)
  const testSize = Math.max(30, horizon * 2)
  const embargo = horizon

  let trainEnd = minTrain - 1
  while (true) {
    const valStart = trainEnd + embargo + 1
    const valEnd = valStart + valSize - 1
    const testStart = valEnd + embargo + 1
    if (testStart >= rows.length) break
    const testEnd = Math.min(rows.length - 1, testStart + testSize - 1)

    const trainRows = rows.slice(0, trainEnd + 1)
    const valRows = rows.slice(valStart, Math.min(valEnd + 1, rows.length))
    const testRows = rows.slice(testStart, testEnd + 1)
    if (trainRows.length < 30 || valRows.length < 10 || testRows.length < 5) break

    const xTrain = trainRows.map((row) => row.features)
    const yTrain = trainRows.map((row) => row.probTarget)
    const xVal = valRows.map((row) => row.features)
    const yVal = valRows.map((row) => row.probTarget)
    const xTest = testRows.map((row) => row.features)

    const logistic = fitLogisticModel(xTrain, yTrain)
    const tree = fitTreeEnsembleModel(xTrain, yTrain)

    const logValScores = predictLogisticLogits(logistic, xVal)
    const treeValScores = predictTreeLogits(tree, xVal)
    const logScaler = fitPlatt(logValScores, yVal)
    const treeScaler = fitPlatt(treeValScores, yVal)

    const logTest = applyPlatt(predictLogisticLogits(logistic, xTest), logScaler)
    const treeTest = applyPlatt(predictTreeLogits(tree, xTest), treeScaler)

    for (let i = 0; i < testRows.length; i++) {
      predictions.push({
        date: testRows[i].date,
        close: testRows[i].close,
        nextDayReturn: testRows[i].nextDayReturn,
        futureReturnPct: testRows[i].futureReturnPct,
        target: testRows[i].probTarget,
        probLogistic: logTest[i],
        probTree: treeTest[i],
        probUp: (logTest[i] + treeTest[i]) / 2,
        regime: testRows[i].regime,
        ma200Long: testRows[i].featureMap.priceVs200dPct > 0,
        momentumLong: testRows[i].featureMap.ret20 > 0 && testRows[i].featureMap.rsi14 >= 52,
        featureMap: testRows[i].featureMap,
      })
    }

    trainEnd = testEnd
  }

  const yTrue = predictions.map((row) => row.target)
  const probs = predictions.map((row) => row.probUp)
  const classification = {
    auc: aucScore(yTrue, probs),
    brier: brierScore(yTrue, probs),
    logLoss: logLossScore(yTrue, probs),
    calibrationError: calibrationError(yTrue, probs),
  }

  const strategy = simulateLongCashStrategy(
    predictions,
    assetType,
    costs,
    (row) => row.probUp >= ENTRY_THRESHOLD && row.regime !== 'RISK_OFF',
    (row) => row.probUp <= EXIT_THRESHOLD || row.regime === 'RISK_OFF'
  )

  const buyAndHold = simulateLongCashStrategy(predictions, assetType, costs, () => true, () => false)
  const trendFollow200d = simulateLongCashStrategy(predictions, assetType, costs, (row) => row.ma200Long, (row) => !row.ma200Long)
  const simpleMomentum = simulateLongCashStrategy(predictions, assetType, costs, (row) => row.momentumLong, (row) => !row.momentumLong)

  return {
    predictions,
    classification,
    strategy,
    baselines: {
      buyAndHold,
      trendFollow200d,
      simpleMomentum,
    },
    regimes: regimeBreakdown(predictions),
  }
}

function fitFinalForecast(rows: Observation[]) {
  const calSize = Math.max(40, Math.floor(rows.length * 0.18))
  const embargo = 7
  const calStart = Math.max(20, rows.length - calSize)
  const trainEnd = Math.max(19, calStart - embargo - 1)
  const trainRows = rows.slice(0, trainEnd + 1)
  const calRows = rows.slice(calStart)
  if (trainRows.length < 20 || calRows.length < 10) {
    throw new Error('Not enough data to fit forecast model')
  }

  const xTrain = trainRows.map((row) => row.features)
  const yTrain = trainRows.map((row) => row.probTarget)
  const xCal = calRows.map((row) => row.features)
  const yCal = calRows.map((row) => row.probTarget)

  const logistic = fitLogisticModel(xTrain, yTrain)
  const tree = fitTreeEnsembleModel(xTrain, yTrain)
  const logScaler = fitPlatt(predictLogisticLogits(logistic, xCal), yCal)
  const treeScaler = fitPlatt(predictTreeLogits(tree, xCal), yCal)

  return {
    trainRows,
    calRows,
    logistic,
    tree,
    logScaler,
    treeScaler,
  }
}

function inferExpectedReturn(rows: Observation[], model: ReturnType<typeof fitFinalForecast>, latestFeatures: number[]) {
  const allRows = [...model.trainRows, ...model.calRows]
  const x = allRows.map((row) => row.features)
  const pLog = applyPlatt(predictLogisticLogits(model.logistic, x), model.logScaler)
  const pTree = applyPlatt(predictTreeLogits(model.tree, x), model.treeScaler)
  const probs = pLog.map((v, idx) => (v + pTree[idx]) / 2)
  const liveLog = applyPlatt(predictLogisticLogits(model.logistic, [latestFeatures]), model.logScaler)[0]
  const liveTree = applyPlatt(predictTreeLogits(model.tree, [latestFeatures]), model.treeScaler)[0]
  const liveProb = (liveLog + liveTree) / 2

  const ranked = probs
    .map((p, idx) => ({ idx, dist: Math.abs(p - liveProb) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, Math.max(15, Math.min(40, Math.floor(allRows.length * 0.18))))
    .map((item) => allRows[item.idx].futureReturnPct)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b)

  if (!ranked.length) {
    return {
      expectedReturn: null,
      predictionInterval: { p10: null, p50: null, p90: null },
      probLogistic: liveLog,
      probTree: liveTree,
      probUp: liveProb,
      agreement: 1 - Math.abs(liveLog - liveTree),
    }
  }

  return {
    expectedReturn: mean(ranked),
    predictionInterval: {
      p10: quantile(ranked, 0.10),
      p50: quantile(ranked, 0.50),
      p90: quantile(ranked, 0.90),
    },
    probLogistic: liveLog,
    probTree: liveTree,
    probUp: liveProb,
    agreement: 1 - Math.abs(liveLog - liveTree),
  }
}

function computeConfidenceValue(
  walk: WalkForwardResult,
  liveProb: number,
  agreement: number
) {
  const calibrationScore = 1 - clamp((walk.classification.calibrationError ?? 0.25) / 0.25, 0, 1)
  const edge = Math.abs(liveProb - 0.5) * 2
  return Math.round(
    clamp(
      (0.35 * edge) +
        (0.25 * calibrationScore) +
        (0.20 * agreement) +
        (0.20 * clamp(walk.predictions.length / 120, 0, 1)),
      0,
      1
    ) * 100
  )
}

function deriveActionAndSize(
  probUp: number,
  confidence: number,
  regime: ForecastRegime,
  currentVol: number
) {
  const volScalar = currentVol > 0 ? clamp(3.5 / currentVol, 0.15, 1) : 0.6
  const uncertaintyScalar = clamp(confidence / 100, 0.15, 1)
  const action: ForecastAction =
    regime === 'RISK_OFF'
      ? 'EXIT'
      : probUp >= ENTRY_THRESHOLD
        ? 'LONG'
        : probUp <= EXIT_THRESHOLD
          ? 'EXIT'
          : 'HOLD'
  const sizeEdge = clamp((probUp - EXIT_THRESHOLD) / Math.max(ENTRY_THRESHOLD - EXIT_THRESHOLD, 0.01), 0, 1)
  const positionSize =
    action === 'LONG' ? Number(clamp(sizeEdge * volScalar * uncertaintyScalar, 0, 1).toFixed(2)) : 0
  return { action, positionSize }
}

function scenarioExpectedEdge(expectedReturn: number | null, assetType: ForecastAssetType, costs: ForecastCosts) {
  if (expectedReturn == null || !Number.isFinite(expectedReturn)) return null
  return expectedReturn - (tradeCostPct(assetType, costs) * 100)
}

function relStrengthAdjustment(featureMap: FeatureMap) {
  const rel20 = clamp(featureMap.relBench20 / 10, -1, 1)
  const rel60 = clamp(featureMap.relBench60 / 16, -1, 1)
  const benchTrend = clamp(featureMap.benchmarkTrend20 / 8, -1, 1)
  return clamp((0.08 * rel20) + (0.05 * rel60) + (0.02 * benchTrend), -0.16, 0.16)
}

function breakoutSqueezeAdjustment(featureMap: FeatureMap) {
  const breakout = clamp(featureMap.breakoutStrength, -1, 1)
  const trendBias = clamp(featureMap.priceVs200dPct / 12, -1, 1)
  const squeeze = clamp((4.5 - Math.max(featureMap.atrPct14, featureMap.realizedVol20)) / 4.5, -1, 1)
  const alignment =
    breakout > 0.08 ? squeeze : breakout < -0.08 ? -squeeze : 0
  return clamp((0.09 * breakout) + (0.04 * trendBias) + (0.05 * alignment), -0.18, 0.18)
}

function confluenceAdjustment(featureMap: FeatureMap) {
  const trendCore = clamp(
    (featureMap.priceVs200dPct / 14) +
      (featureMap.ma50200SpreadPct / 12) +
      (featureMap.ma50SlopePct / 5),
    -1,
    1
  )
  const relCore = clamp((featureMap.relBench20 / 10) + (featureMap.relBench60 / 18), -1, 1)
  const breakoutCore = clamp(featureMap.breakoutStrength * 1.4, -1, 1)
  const drawdownPenalty = featureMap.drawdown63Pct < -18 ? -0.05 : 0
  return clamp((0.06 * trendCore) + (0.06 * relCore) + (0.07 * breakoutCore) + drawdownPenalty, -0.2, 0.2)
}

function adjustedExpectedReturn(baseExpectedReturn: number | null, probDelta: number) {
  if (baseExpectedReturn == null || !Number.isFinite(baseExpectedReturn)) return null
  return baseExpectedReturn + (probDelta * 18)
}

function scenarioProb(
  baseProb: number,
  featureMap: FeatureMap,
  scenario: ForecastScenarioName
) {
  if (scenario === 'baseline') return clamp(baseProb, 0.02, 0.98)
  if (scenario === 'btc_relative') return clamp(baseProb + relStrengthAdjustment(featureMap), 0.02, 0.98)
  if (scenario === 'breakout_squeeze') return clamp(baseProb + breakoutSqueezeAdjustment(featureMap), 0.02, 0.98)

  const rel = relStrengthAdjustment(featureMap)
  const breakout = breakoutSqueezeAdjustment(featureMap)
  const confluence = confluenceAdjustment(featureMap)
  return clamp(baseProb + (0.45 * rel) + (0.35 * breakout) + confluence, 0.02, 0.98)
}

function scenarioConfidence(
  baseConfidence: number,
  baseProb: number,
  nextProb: number,
  scenario: ForecastScenarioName
) {
  if (scenario === 'baseline') return baseConfidence
  const delta = Math.abs(nextProb - baseProb)
  const boost = scenario === 'confluence' ? 22 : scenario === 'breakout_squeeze' ? 16 : 14
  return Math.round(clamp(baseConfidence + (delta * 100 * boost * 0.1), 10, 99))
}

function scenarioLabel(scenario: ForecastScenarioName) {
  if (scenario === 'baseline') return 'Baseline ensemble'
  if (scenario === 'btc_relative') return 'BTC-relative strength'
  if (scenario === 'breakout_squeeze') return 'Breakout + squeeze'
  return 'Confluence model'
}

function scenarioModelType(scenario: ForecastScenarioName) {
  if (scenario === 'baseline') return 'Bestaande probabilistische ensemble'
  if (scenario === 'btc_relative') return 'Baseline + relative strength vs BTC'
  if (scenario === 'breakout_squeeze') return 'Baseline + breakout/squeeze overlay'
  return 'Samengevoegde confluence overlay'
}

function scenarioSummary(scenario: ForecastScenarioName) {
  if (scenario === 'baseline') return 'Huidige leakage-free forecast zonder extra crypto-overlays.'
  if (scenario === 'btc_relative') return 'Zwaarder gewicht voor alt-strength versus BTC en benchmarktrend.'
  if (scenario === 'breakout_squeeze') return 'Zoekt compressie + breakoutkwaliteit om grotere swings te isoleren.'
  return 'Combineert trend, BTC-relative strength en breakoutdruk in één strenger model.'
}

function scenarioReasons(
  featureMap: FeatureMap,
  scenario: ForecastScenarioName,
  action: ForecastAction
) {
  if (scenario === 'baseline') return makeReasons(featureMap, 'NEUTRAL', action)

  const reasons: string[] = []
  if (scenario === 'btc_relative' || scenario === 'confluence') {
    reasons.push(`Rel. sterkte 20D vs BTC: ${featureMap.relBench20.toFixed(1)}%`)
    reasons.push(`Rel. sterkte 60D vs BTC: ${featureMap.relBench60.toFixed(1)}%`)
  }
  if (scenario === 'breakout_squeeze' || scenario === 'confluence') {
    reasons.push(`Breakoutdruk: ${featureMap.breakoutStrength.toFixed(2)}`)
    reasons.push(`ATR ${featureMap.atrPct14.toFixed(2)}% en realized vol ${featureMap.realizedVol20.toFixed(2)}%`)
  }
  if (scenario === 'confluence') {
    reasons.push(`Prijs vs 200D: ${featureMap.priceVs200dPct.toFixed(1)}%`)
    reasons.push(`Benchmarktrend 20D: ${featureMap.benchmarkTrend20.toFixed(1)}%`)
  }
  if (action === 'EXIT') reasons.push('Model drukt onder de exit-zone na extra crypto-filters')
  if (!reasons.length) reasons.push('Geen extra crypto-filter actief')
  return reasons.slice(0, 5)
}

function transformScenarioPredictions(
  rows: FoldPrediction[],
  scenario: ForecastScenarioName
) {
  return rows.map((row) => ({
    ...row,
    probUp: scenarioProb(row.probUp, row.featureMap, scenario),
  }))
}

function evaluateScenarioPredictions(
  rows: FoldPrediction[],
  assetType: ForecastAssetType,
  costs: ForecastCosts
) {
  const y = rows.map((row) => row.target)
  const p = rows.map((row) => row.probUp)
  const strategy = simulateLongCashStrategy(
    rows,
    assetType,
    costs,
    (row) => row.probUp >= ENTRY_THRESHOLD && row.regime !== 'RISK_OFF',
    (row) => row.probUp <= EXIT_THRESHOLD || row.regime === 'RISK_OFF'
  )
  return {
    auc: aucScore(y, p),
    brier: brierScore(y, p),
    strategy,
  }
}

function makeReasons(featureMap: FeatureMap, regime: ForecastRegime, action: ForecastAction) {
  const reasons: string[] = []
  if (featureMap.priceVs200dPct > 0) reasons.push(`Prijs ligt ${featureMap.priceVs200dPct.toFixed(1)}% boven 200D gemiddelde`)
  else reasons.push(`Prijs ligt ${Math.abs(featureMap.priceVs200dPct).toFixed(1)}% onder 200D gemiddelde`)

  if (featureMap.relBench20 > 0.5) reasons.push(`Relatieve sterkte vs benchmark is positief (${featureMap.relBench20.toFixed(1)}%)`)
  else if (featureMap.relBench20 < -0.5) reasons.push(`Relatieve sterkte vs benchmark is zwak (${featureMap.relBench20.toFixed(1)}%)`)

  if (featureMap.breakoutStrength > 0.15) reasons.push(`Breakoutdruk is positief (${featureMap.breakoutStrength.toFixed(2)})`)
  else if (featureMap.breakoutStrength < -0.15) reasons.push(`Breakoutdruk is negatief (${featureMap.breakoutStrength.toFixed(2)})`)

  if (featureMap.atrPct14 > 0) reasons.push(`ATR ${featureMap.atrPct14.toFixed(2)}% bepaalt de risicoschaal`)
  if (featureMap.volumeZ20 > 0.5) reasons.push(`Volume ligt ${featureMap.volumeZ20.toFixed(1)} standaarddeviaties boven normaal`)
  if (regime === 'RISK_OFF') reasons.push('Breed marktregime staat op risk-off')
  if (regime === 'RISK_ON') reasons.push('Breed marktregime staat op risk-on')
  if (action === 'EXIT') reasons.push('Hysteresis dwingt terug naar cash onder de exitdrempel')

  return reasons.slice(0, 6)
}

export async function buildForecast(input: ForecastInput): Promise<ForecastOutput> {
  const symbol = String(input.symbol || '').trim().toUpperCase()
  if (!symbol) throw new Error('Missing symbol')
  const horizon = normalizeHorizon(input.horizon)
  const costs = getCosts(input)

  const asset = await fetchAssetHistory({ ...input, symbol, horizon })
  const benchmarkCloses = await fetchBenchmarkHistory(asset.market)
  const dataset = buildDataset(asset.data, benchmarkCloses, asset.market, horizon)
  if (dataset.rows.length < 120) {
    throw new Error('Not enough history for leakage-free forecast evaluation')
  }

  const walk = walkForwardEvaluate(dataset.rows, input.assetType, horizon, costs)
  const finalFit = fitFinalForecast(dataset.rows)
  const live = inferExpectedReturn(dataset.rows, finalFit, dataset.latest.features)
  const confidence = computeConfidenceValue(walk, live.probUp, live.agreement)

  const currentVol = Math.max(dataset.latest.featureMap.atrPct14, dataset.latest.featureMap.realizedVol20)
  const regime = dataset.latest.regime
  const { action, positionSize } = deriveActionAndSize(live.probUp, confidence, regime, currentVol)

  return {
    symbol,
    assetType: input.assetType,
    horizon,
    probUp: Number(clamp(live.probUp, 0, 1).toFixed(4)),
    confidence,
    expectedReturn: live.expectedReturn != null ? Number(live.expectedReturn.toFixed(2)) : null,
    predictionInterval: {
      p10: live.predictionInterval.p10 != null ? Number(live.predictionInterval.p10.toFixed(2)) : null,
      p50: live.predictionInterval.p50 != null ? Number(live.predictionInterval.p50.toFixed(2)) : null,
      p90: live.predictionInterval.p90 != null ? Number(live.predictionInterval.p90.toFixed(2)) : null,
    },
    positionSize,
    action,
    regime,
    topReasons: makeReasons(dataset.latest.featureMap, regime, action),
    labels: {
      featureWindow: 'Features gebruiken alleen candles t/m dag t (rolling lookback, start na ~220 dagen geschiedenis).',
      labelDefinition: `prob_up = P(log_return(${horizon}D) > 0), met label y_t = 1 als ln(close[t+${horizon}] / close[t]) > 0, anders 0.`,
      alignment: 'Featurevector op dag t wordt alleen gematcht met future return vanaf t+1 t/m t+horizon; walk-forward gebruikt purge/embargo van horizon-dagen tussen train, calibratie en test.',
      thresholds: `LONG bij prob_up >= ${ENTRY_THRESHOLD.toFixed(2)}, EXIT bij prob_up <= ${EXIT_THRESHOLD.toFixed(2)}, minimum hold ${MIN_HOLD_DAYS} dagen in evaluatie.`,
    },
    costs: {
      feeBpsRoundTrip: input.assetType === 'crypto' ? costs.feeBpsCrypto : costs.feeBpsEquity,
      slippageBpsRoundTrip: costs.slippageBps,
      totalRoundTripBps: (input.assetType === 'crypto' ? costs.feeBpsCrypto : costs.feeBpsEquity) + costs.slippageBps,
    },
    model: {
      ensemble: 'Regularized logistic regression + simple boosted stump ensemble (average van gekalibreerde probabilities)',
      calibrator: 'Platt scaling op time-series calibratieblok',
      samples: {
        train: finalFit.trainRows.length,
        calibration: finalFit.calRows.length,
        walkForwardTest: walk.predictions.length,
      },
      agreement: Number(clamp(live.agreement, 0, 1).toFixed(3)),
    },
    evaluation: {
      classification: {
        auc: walk.classification.auc != null ? Number(walk.classification.auc.toFixed(4)) : null,
        brier: walk.classification.brier != null ? Number(walk.classification.brier.toFixed(4)) : null,
        logLoss: walk.classification.logLoss != null ? Number(walk.classification.logLoss.toFixed(4)) : null,
        calibrationError: walk.classification.calibrationError != null ? Number(walk.classification.calibrationError.toFixed(4)) : null,
      },
      strategy: walk.strategy,
      baselines: walk.baselines,
      regimes: walk.regimes,
    },
    reasonsMeta: {
      market: asset.market,
      benchmark: asset.benchmark,
    },
  }
}

export async function buildForecastCompare(input: ForecastInput): Promise<ForecastCompareOutput> {
  const symbol = String(input.symbol || '').trim().toUpperCase()
  if (!symbol) throw new Error('Missing symbol')
  const horizon = normalizeHorizon(input.horizon)
  const costs = getCosts(input)

  const asset = await fetchAssetHistory({ ...input, symbol, horizon })
  const benchmarkCloses = await fetchBenchmarkHistory(asset.market)
  const dataset = buildDataset(asset.data, benchmarkCloses, asset.market, horizon)
  if (dataset.rows.length < 120) {
    throw new Error('Not enough history for scenario comparison')
  }

  const walk = walkForwardEvaluate(dataset.rows, input.assetType, horizon, costs)
  const finalFit = fitFinalForecast(dataset.rows)
  const live = inferExpectedReturn(dataset.rows, finalFit, dataset.latest.features)
  const baseConfidence = computeConfidenceValue(walk, live.probUp, live.agreement)
  const currentVol = Math.max(dataset.latest.featureMap.atrPct14, dataset.latest.featureMap.realizedVol20)
  const regime = dataset.latest.regime

  const scenarios: ForecastScenarioName[] = ['baseline', 'btc_relative', 'breakout_squeeze', 'confluence']
  const scenarioRowsMap = new Map<ForecastScenarioName, FoldPrediction[]>()
  scenarioRowsMap.set('baseline', walk.predictions)
  for (const scenario of scenarios) {
    if (scenario === 'baseline') continue
    scenarioRowsMap.set(scenario, transformScenarioPredictions(walk.predictions, scenario))
  }

  const out: ForecastScenarioOutput[] = scenarios.map((scenario) => {
    const probUp = scenarioProb(live.probUp, dataset.latest.featureMap, scenario)
    const confidence = scenarioConfidence(baseConfidence, live.probUp, probUp, scenario)
    const expectedReturn = adjustedExpectedReturn(live.expectedReturn, probUp - live.probUp)
    const edgeAfterCosts = scenarioExpectedEdge(expectedReturn, input.assetType, costs)
    const { action, positionSize } = deriveActionAndSize(probUp, confidence, regime, currentVol)
    const evaluated = evaluateScenarioPredictions(
      scenarioRowsMap.get(scenario) || walk.predictions,
      input.assetType,
      costs
    )

    return {
      key: scenario,
      label: scenarioLabel(scenario),
      modelType: scenarioModelType(scenario),
      probUp: Number(clamp(probUp, 0, 1).toFixed(4)),
      confidence,
      expectedReturn: expectedReturn != null ? Number(expectedReturn.toFixed(2)) : null,
      edgeAfterCosts: edgeAfterCosts != null ? Number(edgeAfterCosts.toFixed(2)) : null,
      action,
      positionSize,
      summary: scenarioSummary(scenario),
      topReasons: scenarioReasons(dataset.latest.featureMap, scenario, action),
      evaluation: {
        auc: evaluated.auc != null ? Number(evaluated.auc.toFixed(4)) : null,
        brier: evaluated.brier != null ? Number(evaluated.brier.toFixed(4)) : null,
        hitRate: evaluated.strategy.hitRate,
        avgTradeReturnPct: evaluated.strategy.avgTradeReturnPct,
        turnover: evaluated.strategy.turnover,
        compoundedValueOf100: evaluated.strategy.compoundedValueOf100,
      },
    }
  })

  return {
    symbol,
    assetType: input.assetType,
    horizon,
    regime,
    benchmark: asset.benchmark,
    featureSnapshot: {
      relBench20: Number(dataset.latest.featureMap.relBench20.toFixed(2)),
      relBench60: Number(dataset.latest.featureMap.relBench60.toFixed(2)),
      breakoutStrength: Number(dataset.latest.featureMap.breakoutStrength.toFixed(3)),
      atrPct14: Number(dataset.latest.featureMap.atrPct14.toFixed(2)),
      realizedVol20: Number(dataset.latest.featureMap.realizedVol20.toFixed(2)),
      priceVs200dPct: Number(dataset.latest.featureMap.priceVs200dPct.toFixed(2)),
      benchmarkTrend20: Number(dataset.latest.featureMap.benchmarkTrend20.toFixed(2)),
    },
    scenarios: out,
  }
}
