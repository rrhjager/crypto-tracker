// src/pages/disclaimer.tsx
import Link from 'next/link'
import Head from 'next/head'

export default function DisclaimerPage() {
  const today = new Date().toLocaleDateString('en-US', {
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
        {/* Topbar */}
        <div className="mb-6 flex items-center justify-between">
          <Link href="/" className="link">← Back</Link>
          {/* Removed the right-side "Naar overzicht" button */}
        </div>

        {/* Header */}
        <header className="mb-6">
          <h1 className="hero">Disclaimer</h1>
          <p className="text-white/70 text-sm mt-2">
            Last updated: {today}
          </p>
        </header>

        {/* Content */}
        <section className="table-card">
          <div className="space-y-5">
            <div className="space-y-2">
              <h3 className="font-bold">No Financial Advice</h3>
              <p className="text-sm text-white/80 leading-relaxed">
                The information, signals, and indicators on this website are provided for informational and educational
                purposes only. Nothing on this site constitutes (or should be construed as) financial, investment,
                trading, legal, or tax advice.
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="font-bold">No Recommendation or Client Relationship</h3>
              <p className="text-sm text-white/80 leading-relaxed">
                BUY/HOLD/SELL labels, scores, heatmaps, price information or any other outputs are not a personal
                recommendation or an invitation to buy or sell any instrument or cryptocurrency. Using this site does
                not create an advisory or asset-management relationship.
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="font-bold">Risks of Crypto Assets</h3>
              <p className="text-sm text-white/80 leading-relaxed">
                Trading crypto assets is speculative and volatile; you can lose (a substantial part of) your capital.
                Make decisions that fit your knowledge, objectives, and risk tolerance. Consider seeking independent
                advice from a qualified professional.
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="font-bold">Data Sources, Accuracy & Availability</h3>
              <p className="text-sm text-white/80 leading-relaxed">
                Prices, news, sentiment, volumes and other data may come from third parties and/or automated systems.
                Errors, delays, interruptions and inaccuracies can occur. No warranty is given regarding accuracy,
                completeness, timeliness, or availability.
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="font-bold">Automated Signals & Latency</h3>
              <p className="text-sm text-white/80 leading-relaxed">
                Signals may lag the market or be subject to quality issues (false positives/negatives). Results may
                differ per exchange or trading pair.
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="font-bold">Past Performance</h3>
              <p className="text-sm text-white/80 leading-relaxed">
                Past results or signals are not indicative of future performance.
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="font-bold">Your Responsibility</h3>
              <p className="text-sm text-white/80 leading-relaxed">
                You are fully responsible for your trading decisions and for verifying information before you act.
                The owner/operator of this site accepts no liability for losses, damages, or costs arising from the use
                of (or reliance on) this site.
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="font-bold">Limitation of Liability</h3>
              <p className="text-sm text-white/80 leading-relaxed">
                To the extent permitted by law, any liability is excluded, whether direct or indirect, including (but
                not limited to) loss of profits, data loss, opportunity loss, or consequential/special damages.
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="font-bold">Indemnification</h3>
              <p className="text-sm text-white/80 leading-relaxed">
                You agree to indemnify and hold harmless the site owner and its affiliates from third-party claims
                related to your use of the site or your breach of these terms.
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="font-bold">Compliance, Taxes & Age</h3>
              <p className="text-sm text-white/80 leading-relaxed">
                You are responsible for complying with local laws and regulations, KYC/AML obligations, and tax
                requirements. This site is not intended for minors.
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="font-bold">No Obligation to Update</h3>
              <p className="text-sm text-white/80 leading-relaxed">
                Content, indicators, and datasets may be changed, suspended, or discontinued at any time without notice.
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="font-bold">Intellectual Property</h3>
              <p className="text-sm text-white/80 leading-relaxed">
                All content, code, and design are protected by applicable rights. Reuse is only permitted in accordance
                with the stated license(s) or with prior written permission.
              </p>
            </div>


            <div className="space-y-2">
              <h3 className="font-bold">Changes</h3>
              <p className="text-sm text-white/80 leading-relaxed">
                This disclaimer may be updated from time to time. Always refer to the most recent version on this page.
              </p>
            </div>
          </div>
        </section>

        {/* Footer note */}
        <footer className="mt-8 text-white/60 text-sm">
          <p>This is not financial advice.</p>
        </footer>
      </main>
    </>
  )
}