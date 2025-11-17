// src/pages/trump-trading.tsx
import Head from 'next/head'
import { useEffect, useState } from 'react'
import NewsFeed from '@/components/NewsFeed'

type Quote = {
  symbol: string
  longName?: string
  shortName?: string
  regularMarketPrice: number | null
  regularMarketChange: number | null
  regularMarketChangePercent: number | null
  currency?: string
  marketState?: string
}

type QuotesResp = {
  quotes: Record<string, Quote>
  meta?: any
}

const LIVE_SYMBOLS = ['DJT', 'DOMH', 'HUT', 'BTC'] as const
type LiveSymbol = (typeof LIVE_SYMBOLS)[number]

type TrumpVehicle = {
  id: string
  category: string
  name: string
  ticker?: LiveSymbol
  type: string
  exposure: string
  keyInsight: string
  dataSources: string[]
  updateFrequency: string
  reliability: '★☆☆☆☆' | '★★☆☆☆' | '★★★☆☆' | '★★★★☆' | '★★★★★'
  tags: string[]
}

const VEHICLES: TrumpVehicle[] = [
  {
    id: 'djt',
    category: 'Equity',
    name: 'Trump Media & Technology Group',
    ticker: 'DJT',
    type: 'US small/mid-cap, high volatility',
    exposure: 'Direct equity exposure for Donald J. Trump (majority economic interest via trust).',
    keyInsight:
      'The main listed “Trump asset”. Price reacts aggressively to political headlines, legal news and social media activity.',
    dataSources: ['SEC EDGAR (8-K, S-1, Form 4)', 'Google News', 'Market data API'],
    updateFrequency: 'Daily / intraday',
    reliability: '★★★★★',
    tags: ['Equity', 'Media', 'Campaign-linked', 'High risk']
  },
  {
    id: 'domh',
    category: 'Equity',
    name: 'Dominari Holdings',
    ticker: 'DOMH',
    type: 'US micro-cap / financials',
    exposure: 'Board / ownership exposure for Donald Jr. & Eric Trump.',
    keyInsight:
      'Rallied >300% around Trump-family involvement. Very illiquid; moves are driven more by news and flows than fundamentals.',
    dataSources: ['SEC EDGAR (13D/G)', 'Company press releases', 'Google News'],
    updateFrequency: 'Weekly / on news',
    reliability: '★★★★☆',
    tags: ['Micro-cap', 'Illiquid', 'Trump Jr. & Eric']
  },
  {
    id: 'hut8',
    category: 'Equity / crypto mining',
    name: 'Hut 8 Mining',
    ticker: 'HUT',
    type: 'Listed bitcoin miner',
    exposure: 'Public proxy for the mining segment connected to Trump-linked American Bitcoin Corp.',
    keyInsight:
      'Liquid exposure to the mining side of the Trump crypto narrative. Driven by BTC price, sector flows and regulatory news.',
    dataSources: ['SEC EDGAR', 'On-chain mining metrics', 'News'],
    updateFrequency: 'Daily',
    reliability: '★★★★☆',
    tags: ['Mining', 'BTC', 'Listed']
  },
  {
    id: 'american-bitcoin',
    category: 'Private / crypto mining',
    name: 'American Bitcoin Corp',
    type: 'Private bitcoin miner',
    exposure: 'Strategic role for Eric Trump (e.g. Chief Strategy Officer).',
    keyInsight:
      'Private miner with exposure to BTC and energy costs. No direct ticker – the tradeable angle is via partners (like HUT) and on-chain mining data.',
    dataSources: ['Company communications', 'Arkham Intelligence', 'Dune Analytics'],
    updateFrequency: 'Daily',
    reliability: '★★★☆☆',
    tags: ['Private', 'Mining', 'BTC-linked']
  },
  {
    id: 'oge-portfolio',
    category: 'Disclosure',
    name: 'Trump OGE disclosure portfolio',
    type: 'Muni bonds, ETFs & individual stocks',
    exposure: 'Reported on OGE Form 278e as Donald J. Trump’s personal holdings.',
    keyInsight:
      'Shows the conservative core of his portfolio (bonds, broad ETFs). Hardly any near-real-time trade reporting – useful for asset mix, not trade timing.',
    dataSources: ['OGE.gov (Form 278e)', 'OpenSecrets'],
    updateFrequency: 'Yearly',
    reliability: '★★★★★',
    tags: ['Disclosure', 'Fixed income', 'ETFs']
  },
  {
    id: 'sentiment',
    category: 'Sentiment',
    name: 'Retail sentiment: “Trump stock” / “DJT stock”',
    type: 'Search & social data',
    exposure: 'Search trends and social chatter around Trump-linked tickers.',
    keyInsight:
      'Spikes in search volume and Reddit/news discussion often precede big moves in DJT and micro caps like DOMH.',
    dataSources: ['Google Trends', 'Reddit', 'AltIndex / similar'],
    updateFrequency: 'Daily',
    reliability: '★★★☆☆',
    tags: ['Sentiment', 'Early warning']
  }
]

