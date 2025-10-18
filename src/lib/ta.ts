// src/lib/ta.ts

export function maCross(closes: number[]) {
  const ma = (arr: number[], n: number) =>
    arr.length >= n ? arr.slice(-n).reduce((a, b) => a + b, 0) / n : NaN

  const ma50  = ma(closes, 50)
  const ma200 = ma(closes, 200)

  const valid50  = Number.isFinite(ma50)
  const valid200 = Number.isFinite(ma200)

  let status: 'BUY' | 'SELL' | 'HOLD' | undefined
  let points: number | undefined

  if (valid50 && valid200) {
    if (ma50 > ma200) {
      status = 'BUY'
      const spread = Math.min(0.2, Math.max(0, ma50 / Math.max(1e-9, ma200) - 1))
      const score = 60 + (spread / 0.2) * 40 // 60..100
      points = ((score / 100) * 4) - 2
    } else if (ma50 < ma200) {
      status = 'SELL'
      const spread = Math.min(0.2, Math.max(0, ma200 / Math.max(1e-9, ma50) - 1))
      const score = 40 - (spread / 0.2) * 40 // 0..40
      points = ((score / 100) * 4) - 2
    } else {
      status = 'HOLD'
      points = 0
    }
  }

  return {
    ma50:  valid50  ? Number(ma50.toFixed(6))  : null,
    ma200: valid200 ? Number(ma200.toFixed(6)) : null,
    status,
    points: points != null ? Math.max(-2, Math.min(2, Number(points.toFixed(3)))) : null
  }
}

export function rsi14(closes: number[]) {
  const n = 14
  if (closes.length < n + 1) {
    return { period: n, rsi: null, status: undefined as any, points: null as number | null }
  }

  let gains = 0, losses = 0
  for (let i = 1; i <= n; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff >= 0) gains += diff; else losses -= diff
  }
  let avgGain = gains / n
  let avgLoss = losses / n

  for (let i = n + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? -diff : 0
    avgGain = (avgGain * (n - 1) + gain) / n
    avgLoss = (avgLoss * (n - 1) + loss) / n
  }

  const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss
  const rsi = 100 - 100 / (1 + rs)
  const val = Number(rsi.toFixed(2))

  let status: 'BUY' | 'SELL' | 'HOLD' | undefined
  if (val <= 30) status = 'BUY'
  else if (val >= 70) status = 'SELL'
  else status = 'HOLD'

  const score = Math.max(0, Math.min(100, ((val - 30) / 40) * 100))
  const points = ((score / 100) * 4) - 2

  return {
    period: n,
    rsi: val,
    status,
    points: Math.max(-2, Math.min(2, Number(points.toFixed(3))))
  }
}

export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9) {
  const ema = (arr: number[], p: number) => {
    const k = 2 / (p + 1)
    let emaVal = arr[0]
    const out = [emaVal]
    for (let i = 1; i < arr.length; i++) {
      emaVal = arr[i] * k + emaVal * (1 - k)
      out.push(emaVal)
    }
    return out
  }

  if (closes.length < slow + signalPeriod) {
    return { fast, slow, signalPeriod, macd: null, signal: null, hist: null, status: undefined as any, points: null as any }
  }

  const emaFast = ema(closes, fast)
  const emaSlow = ema(closes, slow)
  const macdLine = closes.map((_, i) => emaFast[i] - emaSlow[i])
  const signal = ema(macdLine.slice(slow - 1), signalPeriod)
  const align = macdLine.slice(slow - 1)
  const hist = align[align.length - 1] - signal[signal.length - 1]

  let status: 'BUY' | 'SELL' | 'HOLD' = 'HOLD'
  if (hist > 0) status = 'BUY'
  else if (hist < 0) status = 'SELL'

  // normalize ~ lightweight
  const ref = Math.abs(align[align.length - 1]) || 1
  const rel = Math.max(-1, Math.min(1, hist / ref))
  const score = 50 + rel * 20
  const points = ((score / 100) * 4) - 2

  return {
    fast, slow, signalPeriod,
    macd: Number(align[align.length - 1].toFixed(6)),
    signal: Number(signal[signal.length - 1].toFixed(6)),
    hist: Number(hist.toFixed(6)),
    status,
    points: Math.max(-2, Math.min(2, Number(points.toFixed(3))))
  }
}

export function vol20(volumes: number[]) {
  const n = 20
  if (volumes.length < n) {
    return { period: n, volume: null, avg20: null, ratio: null, status: undefined as any, points: null as any }
  }
  const cur = volumes[volumes.length - 1]
  const avg = volumes.slice(-n).reduce((a, b) => a + b, 0) / n
  const ratio = avg ? cur / avg : null

  let status: 'BUY'|'SELL'|'HOLD' = 'HOLD'
  if (ratio != null) {
    if (ratio >= 1.5) status = 'BUY'
    else if (ratio <= 0.7) status = 'SELL'
  }

  const delta = ratio == null ? 0 : Math.max(-1, Math.min(1, (ratio - 1) / 1))
  const score = Math.max(0, Math.min(100, 50 + delta * 30))
  const points = ((score / 100) * 4) - 2

  return {
    period: n,
    volume: Number(cur.toFixed(0)),
    avg20: Number(avg.toFixed(0)),
    ratio: ratio != null ? Number(ratio.toFixed(3)) : null,
    status,
    points: Math.max(-2, Math.min(2, Number(points.toFixed(3))))
  }
}