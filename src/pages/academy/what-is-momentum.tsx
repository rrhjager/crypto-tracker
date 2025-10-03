import Head from 'next/head'
import Link from 'next/link'

export default function WhatIsMomentum() {
  return (
    <>
      <Head>
        <title>What is momentum — SignalHub Academy</title>
        <meta name="description" content="Momentum explains why price moves tend to persist for a while. Learn to read it and trade with the prevailing flow." />
      </Head>

      <main className="max-w-3xl mx-auto px-4 py-12">
        <nav className="text-sm text-white/60 mb-4">
          <Link href="/" className="link">Home</Link><span className="mx-2">/</span>
          <Link href="/academy" className="link">Academy</Link><span className="mx-2">/</span>
          <span className="text-white/80">What is momentum</span>
        </nav>

        <article className="table-card p-6">
          <h1 className="text-3xl font-extrabold tracking-tight text-white">What is momentum</h1>
          <div className="prose prose-invert prose-sm sm:prose-base max-w-none mt-4">
            <p>
              Momentum describes the speed and persistence of a price move. In simple terms winners often keep winning for a while and losers often stay weak for a while. Traders use momentum to align with the current drive of the market rather than guess exact turning points. This approach accepts that trends can overshoot and that the goal is not a perfect entry but a sensible way to capture the bulk of a move.
            </p>
            <p className="mt-3">
              A practical way to view momentum is to compare price with a moving average. Price above a rising average signals positive drive while price below a falling average signals negative drive. Oscillators like the relative strength index capture a similar concept on a zero to one hundred scale and help you see when the balance of gains and losses improves or degrades.
            </p>
            <p className="mt-3">
              Momentum persists because of behavior. Success attracts new capital. Models scale exposure up or down as signals strengthen or weaken. Newsflow reacts to price which further fuels the move. Nothing lasts forever so risk control is essential. Decide in advance where your idea is invalid and accept that exit without hesitation when reached.
            </p>
            <p className="mt-3">
              Combine clues for quality. Look for price above a rising long average, a short average above a long average, an oscillator that holds in positive territory and supportive volume. The more pieces line up the better the odds that a move is real and not just noise from a small bounce or shakeout.
            </p>
            <p className="mt-6">
              <Link href="/crypto" className="link">Explore live momentum in the Crypto tracker →</Link>
            </p>
          </div>
        </article>
      </main>
    </>
  )
}