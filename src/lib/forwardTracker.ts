import type { NextApiRequest } from 'next'
import { COINS, COIN_SET, findCoin } from '@/lib/coins'
import { buildForecast, type ForecastHorizon, type ForecastOutput } from '@/lib/forecastEngine'
import { kvGetJSON, kvSetJSON } from '@/lib/kv'

export type ForwardAssetType = 'equity' | 'crypto'
export type ForwardSourceMode = 'audit' | 'fallback' | 'raw'
export type ForwardStrategy =
  | 'standard'
  | 'high_move'
  | 'high_move_relaxed'
  | 'best_single_high_hit'
  | 'best_single'
  | 'best_single_1d'
  | 'best_single_3d'
  | 'best_single_5d'
  | 'best_single_2x'
  | 'best_single_5x'
export type ForwardSide = 'BUY' | 'SELL'
export type ForwardExitReason =
  | 'signal_removed'
  | 'flip_to_buy'
  | 'flip_to_sell'
  | 'bitunix_risk_stop'
  | 'take_profit_hit'
  | 'stop_loss_hit'

export type ForwardSignal = {
  symbol: string
  name: string
  side: ForwardSide
  sourceMode: ForwardSourceMode
  selectionReasons?: string[]
}

type PersistedOpenPosition = {
  symbol: string
  name: string
  side: ForwardSide
  openedAt: string
  openedAtMs: number
  entryPrice: number
  quantity: number
  principalEur: number
  sourceModeAtOpen: ForwardSourceMode
  lastPrice: number
  lastMarkedAt: string
  selectionReasons?: string[]
}

type PersistedPendingExit = {
  symbol: string
  reason: ForwardExitReason
  firstSeenAt: string
  firstSeenAtMs: number
  lastSeenAt: string
  lastSeenAtMs: number
  seenCount: number
}

export type ForwardOpenPosition = PersistedOpenPosition & {
  currentPrice: number
  currentValueEur: number
  netCurrentValueEur: number
  unrealizedPnlEur: number
  unrealizedReturnPct: number
  unrealizedNetPnlEur: number
  unrealizedNetReturnPct: number
  estimatedCostsEur: number
  daysOpen: number
}

type PersistedClosedTrade = {
  symbol: string
  name: string
  side: ForwardSide
  openedAt: string
  closedAt: string
  openedAtMs: number
  closedAtMs: number
  entryPrice: number
  exitPrice: number
  quantity: number
  principalEur: number
  pnlEur: number
  returnPct: number
  costsEur?: number
  netPnlEur?: number
  netReturnPct?: number
  daysOpen: number
  exitReason: ForwardExitReason
  sourceModeAtOpen: ForwardSourceMode
}

export type ForwardClosedTrade = PersistedClosedTrade & {
  costsEur: number
  netPnlEur: number
  netReturnPct: number
}

type ForwardTrackerState = {
  version: number
  assetType: ForwardAssetType
  principalPerTradeEur: number
  startedAt: string
  startedAtMs: number
  lastSyncAt: string
  lastSyncAtMs: number
  openPositions: Record<string, PersistedOpenPosition>
  pendingExits?: Record<string, PersistedPendingExit>
  closedTrades: PersistedClosedTrade[]
}

export type ForwardTrackerResponse = {
  meta: {
    assetType: ForwardAssetType
    strategy: ForwardStrategy
    startedAt: string
    lastSyncAt: string
    principalPerTradeEur: number
    sourceMode: ForwardSourceMode
    currentSignals: number
    note: string
    costs: {
      feeBpsRoundTrip: number
      slippageBpsRoundTrip: number
      totalBpsRoundTrip: number
    }
  }
  summary: {
    openTrades: number
    closedTrades: number
    realizedPnlEur: number
    realizedNetPnlEur: number
    unrealizedPnlEur: number
    unrealizedNetPnlEur: number
    totalPnlEur: number
    totalNetPnlEur: number
    realizedCostsEur: number
    estimatedOpenCostsEur: number
    totalCostsEur: number
    winRateClosed: number | null
    winRateClosedNet: number | null
    totalCommittedEur: number
  }
  openPositions: ForwardOpenPosition[]
  closedTrades: ForwardClosedTrade[]
}

type MarketAuditPick = {
  symbol?: string
  name?: string
  status?: 'BUY' | 'SELL'
}

type PremiumSignal = {
  market?: string
  symbol?: string
  name?: string
  status?: 'BUY' | 'SELL'
}

type TopSignalsResponse = {
  markets?: Array<{
    market?: string
    topBuy?: { symbol?: string; name?: string; signal?: string } | null
    topSell?: { symbol?: string; name?: string; signal?: string } | null
  }>
}

type ScoreBatchResponse = {
  items?: Array<{
    symbol?: string
    score?: number | null
    status?: 'BUY' | 'HOLD' | 'SELL' | 'NA'
  }>
}

type ForecastApiResponse = {
  probUp?: number
  confidence?: number
  expectedReturn?: number | null
  positionSize?: number
  action?: 'LONG' | 'HOLD' | 'EXIT'
  regime?: 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL'
}

type CoinHomeBuysResponse = {
  items?: Array<{ symbol?: string; name?: string; score?: number }>
}

type CoinTopMoversResponse = {
  losers?: Array<{ symbol?: string; name?: string; pct?: number }>
}

type QuotesResponse = {
  quotes?: Record<string, { regularMarketPrice?: number | null }>
}

