// src/components/NewsFeed.tsx
import React from "react";
import { useRouter } from "next/router";

type Item = {
  id: string;
  title: string;
  link: string;
  source?: string;
  pubDate?: string;
};

type ApiResp = {
  updatedAt: number;
  query: string;
  items: Item[];
};

const COIN_NAME_MAP: Record<string, string> = {
  BTC: "Bitcoin", ETH: "Ethereum", BNB: "BNB", SOL: "Solana", XRP: "XRP",
  ADA: "Cardano", DOGE: "Dogecoin", TRX: "TRON", TON: "Toncoin", AVAX: "Avalanche",
  SHIB: "Shiba Inu", DOT: "Polkadot", BCH: "Bitcoin Cash", LTC: "Litecoin", LINK: "Chainlink",
  MATIC: "Polygon", UNI: "Uniswap", ICP: "Internet Computer", NEAR: "NEAR Protocol",
  APT: "Aptos", OP: "Optimism", ARB: "Arbitrum", XLM: "Stellar", FIL: "Filecoin",
  VET: "VeChain", ATOM: "Cosmos", HBAR: "Hedera", AAVE: "Aave", MKR: "Maker",
  SUI: "Sui", RNDR: "Render", IMX: "Immutable", INJ: "Injective", ALGO: "Algorand",
  QNT: "Quant", THETA: "Theta Network", GRT: "The Graph", FLOW: "Flow", CHZ: "Chiliz",
  MANA: "Decentraland", SAND: "The Sandbox", AXS: "Axie Infinity", DYDX: "dYdX",
  STX: "Stacks", KAS: "Kaspa", SEI: "Sei", PEPE: "Pepe", BONK: "Bonk", JASMY: "JasmyCoin",
  FTM: "Fantom", AR: "Arweave", ROSE: "Oasis Network", KAVA: "Kava",
  EGLD: "MultiversX (Elrond)", XEC: "eCash", IOTA: "IOTA", RUNE: "THORChain",
  PYTH: "Pyth Network", JUP: "Jupiter",
};

type Props = {
  /** Optioneel; laat leeg om automatisch uit de URL te halen */
  symbol?: string;
  /** Optioneel; laat leeg om automatisch te bepalen */
  name?: string;
  className?: string;
  limit?: number;
};

export default function NewsFeed({ symbol, name, className, limit = 8 }: Props) {
  const router = useRouter();

  // ── ongewijzigde logica (werkt al goed)
  let sym = (symbol || "").toUpperCase();
  if (!sym) {
    const slug = router.query.slug ?? router.query.symbol ?? router.query.id;
    if (Array.isArray(slug)) sym = String(slug[0] || "").toUpperCase();
    else sym = String(slug || "").toUpperCase();
  }
  if (!sym) sym = "BTC";

  const fullName = name || COIN_NAME_MAP[sym] || sym;

  const [data, setData] = React.useState<ApiResp | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);

    const url = `/api/v1/news/${encodeURIComponent(sym)}?name=${encodeURIComponent(fullName)}`;

    fetch(url)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as ApiResp;
      })
      .then((json) => {
        if (!mounted) return;
        setData(json);
        setLoading(false);
      })
      .catch((e) => {
        if (!mounted) return;
        setError("News loading failed.");
        setLoading(false);
        console.error(e);
      });

    return () => {
      mounted = false;
    };
  }, [sym, fullName]);

  return (
    <div className={className}>
      {/* Donkere card i.p.v. witte achtergrond */}
      <div className="news-card">
        <div className="news-head">
          <h3 className="news-title">
            <span className="dot" />
            Laatste {fullName} nieuws
          </h3>
          {data?.updatedAt && (
            <span className="news-ts">
              update: {new Date(data.updatedAt).toLocaleTimeString()}
            </span>
          )}
        </div>

        {loading && <div className="news-info">loading...</div>}
        {error && <div className="news-err">{error}</div>}

        {!loading && !error && (
          <>
            {data && data.items && data.items.length > 0 ? (
              <ul className="news-list">
                {data.items.slice(0, limit).map((it) => (
                  <li key={it.id} className="news-item">
                    <a
                      href={it.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="headline"
                      title={it.title}
                    >
                      {it.title}
                    </a>
                    <div className="meta">
                      {it.source ? it.source : "Bron onbekend"}
                      {it.pubDate ? ` · ${new Date(it.pubDate).toLocaleString()}` : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="news-info">Geen nieuws gevonden voor “{fullName}”.</div>
            )}
          </>
        )}
      </div>

      {/* Scoped styles zodat het overal hetzelfde oogt, zonder iets anders in je app te breken */}
      <style jsx>{`
        .news-card {
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 14px;
          padding: 14px;
        }
        .news-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 6px;
          padding: 2px 4px;
        }
        .news-title {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 16px;
          font-weight: 700;
          color: #e7e9ee;
          margin: 0;
        }
        .dot {
          width: 10px;
          height: 10px;
          border-radius: 999px;
          background: #4ade80; /* groen accent */
          box-shadow: 0 0 0 4px rgba(74, 222, 128, 0.15);
          flex: 0 0 auto;
        }
        .news-ts {
          color: rgba(255, 255, 255, 0.55);
          font-size: 12px;
        }
        .news-list {
          list-style: none;
          margin: 8px 0 0 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .news-item {
          background: rgba(0, 0, 0, 0.28);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 12px;
          padding: 10px 12px;
          transition: transform 120ms ease, background 120ms ease, border-color 120ms ease;
        }
        .news-item:hover {
          transform: translateY(-1px);
          background: rgba(255, 255, 255, 0.06);
          border-color: rgba(255, 255, 255, 0.12);
        }
        .headline {
          color: #f5f7fb;
          text-decoration: none;
          font-weight: 600;
          line-height: 1.35;
          display: inline-block;
        }
        .headline:hover {
          text-decoration: underline;
        }
        .meta {
          margin-top: 6px;
          font-size: 12px;
          color: rgba(255, 255, 255, 0.65);
        }
        .news-info {
          margin-top: 8px;
          font-size: 14px;
          color: rgba(255, 255, 255, 0.7);
        }
        .news-err {
          margin-top: 8px;
          font-size: 14px;
          color: #fda4af;
        }
      `}</style>
    </div>
  );
}