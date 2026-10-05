/**
 * GET /api/facturas/[id] — detalle de un comprobante de venta (Invoice) con
 * cliente, ítems, datos de emisión ARCA, estado en Colppy y NC/ND asociadas.
 * Factura E (exportación): además `exportacion` (DES, FOB, Incoterm, TC ARCA...;
 * fexId como texto porque es BigInt). Venta de Mercado Libre facturada:
 * `mlOrderInvoice` (pack y subida del PDF). Factura directa (sin cotización,
 * /facturas/nueva): `facturaDirecta` (id y condición de pago del pedido).
 */
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { soportaPdfFactura } from '@/lib/facturacion/factura-pdf-data'
import { esCbteExportacion } from '@/lib/arca/fex-params'

/** Datos de exportación que muestra la ficha (sin el request/response crudos de ARCA) */
const SELECT_EXPORTACION = {
  fexId: true,
  estado: true,
  regimen: true,
  tipoExpo: true,
  desNumero: true,
  fobUSD: true,
  permisoExistente: true,
  dstCmp: true,
  cuitPais: true,
  idImpositivo: true,
  domicilio: true,
  incoterm: true,
  incotermDs: true,
  formaPago: true,
  idioma: true,
  monedaCtz: true,
  canMisMonExt: true,
  obsComerciales: true,
  totalUSD: true,
  mercaderiaUSD: true,
  manualUSD: true,
  reproceso: true,
  recuperado: true,
  fechaCbte: true,
} as const

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    const { id } = await params

    const inv = await prisma.invoice.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            businessName: true,
            cuit: true,
            email: true,
            phone: true,
            address: true,
            city: true,
            taxCondition: true,
            country: true,
            taxIdExterior: true,
            colppyId: true,
          },
        },
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
        quote: { select: { id: true, quoteNumber: true, status: true } },
        relatedInvoice: { select: { id: true, invoiceNumber: true, invoiceType: true, total: true, cae: true } },
        relatedInvoices: {
          select: { id: true, invoiceNumber: true, transactionType: true, invoiceType: true, total: true, cae: true, issueDate: true, status: true, colppySyncStatus: true },
          orderBy: { issueDate: 'asc' },
        },
        user: { select: { id: true, name: true } },
        mlOrderInvoice: { select: { packId: true, status: true, mlUploadStatus: true, mlUploadError: true, updatedAt: true } },
      },
    })
    if (!inv) return NextResponse.json({ error: 'Factura no encontrada' }, { status: 404 })

    // Factura E emitida por el ERP (WSFEX): sus datos se leen aparte y solo para
    // ella, así el resto de las facturas no depende de la tabla facturas_exportacion
    const exportacion =
      inv.emitidaPor === 'ARCA' && esCbteExportacion(inv.cbteTipo)
        ? await prisma.facturaExportacion.findUnique({ where: { invoiceId: inv.id }, select: SELECT_EXPORTACION })
        : null

    // Factura directa (sin cotización): también se lee aparte, solo para las
    // facturas de venta del ERP sin cotización; si falla, la ficha se muestra igual
    const directa =
      inv.emitidaPor === 'ARCA' && inv.transactionType === 'SALE' && !inv.quoteId
        ? await prisma.facturaDirecta
            .findUnique({ where: { invoiceId: inv.id }, select: { id: true, mlPackId: true, createdAt: true, pedido: true } })
            .catch((e) => {
              logger.warn(`[Facturas] No se pudo leer la factura directa de ${inv.id}: ${(e as Error).message}`)
              return null
            })
        : null
    const pedidoDirecta = (directa?.pedido ?? null) as { condicionPago?: unknown } | null

    // No exponer el payload completo de Colppy (ruido); sí si está pendiente para diagnóstico
    const { colppyPayload, ...rest } = inv
    return NextResponse.json({
      ...rest,
      exportacion: exportacion ? { ...exportacion, fexId: exportacion.fexId.toString() } : null,
      facturaDirecta: directa
        ? {
            id: directa.id,
            mlPackId: directa.mlPackId,
            createdAt: directa.createdAt,
            condicionPago: typeof pedidoDirecta?.condicionPago === 'string' ? pedidoDirecta.condicionPago : null,
          }
        : null,
      tieneColppyPayload: !!colppyPayload,
      pdfUrl: inv.emitidaPor === 'ARCA' && inv.cae && soportaPdfFactura(inv.cbteTipo) ? `/api/facturas/${inv.id}/pdf` : null,
    })
  } catch (error) {
    logger.error('[Facturas] Error detalle:', error)
    return NextResponse.json({ error: 'Error al cargar factura' }, { status: 500 })
  }
}
