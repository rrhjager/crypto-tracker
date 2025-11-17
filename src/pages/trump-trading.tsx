// src/pages/trump-trading.tsx
import Head from 'next/head'
import NewsFeed from '@/components/NewsFeed'

type TrumpVehicle = {
  id: string
  category: string
  name: string
  ticker?: string
  type: string
  exposure: string
  keyInsight: string
  dataSources: string[]
  updateFrequency: string
  reliability: '★☆☆☆☆' | '★★☆☆☆' | '★★★☆☆' | '★★★★☆' | '★★★★★'
  tags: string[]
}

const VEHICLES: TrumpVehicle[] = [
  {
    id: 'djt',
    category: 'Equity',
    name: 'Trump Media & Technology Group',
    ticker: 'DJT',
    type: 'US small/mid-cap, high volatility',
    exposure: 'Direct equity exposure for Donald J. Trump (meerderheidsbelang via trust).',
    keyInsight:
      'Belangrijkste beursgenoteerde hefboom op Trumps persoonlijke vermogen. Koers reageert extreem sterk op politiek nieuws, rechtszaken en social media.',
    dataSources: ['SEC EDGAR (8-K, S-1, Form 4)', 'Google News', 'Market data API'],
    updateFrequency: 'Dagelijks / intraday',
    reliability: '★★★★★',
    tags: ['Equity', 'Media', 'Campaign-linked', 'High risk']
  },
  {
    id: 'domh',
    category: 'Equity',
    name: 'Dominari Holdings',
    ticker: 'DOMH',
    type: 'US micro-cap broker/financial',
    exposure: 'Bestuurs- en aandelenbelang van Donald Jr. en Eric Trump.',
    keyInsight:
      'Aandeel steeg >300% rond instap Trump-zonen; extreem illiquide. Bewegingsrichting wordt sterk bepaald door nieuwsflow, niet fundamentals.',
    dataSources: ['SEC EDGAR (13D/G)', 'Company press releases', 'Google News'],
    updateFrequency: 'Wekelijks / bij nieuws',
    reliability: '★★★★☆',
    tags: ['Micro-cap', 'Illiquid', 'Trump Jr. & Eric']
  },
  {
    id: 'umac',
    category: 'Equity',
    name: 'Unusual Machines',
    ticker: 'UMAC',
    type: 'Drone/defense, SPAC-achtige structuur',
    exposure: 'Advisory/board-rol(len) rond Don Jr. (afhankelijk van de periode).',
    keyInsight:
      'Hype- en nieuwsgevoelig defensie/tech-aandeel. Volatiliteit kan oplopen rond deals, overnames of nieuwe contracten.',
    dataSources: ['SEC EDGAR', 'Reuters / persberichten', 'Google News'],
    updateFrequency: 'Wekelijks',
    reliability: '★★★☆☆',
    tags: ['Defense', 'SPAC-style', 'High beta']
  },
  {
    id: 'american-bitcoin',
    category: 'Crypto / mining',
    name: 'American Bitcoin Corp',
    ticker: undefined,
    type: 'Private bitcoin miner',
    exposure: 'Eric Trump als Chief Strategy Officer / strategische rol.',
    keyInsight:
      'Privé-miner met exposure aan BTC-prijs en energiekosten. Geen directe ticker, maar effect loopt via partners én via on-chain mining-data.',
    dataSources: ['Company releases', 'Arkham Intelligence', 'Dune Analytics'],
    updateFrequency: 'Dagelijks',
    reliability: '★★★☆☆',
    tags: ['Private', 'Mining', 'BTC-linked']
  },
  {
    id: 'hut8',
    category: 'Crypto / mining',
    name: 'Hut 8 Mining',
    ticker: 'HUT',
    type: 'Publieke bitcoin miner',
    exposure: 'Partner/mining-counterparty van Trump-gelieerd American Bitcoin.',
    keyInsight:
      'Liquidere proxy voor het mijnsegment waar de Trump-zonen zich op richten. Koers beweegt grotendeels mee met BTC + sectornieuws.',
    dataSources: ['SEC EDGAR', 'On-chain mining metrics', 'Google News'],
    updateFrequency: 'Dagelijks',
    reliability: '★★★★☆',
    tags: ['Mining', 'BTC', 'Listed']
  },
  {
    id: 'oge-portfolio',
    category: 'Disclosure',
    name: 'Trump OGE disclosure-portfolio',
    ticker: undefined,
    type: 'Muni bonds, ETFs, losse aandelen',
    exposure: 'Vermeld in OGE Form 278e als persoonlijke bezittingen van Donald J. Trump.',
    keyInsight:
      'Toont conservatiever deel van zijn vermogen (obligaties, brede ETFs). Transacties worden nauwelijks realtime gemeld—insight is vooral asset-mix, geen actieve tradingfeed.',
    dataSources: ['OGE.gov (Form 278e)', 'OpenSecrets API'],
    updateFrequency: 'Jaarlijks',
    reliability: '★★★★★',
    tags: ['Disclosure', 'Municipal bonds', 'ETFs']
  },
  {
    id: 'sentiment',
    category: 'Sentiment',
    name: 'Retail sentiment: “Trump stock” / “DJT stock”',
    ticker: undefined,
    type: 'Search- & social-data',
    exposure: 'Zoekopdrachten en social buzz rond Trump-gerelateerde tickers.',
    keyInsight:
      'Spikes in zoekvolume en Reddit/nieuws-discussie lopen vaak voor op grote koerssprongen in DJT en micro-caps.',
    dataSources: ['Google Trends', 'Reddit', 'AltIndex / soortgelijk'],
    updateFrequency: 'Dagelijks',
    reliability: '★★★☆☆',
    tags: ['Sentiment', 'Early warning']
  }
]

