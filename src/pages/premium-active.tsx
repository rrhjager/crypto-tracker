import Head from 'next/head'
import type { GetServerSideProps } from 'next'
import Link from 'next/link'
import { HC_MARKET_META } from '@/lib/highConfidence'

type StockMarketKey = 'AEX' | 'DAX' | 'DOWJONES' | 'ETFS' | 'FTSE100' | 'HANGSENG' | 'NASDAQ' | 'NIKKEI225' | 'SENSEX' | 'SP500'

type StockPick = {
  market: StockMarketKey
  symbol: string
  name: string
  href: string
  status: 'BUY' | 'SELL'
  score: number
  strength: number
  strategyLabel: string
  validationWinrate: number
  validationAvgReturnPct: number
  trainingTrades: number
  validationTrades: number
}

type Props = {
  error: string | null
  generatedAt: string
  picks: StockPick[]
}

type AuditPick = {
  symbol?: string
  name?: string
  market?: string
  status?: 'BUY' | 'SELL'
  currentScore?: number
  strength?: number
  strategyLabel?: string
  validationWinrate?: number
  validationAvgReturnPct?: number
  trainingTrades?: number
  validationTrades?: number
}

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '') || ''

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

function detailHref(market: StockMarketKey, symbol: string) {
  return `${DETAIL_BASE[market]}/${encodeURIComponent(symbol)}`
}

