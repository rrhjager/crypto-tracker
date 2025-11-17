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

type DebugActor = {
  actor: string;
  cik: string;
  ticker: string;
  filingsCount: number;
  inspected: number;
  forms: string[];
  primaryDocs: string[];
  xmlUrls: string[];
  parsedTrades: number;
};

type TradesResponse = {
  updatedAt: number;
  trades: Trade[];
  debug?: DebugActor[];
};

type ActorConfig = {
  actor: string;
  cik: string;
  ticker: string;
};

// Mapping van personen/bedrijven naar CIK + ticker
const ACTORS: ActorConfig[] = [
  { actor: "DJT insiders",       cik: CIK.DJT_MEDIA,    ticker: "DJT" },
  { actor: "Dominari insiders",  cik: CIK.DOMH,         ticker: "DOMH" },
  { actor: "Hut 8 insiders",     cik: CIK.HUT,          ticker: "HUT" },
  { actor: "Donald Trump Jr.",   cik: CIK.TRUMP_JR,     ticker: "DOMH" },
  { actor: "Eric Trump",         cik: CIK.ERIC_TRUMP,   ticker: "HUT" },
  { actor: "Lara Trump",         cik: CIK.LARA_TRUMP,   ticker: "DJT" },
];

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

// Heel simpele XML-parser met regex (geen nieuwe dependency nodig)
function firstMatch(xml: string, regex: RegExp): string | null {
  const m = xml.match(regex);
  return m && m[1] ? m[1].trim() : null;
}

/**
 * Probeert eerst de “echte” XML-structuur (met <nonDerivativeTransaction>).
 * Als dat niks oplevert, valt terug op HTML-tekst uit de xslF345X05 viewer
 * en pakt daar de COMMON STOCK-rij met datum, hoeveelheid, A/D en prijs.
 */
function parseTransactionsFromXml(
  xml: string,
  baseCompany: string,
  ticker: string,
  actor: string
): Trade[] {
  const trades: Trade[] = [];

  // 1) Echte XML-structuur (oude Form 4 docs)
  if (/<nonDerivativeTransaction>/i.test(xml)) {
    const blocks = xml.split(/<nonDerivativeTransaction>/i).slice(1);
    for (const block of blocks) {
      const section = block.split(/<\/nonDerivativeTransaction>/i)[0] || "";

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

    if (trades.length > 0) {
      return trades;
    }
  }

  // 2) Fallback: HTML Form 4 (xslF345X05) → strip tags en parse tekstregel
  //    Voorbeeld tekst:
  //    "COMMON STOCK 11/14/2025 P 10,000 A $1.84 10,544 D"
  const text = xml
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const regex =
    /COMMON STOCK\s+(\d{2}\/\d{2}\/\d{4})\s+([A-Z])\s+([\d,]+)\s+([AD])\s+\$?([\d.]+)/gi;

  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const [, date, transCode, sharesStr, adFlag, priceStr] = m;

    const shares = sharesStr
      ? Number(sharesStr.replace(/,/g, ""))
      : null;
    const price = priceStr ? Number(priceStr) : null;
    const value =
      shares != null && price != null
        ? Number((shares * price).toFixed(2))
        : null;

    let type: Trade["type"] = "Other";
    const flag = (adFlag || "").toUpperCase();
    if (flag === "A") type = "Buy";
    else if (flag === "D") type = "Sell";

    const transaction = `Common stock transaction code ${transCode} (${flag})`;

    trades.push({
      actor,
      company: baseCompany,
      ticker,
      date,
      transaction,
      shares,
      price,
      value,
      type,
    });
  }

  return trades;
}

// Bouw SEC-URL naar de XML/HTML van een specifieke filing
function buildXmlUrl(cik: string, accession: string, primaryDoc: string): string {
  const cleanCik = cik.replace(/^0+/, "");
  const cleanAcc = accession.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cleanCik}/${cleanAcc}/${primaryDoc}`;
}

async function loadActorTrades(
  config: ActorConfig,
  debugCollector?: DebugActor[]
): Promise<Trade[]> {
  const filings = await fetchEdgarFilings(config.cik);
  if (!filings?.filings?.recent) return [];

  const recent = filings.filings.recent;
  const trades: Trade[] = [];

  const forms: string[] = [];
  const primaryDocs: string[] = [];
  const xmlUrls: string[] = [];
  let inspected = 0;

  const maxDocs = 10; // limiter per actor

  for (let i = 0; i < recent.accessionNumber.length && i < maxDocs; i++) {
    const form = recent.form[i];
    if (form !== "4") continue; // alleen Form 4
    inspected++;

    const accession = recent.accessionNumber[i];
    const primaryDoc = recent.primaryDocument[i];
    if (!primaryDoc) continue;

    const xmlUrl = buildXmlUrl(config.cik, accession, primaryDoc);
    forms.push(form);
    primaryDocs.push(primaryDoc);
    xmlUrls.push(xmlUrl);

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
          ? "Oblong, Inc."
          : config.ticker === "HUT"
          ? "Hut 8 Corp"
          : "Unknown issuer");

      const t = parseTransactionsFromXml(
        xml,
        companyName,
        config.ticker,
        config.actor
      );
      trades.push(...t);
    } catch (err) {
      console.error("Error fetching Form 4 XML", xmlUrl, err);
      continue;
    }
  }

  if (debugCollector) {
    debugCollector.push({
      actor: config.actor,
      cik: config.cik,
      ticker: config.ticker,
      filingsCount: recent.accessionNumber.length,
      inspected,
      forms,
      primaryDocs,
      xmlUrls,
      parsedTrades: trades.length,
    });
  }

  return trades;
}

// ─────────────────────────────────────────────────────────────
// API handler
// ─────────────────────────────────────────────────────────────

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<TradesResponse | { error: string }>
) {
  try {
    const withDebug =
      req.query.debug === "1" || req.query.debug === "true";

    const all: Trade[] = [];
    const debugActors: DebugActor[] = [];

    for (const cfg of ACTORS) {
      const t = await loadActorTrades(cfg, withDebug ? debugActors : undefined);
      all.push(...t);
    }

    // sorteer op datum, nieuw → oud
    all.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    res.setHeader(
      "Cache-Control",
      "public, s-maxage=600, stale-while-revalidate=300"
    );

    const payload: TradesResponse = {
      updatedAt: Date.now(),
      trades: all,
      ...(withDebug ? { debug: debugActors } : {}),
    };

    return res.status(200).json(payload);
  } catch (err: any) {
    console.error("TRUMP_TRADES_API_ERROR:", err?.message || err);
    return res.status(500).json({ error: "Failed to load EDGAR trades" });
  }
}