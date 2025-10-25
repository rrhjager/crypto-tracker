// src/pages/index.tsx
import Head from 'next/head'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { mutate } from 'swr'
import ScoreBadge from '@/components/ScoreBadge'

/* ---------------- config ---------------- */
const TTL_MS = 5 * 60 * 1000 // 5 min cache
const CARD_CONTENT_H = 'h-[280px]'
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '') || ''

/* ---------------- types ---------------- */
type Advice = 'BUY' | 'HOLD' | 'SELL'
type NewsItem = { title: string; url: string; source?: string; published?: string; image?: string | null }
type ScoredEq   = { symbol: string; name: string; market: string; score: number; signal: Advice }
type ScoredCoin = { symbol: string; name: string; score: number; signal: Advice }
type CongressTrade = {
  person?: string; ticker?: string; side?: 'BUY'|'SELL'|string;
  amount?: string|number; price?: string|number|null; date?: string; url?: string;
}
type HomeSnapshot = {
  newsCrypto: NewsItem[];
  newsEq: NewsItem[];
  topBuy: ScoredEq[];
  topSell: ScoredEq[];
  coinTopBuy: ScoredCoin[];
  coinTopSell: ScoredCoin[];
  academy: { title: string; href: string }[];
  congress: CongressTrade[];
}
type HomeProps = { snapshot: HomeSnapshot | null }

/* ---------- localStorage cache helpers ---------- */
function getCache<T>(key: string): T | null {
  try {
    if (typeof window === 'undefined') return null
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const j = JSON.parse(raw) as { ts: number; data: T }
    if (!j?.ts) return null
    if (Date.now() - j.ts > TTL_MS) return null
    return j.data
  } catch { return null }
}
function setCache<T>(key: string, data: T) {
  try {
    if (typeof window === 'undefined') return
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }))
  } catch {}
}

/* ---------------- small UI primitives ---------------- */
const Card: React.FC<{ title: string; actionHref?: string; actionLabel?: string; children: React.ReactNode }> = ({
  title, actionHref, actionLabel, children
}) => (
  <section className="rounded-2xl border border-white/10 bg-white/[0.03] shadow-[0_6px_30px_-10px_rgba(0,0,0,0.25)] transition-all hover:-translate-y-[1px] hover:shadow-[0_10px_40px_-12px_rgba(0,0,0,0.35)]">
    <header className="flex items-center justify-between px-5 pt-4 pb-2">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {actionHref && (
        <Link href={actionHref} className="text-[12px] text-white/70 hover:text-white inline-flex items-center gap-1">
          {actionLabel || 'View all'} <span aria-hidden>→</span>
        </Link>
      )}
    </header>
    <div className="px-4 pb-4">{children}</div>
  </section>
)

const Row: React.FC<{ left: React.ReactNode; right?: React.ReactNode; href?: string; title?: string }> = ({
  left, right, href, title
}) => {
  const Cmp: any = href ? Link : 'div'
  const props: any = href ? { href } : {}
  return (
    <Cmp {...props} title={title} className="flex items-center justify-between gap-3 px-3 py-[10px] rounded-xl hover:bg-white/6 transition-colors">
      <div className="min-w-0">{left}</div>
      {right && <div className="shrink-0">{right}</div>}
    </Cmp>
  )
}

