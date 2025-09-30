// src/lib/etfs.ts
export type ETFMeta = { symbol: string; name: string }

// Top 20 meest verhandelde brede US ETF's (liquide, goede dekking)
// NB: symbols zonder beurssuffix – je /api/quotes en indicatoren hanteren US tickers.
export const ETFS: ETFMeta[] = [
  { symbol: 'SPY',  name: 'SPDR S&P 500' },
  { symbol: 'IVV',  name: 'iShares Core S&P 500' },
  { symbol: 'VOO',  name: 'Vanguard S&P 500' },
  { symbol: 'QQQ',  name: 'Invesco QQQ Trust' },
  { symbol: 'VTI',  name: 'Vanguard Total Stock Market' },
  { symbol: 'IWM',  name: 'iShares Russell 2000' },
  { symbol: 'DIA',  name: 'SPDR Dow Jones Industrial Average' },
  { symbol: 'EEM',  name: 'iShares MSCI Emerging Markets' },
  { symbol: 'EFA',  name: 'iShares MSCI EAFE' },
  { symbol: 'XLK',  name: 'Technology Select Sector SPDR' },
  { symbol: 'XLF',  name: 'Financial Select Sector SPDR' },
  { symbol: 'XLE',  name: 'Energy Select Sector SPDR' },
  { symbol: 'XLV',  name: 'Health Care Select Sector SPDR' },
  { symbol: 'XLY',  name: 'Consumer Discretionary Select Sector SPDR' },
  { symbol: 'XLP',  name: 'Consumer Staples Select Sector SPDR' },
  { symbol: 'XLI',  name: 'Industrial Select Sector SPDR' },
  { symbol: 'XLU',  name: 'Utilities Select Sector SPDR' },
  { symbol: 'XLB',  name: 'Materials Select Sector SPDR' },
  { symbol: 'XLRE', name: 'Real Estate Select Sector SPDR' },
  { symbol: 'XLC',  name: 'Communication Services Select Sector SPDR' },
]