'use server'

import { signIn as authSignIn, signOut as authSignOut } from '@/auth'
import { AuthError } from 'next-auth'

export async function signIn(email: string, password: string, mfaCode?: string) {
  try {
    await authSignIn('credentials', {
      email,
      password,
      mfaCode: mfaCode || '',
      redirect: false,
    })
    return { success: true }
  } catch (error) {
    if (error instanceof AuthError) {
      const message = error.cause?.err?.message || ''

      if (message === 'MFA_REQUIRED') {
        return { mfaRequired: true }
      }

      if (message === 'MFA_INVALID') {
        return { error: 'Código de verificación incorrecto', mfaRequired: true }
      }

      return { error: message || 'Email o contraseña incorrectos' }
    }
    return { error: 'Ocurrió un error al iniciar sesión' }
  }
}

export async function signOut() {
  await authSignOut({ redirectTo: '/login' })
}
