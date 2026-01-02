import NextAuth, { type NextAuthOptions } from 'next-auth'
import EmailProvider from 'next-auth/providers/email'
import { PrismaAdapter } from '@next-auth/prisma-adapter'
import { prisma } from '@/lib/prisma'

export const authOptions: NextAuthOptions = {
  // ✅ Cruciaal: expliciet secret meegeven (lost NO_SECRET op)
  secret: process.env.auMSwVI3/nPQO6Zyw+sY1Nxa/Sc08/xYkI9oLdk9gVs=,

  adapter: PrismaAdapter(prisma),
  session: { strategy: 'database' },

  providers: [
    EmailProvider({
      server: process.env.EMAIL_SERVER,
      from: process.env.EMAIL_FROM,
    }),
  ],

  pages: {
    signIn: '/auth/signin',
  },

  // (optioneel maar handig) betere logs in dev
  debug: process.env.NODE_ENV === 'development',
}

export default NextAuth(authOptions)