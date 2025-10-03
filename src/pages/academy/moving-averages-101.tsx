import Head from 'next/head'
import Link from 'next/link'

export default function MovingAverages101() {
  return (
    <>
      <Head>
        <title>Moving averages 101 — SignalHub Academy</title>
        <meta name="description" content="Moving averages smooth price, define direction and act as dynamic reference points for risk." />
      </Head>

      <main className="max-w-3xl mx-auto px-4 py-12">
        <nav className="text-sm text-white/60 mb-4">
          <Link href="/" className="link">Home</Link><span className="mx-2">/</span>
          <Link href="/academy" className="link">Academy</Link><span className="mx-2">/</span>
          <span className="text-white/80">Moving averages 101</span>
        </nav>

        <article className="table-card p-6">
          <h1 className="text-3xl font-extrabold tracking-tight text-white">Moving averages 101</h1>
          <div className="prose prose-invert prose-sm sm:prose-base max-w-none mt-4">
            <p>
              A moving average smooths data by taking a rolling window of closes. A short window reacts fast and helps timing while a long window reacts slowly and defines the bigger trend with important reference levels. Many traders use both and look for alignment to filter noise.
            </p>
            <p className="mt-3">
              Simple and exponential variants are common. The simple version weighs all observations equally while the exponential version puts more weight on recent observations. No single variant wins in every market. Choose settings that fit your time frame and test them across different assets and periods.
            </p>
            <p className="mt-3">
              Focus on slope, crossovers and the way price behaves around the average. In strong advances long averages often act as dynamic support. In persistent declines they act as dynamic resistance. These reference points allow you to define risk with clarity and avoid guessing tops and bottoms.
            </p>
            <p className="mt-6">
              <Link href="/crypto" className="link">See moving average signals inside the Crypto tracker →</Link>
            </p>
          </div>
        </article>
      </main>
    </>
  )
}