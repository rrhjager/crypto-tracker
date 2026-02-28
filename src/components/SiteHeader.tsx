// src/components/SiteHeader.tsx
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { createPortal } from 'react-dom'

// ✅ NEW: NextAuth hooks
import { useSession, signIn, signOut } from 'next-auth/react'

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
    return () => {
      document.body.style.overflow = prev
    }
  }, [mounted, open])

  if (!mounted || !containerRef.current || !open) return null

  return createPortal(
    <>
      <div className="fixed inset-0 z-[99998] bg-black/50" onClick={onClose} aria-hidden />
      <div className="fixed inset-0 z-[99999] bg-ink text-white flex flex-col">{children}</div>
    </>,
    containerRef.current
  )
}

export default function SiteHeader() {
  const [open, setOpen] = useState(false)
  const [stockOpen, setStockOpen] = useState(false)
  const [intelOpen, setIntelOpen] = useState(false)

  // ✅ Past performance dropdown
  const [perfOpen, setPerfOpen] = useState(false)
  const perfRef = useRef<HTMLDivElement>(null)

  // ✅ account dropdown
  const [accountOpen, setAccountOpen] = useState(false)
  const accountRef = useRef<HTMLDivElement>(null)

  const stockRef = useRef<HTMLDivElement>(null)
  const intelRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  // ✅ session
  const { data: session, status } = useSession()

  // Theme state (light/dark)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    try {
      const root = document.documentElement
      const stored = window.localStorage.getItem('theme')
      let initial: 'light' | 'dark' = 'light'

      if (stored === 'light' || stored === 'dark') {
        initial = stored
      } else {
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        initial = prefersDark ? 'dark' : 'light'
      }

      if (initial === 'dark') root.classList.add('dark')
      else root.classList.remove('dark')

      setTheme(initial)
    } catch {
      setTheme('light')
    }
  }, [])

  const toggleTheme = () => {
    try {
      const root = document.documentElement
      setTheme(prev => {
        const next: 'light' | 'dark' = prev === 'light' ? 'dark' : 'light'
        if (next === 'dark') root.classList.add('dark')
        else root.classList.remove('dark')
        window.localStorage.setItem('theme', next)
        return next
      })
    } catch {}
  }

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node
      if (stockRef.current && !stockRef.current.contains(t)) setStockOpen(false)
      if (intelRef.current && !intelRef.current.contains(t)) setIntelOpen(false)
      if (perfRef.current && !perfRef.current.contains(t)) setPerfOpen(false)
      if (accountRef.current && !accountRef.current.contains(t)) setAccountOpen(false)
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [])

  useEffect(() => {
    const close = () => setOpen(false)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }

    let lastPath = router.asPath
    const obs = setInterval(() => {
      if (router.asPath !== lastPath) {
        lastPath = router.asPath
        close()
      }
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

  // ✅ Updated list: same order as Stock tracker
  const perfItems = [
    { href: '/past-performance/crypto', label: 'Crypto past performance' },

    { href: '/past-performance/aex', label: 'AEX past performance' },
    { href: '/past-performance/sp500', label: 'S&P 500 past performance' },
    { href: '/past-performance/nasdaq', label: 'NASDAQ past performance' },
    { href: '/past-performance/dowjones', label: 'Dow Jones past performance' },
    { href: '/past-performance/dax', label: 'DAX past performance' },
    { href: '/past-performance/ftse100', label: 'FTSE 100 past performance' },
    { href: '/past-performance/nikkei225', label: 'Nikkei 225 past performance' },
    { href: '/past-performance/hangseng', label: 'Hang Seng past performance' },
    { href: '/past-performance/sensex', label: 'Sensex past performance' },
    { href: '/past-performance/etfs', label: 'ETFs past performance' },
  ]

  return (
    <header className="bg-ink/80 backdrop-blur supports-[backdrop-filter]:bg-ink/60 border-b border-white/10 sticky top-0 z-[60]">
      <div className="max-w-screen-2xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link
          href="/"
          className="group font-semibold tracking-tight text-slate-900 dark:text-slate-50"
          onClick={() => setOpen(false)}
        >
          <span className={`transition-all duration-300 ${rainbow}`}>SignalHub</span>
        </Link>

        {/* Desktop menu */}
        <nav className="hidden md:flex items-center gap-6">
          <Link href="/crypto" className="group text-white/80 hover:text-white transition">
            <span className={`transition-colors ${rainbow}`}>Crypto tracker</span>
          </Link>

          <Link href="/premium-active" className="group text-white/80 hover:text-white transition">
            <span className={`transition-colors ${rainbow}`}>High Threshold</span>
          </Link>

          {/* Stock tracker */}
          <div className="relative" ref={stockRef}>
            <button
              className="group text-white/80 hover:text-white transition inline-flex items-center gap-1"
              onClick={() => {
                setStockOpen(v => !v)
                setIntelOpen(false)
                setPerfOpen(false)
              }}
              onMouseEnter={() => {
                setStockOpen(true)
                setIntelOpen(false)
                setPerfOpen(false)
              }}
              aria-haspopup="true"
              aria-expanded={stockOpen}
            >
              <span className={rainbow}>Stock tracker</span>
              <svg width="14" height="14" viewBox="0 0 24 24" className="opacity-70">
                <path fill="currentColor" d="M7 10l5 5 5-5z" />
              </svg>
            </button>
            {stockOpen && (
              <div
                onMouseLeave={() => setStockOpen(false)}
                className="absolute right-0 mt-2 w-48 rounded-2xl border border-white/10 bg-ink shadow-lg p-1"
              >
                {[
                  { href: '/stocks', label: 'AEX' },
                  { href: '/sp500', label: 'S&P 500' },
                  { href: '/nasdaq', label: 'NASDAQ' },
                  { href: '/dowjones', label: 'Dow Jones' },
                  { href: '/dax', label: 'DAX' },
                  { href: '/ftse100', label: 'FTSE 100' },
                  { href: '/nikkei225', label: 'Nikkei 225' },
                  { href: '/hangseng', label: 'Hang Seng' },
                  { href: '/sensex', label: 'Sensex' },
                  { href: '/etfs', label: 'ETFs' },
                ].map(it => (
                  <Link key={it.href} href={it.href} className="group block px-3 py-2 rounded-xl hover:bg-white/10">
                    <span className={`text-white/90 transition-colors group-hover:font-semibold ${rainbow}`}>
                      {it.label}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Market intel */}
          <div className="relative" ref={intelRef}>
            <button
              className="group text-white/80 hover:text-white transition inline-flex items-center gap-1"
              onClick={() => {
                setIntelOpen(v => !v)
                setStockOpen(false)
                setPerfOpen(false)
              }}
              onMouseEnter={() => {
                setIntelOpen(true)
                setStockOpen(false)
                setPerfOpen(false)
              }}
              aria-haspopup="true"
              aria-expanded={intelOpen}
            >
              <span className={rainbow}>Market intel</span>
              <svg width="14" height="14" viewBox="0 0 24 24" className="opacity-70">
                <path fill="currentColor" d="M7 10l5 5 5-5z" />
              </svg>
            </button>
            {intelOpen && (
              <div
                onMouseLeave={() => setIntelOpen(false)}
                className="absolute right-0 mt-2 w-56 rounded-2xl border border-white/10 bg-ink shadow-lg p-1"
              >
                {[
                  { href: '/intel', label: 'Congress Trading' },
                  { href: '/intel/hedgefunds', label: 'Hedge fund holdings' },
                  { href: '/intel/macro', label: 'Macro calendar' },
                  { href: '/intel/sectors', label: 'Sector performance' },
                ].map(it => (
                  <Link key={it.href} href={it.href} className="group block px-3 py-2 rounded-xl hover:bg-white/10">
                    <span className={`text-white/90 transition-colors group-hover:font-semibold ${rainbow}`}>
                      {it.label}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Trump Trading */}
          <Link href="/trump-trading" className="group text-white/80 hover:text-white transition">
            <span className={`transition-colors ${rainbow}`}>Trump Trading</span>
          </Link>

          {/* separator */}
          <span className="text-white/30 select-none" aria-hidden>
            |
          </span>

          {/* ✅ Past performance (right of Trump Trading) */}
          <div className="relative" ref={perfRef}>
            <button
              className="group text-white/80 hover:text-white transition inline-flex items-center gap-1"
              onClick={() => {
                setPerfOpen(v => !v)
                setStockOpen(false)
                setIntelOpen(false)
              }}
              onMouseEnter={() => {
                setPerfOpen(true)
                setStockOpen(false)
                setIntelOpen(false)
              }}
              aria-haspopup="true"
              aria-expanded={perfOpen}
            >
              <span className={rainbow}>Past performance</span>
              <svg width="14" height="14" viewBox="0 0 24 24" className="opacity-70">
                <path fill="currentColor" d="M7 10l5 5 5-5z" />
              </svg>
            </button>

            {perfOpen && (
              <div
                onMouseLeave={() => setPerfOpen(false)}
                className="absolute right-0 mt-2 w-72 rounded-2xl border border-white/10 bg-ink shadow-lg p-1 max-h-[70vh] overflow-auto"
              >
                {perfItems.map(it => (
                  <Link key={it.href} href={it.href} className="group block px-3 py-2 rounded-xl hover:bg-white/10">
                    <span className={`text-white/90 transition-colors group-hover:font-semibold ${rainbow}`}>
                      {it.label}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* About us */}
          <Link href="/about" className="group text-white/80 hover:text-white transition">
            <span className={`transition-colors ${rainbow}`}>About us</span>
          </Link>

          {/* Academy */}
          <Link href="/academy" className="group text-white/80 hover:text-white transition">
            <span className={`transition-colors ${rainbow}`}>Academy</span>
          </Link>

          {/* ✅ separator between Academy and login circle */}
          <span className="text-white/30 select-none" aria-hidden>
            |
          </span>

          {/* Account button (desktop) */}
          <div className="relative" ref={accountRef}>
            {status !== 'loading' && !session?.user ? (
              <button
                onClick={() => signIn(undefined, { callbackUrl: router.asPath })}
                className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-white/90 hover:bg-white/10 transition"
              >
                Sign in
              </button>
            ) : (
              <button
                onClick={() => setAccountOpen(v => !v)}
                className="ml-2 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white transition"
                aria-label="Account"
                aria-expanded={accountOpen}
              >
                {((session?.user?.email || 'U')[0] || 'U').toUpperCase()}
              </button>
            )}

            {accountOpen && session?.user && (
              <div className="absolute right-0 mt-2 w-64 rounded-2xl border border-white/10 bg-ink shadow-lg p-1">
                <div className="px-3 py-2">
                  <div className="text-white/90 font-medium">Account</div>
                  <div className="text-white/60 text-sm truncate">{session.user.email}</div>
                </div>

                <div className="h-px bg-white/10 my-1" />

                <button
                  onClick={() => {
                    setAccountOpen(false)
                    router.push('/account')
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-white/10 text-white/90"
                >
                  Settings
                </button>

                <button
                  onClick={() => {
                    setAccountOpen(false)
                    router.push('/account/indicators')
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-white/10 text-white/90"
                >
                  Indicator preferences
                </button>

                <button
                  onClick={() => {
                    setAccountOpen(false)
                    router.push('/crypto/favorites')
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-white/10 text-white/90"
                >
                  Crypto favorites
                </button>

                <button
                  onClick={() => {
                    setAccountOpen(false)
                    router.push('/equity-favorites')
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-white/10 text-white/90"
                >
                  Equity favorites
                </button>

                <button disabled className="w-full text-left px-3 py-2 rounded-xl text-white/50 cursor-not-allowed">
                  Billing / Upgrade (later)
                </button>

                <div className="h-px bg-white/10 my-1" />

                <button
                  onClick={() => signOut({ callbackUrl: '/' })}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-white/10 text-white/90"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>

          {/* Theme toggle (desktop) */}
          {mounted && (
            <button
              type="button"
              onClick={toggleTheme}
              className="ml-2 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white transition dark:border-slate-600 dark:bg-slate-900/60 dark:hover:bg-slate-800"
              aria-label="Toggle dark mode"
            >
              {theme === 'dark' ? (
                <svg width="18" height="18" viewBox="0 0 24 24">
                  <path
                    fill="currentColor"
                    d="M12 7a5 5 0 1 1 0 10a5 5 0 0 1 0-10m0-5l1.5 3h-3L12 2m0 20l-1.5-3h3L12 22M4 4l2.12 2.12L4.7 7.54L2.59 5.41L4 4m15.41 1.41L17.88 6.12L20 4l-1.59 1.41M2 12l3-1.5v3L2 12m19 0l-3 1.5v-3L21 12M4 20l2.12-2.12l1.41 1.41L5.41 21L4 20m15.41-1.41L18 20l-2.12-2.12l1.41-1.41L19.41 18.59Z"
                  />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24">
                  <path
                    fill="currentColor"
                    d="M20 15.5A8.5 8.5 0 0 1 8.5 4c.94 0 1.84.16 2.67.46A6.5 6.5 0 0 0 19.54 12c0 .83-.16 1.63-.46 2.37c.27.71.42 1.48.42 2.28M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Z"
                  />
                </svg>
              )}
            </button>
          )}
        </nav>

        {/* Mobile hamburger */}
        <button
          className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-xl border border-white/15 text-white/90"
          onClick={() => setOpen(v => !v)}
          aria-label="Menu"
          aria-expanded={open}
        >
          {!open ? (
            <svg width="22" height="22" viewBox="0 0 24 24">
              <path fill="currentColor" d="M3 6h18v2H3V6m0 5h18v2H3v-2m0 5h18v2H3v-2Z" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24">
              <path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile menu */}
      <MobileMenuPortal open={open} onClose={() => setOpen(false)}>
        <div className="h-14 px-4 flex items-center justify-between border-b border-white/10">
          <Link
            href="/"
            className="group font-semibold tracking-tight text-slate-900 dark:text-slate-50"
            onClick={onMobileLinkClick}
          >
            <span className={`transition-all duration-300 ${rainbow}`}>SignalHub</span>
          </Link>

          <div className="flex items-center gap-2">
            {mounted && (
              <button
                type="button"
                onClick={toggleTheme}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white transition dark:border-slate-600 dark:bg-slate-900/60 dark:hover:bg-slate-800"
                aria-label="Toggle dark mode"
              >
                {theme === 'dark' ? (
                  <svg width="18" height="18" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M12 7a5 5 0 1 1 0 10a5 5 0 0 1 0-10m0-5l1.5 3h-3L12 2m0 20l-1.5-3h3L12 22M4 4l2.12 2.12L4.7 7.54L2.59 5.41L4 4m15.41 1.41L17.88 6.12L20 4l-1.59 1.41M2 12l3-1.5v3L2 12m19 0l-3 1.5v-3L21 12M4 20l2.12-2.12l1.41 1.41L5.41 21L4 20m15.41-1.41L18 20l-2.12-2.12l1.41-1.41L19.41 18.59Z"
                    />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M20 15.5A8.5 8.5 0 0 1 8.5 4c.94 0 1.84.16 2.67.46A6.5 6.5 0 0 0 19.54 12c0 .83-.16 1.63-.46 2.37c.27.71.42 1.48.42 2.28M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Z"
                    />
                  </svg>
                )}
              </button>
            )}

            <button
              className="inline-flex items-center justify-center w-10 h-10 rounded-xl border border-white/15 text-white/90"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
            >
              <svg width="22" height="22" viewBox="0 0 24 24">
                <path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z" />
              </svg>
            </button>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-2">
          {status !== 'loading' && !session?.user ? (
            <button
              onClick={() => {
                setOpen(false)
                signIn(undefined, { callbackUrl: router.asPath })
              }}
              className="w-full text-left group rounded-xl px-4 py-3 hover:bg-white/10 text-base"
            >
              <span className={rainbow}>Sign in</span>
            </button>
          ) : (
            <button
              onClick={() => {
                setOpen(false)
                signOut({ callbackUrl: '/' })
              }}
              className="w-full text-left group rounded-xl px-4 py-3 hover:bg-white/10 text-base"
            >
              <span className={rainbow}>Sign out</span>
            </button>
          )}

          <Link
            href="/crypto"
            className="group rounded-xl px-4 py-3 hover:bg-white/10 text-base"
            onClick={onMobileLinkClick}
          >
            <span className={rainbow}>Crypto tracker</span>
          </Link>

          <Link
            href="/premium-active"
            className="group rounded-xl px-4 py-3 hover:bg-white/10 text-base"
            onClick={onMobileLinkClick}
          >
            <span className={rainbow}>High Threshold</span>
          </Link>

          {/* Past performance (mobile) */}
          <div className="rounded-xl px-3 py-2">
            <div className="text-white/70 mb-2 px-1">Past performance</div>
            {perfItems.map(it => (
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
            <div className="text-white/70 mb-2 px-1">Stock tracker</div>
            {[
              { href: '/stocks', label: 'AEX' },
              { href: '/sp500', label: 'S&P 500' },
              { href: '/nasdaq', label: 'NASDAQ' },
              { href: '/dowjones', label: 'Dow Jones' },
              { href: '/dax', label: 'DAX' },
              { href: '/ftse100', label: 'FTSE 100' },
              { href: '/nikkei225', label: 'Nikkei 225' },
              { href: '/hangseng', label: 'Hang Seng' },
              { href: '/sensex', label: 'Sensex' },
              { href: '/etfs', label: 'ETFs' },
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
              { href: '/intel', label: 'Congress Trading' },
              { href: '/intel/hedgefunds', label: 'Hedge fund holdings' },
              { href: '/intel/macro', label: 'Macro calendar' },
              { href: '/intel/sectors', label: 'Sector performance' },
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

          <Link
            href="/trump-trading"
            className="group rounded-xl px-4 py-3 text-base hover:bg-white/10"
            onClick={onMobileLinkClick}
          >
            <span className={rainbow}>Trump Trading</span>
          </Link>

          <Link
            href="/academy"
            className="group rounded-xl px-4 py-3 text-base hover:bg-white/10"
            onClick={onMobileLinkClick}
          >
            <span className={rainbow}>Academy</span>
          </Link>

          <Link
            href="/about"
            className="group rounded-xl px-4 py-3 text-base hover:bg-white/10"
            onClick={onMobileLinkClick}
          >
            <span className={rainbow}>About us</span>
          </Link>
        </nav>
      </MobileMenuPortal>
    </header>
  )
}