const EQUITY_MARKETS = ['aex', 'dax', 'dowjones', 'etfs', 'ftse100', 'hangseng', 'nasdaq', 'nikkei225', 'sensex', 'sp500'] as const
const TRACKER_VERSION_BY_ASSET: Record<ForwardAssetType, number> = {
  equity: 5,
  crypto: 2,
}
const PRINCIPAL_PER_TRADE_EUR = 1000
const MAX_CLOSED_TRADES = 200
const FEE_BPS_EQUITY_ROUND_TRIP = 10
const FEE_BPS_CRYPTO_ROUND_TRIP = 20
const SLIPPAGE_BPS_ROUND_TRIP = 10
const EQUITY_MIN_HOLD_MS = 24 * 60 * 60 * 1000
const EQUITY_EXIT_CONFIRMATIONS = 2
const HIGH_MOVE_CRYPTO_MIN_EXPECTED_PCT = 4
const HIGH_MOVE_CRYPTO_MIN_CONFIDENCE = 60
const HIGH_MOVE_CRYPTO_RELAXED_MIN_CONFIDENCE = 55
const BEST_SINGLE_CRYPTO_MIN_CONFIDENCE = 55
const BEST_SINGLE_CRYPTO_MIN_DIRECTIONAL_PROB = 0.5
const HIGH_MOVE_CRYPTO_MIN_HOLD_MS = 48 * 60 * 60 * 1000
const HIGH_MOVE_CRYPTO_EXIT_CONFIRMATIONS = 2
const HIGH_HIT_CRYPTO_MIN_CONFIDENCE = 64
const HIGH_HIT_CRYPTO_MIN_DIRECTIONAL_PROB = 0.55
const HIGH_HIT_CRYPTO_MIN_EXPECTED_PCT = 0.9
const HIGH_HIT_CRYPTO_MIN_HOLD_MS = 24 * 60 * 60 * 1000
const HIGH_HIT_CRYPTO_EXIT_CONFIRMATIONS = 2
const HIGH_HIT_CRYPTO_TAKE_PROFIT_PCT = 2.0
const HIGH_HIT_CRYPTO_STOP_LOSS_PCT = 4.5
const BITUNIX_TIER1_MMR_DEFAULT = 0.0065
const BITUNIX_TIER1_MMR_MAJOR = 0.005
const BITUNIX_TIER1_MMR_BTC_ETH = 0.004
const BITUNIX_RISK_STOP_BUFFER_FRACTION = 0.4

type TrackerCostModel = {
  feeBpsRoundTrip: number
  slippageBpsRoundTrip: number
  totalBpsRoundTrip: number
  perSideBps: number
}

const bestSingleUniverseCache = new Map<string, { expiresAtMs: number; rows: ForwardSignal[] }>()
const cryptoForecastCache = new Map<string, { expiresAtMs: number; value: ForecastOutput | null }>()

function trackerKey(assetType: ForwardAssetType, strategy: ForwardStrategy) {
  if (
    strategy === 'high_move' ||
    strategy === 'high_move_relaxed' ||
    strategy === 'best_single_high_hit' ||
    strategy === 'best_single' ||
    strategy === 'best_single_1d' ||
    strategy === 'best_single_3d' ||
    strategy === 'best_single_5d' ||
    strategy === 'best_single_2x' ||
    strategy === 'best_single_5x'
  ) {
    return `paper-forward:v1:${assetType}:${strategy}`
  }
  return `paper-forward:v${TRACKER_VERSION_BY_ASSET[assetType]}:${assetType}`
}

function trackerVersion(assetType: ForwardAssetType, strategy: ForwardStrategy) {
  if (
    strategy === 'high_move' ||
    strategy === 'high_move_relaxed' ||
    strategy === 'best_single_high_hit' ||
    strategy === 'best_single' ||
    strategy === 'best_single_1d' ||
    strategy === 'best_single_3d' ||
    strategy === 'best_single_5d' ||
    strategy === 'best_single_2x' ||
    strategy === 'best_single_5x'
  ) {
    return 1
  }
  return TRACKER_VERSION_BY_ASSET[assetType]
}

function msToIso(ms: number) {
  return new Date(ms).toISOString()
}

function nowStamp() {
  const ms = Date.now()
  return { ms, iso: msToIso(ms) }
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

function daysBetween(fromMs: number, toMs: number) {
  return Math.max(0, (toMs - fromMs) / 86_400_000)
}

function safeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getCostModel(assetType: ForwardAssetType): TrackerCostModel {
  const feeBpsRoundTrip = assetType === 'equity' ? FEE_BPS_EQUITY_ROUND_TRIP : FEE_BPS_CRYPTO_ROUND_TRIP
  const slippageBpsRoundTrip = SLIPPAGE_BPS_ROUND_TRIP
  const totalBpsRoundTrip = feeBpsRoundTrip + slippageBpsRoundTrip
  return {
    feeBpsRoundTrip,
    slippageBpsRoundTrip,
    totalBpsRoundTrip,
    perSideBps: totalBpsRoundTrip / 2,
  }
}

function costFromBps(notional: number, bps: number) {
  return (Math.max(0, notional) * Math.max(0, bps)) / 10_000
}

function computeMarkedTrade(
  assetType: ForwardAssetType,
  side: ForwardSide,
  quantity: number,
  entryPrice: number,
  markPrice: number,
  principalEur: number
) {
  const grossPnlEur =
    side === 'BUY' ? quantity * (markPrice - entryPrice) : quantity * (entryPrice - markPrice)
  const currentValueEur = principalEur + grossPnlEur
  const model = getCostModel(assetType)
  const entryNotional = quantity * entryPrice
  const exitNotional = quantity * markPrice
  const costsEur = costFromBps(entryNotional, model.perSideBps) + costFromBps(exitNotional, model.perSideBps)
  const netPnlEur = grossPnlEur - costsEur

  return {
    grossPnlEur,
    grossReturnPct: (grossPnlEur / Math.max(1, principalEur)) * 100,
    currentValueEur,
    costsEur,
    netPnlEur,
    netReturnPct: (netPnlEur / Math.max(1, principalEur)) * 100,
    netCurrentValueEur: principalEur + netPnlEur,
  }
}

function baseUrl(req: NextApiRequest) {
  const proto = String((req.headers['x-forwarded-proto'] as string) || 'https')
  const host = String((req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost:3000')
  return `${proto}://${host}`
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

async function getCryptoForecast(symbol: string, horizon: ForecastHorizon): Promise<ForecastOutput | null> {
  const key = `${symbol.trim().toUpperCase()}:${horizon}`
  const cached = cryptoForecastCache.get(key)
  const nowMs = Date.now()
  if (cached && cached.expiresAtMs > nowMs) return cached.value

  try {
    const value = await buildForecast({
      symbol: symbol.trim().toUpperCase(),
      assetType: 'crypto',
      horizon,
    })
    cryptoForecastCache.set(key, { expiresAtMs: nowMs + 5 * 60_000, value })
    return value
  } catch {
    cryptoForecastCache.set(key, { expiresAtMs: nowMs + 60_000, value: null })
    return null
  }
}

function dedupeSignals(signals: ForwardSignal[]) {
  const bySymbol = new Map<string, ForwardSignal>()
  for (const signal of signals) {
    bySymbol.set(signal.symbol, signal)
  }
  return [...bySymbol.values()].sort((a, b) => a.symbol.localeCompare(b.symbol))
}

async function getEquitySignals(origin: string): Promise<{ signals: ForwardSignal[]; sourceMode: ForwardSourceMode }> {
  const audit = await getEquitySignalsByMode(origin, 'audit')
  if (audit.signals.length > 0) return audit
  const fallback = await getEquitySignalsByMode(origin, 'fallback')
  if (fallback.signals.length > 0) return fallback
  return { signals: [], sourceMode: 'fallback' }
}

async function getCryptoSignals(origin: string): Promise<{ signals: ForwardSignal[]; sourceMode: ForwardSourceMode }> {
  const audit = await getCryptoSignalsByMode(origin, 'audit')
  if (audit.signals.length > 0) return audit
  const fallback = await getCryptoSignalsByMode(origin, 'fallback')
  if (fallback.signals.length > 0) return fallback
  return getCryptoSignalsByMode(origin, 'raw')
}

async function fetchBinanceSpotPrice(pair: string): Promise<number | null> {
  try {
    const res = await fetch(`https://data-api.binance.vision/api/v3/ticker/price?symbol=${encodeURIComponent(pair)}`, {
      cache: 'no-store',
    })
    if (!res.ok) return null
    const data = (await res.json()) as { price?: string | number }
    const price = Number(data?.price)
    return Number.isFinite(price) && price > 0 ? price : null
  } catch {
    return null
  }
}

async function getCryptoCurrentPrices(symbols: string[]): Promise<Record<string, number>> {
  const unique = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))]
  if (!unique.length) return {}

  const out: Record<string, number> = {}
  const rows = await Promise.all(
    unique.map(async (symbol) => {
      const pair = findCoin(symbol)?.pairUSD?.binance
      if (!pair) return { symbol, price: null as number | null }
      const price = await fetchBinanceSpotPrice(pair)
      return { symbol, price }
    })
  )

  for (const row of rows) {
    if (row.price != null) out[row.symbol] = row.price
  }

  return out
}

async function getCurrentPrices(origin: string, assetType: ForwardAssetType, symbols: string[]): Promise<Record<string, number>> {
  if (assetType === 'crypto') {
    return getCryptoCurrentPrices(symbols)
  }

  const unique = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))]
  if (!unique.length) return {}
  const data = await fetchJson<QuotesResponse>(`${origin}/api/quotes?symbols=${encodeURIComponent(unique.join(','))}`)
  const out: Record<string, number> = {}
  for (const symbol of unique) {
    const price = safeNumber(data?.quotes?.[symbol]?.regularMarketPrice)
    if (price != null && price > 0) out[symbol] = price
  }
  return out
}

