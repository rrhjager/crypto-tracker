import type { HCAssetAdvice, HCMarketKey, HCHorizon } from '@/lib/highConfidence'

export type PremiumValidation = {
  trades: number
  winrate: number
  avgReturnPct: number
  medianReturnPct: number
  profitFactor: number | null
  buyCount: number
  sellCount: number
  meetsTarget: boolean
}

export type PremiumMarket = {
  market: HCMarketKey
  recommendation: {
    horizon: HCHorizon
    cutoff: number
    trades: number
    coverage: number
    winrate: number
    avgReturnPct: number
    medianReturnPct: number
    profitFactor: number | null
    meetsTarget: boolean
  } | null
  validation: PremiumValidation
  passed: boolean
  currentSignals: number
}

export type PremiumSignal = HCAssetAdvice & {
  action: 'BUY NOW' | 'SELL / EXIT'
  validationWinrate: number
  validationReturnPct: number
  validationTrades: number
}

export type PremiumActiveResponse = {
  meta: {
    generatedAt: string
    targetWinrate: number
    minValidationTrades: number
    note: string
  }
  summary: {
    validatedMarkets: number
    liveSignals: number
    buySignals: number
    sellSignals: number
  }
  markets: PremiumMarket[]
  signals: {
    all: PremiumSignal[]
    buy: PremiumSignal[]
    sell: PremiumSignal[]
    byMarket: Record<HCMarketKey, PremiumSignal[]>
  }
}
