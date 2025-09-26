// src/lib/ta-light.ts
export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number }

export function sma(values: number[], period: number) {
  if (values.length < period) return null
  let sum = 0
  for (let i = values.length - period; i < values.length; i++) sum += values[i]
  return sum / period
}

export function ema(values: number[], period: number) {
  if (values.length < period) return null
  const k = 2 / (period + 1)
  let prev = 0
  for (let i = 0; i < period; i++) prev += values[i]
  prev /= period
  for (let i = period; i < values.length; i++) prev = values[i] * k + prev * (1 - k)
  return prev
}

export function rsi(values: number[], period = 14) {
  if (values.length < period + 1) return null
  let gains = 0, losses = 0
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i-1]
    if (diff >= 0) gains += diff; else losses -= diff
  }
  gains /= period; losses /= period
  let rs = losses === 0 ? 100 : gains / (losses || 1e-12)
  let out = 100 - (100 / (1 + rs))
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i-1]
    const gain = Math.max(diff, 0)
    const loss = Math.max(-diff, 0)
    gains = (gains * (period - 1) + gain) / period
    losses = (losses * (period - 1) + loss) / period
    rs = losses === 0 ? 100 : gains / (losses || 1e-12)
    out = 100 - (100 / (1 + rs))
  }
  return out
}

export function macd(values: number[], fast=12, slow=26, signal=9) {
  if (values.length < slow + signal) return { macd: null, signal: null, hist: null }
  const ef = buildEMA(values, fast)
  const es = buildEMA(values, slow)
  const macdSeries: number[] = []
  for (let i = 0; i < values.length; i++) macdSeries.push((ef[i] ?? 0) - (es[i] ?? 0))
  const signalSeries = buildEMA(macdSeries, signal)
  const lastMacd = macdSeries.at(-1) ?? null
  const lastSignal = signalSeries.at(-1) ?? null
  const hist = (lastMacd != null && lastSignal != null) ? lastMacd - lastSignal : null
  return { macd: lastMacd, signal: lastSignal, hist }
}

function buildEMA(values: number[], period: number) {
  const out: number[] = []
  const k = 2 / (period + 1)
  if (!values.length) return out
  let prev: number
  if (values.length >= period) {
    let sum = 0; for (let i = 0; i < period; i++) sum += values[i]
    prev = sum / period; out[period - 1] = prev
    for (let i = period; i < values.length; i++) { prev = values[i] * k + prev * (1 - k); out[i] = prev }
  } else {
    prev = values[0]; out[0] = prev
    for (let i = 1; i < values.length; i++) { prev = values[i] * k + prev * (1 - k); out[i] = prev }
  }
  return out
}

export function avgVolume(volumes: number[], period = 20) {
  if (volumes.length < period) return null
  return sma(volumes, period)
}