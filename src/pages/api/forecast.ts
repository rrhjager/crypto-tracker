export const config = { runtime: 'nodejs' }

import type { NextApiRequest, NextApiResponse } from 'next'
import { cache5min } from '@/lib/cacheHeaders'
import { kvGetJSON, kvSetJSON } from '@/lib/kv'
import { buildForecast, type ForecastAssetType, type ForecastHorizon, type ForecastOutput } from '@/lib/forecastEngine'

type ErrorResp = { error: string }

const TTL_SEC = 300
const FORECAST_VER = 'v1'

function parseAssetType(raw: string | string[] | undefined): ForecastAssetType {
  const value = String(Array.isArray(raw) ? raw[0] : raw || 'equity').trim().toLowerCase()
  return value === 'crypto' ? 'crypto' : 'equity'
}

function parseHorizon(raw: string | string[] | undefined): ForecastHorizon {
  const value = Number(Array.isArray(raw) ? raw[0] : raw || 14)
  if (value === 7 || value === 14 || value === 30) return value
  return 14
}

function parseNum(raw: string | string[] | undefined, fallback: number) {
  const value = Number(Array.isArray(raw) ? raw[0] : raw)
  return Number.isFinite(value) ? value : fallback
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ForecastOutput | ErrorResp>) {
  try {
    cache5min(res, 300, 1800)

    const symbol = String(Array.isArray(req.query.symbol) ? req.query.symbol[0] : req.query.symbol || '').trim().toUpperCase()
    if (!symbol) return res.status(400).json({ error: 'Missing symbol' })

    const assetType = parseAssetType(req.query.assetType)
    const horizon = parseHorizon(req.query.horizon)
    const marketHint = String(Array.isArray(req.query.market) ? req.query.market[0] : req.query.market || '').trim() || null
    const feeBpsEquity = parseNum(req.query.fee_bps_equity, 10)
    const feeBpsCrypto = parseNum(req.query.fee_bps_crypto, 20)
    const slippageBps = parseNum(req.query.slippage_bps, 10)

    const kvKey = [
      'forecast',
      FORECAST_VER,
      assetType,
      symbol,
      horizon,
      marketHint || 'auto',
      feeBpsEquity,
      feeBpsCrypto,
      slippageBps,
    ].join(':')

    const cached = await kvGetJSON<ForecastOutput>(kvKey)
    if (cached) {
      res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=1800')
      return res.status(200).json(cached)
    }

    const forecast = await buildForecast({
      symbol,
      assetType,
      horizon,
      marketHint,
      feeBpsEquity,
      feeBpsCrypto,
      slippageBps,
    })

    await kvSetJSON(kvKey, forecast, TTL_SEC)
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=1800')
    return res.status(200).json(forecast)
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
