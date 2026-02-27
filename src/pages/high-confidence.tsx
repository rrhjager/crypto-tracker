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
  const rows = useMemo(() => {
    const byMarket = new Map((data?.markets || []).map(m => [m.market, m]))
    return HC_MARKET_ORDER.map(m => {
      const rec = byMarket.get(m)?.recommendation || null
      return {
        market: m,
        label: HC_MARKET_META[m].label,
        href: HC_MARKET_META[m].href,
        recommendation: rec,
        advice: rec?.meetsTarget ? 'ACTIEF' : 'WACHT',
      }
    })
  }, [data])

  const active = [...rows]
    .filter(r => r.recommendation?.meetsTarget)
    .sort((a, b) => {
      const aa = a.recommendation!
      const bb = b.recommendation!
      if (bb.winrate !== aa.winrate) return bb.winrate - aa.winrate
      return bb.avgReturnPct - aa.avgReturnPct
    })
  const waiting = rows.filter(r => !r.recommendation?.meetsTarget)
  const generatedAt = data?.meta?.generatedAt ? new Date(data.meta.generatedAt).toLocaleString('nl-NL') : '—'
  const target = fmtRatioPct(data?.meta?.targetWinrate ?? null)
  const waitingCount = Math.max(0, rows.length - active.length)

  return (
    <>
      <Head>
        <title>High-Confidence Advies | SignalHub</title>
        <meta
          name="description"
          content="Alleen high-confidence signalen die het ingestelde winrate-target halen, inclusief termijn, cutoff en verwacht rendement."
        />
      </Head>

      <main className="max-w-screen-xl mx-auto px-4 pt-10 pb-16 space-y-6">
        <section className="rounded-3xl border border-emerald-300/40 bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 p-6 shadow-[0_20px_60px_-28px_rgba(16,185,129,0.45)] dark:border-emerald-500/30 dark:from-emerald-950/35 dark:via-cyan-950/25 dark:to-slate-950">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-white">High-Confidence Advies</h1>
              <p className="text-sm text-slate-700/85 dark:text-white/70">
                Elke markt krijgt een advies. Alleen `meetsTarget = true` wordt als actieve zekerheid getoond.
              </p>
            </div>
            <Link href="/" className="rounded-full border border-slate-400/35 bg-white/70 px-4 py-2 text-[12px] font-medium text-slate-800 hover:bg-white dark:border-white/20 dark:bg-white/10 dark:text-white">
              Terug naar home
            </Link>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-3 py-1 text-emerald-900 dark:text-emerald-200">
              Actief: {active.length}/{rows.length}
            </span>
            <span className="rounded-full border border-slate-400/30 bg-white/60 px-3 py-1 text-slate-700 dark:border-white/20 dark:bg-white/5 dark:text-white/70">
              Wacht: {waitingCount}
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
              <div className="text-[11px] text-slate-600 dark:text-white/55">Actieve zekerheden</div>
              <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{active.length}</div>
              <div className="text-[11px] text-slate-700/75 dark:text-white/60">Markten met direct trade-advies</div>
            </div>
            <div className="rounded-xl border border-slate-300/45 bg-white/70 p-3 dark:border-white/15 dark:bg-white/5">
              <div className="text-[11px] text-slate-600 dark:text-white/55">Gem. winrate (met advies)</div>
              <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">
                {fmtRatioPct(data?.summary?.avgWinrate ?? null)}
              </div>
              <div className="text-[11px] text-slate-700/75 dark:text-white/60">Gemiddeld over aanbevolen setups</div>
            </div>
            <div className="rounded-xl border border-slate-300/45 bg-white/70 p-3 dark:border-white/15 dark:bg-white/5">
              <div className="text-[11px] text-slate-600 dark:text-white/55">Gem. verwacht rendement</div>
              <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">
                {fmtRetPct(data?.summary?.avgReturnPct ?? null)}
              </div>
              <div className="text-[11px] text-slate-700/75 dark:text-white/60">Per signaal met cutoff-filter</div>
            </div>
          </div>
        </section>

        {error && (
          <section className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
            Fout bij laden van high-confidence analyse: {error}
          </section>
        )}

        <section className="rounded-2xl border border-emerald-400/25 bg-white/70 p-5 dark:border-emerald-500/25 dark:bg-white/5">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Actieve zekerheden</h2>
          <p className="text-[12px] text-slate-700/80 dark:text-white/60 mb-3">
            Alleen markten met `meetsTarget = true` en voldoende sample-size.
          </p>

          {active.length === 0 ? (
            <div className="text-sm text-slate-600 dark:text-white/70">Geen actieve zekerheden. Advies: wachten.</div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {active.map((r) => {
                const rec = r.recommendation!
                return (
                  <Link
                    key={`hc-active-${r.market}`}
                    href={r.href}
                    className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 transition hover:bg-emerald-500/15"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-slate-900 dark:text-white">{r.label}</div>
                      <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white">ACTIEF</span>
                    </div>
                    <div className="mt-2 text-[12px] text-slate-700/85 dark:text-white/70">
                      {horizonLabel(rec.horizon)} • cutoff {rec.cutoff}
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                      <div>
                        <div className="text-slate-600 dark:text-white/55">Winrate</div>
                        <div className="font-semibold text-emerald-800 dark:text-emerald-200">{fmtRatioPct(rec.winrate)}</div>
                      </div>
                      <div>
                        <div className="text-slate-600 dark:text-white/55">Coverage</div>
                        <div className="font-semibold text-slate-800 dark:text-white">{fmtRatioPct(rec.coverage)}</div>
                      </div>
                      <div>
                        <div className="text-slate-600 dark:text-white/55">Gem.</div>
                        <div className="font-semibold text-slate-800 dark:text-white">{fmtRetPct(rec.avgReturnPct)}</div>
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-300/35 bg-white/70 p-5 dark:border-white/15 dark:bg-white/5">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Advies per markt</h2>
          <p className="text-[12px] text-slate-700/80 dark:text-white/60 mb-3">
            Alle markten krijgen advies. `ACTIEF` betekent trade toegestaan, `WACHT` betekent geen instap.
          </p>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((r) => {
              const rec = r.recommendation
              return (
                <Link
                  key={`hc-row-${r.market}`}
                  href={r.href}
                  className={`rounded-xl border p-3 transition hover:-translate-y-[1px] ${
                    r.advice === 'ACTIEF'
                      ? 'border-emerald-500/35 bg-emerald-500/10'
                      : 'border-slate-300/50 bg-white/70 dark:border-white/15 dark:bg-white/5'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-slate-900 dark:text-white">{r.label}</div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        r.advice === 'ACTIEF'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-200 text-slate-700 dark:bg-white/15 dark:text-white/70'
                      }`}
                    >
                      {r.advice}
                    </span>
                  </div>

                  <div className="mt-2 text-[11px] text-slate-700/80 dark:text-white/60">
                    {rec
                      ? `${horizonLabel(rec.horizon)} • cutoff ${rec.cutoff}`
                      : 'Onvoldoende data voor aanbeveling'}
                  </div>

                  <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                    <div>
                      <div className="text-slate-600 dark:text-white/55">Winrate</div>
                      <div className="font-semibold text-slate-900 dark:text-white">{rec ? fmtRatioPct(rec.winrate) : '—'}</div>
                    </div>
                    <div>
                      <div className="text-slate-600 dark:text-white/55">Coverage</div>
                      <div className="font-semibold text-slate-900 dark:text-white">{rec ? fmtRatioPct(rec.coverage) : '—'}</div>
                    </div>
                    <div>
                      <div className="text-slate-600 dark:text-white/55">Gem.</div>
                      <div className="font-semibold text-slate-900 dark:text-white">{rec ? fmtRetPct(rec.avgReturnPct) : '—'}</div>
                    </div>
                  </div>

                  <div className="mt-2 text-[10px] text-slate-600 dark:text-white/55">
                    meetsTarget: {rec?.meetsTarget ? 'ja' : 'nee'}
                  </div>
                </Link>
              )
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-300/35 bg-white/70 p-5 dark:border-white/15 dark:bg-white/5">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Wachtlijst</h2>
          <p className="text-[12px] text-slate-700/80 dark:text-white/60 mb-3">
            Markten die nu geen zekerheid halen. Deze blijven op `WACHT`.
          </p>

          {waiting.length === 0 ? (
            <div className="text-sm text-slate-600 dark:text-white/70">Geen wachtlijst. Alle markten zijn actief.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {waiting.map((r) => (
                <Link
                  key={`hc-wait-${r.market}`}
                  href={r.href}
                  className="rounded-full border border-slate-300/60 bg-white/70 px-3 py-1 text-[11px] font-medium text-slate-700 hover:bg-white dark:border-white/15 dark:bg-white/5 dark:text-white/70"
                >
                  {r.label}
                </Link>
              ))}
            </div>
          )}
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
