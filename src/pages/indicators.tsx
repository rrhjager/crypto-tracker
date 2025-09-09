// src/pages/indicators.tsx
import Link from "next/link";
import Head from "next/head";

type Row = { indicator: string; uitleg: string; idee: string };

const ROWS: Row[] = [
  {
    indicator: "Technische Analyse",
    uitleg: "Bundelt klassieke grafiek-signalen (RSI/MACD/EMA) tot één duidelijk advies.",
    idee: "Neem RSI, MACD en trend → combineer naar 1 score (0..1).",
  },
  {
    indicator: "Momentum",
    uitleg: "Laat zien of de koers kracht heeft en “in de lift zit”.",
    idee: "Hoger als RSI > 50, koers > trendlijn en MACD positief.",
  },
  {
    indicator: "Volatility Regime",
    uitleg: "Vergelijkt hoe heftig de schommelingen zijn t.o.v. andere coins.",
    idee: "Rustiger coin → hogere score; onrustiger → lagere score.",
  },
  {
    indicator: "Funding rate (perps)",
    uitleg: "Meet of handelaren meer long (stijging) of short (daling) inzetten.",
    idee: "Positief = meer longs → >0.5; negatief = meer shorts → <0.5.",
  },
  {
    indicator: "Open Interest",
    uitleg: "Toont hoeveel geld er vastzit in futures; meer open posities = meer gewicht.",
    idee: "Huidig OI vergeleken met hoogste en laagste van de afgelopen maanden.",
  },
  {
    indicator: "Long/Short Skew",
    uitleg: "Geeft de verhouding tussen long- en short-traders.",
    idee: "0.5 = neutraal, hoger = meer longs, lager = meer shorts.",
  },
  {
    indicator: "Yield (DeFi)",
    uitleg: "Hoeveel rente (APY) je kunt verdienen in DeFi; hogere APY = hogere score, maar extreem hoge rentes worden afgezwakt.",
    idee: "Beste APY geschaald tussen p10–p90 (0..1).",
  },
  {
    indicator: "Marktbreedte (Breadth)",
    uitleg: "Hoeveel van de coins tegelijk in de plus staan. Deze waarde is hetzelfde voor alle coins.",
    idee: "Aantal ‘groene’ coins ÷ totaal aantal coins.",
  },
  {
    indicator: "Fear & Greed",
    uitleg: "Sentiment-indicator die angst of hebzucht meet in de markt. Deze waarde is hetzelfde voor alle coins.",
    idee: "50 = neutraal; extreem hoog/laag → lagere score richting 0.",
  },
];

export default function Indicators() {
  return (
    <>
      <Head>
        <title>Uitleg indicatoren · Crypto Stoplicht</title>
      </Head>

      <main className="p-6 max-w-6xl mx-auto">
        {/* Topbar */}
        <div className="mb-6 flex items-center justify-between">
          <Link href="/" className="link">← Terug</Link>
          <Link href="/" className="link text-sky-400 hover:text-sky-300">
            Naar overzicht
          </Link>
        </div>

        {/* Header */}
        <header className="mb-6">
          <h1 className="hero">Uitleg indicatoren</h1>
          <p className="text-lg text-white/80 mt-2">
            ➝ Het totaaladvies is <b>gericht op de korte termijn (1–3 dagen)</b> en wordt gebouwd op <b>1-uur candles</b>.
          </p>
        </header>

        {/* Tabel */}
        <section className="table-card overflow-x-auto">
          <table className="min-w-full text-sm align-top">
            <thead className="text-white/60">
              <tr>
                <th className="text-left py-2 w-[22%]">Indicator</th>
                <th className="text-left py-2 w-[48%]">Uitleg (één zin)</th>
                <th className="text-left py-2 w-[30%]">Simpel rekenidee</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.indicator} className="border-t border-white/5">
                  <td className="py-3 pr-4 font-semibold">{r.indicator}</td>
                  <td className="py-3 pr-4 text-white/90">{r.uitleg}</td>
                  <td className="py-3 text-white/70">{r.idee}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Tip card */}
        <section className="table-card mt-6">
          <h3 className="font-bold mb-2">Hoe lees je het totaaladvies?</h3>
          <p className="text-sm text-white/80">
            We schalen elke indicator naar <b>0..1</b> en wegen ze volgens de ingestelde percentages.
            De gewogen score (0..100) vertaalt naar <span className="badge-buy">BUY</span>,{" "}
            <span className="badge-hold">HOLD</span> of <span className="badge-sell">SELL</span>.
          </p>
        </section>

        {/* Footer */}
        <footer className="mt-8 text-white/60 text-sm">
          <p>
            Bronnen: Binance Futures, TradingView-signalen, Alternative.me (FNG), DeFiLlama.  
            Dit is géén financieel advies.
          </p>
        </footer>
      </main>
    </>
  );
}