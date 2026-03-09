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
        return `${dd}-${mm}-${yyyy}`
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

      // Calcular IVA por alícuota
      let iva21 = 0
      let iva105 = 0
      let iva27 = 0

      // Calcular neto por item aplicando descuento general
      const generalDiscount = Number(invoice.generalDiscount) / 100

      const itemsFactura = invoice.items.map((item) => {
        const qty = Number(item.quantity)
        const listPrice = Number(item.listPrice)
        const itemDiscount = Number(item.discountPercent) / 100
        // El unitPrice ya tiene el descuento aplicado
        const unitPrice = Number(item.unitPrice)
        const taxRate = Number(item.taxRate)

        // Acumular IVA por alícuota
        const itemNet = unitPrice * qty
        const itemIva = itemNet * (taxRate / 100)

        if (taxRate === 21) iva21 += itemIva
        else if (taxRate === 10.5) iva105 += itemIva
        else if (taxRate === 27) iva27 += itemIva

        return {
          Descripcion: item.description,
          unidadMedida: item.unit || 'Un',
          Cantidad: String(qty),
          ImporteUnitario: unitPrice.toFixed(2),
          IVA: taxRate.toFixed(2),
          idPlanCuenta: 'Mercaderias',
          codigo: item.supplierProductCode || '',
          porcDesc: '0', // El descuento ya está aplicado en unitPrice
        }
      })

      // Calcular percepciones totales
      let percepcionIVA = 0
      let percepcionIIBB = 0

      for (const perc of invoice.perceptions) {
        if (perc.perceptionType === 'IVA' || perc.perceptionType === 'Ganancias') {
          percepcionIVA += Number(perc.amount)
        } else {
          // IIBB y otros
          percepcionIIBB += Number(perc.amount)
        }
      }

      const netoGravado = Number(invoice.netAmount)
      const netoNoGravado = Number(invoice.notTaxedAmount) + Number(invoice.exemptAmount)
      const totalIVA = Number(invoice.taxAmount)
      const totalFactura = Number(invoice.total)

      // 5. Enviar a Colppy
      const result = await withRetry((s) =>
        colppyCreatePurchaseInvoice(s, {
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
          netoGravado: netoGravado.toFixed(2),
          netoNoGravado: netoNoGravado.toFixed(2),
          totalIVA: totalIVA.toFixed(2),
          IVA21: iva21.toFixed(2),
          IVA105: iva105.toFixed(2),
          IVA27: iva27.toFixed(2),
          percepcionIVA: percepcionIVA.toFixed(2),
          percepcionIIBB: percepcionIIBB.toFixed(2),
          totalFactura: totalFactura.toFixed(2),
          idMoneda: invoice.currency === 'USD' ? '2' : '1',
          valorCambio: invoice.currency === 'USD' ? String(Number(invoice.exchangeRate)) : '1',
          itemsFactura,
        })
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
