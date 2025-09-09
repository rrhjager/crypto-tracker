export type ExchangePrices = {
  binance?: number | null;
  coinbase?: number | null;
  kraken?: number | null;
  okx?: number | null;
  kucoin?: number | null;
  bybit?: number | null;
};

async function getJSON(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

async function getBinancePrice(symbol: string | undefined) {
  if (!symbol) return null;
  try {
    const j = await getJSON(`https://data-api.binance.vision/api/v3/ticker/price?symbol=${symbol}`);
    const v = Number(j?.price);
    return isFinite(v) ? v : null;
  } catch { return null; }
}
async function getCoinbasePrice(pair?: string) {
  if (!pair) return null;
  try {
    const j = await getJSON(`https://api.coinbase.com/v2/prices/${pair}/spot`);
    const v = Number(j?.data?.amount ?? j?.amount);
    return isFinite(v) ? v : null;
  } catch { return null; }
}
async function getKrakenPrice(pair?: string) {
  if (!pair) return null;
  try {
    const j = await getJSON(`https://api.kraken.com/0/public/Ticker?pair=${pair}`);
    const k = Object.keys(j?.result || {})[0];
    const v = Number(j?.result?.[k]?.c?.[0]);
    return isFinite(v) ? v : null;
  } catch { return null; }
}
// OKX: instId bv. BTC-USDT
async function getOkxPrice(instId: string | undefined) {
  if (!instId) return null;
  try {
    const j = await getJSON(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`);
    const v = Number(j?.data?.[0]?.last);
    return isFinite(v) ? v : null;
  } catch { return null; }
}
// KuCoin: symbol bv. BTC-USDT
async function getKucoinPrice(symbol: string | undefined) {
  if (!symbol) return null;
  try {
    const j = await getJSON(`https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${symbol}`);
    const v = Number(j?.data?.price);
    return isFinite(v) ? v : null;
  } catch { return null; }
}
// Bybit (spot): symbol bv. BTCUSDT
async function getBybitPrice(symbol: string | undefined) {
  if (!symbol) return null;
  try {
    const j = await getJSON(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`);
    const v = Number(j?.result?.list?.[0]?.lastPrice);
    return isFinite(v) ? v : null;
  } catch { return null; }
}

function toOkx(symbolBinance?: string) {
  // BTCUSDT -> BTC-USDT
  return symbolBinance ? symbolBinance.replace("USDT", "-USDT") : undefined;
}
function toKucoin(symbolBinance?: string) {
  // BTCUSDT -> BTC-USDT
  return symbolBinance ? symbolBinance.replace("USDT", "-USDT") : undefined;
}

export async function fetchExchangePrices(map:{binance?:string, coinbase?:string, kraken?:string}): Promise<ExchangePrices> {
  const [b, c, k, o, u, y] = await Promise.all([
    getBinancePrice(map.binance),
    getCoinbasePrice(map.coinbase),
    getKrakenPrice(map.kraken),
    getOkxPrice(toOkx(map.binance)),
    getKucoinPrice(toKucoin(map.binance)),
    getBybitPrice(map.binance),
  ]);
  return { binance: b, coinbase: c, kraken: k, okx: o, kucoin: u, bybit: y };
}

// Soepelere schaal + gebruik min. 2 bronnen -> score 0..1
export function arbitrageScore(prices: ExchangePrices): { score: number | null, spread: number } {
  const vals = Object.values(prices).filter((v): v is number => typeof v === "number" && isFinite(v));
  if (vals.length < 2) return { score: null, spread: 0 };
  const min = Math.min(...vals), max = Math.max(...vals);
  const spread = (max - min) / ((max + min) / 2); // relatieve spread
  // schaal: 0 bij 0.02% spread, 1 bij 0.5%+
  const lo = 0.0002, hi = 0.005;
  const score = Math.max(0, Math.min(1, (spread - lo) / (hi - lo)));
  return { score, spread };
}

// Binance perf fallback blijft hetzelfde
export async function binanceChangeDays(symbol: string, days: number): Promise<number> {
  try {
    const limit = days + 1;
    const r = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=1d&limit=${limit}`);
    if (!r.ok) return 0;
    const arr = await r.json();
    if (!Array.isArray(arr) || arr.length < 2) return 0;
    const f = Number(arr[0][4]), l = Number(arr[arr.length - 1][4]);
    if (!f || !l) return 0;
    return ((l - f) / f) * 100;
  } catch { return 0; }
}
export async function binancePerf(symbol: string) {
  const [d1, d7, d30] = await Promise.all([
    binanceChangeDays(symbol, 1),
    binanceChangeDays(symbol, 7),
    binanceChangeDays(symbol, 30),
  ]);
  return { d: d1, w: d7, m: d30 };
}