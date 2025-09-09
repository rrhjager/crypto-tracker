// src/pages/coin/[slug].tsx
import { useRouter } from 'next/router'
import useSWR from 'swr'
import Link from 'next/link'
import { useEffect, useRef, useMemo } from 'react'
import NewsFeed from '../../components/NewsFeed'

const fetcher = (url: string) =>
  fetch(url).then(async (r) => {
    const data = await r.json().catch(() => null)
    if (!r.ok) {
      const msg = (data && (data.error || data.message)) || `HTTP ${r.status}`
      const err = new Error(msg) as Error & { status?: number }
      err.status = r.status
      throw err
    }
    return data
  })

type Breakdown = {
  tvSignal: number | null
  momentum: number | null
  volumeTrend: number | null
  volatilityRegime: number | null
  funding: number | null
  openInterest: number | null
  longShortSkew: number | null
  breadth: number | null
  fearGreed: number | null
  yield: number | null
}

type Row = { key: keyof Breakdown; label: string }

const ROWS: Row[] = [
  { key: 'tvSignal',         label: 'Technische Analyse' },
  { key: 'momentum',         label: 'Momentum (RSI/MACD/MA)' },
  { key: 'volumeTrend',      label: 'Volume-trend' },
  { key: 'volatilityRegime', label: 'Volatility Regime' },
  { key: 'funding',          label: 'Funding Rate' },
  { key: 'openInterest',     label: 'Open Interest' },
  { key: 'longShortSkew',    label: 'Long/Short Skew' },
  { key: 'yield',            label: 'Yield (DeFi)' },
  // breadth/fearGreed staan als marktbadges erboven
]

function pctOrNA(v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return 'N/A'
  return `${Math.round(Number(v) * 100)}%`
}
function verdictFrom(v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return { label: 'N/A', cls: 'badge' }
  const s = Math.round(Number(v) * 100)
  if (s >= 66) return { label: 'BUY', cls: 'badge-buy' }
  if (s <= 33) return { label: 'SELL', cls: 'badge-sell' }
  return { label: 'HOLD', cls: 'badge-hold' }
}

// Eenvoudige fiat formatter (zelfde stijl als homepage)
function formatFiat(n: number | null | undefined) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const v = Number(n)
  if (v >= 1000) return v.toLocaleString('nl-NL', { maximumFractionDigits: 0 })
  if (v >= 1)    return v.toLocaleString('nl-NL', { maximumFractionDigits: 2 })
  return v.toLocaleString('nl-NL', { maximumFractionDigits: 6 })
}

