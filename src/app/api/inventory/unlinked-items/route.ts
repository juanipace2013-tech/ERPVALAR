import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    // Get unlinked items grouped by invoice
    const items = await prisma.purchaseInvoiceItem.findMany({
      where: { productId: null },
      include: {
        purchaseInvoice: {
          select: {
            id: true,
            invoiceNumber: true,
            invoiceDate: true,
            supplier: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: {
        purchaseInvoice: { invoiceDate: 'desc' },
      },
    })

    // Get all products for suggestions
    const allProducts = await prisma.product.findMany({
      where: { status: 'ACTIVE', trackInventory: true },
      select: { id: true, sku: true, name: true, brand: true },
      orderBy: { name: 'asc' },
    })

    // Build suggestions for each item
    const itemsWithSuggestions = items.map(item => {
      const suggestions: Array<{ id: string; sku: string; name: string; brand: string | null; matchType: string }> = []

      // Match by supplier product code ~ sku
      if (item.supplierProductCode) {
        const codeClean = item.supplierProductCode.trim().toLowerCase()
        for (const p of allProducts) {
          if (p.sku.toLowerCase().includes(codeClean) || codeClean.includes(p.sku.toLowerCase())) {
            suggestions.push({ ...p, matchType: 'código' })
          }
        }
      }

      // Match by description keywords
      if (suggestions.length < 3 && item.description) {
        const words = item.description.split(/\s+/).filter(w => w.length > 3).slice(0, 3)
        for (const p of allProducts) {
          if (suggestions.find(s => s.id === p.id)) continue
          const nameL = p.name.toLowerCase()
          const matchCount = words.filter(w => nameL.includes(w.toLowerCase())).length
          if (matchCount >= 1) {
            suggestions.push({ ...p, matchType: 'descripción' })
          }
          if (suggestions.length >= 3) break
        }
      }

      return {
        id: item.id,
        supplierProductCode: item.supplierProductCode,
        description: item.description,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        purchaseInvoice: {
          id: item.purchaseInvoice.id,
          invoiceNumber: item.purchaseInvoice.invoiceNumber,
          invoiceDate: item.purchaseInvoice.invoiceDate,
          supplierName: item.purchaseInvoice.supplier.name,
        },
        suggestions: suggestions.slice(0, 3),
      }
    })

    // Group by invoice
    const grouped: Record<string, {
      invoiceId: string; invoiceNumber: string; invoiceDate: Date;
      supplierName: string; items: typeof itemsWithSuggestions;
    }> = {}

    for (const item of itemsWithSuggestions) {
      const key = item.purchaseInvoice.id
      if (!grouped[key]) {
        grouped[key] = {
          invoiceId: item.purchaseInvoice.id,
          invoiceNumber: item.purchaseInvoice.invoiceNumber,
          invoiceDate: item.purchaseInvoice.invoiceDate,
          supplierName: item.purchaseInvoice.supplierName,
          items: [],
        }
      }
      grouped[key].items.push(item)
    }

    return NextResponse.json({
      totalUnlinked: items.length,
      invoices: Object.values(grouped),
    })
  } catch (error: unknown) {
    console.error('Error in unlinked items:', error)
    const message = error instanceof Error ? error.message : 'Error al cargar items sin vincular'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
