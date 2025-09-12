// src/pages/api/v1/coins.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getCache } from '@/lib/cache';
import fs from 'fs/promises';
import path from 'path';

type CoinsPayload = any;

export const config = { maxDuration: 10 };

function setCacheHeaders(res: NextApiResponse, smaxage = 20, swr = 60) {
  const v = `public, s-maxage=${smaxage}, stale-while-revalidate=${swr}`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', v);
  res.setHeader('CDN-Cache-Control', v);
  res.setHeader('Vercel-CDN-Cache-Control', v);
}

function stripKaspa(payload: CoinsPayload): CoinsPayload {
  try {
    const results = Array.isArray(payload?.results)
      ? payload.results.filter((c: any) => {
          const sym = String(c?.symbol ?? '').toUpperCase();
          const slug = String(c?.slug ?? '').toLowerCase();
          return sym !== 'KAS' && sym !== 'KASPA' && slug !== 'kaspa';
        })
      : [];
    return { ...payload, results };
  } catch { return payload; }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // 1) Probeer warme snapshot (instant)
  const cached = getCache<CoinsPayload>('SUMMARY');
  if (cached?.results?.length) {
    setCacheHeaders(res, 20, 60);
    return res.status(200).json(stripKaspa(cached));
  }

  // 2) Cold start → fallback naar ingebakken bootstrap (ook instant)
  try {
    const file = path.join(process.cwd(), 'public', 'bootstrap.json');
    const raw = await fs.readFile(file, 'utf8');
    const bootstrap = JSON.parse(raw);
    setCacheHeaders(res, 10, 60);
    return res.status(200).json({ ...stripKaspa(bootstrap), stale: true, source: 'bootstrap' });
  } catch {
    // 3) Geen bootstrap aanwezig → lege maar geldige payload (UI blijft werken)
    setCacheHeaders(res, 5, 30);
    return res.status(200).json({ updatedAt: Date.now(), results: [], stale: true, source: 'empty' });
  }
}