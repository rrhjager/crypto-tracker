// src/lib/kv.ts
import { kv } from '@vercel/kv'

/**
 * Haal JSON uit Vercel KV.
 * - Geeft `undefined` terug wanneer de key ontbreekt of bij parse-fouten.
 */
export async function kvGetJSON<T>(key: string): Promise<T | undefined> {
  try {
    const raw = await kv.get(key) // Upstash kan string of native JSON teruggeven
    if (raw == null) return undefined
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw) as T
      } catch {
        return undefined
      }
    }
    return raw as T
  } catch {
    return undefined
  }
}

/** Sidecar TS-key om leeftijd te kunnen schatten wanneer TTL niet bekend is. */
const tsKey = (key: string) => `${key}__ts`

/**
 * Sla JSON op in Vercel KV.
 * - Optionele TTL in seconden (ex: 300 = 5 min).
 * - Schrijft óók een sidecar timestamp key (zelfde TTL) om staleness te kunnen schatten.
 *
 * NB: generiek gemaakt zodat aanroep als kvSetJSON<MyType>(...) geldig is.
 */
export async function kvSetJSON<T>(key: string, value: T, ttlSec?: number) {
  const payload = JSON.stringify(value)
  const now = Date.now()

  if (ttlSec && Number.isFinite(ttlSec)) {
    const ex = Math.max(1, Math.floor(ttlSec))
    await Promise.all([
      kv.set(key, payload, { ex }),
      kv.set(tsKey(key), String(now), { ex }),
    ])
  } else {
    await Promise.all([kv.set(key, payload), kv.set(tsKey(key), String(now))])
  }
}

/**
 * Cache wrapper:
 * - Probeert eerst KV (indien aanwezig).
 * - Zo niet, roept `fn()` aan, slaat het resultaat op met TTL, en geeft dat terug.
 */
export async function withCache<T>(
  key: string,
  ttlSec: number,
  fn: () => Promise<T>
): Promise<T> {
  const cached = await kvGetJSON<T>(key)
  if (cached !== undefined) return cached
  const fresh = await fn()
  await kvSetJSON<T>(key, fresh, ttlSec)
  return fresh
}

/** Helper: TTL in seconden ophalen; kan -1 (geen expiry) of -2 (bestaat niet) teruggeven. */
async function getTtlSeconds(key: string): Promise<number | null> {
  try {
    const t = await (kv as any).ttl?.(key)
    if (typeof t !== 'number') return null
    if (t >= 0) return t
    return null // -1 no-expire of -2 missing => onbekend
  } catch {
    return null
  }
}

/** Helper: sidecar timestamp lezen (ms since epoch), of undefined. */
async function getSidecarTs(key: string): Promise<number | undefined> {
  try {
    const raw = await kv.get<string>(tsKey(key))
    if (!raw) return undefined
    const n = Number(raw)
    return Number.isFinite(n) ? n : undefined
  } catch {
    return undefined
  }
}

/**
 * kvRefreshIfStale:
 * - Retourneert direct de huidige (cached) waarde als die bestaat.
 * - Als de resterende TTL ≤ `revalidateSeconds`, start een **background refresh** (fire-and-forget).
 * - Als er géén cache is, haalt ‘ie synchronously fresh data op (en slaat op) en retourneert die.
 */
export async function kvRefreshIfStale<T>(
  key: string,
  ttlSeconds: number,
  revalidateSeconds: number,
  refresher: () => Promise<T>
): Promise<T | null> {
  const current = await kvGetJSON<T>(key)

  let remaining: number | null = await getTtlSeconds(key)

  if (remaining == null && ttlSeconds > 0) {
    const ts = await getSidecarTs(key)
    if (ts) {
      const ageSec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
      remaining = Math.max(0, ttlSeconds - ageSec)
    }
  }

  if (current === undefined) {
    try {
      const fresh = await refresher()
      await kvSetJSON<T>(key, fresh, ttlSeconds)
      return fresh
    } catch {
      return null
    }
  }

  const shouldRevalidate =
    current !== undefined &&
    typeof remaining === 'number' &&
    remaining <= Math.max(0, Math.floor(revalidateSeconds))

  if (shouldRevalidate) {
    ;(async () => {
      try {
        const fresh = await refresher()
        await kvSetJSON<T>(key, fresh, ttlSeconds)
      } catch {
        // Laat oude cache staan
      }
    })()
  }

  return current ?? null
}