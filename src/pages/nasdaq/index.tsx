// src/pages/nasdaq/index.tsx
import Head from 'next/head'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { NASDAQ } from '@/lib/nasdaq'
import ScoreBadge from '@/components/ScoreBadge'

type Advice = 'BUY' | 'HOLD' | 'SELL'

type Quote = {
  symbol: string
  regularMarketPrice: number | null
  regularMarketChange: number | null
  regularMarketChangePercent: number | null
  currency?: string
}

type SnapItem = {
  symbol: string
  ma?:    { ma50: number | null; ma200: number | null; status?: Advice }
  rsi?:   { period: number; rsi: number | null; status?: Advice }
  macd?:  { macd: number | null; signal: number | null; hist: number | null; status?: Advice }
  volume?:{ volume: number | null; avg20d: number | null; ratio: number | null; status?: Advice }
}
type SnapResp = { items: SnapItem[]; updatedAt: number }

function num(v: number | null | undefined, d = 2) {
  return (v ?? v === 0) && Number.isFinite(v as number) ? (v as number).toFixed(d) : '—'
}
function fmtPrice(v: number | null | undefined, ccy?: string) {
  if (v == null || !Number.isFinite(v)) return '—'
  try {
    if (ccy) return new Intl.NumberFormat('en-US', { style: 'currency', currency: ccy }).format(v as number)
  } catch {}
  return (v as number).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
const pctCls = (p?: number | null) =>
  Number(p) > 0 ? 'text-green-600' : Number(p) < 0 ? 'text-red-600' : 'text-gray-500'

function statusFromScore(score: number): Advice {
  if (score >= 66) return 'BUY'
  if (score <= 33) return 'SELL'
  return 'HOLD'
}
const toPtsFromStatus = (status?: Advice) => status === 'BUY' ? 2 : status === 'SELL' ? -2 : 0

export default function Nasdaq() {
  const symbols = useMemo(() => NASDAQ.map(x => x.symbol), [])

  // 1) Quotes (batch, 20s poll)
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})
  const [qErr, setQErr] = useState<string | null>(null)
  useEffect(() => {
    let timer: any, aborted = false
    async function load() {
      try {
        setQErr(null)
        const url = `/api/quotes?symbols=${encodeURIComponent(symbols.join(','))}`
        const r = await fetch(url, { cache: 'no-store' })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const j: { quotes: Record<string, Quote> } = await r.json()
        if (!aborted) setQuotes(j.quotes || {})
      } catch (e: any) {
        if (!aborted) setQErr(String(e?.message || e))
      } finally {
        if (!aborted) timer = setTimeout(load, 20000)
      }
    }
    load()
    return () => { aborted = true; if (timer) clearTimeout(timer) }
  }, [symbols])

  // 2) Snapshot-list (1 call/30s) — batch i.p.v. 4 losse indicator-calls
  const [snapErr, setSnapErr] = useState<string | null>(null)
  const [snapBySym, setSnapBySym] = useState<Record<string, SnapItem>>({})
  useEffect(() => {
    let timer: any, aborted = false
    async function load() {
      try {
        setSnapErr(null)
        const url = `/api/indicators/snapshot-list?symbols=${encodeURIComponent(symbols.join(','))}`
        const r = await fetch(url, { cache: 'no-store' })
        if (!r.ok) throw new Error(`HTTP ${r.status} @ ${url}`)
        const j: SnapResp = await r.json()
        if (aborted) return
        const m: Record<string, SnapItem> = {}
        j.items?.forEach(it => { if (it?.symbol) m[it.symbol] = it })
        setSnapBySym(m)
      } catch (e: any) {
        if (!aborted) setSnapErr(String(e?.message || e))
      } finally {
        if (!aborted) timer = setTimeout(load, 30000)
      }
    }
    load()
    return () => { aborted = true; if (timer) clearTimeout(timer) }
  }, [symbols])

  // 3) Score 0..100 (zelfde weging als AEX)
  const scoreMap = useMemo(() => {
    const toNorm = (pts: number) => (pts + 2) / 4
    const W_MA = 0.40, W_MACD = 0.30, W_RSI = 0.20, W_VOL = 0.10
    const map: Record<string, number> = {}
    for (const sym of symbols) {
      const it = snapBySym[sym]
      if (!it) continue
      const pMA   = toPtsFromStatus(it.ma?.status)
      const pMACD = toPtsFromStatus(it.macd?.status)
      const pRSI  = toPtsFromStatus(it.rsi?.status)
      const pVOL  = toPtsFromStatus(it.volume?.status)
      const agg = W_MA*toNorm(pMA) + W_MACD*toNorm(pMACD) + W_RSI*toNorm(pRSI) + W_VOL*toNorm(pVOL)
      map[sym] = Math.round(Math.max(0, Math.min(1, agg)) * 100)
    }
    return map
  }, [symbols, snapBySym])

  // 4) 7d / 30d procent-verandering (batch)
  const [ret7Map, setRet7Map] = useState<Record<string, number>>({})
  const [ret30Map, setRet30Map] = useState<Record<string, number>>({})
  useEffect(() => {
    let aborted = false
    const list = NASDAQ.map(x => x.symbol)
    async function loadDays(days: 7 | 30) {
      const url = `/api/indicators/ret-batch?days=${days}&symbols=${encodeURIComponent(list.join(','))}`
      const r = await fetch(url, { cache: 'no-store' })
      if (!r.ok) return {}
      const j = await r.json() as { items: { symbol: string; days: number; pct: number | null }[] }
      const map: Record<string, number> = {}
      j.items.forEach(it => { if (Number.isFinite(it.pct as number)) map[it.symbol] = it.pct as number })
      return map
    }
    ;(async () => {
      const [m7, m30] = await Promise.all([loadDays(7), loadDays(30)])
      if (!aborted) { setRet7Map(m7); setRet30Map(m30) }
    })()
    return () => { aborted = true }
  }, [])

  // Hydration-safe klok
  const [timeStr, setTimeStr] = useState('')
  useEffect(() => {
    const upd = () => setTimeStr(new Date().toLocaleTimeString('nl-NL', { hour12: false }))
    upd()
    const id = setInterval(upd, 1000)
    return () => clearInterval(id)
  }, [])

  // Samenvatting rechts
  const summary = useMemo(() => {
    const withScore = NASDAQ.map(a => ({ sym: a.symbol, s: scoreMap[a.symbol] })).filter(x => Number.isFinite(x.s))
    const totalWithScore = withScore.length || 0
    const buy  = withScore.filter(x => statusFromScore(x.s as number) === 'BUY').length
    const hold = withScore.filter(x => statusFromScore(x.s as number) === 'HOLD').length
    const sell = withScore.filter(x => statusFromScore(x.s as number) === 'SELL').length
    const avgScore = totalWithScore
      ? Math.round(withScore.reduce((acc, x) => acc + (x.s as number), 0) / totalWithScore)
      : 50

    const pctArr = NASDAQ.map(a => Number(quotes[a.symbol]?.regularMarketChangePercent))
      .filter(v => Number.isFinite(v)) as number[]
    const greenCount = pctArr.filter(v => v > 0).length
    const breadthPct = pctArr.length ? Math.round((greenCount / pctArr.length) * 100) : 0

    const rows = NASDAQ.map(a => ({
      symbol: a.symbol,
      pct: Number(quotes[a.symbol]?.regularMarketChangePercent)
    })).filter(r => Number.isFinite(r.pct)) as {symbol:string; pct:number}[]
    const topGainers = [...rows].sort((a,b) => b.pct - a.pct).slice(0, 3)
    const topLosers  = [...rows].sort((a,b) => a.pct - b.pct).slice(0, 3)

    return { counts: { buy, hold, sell, total: totalWithScore }, avgScore, breadthPct, topGainers, topLosers }
  }, [quotes, scoreMap])

  // Heatmap filter
  const [filter, setFilter] = useState<'ALL' | Advice>('ALL')
  const heatmapData = useMemo(() => {
    const rows = NASDAQ.map(a => {
      const score = scoreMap[a.symbol]
      const status = Number.isFinite(score as number) ? statusFromScore(score as number) : 'HOLD'
      return { symbol: a.symbol, score: (score as number) ?? 50, status }
    })
    return filter === 'ALL' ? rows : rows.filter(r => r.status === filter)
  }, [scoreMap, filter])

  return (
    <>
      <Head><title>NASDAQ Tracker — SignalHub</title></Head>

      <main className="min-h-screen">
        <section className="max-w-6xl mx-auto px-4 pt-16 pb-8">
          <h1 className="hero">NASDAQ Tracker</h1>
        </section>

        <section className="max-w-6xl mx-auto px-4 pb-16">
          {qErr &&   <div className="mb-3 text-red-600 text-sm">Fout bij laden quotes: {qErr}</div>}
          {snapErr &&<div className="mb-3 text-red-600 text-sm">Fout bij indicatoren: {snapErr}</div>}

          <div className="grid lg:grid-cols-[2fr_1fr] gap-4">
            {/* Lijst (zelfde layout als AEX) */}
            <div className="table-card p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-gray-500">
                    <th className="px-3 md:px-4 py-3 w-10">#</th>
                    <th className="px-3 md:px-4 py-3">Aandeel</th>
                    <th className="px-3 md:px-4 py-3">Prijs</th>
                    <th className="px-3 md:px-4 py-3">24h</th>
                    <th className="px-3 md:px-4 py-3">7d</th>
                    <th className="px-3 md:px-4 py-3">30d</th>
                    <th className="px-3 md:px-4 py-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {NASDAQ.map((row, i) => {
                    const q = quotes[row.symbol]
                    const price = fmtPrice(q?.regularMarketPrice, q?.currency || 'USD')
                    const chg = q?.regularMarketChange
                    const pct = q?.regularMarketChangePercent
                    const r7  = ret7Map[row.symbol]
                    const r30 = ret30Map[row.symbol]
                    const score = scoreMap[row.symbol]

                    return (
                      <tr key={row.symbol} className="hover:bg-gray-50">
                        <td className="px-3 md:px-4 py-3 text-gray-500">{i+1}</td>
                        <td className="px-3 md:px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Link href={`/nasdaq/${encodeURIComponent(row.symbol)}`} className="font-medium text-gray-900 hover:underline">
                              {row.name}
                            </Link>
                            <span className="text-gray-500">({row.symbol})</span>
                          </div>
                        </td>
                        <td className="px-3 md:px-4 py-3 text-gray-900">{price}</td>
                        <td className={`px-3 md:px-4 py-3 ${pctCls(pct)}`}>
                          {Number.isFinite(chg as number) && Number.isFinite(pct as number)
                            ? `${chg! >= 0 ? '+' : ''}${num(chg, 2)} (${pct! >= 0 ? '+' : ''}${num(pct, 2)}%)`
                            : '—'}
                        </td>
                        <td className={`px-3 md:px-4 py-3 ${pctCls(r7)}`}>
                          {Number.isFinite(r7 as number) ? `${(r7 as number) >= 0 ? '+' : ''}${num(r7, 2)}%` : '—'}
                        </td>
                        <td className={`px-3 md:px-4 py-3 ${pctCls(r30)}`}>
                          {Number.isFinite(r30 as number) ? `${(r30 as number) >= 0 ? '+' : ''}${num(r30, 2)}%` : '—'}
                        </td>
                        <td className="px-3 md:px-4 py-3">
                          <div className="flex justify-end">
                            {Number.isFinite(score as number)
                              ? <ScoreBadge score={score as number} />
                              : <span className="badge badge-hold">HOLD · 50</span>}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Rechterkolom: samenvatting + heatmap */}
            <aside className="space-y-3 lg:sticky lg:top-16 h-max">
              <div className="table-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="font-semibold text-gray-900">Dagelijkse samenvatting</div>
                  <div className="text-xs text-gray-500">
                    Stand: <span suppressHydrationWarning>{timeStr}</span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-3 text-center">
                    <div className="text-xs text-gray-600">BUY</div>
                    <div className="text-lg font-bold text-green-700">
                      {(() => { const t = summary.counts.total || 0; return t ? Math.round((summary.counts.buy / t) * 100) : 0 })()}%
                    </div>
                    <div className="text-xs text-gray-600">{summary.counts.buy}/{summary.counts.total}</div>
                  </div>
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-center">
                    <div className="text-xs text-gray-600">HOLD</div>
                    <div className="text-lg font-bold text-amber-700">
                      {(() => { const t = summary.counts.total || 0; return t ? Math.round((summary.counts.hold / t) * 100) : 0 })()}%
                    </div>
                    <div className="text-xs text-gray-600">{summary.counts.hold}/{summary.counts.total}</div>
                  </div>
                  <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-center">
                    <div className="text-xs text-gray-600">SELL</div>
                    <div className="text-lg font-bold text-red-700">
                      {(() => { const t = summary.counts.total || 0; return t ? Math.round((summary.counts.sell / t) * 100) : 0 })()}%
                    </div>
                    <div className="text-xs text-gray-600">{summary.counts.sell}/{summary.counts.total}</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="rounded-xl border border-gray-200 p-3">
                    <div className="text-xs text-gray-600">Breadth (24h groen)</div>
                    <div className="text-xl font-bold text-gray-900">{summary.breadthPct}%</div>
                  </div>
                  <div className="rounded-xl border border-gray-200 p-3">
                    <div className="text-xs text-gray-600">Gem. score</div>
                    <div className="text-xl font-bold text-gray-900">{summary.avgScore}</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-gray-200 p-3">
                    <div className="text-xs text-gray-600 mb-1">Top stijgers (24h)</div>
                    <ul className="space-y-1 text-sm">
                      {summary.topGainers.map((g, i) => (
                        <li key={`g${i}`} className="flex justify-between">
                          <span className="text-gray-800">{g.symbol}</span>
                          <span className="text-green-600">+{num(g.pct, 2)}%</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-xl border border-gray-200 p-3">
                    <div className="text-xs text-gray-600 mb-1">Top dalers (24h)</div>
                    <ul className="space-y-1 text-sm">
                      {summary.topLosers.map((l, i) => (
                        <li key={`l${i}`} className="flex justify-between">
                          <span className="text-gray-800">{l.symbol}</span>
                          <span className="text-red-600">{num(l.pct, 2)}%</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>

              {/* Heatmap */}
              <div className="table-card p-4">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-gray-900">Heatmap</div>
                  <div className="flex gap-1">
                    <button
                      className={`px-2.5 py-1 rounded-full text-xs border ${filter==='ALL'
                        ? 'bg-gray-200 text-gray-900 border-gray-300'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                      onClick={() => setFilter('ALL')}
                    >All</button>
                    <button
                      className={`px-2.5 py-1 rounded-full text-xs border ${filter==='BUY'
                        ? 'bg-green-600 text-white border-green-600'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                      onClick={() => setFilter('BUY')}
                    >Buy</button>
                    <button
                      className={`px-2.5 py-1 rounded-full text-xs border ${filter==='HOLD'
                        ? 'bg-amber-500 text-white border-amber-500'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                      onClick={() => setFilter('HOLD')}
                    >Hold</button>
                    <button
                      className={`px-2.5 py-1 rounded-full text-xs border ${filter==='SELL'
                        ? 'bg-red-600 text-white border-red-600'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                      onClick={() => setFilter('SELL')}
                    >Sell</button>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-4 sm:grid-cols-5 gap-2">
                  {heatmapData.map(({ symbol, score, status }) => {
                    const cls =
                      status === 'BUY'
                        ? 'bg-green-500/15 text-green-700 border-green-500/30'
                        : status === 'SELL'
                          ? 'bg-red-500/15 text-red-700 border-red-500/30'
                          : 'bg-amber-500/15 text-amber-700 border-amber-500/30'
                    return (
                      <Link
                        key={symbol}
                        href={`/nasdaq/${encodeURIComponent(symbol)}`}
                        className={`rounded-xl px-2.5 py-2 text-xs font-semibold border text-center hover:opacity-90 ${cls}`}
                        title={`${symbol} · ${status} · ${score}`}
                      >
                        <div className="leading-none">{symbol}</div>
                        <div className="mt-1 text-[10px] opacity-80">{score}</div>
                      </Link>
                    )
                  })}
                </div>
              </div>
            </aside>
          </div>
        </section>
      </main>
    </>
  )
}