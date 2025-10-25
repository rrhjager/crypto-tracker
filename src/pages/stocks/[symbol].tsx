// src/pages/stocks/[symbol].tsx
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import useSWR from 'swr'
import ScoreBadge from '@/components/ScoreBadge'

type Advice = 'BUY' | 'HOLD' | 'SELL'

const toPtsFromStatus = (s?: Advice) => (s === 'BUY' ? 2 : s === 'SELL' ? -2 : 0)
const statusFromScore = (score: number): Advice => (score >= 66 ? 'BUY' : score <= 33 ? 'SELL' : 'HOLD')

// ----- API types (sluiten aan op je bestaande endpoints) -----
type SnapItem = {
  symbol: string
  ma?:    { ma50: number | null; ma200: number | null; status?: Advice }
  rsi?:   { period: number; rsi: number | null; status?: Advice }
  macd?:  { macd: number | null; signal: number | null; hist: number | null; status?: Advice }
  volume?:{ volume: number | null; avg20d: number | null; ratio: number | null; status?: Advice }
}
type SnapResp = { items: SnapItem[]; updatedAt?: number }

type ScoreResp = { symbol: string; score: number | null }

// ----- helpers -----
const fetcher = async <T,>(url: string): Promise<T> => {
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

function fmt(v: number | null | undefined, d = 2) {
  return (v ?? v === 0) && Number.isFinite(v as number) ? (v as number).toFixed(d) : '—'
}

// Zelfde wegingsmodel als elders (gebruik alleen de *status* velden)
function computeLocalScoreFromStatuses(it?: SnapItem): number | null {
  if (!it) return null
  const toNorm = (p: number) => (p + 2) / 4
  const W_MA = 0.40, W_MACD = 0.30, W_RSI = 0.20, W_VOL = 0.10
  const pMA  = toPtsFromStatus(it.ma?.status)
  const pMACD= toPtsFromStatus(it.macd?.status)
  const pRSI = toPtsFromStatus(it.rsi?.status)
  const pVOL = toPtsFromStatus(it.volume?.status)
  const agg = W_MA*toNorm(pMA) + W_MACD*toNorm(pMACD) + W_RSI*toNorm(pRSI) + W_VOL*toNorm(pVOL)
  const score = Math.round(Math.max(0, Math.min(1, agg)) * 100)
  return Number.isFinite(score) ? score : null
}

export default function StockDetail() {
  const router = useRouter()
  const sym = String(router.query.symbol || '').toUpperCase()

  // 1) Indicators + statuses (zoals je had)
  const { data: snap, error: snapErr } = useSWR<SnapResp>(
    sym ? `/api/indicators/snapshot-list?symbols=${encodeURIComponent(sym)}` : null,
    fetcher,
    { refreshInterval: 30_000, revalidateOnFocus: false }
  )
  const item = snap?.items?.[0]

  // 2) Centrale score (zelfde bron als homepage) — zeer lichte call
  const { data: serverScoreData } = useSWR<ScoreResp>(
    sym ? `/api/indicators/score/${encodeURIComponent(sym)}` : null,
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: false }
  )
  const serverScore = Number.isFinite(serverScoreData?.score as number)
    ? Math.round(Number(serverScoreData!.score))
    : null

  // 3) Fallback: lokale score wanneer serverScore (nog) niet binnen is
  const fallbackScore = computeLocalScoreFromStatuses(item)
  const score = serverScore ?? fallbackScore ?? 50
  const scoreStatus: Advice = statusFromScore(score)

  const ma    = item?.ma
  const rsi   = item?.rsi
  const macd  = item?.macd
  const vol   = item?.volume

  return (
    <>
      <Head><title>{sym.replace('.AS','')} — SignalHub</title></Head>
      <main className="min-h-screen">
        {/* Header met totaal-score rechts */}
        <section className="max-w-6xl mx-auto px-4 pt-16 pb-8">
          <div className="flex items-center justify-between gap-3">
            <h1 className="hero">{sym.replace('.AS','')}</h1>
            <div className="origin-left scale-95">
              <ScoreBadge score={score} />
            </div>
          </div>
          <div className="mt-1 text-sm text-white/60">
            Overall signal: <span className="font-medium">{scoreStatus}</span>
            {serverScore == null && fallbackScore != null && (
              <span className="ml-2 opacity-70">(preview via local calc)</span>
            )}
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-4 pb-16">
          {snapErr && <div className="mb-3 text-red-500 text-sm">Fout bij laden: {String((snapErr as any)?.message || snapErr)}</div>}

          <div className="grid md:grid-cols-2 gap-4">
            {/* MA */}
            <div className="table-card p-4">
              <div className="flex items-center justify-between mb-1">
                <div className="font-semibold">MA50 vs MA200 (Golden/Death Cross)</div>
                <span className="badge badge-hold">{ma?.status || 'HOLD'}</span>
              </div>
              <div className="text-sm text-white/80">
                MA50: {fmt(ma?.ma50)} · MA200: {fmt(ma?.ma200)}
              </div>
            </div>

            {/* RSI */}
            <div className="table-card p-4">
              <div className="flex items-center justify-between mb-1">
                <div className="font-semibold">RSI ({rsi?.period ?? 14})</div>
                <span className="badge badge-hold">{rsi?.status || 'HOLD'}</span>
              </div>
              <div className="text-sm text-white/80">RSI: {fmt(rsi?.rsi)}</div>
            </div>

            {/* MACD */}
            <div className="table-card p-4">
              <div className="flex items-center justify-between mb-1">
                <div className="font-semibold">MACD (12/26/9)</div>
                <span className="badge badge-hold">{macd?.status || 'HOLD'}</span>
              </div>
              <div className="text-sm text-white/80">
                MACD: {fmt(macd?.macd)} · Signaal: {fmt(macd?.signal)} · Hist: {fmt(macd?.hist)}
              </div>
            </div>

            {/* Volume */}
            <div className="table-card p-4">
              <div className="flex items-center justify-between mb-1">
                <div className="font-semibold">Volume vs 20d gemiddelde</div>
                <span className="badge badge-hold">{vol?.status || 'HOLD'}</span>
              </div>
              <div className="text-sm text-white/80">
                Vol: {fmt(vol?.volume, 0)} · Gem(20d): {fmt(vol?.avg20d, 0)} · Ratio: {fmt(vol?.ratio, 2)}
              </div>
            </div>
          </div>

          <div className="mt-6 flex gap-3">
            <Link href="/stocks" className="btn">← Back to AEX list</Link>
            <Link href="/" className="btn-secondary">Go to homepage</Link>
          </div>
        </section>
      </main>
    </>
  )
}