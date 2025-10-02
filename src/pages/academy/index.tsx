// src/pages/academy/index.tsx
import Head from 'next/head'
import Link from 'next/link'
import { useMemo } from 'react'

type ArticleStub = {
  slug: string
  title: string
  excerpt: string
  tag?: string
}

export default function Academy() {
  // Placeholder data — later kun je dit vullen via CMS/MDX/API
  const articles = useMemo<ArticleStub[]>(
    () => [
      { slug: 'what-is-momentum',        title: 'What is momentum?',        excerpt: 'A simple, practical explanation of price momentum and how to use it.' },
      { slug: 'rsi-explained',           title: 'RSI explained',            excerpt: 'Overbought vs. oversold, and what that actually means for entries.' },
      { slug: 'macd-basics',             title: 'MACD basics',              excerpt: 'Signal line, histogram, crossovers — the parts that matter.' },
      { slug: 'volume-as-a-signal',      title: 'Volume as a signal',       excerpt: 'Why volume confirms trends and how to read spikes properly.' },
      { slug: 'moving-averages-101',     title: 'Moving averages 101',      excerpt: '50 vs 200, golden/death cross, smoothing and pitfalls.' },
      { slug: 'risk-management',         title: 'Risk management',          excerpt: 'Sizing, stop-loss logic, and compounding your edge.' },
      { slug: 'market-regimes',          title: 'Market regimes',           excerpt: 'Trending, ranging, volatile: adapt your strategy to the regime.' },
      { slug: 'backtesting-quickstart',  title: 'Backtesting quickstart',   excerpt: 'How to evaluate a signal before you risk real capital.' },
    ],
    []
  )

  return (
    <>
      <Head>
        <title>SignalHub Academy — Learn the Signals</title>
        <meta
          name="description"
          content="SignalHub Academy: bite-sized knowledge articles on momentum, volume, RSI, MACD, market regimes, risk, and more."
        />
      </Head>

      <main className="max-w-6xl mx-auto px-4 py-10">
        <header className="mb-6">
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-white">
            Academy
          </h1>
          <p className="text-white/70 mt-2">
            Bite-sized tutorials to understand the signals behind the dashboard.
          </p>
        </header>

        {/* Grid met kaarten (placeholder links) */}
        <section className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {articles.map((a) => (
            <Link
              key={a.slug}
              href={`/academy/${a.slug}`}
              className="group block rounded-2xl border border-white/10 bg-ink table-card p-4 hover:bg-white/5 transition"
            >
              <div className="flex items-start gap-3">
                {/* Subtiele placeholder-illustratie */}
                <div className="shrink-0 w-10 h-10 rounded-xl bg-white/10 grid place-items-center">
                  <svg width="20" height="20" viewBox="0 0 24 24" className="opacity-80" aria-hidden>
                    <path fill="currentColor" d="M12 3l9 4.5v9L12 21 3 16.5v-9L12 3Zm0 2.2L5 8v7l7 3.8L19 15V8l-7-2.8Z"/>
                  </svg>
                </div>

                <div className="min-w-0">
                  <h2 className="font-semibold text-white group-hover:underline truncate">
                    {a.title}
                  </h2>
                  <p className="text-sm text-white/70 mt-1 line-clamp-2">
                    {a.excerpt}
                  </p>
                  <div className="mt-3 text-xs text-white/60 group-hover:text-white/70">
                    Read more →
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </section>
      </main>
    </>
  )
}