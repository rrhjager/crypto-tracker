import Head from 'next/head'
import Link from 'next/link'

export default function RSIExplained() {
  return (
    <>
      <Head>
        <title>RSI explained — SignalHub Academy</title>
        <meta name="description" content="Learn how the relative strength index works, how to use it in context and how to avoid common traps." />
      </Head>

      <main className="max-w-3xl mx-auto px-4 py-12">
        <nav className="text-sm text-white/60 mb-4">
          <Link href="/" className="link">Home</Link><span className="mx-2">/</span>
          <Link href="/academy" className="link">Academy</Link><span className="mx-2">/</span>
          <span className="text-white/80">RSI explained</span>
        </nav>

        <article className="table-card p-6">
          <h1 className="text-3xl font-extrabold tracking-tight text-white">RSI explained</h1>
          <div className="prose prose-invert prose-sm sm:prose-base max-w-none mt-4">
            <p>
              The relative strength index is an oscillator that measures the balance of gains and losses over a fixed lookback, often fourteen periods. Readings sit between zero and one hundred. Values above seventy reflect strong upside pressure while values below thirty reflect strong downside pressure. The middle area around fifty works well as a simple trend filter.
            </p>
            <p className="mt-3">
              Avoid the common trap of selling just because the reading is high or buying just because it is low. In strong trends the indicator can remain elevated while price continues higher. Use context. If price holds above a rising moving average and the indicator spends most time above fifty momentum remains healthy. If price stays below a falling average and the indicator fails near fifty momentum remains weak.
            </p>
            <p className="mt-3">
              Divergences add nuance. If price prints a higher high but the indicator does not the impulse may fade. If price prints a lower low but the indicator does not selling pressure may ease. Treat these as early warnings and wait for confirmation from structure such as a break of support or resistance before acting.
            </p>
            <p className="mt-6">
              <Link href="/crypto" className="link">See live RSI with context in the Crypto tracker →</Link>
            </p>
          </div>
        </article>
      </main>
    </>
  )
}