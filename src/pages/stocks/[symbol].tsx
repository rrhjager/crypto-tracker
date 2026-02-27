// src/pages/stocks/[symbol].tsx
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import useSWR from 'swr'
import ScoreBadge from '@/components/ScoreBadge'

type Advice = 'BUY' | 'HOLD' | 'SELL'
const statusFromScore = (score: number): Advice => (score >= 66 ? 'BUY' : score <= 33 ? 'SELL' : 'HOLD')

type SnapItem = {
  symbol: string
  score?: number | null

  ma?: { ma50: number | null; ma200: number | null; status?: Advice }

  // snapshot-list kan historisch 2 vormen hebben (we maken het tolerant):
  rsi?: number | null | { period?: number; rsi: number | null; status?: Advice }

  macd?: { macd: number | null; signal: number | null; hist: number | null; status?: Advice }

  volume?: { volume: number | null; avg20d: number | null; ratio: number | null; status?: Advice }
  trend?: { ret20: number | null; rangePos20: number | null; status?: Advice }
  volatility?: { stdev20: number | null; regime?: 'low' | 'med' | 'high' | '—'; status?: Advice }
}
type SnapResp = { items: SnapItem[]; updatedAt?: number }
type ScoreResp = { symbol: string; score: number | null }

const fetcher = async <T,>(url: string): Promise<T> => {
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

function fmt(v: number | null | undefined, d = 2) {
  return (v ?? v === 0) && Number.isFinite(v as number) ? (v as number).toFixed(d) : '—'
}
function fmtPct(v: number | null | undefined, d = 2) {
  return (v ?? v === 0) && Number.isFinite(v as number) ? `${(v as number).toFixed(d)}%` : '—'
}

function toAexYahooSymbol(raw: string): string {
  const s = String(raw || '').trim().toUpperCase()
  if (!s) return ''
  // als iemand al .AS of een andere suffix meegeeft: laat staan
  if (s.includes('.')) return s
  return `${s}.AS`
}

function stripAexSuffix(sym: string) {
  return sym.replace(/\.AS$/i, '')
}

function pillClass(s?: Advice) {
  return `badge ${s === 'BUY' ? 'badge-buy' : s === 'SELL' ? 'badge-sell' : 'badge-hold'}`
}

// Display statuses consistent with (momentum) scoring engine
function statusMA(ma50?: number | null, ma200?: number | null): Advice {
  if (ma50 == null || ma200 == null) return 'HOLD'
  if (ma50 > ma200) return 'BUY'
  if (ma50 < ma200) return 'SELL'
  return 'HOLD'
}

// ✅ FIX: RSI thresholds were inverted (must match engine/UI convention)
function statusRSI(r?: number | null): Advice {
  if (r == null) return 'HOLD'
  if (r > 70) return 'SELL'
  if (r < 30) return 'BUY'
  return 'HOLD'
}

function statusMACD(hist?: number | null, macd?: number | null, signal?: number | null): Advice {
  if (hist != null && Number.isFinite(hist)) return hist > 0 ? 'BUY' : hist < 0 ? 'SELL' : 'HOLD'
  if (macd != null && signal != null && Number.isFinite(macd) && Number.isFinite(signal))
    return macd > signal ? 'BUY' : macd < signal ? 'SELL' : 'HOLD'
  return 'HOLD'
}

function statusVolume(ratio?: number | null): Advice {
  if (ratio == null) return 'HOLD'
  if (ratio > 1.2) return 'BUY'
  if (ratio < 0.8) return 'SELL'
  return 'HOLD'
}
function statusTrend(ret20?: number | null, rangePos20?: number | null): Advice {
  if (ret20 == null && rangePos20 == null) return 'HOLD'
  const r = ret20 == null ? 0 : Math.max(-1, Math.min(1, ret20 / 14))
  const p = rangePos20 == null ? 0 : Math.max(-1, Math.min(1, (rangePos20 - 0.5) * 2))
  const mix = 0.6 * r + 0.4 * p
  if (mix >= 0.25) return 'BUY'
  if (mix <= -0.25) return 'SELL'
  return 'HOLD'
}
function statusVolatility(stdev20?: number | null): Advice {
  if (stdev20 == null) return 'HOLD'
  if (stdev20 <= 0.028) return 'BUY'
  if (stdev20 <= 0.075) return 'HOLD'
  return 'SELL'
}

function normalize(item?: SnapItem | null) {
  if (!item) return null

  const ma50 = item.ma?.ma50 ?? null
  const ma200 = item.ma?.ma200 ?? null

  const rsiObj = typeof item.rsi === 'object' && item.rsi ? (item.rsi as any) : null
  const rsiVal: number | null = typeof item.rsi === 'number' ? item.rsi : (rsiObj?.rsi ?? null)
  const rsiPeriod: number = rsiObj?.period ?? 14

  const macdVal = item.macd?.macd ?? null
  const macdSig = item.macd?.signal ?? null
  const macdHist = item.macd?.hist ?? null

  const volNow = item.volume?.volume ?? null
  const volAvg = item.volume?.avg20d ?? null
  const volRatio =
    item.volume?.ratio ??
    (Number.isFinite(volNow as number) && Number.isFinite(volAvg as number) && Number(volAvg) !== 0
      ? Number(volNow) / Number(volAvg)
      : null)

  // status (display) — consistent thresholds
  const maStatus: Advice = item.ma?.status ?? statusMA(ma50, ma200)
  const rsiStatus: Advice = (rsiObj?.status as Advice) ?? statusRSI(rsiVal)
  const macdStatus: Advice = item.macd?.status ?? statusMACD(macdHist, macdVal, macdSig)
  const volStatus: Advice = item.volume?.status ?? statusVolume(volRatio)
  const trendRet20 = item.trend?.ret20 ?? null
  const trendRangePos20 = item.trend?.rangePos20 ?? null
  const trendStatus: Advice = item.trend?.status ?? statusTrend(trendRet20, trendRangePos20)
  const volStdev20 = item.volatility?.stdev20 ?? null
  const volRegime = item.volatility?.regime ?? '—'
  const volatilityStatus: Advice = item.volatility?.status ?? statusVolatility(volStdev20)

  const snapScore =
    typeof item.score === 'number' && Number.isFinite(item.score) ? Math.round(item.score) : null

  return {
    symbol: item.symbol,
    score: snapScore,
    ma: { ma50, ma200, status: maStatus },
    rsi: { period: rsiPeriod, rsi: rsiVal, status: rsiStatus },
    macd: { macd: macdVal, signal: macdSig, hist: macdHist, status: macdStatus },
    volume: { volume: volNow, avg20d: volAvg, ratio: volRatio, status: volStatus },
    trend: { ret20: trendRet20, rangePos20: trendRangePos20, status: trendStatus },
    volatility: { stdev20: volStdev20, regime: volRegime, status: volatilityStatus },
  }
}

export default function StockDetail() {
  const router = useRouter()
  const raw = String(router.query.symbol || '')
  const sym = toAexYahooSymbol(raw)

  // 1) Snapshot-list voor 1 symbool (incl. indicatoren + (na stap 3) score)
  const { data: snap, error: snapErr } = useSWR<SnapResp>(
    sym ? `/api/indicators/snapshot-list?symbols=${encodeURIComponent(sym)}` : null,
    fetcher,
    { refreshInterval: 30_000, revalidateOnFocus: false }
  )
  const item = normalize(snap?.items?.[0] ?? null)

  // 2) Centrale score (lichtgewicht, canonical)
  const { data: serverScoreData } = useSWR<ScoreResp>(
    sym ? `/api/indicators/score/${encodeURIComponent(sym)}` : null,
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: false }
  )
  const serverScore =
    typeof serverScoreData?.score === 'number' && Number.isFinite(serverScoreData.score)
      ? Math.round(serverScoreData.score)
      : null

  // 3) Combineer: server score → snapshot score → 50
  const fallbackScore = item?.score ?? null
  const score = serverScore ?? fallbackScore ?? 50
  const scoreStatus: Advice = statusFromScore(score)

  const ma = item?.ma
  const rsi = item?.rsi
  const macd = item?.macd
  const vol = item?.volume
  const trend = item?.trend
  const volatility = item?.volatility

  return (
    <>
      <Head>
        <title>{stripAexSuffix(sym)} — SignalHub</title>
      </Head>

      <main className="min-h-screen">
        {/* Header met totaalscore */}
        <section className="max-w-6xl mx-auto px-4 pt-16 pb-8">
          <div className="flex items-center justify-between gap-3">
            <h1 className="hero">{stripAexSuffix(sym)}</h1>
            <div className="origin-left scale-95">
              <ScoreBadge score={score} />
            </div>
          </div>

          <div className="mt-1 text-sm text-white/60">
            Overall signal: <span className="font-medium">{scoreStatus}</span>
            {serverScore == null && fallbackScore != null && (
              <span className="ml-2 opacity-70">(preview via snapshot)</span>
            )}
          </div>
        </section>

        {/* Indicatorblokken */}
        <section className="max-w-6xl mx-auto px-4 pb-16">
          {snapErr && (
            <div className="mb-3 text-red-500 text-sm">
              Fout bij laden: {String((snapErr as any)?.message || snapErr)}
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            {/* MA */}
            <div className="table-card p-4">
              <div className="flex items-center justify-between mb-1">
                <div className="font-semibold">MA50 vs MA200 (Golden/Death Cross)</div>
                <span className={pillClass(ma?.status)}>{ma?.status || 'HOLD'}</span>
              </div>
              <div className="text-sm text-white/80">
                MA50: {fmt(ma?.ma50)} · MA200: {fmt(ma?.ma200)}
              </div>
            </div>

            {/* RSI */}
            <div className="table-card p-4">
              <div className="flex items-center justify-between mb-1">
                <div className="font-semibold">RSI ({rsi?.period ?? 14})</div>
                <span className={pillClass(rsi?.status)}>{rsi?.status || 'HOLD'}</span>
              </div>
              <div className="text-sm text-white/80">RSI: {fmt(rsi?.rsi)}</div>
            </div>

            {/* MACD */}
            <div className="table-card p-4">
              <div className="flex items-center justify-between mb-1">
                <div className="font-semibold">MACD (12/26/9)</div>
                <span className={pillClass(macd?.status)}>{macd?.status || 'HOLD'}</span>
              </div>
              <div className="text-sm text-white/80">
                MACD: {fmt(macd?.macd)} · Signal: {fmt(macd?.signal)} · Hist: {fmt(macd?.hist)}
              </div>
            </div>

            {/* Volume */}
            <div className="table-card p-4">
              <div className="flex items-center justify-between mb-1">
                <div className="font-semibold">Volume vs 20d Average</div>
                <span className={pillClass(vol?.status)}>{vol?.status || 'HOLD'}</span>
              </div>
              <div className="text-sm text-white/80">
                Vol: {fmt(vol?.volume, 0)} · Ave(20d): {fmt(vol?.avg20d, 0)} · Ratio: {fmt(vol?.ratio, 2)}
              </div>
            </div>

            {/* Trend */}
            <div className="table-card p-4">
              <div className="flex items-center justify-between mb-1">
                <div className="font-semibold">Trend (20d)</div>
                <span className={pillClass(trend?.status)}>{trend?.status || 'HOLD'}</span>
              </div>
              <div className="text-sm text-white/80">
                Ret20: {fmtPct(trend?.ret20, 2)} · Range-pos: {fmt(trend?.rangePos20, 2)}
              </div>
            </div>

            {/* Volatility */}
            <div className="table-card p-4">
              <div className="flex items-center justify-between mb-1">
                <div className="font-semibold">Volatility regime (20d)</div>
                <span className={pillClass(volatility?.status)}>{volatility?.status || 'HOLD'}</span>
              </div>
              <div className="text-sm text-white/80">
                Stdev20: {fmtPct(volatility?.stdev20 != null ? volatility.stdev20 * 100 : null, 2)} · Regime:{' '}
                {volatility?.regime ?? '—'}
              </div>
            </div>
          </div>

          <div className="mt-6 flex gap-3">
            <Link href="/stocks" className="btn">
              ← Back to AEX list
            </Link>
            <Link href="/" className="btn-secondary">
              Go to homepage
            </Link>
          </div>
        </section>
      </main>
    </>
  )
}
