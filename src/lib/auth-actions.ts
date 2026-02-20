'use server'

import { signIn as authSignIn, signOut as authSignOut } from '@/auth'
import { AuthError } from 'next-auth'

export async function signIn(email: string, password: string) {
  try {
    await authSignIn('credentials', {
      email,
      password,
      redirect: false,
    })
    return { success: true }
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: error.cause?.err?.message || 'Email o contraseña incorrectos' }
    }
    return { error: 'Ocurrió un error al iniciar sesión' }
  }
}

export async function signOut() {
  await authSignOut({ redirectTo: '/login' })
}
