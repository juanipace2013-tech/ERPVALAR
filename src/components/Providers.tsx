'use client'

import { SessionProvider } from 'next-auth/react'
import { ThemeProvider } from 'next-themes'
import { Toaster } from '@/components/ui/sonner'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="erp-theme">
      <SessionProvider>
        {children}
        <Toaster position="top-right" />
      </SessionProvider>
    </ThemeProvider>
  )
}
