import type { NextApiRequest } from 'next'
import { COIN_SET, findCoin } from '@/lib/coins'
import { kvGetJSON, kvSetJSON } from '@/lib/kv'

export type ForwardAssetType = 'equity' | 'crypto'
export type ForwardSourceMode = 'audit' | 'fallback' | 'raw'
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

export type ForwardOpenPosition = PersistedOpenPosition & {
  currentPrice: number
  currentValueEur: number
  unrealizedPnlEur: number
  unrealizedReturnPct: number
  daysOpen: number
}

export type ForwardClosedTrade = {
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
  daysOpen: number
  exitReason: ForwardExitReason
  sourceModeAtOpen: ForwardSourceMode
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
  closedTrades: ForwardClosedTrade[]
}

export type ForwardTrackerResponse = {
  meta: {
    assetType: ForwardAssetType
    startedAt: string
    lastSyncAt: string
    principalPerTradeEur: number
    sourceMode: ForwardSourceMode
    currentSignals: number
    note: string
  }
  summary: {
    openTrades: number
    closedTrades: number
    realizedPnlEur: number
    unrealizedPnlEur: number
    totalPnlEur: number
    winRateClosed: number | null
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
const TRACKER_VERSION = 2
const PRINCIPAL_PER_TRADE_EUR = 1000
const MAX_CLOSED_TRADES = 200

function trackerKey(assetType: ForwardAssetType) {
  return `paper-forward:v${TRACKER_VERSION}:${assetType}`
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
  return getEquitySignalsByMode(origin, 'raw')
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

function createEmptyState(assetType: ForwardAssetType): ForwardTrackerState {
  const stamp = nowStamp()
  return {
    version: TRACKER_VERSION,
    assetType,
    principalPerTradeEur: PRINCIPAL_PER_TRADE_EUR,
    startedAt: stamp.iso,
    startedAtMs: stamp.ms,
    lastSyncAt: stamp.iso,
    lastSyncAtMs: stamp.ms,
    openPositions: {},
    closedTrades: [],
  }
}

function closePosition(
  position: PersistedOpenPosition,
  exitPrice: number,
  exitReason: ForwardExitReason,
  closedAtMs: number
): ForwardClosedTrade {
  const pnlEur =
    position.side === 'BUY'
      ? position.quantity * (exitPrice - position.entryPrice)
      : position.quantity * (position.entryPrice - exitPrice)
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
    pnlEur,
    returnPct: (pnlEur / Math.max(1, position.principalEur)) * 100,
    daysOpen: daysBetween(position.openedAtMs, closedAtMs),
    exitReason,
    sourceModeAtOpen: position.sourceModeAtOpen,
  }
}

function hydrateOpenPosition(position: PersistedOpenPosition, currentPrice: number, nowMs: number): ForwardOpenPosition {
  const pnlEur =
    position.side === 'BUY'
      ? position.quantity * (currentPrice - position.entryPrice)
      : position.quantity * (position.entryPrice - currentPrice)
  return {
    ...position,
    currentPrice,
    currentValueEur: position.principalEur + pnlEur,
    unrealizedPnlEur: pnlEur,
    unrealizedReturnPct: (pnlEur / Math.max(1, position.principalEur)) * 100,
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
    const premium = await fetchJson<{ signals?: { all?: PremiumSignal[] } }>(`${origin}/api/market/premium-active?targetWinrate=0.7&maxSignalsGlobal=160`)
    const fallbackSignals = (premium?.signals?.all || [])
      .map((row): ForwardSignal | null => {
        const market = String(row?.market || '').trim().toUpperCase()
        if (!market || market === 'CRYPTO') return null
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
  if (assetType === 'equity') return getEquitySignalsByMode(origin, preferredSourceMode)
  return getCryptoSignalsByMode(origin, preferredSourceMode)
}

export async function syncForwardTracker(
  req: NextApiRequest,
  assetType: ForwardAssetType,
  preferredSourceMode?: ForwardSourceMode
): Promise<ForwardTrackerResponse> {
  const origin = baseUrl(req)
  const key = trackerKey(assetType)
  const current = (await kvGetJSON<ForwardTrackerState>(key)) || createEmptyState(assetType)

  const { signals, sourceMode } = await getCurrentSignals(origin, assetType, preferredSourceMode)
  const signalMap = new Map<string, ForwardSignal>()
  for (const signal of signals) signalMap.set(signal.symbol, signal)

  const symbolsForPricing = [...new Set([...signals.map((s) => s.symbol), ...Object.keys(current.openPositions)])]
  const priceMap = await getCurrentPrices(origin, assetType, symbolsForPricing)
  const stamp = nowStamp()

  const nextState: ForwardTrackerState = {
    ...current,
    lastSyncAt: stamp.iso,
    lastSyncAtMs: stamp.ms,
    openPositions: { ...current.openPositions },
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

    if (!liveSignal) {
      if (currentPrice != null && currentPrice > 0) {
        nextState.closedTrades.unshift(closePosition(open, currentPrice, 'signal_removed', stamp.ms))
        delete nextState.openPositions[symbol]
      }
      continue
    }

    if (liveSignal.side !== open.side) {
      if (currentPrice != null && currentPrice > 0) {
        nextState.closedTrades.unshift(
          closePosition(open, currentPrice, liveSignal.side === 'BUY' ? 'flip_to_buy' : 'flip_to_sell', stamp.ms)
        )
        delete nextState.openPositions[symbol]
      }
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
  }

  if (nextState.closedTrades.length > MAX_CLOSED_TRADES) {
    nextState.closedTrades = nextState.closedTrades.slice(0, MAX_CLOSED_TRADES)
  }

  await kvSetJSON(key, nextState)

  const openPositions = Object.values(nextState.openPositions)
    .map((position) => hydrateOpenPosition(position, priceMap[position.symbol] ?? position.lastPrice, stamp.ms))
    .sort((a, b) => b.openedAtMs - a.openedAtMs)

  const closedTrades = [...nextState.closedTrades].sort((a, b) => b.closedAtMs - a.closedAtMs)
  const realizedPnlEur = closedTrades.reduce((sum, trade) => sum + trade.pnlEur, 0)
  const unrealizedPnlEur = openPositions.reduce((sum, position) => sum + position.unrealizedPnlEur, 0)
  const wins = closedTrades.filter((trade) => trade.pnlEur > 0).length

  return {
    meta: {
      assetType,
      startedAt: nextState.startedAt,
      lastSyncAt: nextState.lastSyncAt,
      principalPerTradeEur: nextState.principalPerTradeEur,
      sourceMode,
      currentSignals: signals.length,
      note: 'Forward-test start vanaf de eerste sync. Elke nieuwe BUY/SELL opent fictief een trade van €1000. Trades sluiten bij statusflip of wanneer het signaal verdwijnt.',
    },
    summary: {
      openTrades: openPositions.length,
      closedTrades: closedTrades.length,
      realizedPnlEur,
      unrealizedPnlEur,
      totalPnlEur: realizedPnlEur + unrealizedPnlEur,
      winRateClosed: closedTrades.length ? wins / closedTrades.length : null,
      totalCommittedEur: openPositions.length * nextState.principalPerTradeEur,
    },
    openPositions,
    closedTrades: closedTrades.slice(0, 20),
  }
}
