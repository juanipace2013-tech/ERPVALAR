import { auth } from '@/auth'
import { redirect } from 'next/navigation'

/**
 * Página raíz del dashboard - redirige al nuevo dashboard de estilo COLPPY
 */
export default async function RootDashboardPage() {
  const session = await auth()

  if (!session) {
    redirect('/login')
  }

  // Redirigir al nuevo dashboard principal
  redirect('/dashboard')
}
