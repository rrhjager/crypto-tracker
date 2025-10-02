// src/components/AdPopup.tsx
import { useEffect, useRef, useState } from 'react'

declare global {
  interface Window {
    adsbygoogle?: any[];
  }
}

const LOCAL_KEY = 'adpopup:nextShowAt'  // timestamp wanneer popup weer mag tonen
const SHOW_AGAIN_MS = 3 * 60 * 1000     // 3 minuten
const FIRST_SHOW_DELAY = 10 * 1000      // eerste keer na 10s

export default function AdPopup() {
  const [open, setOpen] = useState(false)
  const pushedRef = useRef(false) // voorkom dubbele adsbygoogle.push()
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Bepaal wanneer we moeten tonen
  useEffect(() => {
    let timer: any
    let poll: any

    const getNextShowAt = () => {
      const raw = localStorage.getItem(LOCAL_KEY)
      const ts = raw ? Number(raw) : NaN
      return Number.isFinite(ts) ? ts : 0
    }

    const scheduleFirst = () => {
      // Eerste keer na FIRST_SHOW_DELAY, tenzij er een toekomstige blokkade staat
      const nextAt = getNextShowAt()
      if (Date.now() >= nextAt) {
        timer = setTimeout(() => setOpen(true), FIRST_SHOW_DELAY)
      } else {
        // Poll elke 5s tot we weer mogen tonen
        poll = setInterval(() => {
          if (Date.now() >= getNextShowAt()) {
            setOpen(true)
            clearInterval(poll)
          }
        }, 5000)
      }
    }

    scheduleFirst()
    return () => { clearTimeout(timer); clearInterval(poll) }
  }, [])

  // Wanneer open → initialiseer de advertentie (1x per open-cyclus)
  useEffect(() => {
    if (!open) return
    // reset zodat we opnieuw kunnen pushen als de popup later weer opengaat
    pushedRef.current = false

    // kleine delay zodat <ins> in de DOM staat
    const t = setTimeout(() => {
      try {
        if (!pushedRef.current) {
          (window.adsbygoogle = window.adsbygoogle || []).push({})
          pushedRef.current = true
        }
      } catch {}
    }, 100)

    return () => clearTimeout(t)
  }, [open])

  const handleClose = () => {
    setOpen(false)
    // plan volgende toonmoment over 3 minuten — werkt ook over pagina-navigaties heen
    try {
      localStorage.setItem(LOCAL_KEY, String(Date.now() + SHOW_AGAIN_MS))
    } catch {}
  }

  if (!open) return null

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-8 z-50">
      <div
        ref={containerRef}
        className="bg-white/95 backdrop-blur-md shadow-xl rounded-2xl p-4 max-w-md mx-auto text-black ring-1 ring-black/10"
      >
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <div className="text-sm font-semibold mb-2">SignalHub — Partner</div>

            {/* Handmatige AdSense unit (responsive) */}
            <ins
              className="adsbygoogle"
              style={{ display: 'block' }}
              data-ad-client="ca-pub-4777751645956730"
              data-ad-slot="REPLACE_WITH_YOUR_SLOT_ID"  // ← maak in AdSense een Display-ad unit en vul de slot-id in
              data-ad-format="auto"
              data-full-width-responsive="true"
            />
          </div>

          <button
            onClick={handleClose}
            aria-label="Close"
            className="shrink-0 rounded-md px-2 py-1 text-gray-600 hover:text-black hover:bg-black/5"
            title="Sluiten"
          >
            ✕
          </button>
        </div>

        {/* subtiele footer */}
        <div className="mt-2 text-xs text-gray-600">
          Advertentie — helpt SignalHub gratis te houden.
        </div>
      </div>
    </div>
  )
}