export default function TrumpTradingPage() {
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})
  const [loadingQuotes, setLoadingQuotes] = useState<boolean>(true)
  const [quotesError, setQuotesError] = useState<string | null>(null)

  // === live quotes: DJT, DOMH, HUT, BTC (via /api/quotes) ===
  useEffect(() => {
    let cancelled = false
    let timer: any

    const load = async () => {
      try {
        setQuotesError(null)
        setLoadingQuotes(true)
        const symbolsParam = encodeURIComponent(LIVE_SYMBOLS.join(','))
        const res = await fetch(`/api/quotes?symbols=${symbolsParam}`, { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json: QuotesResp = await res.json()
        if (!cancelled) {
          setQuotes(json.quotes || {})
        }
      } catch (e: any) {
        if (!cancelled) {
          console.error('TrumpTrading quotes error', e)
          setQuotesError('Failed to load live prices.')
        }
      } finally {
        if (!cancelled) {
          setLoadingQuotes(false)
          timer = setTimeout(load, 30_000) // refresh every 30s
        }
      }
    }

    load()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [])

  const getQuote = (sym?: LiveSymbol) => {
    if (!sym) return undefined
    return quotes[sym] || quotes[sym.toUpperCase()]
  }

  return (
    <>
      <Head>
        <title>Trump Trading — SignalHub</title>
        <meta
          name="description"
          content="Data-driven overview of Trump-linked assets: DJT, micro caps, crypto mining and official disclosures, with live market data and curated news."
        />
      </Head>

      <main className="min-h-screen">
        {/* Hero + intro */}
        <section className="max-w-6xl mx-auto px-4 pt-16 pb-10">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500 mb-2">
            Special topic
          </p>
          <h1 className="hero">Trump Trading</h1>
          <p className="mt-3 max-w-2xl text-sm md:text-base text-slate-600">
            This page is not about blindly copy-trading Donald Trump or his family. Instead, it
            gives you a structured overview of the assets that are economically linked to them:
            listed stocks, micro caps, crypto mining exposure and what we can learn from official
            disclosures and on-chain data.
          </p>
          <p className="mt-2 max-w-2xl text-sm md:text-base text-slate-600">
            Use it as a research hub: combine live prices, curated news and primary data sources
            like OGE, SEC EDGAR, Arkham and OpenSecrets to understand where the real exposure is —
            and how event-driven the “Trump trade” actually behaves.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <span className="badge bg-blue-50 text-blue-700 ring-1 ring-blue-200">
              Equities &amp; micro caps
            </span>
            <span className="badge bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
              Crypto &amp; mining
            </span>
            <span className="badge bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200">
              Disclosures &amp; on-chain
            </span>
            <span className="badge bg-amber-50 text-amber-700 ring-1 ring-amber-200">
              Event-driven headlines
            </span>
          </div>
        </section>

        {/* Live prices snapshot */}
        <section className="max-w-6xl mx-auto px-4 pb-10">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg md:text-xl font-semibold tracking-tight">
              Live Trump-linked prices
            </h2>
            <span className="hidden md:inline-flex text-[11px] px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
              Powered by /api/quotes · refreshed every 30 seconds
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-600 max-w-3xl">
            These are the most important tradeable tickers in the Trump ecosystem: DJT (media),
            DOMH (micro-cap financial), HUT (crypto mining) and BTC as the underlying driver for
            the mining side.
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
                <tr className="text-[11px] uppercase tracking-[0.16em] text-slate-400 text-left">
                  <th className="px-4 py-2">Symbol</th>
                  <th className="px-2 py-2">Name</th>
                  <th className="px-2 py-2 text-right">Price</th>
                  <th className="px-2 py-2 text-right">Change</th>
                  <th className="px-4 py-2 text-right">% 24h</th>
                </tr>
              </thead>
              <tbody>
                {LIVE_SYMBOLS.map((sym) => {
                  const q = getQuote(sym)
                  const dispName =
                    sym === 'BTC'
                      ? 'Bitcoin'
                      : q?.longName || q?.shortName || (sym === 'DJT'
                          ? 'Trump Media & Technology Group'
                          : sym === 'DOMH'
                          ? 'Dominari Holdings'
                          : sym === 'HUT'
                          ? 'Hut 8 Mining'
                          : sym)
                  const price =
                    q?.regularMarketPrice != null
                      ? q.regularMarketPrice.toFixed(q.regularMarketPrice > 100 ? 2 : 4)
                      : '—'
                  const ch = q?.regularMarketChange
                  const chPct = q?.regularMarketChangePercent
                  const up = (ch ?? 0) >= 0
                  const chText =
                    ch == null ? '—' : `${up ? '+' : ''}${ch.toFixed(2)}`
                  const pctText =
                    chPct == null ? '—' : `${up ? '+' : ''}${chPct.toFixed(2)}%`

                  return (
                    <tr
                      key={sym}
                      className="border-b border-white/5 last:border-b-0 text-[13px] text-slate-100"
                    >
                      <td className="px-4 py-2 font-mono text-xs">{sym}</td>
                      <td className="px-2 py-2 truncate">{dispName}</td>
                      <td className="px-2 py-2 text-right font-mono">
                        {price}{' '}
                        {q?.currency && (
                          <span className="text-[10px] text-slate-400">{q.currency}</span>
                        )}
                      </td>
                      <td
                        className={`px-2 py-2 text-right font-mono ${
                          ch == null ? 'text-slate-400' : up ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {chText}
                      </td>
                      <td
                        className={`px-4 py-2 text-right font-mono ${
                          chPct == null
                            ? 'text-slate-400'
                            : up
                            ? 'text-emerald-400'
                            : 'text-red-400'
                        }`}
                      >
                        {pctText}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            <div className="px-4 py-2 border-t border-white/5 text-[11px] text-slate-500 flex items-center justify-between">
              <span>
                Data source: Yahoo Finance / CoinGecko via <code>/api/quotes</code>.
              </span>
              {loadingQuotes && <span>Loading live data…</span>}
              {!loadingQuotes && quotesError && (
                <span className="text-rose-300">{quotesError}</span>
              )}
            </div>
          </div>
        </section>

        {/* Key vehicles with per-card live quote snippet */}
        <section className="max-w-6xl mx-auto px-4 pb-12">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg md:text-xl font-semibold tracking-tight">
              Key Trump-linked vehicles
            </h2>
            <span className="hidden md:inline-flex text-[11px] px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
              Curated insights · not investment advice
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-600 max-w-3xl">
            For each vehicle you get: the type of asset, how the Trump family is exposed to it, the
            core narrative and which data sources to monitor to stay on top of the story.
          </p>

          <div className="mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {VEHICLES.map((v) => {
              const q = getQuote(v.ticker as LiveSymbol | undefined)
              const hasQuote = !!q && q.regularMarketPrice != null

              return (
                <article key={v.id} className="table-card flex flex-col h-full">
                  <header className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-slate-100 leading-snug">
                        {v.name}
                        {v.ticker && (
                          <span className="ml-2 text-xs font-mono text-slate-400 align-middle">
                            ({v.ticker})
                          </span>
                        )}
                      </h3>
                      <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-400">
                        {v.category}
                      </p>
                    </div>
                    <span className="text-[11px] text-slate-400 text-right leading-tight">
                      Reliability
                      <br />
                      <span className="font-mono">{v.reliability}</span>
                    </span>
                  </header>

                  {hasQuote && (
                    <div className="mt-2 text-xs text-slate-300 font-mono flex items-baseline justify-between">
                      <span>
                        Live price:{' '}
                        <span className="text-slate-50">
                          {q!.regularMarketPrice!.toFixed(
                            q!.regularMarketPrice! > 100 ? 2 : 4
                          )}
                        </span>{' '}
                        {q!.currency && (
                          <span className="text-[10px] text-slate-400">{q!.currency}</span>
                        )}
                      </span>
                      {q!.regularMarketChange != null &&
                        q!.regularMarketChangePercent != null && (
                          <span
                            className={
                              q!.regularMarketChange! >= 0
                                ? 'text-emerald-400'
                                : 'text-red-400'
                            }
                          >
                            {q!.regularMarketChange! >= 0 ? '+' : ''}
                            {q!.regularMarketChange!.toFixed(2)} (
                            {q!.regularMarketChangePercent!.toFixed(2)}%)
                          </span>
                        )}
                    </div>
                  )}

                  <p className="mt-3 text-sm text-slate-200">{v.exposure}</p>
                  <p className="mt-2 text-sm text-slate-200">{v.keyInsight}</p>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {v.tags.map((tag) => (
                      <span
                        key={tag}
                        className="badge bg-slate-900/60 text-slate-200 ring-1 ring-slate-700/60"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-800">
                    <p className="text-[11px] font-medium text-slate-400 mb-1">
                      Primary data sources ({v.updateFrequency})
                    </p>
                    <ul className="space-y-0.5">
                      {v.dataSources.map((src) => (
                        <li key={src} className="text-xs text-slate-300">
                          • {src}
                        </li>
                      ))}
                    </ul>
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        {/* Breaking news via existing NewsFeed */}
        <section className="max-w-6xl mx-auto px-4 pb-14">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg md:text-xl font-semibold tracking-tight">
              Breaking Trump-linked headlines
            </h2>
            <span className="badge bg-red-50 text-red-700 ring-1 ring-red-200">
              Live Google News feed
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-600 max-w-3xl">
            These feeds surface the latest headlines around the key tradeable tickers. Use them to
            connect sudden moves in price and volume to actual events.
          </p>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <div className="table-card">
              <h3 className="font-semibold text-slate-100">Trump Media (DJT)</h3>
              <p className="mt-1 text-xs text-slate-400">
                Headlines and breaking news around Trump Media &amp; Technology Group.
              </p>
              <div className="mt-3">
                <NewsFeed symbol="DJT" name="Trump Media & Technology Group (DJT)" limit={6} />
              </div>
            </div>

            <div className="table-card">
              <h3 className="font-semibold text-slate-100">Dominari &amp; mining (DOMH / HUT)</h3>
              <p className="mt-1 text-xs text-slate-400">
                News for Dominari Holdings (DOMH) and Hut 8 Mining (HUT) as proxies for Trump-linked
                micro-cap and mining exposure.
              </p>
              <div className="mt-3 space-y-4">
                <div>
                  <p className="text-[11px] font-medium text-slate-400 mb-1">DOMH news</p>
                  <NewsFeed symbol="DOMH" name="Dominari Holdings (DOMH)" limit={3} />
                </div>
                <div>
                  <p className="text-[11px] font-medium text-slate-400 mb-1">HUT news</p>
                  <NewsFeed symbol="HUT" name="Hut 8 Mining (HUT)" limit={3} />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* On-chain & methodology */}
        <section className="max-w-6xl mx-auto px-4 pb-16">
          <div className="grid gap-6 md:grid-cols-2">
            <article className="table-card">
              <h2 className="font-semibold text-slate-100 text-lg">
                On-chain &amp; crypto signals
              </h2>
              <p className="mt-2 text-sm text-slate-200">
                Use on-chain tools to track wallets and mining activity around Trump-linked crypto
                projects. The goal is not to identify individuals, but to understand capital flows
                and behaviour at a high level.
              </p>
              <ul className="mt-3 space-y-1.5 text-sm text-slate-200">
                <li>• Arkham Intelligence for labelled wallets (Trump Jr., mining partners).</li>
                <li>
                  • Dune Analytics dashboards for token flows, mining payouts and holdings per
                  address cluster.
                </li>
                <li>
                  • Glassnode or similar for macro on-chain metrics (miner flows, reserves, hash
                  rate).
                </li>
              </ul>
              <p className="mt-3 text-xs text-slate-500">
                Note: on-chain labels are not always 100% verified. Treat them as indicative
                signals, not hard facts.
              </p>
            </article>

            <article className="table-card">
              <h2 className="font-semibold text-slate-100 text-lg">Disclosures &amp; workflow</h2>
              <p className="mt-2 text-sm text-slate-200">
                The insights on this page are built on top of official disclosures and
                publicly-available datasets. A practical workflow:
              </p>
              <ol className="mt-3 space-y-1.5 text-sm text-slate-200 list-decimal list-inside">
                <li>
                  <strong>OGE &amp; OpenSecrets</strong> · download the latest Form 278e for Donald
                  Trump and parse the holdings.
                </li>
                <li>
                  <strong>SEC EDGAR</strong> · monitor 8-Ks, S-1s and Form 4 filings for DJT and
                  related tickers.
                </li>
                <li>
                  <strong>OpenSecrets / FEC</strong> · map political money flows to sectors and
                  companies.
                </li>
                <li>
                  <strong>News &amp; sentiment</strong> · use Google News and social data to mark
                  “event windows” around big headlines.
                </li>
              </ol>
              <p className="mt-3 text-xs text-slate-500">
                This page is a starting point for your own research. Always combine multiple
                independent sources before making decisions.
              </p>
            </article>
          </div>
        </section>
      </main>
    </>
  )
}