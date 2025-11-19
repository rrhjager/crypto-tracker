// src/lib/edgar.ts
import { fetchSafe } from "@/lib/fetchSafe";

const SEC_HEADERS = {
  "User-Agent":
    process.env.SEC_USER_AGENT ||
    "SignalHub AI (contact: support@yourdomain.com)",
  "Accept-Encoding": "gzip, deflate",
  // Host-header is optioneel maar kan geen kwaad
  "Host": "www.sec.gov",
};

export async function fetchEdgarFilings(cik: string) {
  const url = `https://data.sec.gov/submissions/CIK${cik}.json`;

  try {
    const res = await fetchSafe(
      url,
      {
        method: "GET",
        headers: SEC_HEADERS,
      },
      8000,
      1
    );

    const json = await res.json();
    return json;
  } catch (err) {
    console.error("EDGAR fetch error:", err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// CIK codes voor alle bedrijven, personen en trust
// (verplicht voor jouw trades.ts)
// ─────────────────────────────────────────────────────────────

export const CIK = {
  // Bedrijven
  DJT_MEDIA: "0001890671",       // Trump Media & Technology Group
  DOMH: "0000746210",            // Oblong / Dominari
  HUT: "0001959633",             // Hut 8 Corp
  DWAC: "0001849635",            // Digital World Acquisition Corp.

  // Personen
  DONALD_TRUMP: "0000947033",
  MELANIA_TRUMP: "0001681540",
  TRUMP_JR: "0001762074",
  ERIC_TRUMP: "0001952100",
  IVANKA_TRUMP: "0001406847",
  JARED_KUSHNER: "0001614323",
  LARA_TRUMP: "0001680187",      // juiste CIK voor Lara

  // Trust
  DJT_TRUST: "0001345263",
};