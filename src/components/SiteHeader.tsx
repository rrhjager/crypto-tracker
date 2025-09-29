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

  // Close dropdowns on outside click (desktop)
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node
      if (stockRef.current && !stockRef.current.contains(t)) setStockOpen(false)
      if (intelRef.current && !intelRef.current.contains(t)) setIntelOpen(false)
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [])

  // Close mobile drawer on route change
  useEffect(() => {
    const close = () => setOpen(false)
    router.events.on('routeChangeComplete', close)
    return () => router.events.off('routeChangeComplete', close)
  }, [router.events])

  // Close on ESC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        setStockOpen(false)
        setIntelOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const rainbow =
    'group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-[linear-gradient(90deg,#ff004c,#ff8a00,#ffd300,#00e472,#00c3ff,#7a00ff,#ff004c)]'

  return (
    // Inline fontSize enforces 16px regardless of any page-level downsizing
    <header
      className="!text-[16px] md:!text-[16px] bg-ink/80 backdrop-blur supports-[backdrop-filter]:bg-ink/60 border-b border-white/10 sticky top-0 z-50"
      style={{ fontSize: 16, lineHeight: 1.2 }}
    >
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Home / Logo */}
        <Link href="/" className="group font-semibold tracking-tight">
          <span className={`!text-[18px] leading-none text-black transition-all duration-300 ${rainbow}`}>
            SignalHub
          </span>
        </Link>

        {/* Desktop menu */}
        <nav className="hidden md:flex items-center gap-6 !text-[15px]">
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
          className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-xl border border-white/15"
          onClick={() => setOpen(v => !v)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="mobile-drawer"
        >
          {open ? (
            <svg width="22" height="22" viewBox="0 0 24 24"><path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z"/></svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24"><path fill="currentColor" d="M3 6h18v2H3V6m0 5h18v2H3v-2m0 5h18v2H3v-2Z"/></svg>
          )}
        </button>
      </div>

      {/* Mobile drawer */}
      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-[1px]"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          {/* Panel — inline fontSize to prevent shrinking */}
          <div
            id="mobile-drawer"
            className="fixed inset-y-0 right-0 w-[85%] max-w-[380px] bg-ink border-l border-white/10 z-[60] !text-[16px]"
            style={{ fontSize: 16, lineHeight: 1.2 }}
            role="dialog"
            aria-modal="true"
          >
            <nav className="max-w-6xl mx-auto px-4 py-4 flex flex-col gap-2">
              <Link href="/crypto" className="group rounded-xl px-3 py-2 hover:bg-white/10" onClick={() => setOpen(false)}>
                <span className={rainbow}>Crypto tracker</span>
              </Link>

              <div className="rounded-xl px-3 py-2 hover:bg-white/10">
                <div className="text-white/70 mb-2">Stock tracker</div>
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
                    className="group block rounded-lg px-3 py-2 hover:bg-white/10"
                    onClick={() => setOpen(false)}
                  >
                    <span className={`transition-colors group-hover:font-semibold ${rainbow}`}>{it.label}</span>
                  </Link>
                ))}
              </div>

              <div className="rounded-xl px-3 py-2 hover:bg-white/10">
                <div className="text-white/70 mb-2">Market intel</div>
                {[
                  { href: '/intel',            label: 'Congress Trading' },
                  { href: '/intel/hedgefunds', label: 'Hedge fund holdings' },
                  { href: '/intel/macro',      label: 'Macro calendar' },
                  { href: '/intel/sectors',    label: 'Sector performance' },
                ].map(it => (
                  <Link
                    key={it.href}
                    href={it.href}
                    className="group block rounded-lg px-3 py-2 hover:bg-white/10"
                    onClick={() => setOpen(false)}
                  >
                    <span className={`transition-colors group-hover:font-semibold ${rainbow}`}>{it.label}</span>
                  </Link>
                ))}
              </div>

              <Link href="/about" className="group rounded-xl px-3 py-2 hover:bg-white/10" onClick={() => setOpen(false)}>
                <span className={rainbow}>About us</span>
              </Link>
            </nav>
          </div>
        </>
      )}
    </header>
  )
}