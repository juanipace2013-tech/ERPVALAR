/**
 * API Endpoint: POST /api/facturacion/generate-invoice
 * Factura ítems seleccionados de una cotización.
 * Reutiliza sendQuoteToColppy() — misma lógica que el módulo de Cotizaciones.
 *
 * Acepta el mismo payload que SendToColppyDialog produce:
 *   { quoteId, items, action, editedData }
 *
 * Dos modos según FACTURACION_EMISOR (ver src/lib/facturacion/emision-arca.ts):
 *   - colppy (histórico): crea un BORRADOR en Colppy; el usuario la emite allá
 *     y el sync trae número + CAE.
 *   - arca: el ERP emite en ARCA (PV 7, CAE propio) y carga la factura en
 *     Colppy ya emitida (Aprobada) para que mueva CC, stock y asientos.
 */

import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { sendQuoteToColppy, type SendToColppyOptions, buildSplitItem, calcComponentPrice, splitItemUnitTotal, splitItemLineTotal } from '@/lib/colppy'
import { calcDueDate } from '@/lib/quote-workflow'
import { logAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { syncStockForSkusFireAndForget } from '@/lib/colppy-inventory'
import { sincronizarComisionesDeQuote } from '@/lib/comisiones/liquidacion'
import { crearHookEmisionArca, getEmisorFacturacion } from '@/lib/facturacion/emision-arca'

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
        exchangeRate?: number
        exchangeRateModo?: 'BILLETE' | 'DIVISA'
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

    // TC de la factura (solo USD): el elegido en el dialogo (billete del
    // sistema por defecto, o divisa/manual); si no vino, el de la cotizacion.
    const tcFactura =
      quote.currency === 'USD'
        ? (Number(editedData?.exchangeRate) > 0 ? Number(editedData!.exchangeRate) : quote.exchangeRate ? Number(quote.exchangeRate) : null)
        : null
    if (quote.currency === 'USD' && !tcFactura) {
      return NextResponse.json(
        { error: 'La cotización en USD debe tener un tipo de cambio definido' },
        { status: 400 }
      )
    }
    if (quote.currency === 'USD' && tcFactura && quote.exchangeRate && Math.abs(tcFactura - Number(quote.exchangeRate)) > 0.001) {
      logger.info(`[Generate Invoice] TC de factura ${tcFactura} (${editedData?.exchangeRateModo || 'manual'}) distinto al de la cotizacion ${Number(quote.exchangeRate)} — quote ${quote.quoteNumber}`)
    }

    // Cantidad pendiente de facturar de un quoteItem (max entre la columna
    // cantidadFacturada y la suma de InvoiceItems no cancelados).
    const remainingFor = (quoteItem: (typeof quote.items)[number]): number => {
      const fromInvoiceItems = quoteItem.invoiceItems
        .filter((ii) => ii.invoice.status !== 'CANCELLED')
        .reduce((sum, ii) => sum + Number(ii.quantity), 0)
      const fromColumn = Number(quoteItem.cantidadFacturada)
      return quoteItem.quantity - Math.max(fromInvoiceItems, fromColumn)
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

      const remaining = remainingFor(quoteItem)

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

    // Validar TAMBIÉN los ítems del editedData: cuando viene, son los que
    // realmente arman el payload de Colppy y los que se persisten (lineItems
    // más abajo), así que la validación de pendientes tiene que correr sobre
    // ellos — protege contra race conditions entre abrir el dialog y confirmar.
    if (editedData) {
      if (!editedData.items?.length) {
        return NextResponse.json(
          { error: 'No hay ítems seleccionados para facturar' },
          { status: 400 }
        )
      }
      for (const editedItem of editedData.items) {
        const quoteItem = quote.items.find((i) => i.id === editedItem.id)
        if (!quoteItem) continue // ítem manual sin quoteItem asociado: no afecta cantidadFacturada

        if (editedItem.cantidad <= 0) {
          return NextResponse.json(
            { error: `Ítem "${editedItem.descripcion}": la cantidad debe ser mayor a 0` },
            { status: 400 }
          )
        }

        const remaining = remainingFor(quoteItem)
        if (editedItem.cantidad > remaining) {
          return NextResponse.json(
            {
              error: `Ítem "${quoteItem.description || quoteItem.product?.name}": cantidad solicitada (${editedItem.cantidad}) excede la pendiente (${remaining})`,
            },
            { status: 400 }
          )
        }
      }
    }

    // Construir datos para Colppy — UNA SOLA FUENTE DE VERDAD por línea.
    // IMPORTANTE: QuoteItem.unitPrice INCLUYE adicionales (listPrice + additionalsPrices) * discount * multiplier.
    // Descomponemos el precio en principal + adicionales (split) y, de ese MISMO
    // objeto, derivamos tanto el payload Colppy como TODOS los montos locales
    // (cabecera + items), para que sea imposible que diverjan del número real de
    // la factura. Cada `lineItem` empareja el split con su quoteItem persistible.
    const lineItems = editedData
      ? editedData.items.map((editedItem) => {
          const quoteItem = quote.items.find((i) => i.id === editedItem.id) || null
          const split = quoteItem
            ? buildSplitItem(quoteItem, calcComponentPrice, quote, editedItem)
            : {
                productName: editedItem.descripcion,
                productSku: editedItem.sku,
                quantity: editedItem.cantidad,
                unitPrice: editedItem.precioUnitario,
                iva: editedItem.iva,
                comentario: editedItem.comentario,
                deliveryTime: undefined as string | undefined,
                additionals: [] as Array<{ name: string; unitPrice: number; sku: string }>,
              }
          return { quoteItem, split }
        })
      : requestedItems.map((req) => {
          const quoteItem = quote.items.find((i) => i.id === req.quoteItemId)!
          const split = buildSplitItem(quoteItem, calcComponentPrice, quote, { cantidad: req.quantity })
          return { quoteItem, split }
        })

    const colppyItems = lineItems.map((l) => l.split)

    logger.info('[Generate Invoice] Items a enviar:', JSON.stringify(colppyItems, null, 2))

    // Enviar a Colppy usando la función existente
    const colppyAction = action || 'factura-cuenta-corriente'
    const emiteFactura = colppyAction !== 'remito'
    // Emisor: 'arca' → el ERP pide el CAE y Colppy recibe la factura ya emitida.
    const emisor = emiteFactura ? getEmisorFacturacion() : 'colppy'
    const hookArca = emisor === 'arca'
      ? crearHookEmisionArca({
          name: quote.customer.name,
          cuit: quote.customer.cuit,
          taxCondition: quote.customer.taxCondition,
          fceObligado: quote.customer.fceObligado,
        })
      : null
    const colppyOptions: SendToColppyOptions = {
      action: colppyAction,
      condicionPago: editedData?.condicionPago || undefined,
      puntoVenta: editedData?.puntoVenta || undefined,
      descripcion: editedData?.descripcion || `Cotización ${quote.quoteNumber} (parcial: ${colppyItems.length} ítems)`,
      emisionExterna: hookArca?.hook,
    }

    const colppyResult = await sendQuoteToColppy(colppyOptions, {
      id: quote.id,
      quoteNumber: quote.quoteNumber,
      currency: quote.currency,
      exchangeRate: tcFactura,
      bonification: Number(quote.bonification ?? 0),
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

    // Emisión ARCA ya realizada (aunque Colppy haya fallado después)
    const emisionArca = hookArca?.getEmision() ?? null

    if (!colppyResult.success && !emisionArca) {
      // Nada quedó emitido: rechazo de ARCA o error de Colppy/red antes de emitir.
      const prefix = colppyResult.errorStage === 'arca' ? 'ARCA rechazó la factura' : 'Error al enviar a Colppy'
      return NextResponse.json(
        { error: `${prefix}: ${colppyResult.error}`, errorStage: colppyResult.errorStage ?? 'colppy' },
        { status: colppyResult.errorStage === 'arca' ? 422 : 500 }
      )
    }

    // CAE obtenido pero el alta en Colppy falló: la factura EXISTE fiscalmente,
    // se persiste igual marcada PENDIENTE de Colppy y se reintenta después
    // (POST /api/facturas/[id]/reenviar-colppy). Nunca se vuelve a emitir.
    const colppyPendiente = !colppyResult.success && !!emisionArca
    if (colppyPendiente) {
      logger.error('[ARCA_SIN_COLPPY] Factura emitida en ARCA pero el alta en Colppy falló', {
        quoteId: quote.id,
        quoteNumber: quote.quoteNumber,
        numero: emisionArca!.numeroFormateado,
        cae: emisionArca!.cae,
        error: colppyResult.error,
      })
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

    // Cálculos previos a la transacción. Los necesitamos también para el
    // breadcrumb del caso COLPPY_ORPHAN (factura emitida + persistencia fallida).
    const invoiceType = emisionArca
      ? ([1, 201].includes(emisionArca.cbteTipo) ? 'A' : emisionArca.cbteTipo === 11 ? 'C' : 'B')
      : quote.customer.taxCondition === 'RESPONSABLE_INSCRIPTO' ? 'A' : 'B'
    // Numero interno unico: la letra va adelante porque A, B y NC comparten
    // numeracion por PV (A-0007-00000001, B-0007-00000001, NCA-0007-00000001).
    // FCE (201/206) tiene numeracion propia por cbteTipo → prefijo FCEA/FCEB.
    const esFceEmitida = !!emisionArca && emisionArca.cbteTipo >= 201
    const invoiceNumber = emisionArca
      ? `${esFceEmitida ? 'FCE' : ''}${invoiceType}-${emisionArca.numeroFormateado}`
      : `BORRADOR-COLPPY-${colppyResult.facturaNumber || colppyResult.remitoNumber || Date.now()}`
    // Totales fiscales reales (solo emisión ARCA): los mismos que recibió Colppy.
    const payloadColppy = colppyResult.colppyInvoicePayload
    const taxAmount = emisionArca && payloadColppy ? Number(payloadColppy.totalIVA) : 0
    const totalFiscal = emisionArca && payloadColppy ? Number(payloadColppy.totalFactura) : null
    // Subtotal = Σ total de línea (principal + adicionales, ya redondeados). Es
    // EXACTAMENTE la suma de las líneas que factura Colppy.
    const subtotal = Math.round(
      lineItems.reduce((sum, l) => sum + splitItemLineTotal(l.split), 0) * 100
    ) / 100
    const tcUsado = tcFactura ?? (quote.exchangeRate ? Number(quote.exchangeRate) : 1)
    const montoUSD = quote.currency === 'USD' ? subtotal : Math.round((subtotal / (tcUsado || 1)) * 100) / 100
    const montoARS = quote.currency === 'USD' ? Math.round(subtotal * tcUsado * 100) / 100 : subtotal

    // TODO: deduplicar este flujo con el endpoint hermano.
    // Ver src/app/api/quotes/[id]/send-to-colppy/route.ts (transacción equivalente).
    // Cualquier cambio en uno debe replicarse en el otro hasta que se haga el
    // refactor a src/lib/colppy-billing.ts.
    let invoiceIdCreado: string | null = null
    try {
    await prisma.$transaction(async (tx) => {
      const newInvoice = await tx.invoice.create({
        data: {
          invoiceNumber,
          invoiceType,
          transactionType: 'SALE',
          quoteId: quote.id,
          customerId: quote.customerId,
          userId: quote.salesPersonId || session.user!.id!,
          status: emisionArca ? 'AUTHORIZED' : 'DRAFT',
          currency: quote.currency,
          exchangeRate: quote.currency === 'USD' ? tcFactura : quote.exchangeRate,
          colppyId: colppyResult.facturaId || null,
          // Emisión ARCA: neto fiscal real (el mismo que fue a ARCA y a Colppy)
          subtotal: emisionArca && payloadColppy ? Number(payloadColppy.netoGravado) : subtotal,
          taxAmount,
          discount: 0,
          total: totalFiscal ?? subtotal,
          balance: totalFiscal ?? subtotal,
          issueDate: now,
          dueDate: calcDueDate(now, quote.customer.paymentTerms),
          notes: emisionArca
            ? `Emitida por el ERP (ARCA) el ${now.toLocaleString('es-AR')}. CAE ${emisionArca.cae}. ${colppyPendiente ? 'PENDIENTE de registrar en Colppy.' : `Registrada en Colppy (${colppyResult.facturaId}).`} ${colppyResult.remitoNumber ? `Remito: ${colppyResult.remitoNumber}` : ''}`.trim()
            : `Borrador enviado a Colppy el ${now.toLocaleString('es-AR')}. ${colppyResult.facturaNumber ? `Factura: ${colppyResult.facturaNumber}` : ''} ${colppyResult.remitoNumber ? `Remito: ${colppyResult.remitoNumber}` : ''}`.trim(),
          afipStatus: emisionArca ? 'APPROVED' : 'PENDING',
          paymentStatus: 'UNPAID',
          // Emisión propia (ARCA)
          ...(emisionArca
            ? {
                emitidaPor: 'ARCA',
                pointOfSale: emisionArca.puntoVenta,
                cbteTipo: emisionArca.cbteTipo,
                cbteNumero: emisionArca.numero,
                cae: emisionArca.cae,
                caeExpiration: emisionArca.caeVencimiento,
                docTipo: hookArca?.getReceptor()?.docTipo ?? null,
                docNro: hookArca?.getReceptor()?.docNro ?? null,
                qrUrl: hookArca?.getQrUrl() ?? null,
                fceVtoPago: hookArca?.getFceVtoPago() ?? null,
                arcaObservaciones: emisionArca.observaciones.length
                  ? emisionArca.observaciones.map((o) => `[${o.Code}] ${o.Msg}`).join(' · ')
                  : null,
                colppySyncStatus: colppyPendiente ? 'PENDIENTE' : 'OK',
                colppySyncError: colppyPendiente ? (colppyResult.error || 'error desconocido').slice(0, 2000) : null,
                colppyPayload: payloadColppy ? (JSON.parse(JSON.stringify(payloadColppy)) as Prisma.InputJsonValue) : Prisma.JsonNull,
              }
            : {}),
          items: {
            create: lineItems
              .filter((l) => l.quoteItem)
              .map((l) => {
                const quoteItem = l.quoteItem!
                return {
                  productId: quoteItem.productId || null,
                  quoteItemId: quoteItem.id,
                  description: quoteItem.description || quoteItem.product?.name || 'Item',
                  quantity: l.split.quantity,
                  unitPrice: splitItemUnitTotal(l.split),
                  discount: 0,
                  taxRate: 21,
                  subtotal: splitItemLineTotal(l.split),
                }
              }),
          },
        },
      })
      invoiceIdCreado = newInvoice.id

      // Crear CotizacionFactura (modelo nuevo) + items vinculados a esta Invoice.
      // Representa el envío a Colppy como unidad atómica para poder generar remito
      // específico por factura parcial.
      await tx.cotizacionFactura.create({
        data: {
          cotizacionId: quote.id,
          invoiceId: newInvoice.id,
          colppyInvoiceId: colppyResult.facturaId || null,
          numeroFactura: emisionArca ? invoiceNumber : colppyResult.facturaNumber || colppyResult.remitoNumber || null,
          fecha: now,
          montoUSD,
          montoARS,
          tipoCambio: tcUsado,
          estado: emisionArca ? 'EMITIDA' : 'BORRADOR',
          createdById: session.user!.id!,
          items: {
            create: lineItems
              .filter((l) => l.quoteItem)
              .map((l) => ({
                cotizacionItemId: l.quoteItem!.id,
                cantidad: l.split.quantity,
                precioUnitario: splitItemUnitTotal(l.split),
                subtotal: splitItemLineTotal(l.split),
              })),
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

      // Incrementar cantidadFacturada por la cantidad realmente enviada a Colppy
      // (split.quantity = misma cantidad del payload, no la solicitada cruda).
      // Agregado por ítem y aplicado en UN solo UPDATE (antes: una query por ítem).
      const sentByItemId = new Map<string, number>()
      for (const l of lineItems) {
        if (!l.quoteItem) continue
        sentByItemId.set(
          l.quoteItem.id,
          (sentByItemId.get(l.quoteItem.id) || 0) + l.split.quantity
        )
      }

      if (sentByItemId.size > 0) {
        const values = Array.from(sentByItemId.entries()).map(
          ([id, qty]) => Prisma.sql`(${id}, ${qty}::numeric)`
        )
        await tx.$executeRaw`
          UPDATE quote_items AS qi
          SET "cantidadFacturada" = qi."cantidadFacturada" + v.qty,
              "updatedAt" = NOW()
          FROM (VALUES ${Prisma.join(values)}) AS v(id, qty)
          WHERE qi.id = v.id
        `
      }

      // Verificar si TODOS los ítems están ahora completamente facturados.
      // Considera dos fuentes para compatibilidad: cantidadFacturada (nuevo flow)
      // y suma de InvoiceItems no cancelados (flow legacy / quotes anteriores al fix).
      // Calculado en memoria: quote.items ya trae ambas fuentes previas, y la
      // Invoice DRAFT creada arriba les suma exactamente sentByItemId a las dos,
      // así que max(a, b) + enviado equivale a releer de la DB.
      const isFullyInvoiced = quote.items.every((item) => {
        const fromInvoiceItems = item.invoiceItems
          .filter((ii) => ii.invoice.status !== 'CANCELLED')
          .reduce((sum, ii) => sum + Number(ii.quantity), 0)
        const fromColumn = Number(item.cantidadFacturada)
        const sent = sentByItemId.get(item.id) || 0
        return Math.max(fromInvoiceItems, fromColumn) + sent >= item.quantity
      })

      const fromStatus = quote.status
      const toStatus = isFullyInvoiced && (colppyResult.facturaId || emisionArca)
        ? 'CONVERTED'
        : 'FACTURADA_PARCIAL'

      // Datos de Colppy + cambio de estado en un solo update (eran dos sobre la misma fila)
      await tx.quote.update({
        where: { id: quoteId },
        data: {
          ...updateData,
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
          notes: `${toStatus === 'CONVERTED' ? 'Facturación completa' : 'Facturación parcial'} ${emisionArca ? 'emitida por el ERP (ARCA)' : 'enviada a Colppy'} (${colppyAction}). ${emisionArca ? `Factura: ${emisionArca.numeroFormateado} CAE ${emisionArca.cae}` : colppyResult.facturaNumber ? `Factura: ${colppyResult.facturaNumber}` : ''} ${colppyResult.remitoNumber ? `Remito: ${colppyResult.remitoNumber}` : ''} (${requestedItems.length} ítems)`.trim(),
        },
      })
    }, { maxWait: 10000, timeout: 60000 })
    } catch (txError: any) {
      // CASO CRÍTICO: Colppy YA emitió la factura (colppyResult.success === true
      // arriba), pero la persistencia local falló (timeout, deadlock, etc.).
      // El ERP queda inconsistente: la cotización sigue en su estado anterior
      // pero la factura existe del lado de Colppy. Notificar al usuario con el
      // número de factura para reconciliar manualmente.

      // a) Log SIEMPRE primero, último resorte para grepabilidad.
      logger.error('[COLPPY_ORPHAN] Factura emitida en Colppy pero persistencia ERP falló', {
        quoteId: quote.id,
        quoteNumber: quote.quoteNumber,
        facturaId: colppyResult.facturaId,
        facturaNumber: colppyResult.facturaNumber,
        arca: emisionArca ? { numero: emisionArca.numeroFormateado, cae: emisionArca.cae } : undefined,
        remitoId: colppyResult.remitoId,
        remitoNumber: colppyResult.remitoNumber,
        error: txError?.message,
        stack: txError?.stack,
      })

      // b) Best-effort: breadcrumb en cotizacion_facturas con estado='ERROR_GUARDADO'.
      //    Propio try/catch para no enmascarar el error principal si la DB sigue muerta.
      try {
        const stackTrunc = `${txError?.message || 'sin mensaje'}\n---\n${txError?.stack || 'sin stack'}`.slice(0, 2000)
        await prisma.cotizacionFactura.create({
          data: {
            cotizacionId: quote.id,
            colppyInvoiceId: colppyResult.facturaId || null,
            numeroFactura: emisionArca?.numeroFormateado || colppyResult.facturaNumber || colppyResult.remitoNumber || null,
            fecha: now,
            montoUSD,
            montoARS,
            tipoCambio: tcUsado,
            estado: 'ERROR_GUARDADO',
            errorMessage: `${emisionArca ? `ARCA ${emisionArca.numeroFormateado} CAE ${emisionArca.cae}\n` : ''}${stackTrunc}`.slice(0, 2000),
            createdById: session.user!.id!,
          },
        })
      } catch (breadcrumbError: any) {
        logger.error('[COLPPY_ORPHAN_BREADCRUMB_FAILED] No se pudo persistir el breadcrumb de error', {
          quoteId: quote.id,
          quoteNumber: quote.quoteNumber,
          facturaId: colppyResult.facturaId,
          facturaNumber: colppyResult.facturaNumber,
          breadcrumbError: breadcrumbError?.message,
        })
      }

      // c) AuditLog best-effort. logAudit ya es fire-and-forget internamente.
      try {
        logAudit({
          userId: session.user.id,
          userName: session.user.name || '',
          userEmail: session.user.email || '',
          action: 'COLPPY_ORPHAN',
          entity: 'QUOTE',
          entityId: quote.id,
          entityRef: quote.quoteNumber,
          description: `Factura emitida en Colppy pero persistencia ERP falló — quote=${quote.quoteNumber}, facturaColppy=${colppyResult.facturaNumber || colppyResult.facturaId || 'sin número'}`,
        })
      } catch {
        // logAudit no debería tirar (fire-and-forget) pero por las dudas
      }

      // d) Response estructurado para que el cliente muestre AlertDialog bloqueante.
      return NextResponse.json(
        {
          errorCode: 'COLPPY_ORPHAN',
          message: emisionArca
            ? `La factura ${emisionArca.numeroFormateado} se emitió en ARCA (CAE ${emisionArca.cae}) pero el ERP no pudo registrarla. NO REINTENTES — contactá a soporte con ese número para reconciliar manualmente.`
            : 'La factura se emitió correctamente en Colppy pero el ERP no pudo registrarla. NO REINTENTES — contactá a soporte con el número de factura de Colppy para reconciliar manualmente.',
          colppyFacturaId: colppyResult.facturaId || null,
          colppyFacturaNumber: emisionArca?.numeroFormateado || colppyResult.facturaNumber || null,
          colppyRemitoNumber: colppyResult.remitoNumber || null,
          arcaCae: emisionArca?.cae || null,
        },
        { status: 500 }
      )
    }

    // Impactar la facturación en la liquidación de comisiones del mes del
    // vendedor (crea la liquidación ABIERTA si no existe). Best-effort en
    // background: son decenas de queries que el usuario no necesita esperar.
    sincronizarComisionesDeQuote(quote.id, { crearLiquidacion: true }).catch((err) =>
      logger.error('[COMISIONES_POST_BILLING] Error sincronizando comisiones', {
        quoteId: quote.id,
        quoteNumber: quote.quoteNumber,
        error: err?.message,
      })
    )

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

    // Re-sync de stock asíncrono (fire-and-forget) para SOLO los productos
    // facturados. No bloquea la respuesta; los logs viven con prefijo
    // [STOCK_SYNC_POST_BILLING]. Si Colppy está lento o el sync falla,
    // el ERP queda con stock stale hasta el próximo botón "Actualizar Stock"
    // o la próxima facturación — no se pierde nada crítico.
    const skusFacturados: string[] = []
    for (const l of lineItems) {
      const qi = l.quoteItem
      if (!qi) continue
      if (qi.product?.sku) skusFacturados.push(qi.product.sku)
      for (const add of qi.additionals || []) {
        if (add.product?.sku) skusFacturados.push(add.product.sku)
      }
    }
    syncStockForSkusFireAndForget(skusFacturados, {
      quoteId: quote.id,
      quoteNumber: quote.quoteNumber,
      action: colppyAction,
    })

    return NextResponse.json({
      success: true,
      message: emisionArca
        ? colppyPendiente
          ? `Factura ${emisionArca.numeroFormateado} emitida (CAE ${emisionArca.cae}). ATENCIÓN: no se pudo registrar en Colppy, reintentar desde la factura.`
          : `Factura ${emisionArca.numeroFormateado} emitida (CAE ${emisionArca.cae}) y registrada en Colppy`
        : 'Enviado a Colppy exitosamente',
      remitoId: colppyResult.remitoId,
      remitoNumber: colppyResult.remitoNumber,
      facturaId: colppyResult.facturaId,
      facturaNumber: emisionArca?.numeroFormateado || colppyResult.facturaNumber,
      emisor,
      invoiceId: invoiceIdCreado,
      cae: emisionArca?.cae,
      caeVencimiento: emisionArca?.caeVencimiento?.toISOString(),
      colppyPendiente,
      pdfUrl: invoiceIdCreado && emisionArca ? `/api/facturas/${invoiceIdCreado}/pdf` : undefined,
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
