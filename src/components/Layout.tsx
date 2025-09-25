// src/components/Layout.tsx
import { ReactNode } from 'react'
import SiteHeader from './SiteHeader'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-ink text-white">
      <SiteHeader />
      {children}
      <footer className="border-t border-white/10 mt-16">
        <div className="max-w-6xl mx-auto px-4 py-8 text-sm text-white/60 flex items-center justify-between">
          <span>© {new Date().getFullYear()} SignalHub</span>
          <a className="hover:text-white" href="/disclaimer">Disclaimer</a>
        </div>
      </footer>
    </div>
  )
}