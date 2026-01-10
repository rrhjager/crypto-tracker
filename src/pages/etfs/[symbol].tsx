// src/pages/etfs/[symbol].tsx
import { useRouter } from 'next/router'
import Link from 'next/link'
import { useMemo } from 'react'
import useSWR from 'swr'
import StockIndicatorCard from '@/components/StockIndicatorCard'
import { ETFS } from '@/lib/etfs'
import ScoreBadge from '@/components/ScoreBadge'

type Advice = 'BUY' | 'HOLD' | 'SELL'
type ScoreResp = { symbol: string; score: number | null }

type SnapItem = {
  symbol: string
  score?: number | null

  ma?: { ma50: number | null; ma200: number | null; status?: Advice }

  // tolerant: soms object, soms number
  rsi?: number | null | { period?: number; rsi: number | null; status?: Advice }

  macd?: { macd: number | null; signal: number | null; hist: number | null; status?: Advice }

  // let op: snapshot gebruikt avg20d
  volume?: { volume: number | null; avg20d: number | null; ratio: number | null; status?: Advice }
}
type SnapResp = { items: SnapItem[]; updatedAt?: number }

const statusFromScore = (score: number): Advice => (score >= 66 ? 'BUY' : score <= 33 ? 'SELL' : 'HOLD')

const fetcher = async <T,>(url: string): Promise<T> => {
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
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

export default function ETFDetail() {
  const router = useRouter()
  const symbol = (router.query.symbol as string) || ''
  const meta = useMemo(() => ETFS.find(t => t.symbol === symbol), [symbol])

  // 1) snapshot-list (indicatoren + (na API-fix) score)
  const { data, error, isLoading } = useSWR<SnapResp>(
    symbol ? `/api/indicators/snapshot-list?symbols=${encodeURIComponent(symbol)}` : null,
    fetcher,
    { refreshInterval: 30_000, revalidateOnFocus: false }
  )

  const item = normalize(data?.items?.[0] ?? null)
  const ma = item?.ma
  const rsi = item?.rsi
  const macd = item?.macd
  const vol20 = item?.volume

  // 2) canonical score
  const { data: serverScoreData } = useSWR<ScoreResp>(
    symbol ? `/api/indicators/score/${encodeURIComponent(symbol)}` : null,
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: false }
  )
  const serverScore =
    typeof serverScoreData?.score === 'number' && Number.isFinite(serverScoreData.score)
      ? Math.round(serverScoreData.score)
      : null

  // 3) combine: server → snapshot → 50
  const fallbackScore = item?.score ?? null
  const score = serverScore ?? fallbackScore ?? 50
  const advice: Advice = statusFromScore(score)

  const loading = isLoading
  const err = error ? String((error as any)?.message || error) : null

  const fmt = (v: number | null | undefined, d = 2) =>
    (v ?? v === 0) && Number.isFinite(v as number) ? (v as number).toFixed(d) : '—'

  return (
    <main className="min-h-screen">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <header className="space-y-1">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="hero">{meta?.name || 'Onbekende ETF'}</h1>
              <p className="sub">
                {symbol} · {advice}
                {serverScore == null && fallbackScore != null && (
                  <span className="ml-2 opacity-70">(preview via snapshot)</span>
                )}
              </p>
            </div>

            <div className="shrink-0">
              <ScoreBadge score={score} />
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
                    ? `MACD: ${fmt(macd.macd, 4)} — Signal: ${fmt(macd.signal, 4)} — Hist: ${fmt(macd.hist ?? 0, 4)}`
                    : 'Onvoldoende data voor MACD'
            }
          />

          <StockIndicatorCard
            title="Volume vs 20d Average"
            status={loading ? 'HOLD' : err ? 'HOLD' : (vol20?.status || 'HOLD')}
            note={
              loading
                ? 'Bezig met ophalen...'
                : err
                  ? `Fout: ${err}`
                  : vol20 && vol20.volume != null && vol20.avg20d != null
                    ? `Volume: ${Math.round(vol20.volume).toLocaleString()} — Ave.20d: ${Math.round(vol20.avg20d).toLocaleString()} — Ratio: ${fmt(vol20.ratio, 2)}`
                    : 'Onvoldoende data voor volume'
            }
          />
        </div>

        <div className="flex gap-3">
          <Link
            href="/etfs"
            className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-gray-100 px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-200"
          >
            <span aria-hidden>←</span>
            <span>Back to ETFs list</span>
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