import { DefaultSession } from 'next-auth'
import { UserRole } from '@prisma/client'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      role: UserRole
      status: string
      avatar: string | null
    } & DefaultSession['user']
  }

  interface User {
    id: string
    role: UserRole
    status: string
    avatar: string | null
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    id: string
    role: UserRole
    status: string
    avatar: string | null
  }
}
