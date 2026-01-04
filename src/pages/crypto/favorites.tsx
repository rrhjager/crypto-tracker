// src/pages/crypto/favorites.tsx
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { useSession, signIn } from 'next-auth/react'
import { COINS } from '@/lib/coins'

const fetcher = (url: string) => fetch(url, { cache: 'no-store' }).then(r => r.json())

type FavItem = { kind?: string; symbol?: string }

function readLocalList(key: string | null): string[] {
  if (!key) return []
  try {
    const raw = localStorage.getItem(key)
    const arr = raw ? JSON.parse(raw) : []
    if (!Array.isArray(arr)) return []
    return arr.map(x => String(x || '').toUpperCase()).filter(Boolean)
  } catch {
    return []
  }
}

function writeLocalList(key: string | null, list: string[]) {
  if (!key) return
  try {
    localStorage.setItem(key, JSON.stringify(list))
  } catch {}
}

function emitFavsUpdated() {
  try {
    window.dispatchEvent(new Event('crypto-favs-updated'))
  } catch {}
}

function PageInner() {
  const { data: session, status } = useSession()
  const isAuthed = status === 'authenticated'

  const email = session?.user?.email ? String(session.user.email).toLowerCase() : null
  const localKey = email ? `faves:crypto:${email}` : null

  // favorites uit DB/API
  const favApiKey = isAuthed ? '/api/user/favorites?kind=CRYPTO' : null
  const { data, mutate, isLoading } = useSWR<{ favorites?: FavItem[] }>(favApiKey, fetcher, {
    revalidateOnFocus: true,
    refreshInterval: 15_000,
  })

  // ✅ local “instant” mirror (so updates from /crypto show immediately)
  const [localReady, setLocalReady] = useState(false)
  const [localList, setLocalList] = useState<string[]>([])

  useEffect(() => {
    if (!isAuthed || !localKey) {
      setLocalReady(false)
      setLocalList([])
      return
    }
    const list = readLocalList(localKey)
    setLocalList(list)
    setLocalReady(true)
  }, [isAuthed, localKey])

  // When API data arrives and we don't have local yet, seed localStorage (useful if user opens favorites first)
  useEffect(() => {
    if (!isAuthed || !localKey) return
    if (!data) return
    if (localReady) return

    const arr = Array.isArray(data?.favorites) ? data!.favorites : []
    const seeded = arr
      .map(it => String(it?.symbol || '').toUpperCase())
      .filter(Boolean)

    setLocalList(seeded)
    setLocalReady(true)
    writeLocalList(localKey, seeded)
    emitFavsUpdated()
  }, [isAuthed, localKey, data, localReady])

  // Listen for updates from other pages in the same tab
  useEffect(() => {
    if (!isAuthed || !localKey) return
    const onUpdate = () => {
      const list = readLocalList(localKey)
      setLocalList(list)
      setLocalReady(true)
      void mutate() // sync with server truth in background
    }
    window.addEventListener('crypto-favs-updated', onUpdate)
    return () => window.removeEventListener('crypto-favs-updated', onUpdate)
  }, [isAuthed, localKey, mutate])

  const effectiveSymbols = useMemo(() => {
    if (localReady) return new Set(localList.map(s => String(s || '').toUpperCase()).filter(Boolean))
    const arr = Array.isArray(data?.favorites) ? data!.favorites : []
    return new Set(arr.map(it => String(it?.symbol || '').toUpperCase()).filter(Boolean))
  }, [localReady, localList, data])

  const favCoins = useMemo(() => {
    return COINS.filter(c => effectiveSymbols.has(String(c.symbol || '').toUpperCase()))
  }, [effectiveSymbols])

  const toggleFav = useCallback(
    async (sym: string) => {
      if (!isAuthed) return
      const s = String(sym || '').toUpperCase()
      const currentlyFav = effectiveSymbols.has(s)

      // ✅ instant local update (for immediate UI + cross-page)
      const nextLocal = currentlyFav ? localList.filter(x => x !== s) : [s, ...localList.filter(x => x !== s)]
      setLocalList(nextLocal)
      setLocalReady(true)
      writeLocalList(localKey, nextLocal)
      emitFavsUpdated()

      // optimistic SWR update too (keeps counts/snappy if you rely on data somewhere)
      await mutate(
        (prev) => {
          const prevArr = Array.isArray(prev?.favorites) ? prev!.favorites : []
          const nextArr = currentlyFav
            ? prevArr.filter(it => String(it?.symbol || '').toUpperCase() !== s)
            : [...prevArr, { kind: 'CRYPTO', symbol: s }]
          return { ...(prev || {}), favorites: nextArr }
        },
        { revalidate: false }
      )

      try {
        if (!currentlyFav) {
          const r = await fetch('/api/user/favorites', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: 'CRYPTO', symbol: s }),
          })
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
        } else {
          const r = await fetch(`/api/user/favorites?kind=CRYPTO&symbol=${encodeURIComponent(s)}`, {
            method: 'DELETE',
          })
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
        }
        await mutate()
      } catch {
        // rollback/sync
        await mutate()
        if (localKey) {
          const refreshed = readLocalList(localKey)
          setLocalList(refreshed)
          setLocalReady(true)
          emitFavsUpdated()
        }
      }
    },
    [isAuthed, effectiveSymbols, localList, localKey, mutate]
  )

  if (status === 'loading') {
    return (
      <main className="p-6 max-w-6xl mx-auto">
        <h1 className="hero">Crypto favorites</h1>
        <p className="sub">Loading…</p>
      </main>
    )
  }

  if (!session?.user) {
    return (
      <main className="p-6 max-w-6xl mx-auto">
        <h1 className="hero">Crypto favorites</h1>
        <p className="sub">Sign in to view your favorites.</p>

        <button
          onClick={() => signIn(undefined, { callbackUrl: '/crypto/favorites' })}
          className="mt-4 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-white/90 hover:bg-white/10 transition"
        >
          Sign in
        </button>
      </main>
    )
  }

  return (
    <main className="p-6 max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="hero">Crypto favorites</h1>
        <p className="sub">
          {isLoading ? 'Loading…' : `${favCoins.length} favorite${favCoins.length === 1 ? '' : 's'}`}
        </p>
      </header>

      <div className="table-card overflow-x-auto">
        {favCoins.length === 0 ? (
          <div className="p-4 text-white/70">
            You don’t have any crypto favorites yet. Go to{' '}
            <Link href="/crypto" className="link font-semibold">Crypto tracker</Link>{' '}
            and click the star.
          </div>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="text-white/60">
              <tr>
                <th className="py-2 w-10 text-center">★</th>
                <th className="text-left py-2">Coin</th>
              </tr>
            </thead>
            <tbody>
              {favCoins.map((c: any) => {
                const sym = String(c.symbol || '').toUpperCase()
                const slug = c.slug || sym.toLowerCase()

                return (
                  <tr key={sym} className="border-t border-white/5 hover:bg-white/5">
                    <td className="py-3 w-10 text-center">
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); void toggleFav(sym) }}
                        aria-pressed={true}
                        title="Remove from favorites"
                        className={[
                          'inline-flex items-center justify-center',
                          'h-6 w-6 rounded transition hover:bg-white/10',
                          'text-yellow-400',
                        ].join(' ')}
                      >
                        <span aria-hidden className="leading-none">★</span>
                      </button>
                    </td>

                    <td className="py-3">
                      <Link href={`/crypto/${slug}`} className="link font-semibold">
                        {c.name} <span className="ticker">({sym})</span>
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </main>
  )
}

// Client-only om SSR/hydration gedoe te voorkomen in Pages Router
export default dynamic(() => Promise.resolve(PageInner), { ssr: false })