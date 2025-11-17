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
// Kleine XML-helper
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

  // Form 4 XMLs gebruiken meestal <nonDerivativeTable><nonDerivativeTransaction>…</…>
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

async function loadActorTrades(config: ActorConfig): Promise<Trade[]> {
  const filings = await fetchEdgarFilings(config.cik);
  if (!filings?.filings?.recent) return [];

  const recent = filings.filings.recent;

  const trades: Trade[] = [];
  const maxDocs = 8; // limiter per actor

  for (let i = 0; i < recent.accessionNumber.length && i < maxDocs; i++) {
    const form = recent.form[i];
    if (form !== "4") continue; // alleen Form 4

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

      const t = parseTransactionsFromXml(xml, companyName, config.ticker, config.actor);
      trades.push(...t);
    } catch (err) {
      console.error("Error fetching Form 4 XML", xmlUrl, err);
      continue;
    }
  }

  return trades;
}

// ─────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<
    TradesResponse | { error: string } | { updatedAt: number; debug: DebugSummary[] }
  >
) {
  const debug = req.query.debug === "1";

  try {
    // 1) DEBUG-MODUS: laat zien wat we van EDGAR krijgen per actor
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

          const count = recent.form.length;
          debugResult.push({
            actor: cfg.actor,
            cik: cfg.cik,
            ticker: cfg.ticker,
            hasFilings: true,
            filingsCount: count,
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

    // 2) NORMALE MODUS: echte trades parsen
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