export default function CoinDetail() {
  const router = useRouter()
  const slug = String(router.query.slug || '')

  // hoofddata
  const { data, error } = useSWR('/api/v1/coins', fetcher, {
    refreshInterval: 55_000,
    revalidateOnFocus: true,
  })

  if (error) return <main className="p-6">Kon data niet laden: {error.message}</main>
  if (!data) return <main className="p-6">Laden…</main>

  const coin = (data.results || []).find((c: any) => c.slug === slug)
  if (!coin) {
    return (
      <main className="p-6">
        <div className="mb-4"><Link href="/" className="link">← Terug</Link></div>
        Coin niet gevonden.
      </main>
    )
  }

  // ➊ Volume-trend apart ophalen
  const symbol = String(coin.symbol || '').toUpperCase()
  const { data: volResp } = useSWR(
    symbol ? `/api/v1/volume-trend/${encodeURIComponent(symbol)}` : null,
    fetcher,
    { refreshInterval: 5 * 60_000, revalidateOnFocus: false }
  )

  // ➋ Breakdown verrijken met volumeTrend wanneer beschikbaar
  const breakdown: Breakdown = useMemo(() => {
    const b = (coin.breakdown || {}) as Breakdown
    const vt = volResp?.volumeTrend
    return {
      ...b,
      volumeTrend: (typeof vt === 'number' ? vt : b?.volumeTrend ?? null),
    }
  }, [coin.breakdown, volResp?.volumeTrend])

  // ➌ Live prijs ophalen (15s refresh)
  const { data: priceResp } = useSWR(
    symbol ? `/api/v1/prices?symbols=${encodeURIComponent(symbol)}` : null,
    fetcher,
    { refreshInterval: 15_000, revalidateOnFocus: false }
  )
  const livePrice: number | null = priceResp?.prices?.[symbol] ?? null

  // ── TradingView widget
  const tvRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!tvRef.current) return
    tvRef.current.innerHTML = ''
    const script = document.createElement('script')
    script.src = 'https://s3.tradingview.com/tv.js'
    script.async = true
    script.onload = () => {
      const TV = (window as any).TradingView
      if (!TV) return
      const tvSymbol = `BINANCE:${symbol}USDT`
      new TV.widget({
        autosize: true,
        symbol: tvSymbol,
        interval: '60',
        timezone: 'Etc/UTC',
        theme: 'dark',
        style: '1',
        locale: 'nl',
        toolbar_bg: 'rgba(0,0,0,0)',
        hide_top_toolbar: false,
        hide_legend: false,
        container_id: `tv_${slug}`,
      })
    }
    document.body.appendChild(script)
    return () => {
      script.remove()
      if (tvRef.current) tvRef.current.innerHTML = ''
    }
  }, [slug, symbol])

  const RowView = ({ label, value }: { label: string; value: number | null | undefined }) => {
    const v = verdictFrom(value)
    return (
      <tr className="border-t border-white/5">
        <td className="py-3">{label}</td>
        <td className="py-3 text-right">{pctOrNA(value)}</td>
        <td className="py-3 text-right"><span className={v.cls}>{v.label}</span></td>
      </tr>
    )
  }

  return (
    <main className="p-6 max-w-5xl mx-auto">
      <div className="mb-4 flex items-center justify-between">
        <Link href="/" className="link">← Terug</Link>
        <div className="text-white/50 text-sm">
          Laatste update: {data.updatedAt ? new Date(data.updatedAt).toLocaleTimeString() : '—'}
        </div>
      </div>

      <header className="mb-6">
        <h1 className="hero">
          {coin.name} <span className="ticker">({coin.symbol})</span>
        </h1>

        {/* Live prijs onder de titel */}
        <p className="sub mt-1">
          Prijs: {livePrice != null ? <>${formatFiat(livePrice)}</> : '—'}
        </p>

        <p className="sub mt-2">
          24h {Number(coin?.perf?.d ?? 0).toFixed(2)}% · 7d {Number(coin?.perf?.w ?? 0).toFixed(2)}% · 30d {Number(coin?.perf?.m ?? 0).toFixed(2)}%
        </p>
      </header>

      {/* Marktbrede badges */}
      <section className="table-card mb-6">
        <div className="flex items-center justify-between">
          <div className="font-bold">Markt</div>
          <div className="text-sm text-white/70">
            Breadth: {coin?.meta?.breadth?.pct != null ? `${Math.round(coin.meta.breadth.pct * 100)}% groen` : '—'}
            <span className="mx-2">·</span>
            Fear &amp; Greed: {coin?.meta?.fng ?? '—'}
          </div>
        </div>
      </section>

      {/* Totaal advies */}
      <section className="table-card mb-6">
        <div className="flex items-center justify-between">
          <div className="font-bold">Totaal advies</div>
          <div>
            <span className={`${coin.score >= 66 ? 'badge-buy' : coin.score <= 33 ? 'badge-sell' : 'badge-hold'}`}>
              {coin.status} · {coin.score}
            </span>
          </div>
        </div>
      </section>

      {/* Indicatorentabel */}
      <section className="table-card overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-white/60">
            <tr>
              <th className="text-left py-2">Indicator</th>
              <th className="text-right py-2">Score</th>
              <th className="text-right py-2">Advies</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(r => (
              <RowView key={r.key} label={r.label} value={breakdown?.[r.key]} />
            ))}
          </tbody>
        </table>
      </section>

      {/* TradingView chart */}
      <section className="table-card mt-6">
        <h3 className="font-bold mb-2">Live chart</h3>
        <div id={`tv_${slug}`} ref={tvRef} style={{ height: 520, width: '100%' }} />
      </section>

      {/* Nieuws */}
      <section className="table-card mt-6">
        <h3 className="font-bold mb-2">Laatste nieuws</h3>
        <NewsFeed symbol={coin.symbol} name={coin.name} />
      </section>
    </main>
  )
}