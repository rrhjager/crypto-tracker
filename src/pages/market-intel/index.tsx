// src/pages/index.tsx
import Head from 'next/head'
import Link from 'next/link'

export default function HomePage() {
  return (
    <>
      <Head>
        <title>SignalHub — Clarity in Markets</title>
      </Head>

      <main className="min-h-screen">
        {/* Hero */}
        <section className="max-w-6xl mx-auto px-4 pt-16 pb-12 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 dark:text-white">
            Welcome to SignalHub
          </h1>
          <p className="mt-4 text-lg text-gray-600 dark:text-gray-400">
            Fast, clear market insights for crypto & equities.
          </p>
        </section>

        {/* Quick links */}
        <section className="max-w-6xl mx-auto px-4 pb-16 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          <Link href="/crypto" className="table-card p-6 text-center hover:shadow">
            <div className="text-xl font-semibold">Crypto tracker</div>
            <p className="mt-2 text-gray-600 dark:text-gray-400">View biggest movers & market data.</p>
          </Link>

          <Link href="/stocks" className="table-card p-6 text-center hover:shadow">
            <div className="text-xl font-semibold">Stock tracker</div>
            <p className="mt-2 text-gray-600 dark:text-gray-400">Follow global indices & top stocks.</p>
          </Link>

          <Link href="/intel/macro" className="table-card p-6 text-center hover:shadow">
            <div className="text-xl font-semibold">Macro calendar</div>
            <p className="mt-2 text-gray-600 dark:text-gray-400">Upcoming key macroeconomic events.</p>
          </Link>

          <Link href="/intel" className="table-card p-6 text-center hover:shadow">
            <div className="text-xl font-semibold">Congress trading</div>
            <p className="mt-2 text-gray-600 dark:text-gray-400">Monitor trades reported by U.S. Congress.</p>
          </Link>

          <Link href="/intel/hedgefunds" className="table-card p-6 text-center hover:shadow">
            <div className="text-xl font-semibold">Hedge funds</div>
            <p className="mt-2 text-gray-600 dark:text-gray-400">Insights into hedge fund positions.</p>
          </Link>

          <Link href="/intel/sectors" className="table-card p-6 text-center hover:shadow">
            <div className="text-xl font-semibold">Sectors</div>
            <p className="mt-2 text-gray-600 dark:text-gray-400">Compare sector performance.</p>
          </Link>
        </section>
      </main>
    </>
  )
}