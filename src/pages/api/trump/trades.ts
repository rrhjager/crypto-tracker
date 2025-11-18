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
  { actor: "DJT insiders",      cik: CIK.DJT_MEDIA,    ticker: "DJT" },
  { actor: "Dominari insiders", cik: CIK.DOMH,         ticker: "DOMH" },
  { actor: "Hut 8 insiders",    cik: CIK.HUT,          ticker: "HUT" },
  { actor: "Donald Trump Jr.",  cik: CIK.TRUMP_JR,     ticker: "DOMH" },
  { actor: "Eric Trump",        cik: CIK.ERIC_TRUMP,   ticker: "HUT" },
  { actor: "Lara Trump",        cik: CIK.LARA_TRUMP,   ticker: "DJT" },
];

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

// Heel simpele XML-parser met regex (geen nieuwe dependency nodig)
function firstMatch(xml: string, regex: RegExp): string | null {
  const m = xml.match(regex);
  return m && m[1] ? m[1].trim() : null;
}

// Alle <tr>…</tr> → rijen met plain-text cellen
function extractTableRows(html: string): string[][] {
  const rows: string[][] = [];
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;

  while ((m = trRegex.exec(html)) !== null) {
    const rowHtml = m[1];
    const cells: string[] = [];
    const tdRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let c: RegExpExecArray | null;

    while ((c = tdRegex.exec(rowHtml)) !== null) {
      let text = c[1]
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      cells.push(text);
    }

    if (cells.length > 0) rows.push(cells);
  }

  return rows;
}

// HTML-Form 4 parser op basis van kolom-headers (“Title of Security”, “Transaction Date”, enz.)
function parseHtmlForm4Table(
  html: string,
  baseCompany: string,
  ticker: string,
  actor: string
): Trade[] {
  const trades: Trade[] = [];
  const rows = extractTableRows(html);
  if (rows.length === 0) return trades;

  let headerIdx = -1;
  let titleIdx = -1;
  let dateIdx = -1;
  let codeIdx = -1;
  let sharesIdx = -1;
  let priceIdx = -1;
  let adIdx = -1;

  // Zoek header-rij met de typische Form 4-kolommen
  for (let i = 0; i < rows.length; i++) {
    const lower = rows[i].map((c) => c.toLowerCase());
    const joined = lower.join(" ");
    if (joined.includes("title of security") && joined.includes("transaction date")) {
      headerIdx = i;
      for (let j = 0; j < lower.length; j++) {
        const col = lower[j];
        if (col.includes("title of security")) titleIdx = j;
        else if (col.includes("transaction date")) dateIdx = j;
        else if (col.includes("transaction code")) codeIdx = j;
        else if (
          col.includes("amount of securities") ||
          col.includes("number of shares") ||
          col.includes("amount acquired") ||
          col.includes("amount disposed")
        )
          sharesIdx = j;
        else if (col.includes("price") && col.includes("share")) priceIdx = j;
        else if (col.includes("acquired") && col.includes("disposed")) adIdx = j;
      }
      break;
    }
  }

  if (headerIdx === -1 || titleIdx === -1 || dateIdx === -1) {
    // Geen bruikbare tabel gevonden
    return trades;
  }

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    // stop als rij helemaal leeg is
    if (row.every((c) => !c || !c.trim())) continue;

    const title = row[titleIdx] || "";
    if (!/common/i.test(title)) continue; // we willen Common Stock

    const date = dateIdx >= 0 ? row[dateIdx] || "" : "";

    const code = codeIdx >= 0 ? row[codeIdx] || "" : "";
    const sharesRaw = sharesIdx >= 0 ? row[sharesIdx] || "" : "";
    const priceRaw = priceIdx >= 0 ? row[priceIdx] || "" : "";
    const adRaw = adIdx >= 0 ? row[adIdx] || "" : "";

    const shares = sharesRaw
      ? Number(sharesRaw.replace(/[^0-9.\-]/g, ""))
      : null;
    const price = priceRaw
      ? Number(priceRaw.replace(/[^0-9.\-]/g, ""))
      : null;
    const value =
      shares != null && price != null ? Number((shares * price).toFixed(2)) : null;

    let type: Trade["type"] = "Other";
    const flag = adRaw.trim().toUpperCase();
    if (flag === "A") type = "Buy";
    else if (flag === "D") type = "Sell";

    const transactionDesc = `Form 4: ${code || "transaction"} (${flag || "-"})`;

    trades.push({
      actor,
      company: baseCompany,
      ticker,
      date,
      transaction: transactionDesc,
      shares,
      price,
      value,
      type,
    });
  }

  return trades;
}

/**
 * Probeert eerst de “echte” XML-structuur (<nonDerivativeTransaction>).
 * Als dat niks oplevert, valt terug op HTML-tabel van xslF345X05
 * en probeert daar Common Stock-transacties uit te lezen.
 */
function parseTransactionsFromXml(
  xml: string,
  baseCompany: string,
  ticker: string,
  actor: string
): Trade[] {
  const trades: Trade[] = [];

  // 1) Oudere Form 4-XML
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

    if (trades.length > 0) return trades;
  }

  // 2) Nieuwe HTML-Form 4 viewer (xslF345X05/rdgdoc.xml)
  return parseHtmlForm4Table(xml, baseCompany, ticker, actor);
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