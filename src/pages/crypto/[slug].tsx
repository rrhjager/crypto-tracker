// src/pages/crypto/[slug].tsx
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/router'
import useSWR from 'swr'
import { useMemo, useEffect, useState } from 'react'
import { COINS } from '@/lib/coins'
import TradingViewChart from '@/components/TradingViewChart'
import ScoreBadge from '@/components/ScoreBadge'

type Status = 'BUY' | 'HOLD' | 'SELL'

type IndResp = {
  symbol: string
  ma?: {
    ma50: number | null
    ma200: number | null
    cross?: 'Golden Cross' | 'Death Cross' | '—'
  }
  rsi?: number | null
  macd?: { macd: number | null; signal: number | null; hist: number | null }
  volume?: { volume: number | null; avg20d: number | null; ratio: number | null }
  score?: number
  status?: Status
  error?: string
}

// ⬇️ no-store fetcher
const fetcher = (u: string) => fetch(u, { cache: 'no-store' }).then(r => r.json())

const pill = (s: Status) =>
  s === 'BUY' ? 'badge-buy' : s === 'SELL' ? 'badge-sell' : 'badge-hold'

const lightPill =
  'inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm ' +
  'bg-white/10 text-white/80 ring-1 ring-white/15 ' +
  'hover:bg-white/15 hover:text-white transition'

// Binance-pair helper
const toBinancePair = (symbol: string) => {
  const s = (symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const skip = new Set(['USDT', 'USDC', 'BUSD', 'DAI', 'TUSD'])
  if (!s || skip.has(s)) return null
  return `${s}USDT`
}

function saveLocalTA(symUSDT: string, score: number, status: Status) {
  try {
    localStorage.setItem(`ta:${symUSDT}`, JSON.stringify({ score, status, ts: Date.now() }))
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: `ta:${symUSDT}`,
        newValue: localStorage.getItem(`ta:${symUSDT}`),
      })
    )
  } catch {}
}

function fmtNum(n: number | null | undefined, d = 2) {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toFixed(d)
}
function formatFiat(n: number | null | undefined) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const v = Number(n)
  if (v >= 1000) return v.toLocaleString('nl-NL', { maximumFractionDigits: 0 })
  if (v >= 1) return v.toLocaleString('nl-NL', { maximumFractionDigits: 2 })
  return v.toLocaleString('nl-NL', { maximumFractionDigits: 6 })
}
function fmtInt(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return '—'
  return Math.round(n).toLocaleString('nl-NL')
}

// Consistent with computeScoreStatus (momentum interpretation)
const statusMA = (ma50?: number | null, ma200?: number | null): Status => {
  if (ma50 == null || ma200 == null) return 'HOLD'
  if (ma50 > ma200) return 'BUY'
  if (ma50 < ma200) return 'SELL'
  return 'HOLD'
}
const statusRSI = (r?: number | null): Status => {
  if (r == null) return 'HOLD'
  if (r > 70) return 'BUY'
  if (r < 30) return 'SELL'
  return 'HOLD'
}
const statusMACD = (h?: number | null): Status => {
  if (h == null) return 'HOLD'
  if (h > 0) return 'BUY'
  if (h < 0) return 'SELL'
  return 'HOLD'
}
const statusVolume = (ratio?: number | null): Status => {
  if (ratio == null) return 'HOLD'
  if (ratio > 1.2) return 'BUY'
  if (ratio < 0.8) return 'SELL'
  return 'HOLD'
}

