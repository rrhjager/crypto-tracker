// src/pages/intel/index.tsx
import Head from 'next/head'
import Link from 'next/link'
import useSWR from 'swr'
import { useMemo, useState } from 'react'

type Row = {
  publishedISO: string | null
  publishedLabel: string
  tradedISO: string | null
  tradedLabel: string
  person: string
  ticker: string
  amount: string
  price: string
  side: 'BUY' | 'SELL' | '—'
}

const fetcher = (url: string) =>
  fetch(url).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  })

function sideBadge(side: Row['side']) {
  const base = 'px-2 py-1 rounded text-xs font-semibold'
  if (side === 'BUY')  return `${base} badge-buy`
  if (side === 'SELL') return `${base} badge-sell`
  return `${base} badge-hold`
}

export default function CongressTradingPage() {
  const [symbolFilter, setSymbolFilter] = useState('')

  // Client-side data load (geen SSR -> geen 502)
  const { data, error, isValidating, mutate } = useSWR<{ items: Row[] }>(
    '/api/market/congress?limit=50',
    fetcher,
    { revalidateOnFocus: false }
  )

  const items = data?.items ?? []

  // client-side filter op ticker
  const rows = useMemo(() => {
    const f = symbolFilter.trim().toUpperCase()
    if (!f) return items
    return items.filter(it => (it.ticker || '').toUpperCase().includes(f))
  }, [items, symbolFilter])

  return (
    <>
      <Head><title>Congress Trading — SignalHub</title></Head>
      <main className="min-h-screen">
        <section className="max-w-6xl mx-auto px-4 pt-16 pb-8">
          <h1 className="hero">Congress Trading</h1>
          {error && (
            <p className="mt-2 text-sm text-red-500">
              Fout bij laden: {(error as any).message}
            </p>
          )}
        </section>

        <section className="max-w-6xl mx-auto px-4 pb-16 grid lg:grid-cols-[2fr_1fr] gap-4">
          {/* Left: table */}
          <div className="table-card p-0 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
              <div className="flex items-center gap-2">
                <input
                  className="px-3 py-1.5 rounded-xl border border-gray-300 text-sm"
                  placeholder="Filter op ticker (bv. AAPL)"
                  value={symbolFilter}
                  onChange={e => setSymbolFilter(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="btn-sm"
                  onClick={() => mutate()}
                  disabled={isValidating}
                  title="Ververs (cache-vriendelijk)"
                >
                  Refresh
                </button>
                <button
                  className="btn-sm"
                  onClick={async () => {
                    await fetch('/api/market/congress?limit=50&force=1')
                    mutate()
                  }}
                  title="Force refresh (cache bypass)"
                >
                  Force
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-500">
                  <tr className="text-left">
                    <th className="px-4 py-3">Published</th>
                    <th className="px-4 py-3">Persoon</th>
                    <th className="px-4 py-3">Ticker</th>
                    <th className="px-4 py-3">Side</th>
                    <th className="px-4 py-3">Bedrag</th>
                    <th className="px-4 py-3">Prijs</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {isValidating && items.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-6 text-gray-500">Bezig met laden…</td></tr>
                  )}
                  {!isValidating && rows.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-6 text-gray-500">Geen data gevonden.</td></tr>
                  )}
                  {rows.map((it, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-700">{it.publishedLabel}</td>
                      <td className="px-4 py-3 text-gray-900">{it.person}</td>
                      <td className="px-4 py-3 font-medium">{it.ticker}</td>
                      <td className="px-4 py-3">
                        <span className={sideBadge(it.side)}>{it.side}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{it.amount}</td>
                      <td className="px-4 py-3 text-gray-700">{it.price}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right: uitleg/links */}
          <aside className="space-y-3 lg:sticky lg:top-16 h-max">
            <div className="table-card p-4">
              <div className="font-semibold text-gray-900 mb-1">Wat is dit?</div>
              <p className="text-sm text-gray-600">
                Recente, publiek gerapporteerde transacties door leden van het U.S. Congress.
                Data wordt gescraped, gecachet (Vercel KV) en client-side opgehaald voor snelheid.
              </p>
              <div className="mt-3 text-xs text-gray-500">
                Tip: gebruik <code>?force=1</code> op de API om de cache te verversen voor debugging.
              </div>
            </div>

            <div className="table-card p-4">
              <div className="font-semibold text-gray-900 mb-2">Snel naar</div>
              <div className="flex flex-wrap gap-2">
                <Link href="/stocks" className="btn">AEX</Link>
                <Link href="/sp500" className="btn">S&amp;P 500</Link>
                <Link href="/nasdaq" className="btn">NASDAQ</Link>
              </div>
            </div>
          </aside>
        </section>
      </main>
    </>
  )
}