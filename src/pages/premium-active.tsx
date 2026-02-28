import Head from 'next/head'
import type { GetServerSideProps } from 'next'
import Link from 'next/link'
import type { HCMarketKey } from '@/lib/highConfidence'
import { HC_MARKET_META } from '@/lib/highConfidence'
import { qualifyActiveSignals, type QualifiedSignalMetrics } from '@/lib/qualifiedActive'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '') || ''

type StockMarketKey = Exclude<HCMarketKey, 'CRYPTO'>

type StockPick = {
  market: StockMarketKey
  symbol: string
  name: string
  href: string
  status: 'BUY' | 'SELL'
  score: number
  strength: number
  currentReturnPct: number | null
  valueOf100Now: number | null
  daysSinceSignal: number | null
  d7Signal: number | null
  d30Signal: number | null
  mfeSignal: number | null
  maeSignal: number | null
  quality: QualifiedSignalMetrics | null
}

type Props = {
  error: string | null
  generatedAt: string
  thresholdScore: 70 | 80
  picks: StockPick[]
}

type PastPerformanceRow = {
  symbol?: string
  name?: string
  current?: {
    date?: string
    status?: 'BUY' | 'HOLD' | 'SELL'
    score?: number
    close?: number
  } | null
  lastSignal?: {
    date?: string
    status?: 'BUY' | 'SELL'
    score?: number
    close?: number
  } | null
  perf?: {
    d7Signal?: number | null
    d30Signal?: number | null
  } | null
  nextSignal?: {
    signalReturnPct?: number | null
    daysFromSignal?: number | null
  } | null
  untilNext?: {
    mfeSignal?: number | null
    maeSignal?: number | null
  } | null
}

const STOCK_MARKETS: Array<{ key: StockMarketKey; slug: string }> = [
  { key: 'AEX', slug: 'aex' },
  { key: 'DAX', slug: 'dax' },
  { key: 'DOWJONES', slug: 'dowjones' },
  { key: 'ETFS', slug: 'etfs' },
  { key: 'FTSE100', slug: 'ftse100' },
  { key: 'HANGSENG', slug: 'hangseng' },
  { key: 'NASDAQ', slug: 'nasdaq' },
  { key: 'NIKKEI225', slug: 'nikkei225' },
  { key: 'SENSEX', slug: 'sensex' },
  { key: 'SP500', slug: 'sp500' },
]

const DETAIL_BASE: Record<StockMarketKey, string> = {
  AEX: '/stocks',
  DAX: '/dax',
  DOWJONES: '/dowjones',
  ETFS: '/etfs',
  FTSE100: '/ftse100',
  HANGSENG: '/hangseng',
  NASDAQ: '/nasdaq',
  NIKKEI225: '/nikkei225',
  SENSEX: '/sensex',
  SP500: '/sp500',
}

const FRESH_SIGNAL_MAX_DAYS = 10

function parseThreshold(raw: string | string[] | undefined): 70 | 80 {
  const value = Array.isArray(raw) ? raw[0] : raw
  return value === '70' ? 70 : 80
}

function detailHref(market: StockMarketKey, symbol: string) {
  return `${DETAIL_BASE[market]}/${encodeURIComponent(symbol)}`
}

