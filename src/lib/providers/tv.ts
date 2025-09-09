// TV-like consensus zonder TradingView API.
// 7 indicatoren per TF (1h/4h/1d): EMA20, EMA50, SMA200, RSI14, Stoch(14,3), MACD(12,26,9), Bollinger(20,2).
// Signaal per indic: +1 BUY, 0 NEUTRAL, -1 SELL. Combineer TF's => score 0..1.

type Candle = [number, string, string, string, string, string, number, string, number, string, string, string];
type TF = "1h" | "4h" | "1d";

type OHLC = { o: number; h: number; l: number; c: number };

function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }

async function getOHLC(symbol: string, interval: TF, limit = 300): Promise<OHLC[]> {
  const url = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`Binance klines ${interval} ${r.status}`);
  const arr = (await r.json()) as Candle[];
  return arr.map(k => ({ o: Number(k[1]), h: Number(k[2]), l: Number(k[3]), c: Number(k[4]) }))
            .filter(x => isFinite(x.o) && isFinite(x.h) && isFinite(x.l) && isFinite(x.c));
}

// ---------- basic math ----------
function sma(values: number[], period: number): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out.push(sum / period);
  }
  return out;
}
function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (prev == null) {
      if (i >= period - 1) {
        const seed = values.slice(i - (period - 1), i + 1).reduce((a, b) => a + b, 0) / period;
        prev = seed;
        out.push(seed);
      }
    } else {
      const next = v * k + prev * (1 - k);
      out.push(next);
      prev = next;
    }
  }
  return out;
}
function stdev(values: number[]): number {
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, values.length - 1);
  return Math.sqrt(v);
}

// ---------- indicators ----------
function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function macd(values: number[], fast = 12, slow = 26, signal = 9): { hist: number } | null {
  if (values.length < slow + signal + 5) return null;
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const minLen = Math.min(emaFast.length, emaSlow.length);
  const diff: number[] = [];
  for (let i = 0; i < minLen; i++) diff.push(emaFast[emaFast.length - minLen + i] - emaSlow[emaSlow.length - minLen + i]);
  const sig = ema(diff, signal);
  if (!sig.length) return null;
  const hist = diff[diff.length - 1] - sig[sig.length - 1];
  return { hist };
}

function stochasticK(ohlc: OHLC[], period = 14, smoothK = 3): number | null {
  if (ohlc.length < period + smoothK) return null;
  const kRaw: number[] = [];
  for (let i = period - 1; i < ohlc.length; i++) {
    const slice = ohlc.slice(i - (period - 1), i + 1);
    const highs = slice.map(x => x.h), lows = slice.map(x => x.l);
    const highest = Math.max(...highs), lowest = Math.min(...lows);
    const c = ohlc[i].c;
    const denom = (highest - lowest);
    const k = denom === 0 ? 50 : ((c - lowest) / denom) * 100;
    kRaw.push(k);
  }
  // smooth K
  const kS = sma(kRaw, smoothK);
  return kS.length ? kS[kS.length - 1] : null;
}

function bollingerPos(values: number[], period = 20, mult = 2): number | null {
  if (values.length < period) return null;
  const closes = values.slice(-period);
  const m = closes.reduce((a, b) => a + b, 0) / period;
  const sd = stdev(closes);
  const upper = m + mult * sd;
  const lower = m - mult * sd;
  const p = values[values.length - 1];
  if (!isFinite(upper) || !isFinite(lower) || upper === lower) return null;
  // pos 0..1: 0=lower band, 0.5=middle, 1=upper
  return (p - lower) / (upper - lower);
}

