/**
 * API Endpoint: POST /api/facturacion/generate-invoice
 * Envía ítems seleccionados como BORRADOR a Colppy.
 * Reutiliza sendQuoteToColppy() — misma lógica que el módulo de Cotizaciones.
 *
 * Acepta el mismo payload que SendToColppyDialog produce:
 *   { quoteId, items, action, editedData }
 *
 * NO crea la factura final: el usuario la revisa y confirma en Colppy.
 */

import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendQuoteToColppy, type SendToColppyOptions } from '@/lib/colppy'

interface InvoiceItemRequest {
  quoteItemId: string
  quantity: number
}

interface EditableItem {
  id: string
  sku: string
  descripcion: string
  cantidad: number
  precioUnitario: number
  iva: number
  comentario: string
}

type ColppyAction = 'remito-factura' | 'remito' | 'factura-cuenta-corriente' | 'factura-contado'

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
      action,
      editedData,
    } = body as {
      quoteId: string
      items: InvoiceItemRequest[]
      action?: ColppyAction
      editedData?: {
        items: EditableItem[]
        condicionPago: string
        puntoVenta: string
        descripcion: string
      }
    }

    if (!quoteId || !requestedItems?.length) {
      return NextResponse.json(
        { error: 'Se requiere quoteId y al menos un ítem' },
        { status: 400 }
      )
    }

    // Obtener cotización con ítems, additionals, producto y customer
    const quote = await prisma.quote.findUnique({
      where: { id: quoteId },
      include: {
        customer: true,
        items: {
          where: { isAlternative: false },
          include: {
            product: true,
            additionals: {
              include: {
                product: true,
              },
            },
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

    // Validar exchangeRate si currency = USD
    if (quote.currency === 'USD' && !quote.exchangeRate) {
      return NextResponse.json(
        { error: 'La cotización en USD debe tener un tipo de cambio definido' },
        { status: 400 }
      )
    }

    // Validar cada ítem solicitado
    for (const req of requestedItems) {
      const quoteItem = quote.items.find((i) => i.id === req.quoteItemId)
      if (!quoteItem) {
        return NextResponse.json(
          { error: `Ítem ${req.quoteItemId} no pertenece a esta cotización` },
          { status: 400 }
        )
      }

      const alreadyInvoiced = quoteItem.invoiceItems
        .filter((ii) => ii.invoice.status !== 'CANCELLED')
        .reduce((sum, ii) => sum + Number(ii.quantity), 0)

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
    }

    // Construir datos para Colppy
    // Si hay editedData del dialog, usar esos datos (el usuario pudo editar)
    // Si no, usar los datos originales de la cotización
    const colppyItems = editedData
      ? editedData.items.map((item) => ({
          productName: item.descripcion,
          productSku: item.sku,
          quantity: item.cantidad,
          unitPrice: item.precioUnitario,
          iva: item.iva,
          comentario: item.comentario,
          deliveryTime: undefined as string | undefined,
          additionals: [] as Array<{ name: string; unitPrice: number }>,
        }))
      : requestedItems.map((req) => {
          const quoteItem = quote.items.find((i) => i.id === req.quoteItemId)!
          return {
            productName: quoteItem.product?.name || quoteItem.description || 'Item manual',
            productSku: quoteItem.product?.sku || quoteItem.manualSku || '',
            quantity: req.quantity,
            unitPrice: Number(quoteItem.unitPrice),
            iva: 21,
            comentario: `Cotización ${quote.quoteNumber}${quote.notes ? ' / ' + quote.notes : ''}`,
            deliveryTime: quoteItem.deliveryTime || undefined,
            additionals: quoteItem.additionals.map((additional) => ({
              name: additional.product.name,
              unitPrice: Number(additional.listPrice),
            })),
          }
        })

    // Enviar a Colppy usando la función existente
    const colppyAction = action || 'factura-cuenta-corriente'
    const colppyOptions: SendToColppyOptions = {
      action: colppyAction,
      condicionPago: editedData?.condicionPago || undefined,
      puntoVenta: editedData?.puntoVenta || undefined,
      descripcion: editedData?.descripcion || `Cotización ${quote.quoteNumber} (parcial: ${colppyItems.length} ítems)`,
    }

    const colppyResult = await sendQuoteToColppy(colppyOptions, {
      id: quote.id,
      quoteNumber: quote.quoteNumber,
      currency: quote.currency,
      exchangeRate: quote.exchangeRate ? Number(quote.exchangeRate) : null,
      customer: {
        name: quote.customer.name,
        cuit: quote.customer.cuit,
        taxCondition: quote.customer.taxCondition || '',
        address: quote.customer.address || undefined,
        phone: quote.customer.phone || undefined,
        email: quote.customer.email || undefined,
      },
      items: colppyItems,
    })

    if (!colppyResult.success) {
      return NextResponse.json(
        { error: `Error al enviar a Colppy: ${colppyResult.error}` },
        { status: 500 }
      )
    }

    // Sincronizar paymentTerms del cliente desde Colppy a DB local
    if (colppyResult.customerPaymentTermsDays != null && quote.customerId) {
      try {
        await prisma.customer.update({
          where: { id: quote.customerId },
          data: { paymentTerms: colppyResult.customerPaymentTermsDays },
        });
        console.log(`[Colppy Sync] paymentTerms=${colppyResult.customerPaymentTermsDays} guardado para cliente ${quote.customerId}`);
      } catch (syncErr: any) {
        console.warn(`[Colppy Sync] Error al sincronizar paymentTerms: ${syncErr.message}`);
      }
    }

    // Registrar en BD: crear InvoiceItems para tracking de cantidades parciales
    const now = new Date()

    await prisma.$transaction(async (tx) => {
      const invoiceNumber = `BORRADOR-COLPPY-${colppyResult.facturaNumber || colppyResult.remitoNumber || Date.now()}`
      const invoiceType = quote.customer.taxCondition === 'RESPONSABLE_INSCRIPTO' ? 'A' : 'B'

      const subtotal = colppyItems.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0)

      const newInvoice = await tx.invoice.create({
        data: {
          invoiceNumber,
          invoiceType,
          transactionType: 'SALE',
          quoteId: quote.id,
          customerId: quote.customerId,
          userId: quote.salesPersonId || session.user!.id!,
          status: 'DRAFT',
          currency: quote.currency,
          exchangeRate: quote.exchangeRate,
          subtotal,
          taxAmount: 0,
          discount: 0,
          total: subtotal,
          balance: subtotal,
          issueDate: now,
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          notes: `Borrador enviado a Colppy el ${now.toLocaleString('es-AR')}. ${colppyResult.facturaNumber ? `Factura: ${colppyResult.facturaNumber}` : ''} ${colppyResult.remitoNumber ? `Remito: ${colppyResult.remitoNumber}` : ''}`.trim(),
          afipStatus: 'PENDING',
          paymentStatus: 'UNPAID',
          items: {
            create: requestedItems.map((req) => {
              const quoteItem = quote.items.find((qi) => qi.id === req.quoteItemId)!
              return {
                productId: quoteItem.productId || null,
                quoteItemId: quoteItem.id,
                description: quoteItem.description || quoteItem.product?.name || 'Item',
                quantity: req.quantity,
                unitPrice: Number(quoteItem.unitPrice),
                discount: 0,
                taxRate: 21,
                subtotal: Number(quoteItem.unitPrice) * req.quantity,
              }
            }),
          },
        },
      })

      // Actualizar Quote con datos de Colppy
      const updateData: any = {
        colppySyncedAt: now,
      }
      if (colppyResult.facturaId) {
        updateData.colppyInvoiceId = colppyResult.facturaId
      }
      if (colppyResult.remitoId) {
        updateData.colppyDeliveryNoteId = colppyResult.remitoId
      }

      await tx.quote.update({
        where: { id: quoteId },
        data: updateData,
      })

      // Verificar si TODOS los ítems están ahora completamente facturados
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
          .reduce((sum, ii) => sum + Number(ii.quantity), 0)
        return totalInvoiced >= item.quantity
      })

      if (isFullyInvoiced) {
        await tx.quote.update({
          where: { id: quoteId },
          data: {
            status: 'CONVERTED',
            statusUpdatedAt: now,
            statusUpdatedBy: session.user!.id!,
          },
        })

        await tx.quoteStatusHistory.create({
          data: {
            quoteId,
            fromStatus: 'ACCEPTED',
            toStatus: 'CONVERTED',
            changedBy: session.user!.id!,
            notes: `Enviado a Colppy (${colppyAction}). ${colppyResult.facturaNumber ? `Factura: ${colppyResult.facturaNumber}` : ''} ${colppyResult.remitoNumber ? `Remito: ${colppyResult.remitoNumber}` : ''} (facturación completa)`.trim(),
          },
        })
      } else {
        await tx.quoteStatusHistory.create({
          data: {
            quoteId,
            fromStatus: 'ACCEPTED',
            toStatus: 'ACCEPTED',
            changedBy: session.user!.id!,
            notes: `Facturación parcial enviada a Colppy (${colppyAction}). ${colppyResult.facturaNumber ? `Factura: ${colppyResult.facturaNumber}` : ''} ${colppyResult.remitoNumber ? `Remito: ${colppyResult.remitoNumber}` : ''} (${requestedItems.length} ítems)`.trim(),
          },
        })
      }
    })

    return NextResponse.json({
      success: true,
      message: 'Enviado a Colppy exitosamente',
      remitoId: colppyResult.remitoId,
      remitoNumber: colppyResult.remitoNumber,
      facturaId: colppyResult.facturaId,
      facturaNumber: colppyResult.facturaNumber,
      sentAt: now.toISOString(),
    })
  } catch (error: any) {
    console.error('Error generating invoice for Colppy:', error)
    return NextResponse.json(
      { error: error.message || 'Error al enviar a Colppy' },
      { status: 500 }
    )
  }
}