function formatPct(v: number | null | undefined, digits = 2) {
  if (!Number.isFinite(v as number)) return '-'
  const n = Number(v)
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`
}

function formatEuro(v: number | null | undefined) {
  if (!Number.isFinite(v as number)) return '-'
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(v))
}

function bestOf(a: StockPick, b: StockPick) {
  if (b.strength !== a.strength) return b.strength > a.strength ? b : a
  const aRet = Number.isFinite(a.currentReturnPct as number) ? Number(a.currentReturnPct) : -999999
  const bRet = Number.isFinite(b.currentReturnPct as number) ? Number(b.currentReturnPct) : -999999
  if (bRet !== aRet) return bRet > aRet ? b : a
  return a
}

function isFreshSignal(item: StockPick) {
  return item.daysSinceSignal == null || item.daysSinceSignal <= FRESH_SIGNAL_MAX_DAYS
}

function sortFreshFirst(a: StockPick, b: StockPick) {
  const aDays = a.daysSinceSignal ?? 0
  const bDays = b.daysSinceSignal ?? 0
  if (aDays !== bDays) return aDays - bDays
  if (b.strength !== a.strength) return b.strength - a.strength

  const aRet = Number.isFinite(a.currentReturnPct as number) ? Number(a.currentReturnPct) : 999999
  const bRet = Number.isFinite(b.currentReturnPct as number) ? Number(b.currentReturnPct) : 999999
  if (aRet !== bRet) return aRet - bRet

  return a.symbol.localeCompare(b.symbol)
}

function buildPick(market: StockMarketKey, row: PastPerformanceRow, thresholdScore: 70 | 80): StockPick | null {
  const symbol = String(row?.symbol || '').trim()
  const name = String(row?.name || symbol).trim()
  const current = row?.current
  const lastSignal = row?.lastSignal
  const nextSignal = row?.nextSignal

  if (!symbol || !current || (current.status !== 'BUY' && current.status !== 'SELL')) return null

  const rawScore = Number(current.score)
  if (!Number.isFinite(rawScore)) return null

  const status = current.status
  const score = Math.round(rawScore)
  const strength = Math.round(status === 'BUY' ? rawScore : (100 - rawScore))
  if (!Number.isFinite(strength) || strength < thresholdScore) return null

  const currentReturnPct =
    lastSignal?.status === status && Number.isFinite(nextSignal?.signalReturnPct as number)
      ? Number(nextSignal?.signalReturnPct)
      : null

  const daysSinceSignal = Number.isFinite(nextSignal?.daysFromSignal as number) ? Number(nextSignal?.daysFromSignal) : null

  return {
    market,
    symbol,
    name,
    href: detailHref(market, symbol),
    status,
    score,
    strength,
    currentReturnPct,
    valueOf100Now: Number.isFinite(currentReturnPct as number) ? 100 * (1 + Number(currentReturnPct) / 100) : null,
    daysSinceSignal,
    d7Signal: Number.isFinite(row?.perf?.d7Signal as number) ? Number(row?.perf?.d7Signal) : null,
    d30Signal: Number.isFinite(row?.perf?.d30Signal as number) ? Number(row?.perf?.d30Signal) : null,
    mfeSignal: Number.isFinite(row?.untilNext?.mfeSignal as number) ? Number(row?.untilNext?.mfeSignal) : null,
    maeSignal: Number.isFinite(row?.untilNext?.maeSignal as number) ? Number(row?.untilNext?.maeSignal) : null,
    quality: null,
  }
}

function PickCard({
  item,
  featured = false,
}: {
  item: StockPick
  featured?: boolean
}) {
  const isBuy = item.status === 'BUY'
  const positiveMove = !Number.isFinite(item.currentReturnPct as number) || Number(item.currentReturnPct) >= 0

  return (
    <Link
      href={item.href}
      className={`block rounded-3xl border p-5 transition ${
        featured
          ? isBuy
            ? 'border-emerald-400/45 bg-gradient-to-br from-emerald-50 via-white to-cyan-50 shadow-[0_18px_50px_-30px_rgba(16,185,129,0.45)] dark:border-emerald-500/30 dark:from-emerald-950/20 dark:via-slate-950 dark:to-cyan-950/10'
            : 'border-rose-400/45 bg-gradient-to-br from-rose-50 via-white to-orange-50 shadow-[0_18px_50px_-30px_rgba(244,63,94,0.4)] dark:border-rose-500/30 dark:from-rose-950/20 dark:via-slate-950 dark:to-orange-950/10'
          : 'border-slate-300/45 bg-white/80 hover:bg-white dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold text-slate-900 dark:text-white">{item.symbol}</span>
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold text-white ${isBuy ? 'bg-emerald-600' : 'bg-rose-600'}`}>
              {isBuy ? 'KOOP' : 'SHORT'}
            </span>
            <span
              className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                isBuy
                  ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200'
                  : 'border border-rose-500/30 bg-rose-500/10 text-rose-900 dark:text-rose-200'
              }`}
            >
              Sterkte {item.strength}
            </span>
            {item.quality ? (
              <span className="rounded-full border border-slate-400/35 bg-slate-100/80 px-2.5 py-1 text-[10px] font-semibold text-slate-900 dark:border-white/15 dark:bg-white/10 dark:text-white/80">
                Kwaliteit {item.quality.qualityScore}
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-sm text-slate-800 dark:text-white/85">{item.name}</div>
          <div className="mt-1 text-[11px] text-slate-700/75 dark:text-white/60">{HC_MARKET_META[item.market].label}</div>
        </div>

        <div className="rounded-2xl border border-white/40 bg-white/70 px-3 py-2 text-right dark:border-white/10 dark:bg-white/10">
          <div className="text-[10px] font-medium text-slate-600 dark:text-white/55">€100 sinds start</div>
          <div className="text-base font-semibold text-slate-900 dark:text-white">{formatEuro(item.valueOf100Now)}</div>
          <div className={`text-[11px] ${positiveMove ? 'text-emerald-800 dark:text-emerald-200' : 'text-rose-800 dark:text-rose-200'}`}>
            {formatPct(item.currentReturnPct)}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-300/45 bg-white/70 px-3 py-2 dark:border-white/10 dark:bg-white/5">
          <div className="text-[10px] font-medium text-slate-600 dark:text-white/55">Huidige status</div>
          <div className={`mt-1 text-sm font-semibold ${isBuy ? 'text-emerald-900 dark:text-emerald-200' : 'text-rose-900 dark:text-rose-200'}`}>
            {isBuy ? 'Nu kopen of vasthouden' : 'Nu shorten of vasthouden'}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-300/45 bg-white/70 px-3 py-2 dark:border-white/10 dark:bg-white/5">
          <div className="text-[10px] font-medium text-slate-600 dark:text-white/55">Signaal loopt</div>
          <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
            {item.daysSinceSignal != null ? `${item.daysSinceSignal} dagen` : 'Vers signaal'}
          </div>
        </div>
      </div>
    </Link>
  )
}

export default function PremiumActivePage({ error, generatedAt, thresholdScore, picks }: Props) {
  const buyPicks = picks.filter((item) => item.status === 'BUY')
  const sellPicks = picks.filter((item) => item.status === 'SELL')

  const freshBuys = buyPicks.filter(isFreshSignal).sort(sortFreshFirst)
  const freshSells = sellPicks.filter(isFreshSignal).sort(sortFreshFirst)
  const olderBuys = buyPicks.filter((item) => !isFreshSignal(item))
  const olderSells = sellPicks.filter((item) => !isFreshSignal(item))
  const featuredBuys = freshBuys.slice(0, 5)
  const featuredSells = freshSells.slice(0, 5)

  return (
    <>
      <Head>
        <title>Top Aandelen Signalen | SignalHub</title>
        <meta
          name="description"
          content="Alleen losse aandelen. Geen marktfilter. Deze pagina toont live BUY- en SELL-signalen voor individuele aandelen met een minimale signaalsterkte van 70 of 80."
        />
      </Head>

      <main className="max-w-screen-xl mx-auto px-4 pt-10 pb-16 space-y-6">
        <section className="rounded-3xl border border-emerald-300/45 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.18),transparent_42%),linear-gradient(135deg,rgba(255,255,255,0.95),rgba(240,253,250,0.92),rgba(236,253,245,0.95))] p-6 shadow-[0_20px_60px_-28px_rgba(16,185,129,0.35)] dark:border-emerald-500/25 dark:bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.18),transparent_38%),linear-gradient(135deg,rgba(2,6,23,0.98),rgba(3,15,12,0.96),rgba(2,6,23,0.98))]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="max-w-3xl">
              <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">Top Aandelen Signalen</h1>
              <p className="mt-2 text-sm text-slate-800/85 dark:text-white/70">
                Alleen losse aandelen die nu echt door de strengere kwaliteitsfilter komen. Naast sterkte {thresholdScore}+ filteren we nu ook op
                trendkwaliteit, follow-through, peer-rang en te late instappen.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link
                href="/high-confidence"
                className="rounded-full border border-slate-400/35 bg-white/70 px-4 py-2 text-[12px] font-medium text-slate-800 hover:bg-white dark:border-white/20 dark:bg-white/10 dark:text-white"
              >
                Open gratis signalen
              </Link>
              <Link
                href="/"
                className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-4 py-2 text-[12px] font-medium text-emerald-900 hover:bg-emerald-500/20 dark:text-emerald-200"
              >
                Terug naar home
              </Link>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-white/45 bg-white/75 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="text-[11px] font-medium text-slate-600 dark:text-white/55">Nu long</div>
              <div className="mt-1 text-3xl font-semibold text-emerald-900 dark:text-emerald-200">{buyPicks.length}</div>
              <div className="mt-1 text-[12px] text-slate-700/80 dark:text-white/60">Gekwalificeerde BUY-signalen</div>
            </div>

            <div className="rounded-2xl border border-white/45 bg-white/75 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="text-[11px] font-medium text-slate-600 dark:text-white/55">Nu short</div>
              <div className="mt-1 text-3xl font-semibold text-rose-900 dark:text-rose-200">{sellPicks.length}</div>
              <div className="mt-1 text-[12px] text-slate-700/80 dark:text-white/60">Gekwalificeerde SELL-signalen</div>
            </div>

            <div className="rounded-2xl border border-white/45 bg-white/75 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="text-[11px] font-medium text-slate-600 dark:text-white/55">Actieve drempel</div>
              <div className="mt-1 text-3xl font-semibold text-slate-900 dark:text-white">Sterkte {thresholdScore}+</div>
              <div className="mt-1 text-[12px] text-slate-700/80 dark:text-white/60">Update {generatedAt}</div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {([70, 80] as const).map((value) => {
              const isActive = value === thresholdScore
              return (
                <Link
                  key={value}
                  href={value === 80 ? '/premium-active' : `/premium-active?threshold=${value}`}
                  className={`rounded-2xl border px-4 py-3 text-left transition ${
                    isActive
                      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-950 dark:text-emerald-200'
                      : 'border-slate-400/35 bg-white/70 text-slate-800 hover:bg-white dark:border-white/20 dark:bg-white/10 dark:text-white'
                  }`}
                >
                  <div className="text-[12px] font-semibold">Sterkte {value}+</div>
                  <div className="text-[11px] opacity-80">{value === 80 ? 'Strikter en selectiever' : 'Meer signalen zichtbaar'}</div>
                </Link>
              )
            })}
          </div>
        </section>

        {error && (
          <section className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
            Fout bij laden van deze aandelenlijst: {error}
          </section>
        )}

        <section className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-300/45 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="text-[11px] font-medium text-slate-600 dark:text-white/55">Regel 1</div>
            <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">Volg alleen deze gekwalificeerde lijst</div>
            <div className="mt-1 text-[12px] text-slate-700/80 dark:text-white/60">
              Alles dat te zwak, te laat of te ver opgelopen is, tonen we hier niet meer.
            </div>
          </div>

            <div className="rounded-2xl border border-slate-300/45 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="text-[11px] font-medium text-slate-600 dark:text-white/55">Regel 2</div>
            <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">Blijft hij staan?</div>
            <div className="mt-1 text-[12px] text-slate-700/80 dark:text-white/60">Dan houd je de positie vast zolang het signaal in deze lijst blijft staan.</div>
          </div>

            <div className="rounded-2xl border border-slate-300/45 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="text-[11px] font-medium text-slate-600 dark:text-white/55">Regel 3</div>
            <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">Verdwijnt hij?</div>
            <div className="mt-1 text-[12px] text-slate-700/80 dark:text-white/60">Dan sluit je de trade. De oude en minder sterke setups filteren we automatisch weg.</div>
          </div>
        </section>

        <section className="rounded-3xl border border-emerald-400/35 bg-white/85 p-5 dark:border-emerald-500/25 dark:bg-white/5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-emerald-900 dark:text-emerald-200">Top 5 verse koopkansen</h2>
              <p className="text-sm text-slate-700/80 dark:text-white/65">
                Dit zijn de beste nieuwe of nog jonge BUY-signalen na de extra kwaliteitsfilter.
              </p>
            </div>
            <div className="rounded-2xl bg-emerald-500/15 px-4 py-2 text-center text-emerald-900 dark:text-emerald-200">
              <div className="text-[10px] uppercase tracking-[0.12em] opacity-75">Nu live</div>
              <div className="text-2xl font-semibold">{featuredBuys.length}</div>
            </div>
          </div>

          {featuredBuys.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300/60 bg-white/60 px-4 py-6 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white/65">
              Er zijn op dit moment geen verse losse aandelen met een BUY-signaal boven deze score.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {featuredBuys.map((item) => (
                <PickCard key={`featured-${item.symbol}-${item.name}`} item={item} featured />
              ))}
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-rose-400/35 bg-white/85 p-5 dark:border-rose-500/25 dark:bg-white/5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-rose-900 dark:text-rose-200">Top 5 verse shortkansen</h2>
              <p className="text-sm text-slate-700/80 dark:text-white/65">
                Dit zijn de beste nieuwe of nog jonge SELL-signalen na de extra kwaliteitsfilter.
              </p>
            </div>
            <div className="rounded-2xl bg-rose-500/15 px-4 py-2 text-center text-rose-900 dark:text-rose-200">
              <div className="text-[10px] uppercase tracking-[0.12em] opacity-75">Nu live</div>
              <div className="text-2xl font-semibold">{featuredSells.length}</div>
            </div>
          </div>

          {featuredSells.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300/60 bg-white/60 px-4 py-6 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white/65">
              Er zijn op dit moment geen verse losse aandelen met een SELL-signaal boven deze sterkte.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {featuredSells.map((item) => (
                <PickCard key={`featured-${item.symbol}-${item.name}-${item.status}`} item={item} featured />
              ))}
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-slate-300/45 bg-white/85 p-5 dark:border-white/10 dark:bg-white/5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Alle actieve BUY-signalen</h2>
              <p className="text-sm text-slate-700/80 dark:text-white/65">
                Dit zijn alle losse aandelen met live BUY die nu nog door de strengere kwaliteitsfilter komen.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-300/45 bg-white/70 px-4 py-2 text-center text-slate-900 dark:border-white/10 dark:bg-white/10 dark:text-white">
              <div className="text-[10px] uppercase tracking-[0.12em] opacity-75">Totaal</div>
              <div className="text-2xl font-semibold">{buyPicks.length}</div>
            </div>
          </div>

          {buyPicks.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300/60 bg-white/60 px-4 py-6 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white/65">
              Er zijn op dit moment geen losse aandelen met een BUY-signaal die door deze strengere filter komen.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {buyPicks.map((item) => (
                <PickCard key={`pick-${item.symbol}-${item.name}`} item={item} />
              ))}
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-slate-300/45 bg-white/85 p-5 dark:border-white/10 dark:bg-white/5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Alle actieve SELL-signalen</h2>
              <p className="text-sm text-slate-700/80 dark:text-white/65">
                Dit zijn alle losse aandelen met live SELL die nu nog door de strengere kwaliteitsfilter komen.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-300/45 bg-white/70 px-4 py-2 text-center text-slate-900 dark:border-white/10 dark:bg-white/10 dark:text-white">
              <div className="text-[10px] uppercase tracking-[0.12em] opacity-75">Totaal</div>
              <div className="text-2xl font-semibold">{sellPicks.length}</div>
            </div>
          </div>

          {sellPicks.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300/60 bg-white/60 px-4 py-6 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white/65">
              Er zijn op dit moment geen losse aandelen met een SELL-signaal die door deze strengere filter komen.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {sellPicks.map((item) => (
                <PickCard key={`pick-${item.symbol}-${item.name}-${item.status}`} item={item} />
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-300/45 bg-white/80 p-4 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white/65">
          <span className="font-medium text-slate-900 dark:text-white">{olderBuys.length}</span> BUY-signalen en{' '}
          <span className="font-medium text-slate-900 dark:text-white">{olderSells.length}</span> SELL-signalen zijn nog actief, maar te oud voor
          de bovenste instaplijsten. Als hetzelfde aandeel in meerdere indexen voorkomt, tonen we hem maar een keer.
        </section>
      </main>
    </>
  )
}

export const getServerSideProps: GetServerSideProps<Props> = async (context) => {
  const thresholdScore = parseThreshold(context.query.threshold)

  try {
    const base =
      process.env.NODE_ENV === 'development'
        ? 'http://localhost:3000'
        : (BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'))

    const results = await Promise.all(
      STOCK_MARKETS.map(async (market) => {
        const r = await fetch(`${base}/api/past-performance/${market.slug}`, { cache: 'no-store' })
        if (!r.ok) return { market: market.key, rows: [] as PastPerformanceRow[] }
        const data = await r.json()
        return {
          market: market.key,
          rows: Array.isArray(data?.rows) ? (data.rows as PastPerformanceRow[]) : [],
        }
      })
    )

    const deduped = new Map<string, StockPick>()

    for (const result of results) {
      for (const row of result.rows) {
        const pick = buildPick(result.market, row, thresholdScore)
        if (!pick) continue

        const dedupeKey = `${pick.symbol}::${pick.name}::${pick.status}`
        const existing = deduped.get(dedupeKey)
        deduped.set(dedupeKey, existing ? bestOf(existing, pick) : pick)
      }
    }

    const picks = qualifyActiveSignals([...deduped.values()], thresholdScore).filter((item) => item.quality.qualifies)

    return {
      props: {
        error: null,
        generatedAt: new Date().toLocaleString('nl-NL'),
        thresholdScore,
        picks,
      },
    }
  } catch (e: any) {
    return {
      props: {
        error: e?.message || 'Failed to fetch',
        generatedAt: new Date().toLocaleString('nl-NL'),
        thresholdScore,
        picks: [],
      },
    }
  }
}
