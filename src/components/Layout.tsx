// src/components/Layout.tsx
import { ReactNode } from 'react'
import SiteHeader from './SiteHeader'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-ink text-white">
      <SiteHeader />
      {children}
      {/* Oude mini-footer verwijderd */}
    </div>
  )
}