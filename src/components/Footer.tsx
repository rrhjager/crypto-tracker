// src/components/Footer.tsx
import Link from 'next/link'

export default function Footer() {
  const year = new Date().getFullYear()
  return (
    <footer className="mt-16 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-[#0b0c0f]">
      <div className="max-w-6xl mx-auto px-4 py-10">
        {/* top */}
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
          {/* brand */}
          <div className="col-span-1">
            <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">SignalHub</div>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Snelle, duidelijke markt-inzichten voor crypto & aandelen.
            </p>
          </div>

          {/* resources / site */}
          <div>
            <div className="font-semibold text-gray-900 dark:text-gray-100">Resources</div>
            <ul className="mt-3 space-y-2 text-sm">
              <li><Link className="text-gray-700 dark:text-gray-300 hover:underline" href="/">Home</Link></li>
              <li><Link className="text-gray-700 dark:text-gray-300 hover:underline" href="/about">About us</Link></li>
              <li><Link className="text-gray-700 dark:text-gray-300 hover:underline" href="/intel/macro">Macro calendar</Link></li>
              <li><Link className="text-gray-700 dark:text-gray-300 hover:underline" href="/intel">Congress trading</Link></li>
              <li><Link className="text-gray-700 dark:text-gray-300 hover:underline" href="/intel/hedgefunds">Hedge funds</Link></li>
              <li><Link className="text-gray-700 dark:text-gray-300 hover:underline" href="/intel/sectors">Sectors</Link></li>
            </ul>
          </div>

          {/* markets */}
          <div>
            <div className="font-semibold text-gray-900 dark:text-gray-100">Markets</div>
            <ul className="mt-3 space-y-2 text-sm">
              <li><Link className="text-gray-700 dark:text-gray-300 hover:underline" href="/crypto">Crypto tracker</Link></li>
              <li><Link className="text-gray-700 dark:text-gray-300 hover:underline" href="/stocks">Stock tracker</Link></li>
              <li><Link className="text-gray-700 dark:text-gray-300 hover:underline" href="/sp500">S&amp;P 500</Link></li>
              <li><Link className="text-gray-700 dark:text-gray-300 hover:underline" href="/nasdaq">NASDAQ</Link></li>
              <li><Link className="text-gray-700 dark:text-gray-300 hover:underline" href="/dowjones">Dow Jones</Link></li>
              <li><Link className="text-gray-700 dark:text-gray-300 hover:underline" href="/dax">DAX</Link></li>
            </ul>
          </div>

          {/* account / legal */}
          <div>
            <div className="font-semibold text-gray-900 dark:text-gray-100">Account</div>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <a className="text-gray-700 dark:text-gray-300 hover:underline" href="mailto:hello@signalhub.app">
                  Contact us
                </a>
              </li>
              <li><Link className="text-gray-700 dark:text-gray-300 hover:underline" href="/privacy">Privacy</Link></li>
              <li><Link className="text-gray-700 dark:text-gray-300 hover:underline" href="/terms">Terms</Link></li>
              <li className="text-gray-500 dark:text-gray-400 text-xs">
                Research only — not investment advice.
              </li>
            </ul>
          </div>

          {/* partners / powered by */}
          <div>
            <div className="font-semibold text-gray-900 dark:text-gray-100">Data & partners</div>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <a className="text-gray-700 dark:text-gray-300 hover:underline"
                   href="https://fred.stlouisfed.org/" target="_blank" rel="noopener noreferrer">
                  FRED (Macro)
                </a>
              </li>
              <li>
                <a className="text-gray-700 dark:text-gray-300 hover:underline"
                   href="https://financialmodelingprep.com/" target="_blank" rel="noopener noreferrer">
                  Financial Modeling Prep (Stocks & Congress)
                </a>
              </li>
            </ul>
            <div className="mt-4 text-xs text-gray-500 dark:text-gray-400">
              Powered by public APIs
            </div>
          </div>
        </div>

        {/* bottom */}
        <div className="mt-10 pt-6 border-t border-gray-200 dark:border-gray-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            © {year} SignalHub. All rights reserved.
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            Made with ❤️ for market research.
          </div>
        </div>
      </div>
    </footer>
  )
}