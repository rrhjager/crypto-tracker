// src/lib/sensex.ts
export type StockMeta = { symbol: string; name: string };

/**
 * SENSEX (India) – startersset. Je kunt dit lijstje eenvoudig uitbreiden.
 * We gebruiken hier de veelgebruikte NSE/Yahoo Finance suffix .NS
 * (werkt doorgaans beter dan .BO). Voeg gerust extra constituents toe.
 */
export const SENSEX: StockMeta[] = [
  { symbol: 'RELIANCE.NS',   name: 'Reliance Industries' },
  { symbol: 'TCS.NS',        name: 'Tata Consultancy Services' },
  { symbol: 'HDFCBANK.NS',   name: 'HDFC Bank' },
  { symbol: 'ICICIBANK.NS',  name: 'ICICI Bank' },
  { symbol: 'INFY.NS',       name: 'Infosys' },
  { symbol: 'ITC.NS',        name: 'ITC' },
  { symbol: 'HINDUNILVR.NS', name: 'Hindustan Unilever' },
  { symbol: 'SBIN.NS',       name: 'State Bank of India' },
  { symbol: 'BHARTIARTL.NS', name: 'Bharti Airtel' },
  { symbol: 'LT.NS',         name: 'Larsen & Toubro' },
  { symbol: 'AXISBANK.NS',   name: 'Axis Bank' },
  { symbol: 'HCLTECH.NS',    name: 'HCL Technologies' },
  { symbol: 'ASIANPAINT.NS', name: 'Asian Paints' },
  { symbol: 'KOTAKBANK.NS',  name: 'Kotak Mahindra Bank' },
  { symbol: 'MARUTI.NS',     name: 'Maruti Suzuki' },
  { symbol: 'BAJFINANCE.NS', name: 'Bajaj Finance' },
  { symbol: 'NTPC.NS',       name: 'NTPC' },
  { symbol: 'SUNPHARMA.NS',  name: 'Sun Pharma' },
  { symbol: 'POWERGRID.NS',  name: 'Power Grid' },
  { symbol: 'ULTRACEMCO.NS', name: 'UltraTech Cement' },
  { symbol: 'TITAN.NS',      name: 'Titan' },
  { symbol: 'NESTLEIND.NS',  name: 'Nestlé India' },
  { symbol: 'WIPRO.NS',      name: 'Wipro' },
  { symbol: 'ONGC.NS',       name: 'ONGC' },
  { symbol: 'JSWSTEEL.NS',   name: 'JSW Steel' },
  { symbol: 'TATAMOTORS.NS', name: 'Tata Motors' },
  { symbol: 'TATASTEEL.NS',  name: 'Tata Steel' },
  { symbol: 'TECHM.NS',      name: 'Tech Mahindra' },
];