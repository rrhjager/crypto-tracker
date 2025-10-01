// src/pages/index.tsx
import Head from 'next/head'
import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import { mutate } from 'swr'
import { AEX } from '@/lib/aex'
import ScoreBadge from '@/components/ScoreBadge'

/* ---------------- config ---------------- */
const HERO_IMG = '/images/hero-crypto-tracker.png'
const DEBUG = false // zet tijdelijk op true als je wil zien welke endpoint/symbool hit

/* ---------------- types ---------------- */
type Advice = 'BUY' | 'HOLD' | 'SELL'

type Quote = {
  symbol: string
  regularMarketPrice: number | null
  regularMarketChange: number | null
  regularMarketChangePercent: number | null
  currency?: string
}

type NewsItem = {
  title: string
  url: string
  source?: string
  published?: string
  image?: string | null
}

type MaCrossResp = { symbol: string; ma50: number | null; ma200: number | null; status: Advice; points: number | null }
type RsiResp    = { symbol: string; period: number; rsi: number | null; status: Advice; points: number | null }
type MacdResp   = { symbol: string; fast: number; slow: number; signalPeriod: number; macd: number | null; signal: number | null; hist: number | null; status: Advice; points: number | null }
type Vol20Resp  = { symbol: string; period: number; volume: number | null; avg20: number | null; ratio: number | null; status: Advice; points: number | null }

/* ---- markten ---- */
type MarketLabel =
  | 'AEX' | 'S&P 500' | 'NASDAQ' | 'Dow Jones'
  | 'DAX' | 'FTSE 100' | 'Nikkei 225' | 'Hang Seng' | 'Sensex'

type ScoredEq = { symbol: string; name: string; market: MarketLabel; score: number; signal: Advice }
type ScoredCoin = { symbol: string; name: string; score: number; signal: Advice }

/* ---------------- utils ---------------- */
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
function statusFromScore(score: number): Advice {
  if (score >= 66) return 'BUY'
  if (score <= 33) return 'SELL'
  return 'HOLD'
}

/* ---------- (fallback) identieke 4-indicator aggregatie — niet meer gebruikt voor crypto homepage ---------- */
async function calcScoreForSymbol(symbol: string): Promise<number | null> {
  try {
    const [rMa, rRsi, rMacd, rVol] = await Promise.all([
      fetch(`/api/indicators/ma-cross/${encodeURIComponent(symbol)}?ts=${Date.now()}`, { cache: 'no-store' }),
      fetch(`/api/indicators/rsi/${encodeURIComponent(symbol)}?period=14&ts=${Date.now()}`, { cache: 'no-store' }),
      fetch(`/api/indicators/macd/${encodeURIComponent(symbol)}?fast=12&slow=26&signal=9&ts=${Date.now()}`, { cache: 'no-store' }),
      fetch(`/api/indicators/vol20/${encodeURIComponent(symbol)}?period=20&ts=${Date.now()}`, { cache: 'no-store' }),
    ])
    if (!(rMa.ok && rRsi.ok && rMacd.ok && rVol.ok)) return null

    const [ma, rsi, macd, vol] = await Promise.all([
      rMa.json(), rRsi.json(), rMacd.json(), rVol.json()
    ]) as [MaCrossResp, RsiResp, MacdResp, Vol20Resp]

    const toPts = (status?: Advice, pts?: number | null) => {
      if (Number.isFinite(pts as number)) return clamp(Number(pts), -2, 2)
      if (status === 'BUY') return 2
      if (status === 'SELL') return -2
      return 0
    }

    const W_MA = 0.40, W_MACD = 0.30, W_RSI = 0.20, W_VOL = 0.10
    const pMA   = toPts(ma?.status,   ma?.points)
    const pMACD = toPts(macd?.status, macd?.points)
    const pRSI  = toPts(rsi?.status,  rsi?.points)
    const pVOL  = toPts(vol?.status,  vol?.points)

    const nMA   = (pMA   + 2) / 4
    const nMACD = (pMACD + 2) / 4
    const nRSI  = (pRSI  + 2) / 4
    const nVOL  = (pVOL  + 2) / 4

    const agg = W_MA*nMA + W_MACD*nMACD + W_RSI*nRSI + W_VOL*nVOL
    const pct = clamp(Math.round(agg * 100), 0, 100)
    return pct
  } catch {
    return null
  }
}

