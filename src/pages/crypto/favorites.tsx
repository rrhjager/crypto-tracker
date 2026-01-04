// src/pages/crypto/favorites.tsx
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useMemo, useCallback } from 'react'
import useSWR from 'swr'
import { useSession, signIn } from 'next-auth/react'
import { COINS } from '@/lib/coins'

const fetcher = (url: string) => fetch(url, { cache: 'no-store' }).then(r => r.json())

type FavItem = { kind?: string; symbol?: string }

function PageInner() {
  const { data: session, status } = useSession()
  const isAuthed = status === 'authenticated'

  // favorites uit DB/API (niet localStorage)
  const favKey = isAuthed ? '/api/user/favorites?kind=CRYPTO' : null
  const { data, mutate, isLoading } = useSWR<{ favorites?: FavItem[] }>(favKey, fetcher, {
    revalidateOnFocus: true,
    refreshInterval: 15_000,
  })

  const favSymbols = useMemo(() => {
    const arr = Array.isArray(data?.favorites) ? data!.favorites : []
    return new Set(
      arr
        .map(it => String(it?.symbol || '').toUpperCase())
        .filter(Boolean)
    )
  }, [data])

  const favCoins = useMemo(() => {
    // behoud volgorde van COINS, maar filter alleen favorieten
    return COINS.filter(c => favSymbols.has(String(c.symbol || '').toUpperCase()))
  }, [favSymbols])

  const toggleFav = useCallback(
    async (sym: string) => {
      if (!isAuthed) return
      const s = String(sym || '').toUpperCase()
      const currentlyFav = favSymbols.has(s)

      // optimistic update: meteen UI aanpassen
      await mutate(
        (prev) => {
          const prevArr = Array.isArray(prev?.favorites) ? prev!.favorites : []
          const nextArr = currentlyFav
            ? prevArr.filter(it => String(it?.symbol || '').toUpperCase() !== s) // remove
            : [...prevArr, { kind: 'CRYPTO', symbol: s }] // add (komt hier nauwelijks voor, maar kan)
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
      } catch {
        // rollback door opnieuw “truth” op te halen
        await mutate()
      }
    },
    [isAuthed, favSymbols, mutate]
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
        <p className="sub">Log in om je favorieten te bekijken.</p>

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
          {isLoading ? 'Loading…' : `${favCoins.length} favoriet${favCoins.length === 1 ? '' : 'en'}`}
        </p>
      </header>

      <div className="table-card overflow-x-auto">
        {favCoins.length === 0 ? (
          <div className="p-4 text-white/70">
            Je hebt nog geen crypto favorieten. Ga naar{' '}
            <Link href="/crypto" className="link font-semibold">Crypto tracker</Link>{' '}
            en klik op de ster.
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
                        title="Verwijder uit favorieten"
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