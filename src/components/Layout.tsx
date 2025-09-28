// src/components/Layout.tsx
import { ReactNode } from 'react'
import SiteHeader from './SiteHeader'
import Footer from './Footer' // ✅ import toegevoegd

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-ink text-white flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        {children}
      </main>
      <Footer /> {/* ✅ gebruikt nu je eigen Footer component */}
    </div>
  )
}