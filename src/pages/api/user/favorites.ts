import type { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth/next'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/pages/api/auth/[...nextauth]'

function asString(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim()
  return null
}

function normalizeSymbol(sym: string) {
  return sym.trim().toUpperCase()
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)

  // ✅ FIX: session.user.id is vaak niet gezet → fallback via email -> userId uit DB
  let userId = (session?.user as any)?.id as string | undefined
  if (!userId) {
    const email = session?.user?.email
    if (!email) return res.status(401).json({ error: 'Not signed in' })

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    })
    userId = user?.id
  }

  if (!userId) {
    return res.status(401).json({ error: 'Not signed in' })
  }

  if (req.method === 'GET') {
    const kind = asString(req.query.kind) // optional: CRYPTO|EQUITY
    const where: any = { userId }
    if (kind) where.kind = kind

    const items = await prisma.favorite.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: { id: true, kind: true, symbol: true, market: true, createdAt: true },
    })

    return res.status(200).json({ favorites: items })
  }

  if (req.method === 'POST') {
    const kind = asString((req.body as any)?.kind)
    const symbolRaw = asString((req.body as any)?.symbol)
    const marketRaw = asString((req.body as any)?.market) // optional for EQUITY

    if (!kind || (kind !== 'CRYPTO' && kind !== 'EQUITY')) {
      return res.status(400).json({ error: 'Invalid kind (CRYPTO|EQUITY)' })
    }
    if (!symbolRaw) {
      return res.status(400).json({ error: 'Missing symbol' })
    }

    const symbol = normalizeSymbol(symbolRaw)

    // ✅ IMPORTANT: market is never null anymore (schema default = "")
    // - CRYPTO: always ""
    // - EQUITY: use provided market or ""
    const market = kind === 'CRYPTO' ? '' : (marketRaw || '')

    const fav = await prisma.favorite.upsert({
      where: {
        userId_kind_symbol_market: {
          userId,
          kind: kind as any,
          symbol,
          market,
        },
      },
      update: {},
      create: {
        userId,
        kind: kind as any,
        symbol,
        market,
      },
      select: { id: true, kind: true, symbol: true, market: true, createdAt: true },
    })

    return res.status(200).json({ favorite: fav })
  }

  if (req.method === 'DELETE') {
    const kind = asString(req.query.kind)
    const symbolRaw = asString(req.query.symbol)
    const marketRaw = asString(req.query.market)

    if (!kind || (kind !== 'CRYPTO' && kind !== 'EQUITY')) {
      return res.status(400).json({ error: 'Invalid kind (CRYPTO|EQUITY)' })
    }
    if (!symbolRaw) {
      return res.status(400).json({ error: 'Missing symbol' })
    }

    const symbol = normalizeSymbol(symbolRaw)

    // ✅ IMPORTANT: market is never null anymore (schema default = "")
    const market = kind === 'CRYPTO' ? '' : (marketRaw || '')

    try {
      await prisma.favorite.delete({
        where: {
          userId_kind_symbol_market: {
            userId,
            kind: kind as any,
            symbol,
            market,
          },
        },
      })
    } catch (e: any) {
      // Prisma P2025 = record not found -> treat as OK (idempotent)
      if (e?.code !== 'P2025') throw e
    }

    return res.status(200).json({ ok: true })
  }

  res.setHeader('Allow', ['GET', 'POST', 'DELETE'])
  return res.status(405).json({ error: 'Method not allowed' })
}