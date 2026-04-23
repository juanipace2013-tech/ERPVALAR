import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import {
  colppyLogin,
  colppyLogout,
  colppyFindSupplierByCUIT,
  colppyCreatePurchaseInvoice,
  getColppyItemId,
  ColppySession,
  ColppySessionExpiredError,
} from '@/lib/colppy'
import { resolveJurisdiccionIIBB } from '@/lib/jurisdicciones-iibb'
import { reviewReasonLabel } from '@/lib/review-reasons'

// Valores válidos de condición de pago en Colppy
const COLPPY_PAYMENT_TERMS = [
  'Contado', 'a 7 Dias', 'a 15 Dias', 'a 30 Dias', 'a 45 Dias',
  'a 60 Dias', 'a 90 Dias', 'a 120 Dias', 'a 150 Dias', 'a 180 Dias',
] as const

const VALID_DAYS = [7, 15, 30, 45, 60, 90, 120, 150, 180]

/**
 * Normaliza cualquier texto de condición de pago al formato exacto de Colppy.
 * Ej: "CUENTA CORRIENTE 30 DIAS" → "a 30 Dias"
 *     "a 30 Dias" → "a 30 Dias" (ya normalizado)
 *     "Contado" → "Contado"
 */
function normalizePaymentTermForColppy(raw: string): string {
  if (!raw) return 'Contado'

  // Si ya es un valor exacto de Colppy, devolverlo
  if ((COLPPY_PAYMENT_TERMS as readonly string[]).includes(raw)) return raw

  const lower = raw.toLowerCase()

  // Buscar número de días PRIMERO (prioridad sobre "contado"/"efectivo")
  // porque textos como "30 DIAS FF ... EFECTIVO PAGO" deben ser "a 30 Dias"
  const match = lower.match(/(\d+)\s*d[ií]as?/)
  if (match) {
    const dias = parseInt(match[1])
    // Buscar el valor válido más cercano
    const closest = VALID_DAYS.reduce((prev, curr) =>
      Math.abs(curr - dias) < Math.abs(prev - dias) ? curr : prev
    )
    return `a ${closest} Dias`
  }

  // Si tiene solo un número (ej: "30", "60")
  const numMatch = lower.match(/\b(\d+)\b/)
  if (numMatch) {
    const dias = parseInt(numMatch[1])
    if (dias >= 7 && dias <= 180) {
      const closest = VALID_DAYS.reduce((prev, curr) =>
        Math.abs(curr - dias) < Math.abs(prev - dias) ? curr : prev
      )
      return `a ${closest} Dias`
    }
  }

  // Contado / efectivo (solo si no se detectaron días arriba)
  if (lower.includes('contado') || lower.includes('efectivo')) return 'Contado'

  return 'a 30 Dias' // Default razonable para cuenta corriente
}

