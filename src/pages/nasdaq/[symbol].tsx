// src/pages/nasdaq/[symbol].tsx
import { useRouter } from 'next/router'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import StockIndicatorCard from '@/components/StockIndicatorCard'
import { NASDAQ } from '@/lib/nasdaq'
import ScoreBadge from '@/components/ScoreBadge'

type Advice = 'BUY' | 'HOLD' | 'SELL'

type SnapItem = {
  symbol: string
  ma?:    { ma50: number | null; ma200: number | null; status?: Advice }
  rsi?:   { period: number; rsi: number | null; status?: Advice }
  macd?:  { macd: number | null; signal: number | null; hist: number | null; status?: Advice }
  volume?:{ volume: number | null; avg20d: number | null; ratio: number | null; status?: Advice }
}
type SnapResp = { items: SnapItem[]; updatedAt: number }

function statusFromScore(score: number): Advice {
  if (score >= 66) return 'BUY'
  if (score <= 33) return 'SELL'
  return 'HOLD'
}

export default function StockDetail() {
  const router = useRouter()
  const symbol = String(router.query.symbol || '').toUpperCase()
  const meta = useMemo(() => NASDAQ.find(t => t.symbol === symbol), [symbol])

  // snapshot voor 1 symbool (middleware-safe)
  const { data, error, isLoading } = useSWR<SnapResp>(
    symbol ? `/api/indicators/snapshot-list?symbols=${encodeURIComponent(symbol)}` : null,
    (url) => fetch(url, { cache: 'no-store' }).then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    }),
    { refreshInterval: 30_000, revalidateOnFocus: false }
  )

  const item = data?.items?.[0]
  const ma    = item?.ma
  const rsi   = item?.rsi
  const macd  = item?.macd
  const vol20 = item?.volume

  // samengesteld advies (zelfde weging als lijsten; op basis van status)
  const totalScore = (() => {
    const toPts = (s?: Advice) => (s === 'BUY' ? 2 : s === 'SELL' ? -2 : 0)
    const toNorm = (p:number)=>(p+2)/4
    const W_MA = 0.40, W_MACD = 0.30, W_RSI = 0.20, W_VOL = 0.10
    const pMA   = toPts(ma?.status)
    const pMACD = toPts(macd?.status)
    const pRSI  = toPts(rsi?.status)
    const pVOL  = toPts(vol20?.status)
    const agg = W_MA*toNorm(pMA) + W_MACD*toNorm(pMACD) + W_RSI*toNorm(pRSI) + W_VOL*toNorm(pVOL)
    return Math.round(Math.max(0, Math.min(1, agg)) * 100)
  })()

  // helpers voor tekstjes
  const fmt = (v: number | null | undefined, d = 2) =>
    (v ?? v === 0) && Number.isFinite(v as number) ? (v as number).toFixed(d) : '—'

  const loading = isLoading
  const errMsg = error ? String((error as any)?.message || error) : null

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <header className="space-y-1">
          <div className="flex items-center justify-between">
            <h1 className="hero text-gray-900">{meta?.name || 'Onbekend aandeel'}</h1>
            {Number.isFinite(totalScore) && <ScoreBadge score={totalScore as number} />}
          </div>
          <p className="sub text-gray-600">{symbol}</p>
        </header>

        <div className="grid md:grid-cols-2 gap-4">
          <StockIndicatorCard
            title="MA50 vs MA200 (Golden/Death Cross)"
            status={loading ? 'HOLD' : errMsg ? 'HOLD' : (ma?.status || 'HOLD')}
            note={
              loading ? 'Bezig met ophalen...' :
              errMsg ? `Fout: ${errMsg}` :
              ma
                ? (ma.ma50 != null && ma.ma200 != null
                  ? `MA50: ${fmt(ma.ma50)} — MA200: ${fmt(ma.ma200)}`
                  : 'Nog onvoldoende data om MA50/MA200 te bepalen')
                : '—'
            }
          />

          <StockIndicatorCard
            title={`RSI (${rsi?.period ?? 14})`}
            status={loading ? 'HOLD' : errMsg ? 'HOLD' : (rsi?.status || 'HOLD')}
            note={
              loading ? 'Bezig met ophalen...' :
              errMsg ? `Fout: ${errMsg}` :
              rsi && rsi.rsi != null
                ? `RSI: ${fmt(rsi.rsi)}`
                : 'Onvoldoende data voor RSI'
            }
          />

          <StockIndicatorCard
            title="MACD (12/26/9)"
            status={loading ? 'HOLD' : errMsg ? 'HOLD' : (macd?.status || 'HOLD')}
            note={
              loading ? 'Bezig met ophalen...' :
              errMsg ? `Fout: ${errMsg}` :
              macd && macd.macd != null && macd.signal != null
                ? `MACD: ${fmt(macd.macd, 4)} — Signal: ${fmt(macd.signal, 4)} — Hist: ${fmt(macd.hist ?? 0, 4)}`
                : 'Onvoldoende data voor MACD'
            }
          />

          <StockIndicatorCard
            title="Volume vs 20d Average"
            status={loading ? 'HOLD' : errMsg ? 'HOLD' : (vol20?.status || 'HOLD')}
            note={
              loading ? 'Bezig met ophalen...' :
              errMsg ? `Fout: ${errMsg}` :
              vol20 && vol20.volume != null && vol20.avg20d != null
                ? `Volume: ${Math.round(vol20.volume).toLocaleString()} — Ave.20d: ${Math.round(vol20.avg20d).toLocaleString()} — Ratio: ${fmt(vol20.ratio, 2)}`
                : 'Onvoldoende data voor volume'
            }
          />
        </div>

        {/* Grijze, simpele knoppen — zelfde look & feel */}
        <div className="flex gap-3">
          <Link
            href="/nasdaq"
            className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-gray-100 px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-200"
          >
            <span aria-hidden>←</span>
            <span>Back to NASDAQ list</span>
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