export default function TrumpTradingPage() {
  return (
    <>
      <Head>
        <title>Trump Trading — SignalHub</title>
        <meta
          name="description"
          content="Gestructureerde inzichten in aandelen, crypto, on-chain data en disclosures rond Donald Trump en familie — volledig in SignalHub-stijl."
        />
      </Head>

      <main className="min-h-screen">
        {/* Hero + uitleg */}
        <section className="max-w-6xl mx-auto px-4 pt-16 pb-10">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500 mb-2">
            Special topic
          </p>
          <h1 className="hero">Trump Trading</h1>
          <p className="mt-3 max-w-2xl text-sm md:text-base text-slate-600">
            Geen fanboy-copytrading, maar een datagedreven overzicht van waar Trump en zijn familie
            economisch aan blootgesteld zijn: equities, crypto, on-chain mining data en officiële
            disclosures (OGE, SEC EDGAR, Arkham, OpenSecrets).
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <span className="badge bg-blue-50 text-blue-700 ring-1 ring-blue-200">
              Equities &amp; micro-caps
            </span>
            <span className="badge bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
              Crypto &amp; mining
            </span>
            <span className="badge bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200">
              On-chain + disclosures
            </span>
            <span className="badge bg-amber-50 text-amber-700 ring-1 ring-amber-200">
              Breaking media moments
            </span>
          </div>
        </section>

        {/* Key vehicles */}
        <section className="max-w-6xl mx-auto px-4 pb-12">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg md:text-xl font-semibold tracking-tight">
              Belangrijkste Trump-exposure in de markt
            </h2>
            <span className="hidden md:inline-flex text-[11px] px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
              Curated insights · geen financieel advies
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-600 max-w-3xl">
            Dit blok geeft je per vehikel een samenvatting van het type asset, hoe de Trump-familie
            eraan blootgesteld is, wat de kern van het verhaal is en welke databronnen je in de
            gaten moet houden.
          </p>

          <div className="mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {VEHICLES.map((v) => (
              <article key={v.id} className="table-card flex flex-col h-full">
                <header className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-slate-900 leading-snug">
                      {v.name}
                      {v.ticker && (
                        <span className="ml-2 text-xs font-mono text-slate-500 align-middle">
                          ({v.ticker})
                        </span>
                      )}
                    </h3>
                    <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-400">
                      {v.category}
                    </p>
                  </div>
                  <span className="text-[11px] text-slate-500 text-right leading-tight">
                    Reliability
                    <br />
                    <span className="font-mono">{v.reliability}</span>
                  </span>
                </header>

                <p className="mt-3 text-sm text-slate-700">{v.exposure}</p>
                <p className="mt-2 text-sm text-slate-700">{v.keyInsight}</p>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {v.tags.map((tag) => (
                    <span
                      key={tag}
                      className="badge bg-slate-50 text-slate-700 ring-1 ring-slate-200"
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100">
                  <p className="text-[11px] font-medium text-slate-500 mb-1">
                    Kern-databronnen ({v.updateFrequency})
                  </p>
                  <ul className="space-y-0.5">
                    {v.dataSources.map((src) => (
                      <li key={src} className="text-xs text-slate-600">
                        • {src}
                      </li>
                    ))}
                  </ul>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* Breaking media + nieuws via bestaande NewsFeed-component */}
        <section className="max-w-6xl mx-auto px-4 pb-14">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg md:text-xl font-semibold tracking-tight">
              Breaking: Trump-linked headlines
            </h2>
            <span className="badge bg-red-50 text-red-700 ring-1 ring-red-200">
              Live via Google News
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-600 max-w-3xl">
            Deze feeds halen de laatste koppen op rond de belangrijkste tickers. Zie het als
            startpunt om spikes in volume of volatiliteit snel te koppelen aan nieuws.
          </p>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <div className="table-card">
              <h3 className="font-semibold text-slate-900">Trump Media (DJT)</h3>
              <p className="mt-1 text-xs text-slate-500">
                Headlines en breaking news rond Trump Media &amp; Technology Group.
              </p>
              <div className="mt-3">
                <NewsFeed symbol="DJT" name="Trump Media & Technology Group (DJT)" limit={6} />
              </div>
            </div>

            <div className="table-card">
              <h3 className="font-semibold text-slate-900">Dominari &amp; mining (DOMH / HUT)</h3>
              <p className="mt-1 text-xs text-slate-500">
                Nieuws over Dominari Holdings (DOMH) en Hut 8 Mining (HUT) als proxies voor
                Trump-gelieerde micro-cap en mining-exposure.
              </p>
              <div className="mt-3 space-y-4">
                <div>
                  <p className="text-[11px] font-medium text-slate-500 mb-1">DOMH news</p>
                  <NewsFeed symbol="DOMH" name="Dominari Holdings (DOMH)" limit={3} />
                </div>
                <div>
                  <p className="text-[11px] font-medium text-slate-500 mb-1">HUT news</p>
                  <NewsFeed symbol="HUT" name="Hut 8 Mining (HUT)" limit={3} />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* On-chain + datamethodologie */}
        <section className="max-w-6xl mx-auto px-4 pb-16">
          <div className="grid gap-6 md:grid-cols-2">
            <article className="table-card">
              <h2 className="font-semibold text-slate-900 text-lg">
                On-chain &amp; crypto-signalen
              </h2>
              <p className="mt-2 text-sm text-slate-700">
                Gebruik on-chain tools om wallets en mining-activiteit rond Trump-gelieerde
                projecten te volgen. Het doel is niet om individuele adressen te “doxxen”, maar om
                kapitaalstromen en gedrag op hoog niveau te begrijpen.
              </p>
              <ul className="mt-3 space-y-1.5 text-sm text-slate-700">
                <li>• Arkham Intelligence voor gelabelde wallets (Trump Jr., mining-partners).</li>
                <li>
                  • Dune Analytics dashboards voor tokenflows, mining-uitbetalingen en holdings per
                  adrescluster.
                </li>
                <li>
                  • Glassnode / soortgelijk voor macro on-chain metrics (miner flows, reserves, hash
                  rate).
                </li>
              </ul>
              <p className="mt-3 text-xs text-slate-500">
                Let op: on-chain labels zijn niet altijd 100% bevestigd. Gebruik ze als indicatief
                signaal, niet als harde grondslag.
              </p>
            </article>

            <article className="table-card">
              <h2 className="font-semibold text-slate-900 text-lg">Disclosures &amp; methodologie</h2>
              <p className="mt-2 text-sm text-slate-700">
                De inzichten op deze pagina zijn gebaseerd op officiële disclosures en
                publiek-toegankelijke datasets. Een mogelijke workflow:
              </p>
              <ol className="mt-3 space-y-1.5 text-sm text-slate-700 list-decimal list-inside">
                <li>
                  <strong>OGE &amp; OpenSecrets</strong> · haal de nieuwste Form 278e van Trump op
                  en parse de holdings.
                </li>
                <li>
                  <strong>SEC EDGAR</strong> · volg 8-K&apos;s, S-1&apos;s en Form 4 voor DJT en
                  andere gerelateerde tickers.
                </li>
                <li>
                  <strong>OpenSecrets / FEC</strong> · koppel politieke geldstromen aan sectoren en
                  bedrijven.
                </li>
                <li>
                  <strong>News &amp; sentiment</strong> · gebruik Google News + social data om
                  “event windows” rond grote headlines te markeren.
                </li>
              </ol>
              <p className="mt-3 text-xs text-slate-500">
                Deze pagina is bedoeld als startpunt voor eigen research. Combineer altijd meerdere
                bronnen voor je conclusies trekt.
              </p>
            </article>
          </div>
        </section>
      </main>
    </>
  )
}