function createEmptyState(assetType: ForwardAssetType, strategy: ForwardStrategy): ForwardTrackerState {
  const stamp = nowStamp()
  return {
    version: trackerVersion(assetType, strategy),
    assetType,
    principalPerTradeEur: PRINCIPAL_PER_TRADE_EUR,
    startedAt: stamp.iso,
    startedAtMs: stamp.ms,
    lastSyncAt: stamp.iso,
    lastSyncAtMs: stamp.ms,
    openPositions: {},
    pendingExits: {},
    closedTrades: [],
  }
}

function closePosition(
  assetType: ForwardAssetType,
  position: PersistedOpenPosition,
  exitPrice: number,
  exitReason: ForwardExitReason,
  closedAtMs: number
): PersistedClosedTrade {
  const marked = computeMarkedTrade(
    assetType,
    position.side,
    position.quantity,
    position.entryPrice,
    exitPrice,
    position.principalEur
  )
  return {
    symbol: position.symbol,
    name: position.name,
    side: position.side,
    openedAt: position.openedAt,
    closedAt: msToIso(closedAtMs),
    openedAtMs: position.openedAtMs,
    closedAtMs,
    entryPrice: position.entryPrice,
    exitPrice,
    quantity: position.quantity,
    principalEur: position.principalEur,
    pnlEur: marked.grossPnlEur,
    returnPct: marked.grossReturnPct,
    costsEur: marked.costsEur,
    netPnlEur: marked.netPnlEur,
    netReturnPct: marked.netReturnPct,
    daysOpen: daysBetween(position.openedAtMs, closedAtMs),
    exitReason,
    sourceModeAtOpen: position.sourceModeAtOpen,
  }
}

function hydrateClosedTrade(assetType: ForwardAssetType, trade: PersistedClosedTrade): ForwardClosedTrade {
  const marked = computeMarkedTrade(assetType, trade.side, trade.quantity, trade.entryPrice, trade.exitPrice, trade.principalEur)
  const costsEur = safeNumber(trade.costsEur) ?? marked.costsEur
  const netPnlEur = safeNumber(trade.netPnlEur) ?? trade.pnlEur - costsEur
  const netReturnPct = safeNumber(trade.netReturnPct) ?? (netPnlEur / Math.max(1, trade.principalEur)) * 100

  return {
    ...trade,
    costsEur,
    netPnlEur,
    netReturnPct,
  }
}

function hydrateOpenPosition(
  assetType: ForwardAssetType,
  position: PersistedOpenPosition,
  currentPrice: number,
  nowMs: number
): ForwardOpenPosition {
  const marked = computeMarkedTrade(
    assetType,
    position.side,
    position.quantity,
    position.entryPrice,
    currentPrice,
    position.principalEur
  )
  return {
    ...position,
    currentPrice,
    currentValueEur: marked.currentValueEur,
    netCurrentValueEur: marked.netCurrentValueEur,
    unrealizedPnlEur: marked.grossPnlEur,
    unrealizedReturnPct: marked.grossReturnPct,
    unrealizedNetPnlEur: marked.netPnlEur,
    unrealizedNetReturnPct: marked.netReturnPct,
    estimatedCostsEur: marked.costsEur,
    daysOpen: daysBetween(position.openedAtMs, nowMs),
  }
}

