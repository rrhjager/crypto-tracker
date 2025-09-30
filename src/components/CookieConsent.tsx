// src/components/CookieConsent.tsx
import React, { useEffect, useState } from 'react'

type Prefs = {
  necessary: true
  analytics: boolean
  marketing: boolean
}
const LS_KEY = 'cookie:prefs:v1'

function readPrefs(): Prefs | null {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) as Prefs : null
  } catch { return null }
}
function savePrefs(p: Prefs) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(p)) } catch {}
  // Eventueel: hier analytics initialiseren op basis van p.analytics / p.marketing
}

export default function CookieConsent() {
  const [open, setOpen] = useState(false)
  const [showPanel, setShowPanel] = useState(false)
  const [prefs, setPrefs] = useState<Prefs>({ necessary: true, analytics: false, marketing: false })

  useEffect(() => {
    const existing = readPrefs()
    if (!existing) setOpen(true)
    else setPrefs(existing)

    const onOpen = () => { setOpen(true); setShowPanel(true) }
    window.addEventListener('cookie:open', onOpen)
    return () => window.removeEventListener('cookie:open', onOpen)
  }, [])

  function acceptAll() {
    const p: Prefs = { necessary: true, analytics: true, marketing: true }
    savePrefs(p)
    setPrefs(p)
    setOpen(false)
    setShowPanel(false)
  }

  function declineAll() {
    const p: Prefs = { necessary: true, analytics: false, marketing: false }
    savePrefs(p)
    setPrefs(p)
    setOpen(false)
    setShowPanel(false)
  }

  function saveCurrent() {
    savePrefs(prefs)
    setOpen(false)
    setShowPanel(false)
  }

  if (!open) return null

  return (
    <div className="fixed z-[10000] bottom-4 right-4">
      {/* Card */}
      <div className="w-[320px] sm:w-[360px] rounded-2xl border shadow-xl bg-white text-gray-900">
        <div className="p-4">
          <div className="font-semibold mb-1">Cookies</div>
          <p className="text-sm text-gray-600">
            We gebruiken noodzakelijke cookies en (optioneel) analytics/marketing.
            Kies “Accept” of “Decline”, of pas instellingen aan.
          </p>

          {/* Inline settings toggle */}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowPanel(v => !v)}
              className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 bg-gray-100 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400"
            >
              Settings
            </button>

            <button
              type="button"
              onClick={declineAll}
              className="px-3 py-1.5 rounded-lg text-sm bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400"
            >
              Decline
            </button>

            <button
              type="button"
              onClick={acceptAll}
              className="ml-auto px-3 py-1.5 rounded-lg text-sm bg-blue-600 !text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Accept
            </button>
          </div>

          {/* Settings panel */}
          {showPanel && (
            <div className="mt-3 border-t pt-3 space-y-2">
              <label className="flex items-center justify-between text-sm">
                <span className="text-gray-700">Necessary</span>
                <input type="checkbox" checked readOnly className="h-4 w-4 accent-gray-500" />
              </label>
              <label className="flex items-center justify-between text-sm">
                <span className="text-gray-700">Analytics</span>
                <input
                  type="checkbox"
                  checked={prefs.analytics}
                  onChange={e => setPrefs(prev => ({ ...prev, analytics: e.target.checked }))}
                  className="h-4 w-4 accent-blue-600"
                />
              </label>
              <label className="flex items-center justify-between text-sm">
                <span className="text-gray-700">Marketing</span>
                <input
                  type="checkbox"
                  checked={prefs.marketing}
                  onChange={e => setPrefs(prev => ({ ...prev, marketing: e.target.checked }))}
                  className="h-4 w-4 accent-blue-600"
                />
              </label>

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={saveCurrent}
                  className="px-3 py-1.5 rounded-lg text-sm bg-blue-600 !text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setShowPanel(false)}
                  className="px-3 py-1.5 rounded-lg text-sm bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Dark-mode override (optioneel) */}
      <style jsx>{`
        @media (prefers-color-scheme: dark) {
          .dark .cookie-card { background: #111827; color: #e5e7eb; }
        }
      `}</style>
    </div>
  )
}