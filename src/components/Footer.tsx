// src/components/Footer.tsx
import Link from 'next/link'

export default function Footer() {
  const year = new Date().getFullYear()
  const head = 'font-semibold text-gray-100'
  const a = 'text-gray-300 hover:underline'

  return (
    <footer className="mt-16 border-t border-gray-800" style={{ backgroundColor: '#1a1a1a' }}>
      <div className="max-w-6xl mx-auto px-4 py-10">
        {/* top */}
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
          {/* brand */}
          <div className="col-span-1">
            <div className="text-lg font-semibold text-gray-100">SignalHub</div>
            <p className="mt-2 text-sm text-gray-400">
              Fast, clear market insights for crypto & equities.
            </p>
          </div>

          {/* resources */}
          <div>
            <div className={head}>Resources</div>
            <ul className="mt-3 space-y-2 text-sm">
              <li><Link className={a} href="/">Home</Link></li>
              <li><Link className={a} href="/about">About us</Link></li>
              <li><Link className={a} href="/intel/macro">Macro calendar</Link></li>
              <li><Link className={a} href="/intel">Congress trading</Link></li>
              <li><Link className={a} href="/intel/hedgefunds">Hedge funds</Link></li>
              <li><Link className={a} href="/intel/sectors">Sectors</Link></li>
              <li><Link className={a} href="/disclaimer">Disclaimer</Link></li>
            </ul>
          </div>

          {/* crypto */}
          <div>
            <div className={head}>Crypto</div>
            <ul className="mt-3 space-y-2 text-sm">
              <li><Link className={a} href="/crypto">Crypto tracker</Link></li>
            </ul>
          </div>

          {/* markets */}
          <div>
            <div className={head}>Markets</div>
            <ul className="mt-3 space-y-2 text-sm">
              <li><Link className={a} href="/aex">AEX</Link></li>
              <li><Link className={a} href="/sp500">S&amp;P 500</Link></li>
              <li><Link className={a} href="/nasdaq">NASDAQ</Link></li>
              <li><Link className={a} href="/dowjones">Dow Jones</Link></li>
              <li><Link className={a} href="/dax">DAX</Link></li>
              <li><Link className={a} href="/ftse100">FTSE 100</Link></li>
              <li><Link className={a} href="/nikkei225">Nikkei 225</Link></li>
              <li><Link className={a} href="/hangseng">Hang Seng</Link></li>
              <li><Link className={a} href="/sensex">Sensex</Link></li>
            </ul>
          </div>

          {/* disclaimer */}
          <div>
            <div className={head}>Disclaimer</div>
            <ul className="mt-3 space-y-2 text-sm">
              <li><Link className={a} href="/disclaimer">Read disclaimer</Link></li>
            </ul>
            <p className="mt-3 text-xs text-gray-400">
              Research Only: not investment advice.
            </p>
          </div>
        </div>

        {/* bottom */}
        <div className="mt-10 pt-6 border-t border-gray-800 flex items-center justify-between">
          <div className="text-sm text-gray-400">
            © {year} SignalHub. All rights reserved.
          </div>
        </div>
      </div>
    </footer>
  )
}