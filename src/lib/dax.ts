// src/lib/dax.ts
export type StockMeta = { symbol: string; name: string }

/**
 * DAX40 voorbeeldset (voeg er gerust meer aan toe of pas namen aan je datasource aan).
 * Symbolen zijn doorgaans XETRA tickers.
 */
export const DAX: StockMeta[] = [
  { symbol: 'SAP',    name: 'SAP' },
  { symbol: 'SIE',    name: 'Siemens' },
  { symbol: 'ALV',    name: 'Allianz' },
  { symbol: 'DTE',    name: 'Deutsche Telekom' },
  { symbol: 'BAS',    name: 'BASF' },
  { symbol: 'BAYN',   name: 'Bayer' },
  { symbol: 'BMW',    name: 'BMW' },
  { symbol: 'MBG',    name: 'Mercedes-Benz Group' },
  { symbol: 'VOW3',   name: 'Volkswagen (Pref)' },
  { symbol: 'ADS',    name: 'adidas' },
  { symbol: 'MUV2',   name: 'Munich Re' },
  { symbol: 'AIR',    name: 'Airbus' },
  { symbol: 'RWE',    name: 'RWE' },
  { symbol: 'EOAN',   name: 'E.ON' },
  { symbol: 'DPW',    name: 'Deutsche Post (DHL)' },
  { symbol: 'DTG',    name: 'Delivery Hero' },
  { symbol: 'FME',    name: 'Fresenius Medical Care' },
  { symbol: 'FRE',    name: 'Fresenius' },
  { symbol: 'HEI',    name: 'Heidelberg Materials' },
  { symbol: 'HEN3',   name: 'Henkel (Pref)' },
  { symbol: 'LIN',    name: 'Linde' },
  { symbol: 'PUM',    name: 'Puma' },
  { symbol: 'QIA',    name: 'Qiagen' },
  { symbol: 'SHL',    name: 'Siemens Healthineers' },
  { symbol: 'ZAL',    name: 'Zalando' },
  { symbol: 'BEI',    name: 'Beiersdorf' },
  { symbol: 'CON',    name: 'Continental' },
  { symbol: 'HNR1',   name: 'Hannover Rück' },
  { symbol: 'SRT3',   name: 'Sartorius (Pref)' },
  { symbol: 'SY1',    name: 'Symrise' },
  { symbol: '1COV',   name: 'Covestro' },
  { symbol: 'MTX',    name: 'MTU Aero Engines' },
  { symbol: 'MRK',    name: 'Merck KGaA' },
  { symbol: 'IFX',    name: 'Infineon' },
  { symbol: 'DBK',    name: 'Deutsche Bank' },
  { symbol: 'HFG',    name: 'HelloFresh' },
  { symbol: 'BNR',    name: 'Brenntag' },
  { symbol: 'ENR',    name: 'Siemens Energy' },
  { symbol: 'MBGAF',  name: 'Mercedes-Benz (Alt)' },
  { symbol: 'PAH3',   name: 'Porsche Automobil (Pref)' },
]