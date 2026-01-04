import Link from 'next/link'
import dynamic from 'next/dynamic'
import useSWR from 'swr'
import { useMemo } from 'react'
import { useSession, signIn } from 'next-auth/react'
import { useRouter } from 'next/router'
import { COINS } from '@/lib/coins'

const fetcher = (url: string) => fetch(url).then(r => r.json())

function PageInner() {
  const router = useRouter()
  const { status } = useSession()
  const isAuthed = status === 'authenticated'

  const { data } = useSWR<any>(
    isAuthed ? '/api/user/favorites?kind=CRYPTO' : null,
    fetcher,
    { revalidateOnFocus: false }
  )

  const favSyms = useMemo(() => {
    const items = Array.isArray(data?.favorites) ? data.favorites : []
    return items.map((it: any) => String(it.symbol || '').toUpperCase())
  }, [data])

  const favCoins = useMemo(() => {
    const set = new Set(favSyms)
    return COINS.filter((c: any) => set.has(String(c.symbol || '').toUpperCase()))
  }, [favSyms])

  if (!isAuthed) {
    return (
      <main className="p-6 max-w-4xl mx-auto">
        <h1 className="hero">Crypto favorites</h1>
        <p className="sub mt-2">Je moet ingelogd zijn om favorites te gebruiken.</p>
        <button
          className="mt-4 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-white"
          onClick={() => signIn(undefined, { callbackUrl: router.asPath })}
        >
          Sign in
        </button>
      </main>
    )
  }

  return (
    <main className="p-6 max-w-4xl mx-auto">
      <header className="mb-6">
        <h1 className="hero">Crypto favorites</h1>
        <p className="sub">Je opgeslagen coins ({favSyms.length})</p>
      </header>

      <div className="table-card">
        {favCoins.length === 0 ? (
          <div className="text-white/70">Nog geen favorites. Ga naar de Crypto pagina en klik ⭐.</div>
        ) : (
          <ul className="divide-y divide-white/10">
            {favCoins.map((c: any) => (
              <li key={c.slug || c.symbol} className="py-3 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-white">{c.name}</div>
                  <div className="text-white/60 text-sm">{c.symbol}</div>
                </div>
                <Link className="link" href={`/crypto/${c.slug}`}>
                  Open
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}

export default dynamic(() => Promise.resolve(PageInner), { ssr: false })