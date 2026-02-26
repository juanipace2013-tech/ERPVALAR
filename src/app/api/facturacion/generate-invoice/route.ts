import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { determineInvoiceType, generateInvoiceNumber } from '@/lib/quote-workflow'

interface InvoiceItemRequest {
  quoteItemId: string
  quantity: number
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json()
    const {
      quoteId,
      items: requestedItems,
      pointOfSale = '0001',
      dueDate,
      notes,
    } = body as {
      quoteId: string
      items: InvoiceItemRequest[]
      pointOfSale?: string
      dueDate?: string
      notes?: string
    }

    if (!quoteId || !requestedItems?.length) {
      return NextResponse.json(
        { error: 'Se requiere quoteId y al menos un ítem' },
        { status: 400 }
      )
    }

    // Obtener cotización con ítems e invoiceItems existentes
    const quote = await prisma.quote.findUnique({
      where: { id: quoteId },
      include: {
        customer: true,
        items: {
          where: { isAlternative: false },
          include: {
            product: true,
            invoiceItems: {
              include: {
                invoice: { select: { status: true } },
              },
            },
          },
        },
      },
    })

    if (!quote) {
      return NextResponse.json({ error: 'Cotización no encontrada' }, { status: 404 })
    }

    if (quote.status !== 'ACCEPTED') {
      return NextResponse.json(
        { error: 'Solo se pueden facturar cotizaciones aceptadas' },
        { status: 400 }
      )
    }

    // Validar cada ítem solicitado
    const invoiceItemsData = []
    let subtotal = 0

    for (const req of requestedItems) {
      const quoteItem = quote.items.find((i) => i.id === req.quoteItemId)
      if (!quoteItem) {
        return NextResponse.json(
          { error: `Ítem ${req.quoteItemId} no pertenece a esta cotización` },
          { status: 400 }
        )
      }

      // Calcular cantidad ya facturada
      const alreadyInvoiced = quoteItem.invoiceItems
        .filter((ii) => ii.invoice.status !== 'CANCELLED')
        .reduce((sum, ii) => sum + ii.quantity, 0)

      const remaining = quoteItem.quantity - alreadyInvoiced

      if (req.quantity > remaining) {
        return NextResponse.json(
          {
            error: `Ítem "${quoteItem.description || quoteItem.product?.name}": cantidad solicitada (${req.quantity}) excede la disponible (${remaining})`,
          },
          { status: 400 }
        )
      }

      if (req.quantity <= 0) {
        return NextResponse.json(
          { error: 'La cantidad debe ser mayor a 0' },
          { status: 400 }
        )
      }

      const itemUnitPrice = Number(quoteItem.unitPrice)
      const itemSubtotal = itemUnitPrice * req.quantity

      invoiceItemsData.push({
        productId: quoteItem.productId,
        quoteItemId: quoteItem.id,
        description: quoteItem.description || quoteItem.product?.name,
        quantity: req.quantity,
        unitPrice: itemUnitPrice,
        discount: 0,
        itemSubtotal,
      })

      subtotal += itemSubtotal
    }

    // Determinar tipo de factura y calcular impuestos
    const invoiceType = determineInvoiceType(quote.customer.taxCondition || '')
    const taxRate = invoiceType === 'A' ? 0.21 : 0
    const taxAmount = subtotal * taxRate
    const total = subtotal + taxAmount

    const invoiceNumber = await generateInvoiceNumber(pointOfSale, invoiceType)

    // Crear factura en transacción
    const invoice = await prisma.$transaction(async (tx) => {
      const newInvoice = await tx.invoice.create({
        data: {
          invoiceNumber,
          invoiceType,
          transactionType: 'SALE',
          quoteId: quote.id,
          customerId: quote.customerId,
          userId: session.user!.id!,
          status: 'DRAFT',
          currency: quote.currency,
          exchangeRate: quote.exchangeRate,
          subtotal,
          taxAmount,
          discount: 0,
          total,
          balance: total,
          issueDate: new Date(),
          dueDate: dueDate
            ? new Date(dueDate)
            : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          notes: notes || null,
          afipStatus: 'PENDING',
          paymentStatus: 'UNPAID',
          items: {
            create: invoiceItemsData.map((item) => ({
              productId: item.productId,
              quoteItemId: item.quoteItemId,
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              discount: 0,
              taxRate: taxRate * 100,
              subtotal: item.itemSubtotal + item.itemSubtotal * taxRate,
            })),
          },
        },
        include: {
          items: true,
          customer: true,
        },
      })

      // Verificar si TODOS los ítems de la cotización están ahora completamente facturados
      const allQuoteItems = await tx.quoteItem.findMany({
        where: { quoteId: quote.id, isAlternative: false },
        include: {
          invoiceItems: {
            include: {
              invoice: { select: { status: true } },
            },
          },
        },
      })

      const isFullyInvoiced = allQuoteItems.every((item) => {
        const totalInvoiced = item.invoiceItems
          .filter((ii) => ii.invoice.status !== 'CANCELLED')
          .reduce((sum, ii) => sum + ii.quantity, 0)
        return totalInvoiced >= item.quantity
      })

      if (isFullyInvoiced) {
        await tx.quote.update({
          where: { id: quoteId },
          data: {
            status: 'CONVERTED',
            statusUpdatedAt: new Date(),
            statusUpdatedBy: session.user!.id!,
          },
        })

        await tx.quoteStatusHistory.create({
          data: {
            quoteId,
            fromStatus: 'ACCEPTED',
            toStatus: 'CONVERTED',
            changedBy: session.user!.id!,
            notes: `Factura ${invoiceNumber} generada (facturación completa)`,
          },
        })
      }

      return newInvoice
    })

    return NextResponse.json(invoice)
  } catch (error) {
    console.error('Error generating partial invoice:', error)
    return NextResponse.json(
      { error: 'Error al generar factura' },
      { status: 500 }
    )
  }
}
