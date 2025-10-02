// src/components/AdPopup.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react'

declare global {
  interface Window {
    adsbygoogle: any[]
  }
}

type Props = {
  initialDelayMs?: number
  reappearAfterMs?: number
  storageKey?: string
}

const DEFAULT_INITIAL_DELAY = 1500 // 1.5s na pageload
const DEFAULT_REAPPEAR = 180_000  // 3 minuten
const DEFAULT_STORAGE_KEY = 'adpopup:lastDismissedAt'

export default function AdPopup({
  initialDelayMs = DEFAULT_INITIAL_DELAY,
  reappearAfterMs = DEFAULT_REAPPEAR,
  storageKey = DEFAULT_STORAGE_KEY,
}: Props) {
  const [open, setOpen] = useState(false)
  const [renderKey, setRenderKey] = useState(0)
  const adRootRef = useRef<HTMLDivElement | null>(null)

  const canShow = useMemo(() => {
    if (typeof window === 'undefined') return false
    const ts = Number(localStorage.getItem(storageKey) || 0)
    const elapsed = Date.now() - ts
    return !ts || elapsed >= reappearAfterMs
  }, [storageKey, reappearAfterMs, renderKey])

  useEffect(() => {
    if (!canShow) return
    const t = setTimeout(() => setOpen(true), initialDelayMs)
    return () => clearTimeout(t)
  }, [canShow, initialDelayMs])

  useEffect(() => {
    if (open) return
    const iv = setInterval(() => {
      try {
        const ts = Number(localStorage.getItem(storageKey) || 0)
        if (!ts || Date.now() - ts >= reappearAfterMs) setOpen(true)
      } catch {}
    }, 10_000)
    return () => clearInterval(iv)
  }, [open, reappearAfterMs, storageKey])

  useEffect(() => {
    if (!open) return
    const el = adRootRef.current?.querySelector('ins.adsbygoogle') as any
    if (!el) return
    ;(window.adsbygoogle = window.adsbygoogle || []).push({})
  }, [open, renderKey])

  function close() {
    setOpen(false)
    try { localStorage.setItem(storageKey, String(Date.now())) } catch {}
    setRenderKey(k => k + 1)
  }

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-label="Sponsored"
      ref={adRootRef}
      className="fixed z-50 bottom-4 left-4 max-w-sm w-[360px] rounded-2xl bg-neutral-900/95 backdrop-blur border border-white/10 shadow-xl"
    >
      <div className="p-3 flex items-start gap-3">
        <div className="text-xs uppercase tracking-wide text-white/60 pt-1">Sponsored</div>
        <button
          onClick={close}
          aria-label="Sluiten"
          className="ml-auto text-white/60 hover:text-white transition"
          title="Sluiten"
        >
          ✕
        </button>
      </div>

      <div className="px-3 pb-3">
        {/* VERVANG data-ad-slot met jouw Ad Unit ID */}
        <ins
          key={renderKey}
          className="adsbygoogle block w-full"
          style={{ display: 'block' }}
          data-ad-client="ca-pub-4777751645956730"
          data-ad-slot="XXXXXXXXXX"
          data-ad-format="auto"
          data-full-width-responsive="true"
        />
      </div>
    </div>
  )
}