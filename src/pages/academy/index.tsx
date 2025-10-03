import Head from 'next/head'
import Link from 'next/link'

const ARTICLES = [
  { slug: 'what-is-momentum',       title: 'What is momentum',        excerpt: 'Understand why winners often keep winning for a while and how to ride the wave responsibly.' },
  { slug: 'rsi-explained',          title: 'RSI explained',           excerpt: 'Learn how the relative strength index works and how to avoid the classic overbought and oversold trap.' },
  { slug: 'macd-basics',            title: 'MACD basics',             excerpt: 'See how the line, signal and histogram map trend impulse and shifts in control.' },
  { slug: 'volume-as-a-signal',     title: 'Volume as a signal',      excerpt: 'Use activity relative to average to confirm breakouts and filter weak moves.' },
  { slug: 'moving-averages-101',    title: 'Moving averages 101',     excerpt: 'Smooth price, define direction and find dynamic support and resistance.' },
  { slug: 'risk-management',         title: 'Risk management',         excerpt: 'Size positions, pre define exits and respect volatility so your system survives.' },
  { slug: 'market-regimes',          title: 'Market regimes',          excerpt: 'Trends, ranges and turbulence each demand a different playbook.' },
  { slug: 'backtesting-quickstart',  title: 'Backtesting quickstart',  excerpt: 'Test rules on history without curve fitting and build confidence in your plan.' },
]

export default function AcademyIndex() {
  return (
    <>
      <Head>
        <title>SignalHub Academy — Learn the Signals</title>
        <meta name="description" content="SignalHub Academy: clear, practical articles on momentum, RSI, MACD, volume, moving averages, risk management, market regimes and backtesting." />
      </Head>

      <main className="max-w-6xl mx-auto px-4 py-12">
        <header className="mb-6">
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-white">Academy</h1>
          <p className="text-white/80 mt-2 max-w-3xl">
            Short, practical knowledge articles that cut through noise and improve decisions. Click a tile to read the full article.
          </p>
        </header>

        <section className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {ARTICLES.map(a => (
            <Link key={a.slug} href={`/academy/${a.slug}`} className="table-card p-4 rounded-2xl hover:bg-white/10 transition group flex flex-col">
              <h2 className="font-semibold text-white group-hover:underline">{a.title}</h2>
              <p className="text-sm text-white/70 mt-2">{a.excerpt}</p>
              <span className="mt-3 text-xs text-white/60 inline-flex items-center gap-1">
                Read article
                <svg width="14" height="14" viewBox="0 0 24 24"><path fill="currentColor" d="M13 5l7 7-7 7v-4H4v-6h9V5z"/></svg>
              </span>
            </Link>
          ))}
        </section>
      </main>
    </>
  )
}