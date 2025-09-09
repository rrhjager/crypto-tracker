// src/lib/coins.ts
export type Coin = {
  symbol: string;
  name: string;
  slug?: string;            // optioneel; default = symbol.toLowerCase()
  santimentSlug?: string;   // optioneel fallback
  pairUSD: {
    binance?: string;       // bv. "BTCUSDT"
  };
};

// Let op: géén stablecoins (USDT/USDC/BUSD/FDUSD/TUSD/DAI).
export const COINS: Coin[] = [
  // Top 10 (je huidige set)
  { symbol: "BTC",  name: "Bitcoin",        pairUSD: { binance: "BTCUSDT"  } },
  { symbol: "ETH",  name: "Ethereum",       pairUSD: { binance: "ETHUSDT"  } },
  { symbol: "BNB",  name: "BNB",            pairUSD: { binance: "BNBUSDT"  } },
  { symbol: "SOL",  name: "Solana",         pairUSD: { binance: "SOLUSDT"  } },
  { symbol: "XRP",  name: "XRP",            pairUSD: { binance: "XRPUSDT"  } },
  { symbol: "ADA",  name: "Cardano",        pairUSD: { binance: "ADAUSDT"  } },
  { symbol: "DOGE", name: "Dogecoin",       pairUSD: { binance: "DOGEUSDT" } },
  { symbol: "TRX",  name: "TRON",           pairUSD: { binance: "TRXUSDT"  } },
  { symbol: "TON",  name: "Toncoin",        pairUSD: { binance: "TONUSDT"  } },
  { symbol: "AVAX", name: "Avalanche",      pairUSD: { binance: "AVAXUSDT" } },

  // Verder naar ± top 50 (ex stables)
  { symbol: "SHIB", name: "Shiba Inu",        pairUSD: { binance: "SHIBUSDT" } },
  { symbol: "DOT",  name: "Polkadot",         pairUSD: { binance: "DOTUSDT"  } },
  { symbol: "BCH",  name: "Bitcoin Cash",     pairUSD: { binance: "BCHUSDT"  } },
  { symbol: "LTC",  name: "Litecoin",         pairUSD: { binance: "LTCUSDT"  } },
  { symbol: "LINK", name: "Chainlink",        pairUSD: { binance: "LINKUSDT" } },
  { symbol: "MATIC",name: "Polygon",          pairUSD: { binance: "MATICUSDT"} },
  { symbol: "UNI",  name: "Uniswap",          pairUSD: { binance: "UNIUSDT"  } },
  { symbol: "ICP",  name: "Internet Computer",pairUSD: { binance: "ICPUSDT"  } },
  { symbol: "NEAR", name: "NEAR Protocol",    pairUSD: { binance: "NEARUSDT" } },
  { symbol: "APT",  name: "Aptos",            pairUSD: { binance: "APTUSDT"  } },
  { symbol: "OP",   name: "Optimism",         pairUSD: { binance: "OPUSDT"   } },
  { symbol: "ARB",  name: "Arbitrum",         pairUSD: { binance: "ARBUSDT"  } },
  { symbol: "XLM",  name: "Stellar",          pairUSD: { binance: "XLMUSDT"  } },
  { symbol: "FIL",  name: "Filecoin",         pairUSD: { binance: "FILUSDT"  } },
  { symbol: "VET",  name: "VeChain",          pairUSD: { binance: "VETUSDT"  } },
  { symbol: "ATOM", name: "Cosmos",           pairUSD: { binance: "ATOMUSDT" } },
  { symbol: "HBAR", name: "Hedera",           pairUSD: { binance: "HBARUSDT" } },
  { symbol: "AAVE", name: "Aave",             pairUSD: { binance: "AAVEUSDT" } },
  { symbol: "MKR",  name: "Maker",            pairUSD: { binance: "MKRUSDT"  } },
  { symbol: "SUI",  name: "Sui",              pairUSD: { binance: "SUIUSDT"  } },
  { symbol: "RNDR", name: "Render",           pairUSD: { binance: "RNDRUSDT" } },
  { symbol: "IMX",  name: "Immutable",        pairUSD: { binance: "IMXUSDT"  } },
  { symbol: "INJ",  name: "Injective",        pairUSD: { binance: "INJUSDT"  } },
  { symbol: "ALGO", name: "Algorand",         pairUSD: { binance: "ALGOUSDT" } },
  { symbol: "QNT",  name: "Quant",            pairUSD: { binance: "QNTUSDT"  } },
  { symbol: "THETA",name: "Theta Network",    pairUSD: { binance: "THETAUSDT"} },
  { symbol: "GRT",  name: "The Graph",        pairUSD: { binance: "GRTUSDT"  } },
  { symbol: "FLOW", name: "Flow",             pairUSD: { binance: "FLOWUSDT" } },
  { symbol: "CHZ",  name: "Chiliz",           pairUSD: { binance: "CHZUSDT"  } },
  { symbol: "MANA", name: "Decentraland",     pairUSD: { binance: "MANAUSDT" } },
  { symbol: "SAND", name: "The Sandbox",      pairUSD: { binance: "SANDUSDT" } },
  { symbol: "AXS",  name: "Axie Infinity",    pairUSD: { binance: "AXSUSDT"  } },
  { symbol: "DYDX", name: "dYdX",             pairUSD: { binance: "DYDXUSDT" } },
  { symbol: "STX",  name: "Stacks",           pairUSD: { binance: "STXUSDT"  } },
  { symbol: "KAS",  name: "Kaspa",            pairUSD: { binance: "KASUSDT"  } },
  { symbol: "SEI",  name: "Sei",              pairUSD: { binance: "SEIUSDT"  } },
  { symbol: "PEPE", name: "Pepe",             pairUSD: { binance: "PEPEUSDT" } },
  { symbol: "BONK", name: "Bonk",             pairUSD: { binance: "BONKUSDT" } },
  { symbol: "JASMY",name: "JasmyCoin",        pairUSD: { binance: "JASMYUSDT"} },
  { symbol: "FTM",  name: "Fantom",           pairUSD: { binance: "FTMUSDT"  } },
  { symbol: "AR",   name: "Arweave",          pairUSD: { binance: "ARUSDT"   } },
  { symbol: "ROSE", name: "Oasis Network",    pairUSD: { binance: "ROSEUSDT" } },
  { symbol: "KAVA", name: "Kava",             pairUSD: { binance: "KAVAUSDT" } },
  { symbol: "EGLD", name: "MultiversX (Elrond)", pairUSD: { binance: "EGLDUSDT" } },
  { symbol: "XEC",  name: "eCash",            pairUSD: { binance: "XECUSDT"  } },
  { symbol: "IOTA", name: "IOTA",             pairUSD: { binance: "IOTAUSDT" } },
  { symbol: "RUNE", name: "THORChain",        pairUSD: { binance: "RUNEUSDT" } },
  { symbol: "PYTH", name: "Pyth Network",     pairUSD: { binance: "PYTHUSDT" } },
  { symbol: "JUP",  name: "Jupiter",          pairUSD: { binance: "JUPUSDT"  } },
];