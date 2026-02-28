import Head from 'next/head'
import type { GetServerSideProps } from 'next'
import Link from 'next/link'
import type { HCMarketKey } from '@/lib/highConfidence'
import { HC_MARKET_META } from '@/lib/highConfidence'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '') || ''

type StockMarketKey = Exclude<HCMarketKey, 'CRYPTO'>

type StockPick = {
  market: StockMarketKey
  symbol: string
  name: string
  href: string
  score: number
  currentReturnPct: number | null
  valueOf100Now: number | null
  daysSinceSignal: number | null
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
    status?: string
    score?: number
  } | null
  lastSignal?: {
    status?: string
  } | null
  nextSignal?: {
    signalReturnPct?: number | null
    daysFromSignal?: number | null
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
  if (b.score !== a.score) return b.score > a.score ? b : a
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
  if (b.score !== a.score) return b.score - a.score

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

  if (!symbol || !current || current.status !== 'BUY') return null

  const score = Math.round(Number(current.score))
  if (!Number.isFinite(score) || score < thresholdScore) return null

  const currentReturnPct =
    lastSignal?.status === 'BUY' && current.status === 'BUY' && Number.isFinite(nextSignal?.signalReturnPct as number)
      ? Number(nextSignal?.signalReturnPct)
      : null

  const daysSinceSignal = Number.isFinite(nextSignal?.daysFromSignal as number) ? Number(nextSignal?.daysFromSignal) : null

  return {
    market,
    symbol,
    name,
    href: detailHref(market, symbol),
    score,
    currentReturnPct,
    valueOf100Now: Number.isFinite(currentReturnPct as number) ? 100 * (1 + Number(currentReturnPct) / 100) : null,
    daysSinceSignal,
  }
}

