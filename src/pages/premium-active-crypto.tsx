import Head from 'next/head'
import type { GetServerSideProps } from 'next'
import Link from 'next/link'
import { coinHref } from '@/lib/coins'
import { qualifyActiveSignals, type QualifiedSignalMetrics } from '@/lib/qualifiedActive'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '') || ''
const FRESH_SIGNAL_MAX_DAYS = 10

type CryptoPick = {
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
  picks: CryptoPick[]
}

type CryptoPastPerformanceRow = {
  coin?: string
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
    close?: number
  } | null
  nextSignal?: {
    signalReturnPct?: number | null
    daysFromSignal?: number | null
  } | null
  perf?: {
    d7Signal?: number | null
    d30Signal?: number | null
  } | null
  untilNext?: {
    mfeSignal?: number | null
    maeSignal?: number | null
  } | null
}

function parseThreshold(raw: string | string[] | undefined): 70 | 80 {
  const value = Array.isArray(raw) ? raw[0] : raw
  return value === '70' ? 70 : 80
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

function pct(from: number, to: number) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0) return null
  return ((to / from) - 1) * 100
}

function signalAlign(status: 'BUY' | 'SELL', raw: number | null) {
  if (raw == null) return null
  return status === 'BUY' ? raw : -raw
}

function safeDate(d: string | null | undefined) {
  if (!d) return null
  const dt = new Date(`${d}T00:00:00Z`)
  if (!Number.isFinite(dt.getTime())) return null
  return dt
}

function diffDays(fromISO: string | null | undefined, toISO: string | null | undefined) {
  const a = safeDate(fromISO)
  const b = safeDate(toISO)
  if (!a || !b) return null
  const ms = b.getTime() - a.getTime()
  return Math.max(0, Math.round(ms / 86400000))
}

function bestOf(a: CryptoPick, b: CryptoPick) {
  if (b.strength !== a.strength) return b.strength > a.strength ? b : a
  const aRet = Number.isFinite(a.currentReturnPct as number) ? Number(a.currentReturnPct) : -999999
  const bRet = Number.isFinite(b.currentReturnPct as number) ? Number(b.currentReturnPct) : -999999
  if (bRet !== aRet) return bRet > aRet ? b : a
  return a
}

function isFreshSignal(item: CryptoPick) {
  return item.daysSinceSignal == null || item.daysSinceSignal <= FRESH_SIGNAL_MAX_DAYS
}

function sortFreshFirst(a: CryptoPick, b: CryptoPick) {
  const aDays = a.daysSinceSignal ?? 0
  const bDays = b.daysSinceSignal ?? 0
  if (aDays !== bDays) return aDays - bDays
  if (b.strength !== a.strength) return b.strength - a.strength

  const aRet = Number.isFinite(a.currentReturnPct as number) ? Number(a.currentReturnPct) : 999999
  const bRet = Number.isFinite(b.currentReturnPct as number) ? Number(b.currentReturnPct) : 999999
  if (aRet !== bRet) return aRet - bRet

  return a.symbol.localeCompare(b.symbol)
}

