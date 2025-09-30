// src/pages/etfs/index.tsx
import Head from 'next/head'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { ETFS } from '@/lib/etfs'

type Advice = 'BUY' | 'HOLD' | 'SELL'
type MaCrossResp = { symbol: string; ma50: number | null; ma200: number | null; status: Advice; points: number }
type RsiResp    = { symbol: string; period: number; rsi: number | null; status: Advice; points: number }
type MacdResp   = { symbol: string; fast: number; slow: number; signalPeriod: number; macd: number | null; signal: number | null; hist: number | null; status: Advice; points: number }
type Vol20Resp  = { symbol: string; period: number; volume: number | null; avg20: number | null; ratio: number | null; status: Advice; points: number }

type Row = {
  symbol: string
  name: string
  score: number
  advice: Advice
  loading?: boolean
  err?: string | null
}

function toPts(status?: Advice, pts?: number | null) {
  if (Number.isFinite(pts as number)) return Math.max(-2, Math.min(2, Number(pts)))
  if (status === 'BUY') return  2
  if (status === 'SELL') return -2
  return 0
}
function statusFromScore(score: number): Advice {
  if (score >= 66) return 'BUY'
  if (score <= 33) return 'SELL'
  return 'HOLD'
}
function computeScore(ma?: MaCrossResp|null, rsi?: RsiResp|null, macd?: MacdResp|null, vol?: Vol20Resp|null) {
  const W_MA=0.40, W_MACD=0.30, W_RSI=0.20, W_VOL=0.10
  const nMA   = (toPts(ma?.status,   ma?.points)   + 2)/4
  const nMACD = (toPts(macd?.status, macd?.points) + 2)/4
  const nRSI  = (toPts(rsi?.status,  rsi?.points)  + 2)/4
  const nVOL  = (toPts(vol?.status,  vol?.points)  + 2)/4
  return Math.round((W_MA*nMA + W_MACD*nMACD + W_RSI*nRSI + W_VOL*nVOL) * 100)
}

export default function EtfList() {
  const base = useMemo<Row[]>(() => ETFS.map(e => ({
    symbol: e.symbol, name: e.name, score: 50, advice: 'HOLD', loading: true, err: null
  })), [])

  const [rows, setRows] = useState<Row[]>(base)

  useEffect(() => {
    let aborted = false
    ;(async () => {
      // fetch indicatoren per ETF (parallel, maar met batches om burst te beperken)
      const BATCH = 6
      for (let i = 0; i < ETFS.length; i += BATCH) {
        const chunk = ETFS.slice(i, i + BATCH)
        await Promise.all(chunk.map(async (etf) => {
          try {
            const [rMa, rRsi, rMacd, rVol] = await Promise.all([
              fetch(`/api/indicators/ma-cross/${encodeURIComponent(etf.symbol)}`, { cache: 'no-store' }),
              fetch(`/api/indicators/rsi/${encodeURIComponent(etf.symbol)}?period=14`, { cache: 'no-store' }),
              fetch(`/api/indicators/macd/${encodeURIComponent(etf.symbol)}?fast=12&slow=26&signal=9`, { cache: 'no-store' }),
              fetch(`/api/indicators/vol20/${encodeURIComponent(etf.symbol)}?period=20`, { cache: 'no-store' }),
            ])
            if (!rMa.ok || !rRsi.ok || !rMacd.ok || !rVol.ok) {
              throw new Error(`HTTP ${rMa.status}/${rRsi.status}/${rMacd.status}/${rVol.status}`)
            }
            const [jMa, jRsi, jMacd, jVol] = await Promise.all([
              rMa.json(), rRsi.json(), rMacd.json(), rVol.json()
            ]) as [MaCrossResp, RsiResp, MacdResp, Vol20Resp]

            const score = computeScore(jMa, jRsi, jMacd, jVol)
            const advice = statusFromScore(score)

            if (!aborted) {
              setRows(prev => prev.map(r => r.symbol === etf.symbol
                ? { ...r, score, advice, loading: false, err: null }
                : r
              ))
            }
          } catch (e: any) {
            if (!aborted) {
              setRows(prev => prev.map(r => r.symbol === etf.symbol
                ? { ...r, score: 50, advice: 'HOLD', loading: false, err: String(e?.message || e) }
                : r
              ))
            }
          }
        }))
        if (aborted) break
        // kleine pauze tussen batches
        await new Promise(r => setTimeout(r, 120))
      }
    })()
    return () => { aborted = true }
  }, [])

  const sorted = useMemo(() => {
    // sorteer op score desc, dan alfabetisch
    return [...rows].sort((a,b) => (b.score - a.score) || a.symbol.localeCompare(b.symbol))
  }, [rows])

  return (
    <>
      <Head><title>Top ETFs — SignalHub</title></Head>
      <main className="min-h-screen">
        <section className="max-w-6xl mx-auto px-4 pt-10 pb-6">
          <h1 className="hero">Top ETFs</h1>
          <p className="sub">20 grootste ETF’s met technische indicaties en samengestelde score.</p>
        </section>

        <section className="max-w-6xl mx-auto px-4 pb-14">
          <div className="table-card overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-white/70">
                <tr>
                  <th className="text-left py-2 px-2">#</th>
                  <th className="text-left py-2 px-2">ETF</th>
                  <th className="text-left py-2 px-2">Symb.</th>
                  <th className="text-right py-2 px-2">Advice</th>
                  <th className="text-right py-2 px-2">Score</th>
                  <th className="text-right py-2 px-2">Details</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, i) => {
                  const badgeCls =
                    r.advice === 'BUY' ? 'badge-buy' : r.advice === 'SELL' ? 'badge-sell' : 'badge-hold'
                  return (
                    <tr key={r.symbol} className="border-t border-white/5 hover:bg-white/5">
                      <td className="py-3 px-2">{i + 1}</td>
                      <td className="py-3 px-2">
                        <Link href={`/etfs/${encodeURIComponent(r.symbol)}`} className="link font-semibold">
                          {r.name}
                        </Link>
                        {r.err ? <div className="text-xs text-red-300">Error: {r.err}</div> : null}
                      </td>
                      <td className="py-3 px-2">{r.symbol}</td>
                      <td className="py-3 px-2 text-right">
                        {r.loading ? '…' : <span className={badgeCls}>{r.advice}</span>}
                      </td>
                      <td className="py-3 px-2 text-right">{r.loading ? '…' : r.score}</td>
                      <td className="py-3 px-2 text-right">
                        <Link href={`/etfs/${encodeURIComponent(r.symbol)}`} className="btn btn-sm">Open</Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex gap-2">
            <Link href="/" className="btn">← Terug naar homepage</Link>
          </div>
        </section>
      </main>
    </>
  )
}