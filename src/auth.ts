import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import * as OTPAuth from 'otpauth'
import { checkRateLimit, recordFailedAttempt, clearAttempts } from '@/lib/rate-limit'

function getClientIp(request: Request | undefined): string {
  if (!request) return 'unknown'
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const xri = request.headers.get('x-real-ip')
  if (xri) return xri.trim()
  return 'unknown'
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma) as any,
  providers: [
    Credentials({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        mfaCode: { label: 'Código 2FA', type: 'text' },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error('Email y contraseña son requeridos')
        }

        const email = (credentials.email as string).toLowerCase()
        const ip = getClientIp(request as Request | undefined)
        const key = `login:${ip}:${email}`

        if (!(await checkRateLimit(key))) {
          throw new Error('Demasiados intentos. Intentá nuevamente en 15 minutos.')
        }

        const user = await prisma.user.findUnique({
          where: { email },
        })

        if (!user) {
          await recordFailedAttempt(key)
          throw new Error('Email o contraseña incorrectos')
        }

        if (user.status !== 'ACTIVE') {
          await recordFailedAttempt(key)
          throw new Error('Email o contraseña incorrectos')
        }

        const isPasswordValid = await bcrypt.compare(
          credentials.password as string,
          user.password
        )

        if (!isPasswordValid) {
          await recordFailedAttempt(key)
          throw new Error('Email o contraseña incorrectos')
        }

        // Verificar 2FA si está habilitado
        if (user.mfaEnabled && user.mfaSecret) {
          const mfaCode = credentials.mfaCode as string

          if (!mfaCode) {
            throw new Error('MFA_REQUIRED')
          }

          const totp = new OTPAuth.TOTP({
            issuer: 'ERP VAL ARG',
            label: user.email,
            algorithm: 'SHA1',
            digits: 6,
            period: 30,
            secret: OTPAuth.Secret.fromBase32(user.mfaSecret),
          })

          const delta = totp.validate({ token: mfaCode, window: 1 })

          if (delta === null) {
            await recordFailedAttempt(key)
            throw new Error('MFA_INVALID')
          }
        }

        await clearAttempts(key)
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          status: user.status,
          avatar: user.avatar,
          mfaEnabled: user.mfaEnabled,
        }
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 días
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id as string
        token.role = (user as any).role
        token.status = (user as any).status
        token.avatar = (user as any).avatar
        token.mfaEnabled = (user as any).mfaEnabled
      }

      // Refrescar mfaEnabled cuando se actualiza la sesión
      if (trigger === 'update') {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { mfaEnabled: true },
        })
        if (dbUser) {
          token.mfaEnabled = dbUser.mfaEnabled
        }
      }

      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.role = token.role as any
        session.user.status = token.status as any
        session.user.avatar = (token.avatar as string | null) || null
        session.user.mfaEnabled = token.mfaEnabled as boolean
      }
      return session
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
  trustHost: true,
  debug: process.env.NODE_ENV === 'development',
})
