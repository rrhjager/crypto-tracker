// src/pages/explanation-indicators.tsx
import Link from "next/link"

export default function ExplanationIndicators() {
  return (
    <main className="max-w-4xl mx-auto p-6">
      <header className="mb-6">
        <h1 className="hero">Explanation of Indicators</h1>
        <p className="sub">How we derive BUY / HOLD / SELL and the overall score</p>
      </header>

      {/* Intro */}
      <section className="table-card p-4 mb-6">
        <p className="text-sm text-white/80">
          On this page you’ll find a short, practical explanation of the indicators we calculate for
          both <b>crypto</b> and <b>stocks</b>. Each indicator yields a directional signal
          (BUY/HOLD/SELL) and a normalized sub-score. We then combine these into one
          overall score (0–100). Finally, the overall score is mapped to:
          <span className="ml-1 badge-buy">BUY</span> if <b>≥ 66</b>,
          <span className="ml-2 badge-hold">HOLD</span> if <b>34–65</b>,
          <span className="ml-2 badge-sell">SELL</span> if <b>≤ 33</b>.
        </p>
      </section>

      {/* =================== CRYPTO =================== */}
      <section className="mb-8">
        <h2 className="text-xl font-bold mb-3">Crypto — Indicators & Weights</h2>

        <div className="table-card p-4 space-y-4">
          <div>
            <h3 className="font-semibold">1) MA50 vs MA200 (Golden/Death Cross)</h3>
            <p className="text-sm text-white/80">
              We compare the 50-day Moving Average (MA50) with the 200-day Moving Average (MA200).
              If MA50 &gt; MA200, this is structurally bullish (Golden Cross). If MA50 &lt; MA200,
              it’s bearish (Death Cross). We also look at how large the spread is.
            </p>
          </div>

          <div>
            <h3 className="font-semibold">2) RSI (14)</h3>
            <p className="text-sm text-white/80">
              Relative Strength Index on a 14-period basis (daily close). Above ~70 is overbought
              (tends to SELL), below ~30 is oversold (tends to BUY). Between 30–70 is neutral.
            </p>
          </div>

          <div>
            <h3 className="font-semibold">3) MACD (12/26/9)</h3>
            <p className="text-sm text-white/80">
              Moving Average Convergence Divergence with fast=12, slow=26, signal=9. We use the
              histogram’s sign (MACD – Signal). Positive histogram implies BUY bias, negative implies SELL.
            </p>
          </div>

          <div>
            <h3 className="font-semibold">4) Volume vs 20-day Average</h3>
            <p className="text-sm text-white/80">
              Compares current volume to the 20-day average (ratio). Higher-than-average participation
              supports the move (BUY if clearly &gt; 1, SELL if clearly &lt; 1).
            </p>
          </div>

          <div className="pt-2 border-t border-white/10">
            <h3 className="font-semibold">Weighting (Crypto)</h3>
            <ul className="list-disc ml-5 text-sm text-white/80">
              <li>MA50 vs MA200: <b>35%</b></li>
              <li>RSI (14): <b>25%</b></li>
              <li>MACD (12/26/9): <b>25%</b></li>
              <li>Volume vs 20d avg: <b>15%</b></li>
            </ul>
            <p className="text-sm text-white/70 mt-2">
              These weights reflect structural trend (MA), momentum (RSI & MACD) and participation (Volume).
            </p>
          </div>
        </div>
      </section>

      {/* =================== STOCKS =================== */}
      <section className="mb-8">
        <h2 className="text-xl font-bold mb-3">Stocks — Indicators & Weights</h2>

        <div className="table-card p-4 space-y-4">
          <div>
            <h3 className="font-semibold">1) MA50 vs MA200 (Golden/Death Cross)</h3>
            <p className="text-sm text-white/80">
              Same logic as for crypto. Structural trend dominates the stock composite as well.
            </p>
          </div>

          <div>
            <h3 className="font-semibold">2) RSI (14)</h3>
            <p className="text-sm text-white/80">
              Overbought (&gt; 70) tends to SELL, oversold (&lt; 30) tends to BUY, neutral in between.
            </p>
          </div>

          <div>
            <h3 className="font-semibold">3) MACD (12/26/9)</h3>
            <p className="text-sm text-white/80">
              We use MACD vs Signal and the histogram’s sign for directional bias.
            </p>
          </div>

          <div>
            <h3 className="font-semibold">4) Volume vs 20-day Average</h3>
            <p className="text-sm text-white/80">
              Participation confirmation: sustained moves with above-average volume score higher.
            </p>
          </div>

          <div className="pt-2 border-t border-white/10">
            <h3 className="font-semibold">Weighting (Stocks)</h3>
            <ul className="list-disc ml-5 text-sm text-white/80">
              <li>MA50 vs MA200: <b>40%</b></li>
              <li>MACD (12/26/9): <b>30%</b></li>
              <li>RSI (14): <b>20%</b></li>
              <li>Volume vs 20d avg: <b>10%</b></li>
            </ul>
            <p className="text-sm text-white/70 mt-2">
              This emphasizes structural trend and medium-term momentum, with lighter weight on volume noise.
            </p>
          </div>
        </div>
      </section>

      {/* Mapping */}
      <section className="table-card p-4">
        <h2 className="text-lg font-bold mb-2">How the overall rating is mapped</h2>
        <p className="text-sm text-white/80">
          We combine the weighted sub-scores into one number from 0 to 100. The status is:
        </p>
        <ul className="list-disc ml-5 mt-2 text-sm text-white/80">
          <li><b>BUY</b> if score ≥ 66</li>
          <li><b>HOLD</b> if 34 ≤ score ≤ 65</li>
          <li><b>SELL</b> if score ≤ 33</li>
        </ul>
        <p className="text-sm text-white/60 mt-3">
          Note: indicators are not guarantees. They are tools to summarize trend, momentum and participation.
          Always consider broader context and risk management.
        </p>
      </section>

      {/* Back link */}
      <div className="mt-6">
        <Link href="/" className="btn btn-secondary">← Back to homepage</Link>
      </div>
    </main>
  )
}