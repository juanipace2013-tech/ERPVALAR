import { UserRole } from '@prisma/client'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      role: UserRole
      status: string
      avatar?: string | null
      name?: string | null
      email?: string | null
      image?: string | null
    }
  }

  interface User {
    role: UserRole
    status: string
    avatar?: string | null
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    id: string
    role: UserRole
    status: string
    avatar?: string | null
  }
}
