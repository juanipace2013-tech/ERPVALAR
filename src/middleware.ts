import { auth } from '@/auth'
import { NextResponse } from 'next/server'

export default auth((req) => {
  const { pathname } = req.nextUrl
  const isLoggedIn = !!req.auth

  // Rutas públicas
  const isPublicRoute = pathname === '/login' || pathname.startsWith('/api/auth')

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
    '/((?!_next/static|_next/image|favicon.ico|public).*)',
  ],
}