function PickCard({
  item,
  featured = false,
}: {
  item: StockPick
  featured?: boolean
}) {
  return (
    <Link
      href={item.href}
      className={`block rounded-3xl border p-5 transition ${
        featured
          ? 'border-emerald-400/45 bg-gradient-to-br from-emerald-50 via-white to-cyan-50 shadow-[0_18px_50px_-30px_rgba(16,185,129,0.45)] dark:border-emerald-500/30 dark:from-emerald-950/20 dark:via-slate-950 dark:to-cyan-950/10'
          : 'border-slate-300/45 bg-white/80 hover:bg-white dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold text-slate-900 dark:text-white">{item.symbol}</span>
            <span className="rounded-full bg-emerald-600 px-2.5 py-1 text-[10px] font-semibold text-white">KOOP</span>
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-900 dark:text-emerald-200">
              Score {item.score}
            </span>
          </div>
          <div className="mt-1 text-sm text-slate-800 dark:text-white/85">{item.name}</div>
          <div className="mt-1 text-[11px] text-slate-700/75 dark:text-white/60">{HC_MARKET_META[item.market].label}</div>
        </div>

        <div className="rounded-2xl border border-white/40 bg-white/70 px-3 py-2 text-right dark:border-white/10 dark:bg-white/10">
          <div className="text-[10px] font-medium text-slate-600 dark:text-white/55">€100 sinds start</div>
          <div className="text-base font-semibold text-slate-900 dark:text-white">{formatEuro(item.valueOf100Now)}</div>
          <div className="text-[11px] text-emerald-800 dark:text-emerald-200">{formatPct(item.currentReturnPct)}</div>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-300/45 bg-white/70 px-3 py-2 dark:border-white/10 dark:bg-white/5">
          <div className="text-[10px] font-medium text-slate-600 dark:text-white/55">Huidige status</div>
          <div className="mt-1 text-sm font-semibold text-emerald-900 dark:text-emerald-200">Nu kopen of vasthouden</div>
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
  const freshPicks = picks.filter(isFreshSignal).sort(sortFreshFirst)
  const olderPicks = picks.filter((item) => !isFreshSignal(item))
  const featured = freshPicks.slice(0, 5)
  const fresh = freshPicks.length

  return (
    <>
      <Head>
        <title>Top Aandelen Kopen | SignalHub</title>
        <meta
          name="description"
          content="Alleen losse aandelen. Geen marktfilter. Deze pagina toont alleen aandelen met een live BUY-signaal en een minimale score van 70 of 80."
        />
      </Head>

      <main className="max-w-screen-xl mx-auto px-4 pt-10 pb-16 space-y-6">
        <section className="rounded-3xl border border-emerald-300/45 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.18),transparent_42%),linear-gradient(135deg,rgba(255,255,255,0.95),rgba(240,253,250,0.92),rgba(236,253,245,0.95))] p-6 shadow-[0_20px_60px_-28px_rgba(16,185,129,0.35)] dark:border-emerald-500/25 dark:bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.18),transparent_38%),linear-gradient(135deg,rgba(2,6,23,0.98),rgba(3,15,12,0.96),rgba(2,6,23,0.98))]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="max-w-3xl">
              <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">Top Aandelen Kopen</h1>
              <p className="mt-2 text-sm text-slate-800/85 dark:text-white/70">
                Dit is nu precies een losse aandelenlijst. Geen marktfilter. Alleen aandelen die op dit moment een BUY-signaal hebben en een
                individuele score van minimaal {thresholdScore}. Bovenaan staan alleen verse instapkansen, niet oude trades die al lang lopen.
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
              <div className="text-[11px] font-medium text-slate-600 dark:text-white/55">Nu koopwaardig</div>
              <div className="mt-1 text-3xl font-semibold text-emerald-900 dark:text-emerald-200">{picks.length}</div>
              <div className="mt-1 text-[12px] text-slate-700/80 dark:text-white/60">Losse aandelen met live BUY</div>
            </div>

            <div className="rounded-2xl border border-white/45 bg-white/75 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="text-[11px] font-medium text-slate-600 dark:text-white/55">Verse kansen</div>
              <div className="mt-1 text-3xl font-semibold text-slate-900 dark:text-white">{fresh}</div>
              <div className="mt-1 text-[12px] text-slate-700/80 dark:text-white/60">Signaal loopt {FRESH_SIGNAL_MAX_DAYS} dagen of korter</div>
            </div>

            <div className="rounded-2xl border border-white/45 bg-white/75 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="text-[11px] font-medium text-slate-600 dark:text-white/55">Actieve drempel</div>
              <div className="mt-1 text-3xl font-semibold text-slate-900 dark:text-white">Score {thresholdScore}+</div>
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
                  <div className="text-[12px] font-semibold">Score {value}+</div>
                  <div className="text-[11px] opacity-80">{value === 80 ? 'Strikter en selectiever' : 'Meer aandelen zichtbaar'}</div>
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
            <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">Alleen deze lijst kopen</div>
            <div className="mt-1 text-[12px] text-slate-700/80 dark:text-white/60">
              Alles buiten deze lijst negeer je. Deze pagina is de enige kooplijst.
            </div>
          </div>

          <div className="rounded-2xl border border-slate-300/45 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
            <div className="text-[11px] font-medium text-slate-600 dark:text-white/55">Regel 2</div>
            <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">Blijft hij op BUY?</div>
            <div className="mt-1 text-[12px] text-slate-700/80 dark:text-white/60">Dan houd je hem vast zolang hij in deze kooplijst blijft staan.</div>
          </div>

          <div className="rounded-2xl border border-slate-300/45 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
            <div className="text-[11px] font-medium text-slate-600 dark:text-white/55">Regel 3</div>
            <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">Verdwijnt hij?</div>
            <div className="mt-1 text-[12px] text-slate-700/80 dark:text-white/60">Dan sluit je de trade. Zo simpel moet deze pagina zijn.</div>
          </div>
        </section>

        <section className="rounded-3xl border border-emerald-400/35 bg-white/85 p-5 dark:border-emerald-500/25 dark:bg-white/5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-emerald-900 dark:text-emerald-200">Top 5 verse koopkansen</h2>
              <p className="text-sm text-slate-700/80 dark:text-white/65">
                Alleen nieuwe of nog jonge BUY-signalen. Alles dat al langer dan {FRESH_SIGNAL_MAX_DAYS} dagen open staat komt hier niet meer in.
              </p>
            </div>
            <div className="rounded-2xl bg-emerald-500/15 px-4 py-2 text-center text-emerald-900 dark:text-emerald-200">
              <div className="text-[10px] uppercase tracking-[0.12em] opacity-75">Nu live</div>
              <div className="text-2xl font-semibold">{featured.length}</div>
            </div>
          </div>

          {featured.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300/60 bg-white/60 px-4 py-6 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white/65">
              Er zijn op dit moment geen verse losse aandelen met een BUY-signaal boven deze score.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {featured.map((item) => (
                <PickCard key={`featured-${item.symbol}-${item.name}`} item={item} featured />
              ))}
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-slate-300/45 bg-white/85 p-5 dark:border-white/10 dark:bg-white/5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Alle actieve BUY-signalen</h2>
              <p className="text-sm text-slate-700/80 dark:text-white/65">
                Dit is de volledige losse aandelenlijst met live BUY en een huidige score van minimaal {thresholdScore}. Hieronder staan dus ook
                signalen die al langer lopen.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-300/45 bg-white/70 px-4 py-2 text-center text-slate-900 dark:border-white/10 dark:bg-white/10 dark:text-white">
              <div className="text-[10px] uppercase tracking-[0.12em] opacity-75">Totaal</div>
              <div className="text-2xl font-semibold">{picks.length}</div>
            </div>
          </div>

          {picks.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300/60 bg-white/60 px-4 py-6 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white/65">
              Er zijn op dit moment geen losse aandelen die aan deze score-eis voldoen.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {picks.map((item) => (
                <PickCard key={`pick-${item.symbol}-${item.name}`} item={item} />
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-300/45 bg-white/80 p-4 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white/65">
          <span className="font-medium text-slate-900 dark:text-white">{olderPicks.length}</span> signalen lopen al langer dan {FRESH_SIGNAL_MAX_DAYS}{' '}
          dagen en staan daarom niet in de bovenste instaplijst. Als hetzelfde aandeel in meerdere indexen voorkomt, tonen we hem maar één keer.
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

        const dedupeKey = `${pick.symbol}::${pick.name}`
        const existing = deduped.get(dedupeKey)
        deduped.set(dedupeKey, existing ? bestOf(existing, pick) : pick)
      }
    }

    const picks = [...deduped.values()].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score

      const aRet = Number.isFinite(a.currentReturnPct as number) ? Number(a.currentReturnPct) : -999999
      const bRet = Number.isFinite(b.currentReturnPct as number) ? Number(b.currentReturnPct) : -999999
      if (bRet !== aRet) return bRet - aRet

      return a.symbol.localeCompare(b.symbol)
    })

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
