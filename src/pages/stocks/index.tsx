// src/pages/stocks/index.tsx
import Head from 'next/head'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { AEX } from '@/lib/aex'
import ScoreBadge from '@/components/ScoreBadge'
import type { GetServerSideProps } from 'next'

type Advice = 'BUY' | 'HOLD' | 'SELL'

type SnapItem = {
  symbol: string
  price?: number | null
  change?: number | null
  changePct?: number | null
  ret7Pct?: number | null
  ret30Pct?: number | null
  ma?:    { ma50: number | null; ma200: number | null; status?: Advice }
  rsi?:   number | null
  macd?:  { macd: number | null; signal: number | null; hist: number | null }
  volume?:{ volume: number | null; avg20d: number | null; ratio: number | null }
  score?: number
}

function num(v: number | null | undefined, d = 2) {
  return (v ?? v === 0) && Number.isFinite(v as number) ? (v as number).toFixed(d) : '—'
}
function fmtPrice(v: number | null | undefined, ccy: string = 'EUR') {
  if (v == null || !Number.isFinite(v)) return '—'
  try { return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: ccy }).format(v as number) } catch {}
  return (v as number).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
const pctCls = (p?: number | null) =>
  Number(p) > 0 ? 'text-green-600' : Number(p) < 0 ? 'text-red-600' : 'text-gray-500'

const statusFromScore = (score?: number): Advice => {
  const s = Number(score)
  if (!Number.isFinite(s)) return 'HOLD'
  return s >= 66 ? 'BUY' : s <= 33 ? 'SELL' : 'HOLD'
}

// batching helpers (zelfde beleid als SP500/NASDAQ)
const CHUNK = 50
const sleep = (ms:number)=> new Promise(r=>setTimeout(r, ms))
function chunk<T>(arr:T[], size:number){ const out: T[][]=[]; for (let i=0;i<arr.length;i+=size) out.push(arr.slice(i,i+size)); return out }
async function pool<T,R>(arr:T[], n:number, fn:(x:T,i:number)=>Promise<R>):Promise<R[]>{
  const out: R[] = new Array(arr.length) as any
  let i=0
  await Promise.all(new Array(n).fill(0).map(async (_,w)=>{
    while (i < arr.length) {
      const idx = i++
      out[idx] = await fn(arr[idx], idx)
    }
  }))
  return out
}

/** ---------- SSR helpers (alleen binnen dit bestand) ---------- **/
function resolveBaseURL(req?: any): string {
  const envBase = process.env.NEXT_PUBLIC_BASE_URL?.trim()
  if (envBase) return envBase.replace(/\/+$/,'')
  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host
  const proto = (req?.headers?.['x-forwarded-proto'] || 'https') as string
  if (host) return `${proto}://${host}`
  return 'http://localhost:3000'
}

