// src/pages/api/crypto-light/prices.ts
export const config = { runtime: 'nodejs' }

import type { NextApiRequest, NextApiResponse } from 'next'

// -------- Binance SYMBOLUSDT -> CoinGecko ID mapping --------
// Vul aan als je meer pairs gebruikt; dit dekt de meeste top coins.
const CG_ID: Record<string, string> = {
  BTCUSDT: 'bitcoin',
  ETHUSDT: 'ethereum',
  SOLUSDT: 'solana',
  BNBUSDT: 'binancecoin',
  XRPUSDT: 'ripple',
  ADAUSDT: 'cardano',
  DOGEUSDT: 'dogecoin',
  AVAXUSDT: 'avalanche-2',
  TRXUSDT: 'tron',
  LINKUSDT: 'chainlink',
  MATICUSDT: 'matic-network',
  DOTUSDT: 'polkadot',
  LTCUSDT: 'litecoin',
  BCHUSDT: 'bitcoin-cash',
  XLMUSDT: 'stellar',
  ATOMUSDT: 'cosmos',
  XMRUSDT: 'monero',
  FILUSDT: 'filecoin',
  APTUSDT: 'aptos',
  OPUSDT: 'optimism',
  ARBUSDT: 'arbitrum',
  NEARUSDT: 'near',
  HBARUSDT: 'hedera-hashgraph',
  INJUSDT: 'injective-protocol',
  SUIUSDT: 'sui',
  PEPEUSDT: 'pepe',
  SHIBUSDT: 'shiba-inu',
  ETCUSDT: 'ethereum-classic',
  ALGOUSDT: 'algorand',
  VETUSDT: 'vechain',
  EGLDUSDT: 'multiversx',
  IMXUSDT: 'immutable-x',
  GRTUSDT: 'the-graph',
  STXUSDT: 'stacks',
  RUNEUSDT: 'thorchain',
  RNDRUSDT: 'render-token',
  AAVEUSDT: 'aave',
  MKRUSDT: 'maker',
  UNIUSDT: 'uniswap',
  SANDUSDT: 'the-sandbox',
  MANAUSDT: 'decentraland',
  PYTHUSDT: 'pyth-network',
  JUPUSDT: 'jupiter-exchange-solana',
  SEIUSDT: 'sei-network',
  BONKUSDT: 'bonk',
};

type Row =
  | { symbol: string; price: number|null; d: number|null; w: number|null; m: number|null }
  | { symbol: string; error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const symbolsParam = String(req.query.symbols || '').trim();
    if (!symbolsParam) return res.status(400).json({ error: 'Missing ?symbols=BTCUSDT,ETHUSDT' });

    const symbols = symbolsParam
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);

    // Map naar CoinGecko IDs; bewaar volgorde en noteer ongedekte symbols
    const ids: string[] = [];
    const missing = new Set<string>();
    for (const sym of symbols) {
      const id = CG_ID[sym];
      if (id) ids.push(id);
      else missing.add(sym);
    }

    let cg: any = {};
    if (ids.length > 0) {
      const url =
        'https://api.coingecko.com/api/v3/simple/price'
        + `?ids=${encodeURIComponent(ids.join(','))}`
        + `&vs_currencies=usd`
        + `&include_24hr_change=true`
        + `&price_change_percentage=${encodeURIComponent('7d,30d')}`;

      const r = await fetch(url, {
        headers: {
          // voorkom caching upstream die onhandig lang blijft hangen
          'cache-control': 'no-cache',
          // kleine UA kan soms helpen bij strikte CDNs
          'user-agent': 'SignalHub/1.0; (+https://example.com)',
        },
      });
      if (!r.ok) {
        // CoinGecko rate-limit of outage → val netjes terug met lege map
        cg = {};
      } else {
        cg = await r.json();
      }
    }

    const results: Row[] = symbols.map(sym => {
      const id = CG_ID[sym];
      const data = id ? cg?.[id] : null;

      if (!id) {
        return { symbol: sym, error: 'No CoinGecko mapping' };
      }
      if (!data) {
        return { symbol: sym, error: 'No data from CoinGecko' };
      }

      // Coingecko keys bij simple/price:
      // - price: data.usd
      // - 24h: data.usd_24h_change (door include_24hr_change=true)
      // - 7d:  data.usd_7d_change   (door price_change_percentage=7d,30d)
      // - 30d: data.usd_30d_change
      return {
        symbol: sym,
        price: isFinite(Number(data.usd)) ? Number(data.usd) : null,
        d: isFinite(Number(data.usd_24h_change)) ? Number(data.usd_24h_change) : null,
        w: isFinite(Number(data.usd_7d_change)) ? Number(data.usd_7d_change) : null,
        m: isFinite(Number(data.usd_30d_change)) ? Number(data.usd_30d_change) : null,
      };
    });

    // cache kort, met SWR
    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
    return res.status(200).json({ results });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Internal error' });
  }
}