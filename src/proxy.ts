import { auth } from '@/auth'
import { NextResponse } from 'next/server'

export default auth((req) => {
  const { pathname } = req.nextUrl
  const isLoggedIn = !!req.auth

  // Rutas públicas
  const isPublicRoute =
    pathname === '/login' ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/cron') ||
    pathname.startsWith('/api/webhooks') ||
    // Subida programada de conversiones offline de Google Ads:
    // valida ?key=GOOGLE_ADS_WEBHOOK_KEY en el handler.
    pathname === '/api/google-ads/offline-conversions.csv' ||
    // Agente Python de Exiros: validan Bearer EXIROS_AGENT_API_KEY en el
    // handler (src/lib/exiros/agent-auth.ts). Match exacto a propósito:
    // /api/exiros/licitaciones es de la UI y sigue requiriendo sesión.
    pathname === '/api/exiros/sync' ||
    pathname === '/api/exiros/acciones' ||
    pathname === '/api/exiros/estados'

  // Si está en login y ya está autenticado, redirigir al dashboard
  if (pathname === '/login' && isLoggedIn) {
    return NextResponse.redirect(new URL('/', req.url))
  }

  // Si no está autenticado y trata de acceder a una ruta privada
  if (!isPublicRoute && !isLoggedIn) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  return NextResponse.next()
})

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|logo-valarg\\.png|public).*)',
  ],
}
