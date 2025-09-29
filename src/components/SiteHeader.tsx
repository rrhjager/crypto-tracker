// src/components/SiteHeader.tsx
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/router'

export default function SiteHeader() {
  const [open, setOpen] = useState(false)
  const [stockOpen, setStockOpen] = useState(false)
  const [intelOpen, setIntelOpen] = useState(false)

  const stockRef = useRef<HTMLDivElement>(null)
  const intelRef = useRef<HTMLDivElement>(null)

  const router = useRouter()

  // Sluit desktop dropdowns bij klik buiten
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node
      if (stockRef.current && !stockRef.current.contains(t)) setStockOpen(false)
      if (intelRef.current && !intelRef.current.contains(t)) setIntelOpen(false)
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [])

  // Sluit het mobiele menu bij routechanges en met Escape
  useEffect(() => {
    const close = () => setOpen(false)
    router.events.on('routeChangeComplete', close)
    router.events.on('hashChangeComplete', close)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => {
      router.events.off('routeChangeComplete', close)
      router.events.off('hashChangeComplete', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [router.events])

  // Body scroll lock wanneer drawer open is
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = open ? 'hidden' : prev || ''
    return () => { document.body.style.overflow = prev }
  }, [open])

  const onMobileLinkClick = () => setOpen(false)

  const rainbow =
    'group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-[linear-gradient(90deg,#ff004c,#ff8a00,#ffd300,#00e472,#00c3ff,#7a00ff,#ff004c)]'

  return (
    <header className="bg-ink/80 backdrop-blur supports-[backdrop-filter]:bg-ink/60 border-b border-white/10 sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Home / Logo */}
        <Link href="/" className="group font-semibold tracking-tight" onClick={() => setOpen(false)}>
          <span className={`text-black transition-all duration-300 ${rainbow}`}>
            SignalHub
          </span>
        </Link>

        {/* Desktop menu */}
        <nav className="hidden md:flex items-center gap-6">
          <Link href="/crypto" className="group text-white/80 hover:text-white transition">
            <span className={`transition-colors ${rainbow}`}>Crypto tracker</span>
          </Link>

          {/* Stock tracker */}
          <div className="relative" ref={stockRef}>
            <button
              className="group text-white/80 hover:text-white transition inline-flex items-center gap-1"
              onClick={() => { setStockOpen(v => !v); setIntelOpen(false) }}
              onMouseEnter={() => { setStockOpen(true); setIntelOpen(false) }}
              aria-haspopup="true"
              aria-expanded={stockOpen}
            >
              <span className={rainbow}>Stock tracker</span>
              <svg width="14" height="14" viewBox="0 0 24 24" className="opacity-70"><path fill="currentColor" d="M7 10l5 5 5-5z"/></svg>
            </button>
            {stockOpen && (
              <div
                onMouseLeave={() => setStockOpen(false)}
                className="absolute right-0 mt-2 w-48 rounded-2xl border border-white/10 bg-ink shadow-lg p-1"
              >
                {[
                  { href: '/stocks',     label: 'AEX' },
                  { href: '/sp500',      label: 'S&P 500' },
                  { href: '/nasdaq',     label: 'NASDAQ' },
                  { href: '/dowjones',   label: 'Dow Jones' },
                  { href: '/dax',        label: 'DAX' },
                  { href: '/ftse100',    label: 'FTSE 100' },
                  { href: '/nikkei225',  label: 'Nikkei 225' },
                  { href: '/hangseng',   label: 'Hang Seng' },
                  { href: '/sensex',     label: 'Sensex' },
                ].map(it => (
                  <Link key={it.href} href={it.href} className="group block px-3 py-2 rounded-xl hover:bg-white/10">
                    <span className={`text-white/90 transition-colors group-hover:font-semibold ${rainbow}`}>{it.label}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Market intel */}
          <div className="relative" ref={intelRef}>
            <button
              className="group text-white/80 hover:text-white transition inline-flex items-center gap-1"
              onClick={() => { setIntelOpen(v => !v); setStockOpen(false) }}
              onMouseEnter={() => { setIntelOpen(true); setStockOpen(false) }}
              aria-haspopup="true"
              aria-expanded={intelOpen}
            >
              <span className={rainbow}>Market intel</span>
              <svg width="14" height="14" viewBox="0 0 24 24" className="opacity-70"><path fill="currentColor" d="M7 10l5 5 5-5z"/></svg>
            </button>
            {intelOpen && (
              <div
                onMouseLeave={() => setIntelOpen(false)}
                className="absolute right-0 mt-2 w-56 rounded-2xl border border-white/10 bg-ink shadow-lg p-1"
              >
                {[
                  { href: '/intel',            label: 'Congress Trading' },
                  { href: '/intel/hedgefunds', label: 'Hedge fund holdings' },
                  { href: '/intel/macro',      label: 'Macro calendar' },
                  { href: '/intel/sectors',    label: 'Sector performance' },
                ].map(it => (
                  <Link key={it.href} href={it.href} className="group block px-3 py-2 rounded-xl hover:bg-white/10">
                    <span className={`text-white/90 transition-colors group-hover:font-semibold ${rainbow}`}>{it.label}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <Link href="/about" className="group text-white/80 hover:text-white transition">
            <span className={`transition-colors ${rainbow}`}>About us</span>
          </Link>
        </nav>

        {/* Mobile hamburger */}
        <button
          className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-xl border border-white/15 text-white/90"
          onClick={() => setOpen(v => !v)}
          aria-label="Menu"
          aria-expanded={open}
        >
          {!open ? (
            <svg width="22" height="22" viewBox="0 0 24 24"><path fill="currentColor" d="M3 6h18v2H3V6m0 5h18v2H3v-2m0 5h18v2H3v-2Z"/></svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24"><path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z"/></svg>
          )}
        </button>
      </div>

      {/* Mobile overlay + drawer (full-screen) */}
      {open && (
        <div className="md:hidden">
          {/* Overlay (tap to close) */}
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          {/* Drawer */}
          <div className="fixed inset-x-0 top-14 bottom-0 z-50 overflow-y-auto bg-ink border-t border-white/10">
            <nav className="mx-auto max-w-6xl px-4 py-4 flex flex-col gap-2">
              <Link href="/crypto" className="group rounded-xl px-4 py-3 hover:bg-white/10 text-base" onClick={onMobileLinkClick}>
                <span className={rainbow}>Crypto tracker</span>
              </Link>

              <div className="rounded-xl px-3 py-2">
                <div className="text-white/70 mb-2 px-1">Stock tracker</div>
                {[
                  { href: '/stocks',     label: 'AEX' },
                  { href: '/sp500',      label: 'S&P 500' },
                  { href: '/nasdaq',     label: 'NASDAQ' },
                  { href: '/dowjones',   label: 'Dow Jones' },
                  { href: '/dax',        label: 'DAX' },
                  { href: '/ftse100',    label: 'FTSE 100' },
                  { href: '/nikkei225',  label: 'Nikkei 225' },
                  { href: '/hangseng',   label: 'Hang Seng' },
                  { href: '/sensex',     label: 'Sensex' },
                ].map(it => (
                  <Link
                    key={it.href}
                    href={it.href}
                    className="group block rounded-lg px-4 py-3 text-base hover:bg-white/10"
                    onClick={onMobileLinkClick}
                  >
                    <span className={`transition-colors group-hover:font-semibold ${rainbow}`}>{it.label}</span>
                  </Link>
                ))}
              </div>

              <div className="rounded-xl px-3 py-2">
                <div className="text-white/70 mb-2 px-1">Market intel</div>
                {[
                  { href: '/intel',            label: 'Congress Trading' },
                  { href: '/intel/hedgefunds', label: 'Hedge fund holdings' },
                  { href: '/intel/macro',      label: 'Macro calendar' },
                  { href: '/intel/sectors',    label: 'Sector performance' },
                ].map(it => (
                  <Link
                    key={it.href}
                    href={it.href}
                    className="group block rounded-lg px-4 py-3 text-base hover:bg-white/10"
                    onClick={onMobileLinkClick}
                  >
                    <span className={`transition-colors group-hover:font-semibold ${rainbow}`}>{it.label}</span>
                  </Link>
                ))}
              </div>

              <Link href="/about" className="group rounded-xl px-4 py-3 text-base hover:bg-white/10" onClick={onMobileLinkClick}>
                <span className={rainbow}>About us</span>
              </Link>
            </nav>
          </div>
        </div>
      )}
    </header>
  )
}