// src/pages/stocks/index.tsx
import Head from 'next/head'
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { AEX } from '@/lib/aex'
import ScoreBadge from '@/components/ScoreBadge'

type Advice = 'BUY' | 'HOLD' | 'SELL'
type Quote = {
  symbol: string
  regularMarketPrice: number | null
  regularMarketChange: number | null
  regularMarketChangePercent: number | null
  currency?: string
}

function num(v: number | null | undefined, d = 2) {
  return (v ?? v === 0) && Number.isFinite(v as number) ? (v as number).toFixed(d) : '—'
}
function fmtPrice(v: number | null | undefined, ccy?: string) {
  if (v == null || !Number.isFinite(v)) return '—'
  try {
    if (ccy) return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: ccy }).format(v as number)
  } catch {}
  return (v as number).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
const pctCls = (p?: number | null) =>
  Number(p) > 0 ? 'text-green-600' : Number(p) < 0 ? 'text-red-600' : 'text-gray-500'
function statusFromScore(score: number): Advice {
  if (score >= 66) return 'BUY'
  if (score <= 33) return 'SELL'
  return 'HOLD'
}
const toPtsFromStatus = (s?: Advice) => (s === 'BUY' ? 2 : s === 'SELL' ? -2 : 0)

type SnapItemRaw = {
  symbol: string
  ma?: { ma50: number | null; ma200: number | null; status?: Advice }
  rsi?: { period?: number; rsi: number | null; status?: Advice } | number | null
  macd?: { macd: number | null; signal: number | null; hist?: number | null; status?: Advice }
  macdHist?: number | null
  volume?: { volume: number | null; avg20d: number | null; ratio?: number | null; status?: Advice }
}
type SnapResp = { items: SnapItemRaw[]; updatedAt: number }

function normalizeAndDecorate(raw?: SnapItemRaw) {
  if (!raw) return null as any
  const ma50 = raw.ma?.ma50 ?? null
  const ma200 = raw.ma?.ma200 ?? null
  const rsiNum = typeof raw.rsi === 'number' ? raw.rsi : raw.rsi?.rsi ?? null
  const rsiPeriod =
    typeof raw.rsi === 'object' && raw.rsi && 'period' in raw.rsi ? (raw.rsi as any).period : 14
  const macdVal = raw.macd?.macd ?? null
  const macdSig = raw.macd?.signal ?? null
  const macdHist = (raw.macd?.hist ?? raw.macdHist) ?? null
  const volNow = raw.volume?.volume ?? null
  const volAvg = raw.volume?.avg20d ?? null
  const volRatio =
    raw.volume?.ratio ??
    (Number.isFinite(volNow as number) && Number.isFinite(volAvg as number) && (volAvg as number) !== 0
      ? Number(volNow) / Number(volAvg)
      : null)

  const maStatus: Advice =
    raw.ma?.status ??
    (Number.isFinite(ma50 as number) && Number.isFinite(ma200 as number)
      ? Number(ma50) > Number(ma200) ? 'BUY' : Number(ma50) < Number(ma200) ? 'SELL' : 'HOLD'
      : 'HOLD')

  const rsiStatus: Advice =
    (typeof raw.rsi === 'object' ? (raw.rsi?.status as Advice | undefined) : undefined) ??
    (Number.isFinite(rsiNum as number)
      ? Number(rsiNum) >= 60 ? 'BUY' : Number(rsiNum) <= 40 ? 'SELL' : 'HOLD'
      : 'HOLD')

  const macdStatus: Advice =
    raw.macd?.status ??
    (Number.isFinite(macdHist as number)
      ? Number(macdHist) > 0 ? 'BUY' : Number(macdHist) < 0 ? 'SELL' : 'HOLD'
      : Number.isFinite(macdVal as number) && Number.isFinite(macdSig as number)
        ? Number(macdVal) > Number(macdSig) ? 'BUY' : Number(macdVal) < Number(macdSig) ? 'SELL' : 'HOLD'
        : 'HOLD')

  const volStatus: Advice =
    raw.volume?.status ??
    (Number.isFinite(volRatio as number)
      ? Number(volRatio) >= 1.2 ? 'BUY' : Number(volRatio) <= 0.8 ? 'SELL' : 'HOLD'
      : 'HOLD')

  return {
    symbol: raw.symbol,
    ma: { ma50, ma200, status: maStatus as Advice },
    rsi: { period: rsiPeriod, rsi: rsiNum, status: rsiStatus as Advice },
    macd: { macd: macdVal, signal: macdSig, hist: macdHist, status: macdStatus as Advice },
    volume: { volume: volNow, avg20d: volAvg, ratio: volRatio, status: volStatus as Advice },
  }
}

