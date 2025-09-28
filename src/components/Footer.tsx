// src/components/Footer.tsx
import Link from 'next/link'

export default function Footer() {
  const year = new Date().getFullYear()
  return (
    <footer className="mt-16 border-t border-gray-200">
      <div className="max-w-6xl mx-auto px-4 py-10">
        {/* top sections */}
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-lg font-semibold text-gray-900">SignalHub</div>
            <p className="mt-2 text-sm text-gray-600">
              Tools en inzichten voor crypto & aandelen — snel en helder.
            </p>
          </div>

          <div>
            <div className="font-semibold text-gray-900">Product</div>
            <ul className="mt-3 space-y-2 text-sm">
              <li><Link className="text-gray-700 hover:text-gray-900" href="/crypto">Crypto tracker</Link></li>
              <li><Link className="text-gray-700 hover:text-gray-900" href="/stocks">Stock tracker</Link></li>
              <li><Link className="text-gray-700 hover:text-gray-900" href="/intel">Market intel (Congress)</Link></li>
              <li><Link className="text-gray-700 hover:text-gray-900" href="/intel/macro">Macro calendar</Link></li>
              <li><Link className="text-gray-700 hover:text-gray-900" href="/intel/hedgefunds">Hedge funds</Link></li>
              <li><Link className="text-gray-700 hover:text-gray-900" href="/intel/sectors">Sectors</Link></li>
            </ul>
          </div>

          <div>
            <div className="font-semibold text-gray-900">Beurzen</div>
            <ul className="mt-3 space-y-2 text-sm">
              <li><Link className="text-gray-700 hover:text-gray-900" href="/sp500">S&amp;P 500</Link></li>
              <li><Link className="text-gray-700 hover:text-gray-900" href="/nasdaq">NASDAQ</Link></li>
              <li><Link className="text-gray-700 hover:text-gray-900" href="/dax">DAX</Link></li>
              <li><Link className="text-gray-700 hover:text-gray-900" href="/ftse100">FTSE 100</Link></li>
              <li><Link className="text-gray-700 hover:text-gray-900" href="/nikkei225">Nikkei 225</Link></li>
              <li><Link className="text-gray-700 hover:text-gray-900" href="/dowjones">Dow Jones</Link></li>
            </ul>
          </div>

          <div>
            <div className="font-semibold text-gray-900">Over</div>
            <ul className="mt-3 space-y-2 text-sm">
              <li><Link className="text-gray-700 hover:text-gray-900" href="/about">About us</Link></li>
              <li><Link className="text-gray-700 hover:text-gray-900" href="/privacy">Privacy</Link></li>
              <li><Link className="text-gray-700 hover:text-gray-900" href="/terms">Terms</Link></li>
              <li>
                <a className="text-gray-700 hover:text-gray-900" href="mailto:hello@signalhub.app">
                  Contact
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* bottom bar */}
        <div className="mt-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="text-sm text-gray-500">
            © {year} SignalHub. Alle rechten voorbehouden.
          </div>
          <div className="text-sm text-gray-500">
            <span className="mr-2">Made for research — not investment advice.</span>
          </div>
        </div>
      </div>
    </footer>
  )
}