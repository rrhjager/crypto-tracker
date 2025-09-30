// src/lib/etfs.ts
export type EtfMeta = { symbol: string; name: string }

export const ETFS: EtfMeta[] = [
  { symbol: 'SPY',  name: 'SPDR S&P 500 ETF Trust' },
  { symbol: 'IVV',  name: 'iShares Core S&P 500' },
  { symbol: 'VOO',  name: 'Vanguard S&P 500' },
  { symbol: 'QQQ',  name: 'Invesco QQQ Trust' },
  { symbol: 'VTI',  name: 'Vanguard Total Stock Market' },
  { symbol: 'VEA',  name: 'Vanguard FTSE Developed Markets' },
  { symbol: 'VWO',  name: 'Vanguard FTSE Emerging Markets' },
  { symbol: 'IEMG', name: 'iShares Core MSCI EM' },
  { symbol: 'AGG',  name: 'iShares Core U.S. Aggregate Bond' },
  { symbol: 'BND',  name: 'Vanguard Total Bond Market' },
  { symbol: 'IWM',  name: 'iShares Russell 2000' },
  { symbol: 'GLD',  name: 'SPDR Gold Shares' },
  { symbol: 'VNQ',  name: 'Vanguard Real Estate' },
  { symbol: 'LQD',  name: 'iShares iBoxx $ Inv Grade Corp Bond' },
  { symbol: 'HYG',  name: 'iShares iBoxx $ High Yield Corp Bond' },
  { symbol: 'XLF',  name: 'Financial Select Sector SPDR' },
  { symbol: 'XLK',  name: 'Technology Select Sector SPDR' },
  { symbol: 'XLY',  name: 'Consumer Discretionary Select SPDR' },
  { symbol: 'XLP',  name: 'Consumer Staples Select SPDR' },
  { symbol: 'XLV',  name: 'Health Care Select Sector SPDR' },
]