async function fetchJSON<T>(url: string, init: RequestInit = {}, retries = 2, timeoutMs = 9000): Promise<T> {
  let lastErr: unknown
  for (let a = 0; a <= retries; a++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const r = await fetch(url, {
        ...init,
        signal: ctrl.signal,
        headers: { accept: 'application/json', ...(init.headers||{}) },
        cache: 'no-store',
      })
      clearTimeout(timer)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return (await r.json()) as T
    } catch (e) {
      clearTimeout(timer)
      lastErr = e
      if (a === retries) break
      await new Promise(res => setTimeout(res, 300 * (a + 1))) // 300ms, 600ms
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('fetch failed')
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const base = resolveBaseURL(ctx.req)
  const symbols = AEX.map(x => x.symbol)
  const groups = chunk(symbols, CHUNK)

  // zelfde batching als client, maar dan op de server voor instant FCP
  const parts = await pool(groups, 4, async (group, gi) => {
    if (gi) await sleep(80)
    const url = `${base}/api/indicators/snapshot?symbols=${encodeURIComponent(group.join(','))}`
    const j: { items: SnapItem[] } = await fetchJSON(url)
    return j.items || []
  })

  return {
    props: {
      initialItems: parts.flat(),
      now: Date.now(),
    },
  }
}

/** ---------- Page component ---------- **/
type Props = { initialItems: SnapItem[]; now: number }

export default function AEXIndex(props: Props) {
  const symbols = useMemo(() => AEX.map(x => x.symbol), [])

  // 1) Snapshot (batches, vervangt quotes + ret-batch + oude snapshot-list)
  const [items, setItems] = useState<SnapItem[]>(props.initialItems || [])
  const [snapErr, setSnapErr] = useState<string | null>(null)

  useEffect(() => {
    let timer:any, aborted=false
    async function load() {
      try {
        setSnapErr(null)
        const groups = chunk(symbols, CHUNK)
        const parts = await pool(groups, 4, async (group, gi) => {
          if (gi) await sleep(80)
          const url = `/api/indicators/snapshot?symbols=${encodeURIComponent(group.join(','))}`
          const r = await fetch(url, { cache:'no-store' })
          if (!r.ok) throw new Error(`HTTP ${r.status} @ snapshot[${gi}]`)
          const j: { items: SnapItem[] } = await r.json()
          return j.items || []
        })
        if (!aborted) setItems(parts.flat())
      } catch (e:any) {
        if (!aborted) setSnapErr(String(e?.message || e))
      } finally {
        if (!aborted) timer = setTimeout(load, 30000) // 30s refresh
      }
    }
    // Start direct de refresh-loop; initialItems zorgt al voor instant view
    load()
    return () => { aborted = true; if (timer) clearTimeout(timer) }
  }, [symbols])

  // Indexeren per symbool
  const bySym = useMemo(() => {
    const m: Record<string, SnapItem> = {}
    for (const it of items) if (it?.symbol) m[it.symbol] = it
    return m
  }, [items])

  // Hydration-safe klokje
  const [timeStr, setTimeStr] = useState('')
  useEffect(() => {
    const upd = () => setTimeStr(new Date().toLocaleTimeString('nl-NL', { hour12: false }))
    upd(); const id = setInterval(upd, 1000); return () => clearInterval(id)
  }, [])

  // Samenvatting
  const summary = useMemo(() => {
    const withScore = AEX.map(a => ({ sym: a.symbol, s: Number(bySym[a.symbol]?.score) }))
      .filter(x => Number.isFinite(x.s))
    const totalWithScore = withScore.length || 0
    const buy  = withScore.filter(x => statusFromScore(x.s) === 'BUY').length
    const hold = withScore.filter(x => statusFromScore(x.s) === 'HOLD').length
    const sell = withScore.filter(x => statusFromScore(x.s) === 'SELL').length
    const avgScore = totalWithScore ? Math.round(withScore.reduce((acc, x) => acc + (x.s as number), 0) / totalWithScore) : 50

    const pctArr = AEX.map(a => Number(bySym[a.symbol]?.changePct)).filter(v => Number.isFinite(v)) as number[]
    const greenCount = pctArr.filter(v => v > 0).length
    const breadthPct = pctArr.length ? Math.round((greenCount / pctArr.length) * 100) : 0

    const rows = AEX.map(a => ({ symbol: a.symbol, pct: Number(bySym[a.symbol]?.changePct) }))
      .filter(r => Number.isFinite(r.pct)) as {symbol:string; pct:number}[]
    const topGainers = [...rows].sort((a,b) => b.pct - a.pct).slice(0, 3)
    const topLosers  = [...rows].sort((a,b) => a.pct - b.pct).slice(0, 3)

    return { counts: { buy, hold, sell, total: totalWithScore }, avgScore, breadthPct, topGainers, topLosers }
  }, [bySym])

  // Heatmap dataset (zelfde als SP500)
  const [filter, setFilter] = useState<'ALL' | Advice>('ALL')
  const heatmapData = useMemo(() => {
    const rows = AEX.map(a => {
      const it = bySym[a.symbol]
      const score = Number(it?.score)
      const status = statusFromScore(score)
      return { symbol:a.symbol, score: Number.isFinite(score) ? score : 50, status, name:a.name }
    })
    return filter==='ALL' ? rows : rows.filter(r => r.status===filter)
  }, [bySym, filter])

  return (
    <>
      <Head><title>AEX Tracker — SignalHub</title></Head>
      <main className="min-h-screen">
        <section className="max-w-6xl mx-auto px-4 pt-16 pb-8">
          <h1 className="hero">AEX Tracker</h1>
        </section>

        <section className="max-w-6xl mx-auto px-4 pb-16">
          {snapErr && <div className="mb-3 text-red-600 text-sm">Fout bij indicatoren: {snapErr}</div>}

          <div className="grid lg:grid-cols-[2fr_1fr] gap-4">
            {/* Lijst */}
            <div className="table-card p-0 overflow-hidden">
              <table className="w-full text-[13px]">
                <colgroup>
                  <col className="w-10" /><col className="w-[40%]" /><col className="w-[14%]" />
                  <col className="w-[14%]" /><col className="w-[12%]" /><col className="w-[12%]" /><col className="w-[18%]" />
                </colgroup>
                <thead className="bg-gray-50">
                  <tr className="text-left text-gray-500">
                    <th className="px-3 py-3">#</th><th className="px-2 py-3">Aandeel</th><th className="px-3 py-3">Prijs</th>
                    <th className="px-3 py-3">24h</th><th className="px-3 py-3">7d</th><th className="px-3 py-3">30d</th><th className="px-3 py-3 text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {AEX.map((row, i) => {
                    const it = bySym[row.symbol]
                    const price = fmtPrice(it?.price, 'EUR')
                    const chg = it?.change
                    const pct = it?.changePct
                    const r7  = it?.ret7Pct
                    const r30 = it?.ret30Pct
                    const score = Number(it?.score)
                    return (
                      <tr key={row.symbol} className="hover:bg-gray-50 align-middle">
                        <td className="px-3 py-3 text-gray-500">{i+1}</td>
                        <td className="px-2 py-3">
                          <div className="flex items-center gap-1.5">
                            <Link href={`/stocks/${encodeURIComponent(row.symbol)}`} className="font-medium text-gray-900 hover:underline truncate">
                              {row.name}
                            </Link>
                            <span className="text-gray-500 shrink-0">({row.symbol})</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-gray-900 whitespace-nowrap">{price}</td>
                        <td className={`px-3 py-3 whitespace-nowrap ${pctCls(pct)}`}>
                          {Number.isFinite(chg as number) && Number.isFinite(pct as number)
                            ? `${chg! >= 0 ? '+' : ''}${num(chg, 2)} (${pct! >= 0 ? '+' : ''}${num(pct, 2)}%)`
                            : '—'}
                        </td>
                        <td className={`px-3 py-3 whitespace-nowrap ${pctCls(r7)}`}>
                          {Number.isFinite(r7 as number) ? `${(r7 as number) >= 0 ? '+' : ''}${num(r7, 2)}%` : '—'}
                        </td>
                        <td className={`px-3 py-3 whitespace-nowrap ${pctCls(r30)}`}>
                          {Number.isFinite(r30 as number) ? `${(r30 as number) >= 0 ? '+' : ''}${num(r30, 2)}%` : '—'}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center justify-start">
                            <div className="origin-left scale-95">
                              {Number.isFinite(score)
                                ? <ScoreBadge score={score} />
                                : <span className="badge badge-hold">HOLD · 50</span>}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Rechterkolom */}
            <aside className="space-y-3 lg:sticky lg:top-16 h-max">
              <div className="table-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="font-semibold text-gray-900">Dagelijkse samenvatting</div>
                  <div className="text-xs text-gray-500">Stand: <span suppressHydrationWarning>{timeStr}</span></div>
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
                          <span className="text-gray-800">{g.symbol.replace('.AS','')}</span>
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
                          <span className="text-gray-800">{l.symbol.replace('.AS','')}</span>
                          <span className="text-red-600">{num(l.pct, 2)}%</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>

              {/* Heatmap (zelfde opbouw als SP500) */}
              <div className="table-card p-4">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-gray-900">Heatmap</div>
                  <div className="flex gap-1">
                    <button className={`px-2.5 py-1 rounded-full text-xs border ${filter==='ALL' ? 'bg-gray-200 text-gray-900 border-gray-300' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`} onClick={() => setFilter('ALL')}>All</button>
                    <button className={`px-2.5 py-1 rounded-full text-xs border ${filter==='BUY' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`} onClick={() => setFilter('BUY')}>Buy</button>
                    <button className={`px-2.5 py-1 rounded-full text-xs border ${filter==='HOLD' ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`} onClick={() => setFilter('HOLD')}>Hold</button>
                    <button className={`px-2.5 py-1 rounded-full text-xs border ${filter==='SELL' ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`} onClick={() => setFilter('SELL')}>Sell</button>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-4 sm:grid-cols-5 gap-2">
                  {heatmapData.map(({ symbol, score, status, name }) => {
                    const cls =
                      status === 'BUY'
                        ? 'bg-green-500/15 text-green-700 border-green-500/30'
                        : status === 'SELL'
                          ? 'bg-red-500/15 text-red-700 border-red-500/30'
                          : 'bg-amber-500/15 text-amber-700 border-amber-500/30'
                    return (
                      <Link
                        key={symbol}
                        href={`/stocks/${encodeURIComponent(symbol)}`}
                        className={`rounded-xl px-2.5 py-2 text-xs font-semibold border text-center hover:opacity-90 ${cls}`}
                        title={`${name} (${symbol}) · ${status} · ${score}`}
                      >
                        <div className="leading-none">{symbol.replace('.AS','')}</div>
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