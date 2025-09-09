// src/pages/disclaimer.tsx
import Link from 'next/link'
import Head from 'next/head'

export default function DisclaimerPage() {
  const today = new Date().toLocaleDateString('nl-NL', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <>
      <Head>
        <title>Disclaimer · Crypto Tracker</title>
      </Head>

      <main className="p-6 max-w-6xl mx-auto">
        {/* Topbar (zelfde opbouw als indicators) */}
        <div className="mb-6 flex items-center justify-between">
          <Link href="/" className="link">← Terug</Link>
          <Link href="/" className="link text-sky-400 hover:text-sky-300">
            Naar overzicht
          </Link>
        </div>

        {/* Header */}
        <header className="mb-6">
          <h1 className="hero">Disclaimer</h1>
          <p className="text-white/70 text-sm mt-2">
            Laatst bijgewerkt: {today}
          </p>
        </header>

        {/* Inhoud in een table-card, met duidelijke secties */}
        <section className="table-card">
          <div className="space-y-5">
            <div className="space-y-2">
              <h3 className="font-bold">Geen financieel advies</h3>
              <p className="text-sm text-white/80 leading-relaxed">
                De informatie, signalen en indicatoren op deze website zijn uitsluitend bedoeld voor informatieve en educatieve
                doeleinden. Niets op deze site is (of mag worden opgevat als) financieel advies, beleggingsadvies, handelsadvies,
                juridisch advies of belastingadvies.
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="font-bold">Geen aanbeveling of klantrelatie</h3>
              <p className="text-sm text-white/80 leading-relaxed">
                BUY/HOLD/SELL-labels, scores, heatmaps, prijsinformatie of andere outputs vormen geen persoonlijke aanbeveling of
                uitnodiging tot aan- of verkoop van enig instrument of cryptovaluta. Door het gebruik van deze site ontstaat geen
                advies- of vermogensbeheerrelatie.
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="font-bold">Risico’s van crypto</h3>
              <p className="text-sm text-white/80 leading-relaxed">
                Handel in crypto is speculatief en volatiel; je kunt (een aanzienlijk deel van) je inleg verliezen. Neem alleen
                beslissingen die passen bij je kennis, doelen en risicobereidheid. Overweeg onafhankelijk advies van een bevoegd
                adviseur.
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="font-bold">Databronnen, nauwkeurigheid en beschikbaarheid</h3>
              <p className="text-sm text-white/80 leading-relaxed">
                Prijzen, nieuws, sentiment, volumes en andere gegevens kunnen afkomstig zijn van derden en/of geautomatiseerde
                systemen. Er kunnen fouten, vertragingen, onderbrekingen en onnauwkeurigheden optreden. Er wordt geen enkele
                garantie gegeven op juistheid, volledigheid, tijdigheid of beschikbaarheid.
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="font-bold">Automatische signalen &amp; latency</h3>
              <p className="text-sm text-white/80 leading-relaxed">
                Signalen kunnen achterlopen op de markt of onderhevig zijn aan kwaliteitsissues (false positives/negatives).
                Resultaten kunnen afwijken per beurs of handelspaar.
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="font-bold">Prestaties uit het verleden</h3>
              <p className="text-sm text-white/80 leading-relaxed">
                Resultaten of signalen uit het verleden bieden geen garantie voor de toekomst.
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="font-bold">Eigen verantwoordelijkheid</h3>
              <p className="text-sm text-white/80 leading-relaxed">
                Je bent zelf volledig verantwoordelijk voor je handelsbeslissingen en voor het controleren van informatie voordat
                je handelt. De eigenaar/beheerder van deze site aanvaardt geen aansprakelijkheid voor verlies, schade of kosten die
                voortvloeien uit gebruik van (of vertrouwen op) deze site.
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="font-bold">Beperking van aansprakelijkheid</h3>
              <p className="text-sm text-white/80 leading-relaxed">
                Voor zover wettelijk toegestaan is iedere aansprakelijkheid uitgesloten, zowel direct als indirect, inclusief (maar
                niet beperkt tot) winstderving, verlies van data, opportunity loss, of gevolg-/bijzondere schade.
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="font-bold">Vrijwaring</h3>
              <p className="text-sm text-white/80 leading-relaxed">
                Je vrijwaart de site-eigenaar en diens medewerkers tegen aanspraken van derden die verband houden met jouw gebruik
                van de site of schending van deze voorwaarden.
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="font-bold">Regelgeving, belastingen en leeftijd</h3>
              <p className="text-sm text-white/80 leading-relaxed">
                Je bent zelf verantwoordelijk voor naleving van lokale wet- en regelgeving, KYC/AML-verplichtingen en fiscale
                verplichtingen. Deze site is niet bedoeld voor minderjarigen.
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="font-bold">Geen verplichting tot bijwerken</h3>
              <p className="text-sm text-white/80 leading-relaxed">
                Inhoud, indicatoren en datasets kunnen zonder voorafgaande kennisgeving worden gewijzigd, tijdelijk of permanent
                worden onderbroken, of worden beëindigd.
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="font-bold">Intellectuele eigendom</h3>
              <p className="text-sm text-white/80 leading-relaxed">
                Alle inhoud, code en vormgeving zijn beschermd door toepasselijke rechten. Hergebruik is alleen toegestaan conform de
                vermelde licentie(s) of met schriftelijke toestemming.
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="font-bold">Toepasselijk recht en forum</h3>
              <p className="text-sm text-white/80 leading-relaxed">
                Op deze disclaimer en het gebruik van de site is Nederlands recht van toepassing. Geschillen worden voorgelegd aan
                de bevoegde rechter te Amsterdam, tenzij dwingend recht anders bepaalt.
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="font-bold">Wijzigingen</h3>
              <p className="text-sm text-white/80 leading-relaxed">
                Deze disclaimer kan periodiek worden aangepast. Raadpleeg altijd de meest recente versie op deze pagina.
              </p>
            </div>
          </div>
        </section>

        {/* Footer (zelfde sfeer als indicators) */}
        <footer className="mt-8 text-white/60 text-sm">
          <p>Dit is géén financieel advies.</p>
        </footer>
      </main>
    </>
  )
}