async function getEquitySignalsByMode(origin: string, sourceMode?: ForwardSourceMode): Promise<{ signals: ForwardSignal[]; sourceMode: ForwardSourceMode }> {
  if (sourceMode === 'audit') {
    const auditSignals: ForwardSignal[] = []
    const audits = await Promise.all(
      EQUITY_MARKETS.map((market) =>
        fetchJson<{ qualifiedLivePicks?: MarketAuditPick[] }>(`${origin}/api/backtest/market-audit?market=${market}`).then((audit) => ({
          market,
          rows: audit?.qualifiedLivePicks || [],
        }))
      )
    )
    for (const audit of audits) {
      for (const row of audit.rows) {
        const symbol = String(row?.symbol || '').trim().toUpperCase()
        const name = String(row?.name || symbol).trim()
        const side = row?.status
        if (!symbol || !name || (side !== 'BUY' && side !== 'SELL')) continue
        auditSignals.push({ symbol, name, side, sourceMode: 'audit' })
      }
    }
    return { signals: dedupeSignals(auditSignals), sourceMode: 'audit' }
  }
  if (sourceMode === 'fallback') {
    const raw = await fetchJson<TopSignalsResponse>(`${origin}/api/screener/top-signals`)
    const candidates: ForwardSignal[] = []
    for (const row of raw?.markets || []) {
      if (row?.topBuy && String(row.topBuy.signal || '').toUpperCase() === 'BUY') {
        const symbol = String(row.topBuy.symbol || '').trim().toUpperCase()
        if (symbol) candidates.push({ symbol, name: String(row.topBuy.name || symbol).trim(), side: 'BUY', sourceMode: 'fallback' })
      }
      if (row?.topSell && String(row.topSell.signal || '').toUpperCase() === 'SELL') {
        const symbol = String(row.topSell.symbol || '').trim().toUpperCase()
        if (symbol) candidates.push({ symbol, name: String(row.topSell.name || symbol).trim(), side: 'SELL', sourceMode: 'fallback' })
      }
    }

    const dedupedCandidates = dedupeSignals(candidates)
    if (!dedupedCandidates.length) return { signals: [], sourceMode: 'fallback' }

    const scoreBatch = await fetchJson<ScoreBatchResponse>(
      `${origin}/api/indicators/score-batch?symbols=${encodeURIComponent(dedupedCandidates.map((row) => row.symbol).join(','))}`
    )
    const scoreMap = new Map(
      (scoreBatch?.items || []).map((row) => [
        String(row?.symbol || '').trim().toUpperCase(),
        {
          score: safeNumber(row?.score),
          status: row?.status,
        },
      ])
    )

    const filtered = dedupedCandidates
      .map((row) => {
        const batch = scoreMap.get(row.symbol)
        if (!batch || batch.score == null) return null
        if (batch.status !== row.side) return null
        const strength = row.side === 'BUY' ? batch.score : 100 - batch.score
        if (strength < 75) return null
        return { row, strength }
      })
      .filter((row): row is { row: ForwardSignal; strength: number } => !!row)
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 6)
      .map((row) => row.row)

    return { signals: filtered, sourceMode: 'fallback' }
  }
  if (sourceMode === 'raw') {
    const raw = await fetchJson<TopSignalsResponse>(`${origin}/api/screener/top-signals`)
    const rawSignals: ForwardSignal[] = []
    for (const row of raw?.markets || []) {
      if (row?.topBuy && String(row.topBuy.signal || '').toUpperCase() === 'BUY') {
        const symbol = String(row.topBuy.symbol || '').trim().toUpperCase()
        if (symbol) rawSignals.push({ symbol, name: String(row.topBuy.name || symbol).trim(), side: 'BUY', sourceMode: 'raw' })
      }
      if (row?.topSell && String(row.topSell.signal || '').toUpperCase() === 'SELL') {
        const symbol = String(row.topSell.symbol || '').trim().toUpperCase()
        if (symbol) rawSignals.push({ symbol, name: String(row.topSell.name || symbol).trim(), side: 'SELL', sourceMode: 'raw' })
      }
    }
    return { signals: dedupeSignals(rawSignals), sourceMode: 'raw' }
  }
  return getEquitySignals(origin)
}

async function getCryptoSignalsByMode(origin: string, sourceMode?: ForwardSourceMode): Promise<{ signals: ForwardSignal[]; sourceMode: ForwardSourceMode }> {
  if (sourceMode === 'audit') {
    const audit = await fetchJson<{ qualifiedLivePicks?: MarketAuditPick[] }>(`${origin}/api/backtest/market-audit?market=crypto`)
    const auditSignals = (audit?.qualifiedLivePicks || [])
      .map((row): ForwardSignal | null => {
        const symbol = String(row?.symbol || '').trim().toUpperCase()
        const name = String(row?.name || symbol).trim()
        const side = row?.status
        if (!symbol || !name || (side !== 'BUY' && side !== 'SELL')) return null
        return { symbol, name, side, sourceMode: 'audit' }
      })
      .filter((row): row is ForwardSignal => !!row)
    return { signals: dedupeSignals(auditSignals), sourceMode: 'audit' }
  }
  if (sourceMode === 'fallback') {
    const premium = await fetchJson<{ signals?: { all?: PremiumSignal[] } }>(`${origin}/api/market/premium-active?targetWinrate=0.7&maxSignalsGlobal=160`)
    const fallbackSignals = (premium?.signals?.all || [])
      .map((row): ForwardSignal | null => {
        const market = String(row?.market || '').trim().toUpperCase()
        if (market !== 'CRYPTO') return null
        const symbol = String(row?.symbol || '').trim().toUpperCase()
        const name = String(row?.name || symbol).trim()
        const side = row?.status
        if (!symbol || !name || (side !== 'BUY' && side !== 'SELL')) return null
        return { symbol, name, side, sourceMode: 'fallback' }
      })
      .filter((row): row is ForwardSignal => !!row)
    return { signals: dedupeSignals(fallbackSignals), sourceMode: 'fallback' }
  }
  if (sourceMode === 'raw') {
    const [buys, movers] = await Promise.all([
      fetchJson<CoinHomeBuysResponse>(`${origin}/api/coin/home-buys`),
      fetchJson<CoinTopMoversResponse>(`${origin}/api/coin/top-movers`),
    ])
    const rawSignals: ForwardSignal[] = []
    for (const row of buys?.items || []) {
      const symbol = String(row?.symbol || '').trim().toUpperCase()
      if (!symbol || !COIN_SET.has(symbol)) continue
      rawSignals.push({ symbol, name: String(row?.name || symbol).trim(), side: 'BUY', sourceMode: 'raw' })
    }
    for (const row of movers?.losers || []) {
      const symbol = String(row?.symbol || '').trim().toUpperCase()
      const pct = safeNumber(row?.pct)
      if (!symbol || !COIN_SET.has(symbol) || pct == null || pct >= -0.25) continue
      rawSignals.push({ symbol, name: String(row?.name || symbol).trim(), side: 'SELL', sourceMode: 'raw' })
    }
    return { signals: dedupeSignals(rawSignals), sourceMode: 'raw' }
  }
  return getCryptoSignals(origin)
}

async function getCurrentSignals(origin: string, assetType: ForwardAssetType, preferredSourceMode?: ForwardSourceMode) {
  if (assetType === 'equity') {
    if (preferredSourceMode === 'audit' || preferredSourceMode === 'fallback') {
      return getEquitySignalsByMode(origin, preferredSourceMode)
    }
    return getEquitySignals(origin)
  }
  return getCryptoSignalsByMode(origin, preferredSourceMode)
}

function isHighMoveCryptoStrategy(
  strategy: ForwardStrategy
): strategy is Extract<ForwardStrategy, 'high_move' | 'high_move_relaxed'> {
  return strategy === 'high_move' || strategy === 'high_move_relaxed'
}