/* ---------------- page ---------------- */
export default function Homepage(props: HomeProps) {
  const router = useRouter()
  const [minuteTag, setMinuteTag] = useState(Math.floor(Date.now() / 60_000))
  useEffect(() => {
    const id = setInterval(() => setMinuteTag(Math.floor(Date.now() / 60_000)), 60_000)
    return () => clearInterval(id)
  }, [])

  /* ---------- Prefetch routes ---------- */
  useEffect(() => {
    const routes = [
      '/crypto',
      '/aex','/sp500','/nasdaq','/dowjones','/dax','/ftse100','/nikkei225','/hangseng','/sensex','/etfs',
      '/intel','/intel/hedgefunds','/intel/macro','/intel/sectors','/academy','/about'
    ]
    routes.forEach(r => router.prefetch(r).catch(()=>{}))
  }, [router])

  /* ---------- hydrateer met snapshot/cache ---------- */
  const [newsCrypto, setNewsCrypto] = useState(props.snapshot?.newsCrypto ?? getCache('home:news:crypto') ?? [])
  const [newsEq, setNewsEq] = useState(props.snapshot?.newsEq ?? getCache('home:news:eq') ?? [])
  const [topBuy, setTopBuy] = useState(props.snapshot?.topBuy ?? getCache('home:eq:topBuy') ?? [])
  const [topSell, setTopSell] = useState(props.snapshot?.topSell ?? getCache('home:eq:topSell') ?? [])
  const [coinTopBuy, setCoinTopBuy] = useState(props.snapshot?.coinTopBuy ?? getCache('home:coin:topBuy') ?? [])
  const [coinTopSell, setCoinTopSell] = useState(props.snapshot?.coinTopSell ?? getCache('home:coin:topSell') ?? [])
  const [academy, setAcademy] = useState(props.snapshot?.academy ?? getCache('home:academy') ?? [])
  const [trades, setTrades] = useState(props.snapshot?.congress ?? getCache('home:congress') ?? [])

  const [loadingEq, setLoadingEq] = useState(!(topBuy.length && topSell.length))
  const [loadingCoin, setLoadingCoin] = useState(!(coinTopBuy.length && coinTopSell.length))
  const [loadingNewsCrypto, setLoadingNewsCrypto] = useState(!(newsCrypto.length))
  const [loadingNewsEq, setLoadingNewsEq] = useState(!(newsEq.length))
  const [loadingCongress, setLoadingCongress] = useState(!(trades.length))
  const [loadingAcademy, setLoadingAcademy] = useState(!(academy.length))

  /* ---------- ZACHTE REFRESH: één call naar snapshot ---------- */
  useEffect(() => {
    let stop = false
    ;(async () => {
      try {
        const r = await fetch('/api/home/snapshot', { cache: 'no-store' })
        if (!r.ok) return
        const s = await r.json() as HomeSnapshot
        if (stop) return
        setNewsCrypto(s.newsCrypto); setCache('home:news:crypto', s.newsCrypto); setLoadingNewsCrypto(false)
        setNewsEq(s.newsEq);         setCache('home:news:eq',     s.newsEq);     setLoadingNewsEq(false)
        setAcademy(s.academy);       setCache('home:academy',     s.academy);    setLoadingAcademy(false)
        setTrades(s.congress);       setCache('home:congress',    s.congress);   setLoadingCongress(false)
        setTopBuy(s.topBuy);         setCache('home:eq:topBuy',   s.topBuy)
        setTopSell(s.topSell);       setCache('home:eq:topSell',  s.topSell);    setLoadingEq(false)
        setCoinTopBuy(s.coinTopBuy); setCache('home:coin:topBuy', s.coinTopBuy)
        setCoinTopSell(s.coinTopSell); setCache('home:coin:topSell', s.coinTopSell); setLoadingCoin(false)
      } catch {}
    })()
    return () => { stop = true }
  }, [])

  /* ---- helpers for news ---- */
  function decodeHtml(s: string) {
    return (s || '')
      .replaceAll('&amp;', '&')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
  }
  function realDomainFromUrl(raw: string, src?: string): { domain: string; favicon: string } {
    try {
      const u = new URL(raw)
      const d = u.hostname.replace(/^www\./, '')
      return { domain: d, favicon: `https://www.google.com/s2/favicons?sz=64&domain=${d}` }
    } catch {
      return { domain: '', favicon: '' }
    }
  }

  const renderNews = (items: NewsItem[], keyPrefix: string, loading = false) => (
    <ul className={`grid gap-2 overflow-y-auto ${CARD_CONTENT_H} pr-1`}>
      {loading ? (
        <li className="text-white/60">Loading…</li>
      ) : items.length === 0 ? (
        <li className="text-white/60">No news…</li>
      ) : items.map((n, i) => {
        const { domain, favicon } = realDomainFromUrl(n.url, n.source)
        const title = decodeHtml(n.title || '')
        return (
          <li key={`${keyPrefix}${i}`} className="flex items-start gap-3 p-2 rounded-lg bg-white/5 hover:bg-white/10 transition">
            {favicon ? <img src={favicon} alt={domain} className="w-4 h-4 mt-1 rounded-sm" /> : <div className="w-4 h-4 mt-1 rounded-sm bg-white/10" />}
            <div className="min-w-0 flex-1">
              <a href={n.url} target="_blank" rel="noreferrer" className="block font-medium text-white hover:underline truncate text-[13px]" title={title}>
                {title}
              </a>
              <div className="text-[11px] text-white/60 mt-0.5 truncate">{(n.source || domain || '').trim()}</div>
            </div>
          </li>
        )
      })}
    </ul>
  )

  const coinHref = (symbol: string) => `/crypto/${symbol.toLowerCase()}`
  const equityHref = (symbol: string) => `/stocks/${encodeURIComponent(symbol)}`

  /* ---------------- render ---------------- */
  return (
    <>
      <Head>
        <title>SignalHub — Clarity in Markets</title>
        <meta name="description" content="Real-time BUY / HOLD / SELL signals across crypto and global equities — all in one stoplight view." />
      </Head>

      <main className="max-w-screen-2xl mx-auto px-4 pt-8 pb-14">
        <div className="grid gap-5 lg:grid-cols-3">
          <Card title="Cut the noise. Catch the signal." actionHref="/about" actionLabel="About us">
            <div className={`flex-1 overflow-y-auto ${CARD_CONTENT_H} pr-1`}>
              <div className="text-white/80 space-y-3 leading-relaxed text-[13px]">
                <p>SignalHub provides a clean, actionable view of crypto and equities — built for clarity and speed.</p>
                <ul className="space-y-1">
                  <li>Unified BUY / HOLD / SELL signals across major cryptos and stock markets.</li>
                  <li>Momentum, volume & trend analytics — understand why assets move.</li>
                  <li>Market Intel feeds — track hedge funds, congress trades, and macro trends.</li>
                </ul>
              </div>
            </div>
          </Card>

          <Card title="Crypto — Top 5 BUY" actionHref="/crypto" actionLabel="All crypto →">
            <ul className={`divide-y divide-white/8 overflow-y-auto ${CARD_CONTENT_H} pr-1`}>
              {loadingCoin ? (
                <li className="py-3 text-white/60 text-[13px]">Loading…</li>
              ) : coinTopBuy.length===0 ? (
                <li className="py-3 text-white/60 text-[13px]">No data…</li>
              ) : coinTopBuy.map((r)=>(
                <li key={`cb-${r.symbol}`}>
                  <Row
                    href={coinHref(r.symbol)}
                    left={<div className="truncate"><div className="font-medium truncate text-[13px]">{r.name}</div><div className="text-white/60 text-[11px]">{r.symbol}</div></div>}
                    right={<div className="origin-right scale-90 sm:scale-100"><ScoreBadge score={r.score}/></div>}
                  />
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Crypto — Top 5 SELL" actionHref="/crypto" actionLabel="All crypto →">
            <ul className={`divide-y divide-white/8 overflow-y-auto ${CARD_CONTENT_H} pr-1`}>
              {loadingCoin ? (
                <li className="py-3 text-white/60 text-[13px]">Loading…</li>
              ) : coinTopSell.length===0 ? (
                <li className="py-3 text-white/60 text-[13px]">No data…</li>
              ) : coinTopSell.map((r)=>(
                <li key={`cs-${r.symbol}`}>
                  <Row
                    href={coinHref(r.symbol)}
                    left={<div className="truncate"><div className="font-medium truncate text-[13px]">{r.name}</div><div className="text-white/60 text-[11px]">{r.symbol}</div></div>}
                    right={<div className="origin-right scale-90 sm:scale-100"><ScoreBadge score={r.score}/></div>}
                  />
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Equities — Top BUY" actionHref="/sp500" actionLabel="Browse markets →">
            <ul className={`divide-y divide-white/8 overflow-y-auto ${CARD_CONTENT_H} pr-1`}>
              {loadingEq ? <li className="py-3 text-white/60 text-[13px]">Loading…</li> :
              topBuy.length===0 ? <li className="py-3 text-white/60 text-[13px]">No data…</li> :
              topBuy.map((r)=>(
                <li key={`bb-${r.market}-${r.symbol}`}>
                  <Row
                    href={equityHref(r.symbol)}
                    left={<div className="min-w-0"><div className="text-white/60 text-[11px] mb-0.5">{r.market}</div><div className="font-medium truncate text-[13px]">{r.name} <span className="text-white/60 font-normal">({r.symbol})</span></div></div>}
                    right={<div className="origin-right scale-90 sm:scale-100"><ScoreBadge score={r.score}/></div>}
                  />
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Equities — Top SELL" actionHref="/sp500" actionLabel="Browse markets →">
            <ul className={`divide-y divide-white/8 overflow-y-auto ${CARD_CONTENT_H} pr-1`}>
              {loadingEq ? <li className="py-3 text-white/60 text-[13px]">Loading…</li> :
              topSell.length===0 ? <li className="py-3 text-white/60 text-[13px]">No data…</li> :
              topSell.map((r)=>(
                <li key={`bs-${r.market}-${r.symbol}`}>
                  <Row
                    href={equityHref(r.symbol)}
                    left={<div className="min-w-0"><div className="text-white/60 text-[11px] mb-0.5">{r.market}</div><div className="font-medium truncate text-[13px]">{r.name} <span className="text-white/60 font-normal">({r.symbol})</span></div></div>}
                    right={<div className="origin-right scale-90 sm:scale-100"><ScoreBadge score={r.score}/></div>}
                  />
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Congress Trading — Latest" actionHref="/intel" actionLabel="Open dashboard →">
            <div className={`overflow-y-auto ${CARD_CONTENT_H} pr-1`}>
              {trades.length===0 ? (
                <div className="py-3 text-white/60 text-[12px]">Loading…</div>
              ) : (
                <ul className="divide-y divide-white/8">
                  {trades.slice(0,14).map((t,i)=>(
                    <li key={`tr-${i}-${t.person}-${t.ticker}`} className="px-2 py-2 text-[12px] flex justify-between">
                      <span className="truncate">{t.person}</span>
                      <span className="truncate text-white/70">{t.ticker}</span>
                      <span className={`font-semibold ${t.side==='BUY'?'text-emerald-400':t.side==='SELL'?'text-rose-400':'text-white/60'}`}>{t.side}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          <Card title="Crypto News" actionHref="/crypto" actionLabel="Open crypto →">
            {renderNews(newsCrypto, 'nC', loadingNewsCrypto)}
          </Card>

          <Card title="Equities News" actionHref="/aex" actionLabel="Open AEX →">
            {renderNews(newsEq, 'nE', loadingNewsEq)}
          </Card>

          <Card title="Academy" actionHref="/academy" actionLabel="All articles →">
            <ul className={`text-[13px] grid gap-2 overflow-y-auto ${CARD_CONTENT_H} pr-1`}>
              {loadingAcademy ? <li className="text-white/60">Loading…</li> :
              academy.length===0 ? <li className="text-white/60">No articles…</li> :
              academy.map((a,i)=>(
                <li key={`ac-${i}`}><Link href={a.href} className="block p-2 rounded bg-white/5 hover:bg-white/10 transition">{a.title}</Link></li>
              ))}
            </ul>
          </Card>
        </div>
      </main>
    </>
  )
}

export async function getStaticProps() {
  try {
    const base = BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
    const res = await fetch(`${base}/api/home/snapshot`, { cache: 'no-store' })
    if (!res.ok) throw new Error('snapshot failed')
    const snapshot = await res.json() as HomeSnapshot
    return { props: { snapshot }, revalidate: 120 }
  } catch {
    return { props: { snapshot: null }, revalidate: 120 }
  }
}