// Unified scoring helpers used across pages and API

/* ================= Types ================= */

export type Advice = 'BUY' | 'HOLD' | 'SELL'

export type IndResp = {
  symbol: string
  ma?: {
    ma50: number | null
    ma200: number | null
    cross?: 'Golden Cross' | 'Death Cross' | '—'
    status?: string
    points?: number | string | null
  }
  rsi?: number | null
  macd?: {
    macd: number | null
    signal: number | null
    hist: number | null
    status?: string
    points?: number | string | null
  }
  volume?: {
    volume: number | null
    avg20d: number | null
    ratio: number | null
    status?: string
    points?: number | string | null
  }
  // Some feeds hang these on the root:
  rsiStatus?: string
  rsiPoints?: number | string | null

  error?: string
}

/* ============== Small utils ============== */

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))
const toNum = (x: unknown): number => (x === null || x === undefined ? NaN : Number(x))
const isFiniteNum = (x: unknown): x is number => Number.isFinite(Number(x))

export const statusFromOverall = (score: number): Advice =>
  score >= 66 ? 'BUY' : score <= 33 ? 'SELL' : 'HOLD'

/** Convert points -2..+2 or a BUY/SELL/HOLD status to a normalized 0..1.
 * If neither available, use the fallback() (which should return 0..1 or null).
 */
function norm01FromIndicator(
  status?: Advice | string,
  pts?: number | string | null,
  fallback?: () => number | null
): number | null {
  // Prefer points if present
  if (isFiniteNum(pts)) {
    const p = clamp(toNum(pts), -2, 2)
    return (p + 2) / 4 // -2..+2 -> 0..1
  }
  // Then a status string
  const s = String(status || '').toUpperCase()
  if (s === 'BUY') return (2 + 2) / 4
  if (s === 'SELL') return (-2 + 2) / 4
  if (s === 'HOLD') return 0.5

  // Fallback calculator
  return fallback ? fallback() : null
}

/* ============== overallScore (Light) ============== */
/** Same calculation for ALL coins as used on detail pages */
export function overallScore(ind?: IndResp): { score: number; status: Advice } {
  if (!ind || ind.error) return { score: 50, status: 'HOLD' }

  // MA → 0..1
  const vMA = norm01FromIndicator(ind.ma?.status as any, ind.ma?.points, () => {
    const ma50 = ind.ma?.ma50
    const ma200 = ind.ma?.ma200
    if (ma50 == null || ma200 == null) return null

    // Map spread into 0..1 with 0.2 cap (same shape as before)
    let maPct = 0.5
    if (ma50 > ma200) {
      const spread = clamp(ma50 / Math.max(1e-9, ma200) - 1, 0, 0.2)
      const score100 = 60 + (spread / 0.2) * 40 // 60..100
      maPct = score100 / 100
    } else if (ma50 < ma200) {
      const spread = clamp(ma200 / Math.max(1e-9, ma50) - 1, 0, 0.2)
      const score100 = 40 - (spread / 0.2) * 40 // 40..0
      maPct = score100 / 100
    }
    return maPct
  })

  // RSI → 0..1
  const vRSI = norm01FromIndicator(ind.rsiStatus as any, ind.rsiPoints, () => {
    if (!isFiniteNum(ind.rsi)) return null
    const score100 = clamp(((Number(ind.rsi) - 30) / 40) * 100, 0, 100)
    return score100 / 100
  })

  // MACD → 0..1
  const vMACD = norm01FromIndicator(ind.macd?.status as any, ind.macd?.points, () => {
    const h = ind.macd?.hist
    if (!isFiniteNum(h)) return null
    const score100 = h > 0 ? 70 : h < 0 ? 30 : 50
    return score100 / 100
  })

  // Volume → 0..1
  const vVOL = norm01FromIndicator(ind.volume?.status as any, ind.volume?.points, () => {
    const ratio = ind.volume?.ratio
    if (!isFiniteNum(ratio)) return null
    const score100 = clamp((Number(ratio) / 2) * 100, 0, 100)
    return score100 / 100
  })

  // Weights (renormalize over available components)
  const parts: Array<{ w: number; v: number | null }> = [
    { w: 0.40, v: vMA },
    { w: 0.30, v: vMACD },
    { w: 0.20, v: vRSI },
    { w: 0.10, v: vVOL },
  ].filter(p => p.v !== null)

  if (!parts.length) return { score: 50, status: 'HOLD' }

  const wSum = parts.reduce((s, p) => s + p.w, 0)
  const agg01 = parts.reduce((s, p) => s + (p.v as number) * (p.w / wSum), 0)
  const score = Math.round(clamp(agg01, 0, 1) * 100)
  return { score, status: statusFromOverall(score) }
}

/* ============== Generic combiner for API use ============== */
/** Component value in 0..100 (or null), with relative weight. */
export type ComponentScoreNullable = {
  weight: number
  value: number | null // expect 0..100 when present
}

/** Combine any set of component scores (0..100) with weights.
 * Ignores nulls and renormalizes weights. Returns 50 when nothing present.
 */
export function combineScores(components: ComponentScoreNullable[]): number {
  const present = components.filter(c => isFiniteNum(c.value))
  if (!present.length) return 50

  const wSum = present.reduce((s, c) => s + c.weight, 0)
  if (wSum <= 0) return 50

  const agg =
    present.reduce((s, c) => s + (Number(c.value) * c.weight) / wSum, 0)

  return Math.round(clamp(agg, 0, 100))
}