function isBestSingleCryptoStrategy(
  strategy: ForwardStrategy
): strategy is Extract<
  ForwardStrategy,
  'best_single_high_hit' | 'best_single' | 'best_single_1d' | 'best_single_3d' | 'best_single_5d' | 'best_single_2x' | 'best_single_5x'
> {
  return (
    strategy === 'best_single_high_hit' ||
    strategy === 'best_single' ||
    strategy === 'best_single_1d' ||
    strategy === 'best_single_3d' ||
    strategy === 'best_single_5d' ||
    strategy === 'best_single_2x' ||
    strategy === 'best_single_5x'
  )
}

function isLeveragedBestSingleCryptoStrategy(
  strategy: ForwardStrategy
): strategy is Extract<ForwardStrategy, 'best_single_2x' | 'best_single_5x'> {
  return strategy === 'best_single_2x' || strategy === 'best_single_5x'
}

function bestSingleLeverageMultiplier(strategy: ForwardStrategy) {
  if (strategy === 'best_single_5x') return 5
  if (strategy === 'best_single_2x') return 2
  return 1
}

function bestSingleForecastHorizon(strategy: ForwardStrategy): ForecastHorizon {
  if (strategy === 'best_single_1d') return 1
  if (strategy === 'best_single_3d') return 3
  if (strategy === 'best_single_5d') return 5
  return 14
}

function isHighHitCryptoStrategy(
  strategy: ForwardStrategy
): strategy is Extract<ForwardStrategy, 'best_single_high_hit'> {
  return strategy === 'best_single_high_hit'
}

function bitunixTier1MaintenanceMarginRate(symbol: string) {
  const key = symbol.trim().toUpperCase()
  if (key === 'BTC' || key === 'ETH') return BITUNIX_TIER1_MMR_BTC_ETH
  if (key === 'BNB' || key === 'DOGE' || key === 'SOL' || key === 'XRP') return BITUNIX_TIER1_MMR_MAJOR
  return BITUNIX_TIER1_MMR_DEFAULT
}

function leveragedBitunixRiskStopReached(
  assetType: ForwardAssetType,
  strategy: ForwardStrategy,
  position: PersistedOpenPosition,
  currentPrice: number
) {
  if (assetType !== 'crypto') return false
  if (!isLeveragedBestSingleCryptoStrategy(strategy)) return false
  if (!(currentPrice > 0) || !(position.entryPrice > 0)) return false

  const leverage = bestSingleLeverageMultiplier(strategy)
  if (leverage <= 1) return false

  const adverseMove =
    position.side === 'BUY'
      ? (position.entryPrice - currentPrice) / position.entryPrice
      : (currentPrice - position.entryPrice) / position.entryPrice

  if (adverseMove <= 0) return false

  const mmr = bitunixTier1MaintenanceMarginRate(position.symbol)
  const model = getCostModel(assetType)
  const feesReserve = model.totalBpsRoundTrip / 10_000
  const liquidationDistance = clamp((1 / leverage) - mmr - feesReserve, 0.01, 0.95)
  const riskStopDistance = liquidationDistance * BITUNIX_RISK_STOP_BUFFER_FRACTION

  return adverseMove >= riskStopDistance
}

function highMoveConfidenceFloor(strategy: ForwardStrategy) {
  return strategy === 'high_move_relaxed' ? HIGH_MOVE_CRYPTO_RELAXED_MIN_CONFIDENCE : HIGH_MOVE_CRYPTO_MIN_CONFIDENCE
}

async function filterHighMoveCryptoSignals(
  origin: string,
  signals: ForwardSignal[],
  strategy: Extract<ForwardStrategy, 'high_move' | 'high_move_relaxed'>
): Promise<ForwardSignal[]> {
  const deduped = dedupeSignals(signals)
  if (!deduped.length) return []
  const minConfidence = highMoveConfidenceFloor(strategy)

  const results = await Promise.all(
    deduped.map(async (signal) => {
      const forecast = await getCryptoForecast(signal.symbol, 14)
      const expectedReturn = safeNumber(forecast?.expectedReturn)
      const confidence = safeNumber(forecast?.confidence)
      const probUp = safeNumber(forecast?.probUp)
      const positionSize = safeNumber(forecast?.positionSize)
      const action = forecast?.action
      const regime = forecast?.regime
      if (expectedReturn == null || confidence == null || probUp == null || positionSize == null || !action || !regime) return null

      if (signal.side === 'BUY') {
        if (action !== 'LONG') return null
        if (regime === 'RISK_OFF') return null
        if (confidence < minConfidence) return null
        if (expectedReturn < HIGH_MOVE_CRYPTO_MIN_EXPECTED_PCT) return null
        if (positionSize < 0.2) return null
        return {
          ...signal,
          name: `${signal.name}`,
        }
      }

      if (confidence < minConfidence) return null
      if (expectedReturn > -HIGH_MOVE_CRYPTO_MIN_EXPECTED_PCT) return null
      if (probUp > 0.4) return null
      return {
        ...signal,
        name: `${signal.name}`,
      }
    })
  )

  return results.filter((row): row is ForwardSignal => !!row)
}

async function rankBestSingleCryptoSignals(
  origin: string,
  strategy: Extract<
    ForwardStrategy,
    'best_single_high_hit' | 'best_single' | 'best_single_1d' | 'best_single_3d' | 'best_single_5d' | 'best_single_2x' | 'best_single_5x'
  >
): Promise<ForwardSignal[]> {
  const horizon = bestSingleForecastHorizon(strategy)
  const cacheKey = `${strategy}:${horizon}`
  const cached = bestSingleUniverseCache.get(cacheKey)
  if (cached && cached.expiresAtMs > Date.now()) {
    return cached.rows
  }

  const universe = COINS.map((coin) => ({
    symbol: coin.symbol.toUpperCase(),
    name: coin.name,
  }))
  if (!universe.length) return []

  const ranked = await Promise.all(
    universe.map(async (coin) => {
      const forecast = await getCryptoForecast(coin.symbol, horizon)
      const probUp = safeNumber(forecast?.probUp)
      const confidence = safeNumber(forecast?.confidence)
      const expectedReturn = safeNumber(forecast?.expectedReturn)

      if (probUp == null || confidence == null) {
        return null
      }

      if (confidence < BEST_SINGLE_CRYPTO_MIN_CONFIDENCE) return null

      const side: ForwardSide = probUp >= 0.5 ? 'BUY' : 'SELL'
      const directionalProb = side === 'BUY' ? probUp : 1 - probUp
      if (directionalProb < BEST_SINGLE_CRYPTO_MIN_DIRECTIONAL_PROB) return null

      const directionalExpectedReturn =
        expectedReturn == null ? 0 : side === 'BUY' ? expectedReturn : -expectedReturn
      const rankScore =
        (directionalProb * 120) +
        (confidence * 1.0) +
        (directionalExpectedReturn * 4)

      return {
        signal: {
          symbol: coin.symbol,
          name: coin.name,
          side,
          sourceMode: 'raw' as const,
          selectionReasons: Array.isArray(forecast.topReasons) ? forecast.topReasons.slice(0, 4) : [],
        },
        rankScore,
      }
    })
  )

  const rows = ranked
    .filter((row): row is NonNullable<(typeof ranked)[number]> => row != null)
    .sort((a, b) => b.rankScore - a.rankScore)
    .map((row) => row.signal)

  bestSingleUniverseCache.set(cacheKey, {
    expiresAtMs: Date.now() + 5 * 60_000,
    rows,
  })

  return rows
}