function buildPick(row: CryptoPastPerformanceRow, thresholdScore: 70 | 80): CryptoPick | null {
  const symbol = String(row?.coin || '').trim().toUpperCase()
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

  const openSignalReturn =
    lastSignal?.status === status ? signalAlign(status, pct(Number(lastSignal?.close), Number(current?.close))) : null

  const currentReturnPct =
    Number.isFinite(nextSignal?.signalReturnPct as number) ? Number(nextSignal?.signalReturnPct) : openSignalReturn

  const daysSinceSignal = Number.isFinite(nextSignal?.daysFromSignal as number)
    ? Number(nextSignal?.daysFromSignal)
    : diffDays(lastSignal?.date, current?.date)

  return {
    symbol,
    name,
    href: coinHref(symbol),
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
  item: CryptoPick
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
          <div className="mt-1 text-[11px] text-slate-700/75 dark:text-white/60">Crypto</div>
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

export default function PremiumActiveCryptoPage({ error, generatedAt, thresholdScore, picks }: Props) {
  const buyPicks = picks.filter((item) => item.status === 'BUY')
  const sellPicks = picks.filter((item) => item.status === 'SELL')
  const qualifiedBuys = buyPicks.filter((item) => item.quality?.qualifies)
  const qualifiedSells = sellPicks.filter((item) => item.quality?.qualifies)

  const freshBuys = qualifiedBuys.filter(isFreshSignal).sort(sortFreshFirst)
  const freshSells = qualifiedSells.filter(isFreshSignal).sort(sortFreshFirst)
  const featuredBuys = freshBuys.slice(0, 5)
  const featuredSells = freshSells.slice(0, 5)
  const hiddenBuys = Math.max(0, buyPicks.length - featuredBuys.length)
  const hiddenSells = Math.max(0, sellPicks.length - featuredSells.length)

  return (
    <>
      <Head>
        <title>Top Crypto Signalen | SignalHub</title>
        <meta
          name="description"
          content="Alleen losse crypto. Geen marktfilter. Deze pagina toont live BUY- en SELL-signalen voor individuele coins met een minimale signaalsterkte van 70 of 80."
        />
      </Head>

      <main className="max-w-screen-xl mx-auto px-4 pt-10 pb-16 space-y-6">
        <section className="rounded-3xl border border-cyan-300/45 bg-[radial-gradient(circle_at_top_right,rgba(6,182,212,0.18),transparent_42%),linear-gradient(135deg,rgba(255,255,255,0.95),rgba(236,254,255,0.92),rgba(239,246,255,0.95))] p-6 shadow-[0_20px_60px_-28px_rgba(6,182,212,0.35)] dark:border-cyan-500/25 dark:bg-[radial-gradient(circle_at_top_right,rgba(6,182,212,0.18),transparent_38%),linear-gradient(135deg,rgba(2,6,23,0.98),rgba(3,15,23,0.96),rgba(2,6,23,0.98))]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="max-w-3xl">
              <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">Top Crypto Signalen</h1>
              <p className="mt-2 text-sm text-slate-800/85 dark:text-white/70">
                Alleen losse crypto. Bovenaan staan de beste instapkansen na de extra kwaliteitsfilter. Daaronder zie je de volledige lijst met alle
                live BUY- en SELL-signalen boven sterkte {thresholdScore}.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link
                href="/premium-active"
                className="rounded-full border border-slate-400/35 bg-white/70 px-4 py-2 text-[12px] font-medium text-slate-800 hover:bg-white dark:border-white/20 dark:bg-white/10 dark:text-white"
              >
                Open aandelen signalen
              </Link>
              <Link
                href="/"
                className="rounded-full border border-cyan-500/35 bg-cyan-500/10 px-4 py-2 text-[12px] font-medium text-cyan-900 hover:bg-cyan-500/20 dark:text-cyan-200"
              >
                Terug naar home
              </Link>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-white/45 bg-white/75 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="text-[11px] font-medium text-slate-600 dark:text-white/55">Crypto long</div>
              <div className="mt-1 text-3xl font-semibold text-emerald-900 dark:text-emerald-200">{buyPicks.length}</div>
              <div className="mt-1 text-[12px] text-slate-700/80 dark:text-white/60">Live BUY-signalen boven de drempel</div>
            </div>

            <div className="rounded-2xl border border-white/45 bg-white/75 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="text-[11px] font-medium text-slate-600 dark:text-white/55">Crypto short</div>
              <div className="mt-1 text-3xl font-semibold text-rose-900 dark:text-rose-200">{sellPicks.length}</div>
              <div className="mt-1 text-[12px] text-slate-700/80 dark:text-white/60">Live SELL-signalen boven de drempel</div>
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
                  href={value === 80 ? '/premium-active-crypto' : `/premium-active-crypto?threshold=${value}`}
                  className={`rounded-2xl border px-4 py-3 text-left transition ${
                    isActive
                      ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-950 dark:text-cyan-200'
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
            Fout bij laden van deze cryptolijst: {error}
          </section>
        )}

        <section className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-300/45 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
            <div className="text-[11px] font-medium text-slate-600 dark:text-white/55">Regel 1</div>
            <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">Bovenste blokken = beste instapkansen</div>
            <div className="mt-1 text-[12px] text-slate-700/80 dark:text-white/60">
              Daar filteren we extra op kwaliteit, timing en te late instappen.
            </div>
          </div>

          <div className="rounded-2xl border border-slate-300/45 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
            <div className="text-[11px] font-medium text-slate-600 dark:text-white/55">Regel 2</div>
            <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">Onderste lijsten = volledige pool</div>
            <div className="mt-1 text-[12px] text-slate-700/80 dark:text-white/60">Daar zie je alle live signalen boven de gekozen sterktedrempel.</div>
          </div>

          <div className="rounded-2xl border border-slate-300/45 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
            <div className="text-[11px] font-medium text-slate-600 dark:text-white/55">Regel 3</div>
            <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">Verdwijnt hij?</div>
            <div className="mt-1 text-[12px] text-slate-700/80 dark:text-white/60">Dan sluit je de trade. Staat hij alleen onderaan, dan is het geen top-entry meer maar wel nog actief.</div>
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
              Er zijn op dit moment geen verse losse crypto met een BUY-signaal boven deze sterkte.
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
              Er zijn op dit moment geen verse losse crypto met een SELL-signaal boven deze sterkte.
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
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Alle actieve BUY-signalen</h2>
              <p className="text-sm text-slate-700/80 dark:text-white/65">
                Dit is de volledige BUY-lijst boven sterkte {thresholdScore}, gesorteerd op kwaliteit.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-300/45 bg-white/70 px-4 py-2 text-center text-slate-900 dark:border-white/10 dark:bg-white/10 dark:text-white">
              <div className="text-[10px] uppercase tracking-[0.12em] opacity-75">Totaal</div>
              <div className="text-2xl font-semibold">{buyPicks.length}</div>
            </div>
          </div>

          {buyPicks.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300/60 bg-white/60 px-4 py-6 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white/65">
              Er zijn op dit moment geen losse crypto met een BUY-signaal boven deze sterkte.
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
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Alle actieve SELL-signalen</h2>
              <p className="text-sm text-slate-700/80 dark:text-white/65">
                Dit is de volledige SELL-lijst boven sterkte {thresholdScore}, gesorteerd op kwaliteit.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-300/45 bg-white/70 px-4 py-2 text-center text-slate-900 dark:border-white/10 dark:bg-white/10 dark:text-white">
              <div className="text-[10px] uppercase tracking-[0.12em] opacity-75">Totaal</div>
              <div className="text-2xl font-semibold">{sellPicks.length}</div>
            </div>
          </div>

          {sellPicks.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300/60 bg-white/60 px-4 py-6 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white/65">
              Er zijn op dit moment geen losse crypto met een SELL-signaal boven deze sterkte.
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
          <span className="font-medium text-slate-900 dark:text-white">{hiddenSells}</span> SELL-signalen staan niet in de bovenste instaplijsten,
          omdat ze ouder zijn of lager scoren op kwaliteit.
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

    const r = await fetch(`${base}/api/past-performance/crypto`, { cache: 'no-store' })
    if (!r.ok) {
      return {
        props: {
          error: `HTTP ${r.status}`,
          generatedAt: new Date().toLocaleString('nl-NL'),
          thresholdScore,
          picks: [],
        },
      }
    }

    const data = await r.json()
    const rows = Array.isArray(data?.rows) ? (data.rows as CryptoPastPerformanceRow[]) : []

    const deduped = new Map<string, CryptoPick>()

    for (const row of rows) {
      const pick = buildPick(row, thresholdScore)
      if (!pick) continue

      const dedupeKey = `${pick.symbol}::${pick.status}`
      const existing = deduped.get(dedupeKey)
      deduped.set(dedupeKey, existing ? bestOf(existing, pick) : pick)
    }

    const picks = qualifyActiveSignals([...deduped.values()], thresholdScore)

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
