import Head from 'next/head'
import type { GetServerSideProps } from 'next'
import Link from 'next/link'
import { HC_MARKET_META, horizonLabel } from '@/lib/highConfidence'
import type { PremiumActiveResponse, PremiumSignal } from '@/lib/premiumActive'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '') || ''

type Props = {
  data: PremiumActiveResponse | null
  error: string | null
}

const fmtRatioPct = (v: number | null | undefined, d = 1) =>
  Number.isFinite(v as number) ? `${((v as number) * 100).toFixed(d)}%` : '—'
const fmtRetPct = (v: number | null | undefined, d = 2) =>
  Number.isFinite(v as number) ? `${(Number(v) >= 0 ? '+' : '')}${Number(v).toFixed(d)}%` : '—'

function sideAccent(status: 'BUY' | 'SELL') {
  return status === 'BUY'
    ? {
        card: 'border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/15',
        badge: 'bg-emerald-600 text-white',
        text: 'text-emerald-800 dark:text-emerald-200',
      }
    : {
        card: 'border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/15',
        badge: 'bg-rose-600 text-white',
        text: 'text-rose-800 dark:text-rose-200',
      }
}

function SignalColumn({
  title,
  subtitle,
  items,
}: {
  title: string
  subtitle: string
  items: PremiumSignal[]
}) {
  return (
    <div className="rounded-2xl border border-slate-300/45 bg-white/75 p-4 dark:border-white/15 dark:bg-white/5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
          <p className="text-[11px] text-slate-700/75 dark:text-white/60">{subtitle}</p>
        </div>
        <span className="rounded-full border border-slate-300/50 bg-white/70 px-2.5 py-1 text-[10px] font-semibold text-slate-700 dark:border-white/15 dark:bg-white/5 dark:text-white/70">
          {items.length}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="text-[12px] text-slate-600 dark:text-white/65">Geen live signalen nu.</div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const accent = sideAccent(item.status)
            return (
              <Link
                key={`premium-${item.market}-${item.symbol}-${item.status}`}
                href={item.href}
                className={`block rounded-xl border p-3 transition ${accent.card}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-slate-900 dark:text-white">{item.symbol}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${accent.badge}`}>{item.action}</span>
                    </div>
                    <div className="truncate text-[11px] text-slate-700/80 dark:text-white/65">
                      {HC_MARKET_META[item.market].label} • {item.name}
                    </div>
                  </div>
                  <div className="text-right text-[11px]">
                    <div className={`font-semibold ${accent.text}`}>{fmtRatioPct(item.validationWinrate)}</div>
                    <div className="text-slate-700/75 dark:text-white/60">{fmtRetPct(item.validationReturnPct)}</div>
                  </div>
                </div>

                <div className="mt-2 text-[11px] text-slate-700/80 dark:text-white/65">
                  <span className={`font-semibold ${accent.text}`}>{item.status}</span> • sterkte {item.strength} • score {item.score} • cutoff {item.cutoff} • {horizonLabel(item.horizon)}
                </div>
                <div className="mt-1 text-[10px] text-slate-600 dark:text-white/55">
                  Validatie: {item.validationTrades} trades • {item.reason}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function PremiumActivePage({ data, error }: Props) {
  const generatedAt = data?.meta?.generatedAt ? new Date(data.meta.generatedAt).toLocaleString('nl-NL') : '—'
  const allSignals = data?.signals?.all || []

  return (
    <>
      <Head>
        <title>Premium Active Signals | SignalHub</title>
        <meta
          name="description"
          content="Striktere, gevalideerde actieve signalen voor betaalde entries/exits. Alleen markten die de strengere validatie halen."
        />
      </Head>

      <main className="max-w-screen-xl mx-auto px-4 pt-10 pb-16 space-y-6">
        <section className="rounded-3xl border border-amber-300/45 bg-gradient-to-br from-amber-50 via-orange-50 to-emerald-50 p-6 shadow-[0_20px_60px_-28px_rgba(245,158,11,0.35)] dark:border-amber-500/30 dark:from-amber-950/30 dark:via-orange-950/20 dark:to-slate-950">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-white">Premium Active Signals</h1>
              <p className="text-sm text-slate-700/85 dark:text-white/70">
                Aparte premium-laag: alleen markten die de strengere leave-one-out validatie halen, blijven over.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/high-confidence"
                className="rounded-full border border-slate-400/35 bg-white/70 px-4 py-2 text-[12px] font-medium text-slate-800 hover:bg-white dark:border-white/20 dark:bg-white/10 dark:text-white"
              >
                Open huidige signals
              </Link>
              <Link
                href="/"
                className="rounded-full border border-amber-500/35 bg-amber-500/10 px-4 py-2 text-[12px] font-medium text-amber-900 hover:bg-amber-500/20 dark:text-amber-200"
              >
                Terug naar home
              </Link>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-full border border-amber-500/35 bg-amber-500/10 px-3 py-1 text-amber-900 dark:text-amber-200">
              Gevalideerde markten: {data?.summary?.validatedMarkets ?? 0}
            </span>
            <span className="rounded-full border border-slate-400/30 bg-white/60 px-3 py-1 text-slate-700 dark:border-white/20 dark:bg-white/5 dark:text-white/70">
              Live signals: {data?.summary?.liveSignals ?? 0}
            </span>
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-emerald-900 dark:text-emerald-200">
              BUY: {data?.summary?.buySignals ?? 0}
            </span>
            <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-rose-900 dark:text-rose-200">
              SELL / EXIT: {data?.summary?.sellSignals ?? 0}
            </span>
            <span className="rounded-full border border-slate-400/30 bg-white/60 px-3 py-1 text-slate-700 dark:border-white/20 dark:bg-white/5 dark:text-white/70">
              Target: {fmtRatioPct(data?.meta?.targetWinrate ?? null)}
            </span>
            <span className="rounded-full border border-slate-400/30 bg-white/60 px-3 py-1 text-slate-700 dark:border-white/20 dark:bg-white/5 dark:text-white/70">
              Update: {generatedAt}
            </span>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-slate-300/45 bg-white/70 p-3 dark:border-white/15 dark:bg-white/5">
              <div className="text-[11px] text-slate-600 dark:text-white/55">Handelsregel</div>
              <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">BUY = instappen / long houden</div>
              <div className="mt-1 text-[11px] text-slate-700/80 dark:text-white/60">Zolang het signaal actief blijft.</div>
            </div>
            <div className="rounded-xl border border-slate-300/45 bg-white/70 p-3 dark:border-white/15 dark:bg-white/5">
              <div className="text-[11px] text-slate-600 dark:text-white/55">Uitstapregel</div>
              <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">SELL = long sluiten / short alleen indien mogelijk</div>
              <div className="mt-1 text-[11px] text-slate-700/80 dark:text-white/60">Bij flip of zodra het signaal verdwijnt.</div>
            </div>
            <div className="rounded-xl border border-slate-300/45 bg-white/70 p-3 dark:border-white/15 dark:bg-white/5">
              <div className="text-[11px] text-slate-600 dark:text-white/55">Validatie</div>
              <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">Leave-one-out op afgesloten signalen</div>
              <div className="mt-1 text-[11px] text-slate-700/80 dark:text-white/60">Alleen markten boven target blijven op deze pagina.</div>
            </div>
          </div>
        </section>

        {error && (
          <section className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
            Fout bij laden van premium active signals: {error}
          </section>
        )}

        <section className="rounded-2xl border border-amber-400/25 bg-white/70 p-5 dark:border-amber-500/25 dark:bg-white/5">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Hoge Threshold Lijst</h2>
          <p className="mb-3 text-[12px] text-slate-700/80 dark:text-white/60">
            Alleen signalen die nu de hoge probability-filter halen. Staat een asset hier niet tussen, dan haalt die de hoge threshold nu niet.
          </p>
          <SignalColumn
            title="Live High-Probability Signals"
            subtitle="Dit is de volledige premium-lijst op dit moment."
            items={allSignals}
          />
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
      `${base}/api/market/premium-active?targetWinrate=0.8&minCoverage=0.12&minTrades=8&minValidationTrades=6`,
      { cache: 'no-store' }
    )
    if (!r.ok) return { props: { data: null, error: `HTTP ${r.status}` } }

    const data = (await r.json()) as PremiumActiveResponse
    return { props: { data, error: null } }
  } catch (e: any) {
    return { props: { data: null, error: e?.message || 'Failed to fetch' } }
  }
}
