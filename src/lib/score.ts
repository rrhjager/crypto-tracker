// src/lib/score.ts

/* Shared types (houd ze gelijk aan je API responses) */
export type Advice = 'BUY' | 'HOLD' | 'SELL'

export type MaCrossResp = {
  symbol: string
  ma50: number | null
  ma200: number | null
  status: Advice
  points: number | null
}
export type RsiResp = {
  symbol: string
  period: number
  rsi: number | null
  status: Advice
  points: number | null
}
export type MacdResp = {
  symbol: string
  fast: number
  slow: number
  signalPeriod: number
  macd: number | null
  signal: number | null
  hist: number | null
  status: Advice
  points: number | null
}
export type Vol20Resp = {
  symbol: string
  period: number
  volume: number | null
  avg20: number | null
  ratio: number | null
  status: Advice
  points: number | null
}

/* ---------- Helpers ---------- */
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))

/**
 * BELANGRIJK:
 * scoreToPct verwacht NU een waarde in het bereik 0..100 en doet
 * GEEN extra *100 meer. Dit voorkomt dubbele scaling (de oorzaak van “altijd 74”).
 */
export function scoreToPct(s: number) {
  // verwacht s ≈ 0..100
  return clamp(Math.round(s), 0, 100)
}

export function statusFromScore(score: number): Advice {
  if (score >= 66) return 'BUY'
  if (score <= 33) return 'SELL'
  return 'HOLD'
}

/** Converteer indicatorstatus/ruwe punten naar [-2..2] */
function toPoints(status?: Advice, pts?: number | null) {
  if (Number.isFinite(pts as number)) return clamp(Number(pts), -2, 2)
  if (status === 'BUY') return 2
  if (status === 'SELL') return -2
  return 0
}

/* ---------- Weights (identiek aan detailpagina’s) ---------- */
const W_MA = 0.40
const W_MACD = 0.30
const W_RSI = 0.20
const W_VOL = 0.10

/**
 * Berekent de samengestelde score (0..100) UIT de vier indicator-responses.
 * Dit is identiek aan de berekening op de individuele pagina’s.
 * Return is reeds in PERCENTAGE; geen extra *100 nodig bij de aanroeper.
 */
export function aggregateScoreFromIndicators(
  ma: MaCrossResp | null | undefined,
  rsi: RsiResp | null | undefined,
  macd: MacdResp | null | undefined,
  vol: Vol20Resp | null | undefined
): number {
  const pMA = toPoints(ma?.status, ma?.points)
  const pMACD = toPoints(macd?.status, macd?.points)
  const pRSI = toPoints(rsi?.status, rsi?.points)
  const pVOL = toPoints(vol?.status, vol?.points)

  // normaliseer [-2..2] -> [0..1]
  const nMA = (pMA + 2) / 4
  const nMACD = (pMACD + 2) / 4
  const nRSI = (pRSI + 2) / 4
  const nVOL = (pVOL + 2) / 4

  // gewogen som (0..1) en dan *100
  const agg = W_MA * nMA + W_MACD * nMACD + W_RSI * nRSI + W_VOL * nVOL
  const pct = agg * 100

  // alleen afronden + clamp — GEEN extra vermenigvuldiging
  return scoreToPct(pct)
}

/**
 * Kleine utility voor aanroepers die al “agg * 100” doen (zoals in detailpagina code):
 * Gebruik deze NIET om nog een keer te schalen — dit rondt alleen af + clamp’t.
 * (Laat staan ter achterwaartse compatibiliteit; mag ook direct scoreToPct gebruiken.)
 */
export function finalizePercent(pct0to100: number) {
  return scoreToPct(pct0to100)
}