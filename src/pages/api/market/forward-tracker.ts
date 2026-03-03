export const config = { runtime: 'nodejs' }

import type { NextApiRequest, NextApiResponse } from 'next'
import {
  syncForwardTracker,
  type ForwardAssetType,
  type ForwardSourceMode,
  type ForwardStrategy,
  type ForwardTrackerResponse,
} from '@/lib/forwardTracker'

type ErrorResp = { error: string }

function parseAssetType(raw: string | string[] | undefined): ForwardAssetType {
  const value = String(Array.isArray(raw) ? raw[0] : raw || 'equity').trim().toLowerCase()
  return value === 'crypto' ? 'crypto' : 'equity'
}

function parseSourceMode(raw: string | string[] | undefined): ForwardSourceMode | undefined {
  const value = String(Array.isArray(raw) ? raw[0] : raw || '')
    .trim()
    .toLowerCase()
  if (value === 'audit' || value === 'fallback' || value === 'raw') return value
  return undefined
}

function parseStrategy(raw: string | string[] | undefined): ForwardStrategy {
  const value = String(Array.isArray(raw) ? raw[0] : raw || '')
    .trim()
    .toLowerCase()
  if (value === 'best_single_5x') return 'best_single_5x'
  if (value === 'best_single_2x') return 'best_single_2x'
  if (value === 'best_single') return 'best_single'
  if (value === 'high_move_relaxed') return 'high_move_relaxed'
  return value === 'high_move' ? 'high_move' : 'standard'
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ForwardTrackerResponse | ErrorResp>) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    res.setHeader('Cache-Control', 'no-store')
    const assetType = parseAssetType(req.method === 'GET' ? req.query.assetType : (req.body?.assetType as string | undefined))
    const sourceMode = parseSourceMode(req.method === 'GET' ? req.query.sourceMode : (req.body?.sourceMode as string | undefined))
    const strategy = parseStrategy(req.method === 'GET' ? req.query.strategy : (req.body?.strategy as string | undefined))
    const data = await syncForwardTracker(req, assetType, sourceMode, strategy)
    return res.status(200).json(data)
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
