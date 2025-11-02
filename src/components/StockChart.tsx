// src/components/StockChart.tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import type { UTCTimestamp, CandlestickData, LineData } from 'lightweight-charts'
import { createChart } from 'lightweight-charts'

type Props = {
  symbol: string
  range?: '1d'|'5d'|'1mo'|'3mo'|'6mo'|'1y'|'2y'|'5y'|'10y'|'ytd'|'max'
  interval?: '1m'|'2m'|'5m'|'15m'|'30m'|'60m'|'90m'|'1h'|'1d'|'1wk'|'1mo'|'3mo'
  height?: number
  className?: string
}

/**
 * Lichtgewicht koersgrafiek (Yahoo, zonder API key).
 * - Compatibel met meerdere lightweight-charts versies (v3/v4/v5)
 * - Fallback naar line chart als OHLC onvolledig is
 * - Voorkomt :SYMBOL/undefined requests tot router.symbol er is
 */
export default function StockChart({
  symbol,
  range = '6mo',
  interval = '1d',
  height = 260,
  className = '',
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<any>(null)   // versie-agnostisch
  const seriesRef = useRef<any>(null)  // versie-agnostisch
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // URL alleen bouwen als er een geldige symbol is
  const url = useMemo(() => {
    const s = String(symbol || '').trim()
    if (!s || s === ':SYMBOL' || s === 'undefined') return null
    const base = 'https://query1.finance.yahoo.com/v8/finance/chart'
    const params = new URLSearchParams({
      range,
      interval,
      includePrePost: 'false',
      useYfid: 'true',
      corsDomain: 'finance.yahoo.com',
    })
    return `${base}/${encodeURIComponent(s)}?${params.toString()}`
  }, [symbol, range, interval])

  // Init chart + resize
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    if (!chartRef.current) {
      chartRef.current = createChart(el, {
        width: el.clientWidth || 600,
        height,
        // géén ColorType literal → geen TS/ColorType issues
        layout: { textColor: 'rgba(255,255,255,0.85)' },
        grid: {
          vertLines: { color: 'rgba(255,255,255,0.06)' },
          horzLines: { color: 'rgba(255,255,255,0.06)' },
        },
        rightPriceScale: { borderColor: 'rgba(255,255,255,0.12)' },
        timeScale: {
          borderColor: 'rgba(255,255,255,0.12)',
          timeVisible: ['1m','2m','5m','15m','30m','60m','90m','1h'].includes(interval),
          secondsVisible: false,
        },
        crosshair: { mode: 1 as any },
        handleScale: {
          axisPressedMouseMove: { time: true, price: true },
          pinch: true,
        },
      } as any)
    } else {
      chartRef.current.applyOptions({ height })
    }

    const chart: any = chartRef.current
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        if (e.contentRect?.width) {
          chart.applyOptions({ width: Math.floor(e.contentRect.width) })
          chart.timeScale().fitContent()
        }
      }
    })
    ro.observe(el)

    return () => { ro.disconnect() }
  }, [height, interval])

  // Data laden + tekenen
  useEffect(() => {
    if (!url) return  // wacht tot symbol/router klaar is

    let aborted = false
    const controller = new AbortController()

    async function run() {
      setLoading(true)
      setErr(null)
      try {
        const r = await fetch(url, { signal: controller.signal, cache: 'no-store' })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const j = await r.json()

        const result = j?.chart?.result?.[0]
        const error = j?.chart?.error
        if (error) throw new Error(String(error?.description || 'Yahoo error'))
        if (!result) throw new Error('Geen result uit Yahoo')

        const ts: number[] = result.timestamp || []
        const q = result.indicators?.quote?.[0] || {}
        const open = (q.open || []) as Array<number | null>
        const high = (q.high || []) as Array<number | null>
        const low  = (q.low  || []) as Array<number | null>
        const close= (q.close|| []) as Array<number | null>

        const haveOHLC = open.length && high.length && low.length && close.length

        const chart: any = chartRef.current
        if (!chart) return

        if (seriesRef.current) {
          chart.removeSeries?.(seriesRef.current)
          seriesRef.current = null
        }

        if (haveOHLC) {
          const data: CandlestickData[] = []
          for (let i = 0; i < ts.length; i++) {
            const o = open[i], h = high[i], l = low[i], c = close[i]
            if ([o,h,l,c].every(v => typeof v === 'number' && Number.isFinite(v as number))) {
              data.push({
                time: ts[i] as unknown as UTCTimestamp,
                open: o as number, high: h as number, low: l as number, close: c as number,
              })
            }
          }

          if (data.length >= 2) {
            let s: any
            if (typeof chart.addCandlestickSeries === 'function') {
              s = chart.addCandlestickSeries({
                upColor: '#16a34a',
                downColor: '#dc2626',
                wickUpColor: '#16a34a',
                wickDownColor: '#dc2626',
                borderVisible: false,
              })
            } else if (typeof chart.addSeries === 'function') {
              s = chart.addSeries({ type: 'Candlestick' }, {
                upColor: '#16a34a',
                downColor: '#dc2626',
                wickUpColor: '#16a34a',
                wickDownColor: '#dc2626',
                borderVisible: false,
              })
            } else {
              // ultieme fallback → line
              s = chart.addLineSeries ? chart.addLineSeries({ lineWidth: 2 }) : chart.addSeries({ type: 'Line' }, { lineWidth: 2 })
              const lineData: LineData[] = data.map(d => ({ time: d.time, value: d.close }))
              s.setData(lineData)
              seriesRef.current = s
              chart.timeScale().fitContent()
              return
            }
            s.setData(data)
            seriesRef.current = s
            chart.timeScale().fitContent()
          } else {
            // te weinig candles → line
            const s: any = chart.addLineSeries ? chart.addLineSeries({ lineWidth: 2 }) : chart.addSeries({ type: 'Line' }, { lineWidth: 2 })
            const lineData: LineData[] = ts
              .map((t, i) => (typeof close[i] === 'number'
                ? { time: t as unknown as UTCTimestamp, value: close[i] as number }
                : null))
              .filter(Boolean) as LineData[]
            s.setData(lineData)
            seriesRef.current = s
            chart.timeScale().fitContent()
          }
        } else {
          // alleen closes → line
          const s: any = chart.addLineSeries ? chart.addLineSeries({ lineWidth: 2 }) : chart.addSeries({ type: 'Line' }, { lineWidth: 2 })
          const lineData: LineData[] = ts
            .map((t, i) => (typeof close[i] === 'number'
              ? { time: t as unknown as UTCTimestamp, value: close[i] as number }
              : null))
            .filter(Boolean) as LineData[]
          if (lineData.length < 2) throw new Error('Onvoldoende datapoints voor grafiek')
          s.setData(lineData)
          seriesRef.current = s
          chart.timeScale().fitContent()
        }
      } catch (e: any) {
        if (!aborted) setErr(String(e?.message || e))
      } finally {
        if (!aborted) setLoading(false)
      }
    }

    run()
    return () => { aborted = true; controller.abort() }
  }, [url, symbol, range, interval])

  return (
    <div className={className}>
      <div
        ref={containerRef}
        className="w-full"
        style={{ height, minHeight: height }}
      />
      <div className="mt-1 text-[11px] text-white/50 select-none">
        {loading ? 'Laden…' : err ? `Grafiek fout: ${err}` : 'Data: Yahoo Finance'}
      </div>
    </div>
  )
}