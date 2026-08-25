'use client'

import { SessionProvider } from 'next-auth/react'
import { ThemeProvider } from 'next-themes'
import { Toaster } from '@/components/ui/sonner'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="erp-theme">
      {/* basePath explícito: sin él, el cliente de next-auth en el build de
          prod resuelve mal la ruta y fetchea /session (404 HTML) en vez de
          /api/auth/session — la sesión client-side nunca cargaba y las páginas
          gateadas por useSession (ej. /admin/auditoria) quedaban en blanco. */}
      <SessionProvider basePath="/api/auth">
        {children}
        <Toaster position="top-right" />
      </SessionProvider>
    </ThemeProvider>
  )
}
