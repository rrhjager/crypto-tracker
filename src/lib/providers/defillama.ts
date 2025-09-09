// src/lib/providers/defillama.ts
type LlamaPool = {
  chain: string
  project: string
  symbol: string
  tvlUsd: number
  apyBase?: number | null
  apyReward?: number | null
  apy?: number | null
  pool?: string
  url?: string
  stablecoin?: boolean
}

const ALIASES: Record<string, string[]> = {
  BTC: ['BTC', 'WBTC', 'CBBTC'],
  ETH: ['ETH', 'WETH', 'STETH', 'WEETH', 'WBETH'],
  BNB: ['BNB', 'WBNB'],
  XRP: ['XRP', 'CBXRP'],
  ADA: ['ADA', 'ADAI'],
  SOL: ['SOL', 'JITOSOL', 'MSOL', 'JUPSOL', 'BSOL', 'bSOL'],
  DOGE: ['DOGE', 'WDOGE'],
  TON: ['TON'],
  TRX: ['TRX', 'sTRX'],
  AVAX: ['AVAX', 'WAVAX', 'SAVAX'],
}

const CACHE_MS = 60_000

// Cache de HELE dataset 60s zodat we maar 1 network call doen
let _allCache: { ts: number; data: LlamaPool[] } | null = null
async function getAllPools(): Promise<LlamaPool[]> {
  const now = Date.now()
  if (_allCache && now - _allCache.ts < CACHE_MS) return _allCache.data
  const r = await fetch('https://yields.llama.fi/pools', { cache: 'no-store' })
  if (!r.ok) return _allCache?.data ?? []
  const j = await r.json().catch(() => null)
  const data: LlamaPool[] = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : []
  _allCache = { ts: now, data }
  return data
}

function normSymbol(sym: string) {
  return (sym || '').toUpperCase().trim()
}
function buildMatchers(symbol: string) {
  const key = normSymbol(symbol)
  const list = ALIASES[key] ?? [key]
  const re = new RegExp(
    `(?:^|[^A-Z])(${list.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?:[^A-Z]|$)`,
    'i'
  )
  return { list, re }
}
function isFiniteNum(x: any) {
  return typeof x === 'number' && Number.isFinite(x)
}

export async function topPoolsForSymbol(symbol: string, opts?: {
  minTvlUsd?: number
  maxPools?: number
}): Promise<LlamaPool[]> {
  try {
    const minTvlUsd = Math.max(0, opts?.minTvlUsd ?? 5_000_000)   // ≥ $5m TVL
    const maxPools  = Math.max(1, Math.min(6, opts?.maxPools ?? 3)) // top 3 (max 6)

    const all = await getAllPools()
    const key = normSymbol(symbol)
    const { re } = buildMatchers(key)

    const filtered = all
      .filter((p: any) => {
        const tvlOk = isFiniteNum(p?.tvlUsd) && p.tvlUsd >= minTvlUsd
        if (!tvlOk) return false
        const sym = String(p?.symbol || '')
        if (!sym || !re.test(sym)) return false

        const apy = isFiniteNum(p?.apy)
          ? p.apy as number
          : (isFiniteNum(p?.apyBase) || isFiniteNum(p?.apyReward))
              ? Number(p?.apyBase || 0) + Number(p?.apyReward || 0)
              : NaN

        return Number.isFinite(apy) && apy >= 0 && apy < 200
      })
      .map((p: any) => {
        const apy = isFiniteNum(p?.apy)
          ? Number(p.apy)
          : Number(p?.apyBase || 0) + Number(p?.apyReward || 0)
        return {
          chain: p.chain,
          project: p.project,
          symbol: p.symbol,
          tvlUsd: Number(p.tvlUsd || 0),
          apyBase: isFiniteNum(p.apyBase) ? Number(p.apyBase) : undefined,
          apyReward: isFiniteNum(p.apyReward) ? Number(p.apyReward) : undefined,
          apy: Number(apy),
          pool: p.pool,
          url: p.url,
          stablecoin: p.stablecoin === true,
        } as LlamaPool
      })

    // dedupe + sorteer APY desc → TVL desc
    const dedup = new Map<string, LlamaPool>()
    for (const p of filtered) {
      const id = p.pool || `${p.project}:${p.chain}:${p.symbol}:${p.tvlUsd}`
      if (!dedup.has(id)) dedup.set(id, p)
    }
    return Array.from(dedup.values())
      .sort((a, b) => (b.apy ?? 0) - (a.apy ?? 0) || (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0))
      .slice(0, maxPools)
  } catch {
    return []
  }
}