/* ---------- STRICT: coin score 1:1 uit composite detail-endpoint(s), geen fallback ---------- */
async function fetchCompositeScore(url: string) {
  const withTs = url + (url.includes('?') ? '&' : '?') + `ts=${Date.now()}`
  const r = await fetch(withTs, { cache: 'no-store' })
  if (!r.ok) return { ok: false as const, score: null as number | null, payload: null as any }
  const j = await r.json() as any
  const raw =
    (typeof j?.score === 'number' ? j.score :
     typeof j?.totalScore === 'number' ? j.totalScore :
     typeof j?.data?.score === 'number' ? j.data.score :
     null)
  return { ok: Number.isFinite(raw), score: Number.isFinite(raw) ? Math.round(raw) : null, payload: j }
}

function coinSymbolVariants(sym: string): string[] {
  if (!sym) return []
  const base = sym.replace(/-USD$/i, '')
  // volgorde: origineel, zonder -USD, USDT-variant
  const out = [sym]
  if (base !== sym) out.push(base)
  out.push(base + 'USDT')
  return Array.from(new Set(out))
}

async function calcCoinScoreStrict(symbol: string): Promise<{ score: number | null, source?: string, usedSymbol?: string, payload?: any }> {
  const paths = (sym: string) => [
    `/api/coins/score/${encodeURIComponent(sym)}`,
    `/api/coin/score/${encodeURIComponent(sym)}`,
    `/api/crypto/score/${encodeURIComponent(sym)}`,
    `/api/indicators/total-score/${encodeURIComponent(sym)}?asset=coin`,
    `/api/score/${encodeURIComponent(sym)}?asset=coin`,
  ]
  for (const variant of coinSymbolVariants(symbol)) {
    for (const p of paths(variant)) {
      try {
        const { ok, score, payload } = await fetchCompositeScore(p)
        if (ok && score !== null) {
          if (DEBUG && (variant === 'BTC-USD' || variant === 'BTC')) {
            // eslint-disable-next-line no-console
            console.debug('[coin-score]', { symbol, usedVariant: variant, endpoint: p, score, payload })
          }
          return { score, source: p, usedSymbol: variant, payload }
        }
      } catch {}
    }
  }
  // geen fallback hier om inconsistentie te voorkomen
  if (DEBUG && (symbol === 'BTC-USD' || symbol === 'BTC')) {
    // eslint-disable-next-line no-console
    console.debug('[coin-score] NO MATCHED ENDPOINT for', symbol)
  }
  return { score: null }
}

/* pool helper */
async function pool<T, R>(arr: T[], size: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(arr.length) as any
  let i = 0
  const workers = new Array(Math.min(size, arr.length)).fill(0).map(async () => {
    while (true) {
      const idx = i++
      if (idx >= arr.length) break
      out[idx] = await fn(arr[idx], idx)
    }
  })
  await Promise.all(workers)
  return out
}

