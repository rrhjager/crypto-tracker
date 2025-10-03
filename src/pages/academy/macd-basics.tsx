import Head from 'next/head'
import Link from 'next/link'

export default function MACDBasics() {
  return (
    <>
      <Head>
        <title>MACD basics — SignalHub Academy</title>
        <meta name="description" content="Understand how MACD tracks trend impulse with line, signal and histogram and how to apply it with structure." />
      </Head>

      <main className="max-w-3xl mx-auto px-4 py-12">
        <nav className="text-sm text-white/60 mb-4">
          <Link href="/" className="link">Home</Link><span className="mx-2">/</span>
          <Link href="/academy" className="link">Academy</Link><span className="mx-2">/</span>
          <span className="text-white/80">MACD basics</span>
        </nav>

        <article className="table-card p-6">
          <h1 className="text-3xl font-extrabold tracking-tight text-white">MACD basics</h1>
          <div className="prose prose-invert prose-sm sm:prose-base max-w-none mt-4">
            <p>
              The indicator follows the difference between a fast and a slow exponential average and compares it with a signal line. Above zero indicates that buyers have the upper hand while below zero indicates that sellers control the tape. The histogram shows acceleration by visualizing distance from the signal line which helps you see when thrust expands or contracts.
            </p>
            <p className="mt-3">
              Use three viewpoints. The location relative to zero shows which side has control. Crosses of the signal line show a shift in impulse. The shape of the histogram shows whether momentum accelerates or fades. Combine this with clear levels so that you avoid random whipsaws in noisy ranges.
            </p>
            <p className="mt-3">
              Choose settings that match your horizon. For daily charts fast twelve and slow twenty six with a nine period signal are common and provide a balanced view. On intraday charts shorter settings react quicker but also increase noise. Always pair your read with price structure and volume to avoid over reliance on a single tool.
            </p>
            <p className="mt-6">
              <Link href="/crypto" className="link">View MACD inside the overall score in the Crypto tracker →</Link>
            </p>
          </div>
        </article>
      </main>
    </>
  )
}