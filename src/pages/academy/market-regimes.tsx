import Head from 'next/head'
import Link from 'next/link'

export default function MarketRegimes() {
  return (
    <>
      <Head>
        <title>Market regimes — SignalHub Academy</title>
        <meta name="description" content="Trends, ranges and turbulence each need a different playbook. Learn to recognize the environment and adapt." />
      </Head>

      <main className="max-w-3xl mx-auto px-4 py-12">
        <nav className="text-sm text-white/60 mb-4">
          <Link href="/" className="link">Home</Link><span className="mx-2">/</span>
          <Link href="/academy" className="link">Academy</Link><span className="mx-2">/</span>
          <span className="text-white/80">Market regimes</span>
        </nav>

        <article className="table-card p-6">
          <h1 className="text-3xl font-extrabold tracking-tight text-white">Market regimes</h1>
          <div className="prose prose-invert prose-sm sm:prose-base max-w-none mt-4">
            <p>
              Markets rotate between trending phases, range bound phases and periods with very high volatility. In a trend it pays to follow strength and trail risk. In ranges it pays to fade extremes back to the middle. In turbulence the priority is to trade smaller, choose more selective entries and let conditions calm down before pressing.
            </p>
            <p className="mt-3">
              Use structure and activity to spot transitions. A series of failed breakouts with fading activity often signals a range ahead. A tight base that forms on declining activity and resolves with a surge often marks the start of a new leg. None of this is certain, but it helps you ask better questions about where you are in the map.
            </p>
            <p className="mt-3">
              Make regime awareness a standard step in your routine. Demand more confirmation when the environment is poor for your style and reduce size when conditions change. This simple habit improves outcomes without adding complexity to your toolkit.
            </p>
            <p className="mt-6">
              <Link href="/crypto" className="link">See regimes in context inside the Crypto tracker →</Link>
            </p>
          </div>
        </article>
      </main>
    </>
  )
}