import { AEX } from '@/lib/aex'
import { DAX } from '@/lib/dax'
import { DOWJONES } from '@/lib/dowjones'
import { ETFS } from '@/lib/etfs'
import { FTSE100 } from '@/lib/ftse100'
import { HANGSENG } from '@/lib/hangseng'
import { NASDAQ } from '@/lib/nasdaq'
import { NIKKEI225 } from '@/lib/nikkei225'
import { SENSEX } from '@/lib/sensex'
import { SP500 } from '@/lib/sp500'
import { normalizeScoreMarket, type ScoreMarket } from '@/lib/taScore'

const MARKET_LISTS: Array<{ market: ScoreMarket; list: Array<{ symbol: string }> }> = [
  { market: 'AEX', list: AEX },
  { market: 'DAX', list: DAX },
  { market: 'DOWJONES', list: DOWJONES },
  { market: 'ETFS', list: ETFS },
  { market: 'FTSE100', list: FTSE100 },
  { market: 'HANGSENG', list: HANGSENG },
  { market: 'NASDAQ', list: NASDAQ },
  { market: 'NIKKEI225', list: NIKKEI225 },
  { market: 'SENSEX', list: SENSEX },
  { market: 'SP500', list: SP500 },
]

const SYMBOL_MARKETS = (() => {
  const out = new Map<string, Set<ScoreMarket>>()
  for (const { market, list } of MARKET_LISTS) {
    for (const item of list) {
      const sym = String(item.symbol || '').toUpperCase().trim()
      if (!sym) continue
      if (!out.has(sym)) out.set(sym, new Set<ScoreMarket>())
      out.get(sym)!.add(market)
    }
  }
  return out
})()

function detectBySuffix(sym: string): ScoreMarket | null {
  if (!sym) return null
  if (sym.endsWith('-USD') || sym.endsWith('USDT')) return 'CRYPTO'
  if (sym.endsWith('.AS') || sym.endsWith('.BR')) return 'AEX'
  if (sym.endsWith('.HK')) return 'HANGSENG'
  if (sym.endsWith('.L')) return 'FTSE100'
  if (sym.endsWith('.NS') || sym.endsWith('.BO')) return 'SENSEX'
  if (sym.endsWith('.T')) return 'NIKKEI225'
  return null
}

export function detectScoreMarketForSymbol(symbol?: string | null): ScoreMarket | null {
  const sym = String(symbol || '').toUpperCase().trim()
  if (!sym) return null

  const suffixMarket = detectBySuffix(sym)
  if (suffixMarket) return suffixMarket

  const markets = SYMBOL_MARKETS.get(sym)
  if (!markets || !markets.size) return null
  if (markets.size === 1) return Array.from(markets)[0]

  // Ambigu (bv. tickers die in meerdere lijsten staan): laat caller kiezen.
  return null
}

export function resolveScoreMarket(
  preferredMarket?: string | ScoreMarket | null,
  symbol?: string | null,
  fallback: ScoreMarket = 'DEFAULT'
): ScoreMarket {
  return normalizeScoreMarket(preferredMarket) || detectScoreMarketForSymbol(symbol) || fallback
}
