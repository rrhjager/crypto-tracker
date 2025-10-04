// src/pages/index.tsx
import Head from 'next/head'
import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import { mutate } from 'swr'
import useSWR from 'swr'
import { AEX } from '@/lib/aex'
import ScoreBadge from '@/components/ScoreBadge'

const HERO_IMG = '/images/hero-crypto-tracker.png'

type Advice = 'BUY' | 'HOLD' | 'SELL'
type NewsItem = { title: string; url: string; source?: string; published?: string; image?: string | null }

type MarketLabel =
  | 'AEX' | 'S&P 500' | 'NASDAQ' | 'Dow Jones'
  | 'DAX' | 'FTSE 100' | 'Nikkei 225' | 'Hang Seng' | 'Sensex'

type ScoredEq   = { symbol: string; name: string; market: MarketLabel; score: number }
type ScoredCoin = { symbol: string; name: string; score: number; signal: Advice }

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const statusFromScore = (score: number): Advice => score >= 66 ? 'BUY' : score <= 33 ? 'SELL' : 'HOLD'

// --- fetcher ---
const fetcher = (u: string) => fetch(u).then(r => r.json())

/* ------- crypto universum (Yahoo tickers) — kort lijstje voor homepage ------- */
const COINS: { symbol: string; name: string }[] = [
  { symbol: 'BTC-USD',  name: 'Bitcoin' },
  { symbol: 'ETH-USD',  name: 'Ethereum' },
  { symbol: 'BNB-USD',  name: 'BNB' },
  { symbol: 'SOL-USD',  name: 'Solana' },
  { symbol: 'VET-USD',  name: 'VeChain' },
  { symbol: 'LINK-USD', name: 'Chainlink' },
  { symbol: 'AVAX-USD', name: 'Avalanche' },
  { symbol: 'XRP-USD',  name: 'XRP' },
  { symbol: 'ADA-USD',  name: 'Cardano' },
  { symbol: 'DOGE-USD', name: 'Dogecoin' },
]

// ===== helpers voor nieuws (favicon + decode + source→domain fallback) =====
function decodeHtml(s: string) {
  return (s || '')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
}
const SOURCE_DOMAIN_MAP: Record<string, string> = {
  'reuters':'reuters.com','yahoo finance':'finance.yahoo.com','cnbc':'cnbc.com',
  'the wall street journal':'wsj.com','wall street journal':'wsj.com','investopedia':'investopedia.com',
  'marketwatch':'marketwatch.com',"investor's business daily":'investors.com','investors business daily':'investors.com',
  'cointelegraph':'cointelegraph.com','investing.com':'investing.com','bloomberg':'bloomberg.com','financial times':'ft.com',
  'the verge':'theverge.com','forbes':'forbes.com','techcrunch':'techcrunch.com',
}
function sourceToDomain(src?: string): string | null {
  if (!src) return null
  const key = src.trim().toLowerCase()
  if (SOURCE_DOMAIN_MAP[key]) return SOURCE_DOMAIN_MAP[key]
  for (const k of Object.keys(SOURCE_DOMAIN_MAP)) if (key.includes(k)) return SOURCE_DOMAIN_MAP[k]
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
        return { domain: d, favicon: `https://www.google.com/s2/favicons?sz=64&domain=${d}` }
      }
      const d2 = sourceToDomain(src || '')
      if (d2) return { domain: d2, favicon: `https://www.google.com/s2/favicons?sz=64&domain=${d2}` }
    }
    const d = u.hostname.replace(/^www\./, '')
    return { domain: d, favicon: `https://www.google.com/s2/favicons?sz=64&domain=${d}` }
  } catch {
    const d2 = sourceToDomain(src || '')
    return d2 ? { domain: d2, favicon: `https://www.google.com/s2/favicons?sz=64&domain=${d2}` } : { domain: '', favicon: '' }
  }
}