/**
 * POST /api/purchase-invoices/[id]/send-to-colppy
 *
 * Envía una factura de compra a Colppy.
 *
 * Proceso:
 * 1. Obtiene la factura del ERP con todos sus datos
 * 2. Busca el proveedor en Colppy por CUIT
 * 3. Arma el payload según la API de Colppy (FacturaCompra/alta_facturacompra)
 * 4. Envía a Colppy
 * 5. Guarda el colppyInvoiceId en la factura del ERP
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { id } = await params

    // 1. Obtener la factura del ERP con todos sus datos
    const invoice = await prisma.purchaseInvoice.findUnique({
      where: { id },
      include: {
        supplier: true,
        items: {
          include: { product: true },
        },
        taxes: true,
        perceptions: true,
      },
    })

    if (!invoice) {
      return NextResponse.json({ error: 'Factura no encontrada' }, { status: 404 })
    }

    // === DEBUG: Datos completos de la factura ===
    logger.info('=== INVOICE DATA ===')
    logger.info('id:', invoice.id)
    logger.info('invoiceNumber:', invoice.invoiceNumber)
    logger.info('netAmount:', String(invoice.netAmount))
    logger.info('taxAmount:', String(invoice.taxAmount))
    logger.info('notTaxedAmount:', String(invoice.notTaxedAmount))
    logger.info('exemptAmount:', String(invoice.exemptAmount))
    logger.info('perceptionsAmount:', String(invoice.perceptionsAmount))
    logger.info('total:', String(invoice.total))
    logger.info('taxes:', JSON.stringify(invoice.taxes, null, 2))
    logger.info('perceptions:', JSON.stringify(invoice.perceptions, null, 2))
    logger.info('items count:', invoice.items.length)
    logger.info('items:', JSON.stringify(invoice.items.map(i => ({
      desc: i.description?.substring(0, 40),
      qty: String(i.quantity),
      unitPrice: String(i.unitPrice),
      taxRate: String(i.taxRate),
      subtotal: String(i.subtotal),
    })), null, 2))
    logger.info('=== FIN INVOICE DATA ===')

    // Verificar que no fue ya enviada
    if (invoice.colppyInvoiceId) {
      return NextResponse.json(
        { error: `Esta factura ya fue enviada a Colppy (ID: ${invoice.colppyInvoiceId})` },
        { status: 400 }
      )
    }

    // Bloquear si la factura está marcada para revisión manual.
    // Motivo típico: OCR no pudo determinar una jurisdicción IIBB. Colppy
    // rechazaría un payload con jurisdicción inválida y daría un error poco
    // claro — mejor fallar temprano con un mensaje que apunte al operador a
    // abrir la factura y corregir.
    if (invoice.requiresReview) {
      const reasonLabel = reviewReasonLabel(invoice.reviewReason) || 'Revisar factura'
      return NextResponse.json(
        {
          error:
            `La factura ${invoice.invoiceNumber} requiere revisión manual antes de ` +
            `enviarse a Colppy. Motivo: ${reasonLabel}. ` +
            `Abrila, corregí el dato marcado y destildá el flag de revisión antes de reintentar.`,
          reviewReason: invoice.reviewReason,
        },
        { status: 409 }
      )
    }

    // Verificar que el proveedor tiene CUIT
    if (!invoice.supplier.taxId) {
      return NextResponse.json(
        { error: 'El proveedor no tiene CUIT cargado. Es necesario para buscar en Colppy.' },
        { status: 400 }
      )
    }

    // 2. Conectar a Colppy
    let colppySession: ColppySession | null = null

    async function withRetry<T>(fn: (s: ColppySession) => Promise<T>): Promise<T> {
      try {
        return await fn(colppySession!)
      } catch (error: any) {
        if (error instanceof ColppySessionExpiredError) {
          logger.info('[Colppy] Sesión expirada, re-autenticando...')
          colppySession = await colppyLogin()
          return await fn(colppySession)
        }
        throw error
      }
    }

    try {
      colppySession = await colppyLogin()

      // 3. Buscar proveedor en Colppy por CUIT
      const supplier = await withRetry((s) =>
        colppyFindSupplierByCUIT(s, invoice.supplier.taxId!)
      )

      if (!supplier) {
        return NextResponse.json(
          {
            error: `No se encontró el proveedor con CUIT ${invoice.supplier.taxId} en Colppy. ` +
              `Debe darse de alta primero en Colppy.`,
          },
          { status: 400 }
        )
      }

      logger.info(`[Colppy] Proveedor encontrado: ${supplier.razonSocial} (ID: ${supplier.idProveedor})`)

      // 4. Armar el payload de Colppy

      // Formatear fechas a DD-MM-YYYY (usar UTC para evitar shift de timezone)
      const fmtDate = (d: Date) => {
        const dd = String(d.getUTCDate()).padStart(2, '0')
        const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
        const yyyy = d.getUTCFullYear()
        return `${dd}-${mm}-${yyyy}`
      }

      const fechaFactura = fmtDate(invoice.invoiceDate)
      const fechaFacturaDoc = fmtDate(invoice.invoiceDate)

      // Mapear condición de pago — normalizar por seguridad (no depender del frontend)
      const rawPaymentTerms = invoice.paymentTerms || ''
      const idCondicionPago = normalizePaymentTermForColppy(rawPaymentTerms)

      // Calcular fecha de vencimiento/pago
      // Prioridad 1: dueDate de la factura si existe y es distinta a invoiceDate
      // Prioridad 2: calcular desde condición de pago del proveedor
      let fechaPagoDate: Date
      if (invoice.dueDate && invoice.dueDate.getTime() !== invoice.invoiceDate.getTime()) {
        fechaPagoDate = invoice.dueDate
      } else {
        const paymentTermsSource = rawPaymentTerms || invoice.supplier.paymentTerms || ''
        const match = paymentTermsSource.match(/(\d+)\s*[Dd][ií]as?/)
        const dias = match ? parseInt(match[1]) : 0
        fechaPagoDate = new Date(invoice.invoiceDate)
        fechaPagoDate.setDate(fechaPagoDate.getDate() + dias)
        logger.info(`[Colppy FC] fechaPago calculada: invoiceDate + ${dias} días (terms: "${paymentTermsSource}")`)
      }
      const fechaPago = fmtDate(fechaPagoDate)
      logger.info(`[Colppy FC] paymentTerms DB: "${rawPaymentTerms}" → normalizado: "${idCondicionPago}"`)

      // Tipo de comprobante: FA=1 (Factura), NC=3 (Nota Crédito), ND=2 (Nota Débito)
      const tipoComprobanteMap: Record<string, string> = {
        FA: '1',
        NC: '3',
        ND: '2',
      }
      const idTipoComprobante = tipoComprobanteMap[invoice.invoiceType] || '1'

      // ===================================================================
      // ESTRATEGIA: Usar valores EXACTOS de la DB para los totales de
      // cabecera. NO recalcular desde items para evitar diferencias de
      // redondeo que causan "El total de débitos y créditos no es igual".
      // Los items se envían con precio neto y porcDesc=0.
      // ===================================================================

      // Limpiar código proveedor: solo strip prefijo "001" de GENEBRE
      const cleanSupplierCode = (code: string) => {
        const trimmed = (code || '').trim()
        return trimmed.startsWith('001') ? trimmed.substring(3).trim() : trimmed
      }

      // Buscar idItem en inventario de Colppy por código (con caché)
      const idItemCache: Record<string, string> = {}
      const getIdItem = async (supplierCode: string): Promise<string> => {
        const colppyCode = cleanSupplierCode(supplierCode)
        if (!colppyCode) return ''
        if (idItemCache[colppyCode] !== undefined) return idItemCache[colppyCode]
        try {
          const idItem = await withRetry((s) => getColppyItemId(s, colppyCode))
          idItemCache[colppyCode] = idItem !== '0' ? idItem : ''
          logger.info(`[Colppy FC] Item "${colppyCode}" → idItem=${idItemCache[colppyCode] || '(no encontrado)'}`)
          return idItemCache[colppyCode]
        } catch (err: any) {
          logger.warn(`[Colppy FC] Error buscando item "${colppyCode}":`, err.message)
          idItemCache[colppyCode] = ''
          return ''
        }
      }

      const itemsFactura = await Promise.all(invoice.items.map(async (item) => {
        const qty = Number(item.quantity)
        const unitPrice = Number(item.unitPrice) // Precio neto (ya con descuento aplicado)
        const listPrice = Number(item.listPrice) // Precio de lista (bruto, antes de descuento)
        const discountPercent = Number(item.discountPercent) // % de descuento
        const taxRate = Number(item.taxRate)
        const colppyCode = cleanSupplierCode(item.supplierProductCode || '')
        const rawIdItem = await getIdItem(item.supplierProductCode || '')

        // Si hay descuento y precio lista, enviar precio lista + descuento
        // Colppy calcula internamente: neto = ImporteUnitario * qty * (1 - porcDesc/100)
        const hasDiscount = discountPercent > 0 && listPrice > 0 && listPrice !== unitPrice
        const importeUnitario = hasDiscount ? Math.round(listPrice * 100) / 100 : Math.round(unitPrice * 100) / 100
        const porcDesc = hasDiscount ? discountPercent : 0

        // El neto es siempre sobre el precio ya con descuento aplicado
        const roundedNetPrice = Math.round(unitPrice * 100) / 100
        const importeTotal = Math.round(roundedNetPrice * qty * 100) / 100
        const importeIva = Math.round(importeTotal * taxRate / 100 * 100) / 100

        return {
          idItem: rawIdItem || '0', // Colppy necesita '0' si no hay item vinculado, no string vacío
          tipoItem: 'P' as const, // P=Producto
          Descripcion: item.description,
          unidadMedida: item.unit || 'Un',
          Cantidad: String(qty),
          ImporteUnitario: importeUnitario.toFixed(2),
          importeTotal: importeTotal.toFixed(2),
          importeIva: importeIva.toFixed(2),
          IVA: taxRate.toFixed(2),
          idPlanCuenta: 'Mercaderias',
          codigo: colppyCode,
          porcDesc: porcDesc.toFixed(2),
          Comentario: `FC ${invoice.invoiceNumber}`,
        }
      }))

      logger.info('[Colppy FC] === ITEMS PAYLOAD ===', JSON.stringify(itemsFactura.map(i => ({
        codigo: i.codigo, Desc: i.Descripcion?.substring(0, 30), Qty: i.Cantidad,
        PUnit: i.ImporteUnitario, porcDesc: i.porcDesc, Total: i.importeTotal,
      })), null, 2))

      // ===================================================================
      // ARITMÉTICA EN CENTAVOS (enteros) para eliminar errores de punto
      // flotante. Colppy valida:
      //   totalFactura == netoGravado + netoNoGravado + totalIVA + percepcionIVA + percepcionIIBB
      // y también que el asiento contable (débitos/créditos) balancea.
      // ===================================================================
      const r2 = (n: number) => Math.round(n * 100)  // a centavos
      const c2d = (cents: number) => (cents / 100).toFixed(2) // centavos a string "X.XX"

      // Cabecera desde DB (ya son Decimal con 2 dígitos, pero convertimos a centavos por seguridad)
      const netoGravadoCents = r2(Number(invoice.netAmount))
      const netoNoGravadoCents = r2(Number(invoice.notTaxedAmount)) + r2(Number(invoice.exemptAmount))

      // IVA: La fuente de verdad es invoice.taxAmount de la cabecera.
      // Para el desglose por alícuota, intentamos:
      // 1) tabla taxes, 2) items, 3) todo como IVA21 (caso más común).
      const dbTaxAmountCents = r2(Number(invoice.taxAmount))
      let iva21Cents = 0
      let iva105Cents = 0
      let iva27Cents = 0

      // Intentar desglose desde tabla taxes
      if (invoice.taxes && invoice.taxes.length > 0) {
        for (const tax of invoice.taxes) {
          const rate = Number(tax.rate)
          const amountCents = r2(Number(tax.taxAmount))
          if (rate === 21) iva21Cents += amountCents
          else if (rate === 10.5) iva105Cents += amountCents
          else if (rate === 27) iva27Cents += amountCents
        }
        logger.info(`[Colppy FC] IVA desde taxes table: 21%=${iva21Cents} 10.5%=${iva105Cents} 27%=${iva27Cents}`)
      }

      // Si la tabla taxes dio 0 o está vacía, calcular desde items
      if (iva21Cents + iva105Cents + iva27Cents === 0 && dbTaxAmountCents > 0) {
        logger.info(`[Colppy FC] ⚠️ taxes table sin datos útiles, calculando IVA desde items (dbTaxAmount=${dbTaxAmountCents})`)
        for (const item of invoice.items) {
          const qty = Number(item.quantity)
          const unitPriceCents = r2(Number(item.unitPrice))
          const taxRate = Number(item.taxRate)
          const itemNetCents = Math.round(unitPriceCents * qty)
          const itemIvaCents = Math.round(itemNetCents * taxRate / 100)
          if (taxRate === 21) iva21Cents += itemIvaCents
          else if (taxRate === 10.5) iva105Cents += itemIvaCents
          else if (taxRate === 27) iva27Cents += itemIvaCents
        }
        logger.info(`[Colppy FC] IVA desde items: 21%=${iva21Cents} 10.5%=${iva105Cents} 27%=${iva27Cents}`)
      }

      // Última línea de defensa: si sigue en 0 pero la DB tiene IVA, usar DB como IVA21
      const totalIvaCalcCents = iva21Cents + iva105Cents + iva27Cents
      if (totalIvaCalcCents === 0 && dbTaxAmountCents > 0) {
        logger.info(`[Colppy FC] ⚠️ IVA sigue en 0, usando dbTaxAmount=${dbTaxAmountCents} como IVA21`)
        iva21Cents = dbTaxAmountCents
      } else if (Math.abs(totalIvaCalcCents - dbTaxAmountCents) > 100) {
        // Diferencia > $1: algo está muy mal, usar DB
        logger.info(`[Colppy FC] ⚠️ IVA calc=${totalIvaCalcCents} vs DB=${dbTaxAmountCents} (diff>${Math.abs(totalIvaCalcCents - dbTaxAmountCents)}), usando DB`)
        iva21Cents = dbTaxAmountCents
        iva105Cents = 0
        iva27Cents = 0
      }

      const totalIvaCents = iva21Cents + iva105Cents + iva27Cents
      logger.info(`[Colppy FC] IVA FINAL: 21%=${iva21Cents} 10.5%=${iva105Cents} 27%=${iva27Cents} total=${totalIvaCents} (dbTaxAmount=${dbTaxAmountCents})`)

      // Percepciones: el helper `resolveJurisdiccionIIBB` devuelve el nombre
      // EXACTO que espera Colppy (con tildes y mayúsculas correctas).
      let percIvaCents = 0
      let percIibbCents = 0
      const iibbByJurisdiction: Record<string, number> = {} // cents por jurisdicción

      for (const perc of invoice.perceptions) {
        const amountCents = r2(Number(perc.amount))
        if (perc.perceptionType === 'IVA' || perc.perceptionType === 'Ganancias' || perc.perceptionType === 'SUSS') {
          percIvaCents += amountCents
        } else {
          percIibbCents += amountCents
          const raw = (perc.jurisdiction || '').trim()
          const resolved = resolveJurisdiccionIIBB(raw)
          if (!resolved) {
            logger.warn(`[Colppy FC] ⚠️ Jurisdicción IIBB no mapeada: "${raw}" — se envía tal cual (Colppy probablemente la rechace)`)
          }
          const colppyName = resolved || raw || 'CABA'
          iibbByJurisdiction[colppyName] = (iibbByJurisdiction[colppyName] || 0) + amountCents
        }
      }

      // Ordenar por monto descendente para logging claro
      const iibbEntries = Object.entries(iibbByJurisdiction).sort((a, b) => b[1] - a[1])

      logger.info(`[Colppy FC] IIBB: total=${percIibbCents} | jurisdicciones=${iibbEntries.length}`)
      for (const [jur, cents] of iibbEntries) {
        logger.info(`[Colppy FC]   → ${jur}: ${cents} cents ($${c2d(cents)})`)
      }

      // Armar array percsufridas para Colppy (multi-jurisdicción)
      const percsufridas = iibbEntries.map(([jurisdiccion, cents]) => ({
        jurisdiccion,
        nroCertificado: '',
        importePerc: Number(c2d(cents)), // Número, NO string
      }))

      // totalFactura = suma exacta de las partes (en centavos, sin errores de float)
      const totalFacturaCents = netoGravadoCents + netoNoGravadoCents + totalIvaCents + percIvaCents + percIibbCents

      // === BALANCE CHECK ===
      const dbTotal = Number(invoice.total)
      logger.info(`[Colppy FC] === TOTALES (centavos) ===`)
      logger.info(`[Colppy FC] netoGravado=${netoGravadoCents} netoNoGravado=${netoNoGravadoCents} totalIVA=${totalIvaCents} (21%=${iva21Cents} 10.5%=${iva105Cents} 27%=${iva27Cents}) percIVA=${percIvaCents} percIIBB=${percIibbCents}`)
      logger.info(`[Colppy FC] totalFactura=${totalFacturaCents} (${c2d(totalFacturaCents)}) | DB total=${dbTotal} | diff=${(totalFacturaCents/100 - dbTotal).toFixed(2)}`)

      // 5. Enviar a Colppy
      const colppyParams = {
        idProveedor: supplier.idProveedor,
        descripcion: `${invoice.invoiceType === 'NC' ? 'NC' : invoice.invoiceType === 'ND' ? 'ND' : 'FC'} ${invoice.invoiceNumber}`,
        fechaFactura,
        fechaFacturaDoc,
        fechaPago,
        idTipoFactura: invoice.voucherType as 'A' | 'B' | 'C',
        idTipoComprobante,
        idCondicionPago,
        idEstadoFactura: 'Borrador',
        nroFactura1: invoice.pointOfSale,
        nroFactura2: invoice.invoiceNumberSuffix,
        netoGravado: c2d(netoGravadoCents),
        netoNoGravado: c2d(netoNoGravadoCents),
        totalIVA: c2d(totalIvaCents),
        IVA21: c2d(iva21Cents),
        IVA105: c2d(iva105Cents),
        IVA27: c2d(iva27Cents),
        percepcionIVA: c2d(percIvaCents),
        percepcionIIBB: Number(c2d(percIibbCents)), // Número, NO string
        percsufridas,
        totalFactura: c2d(totalFacturaCents),
        idMoneda: invoice.currency === 'USD' ? '2' : '1',
        valorCambio: invoice.currency === 'USD' ? String(Number(invoice.exchangeRate)) : '1',
        idRetGanancias: '78', // 78 = Enajenación de bienes muebles y bienes de cambio
        itemsFactura,
      }

      logger.info(`[Colppy FC] PARAMS:`, JSON.stringify(colppyParams, null, 2))

      const result = await withRetry((s) =>
        colppyCreatePurchaseInvoice(s, colppyParams)
      )

      // 6. Guardar el ID de Colppy en la factura del ERP
      await prisma.purchaseInvoice.update({
        where: { id },
        data: {
          colppyInvoiceId: result.idFactura,
          colppySyncedAt: new Date(),
        },
      })

      logger.info(`[Colppy] Factura de compra ${invoice.invoiceNumber} enviada como borrador. ID Colppy: ${result.idFactura}`)

      // Mensaje con info de percepciones IIBB
      let message = `Factura ${invoice.invoiceNumber} creada como BORRADOR en Colppy.`
      if (percIibbCents > 0) {
        message += ` Incluye $${c2d(percIibbCents)} en percepciones IIBB (${iibbEntries.length} jurisdicci${iibbEntries.length === 1 ? 'ón' : 'ones'}: ${iibbEntries.map(([j]) => j).join(', ')}).`
      }

      return NextResponse.json({
        success: true,
        colppyInvoiceId: result.idFactura,
        message,
        iibbIncluido: percIibbCents > 0,
        iibbTotal: c2d(percIibbCents),
        iibbJurisdicciones: iibbEntries.length,
      })
    } finally {
      if (colppySession) {
        await colppyLogout(colppySession)
      }
    }
  } catch (error: any) {
    logger.error('Error enviando factura de compra a Colppy:', error)
    return NextResponse.json(
      { error: error.message || 'Error al enviar factura a Colppy' },
      { status: 500 }
    )
  }
}
