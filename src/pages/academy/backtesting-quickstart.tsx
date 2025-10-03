import Head from 'next/head'
import Link from 'next/link'

export default function BacktestingQuickstart() {
  return (
    <>
      <Head>
        <title>Backtesting quickstart — SignalHub Academy</title>
        <meta name="description" content="Test rules on history to understand behavior and set expectations without curve fitting." />
      </Head>

      <main className="max-w-3xl mx-auto px-4 py-12">
        <nav className="text-sm text-white/60 mb-4">
          <Link href="/" className="link">Home</Link><span className="mx-2">/</span>
          <Link href="/academy" className="link">Academy</Link><span className="mx-2">/</span>
          <span className="text-white/80">Backtesting quickstart</span>
        </nav>

        <article className="table-card p-6">
          <h1 className="text-3xl font-extrabold tracking-tight text-white">Backtesting quickstart</h1>
          <div className="prose prose-invert prose-sm sm:prose-base max-w-none mt-4">
            <p>
              Backtesting is the practice of running a strategy on historical data to understand behavior and frame expectations. The goal is not to find the perfect setting for the past but to design a simple robust plan that holds up across many environments. Keep rules clear for entries, exits, position size and how you handle missing data or gaps.
            </p>
            <p className="mt-3">
              Split history into a design set and a validation set. Look beyond return. Study the depth and duration of drawdowns, the relation between gains and losses, the distribution of outcomes and your exposure per theme. Favor methods that remain acceptable across a range of parameters rather than a fragile peak that only works in one case.
            </p>
            <p className="mt-3">
              Beware of overfitting and leakage. Use simple filters, avoid look ahead information and keep the number of degrees of freedom small. Paper trade the strategy to surface execution issues and feed differences. Document results so that real time decisions follow a known plan rather than emotion.
            </p>
            <p className="mt-6">
              <Link href="/crypto" className="link">Go from idea to live signals in the Crypto tracker →</Link>
            </p>
          </div>
        </article>
      </main>
    </>
  )
}