// src/pages/api/trump/trades.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { fetchSafe } from "@/lib/fetchSafe";
import { fetchEdgarFilings, CIK } from "@/lib/edgar";

type Trade = {
  actor: string;
  company: string;
  ticker: string;
  date: string;
  transaction: string;
  shares: number | null;
  price: number | null;
  value: number | null;
  type: "Buy" | "Sell" | "Grant" | "Other";
};

type TradesResponse = {
  updatedAt: number;
  trades: Trade[];
};

type ActorConfig = {
  actor: string;
  cik: string;
  ticker: string;
};

// Mapping van personen/bedrijven naar CIK + ticker
const ACTORS: ActorConfig[] = [
  { actor: "DJT insiders",      cik: CIK.DJT_MEDIA,   ticker: "DJT" },
  { actor: "Dominari insiders", cik: CIK.DOMH,        ticker: "DOMH" },
  { actor: "Hut 8 insiders",    cik: CIK.HUT,         ticker: "HUT" },
  { actor: "Donald Trump Jr.",  cik: CIK.TRUMP_JR,    ticker: "DOMH" },
  { actor: "Eric Trump",        cik: CIK.ERIC_TRUMP,  ticker: "HUT" },
  { actor: "Lara Trump",        cik: CIK.LARA_TRUMP,  ticker: "DJT" },
];

// ─────────────────────────────────────────────────────────────
// Kleine XML-helpers (alleen voor Form 4)
// ─────────────────────────────────────────────────────────────
function firstMatch(xml: string, regex: RegExp): string | null {
  const m = xml.match(regex);
  return m && m[1] ? m[1].trim() : null;
}

// Haalt zowel non-derivative als derivative transacties uit de Form 4-XML
function parseTransactionsFromXml(
  xml: string,
  baseCompany: string,
  ticker: string,
  actor: string
): Trade[] {
  const trades: Trade[] = [];

  const TAGS = ["nonDerivativeTransaction", "derivativeTransaction"] as const;

  for (const tag of TAGS) {
    const open = new RegExp(`<${tag}>`, "i");
    const close = new RegExp(`</${tag}>`, "i");

    const blocks = xml.split(open).slice(1);
    for (const block of blocks) {
      const section = block.split(close)[0] || "";

      const date =
        firstMatch(
          section,
          /<transactionDate>[\s\S]*?<value>([^<]+)<\/value>/i
        ) ||
        firstMatch(xml, /<periodOfReport>([^<]+)<\/periodOfReport>/i) ||
        "";

      const code =
        firstMatch(
          section,
          /<transactionAcquiredDisposedCode>[\s\S]*?<value>([^<]+)<\/value>/i
        ) || "";

      const sharesStr =
        firstMatch(
          section,
          /<transactionShares>[\s\S]*?<value>([^<]+)<\/value>/i
        ) || null;

      const priceStr =
        firstMatch(
          section,
          /<transactionPricePerShare>[\s\S]*?<value>([^<]+)<\/value>/i
        ) || null;

      const transDesc =
        firstMatch(
          section,
          /<transactionCoding>[\s\S]*?<transactionCode>([^<]+)<\/transactionCode>/i
        ) || "Form 4 transaction";

      const shares = sharesStr ? Number(sharesStr.replace(/,/g, "")) : null;
      const price = priceStr ? Number(priceStr.replace(/,/g, "")) : null;
      const value =
        shares != null && price != null
          ? Number((shares * price).toFixed(2))
          : null;

      let type: Trade["type"] = "Other";
      const c = code.toUpperCase();
      if (c === "A" || c === "P") type = "Buy";     // A=acquired, P=purchase
      else if (c === "D" || c === "S") type = "Sell"; // D=disposed, S=sale
      else if (c === "G") type = "Grant";

      trades.push({
        actor,
        company: baseCompany,
        ticker,
        date,
        transaction: transDesc,
        shares,
        price,
        value,
        type,
      });
    }
  }

  return trades;
}

