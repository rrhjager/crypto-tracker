// src/pages/stocks/[symbol].tsx
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import useSWR from 'swr'
import ScoreBadge from '@/components/ScoreBadge'
import StockChart from '@/components/StockChart' // ★ ADDED

type Advice = 'BUY' | 'HOLD' | 'SELL'

const toPtsFromStatus = (s?: Advice) => (s === 'BUY' ? 2 : s === 'SELL' ? -2 : 0)
const statusFromScore = (score: number): Advice => (score >= 66 ? 'BUY' : score <= 33 ? 'SELL' : 'HOLD')

// ----- API types (ruimer, want API kan variëren) -----
type SnapItemRaw = {
  symbol: string
  ma?:    { ma50: number | null; ma200: number | null; status?: Advice }
  rsi?:   { period?: number; rsi: number | null; status?: Advice } | number | null
  macd?:  { macd: number | null; signal: number | null; hist?: number | null; status?: Advice }
  macdHist?: number | null
  volume?:{ volume: number | null; avg20d: number | null; ratio?: number | null; status?: Advice }
}
type SnapResp = { items: SnapItemRaw[]; updatedAt?: number }

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

/** Normalizeert verschillende response-vormen en vult missende statussen aan. */
function normalizeAndDecorate(raw?: SnapItemRaw) {
  if (!raw) return null as any
  const ma50 = raw.ma?.ma50 ?? null
  const ma200 = raw.ma?.ma200 ?? null
  const rsiNum = typeof raw.rsi === 'number' ? raw.rsi : (raw.rsi?.rsi ?? null)
  const rsiPeriod = (typeof raw.rsi === 'object' && raw.rsi && 'period' in raw.rsi) ? (raw.rsi as any).period : 14
  const macdVal = raw.macd?.macd ?? null
  const macdSig = raw.macd?.signal ?? null
  const macdHist = (raw.macd?.hist ?? raw.macdHist) ?? null
  const volNow = raw.volume?.volume ?? null
  const volAvg = raw.volume?.avg20d ?? null
  const volRatio = raw.volume?.ratio ?? (Number.isFinite(volNow as number) && Number.isFinite(volAvg as number) && (volAvg as number)!==0
    ? Number(volNow)/Number(volAvg) : null)

  // status fallback regels (conservatief, gelijk aan eerdere client-heuristiek)
  const maStatus: Advice =
    raw.ma?.status ??
    ((Number.isFinite(ma50 as number) && Number.isFinite(ma200 as number))
      ? (Number(ma50) > Number(ma200) ? 'BUY' : Number(ma50) < Number(ma200) ? 'SELL' : 'HOLD')
      : 'HOLD')

  const rsiStatus: Advice =
    (typeof raw.rsi === 'object' ? raw.rsi?.status as Advice|undefined : undefined) ??
    (Number.isFinite(rsiNum as number)
      ? (Number(rsiNum) >= 60 ? 'BUY' : Number(rsiNum) <= 40 ? 'SELL' : 'HOLD')
      : 'HOLD')

  const macdStatus: Advice =
    raw.macd?.status ??
    (Number.isFinite(macdHist as number)
      ? (Number(macdHist) > 0 ? 'BUY' : Number(macdHist) < 0 ? 'SELL' : 'HOLD')
      : (Number.isFinite(macdVal as number) && Number.isFinite(macdSig as number)
          ? (Number(macdVal) > Number(macdSig) ? 'BUY' : Number(macdVal) < Number(macdSig) ? 'SELL' : 'HOLD')
          : 'HOLD'))

  const volStatus: Advice =
    raw.volume?.status ??
    (Number.isFinite(volRatio as number)
      ? (Number(volRatio) >= 1.2 ? 'BUY' : Number(volRatio) <= 0.8 ? 'SELL' : 'HOLD')
      : 'HOLD')

  return {
    symbol: raw.symbol,
    ma: { ma50, ma200, status: maStatus as Advice },
    rsi: { period: rsiPeriod, rsi: rsiNum, status: rsiStatus as Advice },
    macd: { macd: macdVal, signal: macdSig, hist: macdHist, status: macdStatus as Advice },
    volume: { volume: volNow, avg20d: volAvg, ratio: volRatio, status: volStatus as Advice },
  }
}

