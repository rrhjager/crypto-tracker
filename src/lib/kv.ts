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

/**
 * Sla JSON op in Vercel KV.
 * - Optionele TTL in seconden (ex: 300 = 5 min).
 */
export async function kvSetJSON(key: string, value: unknown, ttlSec?: number) {
  const payload = JSON.stringify(value)
  if (ttlSec && Number.isFinite(ttlSec)) {
    await kv.set(key, payload, { ex: Math.max(1, Math.floor(ttlSec)) })
  } else {
    await kv.set(key, payload)
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