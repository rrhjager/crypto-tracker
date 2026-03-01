#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]
    if (!raw.startsWith('--')) continue
    const key = raw.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      out[key] = 'true'
      continue
    }
    out[key] = next
    i += 1
  }
  return out
}

function usage() {
  console.error(
    [
      'Usage:',
      '  node scripts/forecast-eval.mjs --symbol ASML.AS --asset-type equity --horizon 14 [--market AEX]',
      '',
      'Optional:',
      '  --base-url http://localhost:3000',
      '  --fee-bps-equity 10',
      '  --fee-bps-crypto 20',
      '  --slippage-bps 10',
      '  --out ./tmp/forecast-evals/asml-14d.json',
    ].join('\n'),
  )
}

function mustString(value, label) {
  if (!value || typeof value !== 'string') {
    throw new Error(`Missing ${label}`)
  }
  return value
}

function safeNum(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help === 'true' || args.h === 'true') {
    usage()
    process.exit(0)
  }

  const symbol = mustString(args.symbol, '--symbol')
  const assetType = mustString(args['asset-type'], '--asset-type').toLowerCase()
  if (assetType !== 'equity' && assetType !== 'crypto') {
    throw new Error('--asset-type must be equity or crypto')
  }

  const horizon = safeNum(args.horizon, NaN)
  if (![7, 14, 30].includes(horizon)) {
    throw new Error('--horizon must be 7, 14 or 30')
  }

  const baseUrl = String(args['base-url'] || 'http://localhost:3000').replace(/\/+$/, '')
  const feeBpsEquity = safeNum(args['fee-bps-equity'], 10)
  const feeBpsCrypto = safeNum(args['fee-bps-crypto'], 20)
  const slippageBps = safeNum(args['slippage-bps'], 10)
  const market = typeof args.market === 'string' ? args.market.trim() : ''

  const params = new URLSearchParams({
    symbol,
    assetType,
    horizon: String(horizon),
    fee_bps_equity: String(feeBpsEquity),
    fee_bps_crypto: String(feeBpsCrypto),
    slippage_bps: String(slippageBps),
  })

  if (market) params.set('market', market)

  const url = `${baseUrl}/api/forecast?${params.toString()}`
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'signalhub-forecast-eval/1.0',
    },
  })

  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`Non-JSON response from ${url}: ${text.slice(0, 200)}`)
  }

  if (!res.ok) {
    throw new Error(data?.error || `HTTP ${res.status}`)
  }

  const outPath =
    typeof args.out === 'string' && args.out.trim()
      ? args.out.trim()
      : path.join(process.cwd(), 'tmp', 'forecast-evals', `${symbol.replace(/[^A-Z0-9._-]+/gi, '_')}-${assetType}-${horizon}d.json`)

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')

  const summary = {
    symbol: data.symbol,
    assetType: data.assetType,
    horizon: data.horizon,
    action: data.action,
    probUp: data.probUp,
    confidence: data.confidence,
    expectedReturn: data.expectedReturn,
    regime: data.regime,
    auc: data.evaluation?.classification?.auc ?? null,
    hitRate: data.evaluation?.strategy?.hitRate ?? null,
    avgTradeReturnPct: data.evaluation?.strategy?.avgTradeReturnPct ?? null,
    turnover: data.evaluation?.strategy?.turnover ?? null,
    savedTo: outPath,
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
}

main().catch((err) => {
  console.error(String(err?.message || err))
  usage()
  process.exit(1)
})
