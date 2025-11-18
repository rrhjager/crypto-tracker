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
  { actor: "DJT insiders",      cik: CIK.DJT_MEDIA,   ticker: "DJT" },
  { actor: "Dominari insiders", cik: CIK.DOMH,        ticker: "DOMH" },
  { actor: "Hut 8 insiders",    cik: CIK.HUT,         ticker: "HUT" },
  { actor: "Donald Trump Jr.",  cik: CIK.TRUMP_JR,    ticker: "DOMH" },
  { actor: "Eric Trump",        cik: CIK.ERIC_TRUMP,  ticker: "HUT" },
  { actor: "Lara Trump",        cik: CIK.LARA_TRUMP,  ticker: "DJT" },
];

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function firstMatch(xml: string, regex: RegExp): string | null {
  const m = xml.match(regex);
  return m && m[1] ? m[1].trim() : null;
}

/**
 * Parser voor Form 4:
 *
 * 1) Eerst proberen we de "oude" XML structuur met <nonDerivativeTransaction>.
 * 2) Als dat er niet is (xslF345X05 HTML-viewer), strippen we alle tags en
 *    zoeken we regels die eruit zien als:
 *
 *    COMMON STOCK 11/14/2025 P 10,000 A $3.4144 ...
 *
 *    - Datum:  mm/dd/yyyy
 *    - Code:   1–2 letters (P, S, M, etc.)
 *    - Shares: getal
 *    - A/D:    A of D  (Acquired / Disposed)
 *    - Price:  optioneel, $ 3.4144 of 3.4144
 */
function parseTransactionsFromXml(
  xml: string,
  baseCompany: string,
  ticker: string,
  actor: string
): Trade[] {
  const trades: Trade[] = [];

  // ── 1) Echte XML <nonDerivativeTransaction> (oudere Form 4 layouts)
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

      const adCode =
        firstMatch(
          section,
          /<transactionAcquiredDisposedCode>[\s\S]*?<value>([^<]+)<\/value>/i
        ) || "";

      const transCode =
        firstMatch(
          section,
          /<transactionCoding>[\s\S]*?<transactionCode>([^<]+)<\/transactionCode>/i
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

      const shares = sharesStr ? Number(sharesStr.replace(/,/g, "")) : null;
      const price = priceStr ? Number(priceStr.replace(/,/g, "")) : null;
      const value =
        shares != null && price != null
          ? Number((shares * price).toFixed(2))
          : null;

      let type: Trade["type"] = "Other";
      const flag = adCode.toUpperCase();
      if (flag === "A") type = "Buy";
      else if (flag === "D") type = "Sell";
      else if (transCode.toUpperCase() === "G") type = "Grant";

      const transaction =
        transCode || adCode
          ? `Form 4: ${transCode || adCode} (${flag || "-"})`
          : "Form 4 transaction";

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

    if (trades.length > 0) {
      return trades;
    }
  }

  // ── 2) Fallback: nieuwe HTML / xslF345X05 layout
  const text = xml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();

  // COMMON STOCK 11/14/2025 P 10,000 A $ 3.4144 10,544 D
  const COMMON_ROW_REGEX =
    /COMMON STOCK\s+(\d{2}\/\d{2}\/\d{4})\s+([A-Z]{1,2})\s+([\d,]+)\s+([AD])(?:\s+\$?\s*([\d.]+))?/gi;

  let m: RegExpExecArray | null;

  while ((m = COMMON_ROW_REGEX.exec(text)) !== null) {
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

    const transaction = `Form 4: ${transCode} (${flag || "-"})`;

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

  // Duplicaten eruit (kan gebeuren bij rare HTML / voetnoten)
  const dedupKey = (t: Trade) =>
    [
      t.actor,
      t.company,
      t.ticker,
      t.date,
      t.transaction,
      t.shares ?? "-",
      t.price ?? "-",
    ].join("|");

  const seen = new Set<string>();
  const unique: Trade[] = [];
  for (const t of trades) {
    const key = dedupKey(t);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(t);
  }

  return unique;
}

// Bouw SEC-URL naar de XML/HTML van een specifieke filing
function buildXmlUrl(cik: string, accession: string, primaryDoc: string): string {
  const cleanCik = cik.replace(/^0+/, "");
  const cleanAcc = accession.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cleanCik}/${cleanAcc}/${primaryDoc}`;
}

// ── Belangrijkste wijziging: ALLE Form-4’s in de laatste 12 maanden ophalen
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

  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const MAX_FORM4_PER_ACTOR = 80;
  let form4Count = 0;

  for (let i = 0; i < recent.accessionNumber.length; i++) {
    const form = recent.form[i];
    if (form !== "4") continue;

    const filingDateStr = recent.filingDate?.[i];
    if (filingDateStr) {
      const dt = new Date(filingDateStr);
      if (!Number.isNaN(dt.getTime()) && dt < oneYearAgo) {
        // arrays zijn newest-first → zodra we buiten 12m vallen kunnen we stoppen
        break;
      }
    }

    inspected++;
    form4Count++;
    if (form4Count > MAX_FORM4_PER_ACTOR) break;

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

      const parsed = parseTransactionsFromXml(
        xml,
        companyName,
        config.ticker,
        config.actor
      );
      trades.push(...parsed);
    } catch (err) {
      console.error("Error fetching Form 4 XML/HTML", xmlUrl, err);
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

    // sorteer op datum, nieuw → oud (met veilige Date-parse)
    all.sort((a, b) => {
      const da = new Date(a.date).getTime();
      const db = new Date(b.date).getTime();
      if (Number.isNaN(da) || Number.isNaN(db)) {
        return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
      }
      return db - da;
    });

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