import type { Metadata } from "next"
import { GeistSans } from "geist/font/sans"
import "./globals.css"
import { Providers } from "@/components/Providers"

const geistSans = GeistSans

export const metadata: Metadata = {
  title: "Valarg ERP/CRM",
  description: "Sistema de gestión empresarial para distribuidora industrial",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es">
      <body
        className={`${geistSans.variable} antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
