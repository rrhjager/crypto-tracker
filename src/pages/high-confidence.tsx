import Head from 'next/head'
import type { GetServerSideProps } from 'next'
import Link from 'next/link'
import { useMemo } from 'react'
import { HC_MARKET_META, HC_MARKET_ORDER, horizonLabel, type HCResponse } from '@/lib/highConfidence'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '') || ''

type Props = {
  data: HCResponse | null
  error: string | null
}

const fmtRatioPct = (v: number | null | undefined, d = 1) =>
  Number.isFinite(v as number) ? `${((v as number) * 100).toFixed(d)}%` : '—'
const fmtRetPct = (v: number | null | undefined, d = 2) =>
  Number.isFinite(v as number) ? `${(Number(v) >= 0 ? '+' : '')}${Number(v).toFixed(d)}%` : '—'

export default function HighConfidencePage({ data, error }: Props) {
  const generatedAt = data?.meta?.generatedAt ? new Date(data.meta.generatedAt).toLocaleString('nl-NL') : '—'
  const target = fmtRatioPct(data?.meta?.targetWinrate ?? null)
  const activeAssets = data?.assets?.active || []
  const waitingAssets = data?.assets?.waiting || []

  const marketBlocks = useMemo(() => {
    const byMarket = data?.assets?.byMarket || ({} as any)
    return HC_MARKET_ORDER.map((market) => ({
      market,
      label: HC_MARKET_META[market].label,
      href: HC_MARKET_META[market].href,
      items: Array.isArray(byMarket[market]) ? byMarket[market] : [],
    }))
  }, [data])

  return (
    <>
      <Head>
        <title>High-Confidence Advies | SignalHub</title>
        <meta
          name="description"
          content="High-confidence advies op losse aandelen en crypto's, met ACTIEF/WACHT per asset."
        />
      </Head>

      <main className="max-w-screen-xl mx-auto px-4 pt-10 pb-16 space-y-6">
        <section className="rounded-3xl border border-emerald-300/40 bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 p-6 shadow-[0_20px_60px_-28px_rgba(16,185,129,0.45)] dark:border-emerald-500/30 dark:from-emerald-950/35 dark:via-cyan-950/25 dark:to-slate-950">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-white">High-Confidence Advies</h1>
              <p className="text-sm text-slate-700/85 dark:text-white/70">
                Actieve zekerheid = een los aandeel of een losse coin, nooit een hele markt.
              </p>
            </div>
            <Link href="/" className="rounded-full border border-slate-400/35 bg-white/70 px-4 py-2 text-[12px] font-medium text-slate-800 hover:bg-white dark:border-white/20 dark:bg-white/10 dark:text-white">
              Terug naar home
            </Link>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-3 py-1 text-emerald-900 dark:text-emerald-200">
              Actieve assets: {data?.summary?.activeAssets ?? 0}
            </span>
            <span className="rounded-full border border-slate-400/30 bg-white/60 px-3 py-1 text-slate-700 dark:border-white/20 dark:bg-white/5 dark:text-white/70">
              Wacht assets: {data?.summary?.waitingAssets ?? 0}
            </span>
            <span className="rounded-full border border-slate-400/30 bg-white/60 px-3 py-1 text-slate-700 dark:border-white/20 dark:bg-white/5 dark:text-white/70">
              Target winrate: {target}
            </span>
            <span className="rounded-full border border-slate-400/30 bg-white/60 px-3 py-1 text-slate-700 dark:border-white/20 dark:bg-white/5 dark:text-white/70">
              Laatste update: {generatedAt}
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-emerald-400/35 bg-white/70 p-3 dark:border-emerald-500/35 dark:bg-white/5">
              <div className="text-[11px] text-slate-600 dark:text-white/55">Assets gescand</div>
              <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{data?.summary?.assetsScanned ?? 0}</div>
            </div>
            <div className="rounded-xl border border-slate-300/45 bg-white/70 p-3 dark:border-white/15 dark:bg-white/5">
              <div className="text-[11px] text-slate-600 dark:text-white/55">BUY/SELL signalen</div>
              <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{data?.summary?.assetsWithSignal ?? 0}</div>
            </div>
            <div className="rounded-xl border border-slate-300/45 bg-white/70 p-3 dark:border-white/15 dark:bg-white/5">
              <div className="text-[11px] text-slate-600 dark:text-white/55">Gem. verwachte return</div>
              <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{fmtRetPct(data?.summary?.avgReturnPct ?? null)}</div>
            </div>
          </div>
        </section>

        {error && (
          <section className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
            Fout bij laden van high-confidence analyse: {error}
          </section>
        )}

        <section className="rounded-2xl border border-emerald-400/25 bg-white/70 p-5 dark:border-emerald-500/25 dark:bg-white/5">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Actieve zekerheden (assets)</h2>
          <p className="text-[12px] text-slate-700/80 dark:text-white/60 mb-3">
            Alleen assets die nu aan cutoff en target voldoen.
          </p>

          {activeAssets.length === 0 ? (
            <div className="text-sm text-slate-600 dark:text-white/70">Geen actieve zekerheden nu.</div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {activeAssets.slice(0, 60).map((a) => (
                <Link
                  key={`hc-active-${a.market}-${a.symbol}`}
                  href={a.href}
                  className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 transition hover:bg-emerald-500/15"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-slate-900 dark:text-white">{a.symbol}</div>
                    <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white">ACTIEF</span>
                  </div>
                  <div className="text-[11px] text-slate-700/80 dark:text-white/65">{HC_MARKET_META[a.market].label} • {a.name}</div>
                  <div className="mt-2 text-[11px] text-slate-700/80 dark:text-white/65">
                    {a.status} • score {a.score} • cutoff {a.cutoff} • {horizonLabel(a.horizon)}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                    <div>
                      <div className="text-slate-600 dark:text-white/55">Winrate</div>
                      <div className="font-semibold text-emerald-800 dark:text-emerald-200">{fmtRatioPct(a.expectedWinrate)}</div>
                    </div>
                    <div>
                      <div className="text-slate-600 dark:text-white/55">Coverage</div>
                      <div className="font-semibold text-slate-800 dark:text-white">{fmtRatioPct(a.expectedCoverage)}</div>
                    </div>
                    <div>
                      <div className="text-slate-600 dark:text-white/55">Gem.</div>
                      <div className="font-semibold text-slate-800 dark:text-white">{fmtRetPct(a.expectedReturnPct)}</div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-300/35 bg-white/70 p-5 dark:border-white/15 dark:bg-white/5">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Advies per markt (losse assets)</h2>
          <p className="text-[12px] text-slate-700/80 dark:text-white/60 mb-3">
            Per markt zie je de beste aandelen/coins met advies.
          </p>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {marketBlocks.map((m) => (
              <div key={`hc-market-assets-${m.market}`} className="rounded-xl border border-slate-300/50 bg-white/70 p-3 dark:border-white/15 dark:bg-white/5">
                <div className="flex items-center justify-between gap-2">
                  <Link href={m.href} className="font-semibold text-slate-900 hover:underline dark:text-white">
                    {m.label}
                  </Link>
                  <span className="text-[10px] text-slate-600 dark:text-white/60">{m.items.length} assets</span>
                </div>
                <ul className="mt-2 space-y-1">
                  {m.items.slice(0, 6).map((a) => (
                    <li key={`hc-mkt-asset-${m.market}-${a.symbol}`}>
                      <Link href={a.href} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-white dark:hover:bg-white/8">
                        <div className="min-w-0">
                          <div className="truncate text-[12px] font-medium text-slate-900 dark:text-white">
                            {a.symbol} <span className="text-slate-600 dark:text-white/55">{a.status}</span>
                          </div>
                          <div className="truncate text-[10px] text-slate-600 dark:text-white/55">
                            score {a.score} • cutoff {a.cutoff}
                          </div>
                        </div>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            a.advice === 'ACTIEF'
                              ? 'bg-emerald-600 text-white'
                              : 'bg-slate-200 text-slate-700 dark:bg-white/15 dark:text-white/70'
                          }`}
                        >
                          {a.advice}
                        </span>
                      </Link>
                    </li>
                  ))}
                  {m.items.length === 0 && (
                    <li className="text-[11px] text-slate-600 dark:text-white/60 px-2 py-1">Geen actieve BUY/SELL signalen.</li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-300/35 bg-white/70 p-5 dark:border-white/15 dark:bg-white/5">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Wachtlijst (assets)</h2>
          <p className="text-[12px] text-slate-700/80 dark:text-white/60 mb-3">
            Wel BUY/SELL signaal, maar nog niet voldoende zekerheid voor ACTIEF.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {waitingAssets.slice(0, 90).map((a) => (
              <Link
                key={`hc-wait-asset-${a.market}-${a.symbol}`}
                href={a.href}
                className="rounded-lg border border-slate-300/60 bg-white/70 px-3 py-2 text-[11px] text-slate-700 hover:bg-white dark:border-white/15 dark:bg-white/5 dark:text-white/70"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{a.symbol}</span>
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-white/15 dark:text-white/70">WACHT</span>
                </div>
                <div className="mt-1 truncate">{HC_MARKET_META[a.market].label} • {a.status} • score {a.score}</div>
                <div className="mt-0.5 truncate text-[10px] text-slate-600 dark:text-white/55">{a.reason}</div>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </>
  )
}

export const getServerSideProps: GetServerSideProps<Props> = async () => {
  try {
    const base =
      process.env.NODE_ENV === 'development'
        ? 'http://localhost:3000'
        : (BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'))
    const r = await fetch(
      `${base}/api/market/high-confidence?targetWinrate=0.8&minCoverage=0.12&minTrades=8`,
      { cache: 'no-store' }
    )
    if (!r.ok) {
      return { props: { data: null, error: `HTTP ${r.status}` } }
    }
    const data = (await r.json()) as HCResponse
    return { props: { data, error: null } }
  } catch (e: any) {
    return { props: { data: null, error: e?.message || 'Failed to fetch' } }
  }
}
