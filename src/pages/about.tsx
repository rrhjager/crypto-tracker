// src/pages/about.tsx
import Head from 'next/head'

export default function About() {
  return (
    <>
      <Head>
        <title>About Us • SignalHub</title>
        <meta name="description" content="SignalHub — clarity in markets with a transparent stoplight signal for crypto and equities." />
      </Head>

      <main className="bg-ink min-h-screen text-white">
        {/* Hero */}
        <section className="border-b border-white/10">
          <div className="max-w-6xl mx-auto px-4 py-14">
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">About Us</h1>
            <p className="mt-4 text-white/80 max-w-3xl">
              SignalHub is a powerful and intuitive platform that brings clarity to the financial markets by combining
              crypto and equity signals into a single, easy-to-understand stoplight view.
            </p>
          </div>
        </section>

        {/* What we do */}
        <section className="border-b border-white/10">
          <div className="max-w-6xl mx-auto px-4 py-10 space-y-6">
            <div className="space-y-2 max-w-4xl">
              <h3 className="text-lg sm:text-xl font-semibold">Crypto indicators</h3>
              <p className="text-white/80">
                We combine multiple best-in-class data sources to score every coin with professional rigor. Our engine aggregates
                technical analysis (RSI, MACD, MA/EMA), momentum and volume trend, market-regime metrics such as volatility regime,
                funding rate, open interest, and long/short skew, plus sentiment signals like breadth and the Fear &amp; Greed Index—even
                DeFi yield where relevant. The output is a clear, transparent BUY / HOLD / SELL score for each asset, backed by
                real-time data, live charts, and news so you can weigh risk and act with confidence.
              </p>
            </div>

            <div className="space-y-2 max-w-4xl">
              <h3 className="text-lg sm:text-xl font-semibold">Stocks</h3>
              <p className="text-white/80">
                The same unified framework powers our equity coverage. We aggregate technical indicators (RSI, MACD, MA/EMA, volume trend),
                market-regime context (volatility, participation breadth), and sentiment measures (including the Fear &amp; Greed Index) to deliver
                a simple BUY / HOLD / SELL score for every ticker—supported by up-to-the-minute data, interactive charts, and curated news.
              </p>
            </div>

            <div className="space-y-2 max-w-4xl">
              <h3 className="text-lg sm:text-xl font-semibold">Why SignalHub</h3>
              <p className="text-white/80">
                SignalHub bridges the gap between professional-grade analytics and everyday investors by turning complex market data
                into clear, visual insights that enable faster, more confident decisions.
              </p>
            </div>
          </div>
        </section>

        {/* Mission */}
        <section className="border-b border-white/10">
          <div className="max-w-6xl mx-auto px-4 py-12">
            <h2 className="text-2xl sm:text-3xl font-bold">Mission Statement</h2>
            <div className="mt-4 space-y-5 max-w-4xl text-white/80">
              <p>
                Our mission is to make professional-level market intelligence accessible to everyone. By simplifying
                complexity into a transparent stoplight system, we believe individuals can invest with more confidence,
                enrich the market through informed decisions, and ultimately create a healthier financial ecosystem.
              </p>
              <p>
                We support the principles of transparency, accountability, and equal access to information: values that
                are essential to the integrity of free and competitive markets.
              </p>
            </div>
          </div>
        </section>

        {/* What We Offer - 2 rijen van 3 */}
        <section className="border-b border-white/10">
          <div className="max-w-6xl mx-auto px-4 py-12">
            <h3 className="text-xl sm:text-2xl font-semibold">What We Offer</h3>

            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {FEATURES.map((f) => (
                <div key={f.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 hover:bg-white/[0.05] transition">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex w-9 h-9 items-center justify-center rounded-xl border border-white/15">
                      {f.icon}
                    </span>
                    <h4 className="font-semibold">{f.title}</h4>
                  </div>
                  <p className="mt-3 text-sm text-white/80">{f.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Coming soon */}
        <section>
          <div className="max-w-6xl mx-auto px-4 py-12">
            <h3 className="text-xl sm:text-2xl font-semibold">Coming Soon</h3>
            <p className="mt-3 text-white/80 max-w-3xl">
              SignalHub is a continuously evolving platform. Expect more features, expanded coverage, and curated insights
              to help investors stay ahead in increasingly complex markets.
            </p>
          </div>
        </section>
      </main>
    </>
  )
}

const IconPulse = (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M13 5v4h-2V5H8l4-4 4 4h-3zm-2 14v-4h2v4h3l-4 4-4-4h3zM3 13h3l2 4 4-8 3 6h6v2h-7l-2-4-4 8-3-6H3v-2z"/>
  </svg>
)
const IconLayers = (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="m12 2 9 5-9 5-9-5 9-5m0 13 9-5v6l-9 5-9-5v-6l9 5z"/>
  </svg>
)
const IconGlobe = (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m1 17.9V18h-2v1.9A8.03 8.03 0 0 1 4.1 13H6v-2H4.1A8.03 8.03 0 0 1 11 4.1V6h2V4.1A8.03 8.03 0 0 1 19.9 11H18v2h1.9A8.03 8.03 0 0 1 13 19.9Z"/>
  </svg>
)
const IconShield = (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3m0 17.9C9 18.4 7 15.5 7 12.3V7.2l5-1.9 5 1.9v5.1c0 3.2-2 6.1-5 7.6Z"/>
  </svg>
)
const IconNews = (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M20 11V4H6v16H4a2 2 0 0 1-2-2V7h2v11h2V2h16v9h-2M8 6h10v2H8V6m0 4h10v2H8v-2m0 4h6v2H8v-2z"/>
  </svg>
)
const IconEye = (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M12 6C7 6 2.7 9 1 12c1.7 3 6 6 11 6s9.3-3 11-6c-1.7-3-6-6-11-6m0 10a4 4 0 1 1 .001-8.001A4 4 0 0 1 12 16m0-6a2 2 0 1 0 .001 4.001A2 2 0 0 0 12 10z"/>
  </svg>
)

const FEATURES = [
  {
    title: 'Real-Time Signals',
    text:
      'Scores are updated continuously with near real-time data from leading exchanges, charting platforms, and market intelligence feeds.',
    icon: IconPulse,
  },
  {
    title: 'Enriched Analytics',
    text:
      'Every score is built from multiple dimensions: technicals, momentum, volume, volatility, sentiment, and positioning — offering a richer picture than any single indicator.',
    icon: IconLayers,
  },
  {
    title: 'Global Coverage',
    text:
      'From crypto assets to major stock indices (AEX, S&P 500, Nasdaq, DAX, FTSE 100, Nikkei, Sensex, Hang Seng), our heatmaps allow you to scan opportunities across markets instantly.',
    icon: IconGlobe,
  },
  {
    title: 'Insider Market Intel',
    text:
      'Dedicated dashboards track U.S. Congress trading disclosures, providing unique visibility into political insider activity.',
    icon: IconShield,
  },
  {
    title: 'Integrated News & Charts',
    text:
      'Each asset detail page includes a TradingView live chart and curated real-time newsfeed (localized in multiple languages), giving essential context alongside the stoplight signal.',
    icon: IconNews,
  },
  {
    title: 'Quality & Transparency',
    text:
      'We combine automated data pipelines with rigorous logic to ensure every score is explainable — every BUY / HOLD / SELL can be decomposed into its drivers.',
    icon: IconEye,
  },
]