async function rankHighHitCryptoSignals(origin: string): Promise<ForwardSignal[]> {
  const rows = await rankBestSingleCryptoSignals(origin, 'best_single_high_hit')
  if (!rows.length) return []

  const filtered = await Promise.all(
    rows.map(async (signal) => {
      const forecast = await getCryptoForecast(signal.symbol, 14)
      const probUp = safeNumber(forecast?.probUp)
      const confidence = safeNumber(forecast?.confidence)
      const expectedReturn = safeNumber(forecast?.expectedReturn)
      if (probUp == null || confidence == null) return null
      if (confidence < HIGH_HIT_CRYPTO_MIN_CONFIDENCE) return null

      const side = signal.side
      const directionalProb = side === 'BUY' ? probUp : 1 - probUp
      if (directionalProb < HIGH_HIT_CRYPTO_MIN_DIRECTIONAL_PROB) return null

      const directionalExpectedReturn = expectedReturn == null ? 0 : side === 'BUY' ? expectedReturn : -expectedReturn
      if (directionalExpectedReturn < HIGH_HIT_CRYPTO_MIN_EXPECTED_PCT) return null

      const rankScore = (confidence * 1.5) + (directionalProb * 180) + (directionalExpectedReturn * 2)
      return { signal, rankScore }
    })
  )

  return filtered
    .filter((row): row is NonNullable<(typeof filtered)[number]> => row != null)
    .sort((a, b) => b.rankScore - a.rankScore)
    .map((row) => row.signal)
}

