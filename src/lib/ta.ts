// src/lib/ta.ts

/** Simple moving average of the last `len` values (inclusive of most-recent). */
function sma(series: number[], len: number): number | null {
  if (!Array.isArray(series) || series.length < len || len <= 0) return null;
  let sum = 0;
  for (let i = series.length - len; i < series.length; i++) sum += series[i];
  return sum / len;
}

/** Exponential moving average (Wilder/EMA) over the whole series; returns the *last* value. */
function emaLast(series: number[], len: number): number | null {
  if (!Array.isArray(series) || series.length === 0 || len <= 0) return null;
  const k = 2 / (len + 1);
  let ema: number | null = null;

  // Seed with SMA of first `len` points when possible, else first value
  if (series.length >= len) {
    let seed = 0;
    for (let i = 0; i < len; i++) seed += series[i];
    ema = seed / len;
    for (let i = len; i < series.length; i++) {
      ema = series[i] * k + (ema as number) * (1 - k);
    }
  } else {
    ema = series[0];
    for (let i = 1; i < series.length; i++) {
      ema = series[i] * k + (ema as number) * (1 - k);
    }
  }
  return typeof ema === 'number' && Number.isFinite(ema) ? ema : null;
}

/** ===== MA Cross (50/200 by default) ===== */
export function maCross(
  closes: number[],
  shortLen = 50,
  longLen = 200
): { ma50: number | null; ma200: number | null; status?: 'BUY' | 'SELL' | 'HOLD'; points?: number | null } {
  const maShort = sma(closes, shortLen);
  const maLong = sma(closes, longLen);

  let status: 'BUY' | 'SELL' | 'HOLD' | undefined;
  if (maShort != null && maLong != null) {
    if (maShort > maLong) status = 'BUY';
    else if (maShort < maLong) status = 'SELL';
    else status = 'HOLD';
  }

  return {
    ma50: shortLen === 50 ? maShort : null,
    ma200: longLen === 200 ? maLong : null,
    status,
    points: undefined,
  };
}

/** ===== RSI (Wilder’s) ===== */
export function rsi(
  closes: number[],
  period = 14
): { rsi: number | null; status?: 'BUY' | 'SELL' | 'HOLD'; points?: number | null } {
  if (!Array.isArray(closes) || closes.length < period + 1) {
    return { rsi: null };
  }
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(Math.max(0, diff));
    losses.push(Math.max(0, -diff));
  }

  // Initial averages
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    avgGain += gains[i];
    avgLoss += losses[i];
  }
  avgGain /= period;
  avgLoss /= period;

  // Wilder smoothing across the rest
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }

  const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
  const value = 100 - 100 / (1 + rs);
  let status: 'BUY' | 'SELL' | 'HOLD' | undefined;
  if (Number.isFinite(value)) {
    if (value <= 30) status = 'BUY';
    else if (value >= 70) status = 'SELL';
    else status = 'HOLD';
  }

  return { rsi: Number.isFinite(value) ? value : null, status, points: undefined };
}

/** ===== MACD (EMA 12/26, signal 9) ===== */
export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9
): {
  macd: number | null;
  signal: number | null;
  hist: number | null;
  status?: 'BUY' | 'SELL' | 'HOLD';
  points?: number | null;
} {
  if (!Array.isArray(closes) || closes.length < Math.max(fast, slow) + signalPeriod) {
    return { macd: null, signal: null, hist: null };
  }

  // Build full EMA series (needed for signal EMA over MACD line)
  const kFast = 2 / (fast + 1);
  const kSlow = 2 / (slow + 1);

  const emaFastSeries: number[] = [];
  const emaSlowSeries: number[] = [];

  // Seed EMAs with SMA of first len points when possible
  const seed = (len: number) => {
    if (closes.length >= len) {
      let s = 0;
      for (let i = 0; i < len; i++) s += closes[i];
      return s / len;
    }
    return closes[0];
  };

  let emaF = seed(fast);
  let emaS = seed(slow);
  emaFastSeries.push(emaF);
  emaSlowSeries.push(emaS);

  for (let i = 1; i < closes.length; i++) {
    emaF = closes[i] * kFast + emaF * (1 - kFast);
    emaS = closes[i] * kSlow + emaS * (1 - kSlow);
    emaFastSeries.push(emaF);
    emaSlowSeries.push(emaS);
  }

  const macdLine: number[] = new Array(closes.length);
  for (let i = 0; i < closes.length; i++) macdLine[i] = emaFastSeries[i] - emaSlowSeries[i];

  const signalLast = emaLast(macdLine.slice(-Math.max(slow + signalPeriod, 1)), signalPeriod);
  const macdLast = macdLine[macdLine.length - 1];
  const hist = signalLast != null && Number.isFinite(macdLast) ? macdLast - signalLast : null;

  let status: 'BUY' | 'SELL' | 'HOLD' | undefined;
  if (hist != null) {
    status = hist > 0 ? 'BUY' : hist < 0 ? 'SELL' : 'HOLD';
  }

  return {
    macd: Number.isFinite(macdLast) ? macdLast : null,
    signal: signalLast ?? null,
    hist,
    status,
    points: undefined,
  };
}

/** ===== Volume 20-day ratio (last volume vs 20d SMA) ===== */
export function vol20(
  volumes: (number | null | undefined)[],
  period = 20
): { volume: number | null; avg20: number | null; ratio: number | null; status?: 'BUY' | 'SELL' | 'HOLD'; points?: number | null } {
  if (!Array.isArray(volumes) || volumes.length < period) {
    return { volume: null, avg20: null, ratio: null };
  }
  // Normalize: ensure numeric, drop nulls by treating as 0
  const norm = volumes.map(v => (typeof v === 'number' && Number.isFinite(v) ? v : 0));

  const last = norm[norm.length - 1];
  const avg = sma(norm, period);

  const ratio = avg && avg > 0 ? last / avg : null;
  let status: 'BUY' | 'SELL' | 'HOLD' | undefined;
  if (ratio != null) {
    if (ratio >= 1.2) status = 'BUY';
    else if (ratio <= 0.8) status = 'SELL';
    else status = 'HOLD';
  }

  return { volume: Number.isFinite(last) ? last : null, avg20: avg, ratio, status, points: undefined };
}