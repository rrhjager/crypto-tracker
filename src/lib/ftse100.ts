// src/lib/ftse100.ts
export type StockMeta = { symbol: string; name: string }

/**
 * FTSE 100 (korte set — breid gerust uit).
 * Let op: London Stock Exchange symbols gebruiken de suffix ".L".
 */
export const FTSE100: StockMeta[] = [
  { symbol: 'AZN.L',   name: 'AstraZeneca' },
  { symbol: 'HSBA.L',  name: 'HSBC' },
  { symbol: 'BP.L',    name: 'BP' },
  { symbol: 'SHEL.L',  name: 'Shell (UK)' },
  { symbol: 'ULVR.L',  name: 'Unilever' },
  { symbol: 'GSK.L',   name: 'GSK' },
  { symbol: 'DGE.L',   name: 'Diageo' },
  { symbol: 'BATS.L',  name: 'BAT' },
  { symbol: 'BARC.L',  name: 'Barclays' },
  { symbol: 'VOD.L',   name: 'Vodafone' },
  { symbol: 'LLOY.L',  name: 'Lloyds Banking' },
  { symbol: 'RIO.L',   name: 'Rio Tinto' },
  { symbol: 'GLEN.L',  name: 'Glencore' },
  { symbol: 'REL.L',   name: 'RELX' },
  { symbol: 'NG.L',    name: 'National Grid' },
  { symbol: 'SSE.L',   name: 'SSE' },
  { symbol: 'BT-A.L',  name: 'BT Group' },
  { symbol: 'RKT.L',   name: 'Reckitt' },
  { symbol: 'BDEV.L',  name: 'Barratt Developments' },
  { symbol: 'PSN.L',   name: 'Persimmon' },
]