import { useRouter } from 'next/router'
import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import useSWR from 'swr'
import Link from 'next/link'
import { COINS } from '@/lib/coins'
import { computeScoreStatus } from '@/lib/taScore'
import ScoreBadge from '@/components/ScoreBadge'

const fetcher = (url: string) => fetch(url, { cache: 'no-store' }).then(r => r.json())

type Status = 'BUY' | 'HOLD' | 'SELL'
const statusFromScore = (s: number): Status => (s >= 66 ? 'BUY' : s <= 33 ? 'SELL' : 'HOLD')

const toBinancePair = (symbol: string) => {
  const s = (symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const skip = new Set(['USDT','USDC','BUSD','DAI','TUSD'])
  if (!s || skip.has(s)) return null
  return `${s}USDT`
}

type IndResp = {
  symbol: string
  ma?: { ma50: number|null; ma200: number|null; cross?: string }
  rsi?: number|null
  macd?: { macd: number|null; signal: number|null; hist: number|null }
  volume?: { volume: number|null; avg20d: number|null; ratio: number|null }
  error?: string
}
type PxItem = { symbol: string; price: number|null; d: number|null; w: number|null; m: number|null }

function formatFiat(n: number | null | undefined) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const v = Number(n)
  if (v >= 1000) return v.toLocaleString('nl-NL', { maximumFractionDigits: 0 })
  if (v >= 1)    return v.toLocaleString('nl-NL', { maximumFractionDigits: 2 })
  return v.toLocaleString('nl-NL', { maximumFractionDigits: 6 })
}
const fmtPct = (v: number | null | undefined) =>
  (v == null || !Number.isFinite(Number(v))) ? '—' : `${v >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`

function PageInner() {
  const router = useRouter()
  const slug = String(router.query.slug || '')
  const meta = useMemo(() => COINS.find(c => (c.slug || c.symbol.toLowerCase()) === slug), [slug])
  const name = meta?.name || slug.toUpperCase()
  const symbol = meta?.symbol || slug.toUpperCase()
  const pair = useMemo(() => toBinancePair(symbol.replace('-USD','')), [symbol])

  // prijzen
  const { data: pxData } = useSWR<{ results: PxItem[] }>(
    pair ? `/api/crypto-light/prices?symbols=${encodeURIComponent(pair)}` : null,
    fetcher,
    { refreshInterval: 15_000, revalidateOnFocus: false }
  )
  const px = pxData?.results?.[0]

  // indicators
  const { data: indData } = useSWR<{ results: IndResp[] }>(
    pair ? `/api/crypto-light/indicators?symbols=${encodeURIComponent(pair)}` : null,
    fetcher,
    { refreshInterval: 120_000, revalidateOnFocus: false }
  )
  const ind = indData?.results?.[0]

  // score/status via computeScoreStatus
  const { score } = useMemo(() => {
    const res = computeScoreStatus({
      ma: ind?.ma, rsi: ind?.rsi, macd: ind?.macd, volume: ind?.volume
    } as any)
    return res
  }, [ind])

  const status: Status = statusFromScore(score)

  // schrijf hint naar localStorage voor homepage/overview (ta:<PAIR>)
  useEffect(() => {
    if (!pair) return
    try {
      localStorage.setItem(`ta:${pair}`, JSON.stringify({ score, status, ts: Date.now() }))
      // storage event om andere tabs/pagina's te nudgen
      window.dispatchEvent(new StorageEvent('storage', { key: `ta:${pair}`, newValue: localStorage.getItem(`ta:${pair}`) }))
    } catch {}
  }, [pair, score, status])

  return (
    <main className="w-full overflow-x-hidden">
      <div className="max-w-5xl mx-auto p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="hero">{name} <span className="ticker">({symbol})</span></h1>
          <Link href="/crypto" className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 bg-white/10 text-white/80 ring-1 ring-white/15 hover:bg-white/15 transition">
            ← All crypto
          </Link>
        </div>

        {/* Price strip */}
        <div className="table-card mb-6">
          <div className="grid grid-cols-12 gap-3 items-center">
            <div className="col-span-6 sm:col-span-4">
              <div className="text-xs text-white/60 mb-1">Price</div>
              <div className="text-2xl font-extrabold">{formatFiat(px?.price)}</div>
            </div>
            <div className="col-span-6 sm:col-span-4">
              <div className="text-xs text-white/60 mb-1">24h</div>
              <div className={`text-lg font-semibold ${Number(px?.d ?? 0) >= 0 ? 'text-green-300' : 'text-red-300'}`}>{fmtPct(px?.d)}</div>
            </div>
            <div className="col-span-6 sm:col-span-2">
              <div className="text-xs text-white/60 mb-1">7d</div>
              <div className={`text-lg font-semibold ${Number(px?.w ?? 0) >= 0 ? 'text-green-300' : 'text-red-300'}`}>{fmtPct(px?.w)}</div>
            </div>
            <div className="col-span-6 sm:col-span-2">
              <div className="text-xs text-white/60 mb-1">30d</div>
              <div className={`text-lg font-semibold ${Number(px?.m ?? 0) >= 0 ? 'text-green-300' : 'text-red-300'}`}>{fmtPct(px?.m)}</div>
            </div>
          </div>
        </div>

        {/* Score + indicators */}
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <div className="table-card">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold">Signal</h3>
                <div className="inline-block"><ScoreBadge score={score} /></div>
              </div>

              <ul className="divide-y divide-white/10 text-sm">
                <li className="py-2 grid grid-cols-12">
                  <div className="col-span-5 text-white/70">Moving Averages (50/200)</div>
                  <div className="col-span-7 text-right">
                    {ind?.ma?.ma50 != null && ind?.ma?.ma200 != null
                      ? `${formatFiat(ind.ma.ma50)} / ${formatFiat(ind.ma.ma200)}`
                      : '—'}
                  </div>
                </li>
                <li className="py-2 grid grid-cols-12">
                  <div className="col-span-5 text-white/70">RSI (14)</div>
                  <div className="col-span-7 text-right">{ind?.rsi != null ? ind.rsi.toFixed(2) : '—'}</div>
                </li>
                <li className="py-2 grid grid-cols-12">
                  <div className="col-span-5 text-white/70">MACD / Signal / Hist</div>
                  <div className="col-span-7 text-right">
                    {ind?.macd?.macd != null && ind.macd.signal != null && ind.macd.hist != null
                      ? `${ind.macd.macd.toFixed(4)} / ${ind.macd.signal.toFixed(4)} / ${ind.macd.hist.toFixed(4)}`
                      : '—'}
                  </div>
                </li>
                <li className="py-2 grid grid-cols-12">
                  <div className="col-span-5 text-white/70">Volume (vs 20d)</div>
                  <div className="col-span-7 text-right">
                    {ind?.volume?.ratio != null ? `${(ind.volume.ratio * 100).toFixed(0)}%` : '—'}
                  </div>
                </li>
              </ul>
            </div>
          </div>

          {/* Sidebar */}
          <div className="lg:col-span-4">
            <div className="table-card">
              <h3 className="font-bold mb-2">Actions</h3>
              <div className="space-y-2 text-sm">
                <Link href="/crypto" className="inline-flex items-center gap-2 px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 transition">
                  ← Back to list
                </Link>
                <a
                  className="block text-white/70 hover:text-white underline"
                  href={`https://www.binance.com/en/trade/${pair}?type=spot`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open on Binance
                </a>
              </div>
            </div>
          </div>
        </div>

      </div>
    </main>
  )
}

export default dynamic(() => Promise.resolve(PageInner), { ssr: false })