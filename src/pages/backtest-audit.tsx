import Head from 'next/head'
import type { GetServerSideProps } from 'next'
import Link from 'next/link'

type StrategyStats = {
  key: string
  label: string
  closedTrades: number
  wins: number
  losses: number
  winrate: number | null
  avgReturnPct: number | null
  medianReturnPct: number | null
  avgDaysHeld: number | null
  flatProfitOn100Each: number | null
  compoundedValueOf100: number | null
  maxDrawdownPct: number | null
  openPositions: number
  topAssets: Array<{
    symbol: string
    name: string
    closedTrades: number
    winrate: number | null
    avgReturnPct: number | null
    compoundedValueOf100: number | null
  }>
}

type Props = {
  market: string
  payload: {
    error?: string
    meta?: {
      market: string
      label: string
      computedAt: number
      lookback: string
      window: string
      universeSize: number
      processedAssets: number
      skippedAssets: number
      stale?: boolean
      note: string
    }
    strategies?: StrategyStats[]
  } | null
}

const MARKET_OPTIONS = [
  ['crypto', 'Crypto'],
  ['aex', 'AEX'],
  ['sp500', 'S&P 500'],
  ['nasdaq', 'NASDAQ'],
  ['ftse100', 'FTSE 100'],
  ['dowjones', 'Dow Jones'],
  ['etfs', 'ETFs'],
  ['dax', 'DAX'],
  ['hangseng', 'Hang Seng'],
  ['nikkei225', 'Nikkei 225'],
  ['sensex', 'Sensex'],
] as const

