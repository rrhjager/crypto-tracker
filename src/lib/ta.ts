// src/lib/ta.ts

/** Simple Moving Average */
export function sma(values: number[], period: number): number[] {
    const out: number[] = []
    let sum = 0
    for (let i = 0; i < values.length; i++) {
      const v = Number(values[i])
      sum += v
      if (i >= period) sum -= Number(values[i - period])
      out.push(i >= period - 1 ? sum / period : NaN)
    }
    return out
  }
  
  /** RSI (Wilder), default period 14 */
  export function rsi(values: number[], period = 14): number[] {
    const out: number[] = new Array(values.length).fill(NaN)
    if (!Array.isArray(values) || values.length < period + 1) return out
  
    // Deltas
    const deltas: number[] = []
    for (let i = 1; i < values.length; i++) {
      const cur = Number(values[i])
      const prev = Number(values[i - 1])
      deltas.push(cur - prev)
    }
  
    // Eerste gemiddelde gain/loss
    let gainSum = 0, lossSum = 0
    for (let i = 0; i < period; i++) {
      const d = deltas[i]
      if (d >= 0) gainSum += d
      else lossSum += -d
    }
    let avgGain = gainSum / period
    let avgLoss = lossSum / period
  
    // Eerste RSI-waarde (op index = period)
    let rs = avgLoss === 0 ? Infinity : avgGain / avgLoss
    out[period] = 100 - (100 / (1 + rs))
  
    // Wilder smoothing
    for (let i = period + 1; i < values.length; i++) {
      const d = deltas[i - 1]
      const gain = d > 0 ? d : 0
      const loss = d < 0 ? -d : 0
  
      avgGain = (avgGain * (period - 1) + gain) / period
      avgLoss = (avgLoss * (period - 1) + loss) / period
      rs = avgLoss === 0 ? Infinity : avgGain / avgLoss
      out[i] = 100 - (100 / (1 + rs))
    }
    return out
  }
  
  /** Exponential Moving Average — NaN-proof (seed op eerste geldige waarde) */
  export function ema(values: number[], period: number): number[] {
    const out: number[] = new Array(values.length).fill(NaN)
    if (!Array.isArray(values) || values.length === 0 || period <= 0) return out
  
    const k = 2 / (period + 1)
    let prev: number | undefined = undefined
  
    for (let i = 0; i < values.length; i++) {
      const v = Number(values[i])
      if (!Number.isFinite(v)) continue
  
      if (prev === undefined) {
        // Seed op de eerste geldige close, niet op 0
        prev = v
        out[i] = v
      } else {
        prev = v * k + prev * (1 - k)
        out[i] = prev
      }
    }
    return out
  }
  
  /** MACD (12/26/9 default) */
  export function macd(
    values: number[],
    fast = 12,
    slow = 26,
    signalPeriod = 9
  ): { macd: number[]; signal: number[]; hist: number[] } {
    const emaFast = ema(values, fast)
    const emaSlow = ema(values, slow)
  
    const macdLine = values.map((_, i) =>
      Number.isFinite(emaFast[i]) && Number.isFinite(emaSlow[i])
        ? (emaFast[i] as number) - (emaSlow[i] as number)
        : NaN
    )
  
    const signal = ema(macdLine, signalPeriod)
  
    const hist = macdLine.map((v, i) =>
      Number.isFinite(v) && Number.isFinite(signal[i])
        ? (v as number) - (signal[i] as number)
        : NaN
    )
  
    return { macd: macdLine, signal, hist }
  }