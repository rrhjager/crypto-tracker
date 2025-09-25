// src/lib/nikkei225.ts
export type StockMeta = { symbol: string; name: string }

/**
 * Compacte startlijst (Yahoo Finance suffix .T). Voeg gerust meer namen toe.
 * Voorbeeld: Toyota = 7203.T, Sony = 6758.T, Fast Retailing = 9983.T, etc.
 */
export const NIKKEI225: StockMeta[] = [
  { symbol: '9983.T', name: 'Fast Retailing' },
  { symbol: '8035.T', name: 'Tokyo Electron' },
  { symbol: '6861.T', name: 'Keyence' },
  { symbol: '7203.T', name: 'Toyota Motor' },
  { symbol: '9432.T', name: 'Nippon Telegraph & Telephone' },
  { symbol: '6954.T', name: 'Fanuc' },
  { symbol: '6758.T', name: 'Sony Group' },
  { symbol: '6098.T', name: 'Recruit Holdings' },
  { symbol: '9984.T', name: 'SoftBank Group' },
  { symbol: '8306.T', name: 'Mitsubishi UFJ Financial' },
  { symbol: '4502.T', name: 'Takeda Pharmaceutical' },
  { symbol: '6367.T', name: 'Daikin Industries' },
  { symbol: '6902.T', name: 'DENSO' },
  { symbol: '7735.T', name: 'SCREEN Holdings' },
  { symbol: '8058.T', name: 'Mitsubishi Corporation' },
  { symbol: '8001.T', name: 'Itochu' },
  { symbol: '8766.T', name: 'Tokio Marine' },
  { symbol: '4543.T', name: 'Terumo' },
  { symbol: '7751.T', name: 'Canon' },
  { symbol: '6971.T', name: 'Kyocera' },
]