function fmtPct(v: number | null | undefined, digits = 1) {
  if (!Number.isFinite(v as number)) return '-'
  const n = Number(v)
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`
}

function fmtValue(v: number | null | undefined) {
  if (!Number.isFinite(v as number)) return '-'
  return `€${Number(v).toFixed(2)}`
}

function StrategyCard({ strategy }: { strategy: StrategyStats }) {
  return (
    <section className="rounded-3xl border border-slate-300/45 bg-white/85 p-5 dark:border-white/10 dark:bg-white/5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white">{strategy.label}</h2>
          <p className="mt-1 text-sm text-slate-700/80 dark:text-white/60">
            {strategy.closedTrades} gesloten trades, {strategy.openPositions} nog open
          </p>
        </div>
        <div className="rounded-2xl border border-slate-300/45 bg-white/75 px-4 py-3 text-right dark:border-white/10 dark:bg-white/10">
          <div className="text-[11px] font-medium text-slate-600 dark:text-white/55">Winrate</div>
          <div className="text-2xl font-semibold text-slate-900 dark:text-white">{fmtPct(strategy.winrate != null ? strategy.winrate * 100 : null)}</div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-300/45 bg-white/70 p-3 dark:border-white/10 dark:bg-white/5">
          <div className="text-[11px] text-slate-600 dark:text-white/55">Gem. trade</div>
          <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{fmtPct(strategy.avgReturnPct)}</div>
        </div>
        <div className="rounded-2xl border border-slate-300/45 bg-white/70 p-3 dark:border-white/10 dark:bg-white/5">
          <div className="text-[11px] text-slate-600 dark:text-white/55">€100 samengesteld</div>
          <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{fmtValue(strategy.compoundedValueOf100)}</div>
        </div>
        <div className="rounded-2xl border border-slate-300/45 bg-white/70 p-3 dark:border-white/10 dark:bg-white/5">
          <div className="text-[11px] text-slate-600 dark:text-white/55">Flat winst op €100 per trade</div>
          <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{fmtPct(strategy.flatProfitOn100Each)}</div>
        </div>
        <div className="rounded-2xl border border-slate-300/45 bg-white/70 p-3 dark:border-white/10 dark:bg-white/5">
          <div className="text-[11px] text-slate-600 dark:text-white/55">Max drawdown</div>
          <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{fmtPct(strategy.maxDrawdownPct)}</div>
        </div>
      </div>

      {strategy.topAssets.length > 0 ? (
        <div className="mt-4">
          <div className="text-sm font-semibold text-slate-900 dark:text-white">Sterkste assets in deze test</div>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {strategy.topAssets.map((item) => (
              <div key={`${strategy.key}-${item.symbol}`} className="rounded-2xl border border-slate-300/45 bg-white/70 p-3 dark:border-white/10 dark:bg-white/5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-white">{item.symbol}</div>
                    <div className="text-xs text-slate-700/70 dark:text-white/55">{item.name}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-600 dark:text-white/55">{item.closedTrades} trades</div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">{fmtPct(item.avgReturnPct)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}

export default function BacktestAuditPage({ market, payload }: Props) {
  const meta = payload?.meta
  const strategies = payload?.strategies || []

  return (
    <>
      <Head>
        <title>Backtest Audit | SignalHub</title>
        <meta
          name="description"
          content="Echte event-level backtest van de SignalHub score-engine en strikte instapfilters, per markt."
        />
      </Head>

      <main className="max-w-screen-xl mx-auto px-4 pt-10 pb-16 space-y-6">
        <section className="rounded-3xl border border-slate-300/45 bg-white/90 p-6 dark:border-white/10 dark:bg-white/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="max-w-3xl">
              <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">Backtest Audit</h1>
              <p className="mt-2 text-sm text-slate-800/85 dark:text-white/70">
                Dit rapport test de echte score-engine dag voor dag. De live premium rankingfilter gebruiken we hier niet als bewijs,
                omdat die deels forward-looking data gebruikt.
              </p>
            </div>
            <Link
              href="/premium-active"
              className="rounded-full border border-slate-400/35 bg-white/75 px-4 py-2 text-[12px] font-medium text-slate-800 hover:bg-white dark:border-white/20 dark:bg-white/10 dark:text-white"
            >
              Terug naar signalen
            </Link>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {MARKET_OPTIONS.map(([value, label]) => {
              const active = value === market
              return (
                <Link
                  key={value}
                  href={value === 'crypto' ? '/backtest-audit' : `/backtest-audit?market=${value}`}
                  className={`rounded-2xl border px-4 py-3 text-left transition ${
                    active
                      ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-950 dark:text-cyan-200'
                      : 'border-slate-400/35 bg-white/75 text-slate-800 hover:bg-white dark:border-white/20 dark:bg-white/10 dark:text-white'
                  }`}
                >
                  <div className="text-[12px] font-semibold">{label}</div>
                </Link>
              )
            })}
          </div>
        </section>

        {payload?.error ? (
          <section className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
            Backtest laden mislukte: {payload.error}
          </section>
        ) : null}

        {meta ? (
          <section className="rounded-3xl border border-slate-300/45 bg-white/85 p-5 dark:border-white/10 dark:bg-white/5">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-slate-300/45 bg-white/70 p-4 dark:border-white/10 dark:bg-white/5">
                <div className="text-[11px] text-slate-600 dark:text-white/55">Markt</div>
                <div className="mt-1 text-xl font-semibold text-slate-900 dark:text-white">{meta.label}</div>
              </div>
              <div className="rounded-2xl border border-slate-300/45 bg-white/70 p-4 dark:border-white/10 dark:bg-white/5">
                <div className="text-[11px] text-slate-600 dark:text-white/55">Assets verwerkt</div>
                <div className="mt-1 text-xl font-semibold text-slate-900 dark:text-white">
                  {meta.processedAssets}/{meta.universeSize}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-300/45 bg-white/70 p-4 dark:border-white/10 dark:bg-white/5">
                <div className="text-[11px] text-slate-600 dark:text-white/55">Lookback</div>
                <div className="mt-1 text-xl font-semibold text-slate-900 dark:text-white">{meta.lookback}</div>
              </div>
              <div className="rounded-2xl border border-slate-300/45 bg-white/70 p-4 dark:border-white/10 dark:bg-white/5">
                <div className="text-[11px] text-slate-600 dark:text-white/55">Cache</div>
                <div className="mt-1 text-xl font-semibold text-slate-900 dark:text-white">{meta.stale ? 'Stale' : 'Fresh'}</div>
              </div>
            </div>
            <p className="mt-4 text-sm text-slate-700/80 dark:text-white/65">{meta.note}</p>
          </section>
        ) : null}

        {strategies.map((strategy) => (
          <StrategyCard key={strategy.key} strategy={strategy} />
        ))}
      </main>
    </>
  )
}

export const getServerSideProps: GetServerSideProps<Props> = async (context) => {
  const market = String(Array.isArray(context.query.market) ? context.query.market[0] : context.query.market || 'crypto').toLowerCase()
  const forwardedProto = context.req.headers['x-forwarded-proto']
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto || 'https'
  const reqHost = Array.isArray(context.req.headers.host) ? context.req.headers.host[0] : context.req.headers.host
  const base = reqHost ? `${proto}://${reqHost}` : 'http://localhost:3000'

  try {
    const r = await fetch(`${base}/api/backtest/market-audit?market=${encodeURIComponent(market)}`, { cache: 'no-store' })
    const payload = await r.json()
    return {
      props: {
        market,
        payload,
      },
    }
  } catch (e: any) {
    return {
      props: {
        market,
        payload: {
          error: e?.message || 'Failed to fetch',
        },
      },
    }
  }
}