/* ---------------- constituents per markt ---------------- */
const STATIC_CONS: Record<MarketLabel, { symbol: string; name: string }[]> = {
  'AEX': [],
  'S&P 500': [
    { symbol: 'AAPL',  name: 'Apple' },
    { symbol: 'MSFT',  name: 'Microsoft' },
    { symbol: 'NVDA',  name: 'NVIDIA' },
    { symbol: 'AMZN',  name: 'Amazon' },
    { symbol: 'META',  name: 'Meta Platforms' },
  ],
  'NASDAQ': [
    { symbol: 'TSLA',  name: 'Tesla' },
    { symbol: 'GOOGL', name: 'Alphabet' },
    { symbol: 'ADBE',  name: 'Adobe' },
    { symbol: 'AVGO',  name: 'Broadcom' },
    { symbol: 'AMD',   name: 'Advanced Micro Devices' },
  ],
  'Dow Jones': [
    { symbol: 'MRK', name: 'Merck' },
    { symbol: 'PG',  name: 'Procter & Gamble' },
    { symbol: 'V',   name: 'Visa' },
    { symbol: 'JPM', name: 'JPMorgan Chase' },
    { symbol: 'UNH', name: 'UnitedHealth' },
  ],
  'DAX': [
    { symbol: 'SAP.DE',  name: 'SAP' },
    { symbol: 'SIE.DE',  name: 'Siemens' },
    { symbol: 'BMW.DE',  name: 'BMW' },
    { symbol: 'BAS.DE',  name: 'BASF' },
    { symbol: 'MBG.DE',  name: 'Mercedes-Benz Group' },
  ],
  'FTSE 100': [
    { symbol: 'AZN.L',   name: 'AstraZeneca' },
    { symbol: 'SHEL.L',  name: 'Shell' },
    { symbol: 'HSBA.L',  name: 'HSBC' },
    { symbol: 'ULVR.L',  name: 'Unilever' },
    { symbol: 'BATS.L',  name: 'BAT' },
  ],
  'Nikkei 225': [
    { symbol: '7203.T',  name: 'Toyota' },
    { symbol: '6758.T',  name: 'Sony' },
    { symbol: '9984.T',  name: 'SoftBank Group' },
    { symbol: '8035.T',  name: 'Tokyo Electron' },
    { symbol: '4063.T',  name: 'Shin-Etsu Chemical' },
  ],
  'Hang Seng': [
    { symbol: '0700.HK', name: 'Tencent' },
    { symbol: '0939.HK', name: 'China Construction Bank' },
    { symbol: '2318.HK', name: 'Ping An' },
    { symbol: '1299.HK', name: 'AIA Group' },
    { symbol: '0005.HK', name: 'HSBC Holdings' },
  ],
  'Sensex': [
    { symbol: 'RELIANCE.NS', name: 'Reliance Industries' },
    { symbol: 'TCS.NS',      name: 'TCS' },
    { symbol: 'HDFCBANK.NS', name: 'HDFC Bank' },
    { symbol: 'INFY.NS',     name: 'Infosys' },
    { symbol: 'ICICIBANK.NS',name: 'ICICI Bank' },
  ],
}

function constituentsForMarket(label: MarketLabel) {
  if (label === 'AEX') return AEX.map(x => ({ symbol: x.symbol, name: x.name }))
  return STATIC_CONS[label] || []
}

