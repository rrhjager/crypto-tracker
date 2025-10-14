// src/lib/kv.ts
import { kv } from '@vercel/kv'

/**
 * Haal JSON uit Vercel KV.
 * - Geeft `undefined` terug wanneer de key ontbreekt of bij parse-fouten.
 */
export async function kvGetJSON<T>(key: string): Promise<T | undefined> {
  try {
    const raw = await kv.get<string>(key)
    if (!raw) return undefined
    // Upstash KV kan strings of native types teruggeven; beide afvangen:
    return typeof raw === 'string' ? (JSON.parse(raw) as T) : ((raw as unknown) as T)
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
 */
export async function kvSetJSON(key: string, value: unknown, ttlSec?: number) {
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
  await kvSetJSON(key, fresh, ttlSec)
  return fresh
}

/** Helper: TTL in seconden ophalen; kan -1 (geen expiry) of -2 (bestaat niet) teruggeven. */
async function getTtlSeconds(key: string): Promise<number | null> {
  try {
    // @vercel/kv exposeert `ttl(key)` → number | null | -1 (no expire) | -2 (missing)
    const t = await (kv as any).ttl?.(key)
    if (typeof t !== 'number') return null
    if (t >= 0) return t
    // -1 = no expiry, -2 = missing → geen bruikbare TTL
    return null
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
 *
 * @param key KV key
 * @param ttlSeconds TTL waarmee we opslaan
 * @param revalidateSeconds drempel waarbij we een background refresh starten (bijv. 15–30)
 * @param refresher async functie die fresh data teruggeeft
 */
export async function kvRefreshIfStale<T>(
  key: string,
  ttlSeconds: number,
  revalidateSeconds: number,
  refresher: () => Promise<T>
): Promise<T | null> {
  // 1) Huidige cache lezen
  const current = await kvGetJSON<T>(key)

  // 2) Resterende TTL bepalen
  let remaining: number | null = await getTtlSeconds(key)

  // 3) Als TTL onbekend is, schat via sidecar ts + ttlSeconds
  if (remaining == null && ttlSeconds > 0) {
    const ts = await getSidecarTs(key)
    if (ts) {
      const ageSec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
      remaining = Math.max(0, ttlSeconds - ageSec)
    }
  }

  // 4) Geen cache? → direct fresh ophalen en retourneren
  if (current === undefined) {
    try {
      const fresh = await refresher()
      await kvSetJSON(key, fresh, ttlSeconds)
      return fresh
    } catch {
      return null
    }
  }

  // 5) Bepaal of we moeten revalidaten in de achtergrond
  const shouldRevalidate =
    current !== undefined &&
    typeof remaining === 'number' &&
    remaining <= Math.max(0, Math.floor(revalidateSeconds))

  if (shouldRevalidate) {
    // Fire-and-forget: cache blijft voorlopig beschikbaar
    ;(async () => {
      try {
        const fresh = await refresher()
        await kvSetJSON(key, fresh, ttlSeconds)
      } catch {
        // Bij fout: laat oude cache staan
      }
    })()
  }

  // 6) Geef cached waarde terug
  return current ?? null
}