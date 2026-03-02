import type { NextApiRequest } from 'next'
import { COIN_SET, findCoin } from '@/lib/coins'
import { kvGetJSON, kvSetJSON } from '@/lib/kv'

export type ForwardAssetType = 'equity' | 'crypto'
export type ForwardSourceMode = 'audit' | 'fallback' | 'raw'
export type ForwardStrategy = 'standard' | 'high_move'
export type ForwardSide = 'BUY' | 'SELL'
export type ForwardExitReason = 'signal_removed' | 'flip_to_buy' | 'flip_to_sell'

export type ForwardSignal = {
  symbol: string
  name: string
  side: ForwardSide
  sourceMode: ForwardSourceMode
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
const HIGH_MOVE_CRYPTO_MIN_HOLD_MS = 48 * 60 * 60 * 1000
const HIGH_MOVE_CRYPTO_EXIT_CONFIRMATIONS = 2

type TrackerCostModel = {
  feeBpsRoundTrip: number
  slippageBpsRoundTrip: number
  totalBpsRoundTrip: number
  perSideBps: number
}

function trackerKey(assetType: ForwardAssetType, strategy: ForwardStrategy) {
  if (strategy === 'high_move') {
    return `paper-forward:v1:${assetType}:high_move`
  }
  return `paper-forward:v${TRACKER_VERSION_BY_ASSET[assetType]}:${assetType}`
}

function trackerVersion(assetType: ForwardAssetType, strategy: ForwardStrategy) {
  if (strategy === 'high_move') return 1
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

async function filterHighMoveCryptoSignals(origin: string, signals: ForwardSignal[]): Promise<ForwardSignal[]> {
  const deduped = dedupeSignals(signals)
  if (!deduped.length) return []

  const results = await Promise.all(
    deduped.map(async (signal) => {
      const forecast = await fetchJson<ForecastApiResponse>(
        `${origin}/api/forecast?symbol=${encodeURIComponent(signal.symbol)}&assetType=crypto&horizon=14`
      )
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
        if (confidence < HIGH_MOVE_CRYPTO_MIN_CONFIDENCE) return null
        if (expectedReturn < HIGH_MOVE_CRYPTO_MIN_EXPECTED_PCT) return null
        if (positionSize < 0.2) return null
        return {
          ...signal,
          name: `${signal.name}`,
        }
      }

      if (confidence < HIGH_MOVE_CRYPTO_MIN_CONFIDENCE) return null
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
  const signals =
    assetType === 'crypto' && strategy === 'high_move'
      ? await filterHighMoveCryptoSignals(origin, currentSignalsResp.signals)
      : currentSignalsResp.signals
  const signalMap = new Map<string, ForwardSignal>()
  for (const signal of signals) signalMap.set(signal.symbol, signal)

  const symbolsForPricing = [...new Set([...signals.map((s) => s.symbol), ...Object.keys(current.openPositions)])]
  const priceMap = await getCurrentPrices(origin, assetType, symbolsForPricing)
  const stamp = nowStamp()
  const isEquity = assetType === 'equity'
  const isHighMoveCrypto = assetType === 'crypto' && strategy === 'high_move'
  const usesStickyExits = isEquity || isHighMoveCrypto

  const nextState: ForwardTrackerState = {
    ...current,
    lastSyncAt: stamp.iso,
    lastSyncAtMs: stamp.ms,
    openPositions: { ...current.openPositions },
    pendingExits: { ...(current.pendingExits || {}) },
    closedTrades: [...current.closedTrades],
  }

  const currentOpenSymbols = Object.keys(nextState.openPositions)
  for (const symbol of currentOpenSymbols) {
    const open = nextState.openPositions[symbol]
    const liveSignal = signalMap.get(symbol)
    const currentPrice = priceMap[symbol]

    if (currentPrice != null && currentPrice > 0) {
      open.lastPrice = currentPrice
      open.lastMarkedAt = stamp.iso
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

  for (const signal of signals) {
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
      quantity: PRINCIPAL_PER_TRADE_EUR / currentPrice,
      principalEur: PRINCIPAL_PER_TRADE_EUR,
      sourceModeAtOpen: signal.sourceMode,
      lastPrice: currentPrice,
      lastMarkedAt: stamp.iso,
    }
    delete nextState.pendingExits?.[signal.symbol]
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
      currentSignals: signals.length,
      note: isEquity
        ? 'Forward-test start vanaf de eerste sync. Equity entries komen alleen uit audit/fallback, nooit uit raw. Aandelen sluiten alleen op een tegengesteld signaal, pas na minimaal 24 uur open én na 2 opeenvolgende exitsignalen. Netto rekent round-trip kosten mee.'
        : isHighMoveCrypto
          ? 'Forward-test start vanaf de eerste sync. Deze crypto-variant opent alleen entries met een 14D forecast van minimaal ±4% en confidence >= 60. Hij houdt minimaal 48 uur vast en sluit pas na 2 opeenvolgende exitsignalen.'
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
