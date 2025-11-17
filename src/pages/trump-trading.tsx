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

type Move = {
  year: string
  title: string
  actors: string
  instruments: string
  summary: string
  type: 'Equity' | 'Crypto / mining' | 'Disclosure' | 'Deal / SPAC'
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

const KNOWN_MOVES: Move[] = [
  {
    year: '2024',
    title: 'DJT listing on NASDAQ',
    actors: 'Donald J. Trump',
    instruments: 'DJT (Trump Media & Technology Group)',
    summary:
      'Truth Social parent TMTG lists via SPAC. Trump retains a majority economic stake through a trust, making DJT the main listed “Trump asset”. Price highly sensitive to political headlines and legal developments.',
    type: 'Equity',
  },
  {
    year: '2024',
    title: 'Trump family enters Dominari Holdings',
    actors: 'Donald Trump Jr., Eric Trump',
    instruments: 'DOMH (Dominari Holdings)',
    summary:
      'Trump Jr. and Eric Trump join Dominari, a small-cap financial/brokerage play. Shares rally sharply around the announcement period, with volumes well above historical averages.',
    type: 'Equity',
  },
  {
    year: '2024',
    title: 'Trump-linked mining via American Bitcoin Corp',
    actors: 'Eric Trump',
    instruments: 'Private company + listed miner HUT',
    summary:
      'Eric Trump takes a strategic role at American Bitcoin Corp. The story creates a “mining trade” via public names like Hut 8 Mining (HUT), which already had existing exposure to bitcoin mining economics.',
    type: 'Crypto / mining',
  },
  {
    year: '2017–now',
    title: 'Disclosure portfolio in OGE filings',
    actors: 'Donald J. Trump',
    instruments: 'Municipal bonds, broad ETFs, individual stocks',
    summary:
      'Annual OGE Form 278e filings show a mix of muni bonds, ETFs and various investments. The disclosures reflect asset mix and size ranges, not trade-by-trade activity, so they are useful for understanding exposure but not for timing trades.',
    type: 'Disclosure',
  },
]

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

        // 1) Try legacy /api/news/ endpoint (same source as homepage, English)
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
    <div className="table-card text-black">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="font-semibold text-black">{title}</h3>
        {data?.updatedAt && (
          <span className="text-[11px] text-slate-600">
            Updated {new Date(data.updatedAt).toLocaleTimeString()}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-black">{description}</p>

      {loading && !error && (
        <p className="mt-3 text-xs text-slate-600">Loading news…</p>
      )}
      {error && (
        <p className="mt-3 text-xs text-red-600">{error}</p>
      )}

      {!loading && !error && items.length === 0 && (
        <p className="mt-3 text-xs text-slate-600">No recent headlines found.</p>
      )}

      {!loading && !error && items.length > 0 && (
        <ul className="mt-3 space-y-2">
          {items.slice(0, limit).map((it) => (
            <li key={it.id} className="text-xs">
              <a
                href={it.link}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium hover:underline"
              >
                {it.title}
              </a>
              <div className="text-[11px] text-slate-600">
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
          content="Realtime overview of Trump-linked tickers, known trading/deal moves and curated news around DJT, Dominari, Hut 8 and the broader Trump trade."
        />
      </Head>

      <main className="min-h-screen text-black">
        {/* Hero */}
        <section className="max-w-6xl mx-auto px-4 pt-16 pb-10">
          <p className="text-xs uppercase tracking-[0.18em] text-black mb-2">
            Special topic
          </p>
          <h1 className="hero">Trump Trading</h1>
          <p className="mt-3 max-w-2xl text-sm md:text-base text-black">
            This page gives you a focused view on the “Trump trade”: which tickers are directly
            linked to Donald Trump and his family, what major trading/deal events have taken place,
            and what the news flow looks like around those names.
          </p>
          <p className="mt-2 max-w-2xl text-sm md:text-base text-black">
            Prices update in real time via a dedicated quote endpoint. Headlines are pulled from
            Google News through the existing SignalHub news infrastructure.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <span className="badge bg-blue-50 text-blue-700 ring-1 ring-blue-200">
              Trump tickers
            </span>
            <span className="badge bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
              Family deals &amp; moves
            </span>
            <span className="badge bg-amber-50 text-amber-700 ring-1 ring-amber-200">
              Trump news flow
            </span>
          </div>
        </section>

        {/* 1. Trump tickers (realtime) */}
        <section className="max-w-6xl mx-auto px-4 pb-10">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg md:text-xl font-semibold tracking-tight">
              Trump tickers (live prices)
            </h2>
            <span className="hidden md:inline-flex text-[11px] px-2.5 py-1 rounded-full bg-slate-100 text-black border border-slate-200">
              Data via /api/trump/quotes · refreshed every 30 seconds
            </span>
          </div>
          <p className="mt-2 text-sm text-black max-w-3xl">
            These are the core tradeable instruments in the Trump ecosystem: DJT (media), DOMH
            (micro-cap financial), HUT (bitcoin mining) and BTC as the underlying crypto driver.
          </p>

          <div className="mt-4 table-card p-0 overflow-hidden">
            <table className="w-full text-[13px]">
              <colgroup>
                <col className="w-[16%]" />
                <col className="w-[32%]" />
                <col className="w-[17%]" />
                <col className="w-[17%]" />
                <col className="w-[18%]" />
              </colgroup>
              <thead className="bg-slate-950/70 border-b border-white/10">
                <tr className="text-[11px] uppercase tracking-[0.16em] text-slate-200 text-left">
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
                      className="border-b border-white/5 last:border-b-0 text-[13px] text-black"
                    >
                      <td className="px-4 py-2 font-mono text-xs">{row.sym}</td>
                      <td className="px-2 py-2 truncate">
                        {q?.name || row.fallbackName}
                      </td>
                      <td className="px-2 py-2 text-right font-mono">
                        {price}{' '}
                        <span className="text-[10px] text-slate-600">
                          {q?.currency || row.currency}
                        </span>
                      </td>
                      <td
                        className={`px-2 py-2 text-right font-mono ${
                          ch == null ? 'text-slate-600' : up ? 'text-emerald-600' : 'text-red-600'
                        }`}
                      >
                        {chText}
                      </td>
                      <td
                        className={`px-4 py-2 text-right font-mono ${
                          chPct == null
                            ? 'text-slate-600'
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

            <div className="px-4 py-2 border-t border-white/5 text-[11px] text-black flex items-center justify-between">
              <span>Source: Yahoo Finance via /api/trump/quotes.</span>
              {loading && <span>Loading live data…</span>}
              {!loading && error && (
                <span className="text-red-600">{error}</span>
              )}
            </div>
          </div>
        </section>

        {/* 2. Trump-linked trading activity (live from SEC) */}
        <section className="max-w-6xl mx-auto px-4 pb-10">
          <h2 className="text-lg md:text-xl font-semibold tracking-tight">
            Trump-linked trading activity (live from SEC)
          </h2>
          <p className="mt-2 text-sm text-black max-w-3xl">
            Insider and company-level filings for Trump-linked names like DJT, Dominari and Hut 8.
            This aggregates recent Form 4 ownership updates and related filings from the SEC&apos;s
            EDGAR system into a single view.
          </p>

          {tradesLoading && !tradesError && (
            <p className="mt-3 text-sm text-black">Loading trading data…</p>
          )}
          {tradesError && (
            <p className="mt-3 text-sm text-red-600">{tradesError}</p>
          )}

          {!tradesLoading && !tradesError && trades.length === 0 && (
            <p className="mt-3 text-sm text-black">
              No recent Trump-linked trading filings found in the latest SEC data window.
            </p>
          )}

          {!tradesLoading && !tradesError && trades.length > 0 && (
            <div className="mt-4 table-card p-0 overflow-hidden">
              <table className="w-full text-[12px] md:text-[13px]">
                <colgroup>
                  <col className="w-[11%]" />  {/* Date */}
                  <col className="w-[18%]" />  {/* Actor */}
                  <col className="w-[18%]" />  {/* Company */}
                  <col className="w-[6%]" />   {/* Ticker */}
                  <col className="w-[9%]" />   {/* Type */}
                  <col className="w-[11%]" />  {/* Shares */}
                  <col className="w-[9%]" />   {/* Price */}
                  <col className="w-[18%]" />  {/* Value + description */}
                </colgroup>
                <thead className="bg-slate-950/70 border-b border-white/10">
                  <tr className="text-[11px] uppercase tracking-[0.16em] text-slate-200 text-left">
                    <th className="px-3 py-2">Date</th>
                    <th className="px-2 py-2">Actor</th>
                    <th className="px-2 py-2">Company</th>
                    <th className="px-2 py-2">Ticker</th>
                    <th className="px-2 py-2">Type</th>
                    <th className="px-2 py-2 text-right">Shares</th>
                    <th className="px-2 py-2 text-right">Price</th>
                    <th className="px-3 py-2">Value &amp; filing</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t) => (
                    <tr
                      key={`${t.date}-${t.actor}-${t.ticker}-${t.transaction}`}
                      className="border-b border-white/5 last:border-b-0 text-black align-top"
                    >
                      <td className="px-3 py-2 font-mono text-[11px] whitespace-nowrap">
                        {t.date || '—'}
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
                      <td className="px-2 py-2 text-[12px]">
                        <span className="inline-flex items-center rounded-full px-2 py-[2px] text-[11px] border border-slate-300">
                          {t.type}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-[11px]">
                        {t.shares != null ? t.shares.toLocaleString() : '—'}
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-[11px]">
                        {t.price != null ? `$${t.price.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-[12px]">
                        {t.value != null && (
                          <div className="font-mono text-[11px] mb-1">
                            ≈ ${t.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </div>
                        )}
                        <div className="text-[12px]">
                          {t.transaction || 'Form 4 filing'}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="px-4 py-2 border-t border-white/5 text-[11px] text-black">
                Source: SEC EDGAR Form 4 filings via /api/trump/trades. Parsed for trading insight;
                for full legal detail always refer to the original SEC documents.
              </div>
            </div>
          )}
        </section>

        {/* 3. Known Trump-family & DJT moves */}
        <section className="max-w-6xl mx-auto px-4 pb-12">
          <h2 className="text-lg md:text-xl font-semibold tracking-tight">
            Trump family &amp; DJT — notable moves
          </h2>
          <p className="mt-2 text-sm text-black max-w-3xl">
            A high-level overview of key events that shaped the “Trump trade”: listings, family
            involvement in companies and disclosure patterns. This is curated context, not a
            complete trade log.
          </p>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            {KNOWN_MOVES.map((m) => (
              <article key={m.title} className="table-card">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-black">
                      {m.year} · {m.type}
                    </p>
                    <h3 className="mt-1 font-semibold text-black">
                      {m.title}
                    </h3>
                  </div>
                </div>
                <dl className="mt-3 space-y-1 text-xs text-black">
                  <div>
                    <dt className="inline text-black">Actors:&nbsp;</dt>
                    <dd className="inline">{m.actors}</dd>
                  </div>
                  <div>
                    <dt className="inline text-black">Instruments:&nbsp;</dt>
                    <dd className="inline">{m.instruments}</dd>
                  </div>
                </dl>
                <p className="mt-3 text-sm text-black">{m.summary}</p>
              </article>
            ))}
          </div>
        </section>

        {/* 4. Trump main news (local implementation, no shared NewsFeed) */}
        <section className="max-w-6xl mx-auto px-4 pb-16">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg md:text-xl font-semibold tracking-tight">
              Trump main news
            </h2>
            <span className="badge bg-red-50 text-red-700 ring-1 ring-red-200">
              Live Google News feed
            </span>
          </div>
          <p className="mt-2 text-sm text-black max-w-3xl">
            Curated headlines around DJT, Dominari, Hut 8 and a broader Trump search. Use this to
            connect spikes in price and volume to specific events.
          </p>

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