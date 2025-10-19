// src/pages/market-intel/index.tsx
import Head from 'next/head'
import type { GetStaticProps } from 'next'
import useSWR from 'swr'
import React from 'react'

type IntelAggregate = {
  sectors?: any | null
  macro?: any | null
  breadth?: any | null
  hedgefunds?: any | null
  congress?: any | null
  news?: any[] | null
  updatedAt: number
  meta?: { errors?: string[]; source?: 'fresh' | 'kv' }
}

const fetcher = (u: string) => fetch(u, { cache: 'no-store' }).then(r => r.json())

// Base URL helper voor SSG
function publicBaseUrl() {
  return process.env.NEXT_PUBLIC_BASE_URL || 'https://www.signalhub.tech'
}

export const getStaticProps: GetStaticProps = async () => {
  const base = publicBaseUrl()
  try {
    const r = await fetch(`${base}/api/market/intel-aggregate`, {
      // voorkomt dat eventuele middleware origin-check raar doet bij build
      headers: { 'x-ssg': '1' },
      cache: 'no-store',
    })
    const initial: IntelAggregate = await r.json()
    return { props: { initial }, revalidate: 60 } // ISR elke 60s
  } catch {
    // SSG fallback: lege state (client SWR haalt alsnog)
    const initial: IntelAggregate = { updatedAt: Date.now() }
    return { props: { initial }, revalidate: 60 }
  }
}

export default function MarketIntelPage({ initial }: { initial: IntelAggregate }) {
  // Tabs pollen vaak dubbel; gate op zichtbaarheid
  const visible = typeof document === 'undefined' ? true : document.visibilityState === 'visible'
  const refreshInterval = visible ? 120_000 : 0 // 120s
  const { data } = useSWR<IntelAggregate>(
    '/api/market/intel-aggregate',
    fetcher,
    { fallbackData: initial, refreshInterval, revalidateOnFocus: false }
  )

  const agg = data || initial
  const updated = new Date(agg?.updatedAt || Date.now()).toLocaleTimeString('nl-NL', { hour12: false })

  return (
    <>
      <Head>
        <title>Market Intel — SignalHub</title>
        <meta name="description" content="Dagelijkse market intelligence: sectors, breadth, macro, hedgefunds, congres, nieuws." />
      </Head>

      <main className="min-h-screen">
        <section className="max-w-6xl mx-auto px-4 pt-16 pb-4">
          <h1 className="hero">Market Intel</h1>
          <div className="text-xs text-gray-500">Laatste update: {updated} {agg?.meta?.source ? `· ${agg.meta.source}` : ''}</div>
          {agg?.meta?.errors?.length ? (
            <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
              Sommige bronnen faalden: {agg.meta.errors.slice(0, 2).join(' · ')}{agg.meta.errors.length > 2 ? '…' : ''}
            </div>
          ) : null}
        </section>

        <section className="max-w-6xl mx-auto px-4 pb-16 grid md:grid-cols-2 gap-4">
          {/* === Voorbeelden: vervang deze blokken door jouw bestaande UI-componenten === */}

          {/* Sectors */}
          <div className="table-card p-4">
            <div className="font-semibold mb-2">Sectors</div>
            {/* <YourSectorsChart data={agg.sectors} /> */}
            <pre className="text-xs overflow-auto">{JSON.stringify(agg.sectors ?? {}, null, 2)}</pre>
          </div>

          {/* Breadth / Market Scores */}
          <div className="table-card p-4">
            <div className="font-semibold mb-2">Breadth</div>
            {/* <BreadthWidget data={agg.breadth} /> */}
            <pre className="text-xs overflow-auto">{JSON.stringify(agg.breadth ?? {}, null, 2)}</pre>
          </div>

          {/* Macro */}
          <div className="table-card p-4">
            <div className="font-semibold mb-2">Macro</div>
            {/* <MacroCards data={agg.macro} /> */}
            <pre className="text-xs overflow-auto">{JSON.stringify(agg.macro ?? {}, null, 2)}</pre>
          </div>

          {/* Hedgefunds */}
          <div className="table-card p-4">
            <div className="font-semibold mb-2">Hedgefunds</div>
            {/* <HedgefundsTable data={agg.hedgefunds} /> */}
            <pre className="text-xs overflow-auto">{JSON.stringify(agg.hedgefunds ?? {}, null, 2)}</pre>
          </div>

          {/* Congress */}
          <div className="table-card p-4">
            <div className="font-semibold mb-2">Congress</div>
            {/* <CongressTrades data={agg.congress} /> */}
            <pre className="text-xs overflow-auto">{JSON.stringify(agg.congress ?? {}, null, 2)}</pre>
          </div>

          {/* News */}
          <div className="table-card p-4 md:col-span-2">
            <div className="font-semibold mb-2">News</div>
            {/* <NewsList items={agg.news ?? []} /> */}
            <pre className="text-xs overflow-auto">{JSON.stringify(agg.news ?? [], null, 2)}</pre>
          </div>
        </section>
      </main>
    </>
  )
}