const renderNews = (items: NewsItem[], keyPrefix: string) => (
  <ul className="grid gap-2">
    {items.length === 0 ? (
      <li className="text-white/60">No news…</li>
    ) : items.map((n, i) => {
      const { domain, favicon } = realDomainFromUrl(n.url, n.source)
      const title = decodeHtml(n.title || '')
      return (
        <li key={`${keyPrefix}${i}`} className="flex items-start gap-3 p-2 rounded-lg bg-white/5 hover:bg-white/10 transition">
          {favicon ? <img src={favicon} alt={domain} className="w-4 h-4 mt-1 rounded-sm" /> : <div className="w-4 h-4 mt-1 rounded-sm bg-white/10" />}
          <div className="min-w-0 flex-1">
            <a href={n.url} target="_blank" rel="noreferrer" className="block font-medium text-white hover:underline truncate" title={title}>{title}</a>
            <div className="text-xs text-white/60 mt-0.5 truncate">
              {(n.source || domain || '').trim()}
              {n.published ? ` • ${new Date(n.published).toLocaleString('nl-NL')}` : ''}
            </div>
          </div>
        </li>
      )
    })}
  </ul>
)

// ===== Local cache (5 min) for equities top =====
const LS_KEY = 'equitiesTop:v1'
const STALE_MS = 5 * 60 * 1000

function readEquitiesTopFromLS():
  | { topBuy: ScoredEq[]; topSell: ScoredEq[]; ts: number }
  | null
{
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    const j = JSON.parse(raw)
    if (!j?.ts) return null
    return j
  } catch { return null }
}

function saveEquitiesTopToLS(payload: { topBuy: ScoredEq[]; topSell: ScoredEq[]; ts: number }) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(payload)) } catch {}
}