function PageInner() {
  const { query } = useRouter()
  const raw = String(query.slug || '')
  const slug = raw.toLowerCase()

  // 🔧 FLEXIBLE COIN RESOLUTION
  const coin = useMemo(() => {
    const aliases = new Set<string>()
    const s = slug.replace(/_/g, '-')
    aliases.add(s)
    if (s.endsWith('-usd')) aliases.add(s.slice(0, -4))
    else aliases.add(`${s}-usd`)
    if (s.endsWith('usdt')) {
      aliases.add(s.slice(0, -4))
      aliases.add(s.slice(0, -4) + '-usd')
    }
    aliases.add(s.replace(/-/g, ''))
    if (!s.includes('-')) aliases.add(s + '-usd')

    return COINS.find((c: any) => {
      const sym = String(c.symbol || '').toLowerCase()
      const base = sym.replace(/-usd$/, '')
      const alt = String(c.slug || '').toLowerCase() || ''
      return aliases.has(sym) || aliases.has(base) || (alt && aliases.has(alt))
    })
  }, [slug])

  const binanceFromList = (coin as any)?.pairUSD?.binance || null
  const binance = binanceFromList || (coin ? toBinancePair(coin.symbol) : null)

  const tvSymbol = useMemo(() => {
    const base = (coin?.symbol || '').toUpperCase()
    if (binance) return `BINANCE:${binance}`
    if (base) return `OKX:${base}USDT`
    return 'BINANCE:BTCUSDT'
  }, [coin, binance])

  // minute cache-buster
  const [minuteTag, setMinuteTag] = useState(Math.floor(Date.now() / 60_000))
  useEffect(() => {
    const id = setInterval(() => setMinuteTag(Math.floor(Date.now() / 60_000)), 60_000)
    return () => clearInterval(id)
  }, [])

  const { data } = useSWR<{ results: IndResp[]; debug?: any }>(
    binance ? `/api/crypto-light/indicators?symbols=${encodeURIComponent(binance)}&v=${minuteTag}` : null,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 120_000 }
  )
  const ind: IndResp | undefined = (data?.results || [])[0]

  // ✅ Use server-calculated unified score/status (no re-compute here)
  const overallScore =
    typeof ind?.score === 'number' && Number.isFinite(ind.score) ? ind.score : 50
  const overallStatus: Status =
    ind?.status === 'BUY' || ind?.status === 'SELL' || ind?.status === 'HOLD'
      ? ind.status
      : overallScore >= 66
        ? 'BUY'
        : overallScore <= 33
          ? 'SELL'
          : 'HOLD'

  const { data: pxData } = useSWR<{ results: { symbol: string; price: number | null }[] }>(
    binance ? `/api/crypto-light/prices?symbols=${encodeURIComponent(binance)}&v=${minuteTag}` : null,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 15_000 }
  )
  const price = pxData?.results?.[0]?.price ?? null

  useEffect(() => {
    if (!binance) return
    saveLocalTA(binance, overallScore, overallStatus)
  }, [binance, overallScore, overallStatus])

  if (!coin) {
    return (
      <main className="max-w-4xl mx-auto p-6">
        <h1 className="hero">Niet gevonden</h1>
        <p className="sub mb-6">Deze coin bestaat niet in je COINS-lijst.</p>
        <Link href="/crypto" className={lightPill}>
          ← Back to Crypto
        </Link>
      </main>
    )
  }

  return (
    <main className="max-w-5xl mx-auto p-6">
      {/* === Header + totaal-advies rechts (zelfde stijl als stocks) === */}
      <section className="pt-2 pb-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight text-white">{coin.name}</h1>
            <div className="text-white/70 text-lg">{coin.symbol}</div>
            <div className="mt-1 text-white/80">
              <span className="text-sm">Prijs:</span>{' '}
              <span className="font-semibold">{formatFiat(price)} </span>
              <span className="text-white/60 text-sm">(USD)</span>
            </div>
          </div>

          <div className="origin-left scale-95">
            {Number.isFinite(overallScore as number) ? (
              <ScoreBadge score={overallScore} />
            ) : (
              <span className="badge badge-hold">HOLD · 50</span>
            )}
          </div>
        </div>

        {/* Optioneel: laat unified status zien (zelfde als in API) */}
        <div className="mt-2 text-white/60 text-sm">
          Overall: <span className="font-semibold text-white/80">{overallStatus}</span>
        </div>

        {/* Als er een API error is, toon het subtiel */}
        {ind?.error ? (
          <div className="mt-2 text-sm text-red-200/90">
            Indicator error: {String(ind.error)}
          </div>
        ) : null}
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        <div className="table-card p-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold">MA50 vs MA200 (Golden/Death Cross)</h3>
            <span className={pill(statusMA(ind?.ma?.ma50 ?? null, ind?.ma?.ma200 ?? null))}>
              {statusMA(ind?.ma?.ma50 ?? null, ind?.ma?.ma200 ?? null)}
            </span>
          </div>
          <div className="text-white/80 text-sm">
            MA50: {fmtNum(ind?.ma?.ma50, 2)} — MA200: {fmtNum(ind?.ma?.ma200, 2)}
          </div>
        </div>

        <div className="table-card p-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold">RSI (14)</h3>
            <span className={pill(statusRSI(ind?.rsi ?? null))}>
              {statusRSI(ind?.rsi ?? null)}
            </span>
          </div>
          <div className="text-white/80 text-sm">RSI: {fmtNum(ind?.rsi ?? null, 2)}</div>
        </div>

        <div className="table-card p-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold">MACD (12/26/9)</h3>
            <span className={pill(statusMACD(ind?.macd?.hist ?? null))}>
              {statusMACD(ind?.macd?.hist ?? null)}
            </span>
          </div>
          <div className="text-white/80 text-sm">
            MACD: {fmtNum(ind?.macd?.macd ?? null, 4)} — Signaal:{' '}
            {fmtNum(ind?.macd?.signal ?? null, 4)} — Hist: {fmtNum(ind?.macd?.hist ?? null, 4)}
          </div>
        </div>

        <div className="table-card p-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold">Volume vs 20d gemiddelde</h3>
            <span className={pill(statusVolume(ind?.volume?.ratio ?? null))}>
              {statusVolume(ind?.volume?.ratio ?? null)}
            </span>
          </div>
          <div className="text-white/80 text-sm">
            Volume: {fmtInt(ind?.volume?.volume ?? null)} — Gem.20d:{' '}
            {fmtInt(ind?.volume?.avg20d ?? null)} — Ratio: {fmtNum(ind?.volume?.ratio ?? null, 2)}
          </div>
        </div>
      </section>

      <section className="mt-6">
        <TradingViewChart tvSymbol={tvSymbol} height={480} theme="dark" interval="D" locale="nl_NL" />
      </section>

      <section className="mt-6 flex gap-3">
        <Link href="/crypto" className={lightPill}>
          ← Back to Crypto
        </Link>
        <Link href="/" className={lightPill}>
          Go to homepage
        </Link>
      </section>
    </main>
  )
}

export default dynamic(() => Promise.resolve(PageInner), { ssr: false })