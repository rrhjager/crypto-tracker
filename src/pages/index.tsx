// src/pages/index.tsx
import Head from 'next/head'
import type { GetServerSideProps } from 'next'
import Link from 'next/link'
import { useEffect } from 'react'
import { useRouter } from 'next/router'

/* ---------------- config ---------------- */
const CARD_CONTENT_H = 'h-[280px]'
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '') || ''

/* ---------------- types ---------------- */
type Advice = 'BUY' | 'HOLD' | 'SELL'
type NewsItem = {
  title: string
  url: string
  source?: string
  published?: string
  image?: string | null
}

type MarketLabel =
  | 'AEX'
  | 'S&P 500'
  | 'NASDAQ'
  | 'Dow Jones'
  | 'DAX'
  | 'FTSE 100'
  | 'Nikkei 225'
  | 'Hang Seng'
  | 'Sensex'

type ScoredEq = {
  symbol: string
  name: string
  market: MarketLabel
  score: number
  signal: Advice
}

type ScoredCoin = {
  symbol: string
  name: string
  score: number
  signal: Advice
}

type CongressTrade = {
  person?: string
  ticker?: string
  side?: 'BUY' | 'SELL' | string
  amount?: string | number
  price?: string | number | null
  date?: string
  url?: string
}

type HomeSnapshot = {
  newsCrypto: NewsItem[]
  newsEq: NewsItem[]
  topBuy: ScoredEq[]
  topSell: ScoredEq[]
  coinTopBuy: ScoredCoin[]
  coinTopSell: ScoredCoin[]
  academy: { title: string; href: string }[]
  congress: CongressTrade[]
}

type Briefing = { advice: string }
type HomeProps = { snapshot: HomeSnapshot | null; briefing: Briefing | null }

/* ---------------- small UI primitives ---------------- */
const Card: React.FC<{
  title: string
  actionHref?: string
  actionLabel?: string
  children: React.ReactNode
}> = ({ title, actionHref, actionLabel, children }) => (
  <section className="rounded-2xl border border-white/10 bg-white/[0.03] shadow-[0_6px_30px_-10px_rgba(0,0,0,0.25)] transition-all hover:-translate-y-[1px] hover:shadow-[0_10px_40px_-12px_rgba(0,0,0,0.35)]">
    <header className="flex items-center justify-between px-5 pt-4 pb-2">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {actionHref && (
        <Link
          href={actionHref}
          className="text-[12px] text-white/70 hover:text-white inline-flex items-center gap-1"
        >
          {actionLabel || 'View all'} <span aria-hidden>→</span>
        </Link>
      )}
    </header>
    <div className="px-4 pb-4">{children}</div>
  </section>
)

const Row: React.FC<{
  left: React.ReactNode
  right?: React.ReactNode
  href?: string
  title?: string
}> = ({ left, right, href, title }) => {
  const Cmp: any = href ? Link : 'div'
  const props: any = href ? { href } : {}
  return (
    <Cmp
      {...props}
      title={title}
      className="flex items-center justify-between gap-3 px-3 py-[10px] rounded-xl hover:bg:white/6 hover:bg-white/6 transition-colors"
    >
      <div className="min-w-0">{left}</div>
      {right && <div className="shrink-0">{right}</div>}
    </Cmp>
  )
}

/* ======== relative-date helpers (voor Congress) ======== */
function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}
function toISORelative(raw?: string | null): string | null {
  if (!raw) return null
  const t = raw.trim().toLowerCase()
  let m = t.match(/(\d+)\s*day(?:s)?\s*ago/)
  if (m) return isoDaysAgo(parseInt(m[1], 10))
  m = t.match(/(\d+)\s*hour(?:s)?\s*ago/)
  if (m) return isoDaysAgo(0)
  if (/\bjust\s*now\b/.test(t) || /\bminute(?:s)?\s*ago\b/.test(t)) return isoDaysAgo(0)
  return null
}
function coerceISO(raw?: string | null): string | null {
  if (!raw) return null
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(raw)) return raw.slice(0, 10)
  const ts = Date.parse(raw)
  if (!Number.isNaN(ts)) return new Date(ts).toISOString().slice(0, 10)
  return null
}

/* ---------------- page ---------------- */
import ScoreBadge from '@/components/ScoreBadge'

