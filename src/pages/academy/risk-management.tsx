import Head from 'next/head'
import Link from 'next/link'

export default function RiskManagement() {
  return (
    <>
      <Head>
        <title>Risk management — SignalHub Academy</title>
        <meta name="description" content="Control loss, size positions sensibly and respect volatility so that your system survives many cycles." />
      </Head>

      <main className="max-w-3xl mx-auto px-4 py-12">
        <nav className="text-sm text-white/60 mb-4">
          <Link href="/" className="link">Home</Link><span className="mx-2">/</span>
          <Link href="/academy" className="link">Academy</Link><span className="mx-2">/</span>
          <span className="text-white/80">Risk management</span>
        </nav>

        <article className="table-card p-6">
          <h1 className="text-3xl font-extrabold tracking-tight text-white">Risk management</h1>
          <div className="prose prose-invert prose-sm sm:prose-base max-w-none mt-4">
            <p>
              Results begin with risk control. Choose a small fixed percentage of your capital that you are willing to risk per idea and compute your position from the distance between entry and stop. Large stops lead to small positions and small stops lead to larger positions while portfolio risk remains constant. This keeps you in the game when conditions change.
            </p>
            <p className="mt-3">
              Define your exit before you enter. Place the stop where the idea is invalid and treat small losses as normal business expenses. Spread risk across themes so that correlation does not hit you at once and scale exposure down when volatility expands. Avoid revenge trading and let your rules protect you from emotion.
            </p>
            <p className="mt-3">
              Keep a journal. Record setup, reason, risk, result and lessons. Review it weekly to spot patterns that help or hurt your process. Over time this loop improves discipline and sharpens your edge more than any single indicator can.
            </p>
            <p className="mt-6">
              <Link href="/about" className="link">Read how we think about risk on the About page →</Link>
            </p>
          </div>
        </article>
      </main>
    </>
  )
}