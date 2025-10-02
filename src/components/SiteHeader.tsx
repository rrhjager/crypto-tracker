// src/components/SiteHeader.tsx
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { createPortal } from 'react-dom'

function MobileMenuPortal({
  open,
  onClose,
  children,
}: {
  open: boolean
  onClose: () => void
  children: React.ReactNode
}) {
  const [mounted, setMounted] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setMounted(true)
    const el = document.createElement('div')
    containerRef.current = el
    document.body.appendChild(el)
    return () => {
      if (containerRef.current && containerRef.current.parentNode) {
        containerRef.current.parentNode.removeChild(containerRef.current)
      }
    }
  }, [])

  // Lock body scroll when open
  useEffect(() => {
    if (!mounted) return
    const prev = document.body.style.overflow
    document.body.style.overflow = open ? 'hidden' : prev || ''
    return () => { document.body.style.overflow = prev }
  }, [mounted, open])

  if (!mounted || !containerRef.current || !open) return null

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[99998] bg-black/50"
        onClick={onClose}
        aria-hidden
      />
      <div className="fixed inset-0 z-[99999] bg-ink text-white flex flex-col">
        {children}
      </div>
    </>,
    containerRef.current
  )
}

export default function SiteHeader() {
  const [open, setOpen] = useState(false)
  const [stockOpen, setStockOpen] = useState(false)
  const [intelOpen, setIntelOpen] = useState(false)

  const stockRef = useRef<HTMLDivElement>(null)
  const intelRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node
      if (stockRef.current && !stockRef.current.contains(t)) setStockOpen(false)
      if (intelRef.current && !intelRef.current.contains(t)) setIntelOpen(false)
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [])

  useEffect(() => {
    const close = () => setOpen(false)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }

    let lastPath = router.asPath
    const obs = setInterval(() => {
      if (router.asPath !== lastPath) { lastPath = router.asPath; close() }
    }, 100)

    window.addEventListener('keydown', onKey)
    router.events?.on?.('routeChangeComplete', close)
    router.events?.on?.('hashChangeComplete', close)

    return () => {
      clearInterval(obs)
      window.removeEventListener('keydown', onKey)
      router.events?.off?.('routeChangeComplete', close)
      router.events?.off?.('hashChangeComplete', close)
    }
  }, [router])

  const onMobileLinkClick = () => setOpen(false)

  const rainbow =
    'group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-[linear-gradient(90deg,#ff004c,#ff8a00,#ffd300,#00e472,#00c3ff,#7a00ff,#ff004c)]'

  return (
    <header className="bg-ink/80 backdrop-blur supports-[backdrop-filter]:bg-ink/60 border-b border-white/10 sticky top-0 z-[60]">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
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
                  { href: '/etfs',       label: 'ETFs' },
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

          {/* ✅ NIEUW: Academy vóór About us */}
          <Link href="/academy" className="group text-white/80 hover:text-white transition">
            <span className={`transition-colors ${rainbow}`}>Academy</span>
          </Link>

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

      {/* Mobile menu */}
      <MobileMenuPortal open={open} onClose={() => setOpen(false)}>
        <div className="h-14 px-4 flex items-center justify-between border-b border-white/10">
          <Link href="/" className="group font-semibold tracking-tight" onClick={onMobileLinkClick}>
            <span className={`text-black transition-all duration-300 ${rainbow}`}>SignalHub</span>
          </Link>
          <button
            className="inline-flex items-center justify-center w-10 h-10 rounded-xl border border-white/15 text-white/90"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          >
            <svg width="22" height="22" viewBox="0 0 24 24"><path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z"/></svg>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-2">
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
              { href: '/etfs',       label: 'ETFs' },
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

          {/* ✅ NIEUW: Academy vóór About us */}
          <Link href="/academy" className="group rounded-xl px-4 py-3 text-base hover:bg-white/10" onClick={onMobileLinkClick}>
            <span className={rainbow}>Academy</span>
          </Link>

          <Link href="/about" className="group rounded-xl px-4 py-3 text-base hover:bg-white/10" onClick={onMobileLinkClick}>
            <span className={rainbow}>About us</span>
          </Link>
        </nav>
      </MobileMenuPortal>
    </header>
  )
}