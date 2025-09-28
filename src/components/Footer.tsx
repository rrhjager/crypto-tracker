// src/components/Footer.tsx
import Link from 'next/link'

export default function Footer() {
  const year = new Date().getFullYear()
  const link = 'text-gray-300 hover:text-white hover:underline'
  const head = 'font-semibold text-white'

  return (
    <footer className="mt-16 bg-neutral-900 border-t border-white/10">
      <div className="max-w-6xl mx-auto px-4 py-10 text-gray-300">
        {/* top */}
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {/* brand */}
          <div className="col-span-1">
            <div className="text-lg font-semibold text-white">SignalHub</div>
            <p className="mt-2 text-sm text-gray-400">
              Fast, clean market insights for crypto and equities. Track movers,
              scan signals, and keep an eye on upcoming macro events.
            </p>
          </div>

          {/* resources / site */}
          <div>
            <div className={head}>Resources</div>
            <ul className="mt-3 space-y-2 text-sm">
              <li><Link className={link} href="/">Home</Link></li>
              <li><Link className={link} href="/about">About us</Link></li>
              <li><Link className={link} href="/intel/macro">Macro calendar</Link></li>
              <li><Link className={link} href="/intel">Congress trading</Link></li>
              <li><Link className={link} href="/intel/hedgefunds">Hedge funds</Link></li>
              <li><Link className={link} href="/intel/sectors">Sectors</Link></li>
              <li><Link className={link} href="/disclaimer">Disclaimer</Link></li>
            </ul>
          </div>

          {/* crypto */}
          <div>
            <div className={head}>Crypto</div>
            <ul className="mt-3 space-y-2 text-sm">
              <li><Link className={link} href="/crypto">Crypto tracker</Link></li>
            </ul>
          </div>

          {/* markets */}
          <div>
            <div className={head}>Markets</div>
            <ul className="mt-3 grid grid-cols-2 gap-y-2 gap-x-6 text-sm">
              <li><Link className={link} href="/market/aex">AEX</Link></li>
              <li><Link className={link} href="/market/sp500">S&amp;P 500</Link></li>
              <li><Link className={link} href="/market/nasdaq">NASDAQ</Link></li>
              <li><Link className={link} href="/market/dowjones">Dow Jones</Link></li>
              <li><Link className={link} href="/market/dax">DAX</Link></li>
              <li><Link className={link} href="/market/ftse100">FTSE 100</Link></li>
              <li><Link className={link} href="/market/nikkei225">Nikkei 225</Link></li>
              <li><Link className={link} href="/market/hangseng">Hang Seng</Link></li>
              <li><Link className={link} href="/market/sensex">Sensex</Link></li>
            </ul>
          </div>
        </div>

        {/* bottom */}
        <div className="mt-10 pt-6 border-t border-white/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-sm">
          <div className="text-gray-400">
            © {year} SignalHub. All rights reserved.
          </div>
          <div className="text-gray-400">
            Made with ❤️ for market research.
          </div>
        </div>
      </div>
    </footer>
  )
}