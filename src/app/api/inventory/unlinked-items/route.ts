import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

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
      where: { status: 'ACTIVE' },
      select: { id: true, sku: true, name: true, brand: true },
      orderBy: { name: 'asc' },
    })

    // Build suggestions for each item
    const itemsWithSuggestions = items.map(item => {
      const suggestions: Array<{ id: string; sku: string; name: string; brand: string | null; matchType: string; priority: number }> = []

      if (item.supplierProductCode) {
        // Clean code: remove "001" prefix (GENEBRE)
        const rawCode = item.supplierProductCode.trim()
        const cleanCode = rawCode.startsWith('001') && rawCode.length > 3
          ? rawCode.substring(3)
          : rawCode

        const cleanCodeLower = cleanCode.toLowerCase()
        const rawCodeLower = rawCode.toLowerCase()

        for (const p of allProducts) {
          const skuLower = p.sku.toLowerCase()

          // Priority 1: Exact match on clean code
          if (skuLower === cleanCodeLower) {
            suggestions.push({ ...p, matchType: 'exacto', priority: 1 })
            continue
          }

          // Priority 2: Exact match on raw code
          if (skuLower === rawCodeLower) {
            suggestions.push({ ...p, matchType: 'exacto', priority: 1 })
            continue
          }

          // Priority 3: Partial match - SKU contains clean code or vice versa
          if (cleanCodeLower.length >= 4 && (skuLower.includes(cleanCodeLower) || cleanCodeLower.includes(skuLower))) {
            suggestions.push({ ...p, matchType: 'código', priority: 2 })
          }
        }
      }

      // Priority 4: Match by description keywords (only if we have < 3 suggestions)
      if (suggestions.length < 3 && item.description) {
        const words = item.description.split(/\s+/).filter(w => w.length > 3).slice(0, 4)
        if (words.length >= 2) {
          for (const p of allProducts) {
            if (suggestions.find(s => s.id === p.id)) continue
            const nameL = p.name.toLowerCase()
            const matchCount = words.filter(w => nameL.includes(w.toLowerCase())).length
            if (matchCount >= 2) {
              suggestions.push({ ...p, matchType: 'descripción', priority: 3 })
            }
            if (suggestions.length >= 5) break
          }
        }
      }

      // Sort by priority and take top 3
      suggestions.sort((a, b) => a.priority - b.priority)

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
        suggestions: suggestions.slice(0, 3).map(({ priority: _p, ...rest }) => rest),
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
    logger.error('Error in unlinked items:', error)
    const message = error instanceof Error ? error.message : 'Error al cargar items sin vincular'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
