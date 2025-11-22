// src/pages/trump-trading.tsx
import Head from 'next/head'
import { useEffect, useState } from 'react'

type TrumpQuote = {
  symbol: string
  name: string
  price: number | null
  change: number | null
  changePercent: number | null
  currency: string
}

type QuotesResp = {
  quotes: Record<string, TrumpQuote>
}

type NewsItem = {
  id: string
  title: string
  link: string
  source?: string
  pubDate?: string
}

type NewsApiResp = {
  updatedAt: number
  query: string
  items: NewsItem[]
}

type Trade = {
  actor: string
  company: string
  ticker: string
  date: string
  transaction: string
  shares: number | null
  price: number | null
  value: number | null
  type: 'Buy' | 'Sell' | 'Grant' | 'Other'
}

type TradesApiResp = {
  updatedAt: number
  trades: Trade[]
}

// ─────────────────────────────────────────────────────────────
// Local news card component for this page only
// ─────────────────────────────────────────────────────────────
type TrumpNewsCardProps = {
  symbol: string
  title: string
  description: string
  query: string
  limit?: number
}

function TrumpNewsCard({ symbol, title, description, query, limit = 6 }: TrumpNewsCardProps) {
  const [data, setData] = useState<NewsApiResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        setLoading(true)
        setError(null)
        setData(null)

        const params = new URLSearchParams()
        if (query) params.set('name', query)
        if (limit) params.set('limit', String(limit))
        const qs = params.toString()

        const endpoints = [
          `/api/news/${encodeURIComponent(symbol)}?${qs}`,
          `/api/v1/news/${encodeURIComponent(symbol)}?${qs}`,
        ]

        let lastError: any = null
        for (const url of endpoints) {
          try {
            const res = await fetch(url, { cache: 'no-store' })
            if (!res.ok) {
              lastError = new Error(`HTTP ${res.status} for ${url}`)
              continue
            }

            const json: any = await res.json()
            const items: NewsItem[] = json.items || json.news || []

            if (!cancelled) {
              setData({
                updatedAt: json.updatedAt || Date.now(),
                query: json.query || query,
                items,
              })
            }
            lastError = null
            break
          } catch (e) {
            lastError = e
          }
        }

        if (lastError && !cancelled) {
          throw lastError
        }
      } catch (e) {
        console.error('TrumpNewsCard error', e)
        if (!cancelled) setError('Failed to load news.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [symbol, query, limit])

  const items = data?.items ?? []

  return (
    <div className="table-card">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="font-semibold text-gray-900 dark:text-slate-100">{title}</h3>
        {data?.updatedAt && (
          <span className="text-[11px] text-slate-600 dark:text-slate-400">
            Updated {new Date(data.updatedAt).toLocaleTimeString()}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-gray-700 dark:text-slate-300">{description}</p>

      {loading && !error && (
        <p className="mt-3 text-xs text-slate-600 dark:text-slate-400">Loading news…</p>
      )}
      {error && (
        <p className="mt-3 text-xs text-red-600">{error}</p>
      )}

      {!loading && !error && items.length === 0 && (
        <p className="mt-3 text-xs text-slate-600 dark:text-slate-400">No recent headlines found.</p>
      )}

      {!loading && !error && items.length > 0 && (
        <ul className="mt-3 space-y-2">
          {items.slice(0, limit).map((it) => (
            <li key={it.id} className="text-xs">
              <a
                href={it.link}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium hover:underline text-gray-900 dark:text-slate-100"
              >
                {it.title}
              </a>
              <div className="text-[11px] text-slate-600 dark:text-slate-400">
                {it.source || 'Google News'}
                {it.pubDate && (
                  <> · {new Date(it.pubDate).toLocaleString()}</>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────

export default function TrumpTradingPage() {
  const [quotes, setQuotes] = useState<Record<string, TrumpQuote>>({})
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  const [trades, setTrades] = useState<Trade[]>([])
  const [tradesLoading, setTradesLoading] = useState<boolean>(true)
  const [tradesError, setTradesError] = useState<string | null>(null)

  // Load realtime quotes via /api/trump/quotes
  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        setLoading(true)
        setError(null)

        const res = await fetch('/api/trump/quotes?symbols=DJT,DOMH,HUT,BTC', {
          cache: 'no-store',
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json: QuotesResp = await res.json()
        if (!cancelled) {
          setQuotes(json.quotes || {})
        }
      } catch (e: any) {
        console.error('TrumpTrading quotes error', e)
        if (!cancelled) setError('Failed to load live prices.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    const id = setInterval(load, 30_000) // refresh every 30 seconds
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  // Load insider / linked trades via /api/trump/trades
  useEffect(() => {
    let cancelled = false

    const loadTrades = async () => {
      try {
        setTradesLoading(true)
        setTradesError(null)

        const res = await fetch('/api/trump/trades', { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        const json: TradesApiResp = await res.json()
        if (!cancelled) {
          setTrades(json.trades || [])
        }
      } catch (e: any) {
        console.error('TrumpTrading trades error', e)
        if (!cancelled) setTradesError('Failed to load trading data.')
      } finally {
        if (!cancelled) setTradesLoading(false)
      }
    }

    loadTrades()
    const id = setInterval(loadTrades, 5 * 60_000) // refresh every 5 minutes
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const rows = [
    { sym: 'DJT', fallbackName: 'Trump Media & Technology Group', currency: 'USD' },
    { sym: 'DOMH', fallbackName: 'Dominari Holdings', currency: 'USD' },
    { sym: 'HUT', fallbackName: 'Hut 8 Mining', currency: 'USD' },
    { sym: 'BTC', fallbackName: 'Bitcoin', currency: 'USD' },
  ]

  return (
    <>
      <Head>
        <title>Trump Trading — SignalHub</title>
        <meta
          name="description"
          content="Realtime overview of Trump-linked tickers, insider filings and curated news around DJT, Dominari, Hut 8 and the broader Trump trade."
        />
      </Head>

      <main className="min-h-screen text-gray-900 dark:text-slate-100">
        {/* Hero */}
        <section className="max-w-6xl mx-auto px-4 pt-16 pb-10">
          <p className="text-xs uppercase tracking-[0.18em] text-gray-500 dark:text-slate-400 mb-2">
            Special topic
          </p>
          <h1 className="hero">Trump Trading</h1>
        </section>

        {/* 1. Trump tickers (realtime) */}
        <section className="max-w-6xl mx-auto px-4 pb-10">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg md:text-xl font-semibold tracking-tight">
              Trump tickers (live prices)
            </h2>
            <span className="hidden md:inline-flex text-[11px] px-2.5 py-1 rounded-full bg-slate-100 text-gray-900 border border-slate-200 dark:bg-slate-900 dark:text-slate-100 dark:border-slate-700">
              Data via /api/trump/quotes · refreshed every 30 seconds
            </span>
          </div>

          <div className="mt-4 table-card p-0 overflow-hidden">
            <table className="w-full text-[13px]">
              <colgroup>
                <col className="w-[16%]" />
                <col className="w-[32%]" />
                <col className="w-[17%]" />
                <col className="w-[17%]" />
                <col className="w-[18%]" />
              </colgroup>
              <thead className="bg-slate-50 dark:bg-slate-950/70 border-b border-gray-200 dark:border-white/10">
                <tr className="text-[11px] uppercase tracking-[0.16em] text-gray-500 dark:text-slate-200 text-left">
                  <th className="px-4 py-2">Symbol</th>
                  <th className="px-2 py-2">Name</th>
                  <th className="px-2 py-2 text-right">Price</th>
                  <th className="px-2 py-2 text-right">Change</th>
                  <th className="px-4 py-2 text-right">% 24h</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const q = quotes[row.sym]
                  const price =
                    q?.price != null
                      ? q.price.toFixed(q.price > 100 ? 2 : 4)
                      : '—'
                  const ch = q?.change
                  const chPct = q?.changePercent
                  const up = (ch ?? 0) >= 0
                  const chText =
                    ch == null ? '—' : `${up ? '+' : ''}${ch.toFixed(2)}`
                  const pctText =
                    chPct == null ? '—' : `${up ? '+' : ''}${chPct.toFixed(2)}%`

                  return (
                    <tr
                      key={row.sym}
                      className="border-b border-gray-100 last:border-b-0 text-[13px] text-gray-900 dark:border-white/5 dark:text-slate-100"
                    >
                      <td className="px-4 py-2 font-mono text-xs">{row.sym}</td>
                      <td className="px-2 py-2 truncate">
                        {q?.name || row.fallbackName}
                      </td>
                      <td className="px-2 py-2 text-right font-mono">
                        {price}{' '}
                        <span className="text-[10px] text-slate-600 dark:text-slate-400">
                          {q?.currency || row.currency}
                        </span>
                      </td>
                      <td
                        className={`px-2 py-2 text-right font-mono ${
                          ch == null
                            ? 'text-slate-600 dark:text-slate-400'
                            : up
                            ? 'text-emerald-600'
                            : 'text-red-600'
                        }`}
                      >
                        {chText}
                      </td>
                      <td
                        className={`px-4 py-2 text-right font-mono ${
                          chPct == null
                            ? 'text-slate-600 dark:text-slate-400'
                            : up
                            ? 'text-emerald-600'
                            : 'text-red-600'
                        }`}
                      >
                        {pctText}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* Footer zonder bronregel, maar mét loading/error */}
            <div className="px-4 py-2 border-t border-gray-200 dark:border-white/5 text-[11px] text-gray-700 dark:text-slate-300 flex items-center justify-end gap-3">
              {loading && <span>Loading live data…</span>}
              {!loading && error && (
                <span className="text-red-600">{error}</span>
              )}
            </div>
          </div>
        </section>

        {/* 2. Trump-linked trading activity */}
        <section className="max-w-6xl mx-auto px-4 pb-10">
          <h2 className="text-lg md:text-xl font-semibold tracking-tight">
            Trump-linked trading activity
          </h2>

          {tradesLoading && !tradesError && (
            <p className="mt-3 text-sm text-gray-700 dark:text-slate-300">Loading trading data…</p>
          )}
          {tradesError && (
            <p className="mt-3 text-sm text-red-600">{tradesError}</p>
          )}

          {!tradesLoading && !tradesError && trades.length === 0 && (
            <p className="mt-3 text-sm text-gray-700 dark:text-slate-300">
              No recent Trump-linked trading filings found in the current SEC Form 4 window.
            </p>
          )}

          {!tradesLoading && !tradesError && trades.length > 0 && (
            <div className="mt-4 table-card p-0 overflow-hidden">
              <table className="w-full text-[11px] md:text-[13px]">
                <colgroup>
                  <col className="w-[10%]" />
                  <col className="w-[16%]" />
                  <col className="w-[18%]" />
                  <col className="w-[7%]" />
                  <col className="w-[9%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                  <col className="w-[20%]" />
                </colgroup>
                <thead className="bg-slate-50 dark:bg-slate-950/70 border-b border-gray-200 dark:border-white/10">
                  <tr className="text-[11px] uppercase tracking-[0.16em] text-gray-500 dark:text-slate-200 text-left">
                    <th className="px-3 py-2">Date</th>
                    <th className="px-2 py-2">Actor</th>
                    <th className="px-2 py-2">Company</th>
                    <th className="px-2 py-2">Ticker</th>
                    <th className="px-2 py-2 text-right">Type</th>
                    <th className="px-2 py-2 text-right">Shares</th>
                    <th className="px-2 py-2 text-right">Price</th>
                    <th className="px-3 py-2 text-right">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t) => {
                    const key = `${t.date}-${t.actor}-${t.ticker}-${t.transaction}`

                    const isDisclosure = t.transaction.startsWith('Disclosure filing')

                    const sharesText = isDisclosure
                      ? (t.shares == null
                          ? 'Classified (not publicly disclosed)'
                          : t.shares.toLocaleString('en-US'))
                      : (t.shares == null
                          ? '—'
                          : t.shares.toLocaleString('en-US'))

                    const priceText = isDisclosure
                      ? (t.price == null
                          ? 'Classified (not publicly disclosed)'
                          : `$${t.price.toFixed(2)}`)
                      : (t.price == null
                          ? '—'
                          : `$${t.price.toFixed(2)}`)

                    const valueText = isDisclosure
                      ? (t.value == null
                          ? 'Classified (not publicly disclosed)'
                          : `$${t.value.toLocaleString('en-US')}`)
                      : (t.value == null
                          ? '—'
                          : `$${t.value.toLocaleString('en-US')}`)

                    const typeColor =
                      t.type === 'Buy'
                        ? 'text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40'
                        : t.type === 'Sell'
                        ? 'text-red-700 dark:text-red-300 border-red-300 dark:border-red-500 bg-red-50 dark:bg-red-950/40'
                        : t.type === 'Grant'
                        ? 'text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-500 bg-amber-50 dark:bg-amber-950/40'
                        : 'text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-500 bg-slate-50 dark:bg-slate-900/60'

                    return (
                      <tr
                        key={key}
                        className="border-b border-gray-100 last:border-b-0 text-gray-900 dark:border-white/5 dark:text-slate-100 align-top"
                      >
                        <td className="px-3 py-2 font-mono text-[11px] whitespace-nowrap">
                          {t.date}
                        </td>
                        <td className="px-2 py-2 text-[12px]">
                          {t.actor}
                        </td>
                        <td className="px-2 py-2 text-[12px]">
                          {t.company}
                        </td>
                        <td className="px-2 py-2 font-mono text-[11px]">
                          {t.ticker}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <span className={`inline-flex items-center rounded-full px-2 py-[2px] text-[11px] border ${typeColor}`}>
                            {t.type}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-[11px]">
                          {sharesText}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-[11px]">
                          {priceText}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-[11px]">
                          {valueText}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {/* Footer met bronregel is verwijderd zoals gevraagd */}
            </div>
          )}
        </section>

        {/* 3. Trump main news (local implementation, no shared NewsFeed) */}
        <section className="max-w-6xl mx-auto px-4 pb-16">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg md:text-xl font-semibold tracking-tight">
              Trump main news
            </h2>
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <TrumpNewsCard
              symbol="DJT"
              title="DJT news"
              description="Headlines around Trump Media & Technology Group (DJT)."
              query="Trump Media DJT stock crypto"
              limit={6}
            />

            <div className="grid gap-4">
              <TrumpNewsCard
                symbol="DOMH"
                title="Dominari (DOMH)"
                description="News around Dominari Holdings (DOMH), the Trump-family micro-cap financial link."
                query="Dominari Holdings DOMH Trump"
                limit={3}
              />
              <TrumpNewsCard
                symbol="HUT"
                title="Hut 8 Mining (HUT)"
                description="News around Hut 8 Mining (HUT) as a liquid proxy for Trump-linked bitcoin mining exposure."
                query="Hut 8 Mining HUT Trump American Bitcoin Corp"
                limit={3}
              />
              <TrumpNewsCard
                symbol="TRUMP-ALL"
                title="Broader Trump search"
                description="Broader search capturing Donald Trump headlines relevant for DJT, DOMH and HUT."
                query='Donald Trump DJT DOMH "Hut 8 Mining" crypto stocks'
                limit={4}
              />
            </div>
          </div>
        </section>
      </main>
    </>
  )
}