/* ------- crypto universum (Yahoo tickers) — TOP 50 ------- */
const COINS: { symbol: string; name: string }[] = [
  { symbol: 'BTC-USD',  name: 'Bitcoin' },
  { symbol: 'ETH-USD',  name: 'Ethereum' },
  { symbol: 'BNB-USD',  name: 'BNB' },
  { symbol: 'SOL-USD',  name: 'Solana' },
  { symbol: 'XRP-USD',  name: 'XRP' },
  { symbol: 'ADA-USD',  name: 'Cardano' },
  { symbol: 'DOGE-USD', name: 'Dogecoin' },
  { symbol: 'TON-USD',  name: 'Toncoin' },
  { symbol: 'TRX-USD',  name: 'TRON' },
  { symbol: 'AVAX-USD', name: 'Avalanche' },
  { symbol: 'DOT-USD',  name: 'Polkadot' },
  { symbol: 'LINK-USD', name: 'Chainlink' },
  { symbol: 'BCH-USD',  name: 'Bitcoin Cash' },
  { symbol: 'LTC-USD',  name: 'Litecoin' },
  { symbol: 'MATIC-USD', name: 'Polygon' },
  { symbol: 'XLM-USD',  name: 'Stellar' },
  { symbol: 'NEAR-USD', name: 'NEAR' },
  { symbol: 'ICP-USD',  name: 'Internet Computer' },
  { symbol: 'ETC-USD',  name: 'Ethereum Classic' },
  { symbol: 'FIL-USD',  name: 'Filecoin' },
  { symbol: 'XMR-USD',  name: 'Monero' },
  { symbol: 'APT-USD',  name: 'Aptos' },
  { symbol: 'ARB-USD',  name: 'Arbitrum' },
  { symbol: 'OP-USD',   name: 'Optimism' },
  { symbol: 'SUI-USD',  name: 'Sui' },
  { symbol: 'HBAR-USD', name: 'Hedera' },
  { symbol: 'ALGO-USD', name: 'Algorand' },
  { symbol: 'VET-USD',  name: 'VeChain' },
  { symbol: 'EGLD-USD', name: 'MultiversX' },
  { symbol: 'AAVE-USD', name: 'Aave' },
  { symbol: 'INJ-USD',  name: 'Injective' },
  { symbol: 'MKR-USD',  name: 'Maker' },
  { symbol: 'RUNE-USD', name: 'THORChain' },
  { symbol: 'IMX-USD',  name: 'Immutable' },
  { symbol: 'FLOW-USD', name: 'Flow' },
  { symbol: 'SAND-USD', name: 'The Sandbox' },
  { symbol: 'MANA-USD', name: 'Decentraland' },
  { symbol: 'AXS-USD',  name: 'Axie Infinity' },
  { symbol: 'QNT-USD',  name: 'Quant' },
  { symbol: 'GRT-USD',  name: 'The Graph' },
  { symbol: 'CHZ-USD',  name: 'Chiliz' },
  { symbol: 'CRV-USD',  name: 'Curve DAO' },
  { symbol: 'ENJ-USD',  name: 'Enjin Coin' },
  { symbol: 'FTM-USD',  name: 'Fantom' },
  { symbol: 'XTZ-USD',  name: 'Tezos' },
  { symbol: 'LDO-USD',  name: 'Lido DAO' },
  { symbol: 'SNX-USD',  name: 'Synthetix' },
  { symbol: 'STX-USD',  name: 'Stacks' },
  { symbol: 'AR-USD',   name: 'Arweave' },
  { symbol: 'GMX-USD',  name: 'GMX' },
]

