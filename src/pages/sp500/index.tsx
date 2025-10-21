// src/pages/sp500/index.tsx
import Head from 'next/head'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { SP500 } from '@/lib/sp500'
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
  ma?: { ma50: number | null; ma200: number | null; status?: Advice }
  rsi?: { period: number; rsi: number | null; status?: Advice }
  macd?: { macd: number | null; signal: number | null; hist: number | null; status?: Advice }
  volume?: { volume: number | null; avg20d: number | null; ratio: number | null; status?: Advice }
}
type SnapResp = { items: SnapItem[]; updatedAt: number }

const CHUNK = 50
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
function chunk<T>(arr: T[], size: number) {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
function num(v: number | null | undefined, d = 2) {
  return (v ?? v === 0) && Number.isFinite(v as number)
    ? (v as number).toFixed(d)
    : '—'
}
function fmtPrice(v: number | null | undefined, ccy?: string) {
  if (v == null || !Number.isFinite(v)) return '—'
  try {
    if (ccy)
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: ccy,
      }).format(v as number)
  } catch {}
  return (v as number).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
const pctCls = (p?: number | null) =>
  Number(p) > 0
    ? 'text-green-600'
    : Number(p) < 0
    ? 'text-red-600'
    : 'text-gray-500'

const toPtsFromStatus = (s?: Advice) =>
  s === 'BUY' ? 2 : s === 'SELL' ? -2 : 0
const statusFromScore = (score: number): Advice =>
  score >= 66 ? 'BUY' : score <= 33 ? 'SELL' : 'HOLD'

export default function Sp500Page() {
  const symbols = useMemo(() => SP500.map((x) => x.symbol), [])

  // === 1) Quotes ===
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})
  useEffect(() => {
    let stop = false
    async function load() {
      const groups = chunk(symbols, CHUNK)
      const allQuotes: Record<string, Quote> = {}
      for (const g of groups) {
        if (stop) return
        const r = await fetch(`/api/quotes?symbols=${encodeURIComponent(g.join(','))}`, {
          cache: 'no-store',
        })
        if (r.ok) {
          const j: { quotes: Record<string, Quote> } = await r.json()
          Object.assign(allQuotes, j.quotes)
        }
        await sleep(80)
      }
      if (!stop) setQuotes(allQuotes)
    }
    load()
    const id = setInterval(load, 20000)
    return () => {
      stop = true
      clearInterval(id)
    }
  }, [symbols])

  // === 2) Snapshot indicators (identiek aan AEX) ===
  const { data: snap, error: snapErr } = useSWR<SnapResp>(
    'sp500-snapshot',
    async () => {
      const groups = chunk(symbols, CHUNK)
      const parts = await Promise.all(
        groups.map(async (group) => {
          const r = await fetch(
            `/api/indicators/snapshot-list?symbols=${encodeURIComponent(group.join(','))}`,
            { cache: 'no-store' }
          )
          if (!r.ok) return { items: [] as SnapItem[] }
          return r.json() as Promise<SnapResp>
        })
      )
      return { items: parts.flatMap((p) => p.items || []), updatedAt: Date.now() }
    },
    { refreshInterval: 30000, revalidateOnFocus: false }
  )
  const snapBySym = useMemo(() => {
    const m: Record<string, SnapItem> = {}
    snap?.items?.forEach((it) => {
      if (it?.symbol) m[it.symbol] = it
    })
    return m
  }, [snap])

  // === 3) Scoreberekening ===
  const scoreMap = useMemo(() => {
    const map: Record<string, number> = {}
    const toNorm = (p: number) => (p + 2) / 4
    const W_MA = 0.4,
      W_MACD = 0.3,
      W_RSI = 0.2,
      W_VOL = 0.1
    for (const sym of symbols) {
      const it = snapBySym[sym]
      if (!it) continue
      const pMA = toPtsFromStatus(it.ma?.status)
      const pMACD = toPtsFromStatus(it.macd?.status)
      const pRSI = toPtsFromStatus(it.rsi?.status)
      const pVOL = toPtsFromStatus(it.volume?.status)
      const agg =
        W_MA * toNorm(pMA) +
        W_MACD * toNorm(pMACD) +
        W_RSI * toNorm(pRSI) +
        W_VOL * toNorm(pVOL)
      map[sym] = Math.round(Math.max(0, Math.min(1, agg)) * 100)
    }
    return map
  }, [symbols, snapBySym])

  return (
    <>
      <Head>
        <title>S&amp;P 500 Tracker — SignalHub</title>
      </Head>
      <main className="min-h-screen">
        <section className="max-w-6xl mx-auto px-4 pt-16 pb-8">
          <h1 className="hero">S&amp;P 500 Tracker</h1>
        </section>

        <section className="max-w-6xl mx-auto px-4 pb-16">
          {snapErr && (
            <div className="mb-3 text-red-600 text-sm">
              Fout bij indicatoren: {String((snapErr as any)?.message || snapErr)}
            </div>
          )}

          <div className="table-card p-0 overflow-hidden">
            <table className="w-full text-[13px]">
              <thead className="bg-gray-50">
                <tr className="text-left text-gray-500">
                  <th className="px-3 py-3">#</th>
                  <th className="px-2 py-3">Aandeel</th>
                  <th className="px-3 py-3">Prijs</th>
                  <th className="px-3 py-3">24h</th>
                  <th className="px-3 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {SP500.map((row, i) => {
                  const q = quotes[row.symbol]
                  const price = fmtPrice(q?.regularMarketPrice, q?.currency || 'USD')
                  const chg = q?.regularMarketChange
                  const pct = q?.regularMarketChangePercent
                  const score = scoreMap[row.symbol]
                  return (
                    <tr key={row.symbol} className="hover:bg-gray-50 align-middle">
                      <td className="px-3 py-3 text-gray-500">{i + 1}</td>
                      <td className="px-2 py-3">
                        <Link
                          href={`/sp500/${encodeURIComponent(row.symbol)}`}
                          className="font-medium text-gray-900 hover:underline"
                        >
                          {row.name}
                        </Link>
                        <span className="text-gray-500 ml-1">({row.symbol})</span>
                      </td>
                      <td className="px-3 py-3 text-gray-900 whitespace-nowrap">{price}</td>
                      <td className={`px-3 py-3 whitespace-nowrap ${pctCls(pct)}`}>
                        {Number.isFinite(chg as number) && Number.isFinite(pct as number)
                          ? `${chg! >= 0 ? '+' : ''}${num(chg, 2)} (${pct! >= 0 ? '+' : ''}${num(pct, 2)}%)`
                          : '—'}
                      </td>
                      <td className="px-3 py-3">
                        <div className="origin-left scale-95">
                          {Number.isFinite(score as number) ? (
                            <ScoreBadge score={score as number} />
                          ) : (
                            <span className="badge badge-hold">HOLD · 50</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  )
}