// Bouw SEC-URL naar de XML van een specifieke filing
function buildXmlUrl(cik: string, accession: string, primaryDoc: string): string {
  const cleanCik = cik.replace(/^0+/, "");
  const cleanAcc = accession.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cleanCik}/${cleanAcc}/${primaryDoc}`;
}

// Alleen voor ?debug=1: laat zien welke forms/docs er zijn
async function buildDebugSnapshot() {
  const debug: any[] = [];
  for (const cfg of ACTORS) {
    const filings = await fetchEdgarFilings(cfg.cik);
    if (!filings?.filings?.recent) {
      debug.push({
        actor: cfg.actor,
        cik: cfg.cik,
        ticker: cfg.ticker,
        hasFilings: false,
        filingsCount: 0,
        recentForms: [],
        primaryDocs: [],
      });
      continue;
    }
    const recent = filings.filings.recent;
    debug.push({
      actor: cfg.actor,
      cik: cfg.cik,
      ticker: cfg.ticker,
      hasFilings: true,
      filingsCount: recent.form.length,
      recentForms: recent.form.slice(0, 10),
      primaryDocs: recent.primaryDocument.slice(0, 10),
    });
  }
  return debug;
}

async function loadActorTrades(config: ActorConfig): Promise<Trade[]> {
  const filings = await fetchEdgarFilings(config.cik);
  if (!filings?.filings?.recent) return [];

  const recent = filings.filings.recent;
  const trades: Trade[] = [];
  const maxDocs = 10; // limiter per actor

  for (let i = 0; i < recent.accessionNumber.length && i < maxDocs; i++) {
    const form = recent.form[i];

    // Alleen echte Form 4’s pakken; 13G, 8-K etc. zijn geen trade logs
    if (form !== "4") continue;

    const accession = recent.accessionNumber[i];
    const primaryDoc = recent.primaryDocument[i];
    if (!primaryDoc) continue;

    const xmlUrl = buildXmlUrl(config.cik, accession, primaryDoc);

    try {
      const res = await fetchSafe(
        xmlUrl,
        {
          method: "GET",
          headers: {
            "User-Agent":
              process.env.SEC_USER_AGENT ||
              "SignalHub AI (contact: support@signalhub.tech)",
            "Accept-Encoding": "gzip, deflate",
          },
        },
        8000,
        0
      );
      if (!res.ok) continue;

      const xml = await res.text();
      const companyName =
        filings?.name ||
        (config.ticker === "DJT"
          ? "Trump Media & Technology Group"
          : config.ticker === "DOMH"
          ? "Dominari Holdings"
          : config.ticker === "HUT"
          ? "Hut 8 Corp"
          : "Unknown issuer");

      const parsed = parseTransactionsFromXml(
        xml,
        companyName,
        config.ticker,
        config.actor
      );

      // Fallback: als we om wat voor reden dan ook geen individuele transacties vinden,
      // maken we één “samenvattingsregel” zodat je de filing wél ziet.
      if (parsed.length === 0) {
        const date =
          firstMatch(xml, /<periodOfReport>([^<]+)<\/periodOfReport>/i) || "";
        trades.push({
          actor: config.actor,
          company: companyName,
          ticker: config.ticker,
          date,
          transaction: "Form 4 filed (no individual transactions parsed)",
          shares: null,
          price: null,
          value: null,
          type: "Other",
        });
      } else {
        trades.push(...parsed);
      }
    } catch (err) {
      console.error("Error fetching Form 4 XML", xmlUrl, err);
      continue;
    }
  }

  return trades;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<
    TradesResponse | { error: string } | { updatedAt: number; debug: any[] }
  >
) {
  try {
    // Debug-pad: alleen gebruikt als je zelf ?debug=1 in de URL zet
    if (req.query.debug === "1") {
      const debug = await buildDebugSnapshot();
      res.setHeader(
        "Cache-Control",
        "public, s-maxage=600, stale-while-revalidate=300"
      );
      return res.status(200).json({
        updatedAt: Date.now(),
        debug,
      });
    }

    // Normale flow voor de Trump Trading pagina
    const all: Trade[] = [];

    for (const cfg of ACTORS) {
      const t = await loadActorTrades(cfg);
      all.push(...t);
    }

    // sorteer op datum, nieuw → oud
    all.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    res.setHeader(
      "Cache-Control",
      "public, s-maxage=600, stale-while-revalidate=300"
    );

    return res.status(200).json({
      updatedAt: Date.now(),
      trades: all,
    });
  } catch (err: any) {
    console.error("TRUMP_TRADES_API_ERROR:", err?.message || err);
    return res.status(500).json({ error: "Failed to load EDGAR trades" });
  }
}