// Zelfde weging als elders — werkt op statusvelden (nu altijd beschikbaar via normalizeAndDecorate)
function computeLocalScoreFromStatuses(it: ReturnType<typeof normalizeAndDecorate> | null): number | null {
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

  // 1) Indicators (1 call / 30s)
  const { data: snap, error: snapErr } = useSWR<SnapResp>(
    sym ? `/api/indicators/snapshot-list?symbols=${encodeURIComponent(sym)}` : null,
    fetcher,
    { refreshInterval: 30_000, revalidateOnFocus: false }
  )
  const itemNorm = normalizeAndDecorate(snap?.items?.[0])

  // 2) Centrale score (lichtgewicht), maar lokale score is er meteen
  const { data: serverScoreData } = useSWR<ScoreResp>(
    sym ? `/api/indicators/score/${encodeURIComponent(sym)}` : null,
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: false }
  )
  const serverScore = Number.isFinite(serverScoreData?.score as number)
    ? Math.round(Number(serverScoreData!.score))
    : null

  // 3) Direct tonen via fallback; live verversen zodra serverScore binnen is
  const fallbackScore = computeLocalScoreFromStatuses(itemNorm)
  const score = serverScore ?? fallbackScore ?? 50
  const scoreStatus: Advice = statusFromScore(score)

  const ma    = itemNorm?.ma
  const rsi   = itemNorm?.rsi
  const macd  = itemNorm?.macd
  const vol   = itemNorm?.volume

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

          {/* ★ ADDED: compacte koersgrafiek (geen wijzigingen elders) */}
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-2">
            <StockChart symbol={sym} range="6mo" interval="1d" height={200} />
          </div>
          {/* ★ END ADDED */}
        </section>

        <section className="max-w-6xl mx-auto px-4 pb-16">
          {snapErr && <div className="mb-3 text-red-500 text-sm">Fout bij laden: {String((snapErr as any)?.message || snapErr)}</div>}

          <div className="grid md:grid-cols-2 gap-4">
            {/* MA */}
            <div className="table-card p-4">
              <div className="flex items-center justify-between mb-1">
                <div className="font-semibold">MA50 vs MA200 (Golden/Death Cross)</div>
                <span className={`badge ${ma?.status==='BUY'?'badge-buy':ma?.status==='SELL'?'badge-sell':'badge-hold'}`}>{ma?.status || 'HOLD'}</span>
              </div>
              <div className="text-sm text-white/80">
                MA50: {fmt(ma?.ma50)} · MA200: {fmt(ma?.ma200)}
              </div>
            </div>

            {/* RSI */}
            <div className="table-card p-4">
              <div className="flex items-center justify-between mb-1">
                <div className="font-semibold">RSI ({rsi?.period ?? 14})</div>
                <span className={`badge ${rsi?.status==='BUY'?'badge-buy':rsi?.status==='SELL'?'badge-sell':'badge-hold'}`}>{rsi?.status || 'HOLD'}</span>
              </div>
              <div className="text-sm text-white/80">RSI: {fmt(rsi?.rsi)}</div>
            </div>

            {/* MACD */}
            <div className="table-card p-4">
              <div className="flex items-center justify-between mb-1">
                <div className="font-semibold">MACD (12/26/9)</div>
                <span className={`badge ${macd?.status==='BUY'?'badge-buy':macd?.status==='SELL'?'badge-sell':'badge-hold'}`}>{macd?.status || 'HOLD'}</span>
              </div>
              <div className="text-sm text-white/80">
                MACD: {fmt(macd?.macd)} · Signal: {fmt(macd?.signal)} · Hist: {fmt(macd?.hist)}
              </div>
            </div>

            {/* Volume */}
            <div className="table-card p-4">
              <div className="flex items-center justify-between mb-1">
                <div className="font-semibold">Volume vs 20d Average</div>
                <span className={`badge ${vol?.status==='BUY'?'badge-buy':vol?.status==='SELL'?'badge-sell':'badge-hold'}`}>{vol?.status || 'HOLD'}</span>
              </div>
              <div className="text-sm text-white/80">
                Vol: {fmt(vol?.volume, 0)} · Ave(20d): {fmt(vol?.avg20d, 0)} · Ratio: {fmt(vol?.ratio, 2)}
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