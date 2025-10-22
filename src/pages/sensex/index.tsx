// src/pages/sensex/index.tsx
import Head from 'next/head'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { SENSEX as AEX } from '@/lib/sensex'
import ScoreBadge from '@/components/ScoreBadge'

type Advice = 'BUY' | 'HOLD' | 'SELL'

type SnapItem = {
  symbol: string
  price?: number | null
  change?: number | null
  changePct?: number | null
  ma?:    { ma50: number | null; ma200: number | null; status?: Advice }
  rsi?:   number | null
  macd?:  { macd: number | null; signal: number | null; hist: number | null }
  volume?:{ volume: number | null; avg20d: number | null; ratio: number | null }
  score?: number
}

function num(v: number | null | undefined, d = 2) {
  return (v ?? v === 0) && Number.isFinite(v as number) ? (v as number).toFixed(d) : '—'
}
function fmtPrice(v: number | null | undefined, ccy: string = 'INR') {
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

// batching helpers
const CHUNK = 50
const sleep = (ms:number)=> new Promise(r=>setTimeout(r, ms))
function chunk<T>(arr:T[], size:number){ const out: T[][]=[]; for(let i=0;i<arr.length;i+=size) out.push(arr.slice(i,i+size)); return out }
async function pool<T,R>(arr:T[], n:number, fn:(x:T,i:number)=>Promise<R>):Promise<R[]>{
  const out: R[] = new Array(arr.length) as any
  let i=0
  const workers = new Array(Math.min(n,arr.length)).fill(0).map(async()=> {
    while(true){ const idx=i++; if(idx>=arr.length) break; out[idx]=await fn(arr[idx], idx) }
  })
  await Promise.all(workers)
  return out
}

export default function Sensex() {
  const symbols = useMemo(() => AEX.map(x => x.symbol), [])

  // 1) Snapshot (in batches) — vervangt losse quotes/indicator-calls
  const [items, setItems] = useState<SnapItem[]>([])
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
    load()
    return () => { aborted = true; if (timer) clearTimeout(timer) }
  }, [symbols])

  // 2) 7d / 30d returns (batch)
  const [ret7Map, setRet7Map] = useState<Record<string, number>>({})
  const [ret30Map, setRet30Map] = useState<Record<string, number>>({})
  useEffect(() => {
    let aborted=false
    async function loadDays(days:7|30){
      const groups = chunk(symbols, CHUNK)
      const parts = await pool(groups, 4, async (group, gi) => {
        if (gi) await sleep(80)
        const url = `/api/indicators/ret-batch?days=${days}&symbols=${encodeURIComponent(group.join(','))}`
        const r = await fetch(url, { cache:'no-store' }); if (!r.ok) return { items: [] as any[] }
        return r.json() as Promise<{ items:{ symbol:string; days:number; pct:number|null }[] }>
      })
      const map: Record<string, number> = {}
      parts.forEach(p => p.items?.forEach(it => {
        if (Number.isFinite(it.pct as number)) map[it.symbol] = it.pct as number
      }))
      return map
    }
    ;(async()=>{
      const [m7, m30] = await Promise.all([loadDays(7), loadDays(30)])
      if(!aborted){ setRet7Map(m7); setRet30Map(m30) }
    })()
    return ()=>{aborted=true}
  }, [symbols])

  // Hydration-safe klok
  const [timeStr, setTimeStr] = useState('')
  useEffect(() => {
    const upd = () => setTimeStr(new Date().toLocaleTimeString('nl-NL', { hour12:false }))
    upd(); const id=setInterval(upd,1000); return ()=>clearInterval(id)
  }, [])

  // Indexeren naar sym->item
  const bySym = useMemo(() => {
    const m: Record<string, SnapItem> = {}
    items.forEach(it => { if (it?.symbol) m[it.symbol] = it })
    return m
  }, [items])

  // Samenvatting (rechts)
  const summary = useMemo(() => {
    const rows = AEX.map(a => bySym[a.symbol]).filter(Boolean) as SnapItem[]
    const total = rows.length
    const status = rows.map(r => statusFromScore(r.score))
    const buy  = status.filter(s => s==='BUY').length
    const hold = status.filter(s => s==='HOLD').length
    const sell = status.filter(s => s==='SELL').length
    const avgScore = total ? Math.round(rows.reduce((s,r)=> s + (Number(r.score) || 0), 0) / total) : 50

    const pctArr = rows.map(r => Number(r.changePct)).filter(v => Number.isFinite(v)) as number[]
    const green = pctArr.filter(v => v>0).length
    const breadthPct = pctArr.length ? Math.round((green / pctArr.length) * 100) : 0

    const priced = AEX.map(a => ({ symbol:a.symbol, pct: Number(bySym[a.symbol]?.changePct) }))
      .filter(x => Number.isFinite(x.pct)) as {symbol:string; pct:number}[]
    const topGainers = [...priced].sort((a,b)=> b.pct - a.pct).slice(0,3)
    const topLosers  = [...priced].sort((a,b)=> a.pct - b.pct).slice(0,3)

    return { counts:{ buy, hold, sell, total }, avgScore, breadthPct, topGainers, topLosers }
  }, [bySym])

  // Heatmap
  const [filter, setFilter] = useState<'ALL' | Advice>('ALL')
  const heatmapData = useMemo(() => {
    const rows = AEX.map(a => {
      const it = bySym[a.symbol]
      const score = Number(it?.score)
      const status = statusFromScore(score)
      return { symbol:a.symbol, score: Number.isFinite(score) ? score : 50, status }
    })
    return filter==='ALL' ? rows : rows.filter(r => r.status===filter)
  }, [bySym, filter])

  // helper om suffixen visueel te strippen
  const disp = (sym:string) => sym.replace(/\.BO$/,'').replace(/\.NS$/,'')
  const findName = (sym:string) => AEX.find(a=>a.symbol===sym)?.name || sym

  return (
    <>
      <Head><title>Sensex — SignalHub</title></Head>

      <main className="min-h-screen">
        <section className="max-w-6xl mx-auto px-4 pt-16 pb-8">
          <h1 className="hero">Sensex</h1>
        </section>

        <section className="max-w-6xl mx-auto px-4 pb-16">
          {snapErr && <div className="mb-3 text-red-600 text-sm">Fout bij laden: {snapErr}</div>}

          <div className="grid lg:grid-cols-[2fr_1fr] gap-4">
            {/* Lijst */}
            <div className="table-card p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-gray-500">
                    <th className="px-4 py-3 w-10">#</th>
                    <th className="px-4 py-3">Aandeel</th>
                    <th className="px-4 py-3">Prijs</th>
                    <th className="px-4 py-3">24h</th>
                    <th className="px-4 py-3">7d</th>
                    <th className="px-4 py-3">30d</th>
                    <th className="px-4 py-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {AEX.map((row, i) => {
                    const it = bySym[row.symbol]
                    const price = fmtPrice(it?.price, 'INR')
                    const chg = it?.change
                    const pct = it?.changePct
                    const r7  = ret7Map[row.symbol]
                    const r30 = ret30Map[row.symbol]
                    const score = Number(it?.score)

                    return (
                      <tr key={row.symbol} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-500">{i+1}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Link
                              href={`/sensex/${encodeURIComponent(row.symbol)}`}
                              className="font-medium text-gray-900 hover:underline"
                            >
                              {findName(row.symbol)}
                            </Link>
                            <span className="text-gray-500">({disp(row.symbol)})</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-900">{price}</td>
                        <td className={`px-4 py-3 ${pctCls(pct)}`}>
                          {Number.isFinite(chg as number) && Number.isFinite(pct as number)
                            ? `${chg! >= 0 ? '+' : ''}${num(chg, 2)} (${pct! >= 0 ? '+' : ''}${num(pct, 2)}%)`
                            : '—'}
                        </td>
                        <td className={`px-4 py-3 ${pctCls(r7)}`}>
                          {Number.isFinite(r7 as number) ? `${(r7 as number) >= 0 ? '+' : ''}${num(r7, 2)}%` : '—'}
                        </td>
                        <td className={`px-4 py-3 ${pctCls(r30)}`}>
                          {Number.isFinite(r30 as number) ? `${(r30 as number) >= 0 ? '+' : ''}${num(r30, 2)}%` : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end">
                            {Number.isFinite(score)
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

            {/* Rechts: samenvatting + heatmap */}
            <aside className="space-y-3 lg:sticky lg:top-16 h-max">
              {/* Dagelijkse samenvatting */}
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
                          <span className="text-gray-800">{disp(g.symbol)}</span>
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
                          <span className="text-gray-800">{disp(l.symbol)}</span>
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
                    <button type="button" className={`px-2.5 py-1 rounded-full text-xs border ${filter==='ALL' ? 'bg-gray-200 text-gray-900 border-gray-300' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`} onClick={() => setFilter('ALL')}>All</button>
                    <button type="button" className={`px-2.5 py-1 rounded-full text-xs border ${filter==='BUY' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`} onClick={() => setFilter('BUY')}>Buy</button>
                    <button type="button" className={`px-2.5 py-1 rounded-full text-xs border ${filter==='HOLD' ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`} onClick={() => setFilter('HOLD')}>Hold</button>
                    <button type="button" className={`px-2.5 py-1 rounded-full text-xs border ${filter==='SELL' ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`} onClick={() => setFilter('SELL')}>Sell</button>
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
                        href={`/sensex/${encodeURIComponent(symbol)}`}
                        className={`rounded-xl px-2.5 py-2 text-xs font-semibold border text-center hover:opacity-90 ${cls}`}
                        title={`${findName(symbol)} (${disp(symbol)}) · ${status} · ${score}`}
                      >
                        <div className="leading-none">{disp(symbol)}</div>
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