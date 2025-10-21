// src/pages/dowjones/[symbol].tsx
import { useRouter } from 'next/router'
import Link from 'next/link'
import { useMemo } from 'react'
import useSWR from 'swr'
import StockIndicatorCard from '@/components/StockIndicatorCard'
import { DOWJONES } from '@/lib/dowjones'

type Advice = 'BUY' | 'HOLD' | 'SELL'

type SnapItem = {
  symbol: string
  ma?:    { ma50: number | null; ma200: number | null; status?: Advice }
  rsi?:   { period: number; rsi: number | null; status?: Advice }
  macd?:  { macd: number | null; signal: number | null; hist: number | null; status?: Advice }
  volume?:{ volume: number | null; avg20d: number | null; ratio: number | null; status?: Advice }
}
type SnapResp = { items: SnapItem[]; updatedAt: number }

export default function StockDetail() {
  const router = useRouter()
  const symbol = String(router.query.symbol || '').toUpperCase()
  const meta = useMemo(() => DOWJONES.find(t => t.symbol === symbol), [symbol])

  // Haal alles in één keer via snapshot-list (middleware-safe)
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

  const fmt = (v: number | null | undefined, d = 2) =>
    (v ?? v === 0) && Number.isFinite(v as number) ? (v as number).toFixed(d) : '—'

  return (
    <main className="min-h-screen">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <header className="space-y-1">
          <h1 className="hero">{meta?.name || 'Onbekend aandeel'}</h1>
          <p className="sub">{symbol}</p>
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
                  : ma
                    ? (ma.ma50 != null && ma.ma200 != null
                        ? `MA50: ${fmt(ma.ma50)} — MA200: ${fmt(ma.ma200)}`
                        : 'Nog onvoldoende data om MA50/MA200 te bepalen')
                    : '—'
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

        {/* Grijze knoppen – layout ongewijzigd */}
        <div className="flex gap-3">
          <Link
            href="/dowjones"
            className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-gray-100 px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-200"
          >
            <span aria-hidden>←</span>
            <span>Back to Dow Jones list</span>
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