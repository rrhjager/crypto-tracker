// src/pages/sp500/[symbol].tsx
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import useSWR from 'swr'
import { useMemo } from 'react'

type Advice = 'BUY' | 'HOLD' | 'SELL'
type Quote = {
  symbol: string
  regularMarketPrice: number | null
  regularMarketChange: number | null
  regularMarketChangePercent: number | null
  currency?: string
}

type Snapshot = {
  symbol: string
  ma?: {
    ma50: number | null
    ma200: number | null
    status?: Advice
    points?: number | null
  }
  rsi?: {
    period: number
    rsi: number | null
    status?: Advice
    points?: number | null
  }
  macd?: {
    macd: number | null
    signal: number | null
    hist: number | null
    status?: Advice
    points?: number | null
  }
  volume?: {
    volume: number | null
    avg20d: number | null
    ratio: number | null
    status?: Advice
    points?: number | null
  }
}

function num(v: number | null | undefined, d = 2) {
  return (v ?? v === 0) && Number.isFinite(v as number) ? (v as number).toFixed(d) : '—'
}
function fmtPrice(v: number | null | undefined, ccy?: string) {
  if (v == null || !Number.isFinite(v)) return '—'
  try {
    if (ccy) return new Intl.NumberFormat('en-US', { style: 'currency', currency: ccy }).format(v as number)
  } catch {}
  return (v as number).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
const pctCls = (p?: number | null) =>
  Number(p) > 0 ? 'text-green-600' : Number(p) < 0 ? 'text-red-600' : 'text-gray-500'

function statusFromScore(score: number): Advice {
  if (score >= 66) return 'BUY'
  if (score <= 33) return 'SELL'
  return 'HOLD'
}
const toPtsFromStatus = (status?: Advice) => status === 'BUY' ? 2 : status === 'SELL' ? -2 : 0
const badgeCls = (s?: Advice) =>
  s === 'BUY' ? 'badge badge-buy' : s === 'SELL' ? 'badge badge-sell' : 'badge badge-hold'

export default function Sp500SymbolPage() {
  const router = useRouter()
  const symbol = String(router.query.symbol || '').toUpperCase()

  // ===== Quotes (single) =====
  const { data: qData, error: qErr } = useSWR<{ quotes: Record<string, Quote> }>(
    symbol ? `/api/quotes?symbols=${encodeURIComponent(symbol)}` : null,
    (url) => fetch(url, { cache: 'no-store' }).then(r => r.json()),
    { refreshInterval: 20_000, revalidateOnFocus: false }
  )
  const quote = qData?.quotes?.[symbol]
  const price = fmtPrice(quote?.regularMarketPrice, quote?.currency || 'USD')
  const chg = quote?.regularMarketChange
  const pct = quote?.regularMarketChangePercent

  // ===== Snapshot (one call for all indicators) =====
  const { data: snap, error: snapErr } = useSWR<{ item: Snapshot }>(
    symbol ? `/api/indicators/snapshot?symbol=${encodeURIComponent(symbol)}` : null,
    (url) => fetch(url, { cache: 'no-store' }).then(r => r.json()),
    { refreshInterval: 30_000, revalidateOnFocus: false }
  )

  // totaalscore zoals op de lijstpagina (zelfde weging)
  const totalScore = useMemo(() => {
    const it = snap?.item
    if (!it) return 50
    const toNorm = (pts: number) => (pts + 2) / 4
    const W_MA = 0.40, W_MACD = 0.30, W_RSI = 0.20, W_VOL = 0.10
    const pMA   = toPtsFromStatus(it.ma?.status)
    const pMACD = toPtsFromStatus(it.macd?.status)
    const pRSI  = toPtsFromStatus(it.rsi?.status)
    const pVOL  = toPtsFromStatus(it.volume?.status)
    const agg = W_MA*toNorm(pMA) + W_MACD*toNorm(pMACD) + W_RSI*toNorm(pRSI) + W_VOL*toNorm(pVOL)
    return Math.round(Math.max(0, Math.min(1, agg)) * 100)
  }, [snap])

  const totalAdvice: Advice = statusFromScore(totalScore)

  return (
    <>
      <Head><title>{symbol} — SignalHub</title></Head>

      <main className="min-h-screen">
        <section className="max-w-5xl mx-auto px-4 pt-16 pb-4">
          <h1 className="hero">
            <span className="mr-3">{/* naam kun je optioneel uit je SP500 tabel halen */}</span>
            {symbol}
          </h1>
          <div className="text-gray-500">{symbol}</div>
        </section>

        <section className="max-w-5xl mx-auto px-4 pb-16 space-y-4">
          {/* Totaal advies */}
          <div className="table-card p-4 flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-600">Totaal advies</div>
              <div className="text-2xl font-semibold text-gray-900">
                {price}
                <span className={`ml-3 text-base ${pctCls(pct)}`}>
                  {Number.isFinite(chg as number) && Number.isFinite(pct as number)
                    ? `${chg! >= 0 ? '+' : ''}${num(chg, 2)} (${pct! >= 0 ? '+' : ''}${num(pct, 2)}%)`
                    : ''}
                </span>
              </div>
              {qErr && <div className="text-red-600 text-xs mt-1">Fout bij laden prijs: {String((qErr as any)?.message || qErr)}</div>}
            </div>
            <span className={badgeCls(totalAdvice)}>{totalAdvice} · {totalScore}</span>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {/* MA */}
            <div className="table-card p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="font-medium text-gray-900">MA50 vs MA200 (Golden/Death Cross)</div>
                <span className={badgeCls(snap?.item?.ma?.status)}>{snap?.item?.ma?.status || 'HOLD'}</span>
              </div>
              {snapErr
                ? <div className="text-sm text-red-600">Fout: {String((snapErr as any)?.message || snapErr)}</div>
                : (
                  <div className="text-sm text-gray-700">
                    MA50: {num(snap?.item?.ma?.ma50)} — MA200: {num(snap?.item?.ma?.ma200)}
                  </div>
                )
              }
            </div>

            {/* RSI */}
            <div className="table-card p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="font-medium text-gray-900">RSI (14)</div>
                <span className={badgeCls(snap?.item?.rsi?.status)}>{snap?.item?.rsi?.status || 'HOLD'}</span>
              </div>
              {snapErr
                ? <div className="text-sm text-red-600">Fout: {String((snapErr as any)?.message || snapErr)}</div>
                : (
                  <div className="text-sm text-gray-700">
                    RSI: {num(snap?.item?.rsi?.rsi)}
                  </div>
                )
              }
            </div>

            {/* MACD */}
            <div className="table-card p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="font-medium text-gray-900">MACD (12/26/9)</div>
                <span className={badgeCls(snap?.item?.macd?.status)}>{snap?.item?.macd?.status || 'HOLD'}</span>
              </div>
              {snapErr
                ? <div className="text-sm text-red-600">Fout: {String((snapErr as any)?.message || snapErr)}</div>
                : (
                  <div className="text-sm text-gray-700">
                    MACD: {num(snap?.item?.macd?.macd)} — Signaal: {num(snap?.item?.macd?.signal)} — Hist: {num(snap?.item?.macd?.hist)}
                  </div>
                )
              }
            </div>

            {/* Volume */}
            <div className="table-card p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="font-medium text-gray-900">Volume vs 20d gemiddelde</div>
                <span className={badgeCls(snap?.item?.volume?.status)}>{snap?.item?.volume?.status || 'HOLD'}</span>
              </div>
              {snapErr
                ? <div className="text-sm text-red-600">Fout: {String((snapErr as any)?.message || snapErr)}</div>
                : (
                  <div className="text-sm text-gray-700">
                    Vol: {num(snap?.item?.volume?.volume, 0)} — Gem(20d): {num(snap?.item?.volume?.avg20d, 0)} — Ratio: {num(snap?.item?.volume?.ratio)}
                  </div>
                )
              }
            </div>
          </div>

          <div className="flex gap-3">
            <Link href="/sp500" className="btn-secondary">← Back to S&amp;P 500 list</Link>
            <Link href="/" className="btn-secondary">Go to homepage</Link>
          </div>
        </section>
      </main>
    </>
  )
}