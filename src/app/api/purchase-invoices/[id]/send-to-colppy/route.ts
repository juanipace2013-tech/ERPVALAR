import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  colppyLogin,
  colppyLogout,
  colppyFindSupplierByCUIT,
  colppyCreatePurchaseInvoice,
  ColppySession,
  ColppySessionExpiredError,
} from '@/lib/colppy'

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

  // Contado
  if (lower.includes('contado') || lower.includes('efectivo')) return 'Contado'

  // Buscar número de días en el texto
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

    // Parámetros de diagnóstico (query string)
    const url = new URL(request.url)
    const skipIIBB = url.searchParams.get('skipIIBB') === 'true'
    const isoDate = url.searchParams.get('isoDate') === 'true'
    if (skipIIBB) console.log('[Colppy FC] ⚠️ MODO DIAGNÓSTICO: skipIIBB=true, percepciones IIBB en 0')
    if (isoDate) console.log('[Colppy FC] ⚠️ MODO DIAGNÓSTICO: isoDate=true, fechas en YYYY-MM-DD')

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
    console.log('=== INVOICE DATA ===')
    console.log('id:', invoice.id)
    console.log('invoiceNumber:', invoice.invoiceNumber)
    console.log('netAmount:', String(invoice.netAmount))
    console.log('taxAmount:', String(invoice.taxAmount))
    console.log('notTaxedAmount:', String(invoice.notTaxedAmount))
    console.log('exemptAmount:', String(invoice.exemptAmount))
    console.log('perceptionsAmount:', String(invoice.perceptionsAmount))
    console.log('total:', String(invoice.total))
    console.log('taxes:', JSON.stringify(invoice.taxes, null, 2))
    console.log('perceptions:', JSON.stringify(invoice.perceptions, null, 2))
    console.log('items count:', invoice.items.length)
    console.log('items:', JSON.stringify(invoice.items.map(i => ({
      desc: i.description?.substring(0, 40),
      qty: String(i.quantity),
      unitPrice: String(i.unitPrice),
      taxRate: String(i.taxRate),
      subtotal: String(i.subtotal),
    })), null, 2))
    console.log('=== FIN INVOICE DATA ===')

    // Verificar que no fue ya enviada
    if (invoice.colppyInvoiceId) {
      return NextResponse.json(
        { error: `Esta factura ya fue enviada a Colppy (ID: ${invoice.colppyInvoiceId})` },
        { status: 400 }
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
          console.log('[Colppy] Sesión expirada, re-autenticando...')
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

      console.log(`[Colppy] Proveedor encontrado: ${supplier.razonSocial} (ID: ${supplier.idProveedor})`)

      // 4. Armar el payload de Colppy

      // Formatear fechas a DD-MM-YYYY
      const fmtDate = (d: Date) => {
        const dd = String(d.getDate()).padStart(2, '0')
        const mm = String(d.getMonth() + 1).padStart(2, '0')
        const yyyy = d.getFullYear()
        return isoDate ? `${yyyy}-${mm}-${dd}` : `${dd}-${mm}-${yyyy}`
      }

      const fechaFactura = fmtDate(invoice.invoiceDate)
      const fechaFacturaDoc = fmtDate(invoice.invoiceDate)
      const fechaPago = fmtDate(invoice.dueDate)

      // Mapear condición de pago — normalizar por seguridad (no depender del frontend)
      const rawPaymentTerms = invoice.paymentTerms || ''
      const idCondicionPago = normalizePaymentTermForColppy(rawPaymentTerms)
      console.log(`[Colppy FC] paymentTerms DB: "${rawPaymentTerms}" → normalizado: "${idCondicionPago}"`)

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

      const itemsFactura = invoice.items.map((item) => {
        const qty = Number(item.quantity)
        const unitPrice = Number(item.unitPrice) // Precio neto (ya con descuento aplicado)
        const taxRate = Number(item.taxRate)

        // Redondear a 2 decimales
        const roundedUnitPrice = Math.round(unitPrice * 100) / 100

        return {
          Descripcion: item.description,
          unidadMedida: item.unit || 'Un',
          Cantidad: String(qty),
          ImporteUnitario: roundedUnitPrice.toFixed(2),
          IVA: taxRate.toFixed(2),
          idPlanCuenta: 'Mercaderias',
          codigo: item.supplierProductCode || '',
          porcDesc: '0',
        }
      })

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
        console.log(`[Colppy FC] IVA desde taxes table: 21%=${iva21Cents} 10.5%=${iva105Cents} 27%=${iva27Cents}`)
      }

      // Si la tabla taxes dio 0 o está vacía, calcular desde items
      if (iva21Cents + iva105Cents + iva27Cents === 0 && dbTaxAmountCents > 0) {
        console.log(`[Colppy FC] ⚠️ taxes table sin datos útiles, calculando IVA desde items (dbTaxAmount=${dbTaxAmountCents})`)
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
        console.log(`[Colppy FC] IVA desde items: 21%=${iva21Cents} 10.5%=${iva105Cents} 27%=${iva27Cents}`)
      }

      // Última línea de defensa: si sigue en 0 pero la DB tiene IVA, usar DB como IVA21
      const totalIvaCalcCents = iva21Cents + iva105Cents + iva27Cents
      if (totalIvaCalcCents === 0 && dbTaxAmountCents > 0) {
        console.log(`[Colppy FC] ⚠️ IVA sigue en 0, usando dbTaxAmount=${dbTaxAmountCents} como IVA21`)
        iva21Cents = dbTaxAmountCents
      } else if (Math.abs(totalIvaCalcCents - dbTaxAmountCents) > 100) {
        // Diferencia > $1: algo está muy mal, usar DB
        console.log(`[Colppy FC] ⚠️ IVA calc=${totalIvaCalcCents} vs DB=${dbTaxAmountCents} (diff>${Math.abs(totalIvaCalcCents - dbTaxAmountCents)}), usando DB`)
        iva21Cents = dbTaxAmountCents
        iva105Cents = 0
        iva27Cents = 0
      }

      const totalIvaCents = iva21Cents + iva105Cents + iva27Cents
      console.log(`[Colppy FC] IVA FINAL: 21%=${iva21Cents} 10.5%=${iva105Cents} 27%=${iva27Cents} total=${totalIvaCents} (dbTaxAmount=${dbTaxAmountCents})`)

      // Percepciones
      let percIvaCents = 0
      let percIibbCents = 0

      if (!skipIIBB) {
        for (const perc of invoice.perceptions) {
          const amountCents = r2(Number(perc.amount))
          if (perc.perceptionType === 'IVA' || perc.perceptionType === 'Ganancias') {
            percIvaCents += amountCents
          } else {
            percIibbCents += amountCents
          }
        }
      } else {
        console.log(`[Colppy FC] skipIIBB: Percepciones IIBB forzadas a 0 (${invoice.perceptions.length} percepciones ignoradas)`)
      }

      // totalFactura = suma exacta de las partes (en centavos, sin errores de float)
      const totalFacturaCents = netoGravadoCents + netoNoGravadoCents + totalIvaCents + percIvaCents + percIibbCents

      // === BALANCE CHECK ===
      const dbTotal = Number(invoice.total)
      console.log(`[Colppy FC] === TOTALES (centavos) ===`)
      console.log(`[Colppy FC] netoGravado=${netoGravadoCents} netoNoGravado=${netoNoGravadoCents} totalIVA=${totalIvaCents} (21%=${iva21Cents} 10.5%=${iva105Cents} 27%=${iva27Cents}) percIVA=${percIvaCents} percIIBB=${percIibbCents}`)
      console.log(`[Colppy FC] totalFactura=${totalFacturaCents} (${c2d(totalFacturaCents)}) | DB total=${dbTotal} | diff=${(totalFacturaCents/100 - dbTotal).toFixed(2)}`)

      // 5. Enviar a Colppy
      const colppyParams = {
        idProveedor: supplier.idProveedor,
        descripcion: `FC ${invoice.invoiceNumber}`,
        fechaFactura,
        fechaFacturaDoc,
        fechaPago,
        idTipoFactura: invoice.voucherType as 'A' | 'B' | 'C',
        idTipoComprobante,
        idCondicionPago,
        idEstadoFactura: 'Aprobada',
        nroFactura1: invoice.pointOfSale,
        nroFactura2: invoice.invoiceNumberSuffix,
        netoGravado: c2d(netoGravadoCents),
        netoNoGravado: c2d(netoNoGravadoCents),
        totalIVA: c2d(totalIvaCents),
        IVA21: c2d(iva21Cents),
        IVA105: c2d(iva105Cents),
        IVA27: c2d(iva27Cents),
        percepcionIVA: c2d(percIvaCents),
        percepcionIIBB: c2d(percIibbCents),
        totalFactura: c2d(totalFacturaCents),
        idMoneda: invoice.currency === 'USD' ? '2' : '1',
        valorCambio: invoice.currency === 'USD' ? String(Number(invoice.exchangeRate)) : '1',
        itemsFactura,
      }

      console.log(`[Colppy FC] PARAMS:`, JSON.stringify(colppyParams, null, 2))

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

      console.log(`[Colppy] Factura de compra ${invoice.invoiceNumber} enviada exitosamente. ID Colppy: ${result.idFactura}`)

      return NextResponse.json({
        success: true,
        colppyInvoiceId: result.idFactura,
        message: `Factura ${invoice.invoiceNumber} enviada a Colppy exitosamente`,
      })
    } finally {
      if (colppySession) {
        await colppyLogout(colppySession)
      }
    }
  } catch (error: any) {
    console.error('Error enviando factura de compra a Colppy:', error)
    return NextResponse.json(
      { error: error.message || 'Error al enviar factura a Colppy' },
      { status: 500 }
    )
  }
}
