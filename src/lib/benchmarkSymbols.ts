import type { ScoreMarket } from '@/lib/taScore'

type BenchmarkSpec = {
  kind: 'crypto' | 'equity'
  symbol: string
}

const BENCHMARKS: Partial<Record<ScoreMarket, BenchmarkSpec>> = {
  CRYPTO: { kind: 'crypto', symbol: 'BTCUSDT' },
  AEX: { kind: 'equity', symbol: '^AEX' },
  DAX: { kind: 'equity', symbol: '^GDAXI' },
  DOWJONES: { kind: 'equity', symbol: '^DJI' },
  ETFS: { kind: 'equity', symbol: 'SPY' },
  FTSE100: { kind: 'equity', symbol: '^FTSE' },
  HANGSENG: { kind: 'equity', symbol: '^HSI' },
  NASDAQ: { kind: 'equity', symbol: '^IXIC' },
  NIKKEI225: { kind: 'equity', symbol: '^N225' },
  SENSEX: { kind: 'equity', symbol: '^BSESN' },
  SP500: { kind: 'equity', symbol: '^GSPC' },
  DEFAULT: { kind: 'equity', symbol: 'SPY' },
}

export function getBenchmarkSpec(market: ScoreMarket): BenchmarkSpec | null {
  return BENCHMARKS[market] ?? null
}
