import { prisma } from '@/lib/prisma'

/**
 * Vinculaciones "aprendidas": si alguien ya vinculó a mano un código de
 * proveedor a un producto en una factura anterior del mismo proveedor, las
 * facturas siguientes con ese código entran vinculadas solas.
 *
 * Caso típico: GENEBRE factura "4020 99" para lo que el catálogo tiene como
 * "4020 06" — ninguna variante del SKU lo encuentra, pero Administración lo
 * emparejó una vez y no tiene sentido que lo vuelva a hacer en cada factura.
 *
 * Devuelve un mapa código (tal cual viene en la factura, trim) → productId,
 * usando la vinculación más reciente de cada código.
 */
export async function findLearnedLinks(
  supplierId: string,
  supplierCodes: string[]
): Promise<Map<string, string>> {
  const codes = [...new Set(supplierCodes.map((c) => c.trim()).filter(Boolean))]
  const result = new Map<string, string>()
  if (codes.length === 0) return result

  const rows = await prisma.purchaseInvoiceItem.findMany({
    where: {
      supplierProductCode: { in: codes },
      productId: { not: null },
      product: { status: 'ACTIVE' },
      purchaseInvoice: { supplierId },
    },
    select: { supplierProductCode: true, productId: true },
    orderBy: { updatedAt: 'desc' },
  })

  for (const r of rows) {
    const code = r.supplierProductCode!.trim()
    if (!result.has(code) && r.productId) result.set(code, r.productId)
  }
  return result
}
