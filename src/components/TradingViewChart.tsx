import { useEffect, useMemo, useRef } from 'react'

// Typing voor de globale TV lib
declare global {
  interface Window {
    TradingView?: any
  }
}

type Props = {
  tvSymbol: string // bv. "BINANCE:BTCUSDT"
  height?: number | string
  theme?: 'light' | 'dark'
  interval?: '1'|'3'|'5'|'15'|'30'|'60'|'120'|'240'|'D'|'W'|'M'
  locale?: string  // bv 'nl_NL'
}

export default function TradingViewChart({
  tvSymbol,
  height = 420,
  theme = 'dark',
  interval = 'D',
  locale = 'nl_NL',
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Unieke container id voor meerdere charts op één pagina
  const containerId = useMemo(
    () => `tv_container_${Math.random().toString(36).slice(2)}`,
    []
  )

  useEffect(() => {
    let cancelled = false

    const mountWidget = () => {
      if (cancelled) return
      if (!window.TradingView) return

      // Zorg dat de container bestaat
      const el = document.getElementById(containerId)
      if (!el) return

      // Init widget
      /* eslint-disable no-new */
      new window.TradingView.widget({
        container_id: containerId,
        symbol: tvSymbol,           // "EXCHANGE:PAIR"
        interval,                   // 'D' = daily
        theme,                      // 'light' | 'dark'
        locale,                     // 'nl_NL'
        timezone: 'Etc/UTC',
        autosize: true,             // past zich aan container aan
        withdateranges: true,
        allow_symbol_change: false,
        hide_side_toolbar: false,
        hide_top_toolbar: false,
        studies: [],
        style: '1',                 // standaard candles
        details: false,
        hotlist: false,
        calendar: false,
        // Je kunt hieronder opties toevoegen/uitzetten naar smaak
      })
    }

    const ensureTvScript = () =>
      new Promise<void>((resolve, reject) => {
        if (window.TradingView) {
          resolve()
          return
        }
        const existing = document.querySelector<HTMLScriptElement>('script[src="https://s3.tradingview.com/tv.js"]')
        if (existing) {
          existing.addEventListener('load', () => resolve())
          existing.addEventListener('error', () => reject(new Error('tv.js load error')))
          return
        }
        const s = document.createElement('script')
        s.src = 'https://s3.tradingview.com/tv.js'
        s.async = true
        s.onload = () => resolve()
        s.onerror = () => reject(new Error('tv.js load error'))
        document.head.appendChild(s)
      })

    ensureTvScript()
      .then(() => mountWidget())
      .catch(() => {
        // fail-silent; je kunt hier eventueel een fallback UI tonen
      })

    return () => { cancelled = true }
  }, [containerId, tvSymbol, theme, interval, locale])

  return (
    <div className="table-card p-0 overflow-hidden">
      <div
        id={containerId}
        ref={containerRef}
        style={{ width: '100%', height: typeof height === 'number' ? `${height}px` : height }}
      />
    </div>
  )
}