// src/components/StockChart.tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { createChart } from 'lightweight-charts'
import type { UTCTimestamp, LineData } from 'lightweight-charts'

type Props = {
  symbol: string
  height?: number
  className?: string
}

export default function StockChart({ symbol, height = 260, className = '' }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<any>(null)
  const seriesRef = useRef<any>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const url = useMemo(() => {
    const s = String(symbol || '').trim().toLowerCase()
    if (!s || s === ':symbol' || s === 'undefined') return null
    // Stooq CSV endpoint
    return `https://stooq.com/q/d/l/?s=${s}&i=d`
  }, [symbol])

  // Init chart
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    if (!chartRef.current) {
      chartRef.current = createChart(el, {
        width: el.clientWidth || 600,
        height,
        layout: { textColor: 'rgba(255,255,255,0.85)' },
        grid: {
          vertLines: { color: 'rgba(255,255,255,0.06)' },
          horzLines: { color: 'rgba(255,255,255,0.06)' },
        },
        rightPriceScale: { borderColor: 'rgba(255,255,255,0.12)' },
        timeScale: { borderColor: 'rgba(255,255,255,0.12)' },
      } as any)
    } else {
      chartRef.current.applyOptions({ height })
    }
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        chartRef.current?.applyOptions({ width: Math.floor(e.contentRect.width) })
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [height])

  // Load data
  useEffect(() => {
    if (!url) return
    let aborted = false
    const controller = new AbortController()

    async function load() {
      setLoading(true)
      setErr(null)
      try {
        const r = await fetch(url, { signal: controller.signal })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const text = await r.text()
        const rows = text.trim().split('\n').slice(1) // skip header
        const data: LineData[] = []
        for (const row of rows) {
          const [date, open, high, low, close] = row.split(',')
          const t = new Date(date).getTime() / 1000 as UTCTimestamp
          const c = parseFloat(close)
          if (Number.isFinite(c)) data.push({ time: t, value: c })
        }
        if (!chartRef.current) return
        if (seriesRef.current) chartRef.current.removeSeries(seriesRef.current)
        const line = chartRef.current.addLineSeries({ lineWidth: 2 })
        line.setData(data)
        seriesRef.current = line
        chartRef.current.timeScale().fitContent()
      } catch (e: any) {
        if (!aborted) setErr(String(e?.message || e))
      } finally {
        if (!aborted) setLoading(false)
      }
    }

    load()
    return () => { aborted = true; controller.abort() }
  }, [url])

  return (
    <div className={className}>
      <div ref={containerRef} className="w-full" style={{ height, minHeight: height }} />
      <div className="mt-1 text-[11px] text-white/50 select-none">
        {loading ? 'Laden…' : err ? `Grafiek fout: ${err}` : 'Data: stooq.com'}
      </div>
    </div>
  )
}