import NextAuth, { type NextAuthOptions } from 'next-auth'
import EmailProvider from 'next-auth/providers/email'
import { PrismaAdapter } from '@next-auth/prisma-adapter'
import { prisma } from '@/lib/prisma'

export const authOptions: NextAuthOptions = {
  // ✅ Gebruik env var (niet de raw secret value!)
  secret: process.env.NEXTAUTH_SECRET,

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

  debug: process.env.NODE_ENV === 'development',
}

export default NextAuth(authOptions)