// Pure JS helpers op closes[] (laatste → meest recent)

// Nieuwe, smooth momentum:
// - RSI rond 50 gecentreerd (40→0, 60→1)
// - MACD via histogram sterkte (genormaliseerd op eigen vol), geen binaire 0/1
// - MA-afstand met tolerantieband (±2%) i.p.v. hard boven/onder
export function momentumScoreFromCloses(closes: number[]): number {
    if (!closes || closes.length < 60) return 0.5;
  
    const rsi = rsi14(closes);
    const ma20 = sma(closes, 20), ma50 = sma(closes, 50), ma200 = sma(closes, 200);
    const last = closes[closes.length - 1];
  
    // 1) RSI: centreer rond 50 → sneller zichtbaar bij licht bullish
    // 40→0, 60→1, buiten [30,70] geclamped
    const rsiScore = clamp01((rsi - 40) / 20);
  
    // 2) MACD histogram continuous (genormaliseerd op recente histogram-vol)
    const histNow = macdHistogram(closes);
    const histSeries = macdHistogramSeries(closes, 120);
    const histVol = Math.max(1e-8, stddev(histSeries.slice(-60))); // stabiliseer
    const macdScore = 0.5 + 0.5 * Math.tanh(histNow / (3 * histVol));
  
    // 3) MA’s: afstand t.o.v. MA met ±2% band → 0..1
    const band = 0.02;
    function distScore(p: number, ma: number) {
      if (!Number.isFinite(ma) || ma <= 0) return 0.5;
      const d = (p - ma) / ma;                // relatieve afstand
      const n = Math.max(-1, Math.min(1, d / band));
      return 0.5 + 0.5 * n;                   // -band→0, 0→0.5, +band→1
    }
    const ma20Score = distScore(last, ma20);
    const ma50Score = distScore(last, ma50);
    const ma200Score = distScore(last, ma200);
    const maScore = (ma20Score + ma50Score + ma200Score) / 3;
  
    // 4) Mix (RSI 35%, MA 35%, MACD 30%)
    const score = 0.35 * rsiScore + 0.35 * maScore + 0.30 * macdScore;
  
    return clamp01(score);
  }
  
  // Blijft bestaan (niet vereist door refresh.ts, maar veilig te laten staan)
  export function volatilityRegimeFromCloses(closes: number[]): number {
    if (!closes || closes.length < 60) return 0.5;
    // 30d realized vol (std dev van ln-returns) → lagere vol = hogere score
    const rets: number[] = [];
    for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
    const last30 = rets.slice(-24 * 30).filter(Number.isFinite);
    const vol = stddev(last30);
    // Typical crypto ~ 0.01–0.1 per 1h-ln-ret std → map: low vol (0.01)→1, high vol (0.1)→0
    const v = 1 - clamp01((vol - 0.01) / (0.1 - 0.01));
    return v;
  }
  
  // ── helpers ───────────────────────────────────────────────────────────────────
  function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }
  
  function sma(arr: number[], n: number): number {
    if (arr.length < n) return arr[arr.length - 1] ?? NaN;
    let s = 0; for (let i = arr.length - n; i < arr.length; i++) s += arr[i];
    return s / n;
  }
  
  function ema(arr: number[], n: number): number {
    const k = 2 / (n + 1);
    let e = arr[0];
    for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
    return e;
  }
  
  function rsi14(closes: number[]): number {
    const n = 14;
    if (closes.length <= n) return 50;
    let gains = 0, losses = 0;
    for (let i = closes.length - n; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      if (d >= 0) gains += d; else losses -= d;
    }
    const avgG = gains / n, avgL = losses / n;
    const rs = avgL === 0 ? 100 : avgG / avgL;
    const rsi = 100 - (100 / (1 + rs));
    return Math.max(0, Math.min(100, rsi));
  }
  
  function macdLine(closes: number[]): number {
    const src = closes.slice(-200);
    const ema12 = ema(src, 12);
    const ema26 = ema(src, 26);
    return ema12 - ema26;
  }
  
  function signalLine(closes: number[]): number {
    const arr = closes.slice(-200);
    // quick & simple; approximate MACD EMA9
    const macdVals: number[] = [];
    for (let i = 26; i < arr.length; i++) {
      const p = arr.slice(0, i + 1);
      macdVals.push(macdLine(p));
    }
    if (macdVals.length < 9) return 0;
    return ema(macdVals, 9);
  }
  
  // MACD histogram (laatste) + serie voor vol-normalisatie
  function macdHistogram(closes: number[]): number {
    return macdLine(closes) - signalLine(closes);
  }
  function macdHistogramSeries(closes: number[], lookback = 200): number[] {
    const src = closes.slice(-Math.max(60, lookback));
    const out: number[] = [];
    for (let i = 35; i < src.length; i++) {
      const slice = src.slice(0, i + 1);
      out.push(macdHistogram(slice));
    }
    return out.length ? out : [0];
  }
  
  function stddev(a: number[]): number {
    if (!a.length) return 0;
    const m = a.reduce((s, x) => s + x, 0) / a.length;
    const v = a.reduce((s, x) => s + (x - m) * (x - m), 0) / a.length;
    return Math.sqrt(v);
  }