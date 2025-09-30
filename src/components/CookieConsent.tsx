// src/components/CookieConsent.tsx
import { useEffect, useState } from 'react'
import { getConsent, setConsent } from '@/lib/consent'

type View = 'bar' | 'panel'

export default function CookieConsent() {
  const [visible, setVisible] = useState(false)
  const [view, setView] = useState<View>('bar')
  const [analytics, setAnalytics] = useState(false)
  const [marketing, setMarketing] = useState(false)

  // toon alleen als er nog geen keuze is
  useEffect(() => {
    const c = getConsent()
    if (!c) setVisible(true)
  }, [])

  // luister naar “open” event (voor “Cookie settings” in footer)
  useEffect(() => {
    function onOpen() {
      const c = getConsent()
      setAnalytics(!!c?.analytics)
      setMarketing(!!c?.marketing)
      setView('panel')
      setVisible(true)
    }
    window.addEventListener('cookie-consent-open' as any, onOpen)
    return () => window.removeEventListener('cookie-consent-open' as any, onOpen)
  }, [])

  if (!visible) return null

  const acceptAll = () => {
    setConsent({ necessary: true, analytics: true, marketing: true })
    setVisible(false)
  }
  const declineAll = () => {
    setConsent({ necessary: true, analytics: false, marketing: false })
    setVisible(false)
  }
  const saveSettings = () => {
    setConsent({ necessary: true, analytics, marketing })
    setVisible(false)
  }

  return (
    <div className="fixed right-3 bottom-3 z-[70]">
      {/* container met shadow en afgeronde hoeken, smal en “omhoog” */}
      <div className="w-[320px] max-w-[92vw] rounded-2xl border bg-white shadow-xl text-gray-900 overflow-hidden ring-1 ring-black/5"
           style={{ transformOrigin: 'bottom right' }}>
        {view === 'bar' ? (
          <div className="p-3">
            <div className="text-sm font-semibold mb-1">Cookies</div>
            <p className="text-xs text-gray-600 mb-3">
              We gebruiken noodzakelijke cookies en (optioneel) analytics/marketing. Kies “Accept” of “Decline”, of pas instellingen aan.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setView('panel')}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-gray-300 hover:bg-gray-50"
              >
                Settings
              </button>
              <button
                onClick={declineAll}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-gray-300 hover:bg-gray-50"
              >
                Decline
              </button>
              <button
                onClick={acceptAll}
                className="px-3 py-1.5 text-xs rounded-lg bg-gray-900 text-white hover:bg-black"
              >
                Accept
              </button>
            </div>
          </div>
        ) : (
          <div className="p-3">
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-sm font-semibold">Cookie settings</div>
              <button
                onClick={() => setVisible(false)}
                className="w-7 h-7 inline-flex items-center justify-center rounded-lg border border-gray-300 hover:bg-gray-50"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-gray-600 mb-3">
              Noodzakelijke cookies staan altijd aan. Pas optionele categorieën hieronder aan.
            </p>

            <div className="space-y-2 mb-3">
              <label className="flex items-start gap-2">
                <input type="checkbox" checked disabled className="mt-0.5" />
                <span className="text-xs">
                  <span className="font-medium">Necessary</span><br />
                  <span className="text-gray-600">Voor basisfunctionaliteit (bijv. je keuze opslaan).</span>
                </span>
              </label>

              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={analytics}
                  onChange={(e) => setAnalytics(e.target.checked)}
                  className="mt-0.5"
                />
                <span className="text-xs">
                  <span className="font-medium">Analytics</span><br />
                  <span className="text-gray-600">Anonieme statistieken om de site te verbeteren.</span>
                </span>
              </label>

              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={marketing}
                  onChange={(e) => setMarketing(e.target.checked)}
                  className="mt-0.5"
                />
                <span className="text-xs">
                  <span className="font-medium">Marketing</span><br />
                  <span className="text-gray-600">Advertentie-/remarketingtags (indien gebruikt).</span>
                </span>
              </label>
            </div>

            <div className="flex items-center justify-between">
              <button
                onClick={() => setView('bar')}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-gray-300 hover:bg-gray-50"
              >
                Back
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={declineAll}
                  className="px-2.5 py-1.5 text-xs rounded-lg border border-gray-300 hover:bg-gray-50"
                >
                  Decline all
                </button>
                <button
                  onClick={acceptAll}
                  className="px-2.5 py-1.5 text-xs rounded-lg bg-gray-900 text-white hover:bg-black"
                >
                  Accept all
                </button>
                <button
                  onClick={saveSettings}
                  className="px-2.5 py-1.5 text-xs rounded-lg border border-gray-900 text-gray-900 hover:bg-gray-50"
                >
                  Save
                </button>
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  )
}