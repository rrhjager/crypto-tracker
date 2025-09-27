// src/state/indicatorCache.ts
import { create } from 'zustand'

export type Status = 'BUY' | 'HOLD' | 'SELL'

// Dit is exact het shape dat je al gebruikt in crypto.tsx (IndResp)
export type IndResp = {
  symbol: string
  ma?: { ma50: number | null; ma200: number | null; cross: 'Golden Cross' | 'Death Cross' | '—' }
  rsi?: number | null
  macd?: { macd: number | null; signal: number | null; hist: number | null }
  volume?: { volume: number | null; avg20d: number | null; ratio: number | null }
  score?: number
  status?: Status
  error?: string
}

type Entry = { updatedAt: number; data: IndResp }

// ---- STORE ----
type State = {
  bySymbol: Record<string, Entry>
  upsert: (symbol: string, data: IndResp) => void
  get: (symbol: string) => Entry | undefined
  reset: () => void
}

export const useIndicatorStore = create<State>((set, get) => ({
  bySymbol: {},
  upsert: (symbol, data) =>
    set(s => {
      const sym = String(symbol || '').toUpperCase()
      s.bySymbol = { ...s.bySymbol, [sym]: { updatedAt: Date.now(), data } }
    }),
  get: (symbol) => {
    const sym = String(symbol || '').toUpperCase()
    return get().bySymbol[sym]
  },
  reset: () => set({ bySymbol: {} }),
}))

// Selectors als hooks
export function useIndicatorMap() {
  return useIndicatorStore(s => s.bySymbol)
}
export function useIndicator(symbol?: string | null) {
  const sym = (symbol || '').toUpperCase()
  return useIndicatorStore(s => (sym ? s.bySymbol[sym] : undefined))
}

// ---- PREFETCH HELPERS (client-side) ----
async function fetchOne(symbol: string, { signal }: { signal?: AbortSignal } = {}) {
  const key = `/api/crypto-light/indicators?symbols=${encodeURIComponent(symbol)}`
  const r = await fetch(key, { signal })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const j = (await r.json()) as { results?: IndResp[] }
  const row = j?.results?.[0]
  if (!row) throw new Error('Empty result')
  useIndicatorStore.getState().upsert(symbol, row)
  return row
}

/**
 * Prefetch queue met beperkte concurrency + eenvoudige 429-backoff.
 * - concurrency: max aantal gelijktijdige requests
 * - startDelayMs: kleine delay om eerste paint niet te blokkeren
 */
export async function prefetchIndicatorsQueue(
  symbols: string[],
  opts: { concurrency?: number; startDelayMs?: number } = {}
) {
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 3, 6))
  const startDelayMs = opts.startDelayMs ?? 250
  const pending = [...new Set(symbols.map(s => String(s || '').toUpperCase()).filter(Boolean))]
  if (pending.length === 0) return

  // mini delay na mount
  await new Promise(r => setTimeout(r, startDelayMs))

  let i = 0
  const workers: Promise<void>[] = []
  const controller = new AbortController()

  const worker = async () => {
    while (i < pending.length) {
      const sym = pending[i++]
      // sla over als we al verse data hebben (<2 min)
      const entry = useIndicatorStore.getState().get(sym)
      if (entry && Date.now() - entry.updatedAt < 120_000) continue

      let attempt = 0
      while (attempt < 4) {
        try {
          await fetchOne(sym, { signal: controller.signal })
          break // success
        } catch (e: any) {
          attempt++
          // Eenvoudige backoff bij rate limits of network hiccups
          const ms = Math.min(4000, 500 * 2 ** (attempt - 1))
          await new Promise(r => setTimeout(r, ms))
        }
      }
    }
  }

  for (let k = 0; k < concurrency; k++) workers.push(worker())
  await Promise.race([
    Promise.all(workers),
    // safety timeout (optioneel)
    new Promise<void>(resolve => setTimeout(resolve, 25_000)),
  ])
}