// src/pages/past-performance/index.tsx
import Link from 'next/link'

export default function PastPerformanceIndex() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-3xl font-extrabold mb-2">Past performance</h1>
      <p className="text-white/70 mb-8">
        Transparantiepagina’s met historische resultaten op basis van de SignalHub BUY/SELL switches.
      </p>

      <div className="grid md:grid-cols-2 gap-4">
        <Link href="/past-performance/crypto" className="rounded-2xl bg-white/[0.04] ring-1 ring-white/10 p-5 hover:bg-white/[0.06] transition">
          <div className="text-white/90 font-semibold mb-1">Crypto past performance</div>
          <div className="text-white/60 text-sm">Laatste BUY/SELL per coin + 24h/7d/30d returns.</div>
        </Link>

        <div className="rounded-2xl bg-white/[0.02] ring-1 ring-white/10 p-5 opacity-70">
          <div className="text-white/90 font-semibold mb-1">Equities past performance</div>
          <div className="text-white/60 text-sm">Coming next.</div>
        </div>
      </div>
    </main>
  )
}