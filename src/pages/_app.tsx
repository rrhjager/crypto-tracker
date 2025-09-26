// src/pages/_app.tsx
import type { AppProps } from 'next/app'
import type { NextPage } from 'next'
import '@/styles/globals.css'
import { SWRConfig } from 'swr'
import Layout from '@/components/Layout'
import React from 'react'

/**
 * Optioneel getLayout-patroon:
 * - Als een pagina Component.getLayout heeft, gebruiken we die.
 * - Anders wrappen we met de standaard <Layout>.
 */
type NextPageWithLayout = NextPage & {
  getLayout?: (page: React.ReactElement) => React.ReactNode
}
type AppPropsWithLayout = AppProps & {
  Component: NextPageWithLayout
}

/**
 * Globale SWR-defaults:
 * - Fetcher met nette foutobjecten (status + optionele retryAfter)
 * - Revalidate bij focus/reconnect
 * - Exponential backoff met jitter (en respecteer Retry-After bij 429)
 * - Stop met retrypogingen bij 400/404 en na 5 pogingen
 */
const defaultFetcher = async (url: string) => {
  const r = await fetch(url, { cache: 'no-store' })
  let data: any = null
  try { data = await r.json() } catch { /* ignore non-JSON */ }
  if (!r.ok) {
    const err: any = new Error(
      (data && (data.error || data.message)) || `HTTP ${r.status}`
    )
    err.status = r.status
    const ra = r.headers.get('retry-after')
    if (ra) {
      const v = Number(ra)
      if (Number.isFinite(v)) err.retryAfter = v // seconden
    }
    throw err
  }
  return data
}

export default function App({ Component, pageProps }: AppPropsWithLayout) {
  const getLayout =
    Component.getLayout ??
    ((page: React.ReactElement) => <Layout>{page}</Layout>)

  return (
    <SWRConfig value={{
      fetcher: defaultFetcher,
      revalidateOnFocus: true,
      revalidateIfStale: true,
      revalidateOnReconnect: true,
      dedupingInterval: 2000,
      provider: () => new Map(),
      onErrorRetry: (error, _key, _config, revalidate, { retryCount }) => {
        const status = (error as any)?.status ?? 0
        const retryAfter = (error as any)?.retryAfter as number | undefined

        // Geen retrypogingen bij client-fouten die niet herstellen
        if (status === 400 || status === 404) return
        // Max 5 pogingen
        if (retryCount >= 5) return

        // Respecteer Retry-After bij rate limits
        if (status === 429 && Number.isFinite(retryAfter)) {
          const wait = Math.max(1000, retryAfter! * 1000)
          setTimeout(() => revalidate({ retryCount }), wait)
          return
        }

        // Algemene exponential backoff met jitter (max 30s)
        const base = 2000 // 2s
        const timeout = Math.min(30000, base * Math.pow(1.7, retryCount))
        const jitter = Math.random() * 500
        setTimeout(() => revalidate({ retryCount }), timeout + jitter)
      },
    }}>
      {getLayout(<Component {...pageProps} />)}
    </SWRConfig>
  )
}