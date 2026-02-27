// src/lib/pastPerformance/equityIndicatorsExact.ts
import { latestTrendFeatures, latestVolatilityFeatures } from '@/lib/taExtras'

export type FetchOk = {
    ok: true
    source: 'yahoo'
    data: { times: number[]; closes: number[]; volumes: number[] } // times in ms
  }
  export type FetchErr = { ok: false; error: string }
  export type FetchResult = FetchOk | FetchErr
  
  export async function fetchMarketDataForEquity(
    symbol: string,
    opts?: { range?: string; interval?: string }
  ): Promise<FetchResult> {
    try {
      const range = opts?.range ?? '2y'
      const interval = opts?.interval ?? '1d'
  
      const url =
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
        `?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}&includePrePost=false&events=div%7Csplit`
  
      const r = await fetch(url, {
        headers: {
          accept: 'application/json',
          'user-agent': 'Mozilla/5.0 (SignalHub) past-performance',
        },
      })
  
      if (!r.ok) return { ok: false, error: `Yahoo HTTP ${r.status}` }
  
      const j = await r.json()
      const res = j?.chart?.result?.[0]
      const ts: number[] = Array.isArray(res?.timestamp) ? res.timestamp : []
      const quote = res?.indicators?.quote?.[0]
      const closeRaw: Array<number | null> = Array.isArray(quote?.close) ? quote.close : []
      const volRaw: Array<number | null> = Array.isArray(quote?.volume) ? quote.volume : []
  
      const times: number[] = []
      const closes: number[] = []
      const volumes: number[] = []
  
      for (let i = 0; i < ts.length; i++) {
        const c = closeRaw[i]
        if (c == null || !Number.isFinite(c)) continue
        times.push(ts[i] * 1000) // ✅ ms like crypto
        closes.push(c)
        const v = volRaw[i]
        volumes.push(v != null && Number.isFinite(v) ? v : 0)
      }
  
      return { ok: true, source: 'yahoo', data: { times, closes, volumes } }
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) }
    }
  }
  
  function smaLast(arr: number[], period: number): number | null {
    if (arr.length < period) return null
    let s = 0
    for (let i = arr.length - period; i < arr.length; i++) s += arr[i]
    return s / period
  }
  
  function emaSeries(arr: number[], period: number): Array<number | null> {
    const out: Array<number | null> = new Array(arr.length).fill(null)
    if (arr.length < period) return out
    const k = 2 / (period + 1)
  
    // seed SMA(period)
    let seed = 0
    for (let i = 0; i < period; i++) seed += arr[i]
    seed /= period
    out[period - 1] = seed
  
    let prev = seed
    for (let i = period; i < arr.length; i++) {
      const next = arr[i] * k + prev * (1 - k)
      out[i] = next
      prev = next
    }
    return out
  }
  
  function rsiLast(closes: number[], period = 14): number | null {
    if (closes.length < period + 1) return null
  
    let gain = 0
    let loss = 0
    for (let i = 1; i <= period; i++) {
      const ch = closes[i] - closes[i - 1]
      if (ch >= 0) gain += ch
      else loss += -ch
    }
  
    let avgGain = gain / period
    let avgLoss = loss / period
  
    for (let i = period + 1; i < closes.length; i++) {
      const ch = closes[i] - closes[i - 1]
      const g = ch > 0 ? ch : 0
      const l = ch < 0 ? -ch : 0
      avgGain = (avgGain * (period - 1) + g) / period
      avgLoss = (avgLoss * (period - 1) + l) / period
    }
  
    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss
    return 100 - 100 / (1 + rs)
  }
  
  function macdHistLast(closes: number[]): number | null {
    const ema12 = emaSeries(closes, 12)
    const ema26 = emaSeries(closes, 26)
  
    const macd: Array<number | null> = closes.map((_, i) => {
      const a = ema12[i]
      const b = ema26[i]
      if (a == null || b == null) return null
      return a - b
    })
  
    // compact non-null macd to compute EMA9 signal
    const macdVals: number[] = []
    const idxMap: number[] = []
    for (let i = 0; i < macd.length; i++) {
      if (macd[i] != null) {
        macdVals.push(macd[i] as number)
        idxMap.push(i)
      }
    }
    if (macdVals.length < 9) return null
  
    const sigCompact = emaSeries(macdVals, 9)
    const signal: Array<number | null> = new Array(closes.length).fill(null)
    for (let j = 0; j < sigCompact.length; j++) {
      const idx = idxMap[j]
      signal[idx] = sigCompact[j]
    }
  
    // last hist where both exist
    for (let i = closes.length - 1; i >= 0; i--) {
      const m = macd[i]
      const s = signal[i]
      if (m != null && s != null) return m - s
    }
    return null
  }
  
  export function computeIndicators(closes: number[], volumes: number[]) {
    const ma50 = smaLast(closes, 50)
    const ma200 = smaLast(closes, 200)
    const rsi = rsiLast(closes, 14)
    const hist = macdHistLast(closes)
  
    const vol = volumes[volumes.length - 1] ?? null
    const avg20d = smaLast(volumes, 20)
    const ratio = avg20d && avg20d > 0 && vol != null ? vol / avg20d : null
    const trend = latestTrendFeatures(closes, 20)
    const volatility = latestVolatilityFeatures(closes, 20)

    return {
      ma: { ma50, ma200 },
      rsi,
      macd: { hist },
      volume: { ratio },
      trend,
      volatility,
    }
  }