function formatPct(v: number | null | undefined, digits = 1) {
  if (!Number.isFinite(v as number)) return '-'
  const n = Number(v)
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`
}

function pickScore(item: StockPick) {
  return (
    item.validationWinrate * 100 +
    item.validationAvgReturnPct * 8 +
    item.validationTrades * 1.5 +
    item.trainingTrades * 0.35 +
    item.strength * 0.12
  )
}

function sortByBest(a: StockPick, b: StockPick) {
  const diff = pickScore(b) - pickScore(a)
  if (Math.abs(diff) > 1e-9) return diff
  if (b.validationWinrate !== a.validationWinrate) return b.validationWinrate - a.validationWinrate
  if (b.validationAvgReturnPct !== a.validationAvgReturnPct) return b.validationAvgReturnPct - a.validationAvgReturnPct
  if (b.strength !== a.strength) return b.strength - a.strength
  return a.symbol.localeCompare(b.symbol)
}

function buildPick(market: StockMarketKey, raw: AuditPick): StockPick | null {
  const symbol = String(raw?.symbol || '').trim().toUpperCase()
  const name = String(raw?.name || symbol).trim()
  const status = raw?.status
  const score = Number(raw?.currentScore)
  const strength = Number(raw?.strength)
  const validationWinrate = Number(raw?.validationWinrate)
  const validationAvgReturnPct = Number(raw?.validationAvgReturnPct)
  const trainingTrades = Number(raw?.trainingTrades)
  const validationTrades = Number(raw?.validationTrades)

  if (!symbol || !name || (status !== 'BUY' && status !== 'SELL')) return null
  if (!Number.isFinite(score) || !Number.isFinite(strength)) return null
  if (!Number.isFinite(validationWinrate) || !Number.isFinite(validationAvgReturnPct)) return null
  if (!Number.isFinite(trainingTrades) || !Number.isFinite(validationTrades)) return null

  return {
    market,
    symbol,
    name,
    href: detailHref(market, symbol),
    status,
    score: Math.round(score),
    strength: Math.round(strength),
    strategyLabel: String(raw?.strategyLabel || '').trim() || 'Gevalideerde strategie',
    validationWinrate,
    validationAvgReturnPct,
    trainingTrades: Math.round(trainingTrades),
    validationTrades: Math.round(validationTrades),
  }
}

function bestOf(a: StockPick, b: StockPick) {
  return pickScore(b) > pickScore(a) ? b : a
}

function PickCard({ item, featured = false }: { item: StockPick; featured?: boolean }) {
  const isBuy = item.status === 'BUY'

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
          </div>
          <div className="mt-1 text-sm text-slate-800 dark:text-white/85">{item.name}</div>
          <div className="mt-1 text-[11px] text-slate-700/75 dark:text-white/60">{HC_MARKET_META[item.market].label}</div>
        </div>

        <div className="rounded-2xl border border-white/40 bg-white/70 px-3 py-2 text-right dark:border-white/10 dark:bg-white/10">
          <div className="text-[10px] font-medium text-slate-600 dark:text-white/55">Validatie winrate</div>
          <div className="text-base font-semibold text-slate-900 dark:text-white">{formatPct(item.validationWinrate * 100)}</div>
          <div className={`text-[11px] ${item.validationAvgReturnPct >= 0 ? 'text-emerald-800 dark:text-emerald-200' : 'text-rose-800 dark:text-rose-200'}`}>
            {formatPct(item.validationAvgReturnPct)} gem. per trade
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
          <div className="text-[10px] font-medium text-slate-600 dark:text-white/55">Train / test</div>
          <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
            {item.trainingTrades} / {item.validationTrades} trades
          </div>
        </div>
      </div>

      <div className="mt-3 text-[11px] text-slate-700/75 dark:text-white/55">{item.strategyLabel}</div>
    </Link>
  )
}

export default function PremiumActivePage({ error, generatedAt, picks }: Props) {
  const buyPicks = picks.filter((item) => item.status === 'BUY').sort(sortByBest)
  const sellPicks = picks.filter((item) => item.status === 'SELL').sort(sortByBest)
  const featuredBuys = buyPicks.slice(0, 5)
  const featuredSells = sellPicks.slice(0, 5)
  const hiddenBuys = Math.max(0, buyPicks.length - featuredBuys.length)
  const hiddenSells = Math.max(0, sellPicks.length - featuredSells.length)

  return (
    <>
      <Head>
        <title>Premium Aandelen Signalen | SignalHub</title>
        <meta
          name="description"
          content="Alleen audit-gevalideerde live aandelen-signalen. Deze pagina toont uitsluitend huidige BUY- en SELL-signalen die out-of-sample door de backtest zijn gekomen."
        />
        <meta httpEquiv="refresh" content="3600" />
      </Head>

      <main className="max-w-screen-xl mx-auto px-4 pt-10 pb-16 space-y-6">
        <section className="rounded-3xl border border-emerald-300/45 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.18),transparent_42%),linear-gradient(135deg,rgba(255,255,255,0.95),rgba(240,253,250,0.92),rgba(236,253,245,0.95))] p-6 shadow-[0_20px_60px_-28px_rgba(16,185,129,0.35)] dark:border-emerald-500/25 dark:bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.18),transparent_38%),linear-gradient(135deg,rgba(2,6,23,0.98),rgba(3,15,12,0.96),rgba(2,6,23,0.98))]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="max-w-3xl">
              <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">Premium Aandelen Signalen</h1>
              <p className="mt-2 text-sm text-slate-800/85 dark:text-white/70">
                Deze pagina toont alleen live aandelen-signalen die nu open staan én out-of-sample positief bleven in de audit-backtest.
                De ruwe scorepool zie je hier dus bewust niet meer.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link
                href="/backtest-audit"
                className="rounded-full border border-slate-400/35 bg-white/70 px-4 py-2 text-[12px] font-medium text-slate-800 hover:bg-white dark:border-white/20 dark:bg-white/10 dark:text-white"
              >
                Open audit
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
              <div className="text-[11px] font-medium text-slate-600 dark:text-white/55">Gevalideerde longs</div>
              <div className="mt-1 text-3xl font-semibold text-emerald-900 dark:text-emerald-200">{buyPicks.length}</div>
              <div className="mt-1 text-[12px] text-slate-700/80 dark:text-white/60">Live BUY-signalen die de audit halen</div>
            </div>

            <div className="rounded-2xl border border-white/45 bg-white/75 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="text-[11px] font-medium text-slate-600 dark:text-white/55">Gevalideerde shorts</div>
              <div className="mt-1 text-3xl font-semibold text-rose-900 dark:text-rose-200">{sellPicks.length}</div>
              <div className="mt-1 text-[12px] text-slate-700/80 dark:text-white/60">Live SELL-signalen die de audit halen</div>
            </div>

            <div className="rounded-2xl border border-white/45 bg-white/75 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="text-[11px] font-medium text-slate-600 dark:text-white/55">Databron</div>
              <div className="mt-1 text-3xl font-semibold text-slate-900 dark:text-white">Audit</div>
              <div className="mt-1 text-[12px] text-slate-700/80 dark:text-white/60">Update {generatedAt} · auto refresh elk uur</div>
            </div>
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
            <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">Bovenste blokken = beste nu</div>
            <div className="mt-1 text-[12px] text-slate-700/80 dark:text-white/60">
              Dit zijn de sterkste live signalen op validatie, samplegrootte en actuele sterkte.
            </div>
          </div>

          <div className="rounded-2xl border border-slate-300/45 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
            <div className="text-[11px] font-medium text-slate-600 dark:text-white/55">Regel 2</div>
            <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">Onderste lijsten = volledige audit-pool</div>
            <div className="mt-1 text-[12px] text-slate-700/80 dark:text-white/60">Hier staan alle live signalen die de backtest-audit nu halen.</div>
          </div>

          <div className="rounded-2xl border border-slate-300/45 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
            <div className="text-[11px] font-medium text-slate-600 dark:text-white/55">Regel 3</div>
            <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">Verdwijnt hij?</div>
            <div className="mt-1 text-[12px] text-slate-700/80 dark:text-white/60">Dan is hij niet langer audit-gekwalificeerd en sluit je de trade.</div>
          </div>
        </section>

        <section className="rounded-3xl border border-emerald-400/35 bg-white/85 p-5 dark:border-emerald-500/25 dark:bg-white/5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-emerald-900 dark:text-emerald-200">Aanbevolen Nu</h2>
              <p className="text-sm text-slate-700/80 dark:text-white/65">
                Dit zijn de aandelen die ik nu zou kopen op basis van de huidige audit-gevalideerde indicatoren. Deze lijst ververst automatisch.
              </p>
            </div>
            <div className="rounded-2xl bg-emerald-500/15 px-4 py-2 text-center text-emerald-900 dark:text-emerald-200">
              <div className="text-[10px] uppercase tracking-[0.12em] opacity-75">Nu live</div>
              <div className="text-2xl font-semibold">{featuredBuys.length}</div>
            </div>
          </div>

          {featuredBuys.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300/60 bg-white/60 px-4 py-6 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white/65">
              Er zijn op dit moment geen audit-gevalideerde BUY-signalen voor aandelen.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {featuredBuys.map((item) => (
                <PickCard key={`featured-${item.symbol}-${item.status}`} item={item} featured />
              ))}
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-rose-400/35 bg-white/85 p-5 dark:border-rose-500/25 dark:bg-white/5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-rose-900 dark:text-rose-200">Top 5 shortkansen</h2>
              <p className="text-sm text-slate-700/80 dark:text-white/65">
                Dit zijn de best gevalideerde live SELL-signalen van dit moment.
              </p>
            </div>
            <div className="rounded-2xl bg-rose-500/15 px-4 py-2 text-center text-rose-900 dark:text-rose-200">
              <div className="text-[10px] uppercase tracking-[0.12em] opacity-75">Nu live</div>
              <div className="text-2xl font-semibold">{featuredSells.length}</div>
            </div>
          </div>

          {featuredSells.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300/60 bg-white/60 px-4 py-6 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white/65">
              Er zijn op dit moment geen audit-gevalideerde SELL-signalen voor aandelen.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {featuredSells.map((item) => (
                <PickCard key={`featured-${item.symbol}-${item.status}`} item={item} featured />
              ))}
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-slate-300/45 bg-white/85 p-5 dark:border-white/10 dark:bg-white/5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Alle audit-gevalideerde BUY-signalen</h2>
              <p className="text-sm text-slate-700/80 dark:text-white/65">
                Dit is de volledige huidige BUY-lijst die door de audit-backtest is gekomen.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-300/45 bg-white/70 px-4 py-2 text-center text-slate-900 dark:border-white/10 dark:bg-white/10 dark:text-white">
              <div className="text-[10px] uppercase tracking-[0.12em] opacity-75">Totaal</div>
              <div className="text-2xl font-semibold">{buyPicks.length}</div>
            </div>
          </div>

          {buyPicks.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300/60 bg-white/60 px-4 py-6 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white/65">
              Er zijn op dit moment geen audit-gevalideerde BUY-signalen voor aandelen.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {buyPicks.map((item) => (
                <PickCard key={`buy-${item.symbol}-${item.status}`} item={item} />
              ))}
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-slate-300/45 bg-white/85 p-5 dark:border-white/10 dark:bg-white/5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Alle audit-gevalideerde SELL-signalen</h2>
              <p className="text-sm text-slate-700/80 dark:text-white/65">
                Dit is de volledige huidige SELL-lijst die door de audit-backtest is gekomen.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-300/45 bg-white/70 px-4 py-2 text-center text-slate-900 dark:border-white/10 dark:bg-white/10 dark:text-white">
              <div className="text-[10px] uppercase tracking-[0.12em] opacity-75">Totaal</div>
              <div className="text-2xl font-semibold">{sellPicks.length}</div>
            </div>
          </div>

          {sellPicks.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300/60 bg-white/60 px-4 py-6 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white/65">
              Er zijn op dit moment geen audit-gevalideerde SELL-signalen voor aandelen.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {sellPicks.map((item) => (
                <PickCard key={`sell-${item.symbol}-${item.status}`} item={item} />
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-300/45 bg-white/80 p-4 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white/65">
          <span className="font-medium text-slate-900 dark:text-white">{hiddenBuys}</span> BUY-signalen en{' '}
          <span className="font-medium text-slate-900 dark:text-white">{hiddenSells}</span> SELL-signalen staan niet in de bovenste blokken,
          maar wel in de volledige audit-lijsten hieronder. Dubbele symbolen uit meerdere indexen tonen we maar een keer.
        </section>
      </main>
    </>
  )
}

export const getServerSideProps: GetServerSideProps<Props> = async (context) => {
  try {
    const forwardedProto = context.req.headers['x-forwarded-proto']
    const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : (forwardedProto || 'https')
    const reqHost = Array.isArray(context.req.headers.host) ? context.req.headers.host[0] : context.req.headers.host
    const requestBase = reqHost ? `${proto}://${reqHost}` : ''
    const base =
      process.env.NODE_ENV === 'development'
        ? 'http://localhost:3000'
        : (requestBase || BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'))

    const results = await Promise.all(
      STOCK_MARKETS.map(async (market) => {
        const r = await fetch(`${base}/api/backtest/market-audit?market=${market.slug}`, { cache: 'no-store' })
        if (!r.ok) return { market: market.key, picks: [] as AuditPick[] }
        const data = await r.json()
        return {
          market: market.key,
          picks: Array.isArray(data?.qualifiedLivePicks) ? (data.qualifiedLivePicks as AuditPick[]) : [],
        }
      })
    )

    const deduped = new Map<string, StockPick>()

    for (const result of results) {
      for (const raw of result.picks) {
        const market = raw?.market === result.market ? result.market : result.market
        const pick = buildPick(market, raw)
        if (!pick) continue
        const dedupeKey = `${pick.symbol}::${pick.status}`
        const existing = deduped.get(dedupeKey)
        deduped.set(dedupeKey, existing ? bestOf(existing, pick) : pick)
      }
    }

    const picks = [...deduped.values()].sort(sortByBest)

    return {
      props: {
        error: null,
        generatedAt: new Date().toLocaleString('nl-NL'),
        picks,
      },
    }
  } catch (e: any) {
    return {
      props: {
        error: e?.message || 'Failed to fetch',
        generatedAt: new Date().toLocaleString('nl-NL'),
        picks: [],
      },
    }
  }
}
