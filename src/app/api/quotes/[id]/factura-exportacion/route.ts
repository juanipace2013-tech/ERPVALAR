/**
 * Factura E (exportación, WSFEX) desde una cotización de un cliente del exterior.
 *
 * GET  /api/quotes/[id]/factura-exportacion — prellenado del diálogo: chequeo
 *      de datos del cliente, ítems pendientes, cotización oficial DOL de ARCA
 *      (con la fecha que respondió), PV configurado y valores por defecto.
 * POST /api/quotes/[id]/factura-exportacion — emite la Factura E y la registra.
 *      body: {
 *        items: [{ quoteItemId, cantidad, precioUnitario?, descuentoPct?, descripcion? }],
 *        lineasManuales?: [{ descripcion, precioUnitario, cantidad?, codigo? }],  // flete/seguro: no comisiona
 *        desNumero, fobUSD,                       // Exporta Simple: FOB del DES == mercadería, al centavo
 *        incoterm, incotermLugar?, formaPago, obsComerciales?,
 *        cancelaEnMonedaExtranjera?,              // CanMisMonExt (default true)
 *        cotizacionEsperada?,                     // TC de ARCA que vio el usuario
 *        dryRun?                                  // true: devuelve el request exacto SIN llamar a FEXAuthorize
 *      }
 *
 * Misma sesión y roles que POST /api/facturacion/generate-invoice.
 * Diseño: docs/FACTURA-E-WSFEX-PLAN.md.
 */
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { logAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { ArcaError } from '@/lib/arca/wsfe'
import { FEX_CBTE } from '@/lib/arca/fex-params'
import { soportaPdfFactura } from '@/lib/facturacion/factura-pdf-data'
import { ExportacionBloqueadaError, ExportacionValidacionError } from '@/lib/arca/emitir-exportacion'
import {
  FacturaExportacionError,
  emitirFacturaExportacion,
  parsePedidoFacturaExportacion,
  prefillFacturaExportacion,
  vistaPreviaFacturaExportacion,
} from '@/lib/facturacion/factura-exportacion'

/** Errores lanzados ANTES de llamar a FEXAuthorize (nada se emitió) */
function respuestaError(e: unknown, contexto: string) {
  if (e instanceof ExportacionValidacionError) {
    return NextResponse.json({ error: e.errores.join('\n'), errores: e.errores }, { status: 400 })
  }
  if (e instanceof ExportacionBloqueadaError) {
    return NextResponse.json({ error: e.message, errorCode: 'FEX_BLOQUEADA' }, { status: 409 })
  }
  if (e instanceof FacturaExportacionError) {
    return NextResponse.json({ error: e.message, ...(e.detalle ?? {}) }, { status: e.status })
  }
  if (e instanceof ArcaError) {
    logger.error(`[Factura E] ${contexto}: error consultando ARCA`, { error: e.message })
    return NextResponse.json({ error: `No se pudo consultar ARCA: ${e.message}` }, { status: 502 })
  }
  // La reserva (fexId / número únicos) chocó con otra emisión simultánea: ARCA no se llamó
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    logger.warn(`[Factura E] ${contexto}: reserva duplicada (${String(e.meta?.target ?? '')})`)
    return NextResponse.json(
      { error: 'Otra emisión de Factura E reservó el mismo Id o número al mismo tiempo. No se llamó a ARCA: reintentá en unos segundos' },
      { status: 409 }
    )
  }
  logger.error(`[Factura E] ${contexto}:`, e)
  return NextResponse.json({ error: (e as Error)?.message || 'Error en la Factura E' }, { status: 500 })
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const { id } = await params
  try {
    return NextResponse.json(await prefillFacturaExportacion(id))
  } catch (e) {
    return respuestaError(e, 'prellenado')
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Pedido inválido (JSON)' }, { status: 400 })
  }
  // Falla cerrado: emitir (irreversible) exige `dryRun: false` explícito en el
  // body; cualquier otra cosa ("true", 1, ausente, ?dryRun= en la URL) es 400
  const dryRunRaw = !!body && typeof body === 'object' ? (body as { dryRun?: unknown }).dryRun : undefined
  if (typeof dryRunRaw !== 'boolean' || new URL(request.url).searchParams.has('dryRun')) {
    return NextResponse.json(
      { error: 'Falta "dryRun" (true = vista previa, false = emitir) como booleano en el cuerpo del pedido' },
      { status: 400 }
    )
  }
  const dryRun = dryRunRaw
  const { pedido, errores } = parsePedidoFacturaExportacion(body)
  if (!pedido) return NextResponse.json({ error: errores.join('\n'), errores }, { status: 400 })

  // Vista previa: el Cmp/XML exacto (Token y Sign ocultos). Solo lecturas en ARCA.
  if (dryRun) {
    try {
      return NextResponse.json(await vistaPreviaFacturaExportacion(id, pedido))
    } catch (e) {
      return respuestaError(e, 'vista previa')
    }
  }

  let r: Awaited<ReturnType<typeof emitirFacturaExportacion>>
  try {
    r = await emitirFacturaExportacion(id, pedido, { userId: session.user.id })
  } catch (e) {
    return respuestaError(e, 'emisión')
  }

  const usuario = { userId: session.user.id, userName: session.user.name || '', userEmail: session.user.email || '' }

  if (!r.ok) {
    logAudit({
      ...usuario,
      action: r.estado === 'INCIERTA' ? 'FEX_INCIERTA' : 'FEX_RECHAZADA',
      entity: 'QUOTE',
      entityId: id,
      entityRef: r.quoteNumber,
      description: `Factura E ${r.numeroFormateado} (Id ${r.fexId}) ${r.estado} en ARCA: ${r.mensaje}`.slice(0, 2000),
    })
    if (r.estado === 'INCIERTA') {
      return NextResponse.json(
        {
          errorCode: 'FEX_INCIERTA',
          error:
            `ARCA no confirmó la Factura E ${r.numeroFormateado} (Id ${r.fexId}). NO REINTENTES: el resultado se ` +
            `reconcilia reenviando el mismo Id (scripts/arca-fex-reconciliar.ts). ${r.mensaje}`,
          fexId: r.fexId,
          estado: r.estado,
        },
        { status: 502 }
      )
    }
    return NextResponse.json(
      { error: `ARCA rechazó la Factura E: ${r.mensaje}`, errores: r.errores, estado: r.estado, fexId: r.fexId, errorStage: 'arca' },
      { status: 422 }
    )
  }

  logAudit({
    ...usuario,
    action: r.huerfana ? 'FEX_ORPHAN' : 'CREATE',
    entity: r.huerfana ? 'QUOTE' : 'INVOICE',
    entityId: r.invoiceId ?? id,
    entityRef: r.numeroInterno,
    description:
      `Factura E ${r.numeroInterno} (CAE ${r.cae}, Id ${r.fexId}) desde cotización ${r.quoteNumber}: ` +
      `total USD ${r.totales.totalUSD} (mercadería ${r.totales.mercaderiaUSD}, flete/seguro ${r.totales.manualUSD}), ` +
      `TC ARCA ${r.cotizacion.cotizacion} del ${r.cotizacion.fechaCotizacion}` +
      (r.huerfana ? '. ATENCIÓN: el ERP no pudo registrar la Invoice (huérfana)' : ''),
  })

  if (r.huerfana) {
    // Como COLPPY_ORPHAN: el cliente muestra un aviso bloqueante y NO se reintenta
    return NextResponse.json(
      { errorCode: 'FEX_ORPHAN', message: r.mensaje, error: r.mensaje, numero: r.numeroInterno, cae: r.cae, fexId: r.fexId },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    message: r.mensaje,
    invoiceId: r.invoiceId,
    numero: r.numeroInterno,
    numeroFormateado: r.numeroFormateado,
    cae: r.cae,
    caeVencimiento: r.caeVencimiento.toISOString(),
    fexId: r.fexId,
    totales: r.totales,
    cotizacion: r.cotizacion,
    reproceso: r.reproceso,
    recuperado: r.recuperado,
    observaciones: r.observaciones,
    colppyManual: true,
    // PDF letra E (factura-pdf-data.ts); el diálogo igual lleva a la factura
    pdfUrl: soportaPdfFactura(FEX_CBTE.FACTURA_E) ? `/api/facturas/${r.invoiceId}/pdf` : null,
    facturaUrl: `/facturas/${r.invoiceId}`,
  })
}