// ---------- signals (-1,0,+1) ----------
function signFromPriceVs(ma: number | null | undefined, price: number): number {
  if (ma == null || !isFinite(ma)) return 0;
  // kleine marge om whipsaws te beperken (±0.2%)
  const diff = (price - ma) / ma;
  if (diff > 0.002) return +1;
  if (diff < -0.002) return -1;
  return 0;
}
function signRSI(rsiVal: number | null): number {
  if (rsiVal == null) return 0;
  if (rsiVal <= 30) return +1;       // oversold → buy
  if (rsiVal >= 70) return -1;       // overbought → sell
  if (rsiVal >= 45 && rsiVal <= 60) return +1; // lichte voorkeur bullish middenzone
  return 0;
}
function signStoch(k: number | null): number {
  if (k == null) return 0;
  if (k <= 20) return +1;
  if (k >= 80) return -1;
  return 0;
}
function signMACD(hist: number | null, closes: number[]): number {
  if (hist == null) return 0;
  // normaliseer op volatiliteit zodat het niet te “flat” is
  const recent = closes.slice(-50);
  const scale = stdev(recent) || (recent[recent.length - 1] * 0.01) || 1;
  const norm = hist / scale; // meestal -1..+1
  if (norm > 0.05) return +1;
  if (norm < -0.05) return -1;
  return 0;
}
function signBoll(pos: number | null): number {
  if (pos == null) return 0;
  if (pos <= 0.2) return +1;  // dicht bij lower band → koop
  if (pos >= 0.8) return -1;  // dicht bij upper band → verkoop
  return 0;
}

function consensusScore(countBuy: number, countNeutral: number, countSell: number): number {
  // Map naar 0..1, met neutraal midden. BUY > SELL → >0.5.
  const total = countBuy + countNeutral + countSell;
  if (total === 0) return 0.5;
  // -1 voor SELL, 0 voor NEUTRAL, +1 voor BUY → normaliseer
  const raw = (countBuy - countSell) / Math.max(1, (countBuy + countSell)); // -1..+1
  return 0.5 + 0.5 * raw; // 0..1
}

async function tfConsensus(symbol: string, tf: TF) {
  const ohlc = await getOHLC(symbol, tf, 300);
  if (ohlc.length < 210) return { score: 0.5, buy: 0, neutral: 7, sell: 0 };

  const closes = ohlc.map(x => x.c);
  const ema20 = ema(closes, 20).at(-1) ?? null;
  const ema50 = ema(closes, 50).at(-1) ?? null;
  const sma200 = sma(closes, 200).at(-1) ?? null;

  const rsi14 = rsi(closes, 14);
  const stochK = stochasticK(ohlc, 14, 3);
  const macdObj = macd(closes, 12, 26, 9);
  const bollPos = bollingerPos(closes, 20, 2);

  const p = closes[closes.length - 1];

  const sigs = [
    signFromPriceVs(ema20, p),
    signFromPriceVs(ema50, p),
    signFromPriceVs(sma200, p),
    signRSI(rsi14),
    signStoch(stochK),
    signMACD(macdObj?.hist ?? null, closes),
    signBoll(bollPos),
  ];

  const buy = sigs.filter(s => s === +1).length;
  const sell = sigs.filter(s => s === -1).length;
  const neutral = 7 - buy - sell;
  const score = consensusScore(buy, neutral, sell);
  return { score, buy, neutral, sell };
}

// Publiek: zelfde naam als voorheen zodat je niets hoeft te wijzigen
export async function tvSignalScore(symbolBinance?: string): Promise<number | null> {
  if (!symbolBinance) return null;
  try {
    const [h1, h4, d1] = await Promise.all([
      tfConsensus(symbolBinance, "1h"),
      tfConsensus(symbolBinance, "4h"),
      tfConsensus(symbolBinance, "1d"),
    ]);
    // 1h 40%, 4h 40%, 1d 20%
    const score = clamp01(0.4 * h1.score + 0.4 * h4.score + 0.2 * d1.score);
    return score;
  } catch {
    return null;
  }
}

// Optioneel: als je breakdown wilt loggen in debug
export async function tvConsensusBreakdown(symbolBinance: string) {
  const [h1, h4, d1] = await Promise.all([
    tfConsensus(symbolBinance, "1h"),
    tfConsensus(symbolBinance, "4h"),
    tfConsensus(symbolBinance, "1d"),
  ]);
  return { h1, h4, d1, total: clamp01(0.4 * h1.score + 0.4 * h4.score + 0.2 * d1.score) };
}