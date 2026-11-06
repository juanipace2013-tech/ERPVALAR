/**
 * Cuenta de gasto sugerida para un proveedor: la de la última línea de gasto
 * que se le cargó (Allianz → "Seguros", el banco → "Gastos Bancarios").
 *
 * GET ?supplierId= → { cuenta: string | null }
 */
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { cuentaGasto } from '@/lib/compras/cuentas-colppy'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const supplierId = req.nextUrl.searchParams.get('supplierId')
  if (!supplierId) return NextResponse.json({ error: 'Falta el proveedor' }, { status: 400 })

  const ultima = await prisma.purchaseInvoiceItem.findFirst({
    where: { colppyAccount: { not: null }, purchaseInvoice: { supplierId } },
    orderBy: { createdAt: 'desc' },
    select: { colppyAccount: true },
  })
  // Si la cuenta ya no está en la lista (se renombró en Colppy), no se sugiere
  return NextResponse.json({ cuenta: cuentaGasto(ultima?.colppyAccount)?.nombre ?? null })
}
