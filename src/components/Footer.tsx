// src/components/Footer.tsx
import Link from "next/link";

export default function Footer() {
  const year = new Date().getFullYear();

  const link =
    "text-gray-300 hover:text-white transition-colors";

  const heading =
    "text-sm font-semibold text-white tracking-wide mb-3";

  return (
    <footer className="mt-16 bg-neutral-900 text-gray-300">
      <div className="max-w-6xl mx-auto px-4 py-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-10">
          {/* Brand / About */}
          <div>
            <div className="text-lg font-bold text-white">SignalHub</div>
            <p className="mt-3 text-sm leading-relaxed">
              SignalHub is a lightweight dashboard for market signals and
              macro events. Use it to scan crypto and equity markets quickly
              and stay on top of upcoming releases.
            </p>
          </div>

          {/* Resources */}
          <div>
            <h3 className={heading}>Resources</h3>
            <ul className="space-y-2">
              <li>
                <Link href="/" className={link}>
                  Home
                </Link>
              </li>
              <li>
                <Link href="/about" className={link}>
                  About us
                </Link>
              </li>
              <li>
                <Link href="/intel/macro" className={link}>
                  Macro calendar
                </Link>
              </li>
              <li>
                <Link href="/intel" className={link}>
                  Congress trading
                </Link>
              </li>
              <li>
                <Link href="/disclaimer" className={link}>
                  Disclaimer
                </Link>
              </li>
            </ul>
          </div>

          {/* Crypto */}
          <div>
            <h3 className={heading}>Crypto</h3>
            <ul className="space-y-2">
              <li>
                <Link href="/crypto" className={link}>
                  Crypto tracker
                </Link>
              </li>
            </ul>
          </div>

          {/* Markets */}
          <div>
            <h3 className={heading}>Markets</h3>
            <ul className="grid grid-cols-2 gap-y-2 gap-x-6">
              <li><Link href="/market/aex" className={link}>AEX</Link></li>
              <li><Link href="/market/sp500" className={link}>S&amp;P 500</Link></li>
              <li><Link href="/market/nasdaq" className={link}>NASDAQ</Link></li>
              <li><Link href="/market/dowjones" className={link}>Dow Jones</Link></li>
              <li><Link href="/market/dax" className={link}>DAX</Link></li>
              <li><Link href="/market/ftse100" className={link}>FTSE 100</Link></li>
              <li><Link href="/market/nikkei225" className={link}>Nikkei 225</Link></li>
              <li><Link href="/market/hangseng" className={link}>Hang Seng</Link></li>
              <li><Link href="/market/sensex" className={link}>Sensex</Link></li>
            </ul>
          </div>
        </div>

        <div className="mt-10 border-t border-white/10 pt-6 flex items-center justify-between text-xs">
          <span className="text-gray-400">
            © {year} SignalHub
          </span>
          <Link href="/disclaimer" className="text-gray-400 hover:text-white">
            Disclaimer
          </Link>
        </div>
      </div>
    </footer>
  );
}