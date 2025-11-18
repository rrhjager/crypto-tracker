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

type DebugSummary = {
  actor: string;
  cik: string;
  ticker: string;
  hasFilings: boolean;
  filingsCount: number;
  recentForms: string[];
  primaryDocs: string[];
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
// Kleine XML-helper (voor Form 4)
// ─────────────────────────────────────────────────────────────
function firstMatch(xml: string, regex: RegExp): string | null {
  const m = xml.match(regex);
  return m && m[1] ? m[1].trim() : null;
}

function parseTransactionsFromXml(
  xml: string,
  baseCompany: string,
  ticker: string,
  actor: string
): Trade[] {
  const trades: Trade[] = [];

  const blocks = xml.split(/<nonDerivativeTransaction>/i).slice(1);
  for (const block of blocks) {
    const section = block.split(/<\/nonDerivativeTransaction>/i)[0] || "";

    const date =
      firstMatch(section, /<transactionDate>[\s\S]*?<value>([^<]+)<\/value>/i) ||
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
      shares != null && price != null ? Number((shares * price).toFixed(2)) : null;

    let type: Trade["type"] = "Other";
    const c = code.toUpperCase();
    if (c === "A") type = "Buy";
    else if (c === "D") type = "Sell";
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

  return trades;
}

// Bouw SEC-URL naar de XML van een specifieke filing
function buildXmlUrl(cik: string, accession: string, primaryDoc: string): string {
  const cleanCik = cik.replace(/^0+/, "");
  const cleanAcc = accession.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cleanCik}/${cleanAcc}/${primaryDoc}`;
}

function resolveCompanyName(ticker: string, fallback?: string | null): string {
  if (fallback) return fallback;
  if (ticker === "DJT") return "Trump Media & Technology Group";
  if (ticker === "DOMH") return "Dominari Holdings";
  if (ticker === "HUT") return "Hut 8 Corp";
  return "Unknown issuer";
}

// ─────────────────────────────────────────────────────────────
// EDGAR laadlogica
// ─────────────────────────────────────────────────────────────
async function loadActorTrades(config: ActorConfig): Promise<Trade[]> {
  const filings = await fetchEdgarFilings(config.cik);
  if (!filings?.filings?.recent) return [];

  const recent = filings.filings.recent;
  const { accessionNumber, primaryDocument, form, filingDate } = recent;

  const trades: Trade[] = [];
  const maxDocs = 12; // limiter per actor

  for (let i = 0; i < form.length && i < maxDocs; i++) {
    const f = form[i];
    const primaryDoc = primaryDocument[i];
    const accession = accessionNumber[i];
    const date = (filingDate && filingDate[i]) || "";
    const companyName = resolveCompanyName(config.ticker, (filings as any).name);

    // Als het geen Form 4 is: laat het zien als disclosure filing
    if (f !== "4") {
      trades.push({
        actor: config.actor,
        company: companyName,
        ticker: config.ticker,
        date,
        transaction: `${f} filing (ownership / disclosure)`,
        shares: null,
        price: null,
        value: null,
        type: "Other",
      });
      continue;
    }

    // Voor Form 4 proberen we XML te parsen als het een XML-doc is
    if (!primaryDoc || !primaryDoc.toLowerCase().endsWith(".xml")) continue;

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
      const t = parseTransactionsFromXml(xml, companyName, config.ticker, config.actor);
      trades.push(...t);
    } catch (err) {
      console.error("Error fetching/parsing Form 4 XML", xmlUrl, err);
      continue;
    }
  }

  return trades;
}

// ─────────────────────────────────────────────────────────────
// Handler (met debug=1 modus)
// ─────────────────────────────────────────────────────────────
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<
    TradesResponse | { error: string } | { updatedAt: number; debug: DebugSummary[] }
  >
) {
  const debug = req.query.debug === "1";

  try {
    // DEBUG: laat alleen per actor zien welke forms/docs er zijn
    if (debug) {
      const debugResult: DebugSummary[] = [];

      for (const cfg of ACTORS) {
        try {
          const filings = await fetchEdgarFilings(cfg.cik);
          const recent = filings?.filings?.recent;

          if (!recent) {
            debugResult.push({
              actor: cfg.actor,
              cik: cfg.cik,
              ticker: cfg.ticker,
              hasFilings: !!filings,
              filingsCount: 0,
              recentForms: [],
              primaryDocs: [],
            });
            continue;
          }

          debugResult.push({
            actor: cfg.actor,
            cik: cfg.cik,
            ticker: cfg.ticker,
            hasFilings: true,
            filingsCount: recent.form.length,
            recentForms: recent.form.slice(0, 10),
            primaryDocs: recent.primaryDocument.slice(0, 10),
          });
        } catch (e: any) {
          console.error("DEBUG fetchEdgarFilings error:", cfg, e?.message || e);
          debugResult.push({
            actor: cfg.actor,
            cik: cfg.cik,
            ticker: cfg.ticker,
            hasFilings: false,
            filingsCount: 0,
            recentForms: [],
            primaryDocs: [],
          });
        }
      }

      res.setHeader(
        "Cache-Control",
        "public, s-maxage=60, stale-while-revalidate=30"
      );

      return res.status(200).json({
        updatedAt: Date.now(),
        debug: debugResult,
      });
    }

    // NORMAAL pad: trades voor frontend
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