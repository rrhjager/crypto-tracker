// src/pages/_app.tsx
import type { AppProps } from 'next/app'
import type { NextPage } from 'next'
import '@/styles/globals.css'
import { SWRConfig } from 'swr'
import Layout from '@/components/Layout'
import Footer from '@/components/Footer'
import React from 'react'
import Script from 'next/script'

// Compacte cookie-keuze rechtsonder
import CookieConsent from '@/components/CookieConsent'

// Advertentie-popup linksonder
import AdPopup from '@/components/AdPopup'

type NextPageWithLayout = NextPage & {
  getLayout?: (page: React.ReactElement) => React.ReactNode
}
type AppPropsWithLayout = AppProps & {
  Component: NextPageWithLayout
}

const defaultFetcher = async (url: string) => {
  const r = await fetch(url, { cache: 'no-store' })
  let data: any = null
  try { data = await r.json() } catch {}
  if (!r.ok) {
    const err: any = new Error((data && (data.error || data.message)) || `HTTP ${r.status}`)
    err.status = r.status
    const ra = r.headers.get('retry-after')
    if (ra) {
      const v = Number(ra)
      if (Number.isFinite(v)) err.retryAfter = v
    }
    throw err
  }
  return data
}

export default function App({ Component, pageProps }: AppPropsWithLayout) {
  const getLayout =
    Component.getLayout ??
    ((page: React.ReactElement) => <Layout>{page}</Layout>)

  const page = getLayout(<Component {...pageProps} />)

  return (
    <SWRConfig
      value={{
        fetcher: defaultFetcher,
        revalidateOnFocus: true,
        revalidateIfStale: true,
        revalidateOnReconnect: true,
        dedupingInterval: 2000,
        provider: () => new Map(),
        onErrorRetry: (error, _key, _config, revalidate, { retryCount }) => {
          const status = (error as any)?.status ?? 0
          const retryAfter = (error as any)?.retryAfter as number | undefined
          if (status === 400 || status === 404) return
          if (retryCount >= 5) return
          if (status === 429 && Number.isFinite(retryAfter)) {
            const wait = Math.max(1000, retryAfter! * 1000)
            setTimeout(() => revalidate({ retryCount }), wait)
            return
          }
          const base = 2000
          const timeout = Math.min(30000, base * Math.pow(1.7, retryCount))
          const jitter = Math.random() * 500
          setTimeout(() => revalidate({ retryCount }), timeout + jitter)
        },
      }}
    >
      <>
        {/* AdSense library (alleen laden; geen Auto Ads geactiveerd) */}
        <Script
          id="adsense-lib"
          strategy="afterInteractive"
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4777751645956730"
          crossOrigin="anonymous"
        />

        {page}
        <Footer />

        {/* Rechtsonder cookie consent */}
        <CookieConsent />

        {/* Linksonder advertentie-popup (subtiel, wegklikbaar, keert na 3 min terug) */}
        <AdPopup initialDelayMs={1500} reappearAfterMs={180000} />
      </>
    </SWRConfig>
  )
}