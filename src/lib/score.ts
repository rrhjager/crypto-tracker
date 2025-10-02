// src/lib/score.ts
export type Advice = 'BUY' | 'HOLD' | 'SELL'

export type MaCrossResp = { symbol: string; ma50: number | null; ma200: number | null; status: Advice | string; points: number | string | null }
export type RsiResp    = { symbol: string; period: number; rsi: number | null; status: Advice | string; points: number | string | null }
export type MacdResp   = { symbol: string; fast: number; slow: number; signalPeriod: number; macd: number | null; signal: number | null; hist: number | null; status: Advice | string; points: number | string | null }
export type Vol20Resp  = { symbol: string; period: number; volume: number | null; avg20: number | null; ratio: number | null; status: Advice | string; points: number | string | null }

/** Rond af en clamp naar 0..100 (homepage-stijl) */
export function scoreToPct(s: number) {
  return Math.max(0, Math.min(100, Math.round(s)))
}

export function statusFromScore(score: number): Advice {
  if (score >= 66) return 'BUY'
  if (score <= 33) return 'SELL'
  return 'HOLD'
}

/** interne helpers */
const clampNum = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))
const normalize01 = (pts: number) => (clampNum(pts, -2, 2) + 2) / 4 // -> 0..1

/** Parse points (kan number of string zijn). Return null als het niet bruikbaar is. */
function parsePts(pts: number | string | null | undefined): number | null {
  if (pts === null || pts === undefined) return null
  const n = typeof pts === 'string' ? Number(pts) : pts
  return Number.isFinite(n) ? clampNum(n as number, -2, 2) : null
}

/** Map status naar punten wanneer points ontbreken */
function statusToPts(status?: Advice | string | null): number | null {
  if (!status) return null
  const s = String(status).toUpperCase()
  if (s === 'BUY')  return  2
  if (s === 'SELL') return -2
  // NEUTRAL / HOLD / NONE / UNKNOWN -> geen bijdrage, laat weging herverdelen
  return 0
}

/**
 * Composite score — IDENTIEK qua formule, maar:
 * - we nemen ALLEEN indicatoren mee die data hebben (points of status),
 * - en herverdelen de gewichten zodat ontbrekende indicatoren geen bias geven (zoals “altijd ~74”).
 *
 * Formule per indicator: (pts + 2) / 4  (0..1)
 * Weights: MA 40%, MACD 30%, RSI 20%, VOL 10%  → hernormeren op som van aanwezige weights.
 */
export function computeCompositeScore(
  ma: MaCrossResp | null,
  macd: MacdResp | null,
  rsi: RsiResp | null,
  vol: Vol20Resp | null
): number {
  // Bepaal per indicator de genormaliseerde waarde (0..1) of null als geen bruikbare input.
  const vMA   = (() => {
    if (!ma) return null
    const p = parsePts(ma.points)
    if (p !== null) return normalize01(p)
    const s = statusToPts(ma.status)
    return s === null ? null : normalize01(s)
  })()

  const vMACD = (() => {
    if (!macd) return null
    const p = parsePts(macd.points)
    if (p !== null) return normalize01(p)
    const s = statusToPts(macd.status)
    return s === null ? null : normalize01(s)
  })()

  const vRSI  = (() => {
    if (!rsi) return null
    const p = parsePts(rsi.points)
    if (p !== null) return normalize01(p)
    const s = statusToPts(rsi.status)
    return s === null ? null : normalize01(s)
  })()

  const vVOL  = (() => {
    if (!vol) return null
    const p = parsePts(vol.points)
    if (p !== null) return normalize01(p)
    const s = statusToPts(vol.status)
    return s === null ? null : normalize01(s)
  })()

  // Weeg alleen aanwezige indicatoren; hernormaliseer gewichten.
  const parts: Array<{w: number; v: number}> = []
  if (vMA   !== null) parts.push({ w: 0.40, v: vMA })
  if (vMACD !== null) parts.push({ w: 0.30, v: vMACD })
  if (vRSI  !== null) parts.push({ w: 0.20, v: vRSI })
  if (vVOL  !== null) parts.push({ w: 0.10, v: vVOL })

  if (parts.length === 0) {
    // geen bruikbare data → neutraal
    return 50
  }

  const wSum = parts.reduce((s, p) => s + p.w, 0)
  const agg01 = parts.reduce((s, p) => s + p.v * (p.w / wSum), 0) // 0..1
  return scoreToPct(agg01 * 100)
}