export default function Stocks() {
  const symbols = useMemo(() => AEX.map(x => x.symbol), [])

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

  // 2) Snapshot-list (30s poll) — stabiel via market=AEX
  const { data: snap, error: snapErr } = useSWR<SnapResp>(
    `/api/indicators/snapshot-list?market=AEX`,
    (url) => fetch(url, { cache: 'no-store' }).then(r => r.json()),
    { refreshInterval: 30_000, revalidateOnFocus: false }
  )

  const snapBySym = useMemo(() => {
    const m: Record<string, ReturnType<typeof normalizeAndDecorate>> = {}
    snap?.items?.forEach(it => { if (it?.symbol) m[it.symbol] = normalizeAndDecorate(it) })
    return m
  }, [snap])

  // 3) Lokale score 0..100 vanuit snapshot-status
  const scoreMapLocal = useMemo(() => {
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

  // 3b) Server-fallback ALTIJD wanneer er missende scores zijn
  const [scoreMapServer, setScoreMapServer] = useState<Record<string, number>>({})
  const fetchedOnceRef = useRef(false)
  useEffect(() => {
    const missing = AEX.map(x => x.symbol).filter(s => !Number.isFinite(scoreMapLocal[s] as number))
    if (!missing.length || fetchedOnceRef.current) return
    let aborted = false
    fetchedOnceRef.current = true
    ;(async () => {
      try {
        const entries = await Promise.all(
          missing.map(async (symbol) => {
            const r = await fetch(`/api/indicators/score/${encodeURIComponent(symbol)}`, { cache: 'no-store' })
            if (!r.ok) return [symbol, null] as const
            const j = await r.json() as { score: number | null }
            return [symbol, Number.isFinite(j.score as number) ? Math.round(Number(j.score)) : null] as const
          })
        )
        if (aborted) return
        const next: Record<string, number> = {}
        for (const [sym, s] of entries) { if (s != null) next[sym] = s }
        setScoreMapServer(prev => ({ ...prev, ...next }))
      } catch {}
    })()
    return () => { aborted = true }
  }, [scoreMapLocal])

  // 3c) Merge: lokaal leidend; server vult gaten
  const scoreMapMerged = useMemo(() => {
    const m: Record<string, number> = { ...scoreMapLocal }
    for (const sym of Object.keys(scoreMapServer)) {
      if (!Number.isFinite(m[sym] as number) && Number.isFinite(scoreMapServer[sym] as number)) {
        m[sym] = scoreMapServer[sym]
      }
    }
    return m
  }, [scoreMapLocal, scoreMapServer])

  // Wegschrijven voor homepage (optioneel)
  useEffect(() => {
    try {
      const now = Date.now()
      Object.entries(scoreMapMerged).forEach(([sym, s]) => {
        if (Number.isFinite(s as number)) {
          localStorage.setItem(`score:${sym}`, JSON.stringify({ ts: now, data: { score: Math.round(Number(s)) } }))
        }
      })
    } catch {}
  }, [scoreMapMerged])

  // 4) 7d/30d batch – ongewijzigd
  const [ret7Map, setRet7Map] = useState<Record<string, number>>({})
  const [ret30Map, setRet30Map] = useState<Record<string, number>>({})
  useEffect(() => {
    let aborted = false
    const list = AEX.map(x => x.symbol)
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

  // Hydration-safe klokje
  const [timeStr, setTimeStr] = useState('')
  useEffect(() => {
    const upd = () => setTimeStr(new Date().toLocaleTimeString('nl-NL', { hour12: false }))
    upd(); const id = setInterval(upd, 1000); return () => clearInterval(id)
  }, [])

  // Samenvatting + heatmap
  const summary = useMemo(() => {
    const withScore = AEX.map(a => ({ sym: a.symbol, s: scoreMapMerged[a.symbol] })).filter(x => Number.isFinite(x.s))
    const totalWithScore = withScore.length || 0
    const buy  = withScore.filter(x => statusFromScore(x.s as number) === 'BUY').length
    const hold = withScore.filter(x => statusFromScore(x.s as number) === 'HOLD').length
    const sell = withScore.filter(x => statusFromScore(x.s as number) === 'SELL').length
    const avgScore = totalWithScore ? Math.round(withScore.reduce((acc, x) => acc + (x.s as number), 0) / totalWithScore) : 50

    const pctArr = AEX.map(a => Number(quotes[a.symbol]?.regularMarketChangePercent)).filter(v => Number.isFinite(v)) as number[]
    const greenCount = pctArr.filter(v => v > 0).length
    const breadthPct = pctArr.length ? Math.round((greenCount / pctArr.length) * 100) : 0

    const rows = AEX.map(a => ({ symbol: a.symbol, pct: Number(quotes[a.symbol]?.regularMarketChangePercent) }))
      .filter(r => Number.isFinite(r.pct)) as {symbol:string; pct:number}[]
    const topGainers = [...rows].sort((a,b) => b.pct - a.pct).slice(0, 3)
    const topLosers  = [...rows].sort((a,b) => a.pct - b.pct).slice(0, 3)

    return { counts: { buy, hold, sell, total: totalWithScore }, avgScore, breadthPct, topGainers, topLosers }
  }, [quotes, scoreMapMerged])

  const [filter, setFilter] = useState<'ALL' | Advice>('ALL')
  const heatmapData = useMemo(() => {
    const rows = AEX.map(a => {
      const score = scoreMapMerged[a.symbol]
      const status = Number.isFinite(score as number) ? statusFromScore(score as number) : 'HOLD'
      return { symbol: a.symbol, score: (score as number) ?? 50, status }
    })
    return filter === 'ALL' ? rows : rows.filter(r => r.status === filter)
  }, [scoreMapMerged, filter])

  return (
    <>
      <Head><title>AEX Tracker — SignalHub</title></Head>
      <main className="min-h-screen">
        <section className="max-w-6xl mx-auto px-4 pt-16 pb-8">
          <h1 className="hero">AEX Tracker</h1>
        </section>

        <section className="max-w-6xl mx-auto px-4 pb-16">
          {qErr && <div className="mb-3 text-red-600 text-sm">Fout bij laden quotes: {qErr}</div>}
          {snapErr && <div className="mb-3 text-red-600 text-sm">Fout bij indicatoren: {String((snapErr as any)?.message || snapErr)}</div>}

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
                    const q = quotes[row.symbol]
                    const price = fmtPrice(q?.regularMarketPrice, q?.currency || 'EUR')
                    const chg = q?.regularMarketChange
                    const pct = q?.regularMarketChangePercent
                    const r7  = ret7Map[row.symbol]
                    const r30 = ret30Map[row.symbol]
                    const score = scoreMapMerged[row.symbol]
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
                              {Number.isFinite(score as number)
                                ? <ScoreBadge score={score as number} />
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
              {/* ... (ongewijzigd: samenvatting + heatmap die scoreMapMerged gebruikt) ... */}
              {/* De rest van je bestaande JSX (samenvatting/heatmap) kan 1:1 blijven. */}
            </aside>
          </div>
        </section>
      </main>
    </>
  )
}