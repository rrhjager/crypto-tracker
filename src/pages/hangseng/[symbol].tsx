// src/pages/hangseng/[symbol].tsx
import { useRouter } from 'next/router'
import Link from 'next/link'
import { useMemo } from 'react'
import useSWR from 'swr'
import StockIndicatorCard from '@/components/StockIndicatorCard'
import { HANGSENG as AEX } from '@/lib/hangseng'
import ScoreBadge from '@/components/ScoreBadge'

type Advice = 'BUY' | 'HOLD' | 'SELL'

type SnapItem = {
  symbol: string
  ma?:    { ma50: number | null; ma200: number | null; status?: Advice }
  rsi?:   { period: number; rsi: number | null; status?: Advice }
  macd?:  { macd: number | null; signal: number | null; hist: number | null; status?: Advice }
  // let op: snapshot gebruikt avg20d i.p.v. avg20
  volume?:{ volume: number | null; avg20d: number | null; ratio: number | null; status?: Advice }
}
type SnapResp = { items: SnapItem[]; updatedAt: number }

const toPtsFromStatus = (s?: Advice) => (s === 'BUY' ? 2 : s === 'SELL' ? -2 : 0)
const toNorm = (p: number) => (p + 2) / 4
const statusFromScore = (score: number): Advice =>
  score >= 66 ? 'BUY' : score <= 33 ? 'SELL' : 'HOLD'

export default function StockDetail() {
  const router = useRouter()
  const symbol = String(router.query.symbol || '')
  const meta = useMemo(() => AEX.find(t => t.symbol === symbol), [symbol])

  // 1) Eén batch-call voor alle indicatoren (middleware-vriendelijk)
  const { data, error, isLoading } = useSWR<SnapResp>(
    symbol ? `/api/indicators/snapshot-list?symbols=${encodeURIComponent(symbol)}` : null,
    (url) => fetch(url, { cache: 'no-store' }).then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    }),
    { refreshInterval: 30_000, revalidateOnFocus: false }
  )

  const item  = data?.items?.[0]
  const ma    = item?.ma
  const rsi   = item?.rsi
  const macd  = item?.macd
  const vol20 = item?.volume

  const loading = isLoading
  const err = error ? String((error as any)?.message || error) : null

  // 2) Samengestelde score (zelfde wegingen als elders)
  const W_MA = 0.40, W_MACD = 0.30, W_RSI = 0.20, W_VOL = 0.10
  const pMA   = toPtsFromStatus(ma?.status)
  const pMACD = toPtsFromStatus(macd?.status)
  const pRSI  = toPtsFromStatus(rsi?.status)
  const pVOL  = toPtsFromStatus(vol20?.status)
  const agg = W_MA*toNorm(pMA) + W_MACD*toNorm(pMACD) + W_RSI*toNorm(pRSI) + W_VOL*toNorm(pVOL)
  const score = Math.round(Math.max(0, Math.min(1, agg)) * 100)
  const advice: Advice = statusFromScore(score)

  const fmt = (v: number | null | undefined, d = 2) =>
    (v ?? v === 0) && Number.isFinite(v as number) ? (v as number).toFixed(d) : '—'

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <header className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="hero">{meta?.name || 'Onbekend aandeel'}</h1>
              <p className="sub text-gray-500">{symbol} · {advice}</p>
            </div>
            {/* Hoofd-advies badge (consistent met andere pagina's) */}
            <div className="shrink-0">
              {Number.isFinite(score as number)
                ? <ScoreBadge score={score as number} />
                : <span className="badge badge-hold">HOLD · 50</span>}
            </div>
          </div>
        </header>

        <div className="grid md:grid-cols-2 gap-4">
          <StockIndicatorCard
            title="MA50 vs MA200 (Golden/Death Cross)"
            status={loading ? 'HOLD' : err ? 'HOLD' : (ma?.status || 'HOLD')}
            note={
              loading
                ? 'Bezig met ophalen...'
                : err
                  ? `Fout: ${err}`
                  : ma && ma.ma50 != null && ma.ma200 != null
                    ? `MA50: ${fmt(ma.ma50)} — MA200: ${fmt(ma.ma200)}`
                    : 'Nog onvoldoende data om MA50/MA200 te bepalen'
            }
          />
          <StockIndicatorCard
            title={`RSI (${rsi?.period ?? 14})`}
            status={loading ? 'HOLD' : err ? 'HOLD' : (rsi?.status || 'HOLD')}
            note={
              loading
                ? 'Bezig met ophalen...'
                : err
                  ? `Fout: ${err}`
                  : rsi && rsi.rsi != null
                    ? `RSI: ${fmt(rsi.rsi)}`
                    : 'Onvoldoende data voor RSI'
            }
          />
          <StockIndicatorCard
            title="MACD (12/26/9)"
            status={loading ? 'HOLD' : err ? 'HOLD' : (macd?.status || 'HOLD')}
            note={
              loading
                ? 'Bezig met ophalen...'
                : err
                  ? `Fout: ${err}`
                  : macd && macd.macd != null && macd.signal != null
                    ? `MACD: ${fmt(macd.macd, 4)} — Signaal: ${fmt(macd.signal, 4)} — Hist: ${fmt(macd.hist ?? 0, 4)}`
                    : 'Onvoldoende data voor MACD'
            }
          />
          <StockIndicatorCard
            title="Volume vs 20d gemiddelde"
            status={loading ? 'HOLD' : err ? 'HOLD' : (vol20?.status || 'HOLD')}
            note={
              loading
                ? 'Bezig met ophalen...'
                : err
                  ? `Fout: ${err}`
                  : vol20 && vol20.volume != null && vol20.avg20d != null
                    ? `Volume: ${Math.round(vol20.volume).toLocaleString()} — Gem.20d: ${Math.round(vol20.avg20d).toLocaleString()} — Ratio: ${fmt(vol20.ratio, 2)}`
                    : 'Onvoldoende data voor volume'
            }
          />
        </div>

        {/* Grijze, simpele knoppen — consistent met andere pagina's */}
        <div className="flex gap-3">
          <Link
            href="/hangseng"
            className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-gray-100 px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-200"
          >
            <span aria-hidden>←</span>
            <span>Back to Hang Seng list</span>
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-gray-100 px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-200"
          >
            Go to homepage
          </Link>
        </div>
      </div>
    </main>
  )
}