export async function syncForwardTracker(
  req: NextApiRequest,
  assetType: ForwardAssetType,
  preferredSourceMode?: ForwardSourceMode,
  strategy: ForwardStrategy = 'standard'
): Promise<ForwardTrackerResponse> {
  const origin = baseUrl(req)
  const key = trackerKey(assetType, strategy)
  const current = (await kvGetJSON<ForwardTrackerState>(key)) || createEmptyState(assetType, strategy)

  const currentSignalsResp = await getCurrentSignals(origin, assetType, preferredSourceMode)
  const sourceMode = currentSignalsResp.sourceMode
  const isBestSingleCrypto = assetType === 'crypto' && isBestSingleCryptoStrategy(strategy)
  const isHighHitCrypto = assetType === 'crypto' && isHighHitCryptoStrategy(strategy)
  const bestSingleCandidates =
    isBestSingleCrypto
      ? (isHighHitCrypto ? await rankHighHitCryptoSignals(origin) : await rankBestSingleCryptoSignals(origin, strategy))
      : null
  let signals =
    assetType === 'crypto' && isHighMoveCryptoStrategy(strategy)
      ? await filterHighMoveCryptoSignals(origin, currentSignalsResp.signals, strategy)
      : isBestSingleCrypto
        ? []
      : currentSignalsResp.signals

  if (isBestSingleCrypto) {
    const existingOpen = Object.values(current.openPositions)
      .sort((a, b) => b.openedAtMs - a.openedAtMs)[0]
    if (existingOpen) {
      const liveCurrent = currentSignalsResp.signals.find((row) => row.symbol === existingOpen.symbol)
      signals = liveCurrent ? [liveCurrent] : []
    } else {
      signals = (bestSingleCandidates || []).slice(0, 1)
    }
  }

  const signalMap = new Map<string, ForwardSignal>()
  for (const signal of signals) signalMap.set(signal.symbol, signal)

  const symbolsForPricing = [...new Set([...signals.map((s) => s.symbol), ...Object.keys(current.openPositions)])]
  const priceMap = await getCurrentPrices(origin, assetType, symbolsForPricing)
  const stamp = nowStamp()
  const leverageMultiplier = isBestSingleCrypto ? bestSingleLeverageMultiplier(strategy) : 1
  const isEquity = assetType === 'equity'
  const isHighMoveCrypto = assetType === 'crypto' && isHighMoveCryptoStrategy(strategy)
  const usesStickyExits = isEquity || isHighMoveCrypto || isHighHitCrypto
  const qualifyingSignalCount =
    isBestSingleCrypto
      ? (bestSingleCandidates || []).length
      : signals.length

  const nextState: ForwardTrackerState = {
    ...current,
    lastSyncAt: stamp.iso,
    lastSyncAtMs: stamp.ms,
    openPositions: { ...current.openPositions },
    pendingExits: { ...(current.pendingExits || {}) },
    closedTrades: [...current.closedTrades],
  }
  const blockedEntrySymbols = new Set<string>()

  const currentOpenSymbols = Object.keys(nextState.openPositions)
  for (const symbol of currentOpenSymbols) {
    const open = nextState.openPositions[symbol]
    const liveSignal = signalMap.get(symbol)
    const currentPrice = priceMap[symbol]

    if (currentPrice != null && currentPrice > 0) {
      open.lastPrice = currentPrice
      open.lastMarkedAt = stamp.iso
    }

    if (isHighHitCrypto && currentPrice != null && currentPrice > 0) {
      const marked = computeMarkedTrade(assetType, open.side, open.quantity, open.entryPrice, currentPrice, open.principalEur)
      if (marked.grossReturnPct >= HIGH_HIT_CRYPTO_TAKE_PROFIT_PCT) {
        nextState.closedTrades.unshift(closePosition(assetType, open, currentPrice, 'take_profit_hit', stamp.ms))
        delete nextState.openPositions[symbol]
        delete nextState.pendingExits?.[symbol]
        blockedEntrySymbols.add(symbol)
        continue
      }
      if (marked.grossReturnPct <= -HIGH_HIT_CRYPTO_STOP_LOSS_PCT) {
        nextState.closedTrades.unshift(closePosition(assetType, open, currentPrice, 'stop_loss_hit', stamp.ms))
        delete nextState.openPositions[symbol]
        delete nextState.pendingExits?.[symbol]
        blockedEntrySymbols.add(symbol)
        continue
      }
    }

    if (currentPrice != null && currentPrice > 0 && leveragedBitunixRiskStopReached(assetType, strategy, open, currentPrice)) {
      nextState.closedTrades.unshift(closePosition(assetType, open, currentPrice, 'bitunix_risk_stop', stamp.ms))
      delete nextState.openPositions[symbol]
      delete nextState.pendingExits?.[symbol]
      blockedEntrySymbols.add(symbol)
      continue
    }

    if (usesStickyExits && liveSignal?.side === open.side) {
      delete nextState.pendingExits?.[symbol]
      continue
    }

    if (!liveSignal) {
      if (isEquity) {
        delete nextState.pendingExits?.[symbol]
        continue
      }
      if (isHighMoveCrypto) {
        const pending = nextState.pendingExits?.[symbol]
        const seenCount = pending?.reason === 'signal_removed' ? pending.seenCount + 1 : 1
        nextState.pendingExits![symbol] = {
          symbol,
          reason: 'signal_removed',
          firstSeenAt: pending?.reason === 'signal_removed' ? pending.firstSeenAt : stamp.iso,
          firstSeenAtMs: pending?.reason === 'signal_removed' ? pending.firstSeenAtMs : stamp.ms,
          lastSeenAt: stamp.iso,
          lastSeenAtMs: stamp.ms,
          seenCount,
        }
        const heldLongEnough = stamp.ms - open.openedAtMs >= HIGH_MOVE_CRYPTO_MIN_HOLD_MS
        if (!heldLongEnough || seenCount < HIGH_MOVE_CRYPTO_EXIT_CONFIRMATIONS) continue
      }
      if (isHighHitCrypto) {
        const pending = nextState.pendingExits?.[symbol]
        const seenCount = pending?.reason === 'signal_removed' ? pending.seenCount + 1 : 1
        nextState.pendingExits![symbol] = {
          symbol,
          reason: 'signal_removed',
          firstSeenAt: pending?.reason === 'signal_removed' ? pending.firstSeenAt : stamp.iso,
          firstSeenAtMs: pending?.reason === 'signal_removed' ? pending.firstSeenAtMs : stamp.ms,
          lastSeenAt: stamp.iso,
          lastSeenAtMs: stamp.ms,
          seenCount,
        }
        const heldLongEnough = stamp.ms - open.openedAtMs >= HIGH_HIT_CRYPTO_MIN_HOLD_MS
        if (!heldLongEnough || seenCount < HIGH_HIT_CRYPTO_EXIT_CONFIRMATIONS) continue
      }
      if (currentPrice != null && currentPrice > 0) {
        nextState.closedTrades.unshift(closePosition(assetType, open, currentPrice, 'signal_removed', stamp.ms))
        delete nextState.openPositions[symbol]
        delete nextState.pendingExits?.[symbol]
      }
      continue
    }

    if (liveSignal.side !== open.side) {
      if (isEquity) {
        const reason = liveSignal.side === 'BUY' ? 'flip_to_buy' : 'flip_to_sell'
        const pending = nextState.pendingExits?.[symbol]
        const seenCount = pending?.reason === reason ? pending.seenCount + 1 : 1
        nextState.pendingExits![symbol] = {
          symbol,
          reason,
          firstSeenAt: pending?.reason === reason ? pending.firstSeenAt : stamp.iso,
          firstSeenAtMs: pending?.reason === reason ? pending.firstSeenAtMs : stamp.ms,
          lastSeenAt: stamp.iso,
          lastSeenAtMs: stamp.ms,
          seenCount,
        }
        const heldLongEnough = stamp.ms - open.openedAtMs >= EQUITY_MIN_HOLD_MS
        if (!heldLongEnough || seenCount < EQUITY_EXIT_CONFIRMATIONS) continue
      }
      if (isHighMoveCrypto) {
        const reason = liveSignal.side === 'BUY' ? 'flip_to_buy' : 'flip_to_sell'
        const pending = nextState.pendingExits?.[symbol]
        const seenCount = pending?.reason === reason ? pending.seenCount + 1 : 1
        nextState.pendingExits![symbol] = {
          symbol,
          reason,
          firstSeenAt: pending?.reason === reason ? pending.firstSeenAt : stamp.iso,
          firstSeenAtMs: pending?.reason === reason ? pending.firstSeenAtMs : stamp.ms,
          lastSeenAt: stamp.iso,
          lastSeenAtMs: stamp.ms,
          seenCount,
        }
        const heldLongEnough = stamp.ms - open.openedAtMs >= HIGH_MOVE_CRYPTO_MIN_HOLD_MS
        if (!heldLongEnough || seenCount < HIGH_MOVE_CRYPTO_EXIT_CONFIRMATIONS) continue
      }
      if (isHighHitCrypto) {
        const reason = liveSignal.side === 'BUY' ? 'flip_to_buy' : 'flip_to_sell'
        const pending = nextState.pendingExits?.[symbol]
        const seenCount = pending?.reason === reason ? pending.seenCount + 1 : 1
        nextState.pendingExits![symbol] = {
          symbol,
          reason,
          firstSeenAt: pending?.reason === reason ? pending.firstSeenAt : stamp.iso,
          firstSeenAtMs: pending?.reason === reason ? pending.firstSeenAtMs : stamp.ms,
          lastSeenAt: stamp.iso,
          lastSeenAtMs: stamp.ms,
          seenCount,
        }
        const heldLongEnough = stamp.ms - open.openedAtMs >= HIGH_HIT_CRYPTO_MIN_HOLD_MS
        if (!heldLongEnough || seenCount < HIGH_HIT_CRYPTO_EXIT_CONFIRMATIONS) continue
      }
      if (currentPrice != null && currentPrice > 0) {
        nextState.closedTrades.unshift(
          closePosition(assetType, open, currentPrice, liveSignal.side === 'BUY' ? 'flip_to_buy' : 'flip_to_sell', stamp.ms)
        )
        delete nextState.openPositions[symbol]
        delete nextState.pendingExits?.[symbol]
      }
    }
  }

  if (nextState.pendingExits) {
    for (const symbol of Object.keys(nextState.pendingExits)) {
      if (!nextState.openPositions[symbol]) delete nextState.pendingExits[symbol]
    }
  }

  let entrySignals = signals
  if (isBestSingleCrypto && Object.keys(nextState.openPositions).length === 0) {
    entrySignals = bestSingleCandidates || []
  }

  for (const signal of entrySignals) {
    if (isBestSingleCrypto && Object.keys(nextState.openPositions).length > 0) break
    if (blockedEntrySymbols.has(signal.symbol)) continue
    if (nextState.openPositions[signal.symbol]) continue
    const currentPrice = priceMap[signal.symbol]
    if (currentPrice == null || currentPrice <= 0) continue
    nextState.openPositions[signal.symbol] = {
      symbol: signal.symbol,
      name: signal.name,
      side: signal.side,
      openedAt: stamp.iso,
      openedAtMs: stamp.ms,
      entryPrice: currentPrice,
      quantity: (PRINCIPAL_PER_TRADE_EUR * leverageMultiplier) / currentPrice,
      principalEur: PRINCIPAL_PER_TRADE_EUR,
      sourceModeAtOpen: signal.sourceMode,
      lastPrice: currentPrice,
      lastMarkedAt: stamp.iso,
      selectionReasons: signal.selectionReasons,
    }
    delete nextState.pendingExits?.[signal.symbol]
    if (isBestSingleCrypto) break
  }

  if (nextState.closedTrades.length > MAX_CLOSED_TRADES) {
    nextState.closedTrades = nextState.closedTrades.slice(0, MAX_CLOSED_TRADES)
  }

  await kvSetJSON(key, nextState)

  const openPositions = Object.values(nextState.openPositions)
    .map((position) => hydrateOpenPosition(assetType, position, priceMap[position.symbol] ?? position.lastPrice, stamp.ms))
    .sort((a, b) => b.openedAtMs - a.openedAtMs)

  const closedTrades = [...nextState.closedTrades].map((trade) => hydrateClosedTrade(assetType, trade)).sort((a, b) => b.closedAtMs - a.closedAtMs)
  const costModel = getCostModel(assetType)
  const realizedPnlEur = closedTrades.reduce((sum, trade) => sum + trade.pnlEur, 0)
  const realizedNetPnlEur = closedTrades.reduce((sum, trade) => sum + trade.netPnlEur, 0)
  const unrealizedPnlEur = openPositions.reduce((sum, position) => sum + position.unrealizedPnlEur, 0)
  const unrealizedNetPnlEur = openPositions.reduce((sum, position) => sum + position.unrealizedNetPnlEur, 0)
  const realizedCostsEur = closedTrades.reduce((sum, trade) => sum + trade.costsEur, 0)
  const estimatedOpenCostsEur = openPositions.reduce((sum, position) => sum + position.estimatedCostsEur, 0)
  const wins = closedTrades.filter((trade) => trade.pnlEur > 0).length
  const winsNet = closedTrades.filter((trade) => trade.netPnlEur > 0).length

  return {
    meta: {
      assetType,
      strategy,
      startedAt: nextState.startedAt,
      lastSyncAt: nextState.lastSyncAt,
      principalPerTradeEur: nextState.principalPerTradeEur,
      sourceMode,
      currentSignals: qualifyingSignalCount,
      note: isEquity
        ? 'Forward-test start vanaf de eerste sync. Equity entries komen alleen uit audit/fallback, nooit uit raw. Aandelen sluiten alleen op een tegengesteld signaal, pas na minimaal 24 uur open én na 2 opeenvolgende exitsignalen. Netto rekent round-trip kosten mee.'
        : isBestSingleCrypto
          ? `Forward-test start vanaf de eerste sync. Deze variant houdt maximaal 1 crypto tegelijk aan met ${leverageMultiplier}x leverage op €1000 margin (€${(
              PRINCIPAL_PER_TRADE_EUR * leverageMultiplier
            ).toFixed(0)} notional). ${isHighHitCryptoStrategy(strategy) ? `Deze high hit-rate variant gebruikt een minder strenge maar nog steeds selectieve 14D filter (hogere confidence + hogere directionele kans dan standaard), houdt maximaal 1 coin tegelijk aan en sluit sneller op een kleine take-profit (${HIGH_HIT_CRYPTO_TAKE_PROFIT_PCT.toFixed(1)}%) of ruimere stop (${HIGH_HIT_CRYPTO_STOP_LOSS_PCT.toFixed(1)}%) om de trefkans op te voeren.` : `Hij gebruikt dezelfde ${bestSingleForecastHorizon(strategy)}D forecast-score voor de volledige crypto-universe en kiest de beste huidige LONG of SHORT, afhankelijk van welke richting de hoogste kans heeft. Pas na sluiten wordt de volgende beste coin gekozen.`}${isLeveragedBestSingleCryptoStrategy(strategy) ? ' Voor 2x/5x geldt daarnaast een conservatieve Bitunix-achtige isolated risicostop: op basis van mark-price benadering en tier-1 maintenance margin sluit de trade vroegtijdig rond 40% van de theoretische liquidatiebuffer.' : ''}`
        : isHighMoveCrypto
          ? `Forward-test start vanaf de eerste sync. Deze crypto-variant opent alleen entries met een 14D forecast van minimaal ±4% en confidence >= ${highMoveConfidenceFloor(
              strategy
            )}. Hij houdt minimaal 48 uur vast en sluit pas na 2 opeenvolgende exitsignalen.`
        : 'Forward-test start vanaf de eerste sync. Elke nieuwe BUY/SELL opent fictief een trade van €1000. Trades sluiten bij statusflip of wanneer het signaal verdwijnt. Netto rekent round-trip kosten mee.',
      costs: {
        feeBpsRoundTrip: costModel.feeBpsRoundTrip,
        slippageBpsRoundTrip: costModel.slippageBpsRoundTrip,
        totalBpsRoundTrip: costModel.totalBpsRoundTrip,
      },
    },
    summary: {
      openTrades: openPositions.length,
      closedTrades: closedTrades.length,
      realizedPnlEur,
      realizedNetPnlEur,
      unrealizedPnlEur,
      unrealizedNetPnlEur,
      totalPnlEur: realizedPnlEur + unrealizedPnlEur,
      totalNetPnlEur: realizedNetPnlEur + unrealizedNetPnlEur,
      realizedCostsEur,
      estimatedOpenCostsEur,
      totalCostsEur: realizedCostsEur + estimatedOpenCostsEur,
      winRateClosed: closedTrades.length ? wins / closedTrades.length : null,
      winRateClosedNet: closedTrades.length ? winsNet / closedTrades.length : null,
      totalCommittedEur: openPositions.length * nextState.principalPerTradeEur,
    },
    openPositions,
    closedTrades: closedTrades.slice(0, 20),
  }
}
