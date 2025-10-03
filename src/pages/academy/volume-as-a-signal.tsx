import Head from 'next/head'
import Link from 'next/link'

export default function VolumeAsASignal() {
  return (
    <>
      <Head>
        <title>Volume as a signal — SignalHub Academy</title>
        <meta name="description" content="Volume reveals conviction. Learn to compare activity with an average and confirm real moves." />
      </Head>

      <main className="max-w-3xl mx-auto px-4 py-12">
        <nav className="text-sm text-white/60 mb-4">
          <Link href="/" className="link">Home</Link><span className="mx-2">/</span>
          <Link href="/academy" className="link">Academy</Link><span className="mx-2">/</span>
          <span className="text-white/80">Volume as a signal</span>
        </nav>

        <article className="table-card p-6">
          <h1 className="text-3xl font-extrabold tracking-tight text-white">Volume as a signal</h1>
          <div className="prose prose-invert prose-sm sm:prose-base max-w-none mt-4">
            <p>
              Volume measures how many participants take part in a move. A breakout that runs on activity well above a typical day carries more weight than a quiet push. Strong trends often continue when pullbacks see muted activity because sellers are not aggressive enough to flip control. This makes simple volume ratios a powerful confirmation tool.
            </p>
            <p className="mt-3">
              Compare current activity with a rolling average such as twenty sessions and compute a ratio. A value far above one signals conviction while a value well below one shows indifference. Spikes after a quiet base can mark the start of a new leg. Very high activity without progress can also hint at exhaustion as both sides unload size without clear follow through.
            </p>
            <p className="mt-3">
              Use volume to confirm structure. In healthy uptrends you want rising activity on advances and fading activity on pullbacks. If the pattern flips for a stretch of time the balance of power may be changing. Always pair your read with trend and levels so that you act on context rather than on a single number.
            </p>
            <p className="mt-6">
              <Link href="/crypto" className="link">Check live volume ratios in the Crypto tracker →</Link>
            </p>
          </div>
        </article>
      </main>
    </>
  )
}