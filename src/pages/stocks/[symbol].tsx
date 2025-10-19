// src/pages/stocks/[symbol].tsx
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import useSWR from 'swr'
import ScoreBadge from '@/components/ScoreBadge'

type Advice = 'BUY' | 'HOLD' | 'SELL'
const toPtsFromStatus = (s?: Advice) => s === 'BUY' ? 2 : s === 'SELL' ? -2 : 0
const statusFromScore = (score: number): Advice => (score >= 66 ? 'BUY' : score <= 33 ? 'SELL' : 'HOLD')

type SnapItem = {
  symbol: string
  ma?:    { ma50: number | null; ma200: number | null; status?: Advice }
  rsi?:   { period: number; rsi: number | null; status?: Advice }
  macd?:  { macd: number | null; signal: number | null; hist: number | null; status?: Advice }
  volume?:{ volume: number | null; avg20d: number | null; ratio: number | null; status?: Advice }
}
type SnapResp = { items: SnapItem[]; updatedAt: number }

function fmt(v: number | null | undefined, d = 2) {
  return (v ?? v === 0) && Number.isFinite(v as number) ? (v as number).toFixed(d) : '—'
}

export default function StockDetail() {
  const router = useRouter()
  const sym = String(router.query.symbol || '').toUpperCase()

  const { data, error } = useSWR<SnapResp>(
    sym ? `/api/indicators/snapshot-list?symbols=${encodeURIComponent(sym)}` : null,
    (url) => fetch(url, { cache: 'no-store' }).then(r => r.json()),
    { refreshInterval: 30_000, revalidateOnFocus: false }
  )

  const item = data?.items?.[0]
  const ma    = item?.ma
  const rsi   = item?.rsi
  const macd  = item?.macd
  const vol   = item?.volume

  // Zelfde score-wegingsmodel als op de lijst
  const score = (() => {
    const toNorm = (p: number) => (p + 2) / 4
    const W_MA = 0.40, W_MACD = 0.30, W_RSI = 0.20, W_VOL = 0.10
    const pMA = toPtsFromStatus(ma?.status)
    const pMACD = toPtsFromStatus(macd?.status)
    const pRSI = toPtsFromStatus(rsi?.status)
    const pVOL = toPtsFromStatus(vol?.status)
    const agg = W_MA*toNorm(pMA) + W_MACD*toNorm(pMACD) + W_RSI*toNorm(pRSI) + W_VOL*toNorm(pVOL)
    return Math.round(Math.max(0, Math.min(1, agg)) * 100)
  })()

  return (
    <>
      <Head><title>{sym.replace('.AS','')} — SignalHub</title></Head>
      <main className="min-h-screen">
        <section className="max-w-6xl mx-auto px-4 pt-16 pb-8">
          <h1 className="hero">{sym.replace('.AS','')}</h1>
        </section>

        <section className="max-w-6xl mx-auto px-4 pb-16">
          {error && <div className="mb-3 text-red-600 text-sm">Fout bij laden: {String((error as any)?.message || error)}</div>}

          {/* Totaal advies */}
          <div className="table-card p-4 mb-4">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-gray-900">Totaal advies</div>
              <div className="origin-left scale-95">
                <ScoreBadge score={score} />
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {/* MA */}
            <div className="table-card p-4">
              <div className="flex items-center justify-between mb-1">
                <div className="font-semibold text-gray-900">MA50 vs MA200 (Golden/Death Cross)</div>
                <span className="badge badge-hold">{ma?.status || 'HOLD'}</span>
              </div>
              <div className="text-sm text-gray-700">
                MA50: {fmt(ma?.ma50)} · MA200: {fmt(ma?.ma200)}
              </div>
            </div>

            {/* RSI */}
            <div className="table-card p-4">
              <div className="flex items-center justify-between mb-1">
                <div className="font-semibold text-gray-900">RSI ({rsi?.period ?? 14})</div>
                <span className="badge badge-hold">{rsi?.status || 'HOLD'}</span>
              </div>
              <div className="text-sm text-gray-700">RSI: {fmt(rsi?.rsi)}</div>
            </div>

            {/* MACD */}
            <div className="table-card p-4">
              <div className="flex items-center justify-between mb-1">
                <div className="font-semibold text-gray-900">MACD (12/26/9)</div>
                <span className="badge badge-hold">{macd?.status || 'HOLD'}</span>
              </div>
              <div className="text-sm text-gray-700">
                MACD: {fmt(macd?.macd)} · Signaal: {fmt(macd?.signal)} · Hist: {fmt(macd?.hist)}
              </div>
            </div>

            {/* Volume */}
            <div className="table-card p-4">
              <div className="flex items-center justify-between mb-1">
                <div className="font-semibold text-gray-900">Volume vs 20d gemiddelde</div>
                <span className="badge badge-hold">{vol?.status || 'HOLD'}</span>
              </div>
              <div className="text-sm text-gray-700">
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