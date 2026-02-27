export type HCMarketKey =
  | 'AEX'
  | 'DAX'
  | 'DOWJONES'
  | 'ETFS'
  | 'FTSE100'
  | 'HANGSENG'
  | 'NASDAQ'
  | 'NIKKEI225'
  | 'SENSEX'
  | 'SP500'
  | 'CRYPTO'

export type HCHorizon = 'd7' | 'd30' | 'untilNext'

export type HCRecommendation = {
  horizon: HCHorizon
  cutoff: number
  trades: number
  coverage: number
  winrate: number
  avgReturnPct: number
  medianReturnPct: number
  profitFactor: number | null
  meetsTarget: boolean
}

export type HCHorizonBest = {
  cutoff: number
  trades: number
  coverage: number
  winrate: number
  avgReturnPct: number
  medianReturnPct: number
  profitFactor: number | null
  meetsTarget: boolean
}

export type HCHorizonResult = {
  horizon: HCHorizon
  totalEligible: number
  minTrades: number
  best: HCHorizonBest | null
}

export type HCMarketResult = {
  market: HCMarketKey
  recommendation: HCRecommendation | null
  horizons: HCHorizonResult[]
}

export type HCResponse = {
  meta: {
    generatedAt: string
    targetWinrate: number
    minCoverage: number
    minTradesBase: number
    note: string
  }
  summary: {
    markets: number
    marketsWithRecommendation: number
    marketsMeetingTarget: number
    avgWinrate: number
    avgReturnPct: number
    avgCoverage: number
  }
  markets: HCMarketResult[]
}

export const HC_MARKET_META: Record<HCMarketKey, { label: string; href: string }> = {
  AEX: { label: 'AEX', href: '/aex' },
  DAX: { label: 'DAX', href: '/dax' },
  DOWJONES: { label: 'Dow Jones', href: '/dowjones' },
  ETFS: { label: 'ETFs', href: '/etfs' },
  FTSE100: { label: 'FTSE 100', href: '/ftse100' },
  HANGSENG: { label: 'Hang Seng', href: '/hangseng' },
  NASDAQ: { label: 'NASDAQ', href: '/nasdaq' },
  NIKKEI225: { label: 'Nikkei 225', href: '/nikkei225' },
  SENSEX: { label: 'Sensex', href: '/sensex' },
  SP500: { label: 'S&P 500', href: '/sp500' },
  CRYPTO: { label: 'Crypto', href: '/crypto' },
}

export const HC_MARKET_ORDER: HCMarketKey[] = [
  'AEX',
  'DAX',
  'DOWJONES',
  'ETFS',
  'FTSE100',
  'HANGSENG',
  'NASDAQ',
  'NIKKEI225',
  'SENSEX',
  'SP500',
  'CRYPTO',
]

export function horizonLabel(h: HCHorizon) {
  if (h === 'd7') return '7 dagen'
  if (h === 'd30') return '30 dagen'
  return 'Tot next signal'
}