/* ---------------- page ---------------- */
export default function Homepage() {
  const router = useRouter()

  // ===== Prefetch routes + warm API calls in background =====
  useEffect(() => {
    // routes
    const routes = [
      '/crypto',
      '/etfs',
      '/stocks','/sp500','/nasdaq','/dowjones','/dax','/ftse100','/nikkei225','/hangseng','/sensex',
      '/intel','/intel/hedgefunds','/intel/macro','/intel/sectors'
    ]
    routes.forEach(p => router.prefetch(p).catch(()=>{}))

    // warm critical APIs (fire-and-forget, non-blocking)
    ;(async () => {
      const locale = 'hl=en-US&gl=US&ceid=US:en'
      const newsKeys = [
        `/api/news/google?q=${encodeURIComponent('crypto OR bitcoin OR ethereum OR blockchain')}&${locale}`,
        `/api/news/google?q=${encodeURIComponent('equities OR stocks OR stock market OR aandelen OR beurs')}&${locale}`,
      ]
      newsKeys.forEach(async k => {
        try { const r = await fetch(k, { cache:'no-store' }); if (r.ok) mutate(k, await r.json(), { revalidate:false }) } catch {}
      })

      // een paar veelgebruikte crypto-indicatoren alvast inladen (lichtgewicht)
      const pairs = ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','VETUSDT']
      pairs.forEach(async p => {
        try {
          await fetch(`/api/crypto-light/indicators?symbols=${p}`, { cache:'no-store' })
          await fetch(`/api/crypto-light/prices?symbols=${p}`, { cache:'no-store' })
        } catch {}
      })
    })()
  }, [router])

  // ===== NEWS =====
  const [newsCrypto, setNewsCrypto] = useState<NewsItem[]>([])
  const [newsEq, setNewsEq] = useState<NewsItem[]>([])
  useEffect(()=>{
    let aborted=false
    async function load(topic: 'crypto'|'equities', setter:(x:NewsItem[])=>void){
      try{
        const query =
          topic === 'crypto'
            ? 'crypto OR bitcoin OR ethereum OR blockchain'
            : 'equities OR stocks OR stock market OR aandelen OR beurs'
        const locale = 'hl=en-US&gl=US&ceid=US:en'
        const r = await fetch(`/api/news/google?q=${encodeURIComponent(query)}&${locale}`, { cache:'no-store' })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const j = await r.json()
        const arr:NewsItem[] = (j.items || []).slice(0,6).map((x:any)=>({
          title: x.title || '',
          url: x.link,
          source: x.source || '',
          published: x.pubDate || '',
          image: null,
        }))
        if (!aborted) setter(arr)
      }catch{
        if (!aborted) setter([])
      }
    }
    load('crypto', setNewsCrypto)
    load('equities', setNewsEq)
    return ()=>{aborted=true}
  },[])

  // ===== EQUITIES TOP (SWR + localStorage hydration) =====
  const lsBootstrap = useMemo(() => {
    if (typeof window === 'undefined') return undefined
    const j = readEquitiesTopFromLS()
    if (j && Date.now() - j.ts < STALE_MS) return j // verse cache
    return undefined
  }, [])

  const { data: eqTop } = useSWR<{ topBuy: ScoredEq[]; topSell: ScoredEq[]; ts:number }>(
    '/api/v1/equities-top',
    fetcher,
    {
      fallbackData: lsBootstrap,      // instant render uit cache als beschikbaar
      refreshInterval: STALE_MS,      // auto refresh elke 5 min
      dedupingInterval: STALE_MS,     // binnen 5 min niet dubbel
      revalidateOnFocus: true,
    }
  )

  // sla verse payload op in LS zodra die binnen is
  useEffect(() => {
    if (!eqTop) return
    try { saveEquitiesTopToLS(eqTop) } catch {}
  }, [eqTop])

  // ===== CRYPTO — Top BUY/SELL (zoals je had, maar ongewijzigde UI) =====
  const [coinTopBuy, setCoinTopBuy]   = useState<ScoredCoin[]>([])
  const [coinTopSell, setCoinTopSell] = useState<ScoredCoin[]>([])
  const [coinErr, setCoinErr] = useState<string | null>(null)

  // kleine utility (zelfde als eerder)
  const toBinancePair = (symbol: string) => {
    const s = (symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    const skip = new Set(['USDT','USDC','BUSD','DAI','TUSD'])
    if (!s || skip.has(s)) return null
    return `${s}USDT`
  }
  type IndResp = {
    symbol: string
    ma?: { ma50: number|null; ma200: number|null; cross?: string }
    rsi?: number|null
    macd?: { macd: number|null; signal: number|null; hist: number|null }
    volume?: { volume: number|null; avg20d: number|null; ratio: number|null }
    error?: string
  }
  function overallScore(ind?: IndResp): { score: number, status: Advice } {
    if (!ind || ind.error) return { score: 50, status: 'HOLD' }
    let maScore = 50
    if (ind.ma?.ma50 != null && ind.ma?.ma200 != null) {
      if (ind.ma.ma50 > ind.ma.ma200) {
        const spread = Math.max(0, Math.min(0.2, ind.ma.ma50 / Math.max(1e-9, ind.ma.ma200) - 1))
        maScore = 60 + (spread / 0.2) * 40
      } else if (ind.ma.ma50 < ind.ma.ma200) {
        const spread = Math.max(0, Math.min(0.2, ind.ma.ma200 / Math.max(1e-9, ind.ma.ma50) - 1))
        maScore = 40 - (spread / 0.2) * 40
      }
    }
    let rsiScore = 50
    if (typeof ind.rsi === 'number') rsiScore = Math.max(0, Math.min(100, ((ind.rsi - 30) / 40) * 100))
    let macdScore = 50
    const hist = ind.macd?.hist, ma50 = ind.ma?.ma50 ?? null
    if (typeof hist === 'number') {
      if (ma50 && ma50 > 0) {
        const t = 0.01
        const relClamped = Math.max(-1, Math.min(1, (hist / ma50) / t))
        macdScore = Math.round(50 + relClamped * 20)
      } else macdScore = hist > 0 ? 60 : hist < 0 ? 40 : 50
    }
    let volScore = 50
    const ratio = ind.volume?.ratio
    if (typeof ratio === 'number') {
      const delta = Math.max(-1, Math.min(1, (ratio - 1) / 1))
      volScore = Math.max(0, Math.min(100, 50 + delta * 30))
    }
    const score = Math.round(0.35*maScore + 0.25*rsiScore + 0.25*macdScore + 0.15*volScore)
    return { score, status: score>=66?'BUY':score<=33?'SELL':'HOLD' }
  }

  useEffect(() => {
    let aborted = false
    ;(async () => {
      try {
        setCoinErr(null)

        const pairs = COINS.map(c => ({ c, pair: toBinancePair(c.symbol.replace('-USD','')) }))
          .map(x => ({ ...x, pair: x.pair || toBinancePair(x.c.symbol) }))
          .filter(x => !!x.pair) as { c:{symbol:string; name:string}; pair:string }[]

        const lsScores: Record<string, number> = {}
        try {
          if (typeof window !== 'undefined') {
            pairs.forEach(({ pair }) => {
              const raw = localStorage.getItem(`ta:${pair}`)
              if (raw) {
                const j = JSON.parse(raw) as { score?: number; ts?: number }
                if (Number.isFinite(j?.score)) lsScores[pair] = Math.round(Number(j.score))
              }
            })
          }
        } catch {}

        const out: { symbol:string; name:string; score:number|null }[] = []
        for (let i=0;i<pairs.length;i++) {
          const { c, pair } = pairs[i]
          try {
            const r = await fetch(`/api/crypto-light/indicators?symbols=${encodeURIComponent(pair)}`, { cache: 'no-store' })
            if (!r.ok) throw new Error(`HTTP ${r.status}`)
            const j = await r.json() as { results?: IndResp[] }
            const ind = (j.results || [])[0]
            const { score } = overallScore(ind)
            out.push({ symbol: c.symbol, name: c.name, score })
          } catch {
            const sLS = lsScores[pair]
            out.push({ symbol: c.symbol, name: c.name, score: Number.isFinite(sLS) ? sLS : null })
          }
          if (i) await sleep(40)
        }

        const rows = out.filter(r => Number.isFinite(r.score as number)) as { symbol:string; name:string; score:number }[]
        const sortedDesc = [...rows].sort((a,b)=> b.score - a.score)
        const sortedAsc  = [...rows].sort((a,b)=> a.score - b.score)
        if (!aborted) {
          setCoinTopBuy(sortedDesc.slice(0,5).map(r => ({ ...r, signal: statusFromScore(r.score) })))
          setCoinTopSell(sortedAsc.slice(0,5).map(r => ({ ...r, signal: statusFromScore(r.score) })))
        }
      } catch (e:any) { if (!aborted) setCoinErr(String(e?.message || e)) }
    })()
    return () => { aborted = true }
  }, [])

  // derived lists for equities from SWR payload
  const topBuy = (eqTop?.topBuy || []).map(r => ({ ...r, signal: statusFromScore(r.score) }))
  const topSell = (eqTop?.topSell || []).map(r => ({ ...r, signal: statusFromScore(r.score) }))

  /* ---------------- render ---------------- */
  return (
    <>
      <Head>
        <title>SignalHub — Clarity in Markets</title>
        <meta name="description" content="Real-time BUY / HOLD / SELL signals across crypto and global equities — all in one stoplight view." />
        <link rel="preconnect" href="https://query2.finance.yahoo.com" crossOrigin="" />
        <link rel="preconnect" href="https://api.coingecko.com" crossOrigin="" />
      </Head>

      {/* INTRO */}
      <section className="max-w-6xl mx-auto px-4 pt-16 pb-8">
        <div className="grid md:grid-cols-2 gap-8 items-center">
          <div>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-white">Cut the noise. Catch the signal.</h1>
            <div className="text-white/80 mt-3 space-y-4">
              <h2 className="text-xl font-semibold text-white">Why SignalHub?</h2>
              <p>SignalHub is where complexity turns into clarity. We cut through the endless stream of charts, news, and hype to give you a clean, actionable view of the markets. Whether you’re trading crypto, ETFs, or global equities, our platform highlights exactly what matters most: momentum, volume, sentiment, and context.</p>
              <p><strong>No guesswork. No noise. Just signals you can actually use.</strong></p>
              <p>Already trusted by thousands of investors worldwide, SignalHub turns uncertainty into confidence. With our intuitive buy/hold/sell insights, you’ll know where the market stands, and where it’s headed.</p>
              <p><strong>Clarity. Confidence. Control.</strong><br /><span className="text-white/70">That’s SignalHub. Your edge in every market.</span></p>
            </div>
          </div>

          <div className="table-card overflow-hidden">
            <Image src={HERO_IMG} alt="Crypto Tracker — SignalHub" width={1280} height={960} priority unoptimized className="w-full h-auto" />
          </div>
        </div>
        <div className="mt-8 h-px bg-white/10" />
      </section>

      {/* EQUITIES — Top BUY/SELL (instant from cache, refreshes every 5 min) */}
      <section className="max-w-6xl mx-auto px-4 pb-10 grid md:grid-cols-2 gap-4">
        <div className="table-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Equities — Top BUY (by Signal Score)</h2>
          </div>
          <ul className="divide-y divide-white/10">
            {!topBuy.length ? (
              <li className="py-3 text-white/60">No data yet…</li>
            ) : topBuy.map((r)=>(
              <li key={`bb-${r.market}-${r.symbol}`} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-white/60 text-xs mb-0.5">{r.market}</div>
                  <div className="font-medium truncate">
                    {r.name} <span className="text-white/60 font-normal">({r.symbol})</span>
                  </div>
                </div>
                <div className="shrink-0 origin-right scale-90 sm:scale-100"><ScoreBadge score={r.score} /></div>
              </li>
            ))}
          </ul>
        </div>

        <div className="table-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Equities — Top SELL (by Signal Score)</h2>
          </div>
          <ul className="divide-y divide-white/10">
            {!topSell.length ? (
              <li className="py-3 text-white/60">No data yet…</li>
            ) : topSell.map((r)=>(
              <li key={`bs-${r.market}-${r.symbol}`} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-white/60 text-xs mb-0.5">{r.market}</div>
                  <div className="font-medium truncate">
                    {r.name} <span className="text-white/60 font-normal">({r.symbol})</span>
                  </div>
                </div>
                <div className="shrink-0 origin-right scale-90 sm:scale-100"><ScoreBadge score={r.score} /></div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* CRYPTO — Top 5 BUY/SELL */}
      <section className="max-w-6xl mx-auto px-4 pb-10 grid md:grid-cols-2 gap-4">
        <div className="table-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Crypto — Top 5 BUY (by Signal Score)</h2>
          </div>
          <ul className="divide-y divide-white/10">
            {coinTopBuy.length===0 ? (
              <li className="py-3 text-white/60">No data yet…</li>
            ) : coinTopBuy.map((r)=>(
              <li key={`cb-${r.symbol}`} className="py-2 flex items-center justify-between gap-3">
                <div className="truncate">
                  <div className="font-medium truncate">{r.name}</div>
                  <div className="text-white/60 text-xs">{r.symbol}</div>
                </div>
                <div className="shrink-0 origin-right scale-90 sm:scale-100"><ScoreBadge score={r.score} /></div>
              </li>
            ))}
          </ul>
        </div>

        <div className="table-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Crypto — Top 5 SELL (by Signal Score)</h2>
          </div>
          <ul className="divide-y divide-white/10">
            {coinTopSell.length===0 ? (
              <li className="py-3 text-white/60">No data yet…</li>
            ) : coinTopSell.map((r)=>(
              <li key={`cs-${r.symbol}`} className="py-2 flex items-center justify-between gap-3">
                <div className="truncate">
                  <div className="font-medium truncate">{r.name}</div>
                  <div className="text-white/60 text-xs">{r.symbol}</div>
                </div>
                <div className="shrink-0 origin-right scale-90 sm:scale-100"><ScoreBadge score={r.score} /></div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* NEWS */}
      <section className="max-w-6xl mx-auto px-4 pb-16 grid md:grid-cols-2 gap-4">
        <div className="table-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Crypto News</h2>
            <Link href="/index" className="text-sm text-white/70 hover:text-white">Open crypto →</Link>
          </div>
          {renderNews(newsCrypto, 'nC')}
        </div>

        <div className="table-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Equities News</h2>
            <Link href="/stocks" className="text-sm text-white/70 hover:text-white">Open AEX →</Link>
          </div>
          {renderNews(newsEq, 'nE')}
        </div>
      </section>
    </>
  )
}