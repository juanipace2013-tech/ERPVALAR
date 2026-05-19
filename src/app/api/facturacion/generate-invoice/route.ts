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
import { sendQuoteToColppy, type SendToColppyOptions, buildSplitItem, calcComponentPrice } from '@/lib/colppy'
import { calcDueDate } from '@/lib/quote-workflow'
import { logAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'

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

    if (quote.status !== 'ACCEPTED' && quote.status !== 'FACTURADA_PARCIAL') {
      return NextResponse.json(
        { error: `Solo se pueden facturar cotizaciones aceptadas o con facturación parcial (estado actual: ${quote.status})` },
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

      const fromInvoiceItems = quoteItem.invoiceItems
        .filter((ii) => ii.invoice.status !== 'CANCELLED')
        .reduce((sum, ii) => sum + Number(ii.quantity), 0)
      const fromColumn = Number(quoteItem.cantidadFacturada)
      const alreadyInvoiced = Math.max(fromInvoiceItems, fromColumn)

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
    // IMPORTANTE: QuoteItem.unitPrice INCLUYE adicionales (listPrice + additionalsPrices) * discount * multiplier
    // Necesitamos descomponer el precio en principal + adicionales separados
    const colppyItems = editedData
      ? editedData.items.map((editedItem) => {
          const originalItem = quote.items.find((i) => i.id === editedItem.id)
          if (!originalItem) {
            return {
              productName: editedItem.descripcion,
              productSku: editedItem.sku,
              quantity: editedItem.cantidad,
              unitPrice: editedItem.precioUnitario,
              iva: editedItem.iva,
              comentario: editedItem.comentario,
              deliveryTime: undefined as string | undefined,
              additionals: [] as Array<{ name: string; unitPrice: number; sku: string }>,
            }
          }
          return buildSplitItem(originalItem, calcComponentPrice, quote, editedItem)
        })
      : requestedItems.map((req) => {
          const quoteItem = quote.items.find((i) => i.id === req.quoteItemId)!
          return buildSplitItem(quoteItem, calcComponentPrice, quote, { cantidad: req.quantity })
        })

    logger.info('[Generate Invoice] Items a enviar:', JSON.stringify(colppyItems, null, 2))

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
        logger.info(`[Colppy Sync] paymentTerms=${colppyResult.customerPaymentTermsDays} guardado para cliente ${quote.customerId}`);
      } catch (syncErr: any) {
        logger.warn(`[Colppy Sync] Error al sincronizar paymentTerms: ${syncErr.message}`);
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
          colppyId: colppyResult.facturaId || null,
          subtotal,
          taxAmount: 0,
          discount: 0,
          total: subtotal,
          balance: subtotal,
          issueDate: now,
          dueDate: calcDueDate(now, quote.customer.paymentTerms),
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

      // Crear CotizacionFactura (modelo nuevo) + items vinculados a esta Invoice.
      // Representa el envío a Colppy como unidad atómica para poder generar remito
      // específico por factura parcial.
      const tcUsado = quote.exchangeRate ? Number(quote.exchangeRate) : 1
      const montoUSD = quote.currency === 'USD' ? subtotal : subtotal / (tcUsado || 1)
      const montoARS = quote.currency === 'USD' ? subtotal * tcUsado : subtotal
      await tx.cotizacionFactura.create({
        data: {
          cotizacionId: quote.id,
          invoiceId: newInvoice.id,
          colppyInvoiceId: colppyResult.facturaId || null,
          numeroFactura: colppyResult.facturaNumber || colppyResult.remitoNumber || null,
          fecha: now,
          montoUSD,
          montoARS,
          tipoCambio: tcUsado,
          estado: 'BORRADOR',
          createdById: session.user!.id!,
          items: {
            create: requestedItems.map((req) => {
              const quoteItem = quote.items.find((qi) => qi.id === req.quoteItemId)!
              return {
                cotizacionItemId: quoteItem.id,
                cantidad: req.quantity,
                precioUnitario: Number(quoteItem.unitPrice),
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

      // Incrementar cantidadFacturada por cada item solicitado
      for (const req of requestedItems) {
        await tx.quoteItem.update({
          where: { id: req.quoteItemId },
          data: { cantidadFacturada: { increment: req.quantity } },
        })
      }

      // Verificar si TODOS los ítems están ahora completamente facturados.
      // Considera dos fuentes para compatibilidad: cantidadFacturada (nuevo flow)
      // y suma de InvoiceItems no cancelados (flow legacy / quotes anteriores al fix).
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
        const fromInvoiceItems = item.invoiceItems
          .filter((ii) => ii.invoice.status !== 'CANCELLED')
          .reduce((sum, ii) => sum + Number(ii.quantity), 0)
        const fromColumn = Number(item.cantidadFacturada)
        const effective = Math.max(fromInvoiceItems, fromColumn)
        return effective >= item.quantity
      })

      const fromStatus = quote.status
      const toStatus = isFullyInvoiced && colppyResult.facturaId
        ? 'CONVERTED'
        : 'FACTURADA_PARCIAL'

      await tx.quote.update({
        where: { id: quoteId },
        data: {
          status: toStatus,
          statusUpdatedAt: now,
          statusUpdatedBy: session.user!.id!,
        },
      })

      await tx.quoteStatusHistory.create({
        data: {
          quoteId,
          fromStatus,
          toStatus,
          changedBy: session.user!.id!,
          notes: `${toStatus === 'CONVERTED' ? 'Facturación completa' : 'Facturación parcial'} enviada a Colppy (${colppyAction}). ${colppyResult.facturaNumber ? `Factura: ${colppyResult.facturaNumber}` : ''} ${colppyResult.remitoNumber ? `Remito: ${colppyResult.remitoNumber}` : ''} (${requestedItems.length} ítems)`.trim(),
        },
      })
    })

    // Registrar auditoría
    logAudit({
      userId: session.user.id,
      userName: session.user.name || '',
      userEmail: session.user.email || '',
      action: 'CREATE',
      entity: 'INVOICE',
      entityId: colppyResult.facturaId || colppyResult.remitoId || undefined,
      entityRef: colppyResult.facturaNumber || colppyResult.remitoNumber || undefined,
      description: `Generó factura desde cotización ${quote.quoteNumber} para ${quote.customer.name}. ${colppyResult.facturaNumber ? `Factura: ${colppyResult.facturaNumber}` : ''} ${colppyResult.remitoNumber ? `Remito: ${colppyResult.remitoNumber}` : ''}`.trim(),
    });

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
    logger.error('Error generating invoice for Colppy:', error)
    return NextResponse.json(
      { error: error.message || 'Error al enviar a Colppy' },
      { status: 500 }
    )
  }
}
