/**
 * Endpoint API: POST /api/quotes/[id]/send-to-colppy
 * Envía una cotización a Colppy (remito, factura, o ambos)
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { sendQuoteToColppy, type SendToColppyOptions, buildSplitItem, calcComponentPrice } from '@/lib/colppy';
import { QuoteStatus } from '@prisma/client';
import { calcDueDate } from '@/lib/quote-workflow';
import { logAudit } from '@/lib/audit';
import { logger } from '@/lib/logger'

// ============================================================================
// TIPOS
// ============================================================================

interface EditableItem {
  id: string;
  sku: string;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  iva: number;
  comentario: string;
}

interface SendToColppyRequest {
  action: 'remito' | 'factura-cuenta-corriente' | 'factura-contado' | 'remito-factura';
  editedData?: {
    items: EditableItem[];
    condicionPago: string;
    puntoVenta: string;
    descripcion: string;
  };
}

// ============================================================================
// HANDLER POST
// ============================================================================

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 1. Autenticación
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'No autorizado' },
        { status: 401 }
      );
    }

    // 2. Obtener parámetros
    const { id } = await params;

    // 3. Parsear body
    const body = await request.json() as SendToColppyRequest;
    const { action, editedData } = body;

    // 4. Validar acción
    const validActions: SendToColppyRequest['action'][] = [
      'remito',
      'factura-cuenta-corriente',
      'factura-contado',
      'remito-factura',
    ];

    if (!action || !validActions.includes(action)) {
      return NextResponse.json(
        { error: 'Acción inválida. Debe ser: remito, factura-cuenta-corriente, factura-contado, o remito-factura' },
        { status: 400 }
      );
    }

    // 5. Buscar cotización con includes
    const quote = await prisma.quote.findUnique({
      where: { id },
      include: {
        customer: true,
        items: {
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
          orderBy: {
            itemNumber: 'asc',
          },
        },
      },
    });

    if (!quote) {
      return NextResponse.json(
        { error: 'Cotización no encontrada' },
        { status: 404 }
      );
    }

    // 5. Validar estado: ACCEPTED (sin facturar) o FACTURADA_PARCIAL (con items pendientes)
    if (quote.status !== QuoteStatus.ACCEPTED && quote.status !== QuoteStatus.FACTURADA_PARCIAL) {
      return NextResponse.json(
        { error: `La cotización debe estar en estado ACCEPTED o FACTURADA_PARCIAL (actual: ${quote.status})` },
        { status: 400 }
      );
    }

    // 6. Validar remito previo. Para factura permitimos múltiples envíos (parcial).
    if (action.includes('remito') && quote.colppyDeliveryNoteId) {
      return NextResponse.json(
        { error: 'Esta cotización ya tiene un remito asociado en Colppy' },
        { status: 409 }
      );
    }

    // 6b. Calcular cantidades ya facturadas por item (max entre cantidadFacturada y suma de InvoiceItems no cancelados)
    const alreadyInvoicedByItem = new Map<string, number>();
    for (const item of quote.items) {
      const fromInvoiceItems = item.invoiceItems
        .filter((ii) => ii.invoice.status !== 'CANCELLED')
        .reduce((sum, ii) => sum + Number(ii.quantity), 0);
      const fromColumn = Number(item.cantidadFacturada);
      alreadyInvoicedByItem.set(item.id, Math.max(fromInvoiceItems, fromColumn));
    }

    // 6c. Si es una factura, validar que haya algo pendiente de facturar
    if (action.includes('factura')) {
      const pendingItems = quote.items.filter((i) => {
        if (i.isAlternative) return false;
        const already = alreadyInvoicedByItem.get(i.id) ?? 0;
        return i.quantity - already > 0;
      });
      if (pendingItems.length === 0) {
        return NextResponse.json(
          { error: 'No hay items pendientes de facturar en esta cotización' },
          { status: 400 }
        );
      }

      // Validar cada item del editedData contra su cantidadPendiente
      if (editedData?.items) {
        for (const editedItem of editedData.items) {
          const original = quote.items.find((i) => i.id === editedItem.id);
          if (!original) continue;
          const already = alreadyInvoicedByItem.get(original.id) ?? 0;
          const pending = original.quantity - already;
          if (editedItem.cantidad > pending) {
            return NextResponse.json(
              {
                error: `Ítem "${original.description || (original as any).product?.name || editedItem.sku}": cantidad solicitada (${editedItem.cantidad}) excede la pendiente (${pending}, ya facturado ${already} de ${original.quantity})`,
              },
              { status: 400 }
            );
          }
        }
      }
    }

    // 7. Obtener el último tipo de cambio del ERP (para USD)
    let currentExchangeRate = quote.exchangeRate ? Number(quote.exchangeRate) : null;
    let exchangeRateDate: Date | null = null;

    if (quote.currency === 'USD') {
      const latestRate = await prisma.exchangeRate.findFirst({
        where: { fromCurrency: 'USD', toCurrency: 'ARS' },
        orderBy: { validFrom: 'desc' },
      });

      if (latestRate) {
        currentExchangeRate = Number(latestRate.rate);
        exchangeRateDate = latestRate.validFrom;
        logger.info(`[Send to Colppy] Usando TC del ERP: ${currentExchangeRate} (del ${latestRate.validFrom.toISOString()}), TC cotización: ${quote.exchangeRate}`);
      } else if (!quote.exchangeRate) {
        return NextResponse.json(
          { error: 'No hay tipo de cambio disponible. Cargue uno en la sección Tipo de Cambio.' },
          { status: 400 }
        );
      } else {
        logger.warn(`[Send to Colppy] No se encontró TC en el ERP, usando TC de la cotización: ${quote.exchangeRate}`);
      }
    }

    // 8. Preparar datos para Colppy
    // IMPORTANTE: QuoteItem.unitPrice INCLUYE adicionales (listPrice + additionalsPrices) * discount * multiplier
    // Necesitamos descomponer el precio en principal + adicionales separados
    const quoteItems = (editedData
      ? editedData.items.map((editedItem) => {
          const originalItem = quote.items.find((i) => i.id === editedItem.id);
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
            };
          }
          return buildSplitItem(originalItem, calcComponentPrice, quote, editedItem);
        })
      : quote.items.map((item) => buildSplitItem(item, calcComponentPrice, quote))
    );

    logger.info('[Send to Colppy] Items a enviar:', JSON.stringify(quoteItems, null, 2));

    const quoteData = {
      id: quote.id,
      quoteNumber: quote.quoteNumber,
      currency: quote.currency,
      exchangeRate: currentExchangeRate,
      pricesIncludeTax: quote.pricesIncludeTax,
      customer: {
        name: quote.customer.name,
        cuit: quote.customer.cuit,
        taxCondition: quote.customer.taxCondition,
        address: quote.customer.address || undefined,
        phone: quote.customer.phone || undefined,
        email: quote.customer.email || undefined,
      },
      items: quoteItems,
    };

    // 9. Llamar a sendQuoteToColppy
    const options: SendToColppyOptions = {
      action,
      condicionPago: editedData?.condicionPago,
      puntoVenta: editedData?.puntoVenta,
      descripcion: editedData?.descripcion,
    };
    const result = await sendQuoteToColppy(options, quoteData);

    // 10. Verificar resultado
    if (!result.success) {
      return NextResponse.json(
        { error: `Error al enviar a Colppy: ${result.error}` },
        { status: 500 }
      );
    }

    // 11. Persistir resultado en una transacción:
    //   - crear Invoice + InvoiceItem (legacy tracking)
    //   - incrementar QuoteItem.cantidadFacturada
    //   - actualizar Quote.status (FACTURADA_PARCIAL o CONVERTED) y colppyIds
    //
    // TODO: deduplicar este flujo con el endpoint hermano.
    // Ver src/app/api/facturacion/generate-invoice/route.ts (transacción equivalente).
    // Cualquier cambio en uno debe replicarse en el otro hasta que se haga el
    // refactor a src/lib/colppy-billing.ts.
    const now = new Date();
    const invoiceType = quote.customer.taxCondition === 'RESPONSABLE_INSCRIPTO' ? 'A' : 'B';

    // Mapa de cantidades realmente enviadas por quoteItemId
    const sentQtyByItemId = new Map<string, number>();
    for (const editedItem of (editedData?.items || [])) {
      const original = quote.items.find((i) => i.id === editedItem.id);
      if (original) sentQtyByItemId.set(original.id, editedItem.cantidad);
    }
    // Fallback: si no vino editedData, asumir cantidad pendiente para cada item no-alternativo
    if (sentQtyByItemId.size === 0) {
      for (const item of quote.items) {
        if (item.isAlternative) continue;
        const already = alreadyInvoicedByItem.get(item.id) ?? 0;
        const pending = item.quantity - already;
        if (pending > 0) sentQtyByItemId.set(item.id, pending);
      }
    }

    // Cálculos previos a la transacción. Los necesitamos también para el
    // breadcrumb del caso COLPPY_ORPHAN (factura emitida + persistencia fallida).
    const subtotalPre = action.includes('factura')
      ? Array.from(sentQtyByItemId.entries()).reduce((sum, [itemId, qty]) => {
          const item = quote.items.find((i) => i.id === itemId);
          return sum + (item ? Number(item.unitPrice) * qty : 0);
        }, 0)
      : 0;
    const tcUsado = quote.exchangeRate ? Number(quote.exchangeRate) : 1;
    const montoUSDPre = quote.currency === 'USD' ? subtotalPre : subtotalPre / (tcUsado || 1);
    const montoARSPre = quote.currency === 'USD' ? subtotalPre * tcUsado : subtotalPre;

    try {
    await prisma.$transaction(async (tx) => {
      if (action.includes('factura')) {
        // Crear Invoice + InvoiceItems (consistente con generate-invoice)
        const subtotal = subtotalPre;

        const newInvoice = await tx.invoice.create({
          data: {
            invoiceNumber: `BORRADOR-COLPPY-${result.facturaNumber || result.remitoNumber || Date.now()}`,
            invoiceType,
            transactionType: 'SALE',
            quoteId: quote.id,
            customerId: quote.customerId,
            userId: quote.salesPersonId || session.user!.id!,
            status: 'DRAFT',
            currency: quote.currency,
            exchangeRate: quote.exchangeRate,
            colppyId: result.facturaId || null,
            subtotal,
            taxAmount: 0,
            discount: 0,
            total: subtotal,
            balance: subtotal,
            issueDate: now,
            dueDate: calcDueDate(now, quote.customer.paymentTerms),
            notes: `Borrador enviado a Colppy el ${now.toLocaleString('es-AR')}. ${result.facturaNumber ? `Factura: ${result.facturaNumber}` : ''} ${result.remitoNumber ? `Remito: ${result.remitoNumber}` : ''}`.trim(),
            afipStatus: 'PENDING',
            paymentStatus: 'UNPAID',
            items: {
              create: Array.from(sentQtyByItemId.entries()).map(([itemId, qty]) => {
                const item = quote.items.find((i) => i.id === itemId)!;
                return {
                  productId: item.productId || null,
                  quoteItemId: item.id,
                  description: item.description || (item as any).product?.name || 'Item',
                  quantity: qty,
                  unitPrice: Number(item.unitPrice),
                  discount: 0,
                  taxRate: 21,
                  subtotal: Number(item.unitPrice) * qty,
                };
              }),
            },
          },
        });

        // Crear CotizacionFactura (modelo nuevo) + items, linkeado a Invoice.
        const montoUSD = montoUSDPre;
        const montoARS = montoARSPre;
        await tx.cotizacionFactura.create({
          data: {
            cotizacionId: quote.id,
            invoiceId: newInvoice.id,
            colppyInvoiceId: result.facturaId || null,
            numeroFactura: result.facturaNumber || result.remitoNumber || null,
            fecha: now,
            montoUSD,
            montoARS,
            tipoCambio: tcUsado,
            estado: 'BORRADOR',
            createdById: session.user!.id!,
            items: {
              create: Array.from(sentQtyByItemId.entries()).map(([itemId, qty]) => {
                const item = quote.items.find((i) => i.id === itemId)!;
                return {
                  cotizacionItemId: item.id,
                  cantidad: qty,
                  precioUnitario: Number(item.unitPrice),
                  subtotal: Number(item.unitPrice) * qty,
                };
              }),
            },
          },
        });

        // Incrementar cantidadFacturada por item enviado
        for (const [itemId, qty] of sentQtyByItemId.entries()) {
          await tx.quoteItem.update({
            where: { id: itemId },
            data: { cantidadFacturada: { increment: qty } },
          });
        }
      }

      // Determinar nuevo estado: CONVERTED si todo está facturado, sino FACTURADA_PARCIAL.
      // Para la verificación post-incremento volvemos a leer cantidadFacturada.
      const refreshedItems = await tx.quoteItem.findMany({
        where: { quoteId: quote.id, isAlternative: false },
        include: {
          invoiceItems: {
            include: { invoice: { select: { status: true } } },
          },
        },
      });

      const isFullyInvoiced = action.includes('factura') && refreshedItems.every((item) => {
        const fromInvoiceItems = item.invoiceItems
          .filter((ii) => ii.invoice.status !== 'CANCELLED')
          .reduce((sum, ii) => sum + Number(ii.quantity), 0);
        const fromColumn = Number(item.cantidadFacturada);
        return Math.max(fromInvoiceItems, fromColumn) >= item.quantity;
      });

      const updateData: any = {
        colppySyncedAt: now,
        statusUpdatedAt: now,
        statusUpdatedBy: session.user!.id!,
      };
      if (result.remitoId) updateData.colppyDeliveryNoteId = result.remitoId;
      if (result.facturaId) updateData.colppyInvoiceId = result.facturaId;

      const fromStatus = quote.status;
      if (action.includes('factura')) {
        updateData.status = isFullyInvoiced ? QuoteStatus.CONVERTED : QuoteStatus.FACTURADA_PARCIAL;
      }

      await tx.quote.update({
        where: { id: quote.id },
        data: updateData,
      });

      await tx.quoteStatusHistory.create({
        data: {
          quoteId: quote.id,
          fromStatus,
          toStatus: updateData.status || fromStatus,
          changedBy: session.user!.id!,
          notes: `Enviado a Colppy: ${action}. ${result.remitoNumber ? `Remito: ${result.remitoNumber}` : ''} ${result.facturaNumber ? `Factura: ${result.facturaNumber}` : ''}${action.includes('factura') ? (isFullyInvoiced ? ' (facturación completa)' : ' (facturación parcial)') : ''}`.trim(),
        },
      });
    }, { maxWait: 10000, timeout: 60000 });
    } catch (txError: any) {
      // CASO CRÍTICO: Colppy YA emitió la factura/remito (result.success === true
      // arriba), pero la persistencia local falló (timeout, deadlock, etc.).
      // Misma lógica que el endpoint hermano /api/facturacion/generate-invoice.

      // a) Log SIEMPRE primero, último resorte para grepabilidad.
      logger.error('[COLPPY_ORPHAN] Factura emitida en Colppy pero persistencia ERP falló', {
        quoteId: quote.id,
        quoteNumber: quote.quoteNumber,
        action,
        facturaId: result.facturaId,
        facturaNumber: result.facturaNumber,
        remitoId: result.remitoId,
        remitoNumber: result.remitoNumber,
        error: txError?.message,
        stack: txError?.stack,
      });

      // b) Best-effort: breadcrumb en cotizacion_facturas con estado='ERROR_GUARDADO'
      //    SOLO si la acción incluía facturación. Para 'remito' puro no aplica el
      //    modelo CotizacionFactura, así que el breadcrumb queda solo en logs + audit.
      if (action.includes('factura')) {
        try {
          const stackTrunc = `${txError?.message || 'sin mensaje'}\n---\n${txError?.stack || 'sin stack'}`.slice(0, 2000);
          await prisma.cotizacionFactura.create({
            data: {
              cotizacionId: quote.id,
              colppyInvoiceId: result.facturaId || null,
              numeroFactura: result.facturaNumber || result.remitoNumber || null,
              fecha: now,
              montoUSD: montoUSDPre,
              montoARS: montoARSPre,
              tipoCambio: tcUsado,
              estado: 'ERROR_GUARDADO',
              errorMessage: stackTrunc,
              createdById: session.user!.id!,
            },
          });
        } catch (breadcrumbError: any) {
          logger.error('[COLPPY_ORPHAN_BREADCRUMB_FAILED] No se pudo persistir el breadcrumb de error', {
            quoteId: quote.id,
            quoteNumber: quote.quoteNumber,
            facturaId: result.facturaId,
            facturaNumber: result.facturaNumber,
            breadcrumbError: breadcrumbError?.message,
          });
        }
      }

      // c) AuditLog best-effort.
      try {
        logAudit({
          userId: session.user.id,
          userName: session.user.name || '',
          userEmail: session.user.email || '',
          action: 'COLPPY_ORPHAN',
          entity: 'QUOTE',
          entityId: quote.id,
          entityRef: quote.quoteNumber,
          description: `Factura emitida en Colppy pero persistencia ERP falló — quote=${quote.quoteNumber}, action=${action}, facturaColppy=${result.facturaNumber || result.facturaId || 'n/a'}, remitoColppy=${result.remitoNumber || 'n/a'}`,
        });
      } catch {
        // logAudit no debería tirar (fire-and-forget) pero por las dudas
      }

      // d) Response estructurado para que el cliente muestre AlertDialog bloqueante.
      return NextResponse.json(
        {
          errorCode: 'COLPPY_ORPHAN',
          message:
            'La factura se emitió correctamente en Colppy pero el ERP no pudo registrarla. NO REINTENTES — contactá a soporte con el número de factura de Colppy para reconciliar manualmente.',
          colppyFacturaId: result.facturaId || null,
          colppyFacturaNumber: result.facturaNumber || null,
          colppyRemitoNumber: result.remitoNumber || null,
        },
        { status: 500 }
      );
    }

    // 11b. Sincronizar paymentTerms del cliente desde Colppy a DB local
    if (result.customerPaymentTermsDays != null && quote.customerId) {
      try {
        await prisma.customer.update({
          where: { id: quote.customerId },
          data: { paymentTerms: result.customerPaymentTermsDays },
        });
        logger.info(`[Colppy Sync] paymentTerms=${result.customerPaymentTermsDays} guardado para cliente ${quote.customerId}`);
      } catch (syncErr: any) {
        // No bloquear la operación principal si falla el sync
        logger.warn(`[Colppy Sync] Error al sincronizar paymentTerms: ${syncErr.message}`);
      }
    }

    // 13. Registrar auditoría
    logAudit({
      userId: session.user.id,
      userName: session.user.name || '',
      userEmail: session.user.email || '',
      action: 'SEND',
      entity: 'QUOTE',
      entityId: quote.id,
      entityRef: quote.quoteNumber,
      description: `Envió cotización ${quote.quoteNumber} a Colppy (${action}). ${result.remitoNumber ? `Remito: ${result.remitoNumber}` : ''} ${result.facturaNumber ? `Factura: ${result.facturaNumber}` : ''}`.trim(),
    });

    // 14. Retornar resultado
    return NextResponse.json({
      success: true,
      message: 'Cotización enviada a Colppy exitosamente',
      remitoId: result.remitoId,
      remitoNumber: result.remitoNumber,
      facturaId: result.facturaId,
      facturaNumber: result.facturaNumber,
      exchangeRateUsed: currentExchangeRate,
      exchangeRateDate: exchangeRateDate?.toISOString() || null,
    });
  } catch (error: any) {
    logger.error('Error en POST /api/quotes/[id]/send-to-colppy:', error);

    return NextResponse.json(
      { error: error.message || 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