/* ---------------- page ---------------- */
export default function Homepage() {
  const router = useRouter()

  // Prefetch
  useEffect(() => {
    router.prefetch('/stocks').catch(()=>{})
    router.prefetch('/index').catch(()=>{})
  }, [router])

  // SWR warm-up (alleen news)
  useEffect(() => {
    let aborted = false
    async function prime(key: string) {
      try {
        const r = await fetch(key, { cache: 'no-store' })
        if (!r.ok) return
        const data = await r.json()
        if (!aborted) mutate(key, data, { revalidate: false })
      } catch {}
    }
    const locale = 'hl=en-US&gl=US&ceid=US:en'
    ;[
      `/api/news/google?q=crypto&${locale}`,
      `/api/news/google?q=equities&${locale}`,
    ].forEach(prime)
    return () => { aborted = true }
  }, [])

  /* ========= NEWS state + loader ========= */
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
        const r = await fetch(`/api/news/google?q=${encodeURIComponent(query)}&${locale}&ts=${Date.now()}`, { cache:'no-store' })
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

  /* =======================
     EQUITIES — Top BUY/SELL (identieke score)
     ======================= */
  const MARKET_ORDER: MarketLabel[] = ['AEX','S&P 500','NASDAQ','Dow Jones','DAX','FTSE 100','Nikkei 225','Hang Seng','Sensex']
  const [topBuy, setTopBuy]   = useState<ScoredEq[]>([])
  const [topSell, setTopSell] = useState<ScoredEq[]>([])
  const [scoreErr, setScoreErr] = useState<string | null>(null)

  useEffect(() => {
    let aborted = false
    ;(async () => {
      try {
        setScoreErr(null)
        const outBuy: ScoredEq[] = []
        const outSell: ScoredEq[] = []

        for (const market of MARKET_ORDER) {
          const cons = constituentsForMarket(market)
          if (!cons.length) continue
          const symbols = cons.map(c => c.symbol)

          const scores = await pool(symbols, 4, async (sym, idx) => {
            if (idx) await sleep(60)
            return await calcScoreForSymbol(sym)
          })

          const rows = cons.map((c, i) => ({
            symbol: c.symbol, name: c.name, market, score: scores[i] ?? (null as any)
          })).filter(r => Number.isFinite(r.score as number)) as Array<ScoredEq>

          if (rows.length) {
            const top = [...rows].sort((a,b)=> b.score - a.score)[0]
            const bot = [...rows].sort((a,b)=> a.score - b.score)[0]
            if (top) outBuy.push({ ...top, signal: statusFromScore(top.score) })
            if (bot) outSell.push({ ...bot, signal: statusFromScore(bot.score) })
          }
        }

        if (!aborted) {
          const order = (m: MarketLabel) => MARKET_ORDER.indexOf(m)
          setTopBuy(outBuy.sort((a,b)=> order(a.market)-order(b.market)))
          setTopSell(outSell.sort((a,b)=> order(a.market)-order(b.market)))
        }
      } catch (e: any) {
        if (!aborted) setScoreErr(String(e?.message || e))
      }
    })()
    return () => { aborted = true }
  }, [])

  /* =======================
     CRYPTO — Top 5 BUY/SELL (alleen composite detail-bron, geen fallback)
     ======================= */
  const [coinTopBuy, setCoinTopBuy]   = useState<ScoredCoin[]>([])
  const [coinTopSell, setCoinTopSell] = useState<ScoredCoin[]>([])
  const [coinErr, setCoinErr] = useState<string | null>(null)

  useEffect(() => {
    let aborted = false
    ;(async () => {
      try {
        setCoinErr(null)
        const list = COINS
        const results = await pool(list, 8, async (row, idx) => {
          if (idx) await sleep(35)
          const { score, source, usedSymbol } = await calcCoinScoreStrict(row.symbol)
          if (DEBUG && (row.symbol === 'BTC-USD' || row.symbol === 'BTC')) {
            // eslint-disable-next-line no-console
            console.debug('[coin-score:result]', { requested: row.symbol, usedSymbol, source, score })
          }
          return { name: row.name, symbol: row.symbol, score }
        })

        // neem alleen coins met geldige score (we prefereren consistentie over "vullen")
        const rows = results
          .filter(x => Number.isFinite(x.score as number))
          .map(x => ({ symbol: x.symbol, name: x.name, score: x.score as number }))

        const sortedDesc = [...rows].sort((a,b)=> b.score - a.score)
        const sortedAsc  = [...rows].sort((a,b)=> a.score - b.score)

        const buys  = sortedDesc.slice(0, 5).map(r => ({ ...r, signal: statusFromScore(r.score) }))
        const sells = sortedAsc.slice(0, 5).map(r => ({ ...r, signal: statusFromScore(r.score) }))

        if (!aborted) { setCoinTopBuy(buys); setCoinTopSell(sells) }
      } catch (e:any) {
        if (!aborted) setCoinErr(String(e?.message || e))
      }
    })()
    return () => { aborted = true }
  }, [])

  /* ---------------- render ---------------- */
  return (
    <>
      <Head>
        <title>SignalHub — Clarity in Markets</title>
        <meta name="description" content="Real-time BUY / HOLD / SELL signals across crypto and global equities — all in one stoplight view." />
        <link rel="preconnect" href="https://query2.finance.yahoo.com" crossOrigin="" />
        <link rel="preconnect" href="https://api.coingecko.com" crossOrigin="" />
      </Head>

      {/* WHY SIGNALHUB */}
      <section className="max-w-6xl mx-auto px-4 pt-16 pb-8">
        <div className="grid md:grid-cols-2 gap-8 items-center">
          <div>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-white">Why SignalHub?</h1>
            <div className="text-white/80 mt-3 space-y-4">
              <p><strong>SignalHub is where complexity turns into clarity.</strong> By combining carefully selected indicators across both crypto and global equities, we deliver a complete market overview that cuts through the noise.</p>
              <p>Our platform highlights what truly matters — momentum, volume, sentiment, and market context.</p>
              <p>Already trusted by thousands of investors.</p>
              <p><em>Clarity, confidence, and control. All in one clear buy/hold/sell overview.</em></p>
            </div>
          </div>
          <div className="table-card overflow-hidden">
            <Image src={HERO_IMG} alt="Crypto Tracker — SignalHub" width={1280} height={960} priority unoptimized className="w-full h-auto" />
          </div>
        </div>
        <div className="mt-8 h-px bg-white/10" />
      </section>

      {/* EQUITIES — Top BUY/SELL */}
      <section className="max-w-6xl mx-auto px-4 pb-10 grid md:grid-cols-2 gap-4">
        {/* BUY */}
        <div className="table-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Equities — Top BUY (by Signal Score)</h2>
            {scoreErr && <span className="text-xs text-red-300">Error: {scoreErr}</span>}
          </div>
          <ul className="divide-y divide-white/10">
            {topBuy.length===0 ? (
              <li className="py-3 text-white/60">No data yet…</li>
            ) : topBuy.map((r)=>(
              <li key={`bb-${r.market}-${r.symbol}`} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-white/60 text-xs mb-0.5">{r.market}</div>
                  <div className="font-medium truncate">
                    {r.name} <span className="text-white/60 font-normal">({r.symbol})</span>
                  </div>
                </div>
                <div className="shrink-0 origin-right scale-90 sm:scale-100">
                  <ScoreBadge score={r.score} />
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* SELL */}
        <div className="table-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Equities — Top SELL (by Signal Score)</h2>
            {scoreErr && <span className="text-xs text-red-300">Error: {scoreErr}</span>}
          </div>
          <ul className="divide-y divide-white/10">
            {topSell.length===0 ? (
              <li className="py-3 text-white/60">No data yet…</li>
            ) : topSell.map((r)=>(
              <li key={`bs-${r.market}-${r.symbol}`} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-white/60 text-xs mb-0.5">{r.market}</div>
                  <div className="font-medium truncate">
                    {r.name} <span className="text-white/60 font-normal">({r.symbol})</span>
                  </div>
                </div>
                <div className="shrink-0 origin-right scale-90 sm:scale-100">
                  <ScoreBadge score={r.score} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* CRYPTO — Top 5 BUY/SELL (TOP 50) */}
      <section className="max-w-6xl mx-auto px-4 pb-10 grid md:grid-cols-2 gap-4">
        {/* BUY top 5 */}
        <div className="table-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Crypto — Top 5 BUY (by Signal Score)</h2>
            {coinErr && <span className="text-xs text-red-300">Error: {coinErr}</span>}
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
                <div className="shrink-0 origin-right scale-90 sm:scale-100">
                  <ScoreBadge score={r.score} />
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* SELL top 5 */}
        <div className="table-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Crypto — Top 5 SELL (by Signal Score)</h2>
            {coinErr && <span className="text-xs text-red-300">Error: {coinErr}</span>}
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
                <div className="shrink-0 origin-right scale-90 sm:scale-100">
                  <ScoreBadge score={r.score} />
                </div>
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
          <ul className="grid gap-2">
            {newsCrypto.length===0 ? (
              <li className="text-white/60">No news…</li>
            ) : newsCrypto.map((n,i)=>(
              <li key={`nC${i}`} className="leading-tight">
                <a href={n.url} target="_blank" rel="noreferrer" className="hover:underline">
                  {n.title}
                </a>
                <div className="text-xs text-white/60 mt-0.5">
                  {n.source || ''}{n.published ? ` • ${n.published}` : ''}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="table-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Equities News</h2>
            <Link href="/stocks" className="text-sm text-white/70 hover:text-white">Open AEX →</Link>
          </div>
          <ul className="grid gap-2">
            {newsEq.length===0 ? (
              <li className="text-white/60">No news…</li>
            ) : newsEq.map((n,i)=>(
              <li key={`nE${i}`} className="leading-tight">
                <a href={n.url} target="_blank" rel="noreferrer" className="hover:underline">
                  {n.title}
                </a>
                <div className="text-xs text-white/60 mt-0.5">
                  {n.source || ''}{n.published ? ` • ${n.published}` : ''}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  )
}