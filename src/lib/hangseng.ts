// src/lib/hangseng.ts
export type StockMeta = { symbol: string; name: string }

/**
 * Compacte startset (veelgebruikte HSI-leden). Breid gerust uit met meer .HK-tickers.
 * Let op: Yahoo/finance-achtige bronnen gebruiken vaak het suffix ".HK".
 */
export const HANGSENG: StockMeta[] = [
  { symbol: '0700.HK', name: 'Tencent' },
  { symbol: '9988.HK', name: 'Alibaba' },
  { symbol: '3690.HK', name: 'Meituan' },
  { symbol: '0005.HK', name: 'HSBC' },
  { symbol: '0388.HK', name: 'Hong Kong Exchanges' },
  { symbol: '0941.HK', name: 'China Mobile' },
  { symbol: '2318.HK', name: 'Ping An' },
  { symbol: '1211.HK', name: 'BYD' },
  { symbol: '0001.HK', name: 'CK Hutchison' },
  { symbol: '0669.HK', name: 'Techtronic Industries' },
  { symbol: '2388.HK', name: 'BOC Hong Kong' },
  { symbol: '0011.HK', name: 'Hang Seng Bank' },
  { symbol: '0836.HK', name: 'China Resources Power' },
  { symbol: '0883.HK', name: 'CNOOC' },
  { symbol: '1109.HK', name: 'China Resources Land' },
]