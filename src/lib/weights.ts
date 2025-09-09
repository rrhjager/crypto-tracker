// lib/weights.ts
export const WEIGHTS = {
  tvSignal: 0.22,          // TradingView-achtig
  momentum: 0.22,          // RSI / MACD / MA-stack
  volumeTrend: 0.12,       // NIEUW: Volume-trend
  volatilityRegime: 0.10,  // lage vol = gunstig
  funding: 0.08,           // Binance Futures funding
  openInterest: 0.08,      // Binance Futures OI
  longShortSkew: 0.06,     // global long/short ratio
  yield: 0.06,             // DeFi yield
  breadth: 0.04,           // marktbredte
  fearGreed: 0.02,         // algemene crypto sentiment
} as const;