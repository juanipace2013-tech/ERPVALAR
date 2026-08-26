'use client'

import { SessionProvider } from 'next-auth/react'
import type { Session } from 'next-auth'
import { ThemeProvider } from 'next-themes'
import { Toaster } from '@/components/ui/sonner'

export function Providers({
  children,
  session,
}: {
  children: React.ReactNode
  session: Session | null
}) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="erp-theme">
      {/* basePath explícito: sin él, el cliente de next-auth en el build de
          prod resuelve mal la ruta y fetchea /session (404 HTML) en vez de
          /api/auth/session — la sesión client-side nunca cargaba y las páginas
          gateadas por useSession (ej. /admin/auditoria) quedaban en blanco.
          session del server: hidrata useSession() desde el primer render, sin
          depender del fetch client-side (que si falla dejaba el navbar sin
          usuario). refetchOnWindowFocus off: con JWT de 30 días no aporta y
          cada cambio de pestaña re-fetcheaba la sesión; un fallo transitorio
          la ponía en null y desaparecía el usuario del navbar. */}
      <SessionProvider basePath="/api/auth" session={session} refetchOnWindowFocus={false}>
        {children}
        <Toaster position="top-right" />
      </SessionProvider>
    </ThemeProvider>
  )
}