export default function Homepage({ snapshot, briefing }: HomeProps) {
  const router = useRouter()

  // Prefetch routes (client-only, heeft geen impact op eerste server-render)
  useEffect(() => {
    const routes = [
      '/crypto',
      '/aex',
      '/sp500',
      '/nasdaq',
      '/dowjones',
      '/dax',
      '/ftse100',
      '/nikkei225',
      '/hangseng',
      '/sensex',
      '/etfs',
      '/intel',
      '/intel/hedgefunds',
      '/intel/macro',
      '/intel/sectors',
      '/academy',
      '/about',
    ]
    routes.forEach((r) => router.prefetch(r).catch(() => {}))
  }, [router])

  const eqTopBuy = snapshot?.topBuy ?? []
  const eqTopSell = snapshot?.topSell ?? []
  const coinTopBuy = snapshot?.coinTopBuy ?? []
  const coinTopSell = snapshot?.coinTopSell ?? []
  const newsCrypto = snapshot?.newsCrypto ?? []
  const newsEq = snapshot?.newsEq ?? []
  const academy = snapshot?.academy ?? []
  const congress = snapshot?.congress ?? []

  /* ---- helpers for news ---- */
  function decodeHtml(s: string) {
    return (s || '')
      .replaceAll('&amp;', '&')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
  }
  const SOURCE_DOMAIN_MAP: Record<string, string> = {
    reuters: 'reuters.com',
    'yahoo finance': 'finance.yahoo.com',
    cnbc: 'cnbc.com',
    'the wall street journal': 'wsj.com',
    'wall street journal': 'wsj.com',
    investopedia: 'investopedia.com',
    marketwatch: 'marketwatch.com',
    "investor's business daily": 'investors.com',
    'investors business daily': 'investors.com',
    cointelegraph: 'cointelegraph.com',
    'investing.com': 'investing.com',
    bloomberg: 'bloomberg.com',
    'financial times': 'ft.com',
    'the verge': 'theverge.com',
    forbes: 'forbes.com',
    techcrunch: 'techcrunch.com',
  }
  function sourceToDomain(src?: string): string | null {
    if (!src) return null
    const key = src.trim().toLowerCase()
    if (SOURCE_DOMAIN_MAP[key]) return SOURCE_DOMAIN_MAP[key]
    for (const k of Object.keys(SOURCE_DOMAIN_MAP)) {
      if (key.includes(k)) return SOURCE_DOMAIN_MAP[k]
    }
    return null
  }
  function realDomainFromUrl(raw: string, src?: string): { domain: string; favicon: string } {
    try {
      const u = new URL(raw)
      if (u.hostname.endsWith('news.google.com')) {
        const orig = u.searchParams.get('url')
        if (orig) {
          const ou = new URL(orig)
          const d = ou.hostname.replace(/^www\./, '')
          return {
            domain: d,
            favicon: `https://www.google.com/s2/favicons?sz=64&domain=${d}`,
          }
        }
        const d2 = sourceToDomain(src || '')
        if (d2) {
          return {
            domain: d2,
            favicon: `https://www.google.com/s2/favicons?sz=64&domain=${d2}`,
          }
        }
      }
      const d = u.hostname.replace(/^www\./, '')
      return {
        domain: d,
        favicon: `https://www.google.com/s2/favicons?sz=64&domain=${d}`,
      }
    } catch {
      const d2 = sourceToDomain(src || '')
      return d2
        ? {
            domain: d2,
            favicon: `https://www.google.com/s2/favicons?sz=64&domain=${d2}`,
          }
        : { domain: '', favicon: '' }
    }
  }

  const renderNews = (items: NewsItem[], keyPrefix: string) => (
    <ul className={`grid gap-2 overflow-y-auto ${CARD_CONTENT_H} pr-1`}>
      {items.length === 0 ? (
        <li className="text-white/60">No news…</li>
      ) : (
        items.map((n, i) => {
          const { domain, favicon } = realDomainFromUrl(n.url, n.source)
          const title = decodeHtml(n.title || '')
          return (
            <li
              key={`${keyPrefix}${i}`}
              className="flex items-start gap-3 p-2 rounded-lg bg-white/5 hover:bg-white/10 transition hover:shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
            >
              {favicon ? (
                <img src={favicon} alt={domain} className="w-4 h-4 mt-1 rounded-sm" />
              ) : (
                <div className="w-4 h-4 mt-1 rounded-sm bg-white/10" />
              )}
              <div className="min-w-0 flex-1">
                <a
                  href={n.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block font-medium text-white hover:underline truncate text-[13px]"
                  title={title}
                >
                  {title}
                </a>
                <div className="text-[11px] text-white/60 mt-0.5 truncate">
                  {(n.source || domain || '').trim()}
                  {n.published
                    ? ` • ${new Date(n.published).toLocaleString('nl-NL')}`
                    : ''}
                </div>
              </div>
            </li>
          )
        })
      )}
    </ul>
  )

  const coinHref = (symbol: string) => `/crypto/${symbol.toLowerCase()}`

  /* ---------------- render ---------------- */
  return (
    <>
      <Head>
        <title>SignalHub — Clarity in Markets</title>
        <meta
          name="description"
          content="Real-time BUY / HOLD / SELL signals across crypto and global equities — all in one stoplight view."
        />
        <link rel="preconnect" href="https://query2.finance.yahoo.com" crossOrigin="" />
        <link rel="preconnect" href="https://api.coingecko.com" crossOrigin="" />
        <link rel="dns-prefetch" href="https://query2.finance.yahoo.com" />
        <link rel="dns-prefetch" href="https://api.coingecko.com" />
      </Head>

      <main className="max-w-screen-2xl mx-auto px-4 pt-8 pb-14">
        <div className="grid gap-5 lg:grid-cols-3">
          {/* 1) Hero — AI briefing */}
          <Card title="Daily AI Briefing">
            <div className={`flex-1 overflow-y-auto ${CARD_CONTENT_H} pr-1`}>
              {briefing?.advice ? (
                <BriefingText text={briefing.advice} />
              ) : (
                <div className="text-white/60 text-[13px]">Generating today’s briefing…</div>
              )}
            </div>
          </Card>

          {/* 2) Crypto — Top BUY */}
          <Card title="Crypto — Top 5 BUY" actionHref="/crypto" actionLabel="All crypto →">
            <ul className={`divide-y divide-white/8 overflow-y-auto ${CARD_CONTENT_H} pr-1`}>
              {coinTopBuy.length === 0 ? (
                <li className="py-3 text-white/60 text-[13px]">No data…</li>
              ) : (
                coinTopBuy.map((r) => (
                  <li key={`cb-${r.symbol}`}>
                    <Row
                      href={coinHref(r.symbol)}
                      left={
                        <div className="truncate">
                          <div className="font-medium truncate text-[13px]">{r.name}</div>
                          <div className="text-white/60 text-[11px]">{r.symbol}</div>
                        </div>
                      }
                      right={
                        <div className="origin-right scale-90 sm:scale-100">
                          <ScoreBadge score={r.score} />
                        </div>
                      }
                    />
                  </li>
                ))
              )}
            </ul>
          </Card>

          {/* 3) Crypto — Top 5 SELL */}
          <Card title="Crypto — Top 5 SELL" actionHref="/crypto" actionLabel="All crypto →">
            <ul className={`divide-y divide-white/8 overflow-y-auto ${CARD_CONTENT_H} pr-1`}>
              {coinTopSell.length === 0 ? (
                <li className="py-3 text-white/60 text-[13px]">No data…</li>
              ) : (
                coinTopSell.map((r) => (
                  <li key={`cs-${r.symbol}`}>
                    <Row
                      href={coinHref(r.symbol)}
                      left={
                        <div className="truncate">
                          <div className="font-medium truncate text-[13px]">{r.name}</div>
                          <div className="text-white/60 text-[11px]">{r.symbol}</div>
                        </div>
                      }
                      right={
                        <div className="origin-right scale-90 sm:scale-100">
                          <ScoreBadge score={r.score} />
                        </div>
                      }
                    />
                  </li>
                ))
              )}
            </ul>
          </Card>

          {/* 4) Equities — Top BUY */}
          <Card
            title="Equities — Top BUY"
            actionHref="/sp500"
            actionLabel="Browse markets →"
          >
            <ul className={`divide-y divide-white/8 overflow-y-auto ${CARD_CONTENT_H} pr-1`}>
              {eqTopBuy.length === 0 ? (
                <li className="py-3 text-white/60 text-[13px]">No data…</li>
              ) : (
                eqTopBuy.map((r) => (
                  <li key={`bb-${r.market}-${r.symbol}`}>
                    <Row
                      href={`/stocks/${encodeURIComponent(r.symbol)}`}
                      left={
                        <div className="min-w-0">
                          <div className="text-white/60 text-[11px] mb-0.5">{r.market}</div>
                          <div className="font-medium truncate text-[13px]">
                            {r.name}{' '}
                            <span className="text-white/60 font-normal">({r.symbol})</span>
                          </div>
                        </div>
                      }
                      right={
                        <div className="origin-right scale-90 sm:scale-100">
                          <ScoreBadge score={r.score} />
                        </div>
                      }
                    />
                  </li>
                ))
              )}
            </ul>
          </Card>

          {/* 5) Equities — Top SELL */}
          <Card
            title="Equities — Top SELL"
            actionHref="/sp500"
            actionLabel="Browse markets →"
          >
            <ul className={`divide-y divide-white/8 overflow-y-auto ${CARD_CONTENT_H} pr-1`}>
              {eqTopSell.length === 0 ? (
                <li className="py-3 text-white/60 text-[13px]">No data…</li>
              ) : (
                eqTopSell.map((r) => (
                  <li key={`bs-${r.market}-${r.symbol}`}>
                    <Row
                      href={`/stocks/${encodeURIComponent(r.symbol)}`}
                      left={
                        <div className="min-w-0">
                          <div className="text-white/60 text-[11px] mb-0.5">{r.market}</div>
                          <div className="font-medium truncate text-[13px]">
                            {r.name}{' '}
                            <span className="text-white/60 font-normal">({r.symbol})</span>
                          </div>
                        </div>
                      }
                      right={
                        <div className="origin-right scale-90 sm:scale-100">
                          <ScoreBadge score={r.score} />
                        </div>
                      }
                    />
                  </li>
                ))
              )}
            </ul>
          </Card>

          {/* 6) Congress Trading — Latest */}
          <Card
            title="Congress Trading — Latest"
            actionHref="/intel"
            actionLabel="Open dashboard →"
          >
            <div className={`overflow-y-auto ${CARD_CONTENT_H} pr-1`}>
              <div className="grid grid-cols-12 text-[10px] text-white/60 px-2 pb-1">
                <div className="col-span-4">Person</div>
                <div className="col-span-3">Ticker</div>
                <div className="col-span-2">Side</div>
                <div className="col-span-3 text-right">Amount / Price</div>
              </div>
              <ul className="divide-y divide-white/8">
                {congress.length === 0 ? (
                  <li className="py-3 text-white/60 text-[12px]">No trades…</li>
                ) : (
                  congress.slice(0, 14).map((t, i) => (
                    <li key={`tr-${i}-${t.person}-${t.ticker}`} className="px-2">
                      <div
                        className="grid grid-cols-12 items-center gap-2 py-2 px-2 rounded-lg hover:bg-white/6 transition"
                        title={
                          t.date ? new Date(t.date).toLocaleString('nl-NL') : undefined
                        }
                      >
                        <div className="col-span-4 min-w-0 truncate text-[12px]">
                          {t.url ? (
                            <a
                              href={t.url}
                              target="_blank"
                              rel="noreferrer"
                              className="hover:underline"
                            >
                              {t.person || '-'}
                            </a>
                          ) : (
                            <span>{t.person || '-'}</span>
                          )}
                        </div>
                        <div className="col-span-3 text-[11px] leading-tight">
                          <div className="font-semibold tracking-wide">
                            {(t.ticker || '').toUpperCase()}
                          </div>
                        </div>
                        <div
                          className={`col-span-2 text-[11px] font-semibold ${
                            String(t.side).toUpperCase() === 'BUY'
                              ? 'text-emerald-400'
                              : String(t.side).toUpperCase() === 'SELL'
                              ? 'text-rose-400'
                              : 'text-white/70'
                          }`}
                        >
                          {String(t.side || '-').toUpperCase()}
                        </div>
                        <div className="col-span-3 text-right text-[12px]">
                          <span className="text-white/80">{t.amount || '-'}</span>
                          {t.price != null && t.price !== '' && (
                            <span className="text-white/50 ml-1">
                              •{' '}
                              {typeof t.price === 'number'
                                ? `$${t.price.toFixed(2)}`
                                : t.price}
                            </span>
                          )}
                        </div>
                      </div>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </Card>

          {/* 7) Crypto News */}
          <Card title="Crypto News" actionHref="/crypto" actionLabel="Open crypto →">
            {renderNews(newsCrypto, 'nC')}
          </Card>

          {/* 8) Equities News */}
          <Card title="Equities News" actionHref="/aex" actionLabel="Open AEX →">
            {renderNews(newsEq, 'nE')}
          </Card>

          {/* 9) Academy */}
          <Card title="Academy" actionHref="/academy" actionLabel="All articles →">
            <ul className={`text-[13px] grid gap-2 overflow-y-auto ${CARD_CONTENT_H} pr-1`}>
              {academy.length === 0 ? (
                <li className="text-white/60">No articles found…</li>
              ) : (
                academy.map((a, i) => (
                  <li key={`ac-${i}`}>
                    <Link
                      href={a.href}
                      className="block p-2 rounded bg-white/5 hover:bg-white/10 transition"
                    >
                      {a.title}
                    </Link>
                  </li>
                ))
              )}
            </ul>
          </Card>
        </div>
      </main>
    </>
  )
}

/**
 * Rendeert de AI-briefing als bullets + aparte Takeaway-regel.
 * Herkent blokken als "Crypto:", "Equities:", "Macro:", ... en "Takeaway:".
 * De Impact-zin wordt cursief getoond.
 */
const BriefingText: React.FC<{ text: string }> = ({ text }) => {
  const trimmed = (text || '').trim()
  if (!trimmed) return null

  type Section = { label: string; body: string }

  const sectionRegex =
    /\b(Crypto|Equities|Macro|FX|Rates|Commodities|Bonds|Volatility|Takeaway)\s*:/gi
  const sections: Section[] = []
  let takeaway = ''

  const matches: { label: string; start: number; full: string }[] = []
  let m: RegExpExecArray | null

  while ((m = sectionRegex.exec(trimmed)) !== null) {
    matches.push({ label: m[1], start: m.index, full: m[0] })
  }

  if (!matches.length) {
    sections.push({ label: 'Summary', body: trimmed })
  } else {
    for (let i = 0; i < matches.length; i++) {
      const cur = matches[i]
      const next = matches[i + 1]
      const bodyStart = cur.start + cur.full.length
      const body = trimmed.slice(bodyStart, next ? next.start : undefined).trim()
      if (/^takeaway$/i.test(cur.label)) {
        takeaway = body
      } else {
        sections.push({ label: cur.label, body })
      }
    }
  }

  const splitImpact = (body: string): { main: string; impact?: string } => {
    const re = /\*?[*]?Impact\*?[*]?\s*:\s*(.+)$/i
    const match = body.match(re)
    if (!match) return { main: body }
    const impactText = match[1].trim()
    const main = body.slice(0, match.index).trim().replace(/\s+$/, '')
    return { main, impact: impactText }
  }

  return (
    <div className="text-[13px] text-white/90">
      <ul className="space-y-2">
        {sections.map((sec, idx) => {
          const { main, impact } = splitImpact(sec.body)
          return (
            <li key={idx} className="flex items-start gap-2">
              <span className="mt-[6px] inline-block h-1.5 w-1.5 rounded-full bg-white/70" />
              <div>
                <span className="font-semibold">{sec.label}:</span>{' '}
                <span>{main}</span>
                {impact && (
                  <>
                    {' '}
                    <span className="italic">Impact: {impact}</span>
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {takeaway && (
        <p className="mt-3 text-[12px] text-white/75">
          <span className="font-semibold">Takeaway:</span>{' '}
          <span>{takeaway}</span>
        </p>
      )}
    </div>
  )
}

export const getServerSideProps: GetServerSideProps<HomeProps> = async (context) => {
  try {
    let base = BASE_URL
    if (!base) {
      const req = context.req as any
      const proto =
        (req?.headers['x-forwarded-proto'] as string) ||
        (req?.headers['x-forwarded-protocol'] as string) ||
        'https'
      const host =
        (req?.headers['x-forwarded-host'] as string) ||
        req?.headers.host ||
        (process.env.VERCEL_URL ? process.env.VERCEL_URL : 'localhost:3000')

      base = `${proto}://${host}`.replace(/\/$/, '')
    }

    const [resSnap, resBrief] = await Promise.all([
      fetch(`${base}/api/home/snapshot`, { cache: 'no-store' }),
      fetch(`${base}/api/home/briefing`, { cache: 'no-store' }),
    ])

    const snapshot = resSnap.ok ? ((await resSnap.json()) as HomeSnapshot) : null
    const briefing = resBrief.ok ? ((await resBrief.json()) as Briefing) : null

    return { props: { snapshot, briefing } }
  } catch {
    return { props: { snapshot: null, briefing: null } }
  }
}