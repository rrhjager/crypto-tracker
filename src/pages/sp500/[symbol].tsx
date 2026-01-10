// src/pages/sp500/[symbol].tsx
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

  // tolerant: soms object, soms number
  rsi?: number | null | { period?: number; rsi: number | null; status?: Advice }

  macd?: { macd: number | null; signal: number | null; hist: number | null; status?: Advice }

  volume?: { volume: number | null; avg20d: number | null; ratio: number | null; status?: Advice }
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

// Yahoo nuances: BRK.B & BF.B use dash in Yahoo endpoints (BRK-B, BF-B)
function toSp500YahooSymbol(raw: string): string {
  let s = String(raw || '').trim().toUpperCase()
  if (!s) return ''
  s = s.replace(/\s+/g, '')

  // Convert dot-class tickers to Yahoo dash-class
  if (s.includes('.')) s = s.replace(/\./g, '-')

  return s
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
function statusRSI(r?: number | null): Advice {
  if (r == null) return 'HOLD'
  if (r > 70) return 'BUY'
  if (r < 30) return 'SELL'
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

  const maStatus: Advice = item.ma?.status ?? statusMA(ma50, ma200)
  const rsiStatus: Advice = (rsiObj?.status as Advice) ?? statusRSI(rsiVal)
  const macdStatus: Advice = item.macd?.status ?? statusMACD(macdHist, macdVal, macdSig)
  const volStatus: Advice = item.volume?.status ?? statusVolume(volRatio)

  const snapScore =
    typeof item.score === 'number' && Number.isFinite(item.score) ? Math.round(item.score) : null

  return {
    symbol: item.symbol,
    score: snapScore,
    ma: { ma50, ma200, status: maStatus },
    rsi: { period: rsiPeriod, rsi: rsiVal, status: rsiStatus },
    macd: { macd: macdVal, signal: macdSig, hist: macdHist, status: macdStatus },
    volume: { volume: volNow, avg20d: volAvg, ratio: volRatio, status: volStatus },
  }
}

export default function Sp500StockDetail() {
  const router = useRouter()
  const raw = String(router.query.symbol || '')
  const sym = toSp500YahooSymbol(raw)

  // 1) Snapshot-list voor 1 symbool (indicatoren + (na API-fix) score)
  const { data, error } = useSWR<SnapResp>(
    sym ? `/api/indicators/snapshot-list?symbols=${encodeURIComponent(sym)}` : null,
    fetcher,
    { refreshInterval: 30_000, revalidateOnFocus: false }
  )

  const item = normalize(data?.items?.[0] ?? null)
  const ma = item?.ma
  const rsi = item?.rsi
  const macd = item?.macd
  const vol = item?.volume

  // 2) Centrale score (canonical)
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

  return (
    <>
      <Head>
        <title>{sym} — SignalHub</title>
      </Head>

      <main className="min-h-screen">
        {/* Header met totaal-score rechts (zelfde als AEX) */}
        <section className="max-w-6xl mx-auto px-4 pt-16 pb-8">
          <div className="flex items-center justify-between gap-3">
            <h1 className="hero">{sym}</h1>
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

        <section className="max-w-6xl mx-auto px-4 pb-16">
          {error && (
            <div className="mb-3 text-red-600 text-sm">
              Fout bij laden: {String((error as any)?.message || error)}
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
          </div>

          <div className="mt-6 flex gap-3">
            <Link href="/sp500" className="btn">
              ← Back to S&amp;P 500 list
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