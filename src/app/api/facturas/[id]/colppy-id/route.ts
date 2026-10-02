/**
 * PATCH /api/facturas/[id]/colppy-id — vincula a mano el id de Colppy de una
 * factura que se carga a mano en Colppy (colppySyncStatus 'MANUAL': la Factura
 * E de exportación en la v1) y, si el cliente todavía no lo tiene, el id de
 * Colppy del cliente.
 *   body: { colppyId: string, colppyClienteId?: string }
 *
 * Antes de vincular lee la factura en Colppy (leer_facturaventa) y exige que
 * sea la misma: letra E, mismo PV-número, no anulada, mismo cliente y (si
 * está en USD) mismo total. Un id mal pegado no se puede corregir después.
 * Si no se manda el id del cliente, se toma el de la factura en Colppy.
 *
 * Pasa colppySyncStatus de MANUAL a OK, actualiza la CotizacionFactura y
 * re-sincroniza el stock de los SKUs facturados (Colppy movió el stock al
 * cargarla). Hay que hacerlo antes del sync de las 9:00 para que no la tome
 * como una factura nueva.
 */
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { syncStockForSkusFireAndForget } from '@/lib/colppy-inventory'
import { notaCargadaEnColppy } from '@/lib/facturacion/colppy-manual'
import { colppyLeerFacturaVenta, getCachedColppySession } from '@/lib/colppy'
import { verificarFacturaColppyManual } from '@/lib/facturacion/verificar-colppy-manual'

/** Los ids internos de Colppy son numéricos */
const ID_COLPPY = /^\d{1,20}$/

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const role = (session.user as { role?: string }).role
  if (role && !['ADMIN', 'GERENTE', 'CONTADOR'].includes(role)) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  }
  const { id } = await params

  let body: { colppyId?: unknown; colppyClienteId?: unknown } = {}
  try {
    const parsed = await request.json()
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed
  } catch {
    /* sin body */
  }
  const colppyId = typeof body.colppyId === 'string' || typeof body.colppyId === 'number' ? String(body.colppyId).trim() : ''
  const colppyClienteId =
    typeof body.colppyClienteId === 'string' || typeof body.colppyClienteId === 'number' ? String(body.colppyClienteId).trim() : ''
  if (!ID_COLPPY.test(colppyId)) {
    return NextResponse.json({ error: 'Pegá el id de la factura en Colppy (solo números)' }, { status: 400 })
  }
  if (colppyClienteId && !ID_COLPPY.test(colppyClienteId)) {
    return NextResponse.json({ error: 'El id del cliente en Colppy tiene que ser numérico' }, { status: 400 })
  }

  try {
    const inv = await prisma.invoice.findUnique({
      where: { id },
      select: {
        id: true,
        invoiceNumber: true,
        colppyId: true,
        colppySyncStatus: true,
        notes: true,
        pointOfSale: true,
        cbteNumero: true,
        total: true,
        currency: true,
        customer: { select: { id: true, name: true, colppyId: true } },
        quote: { select: { id: true, quoteNumber: true } },
        items: { select: { sku: true, product: { select: { sku: true } } } },
      },
    })
    if (!inv) return NextResponse.json({ error: 'Factura no encontrada' }, { status: 404 })
    if (inv.colppySyncStatus !== 'MANUAL') {
      return NextResponse.json({ error: 'La factura no está pendiente de carga manual en Colppy' }, { status: 409 })
    }
    if (inv.colppyId) {
      return NextResponse.json({ error: `La factura ya está vinculada a Colppy (${inv.colppyId})` }, { status: 409 })
    }
    const otra = await prisma.invoice.findFirst({ where: { colppyId, id: { not: id } }, select: { invoiceNumber: true } })
    if (otra) {
      return NextResponse.json({ error: `El id de Colppy ${colppyId} ya está vinculado a la factura ${otra.invoiceNumber}` }, { status: 409 })
    }

    // La factura tiene que existir en Colppy y ser ESTA (letra, número, cliente, total)
    let info: Record<string, unknown> | null
    try {
      info = await colppyLeerFacturaVenta(await getCachedColppySession(), colppyId)
    } catch (e) {
      logger.warn('[Facturas] No se pudo leer la factura en Colppy para vincularla', { id, colppyId, error: (e as Error).message })
      return NextResponse.json({ error: 'No se pudo consultar Colppy para verificar el id: probá de nuevo en un rato' }, { status: 502 })
    }
    const v = verificarFacturaColppyManual(info, {
      colppyId,
      pointOfSale: inv.pointOfSale,
      cbteNumero: inv.cbteNumero,
      total: Number(inv.total),
      currency: inv.currency,
      colppyClienteId: colppyClienteId || inv.customer.colppyId,
    })
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 409 })
    const clienteColppy = colppyClienteId || v.idCliente || ''

    // Cliente: solo si todavía no tiene id de Colppy (nunca se pisa uno existente)
    let actualizarCliente = false
    if (clienteColppy) {
      if (inv.customer.colppyId && inv.customer.colppyId !== clienteColppy) {
        return NextResponse.json(
          { error: `El cliente ya tiene id de Colppy ${inv.customer.colppyId}; no se cambia desde acá` },
          { status: 409 }
        )
      }
      if (!inv.customer.colppyId) {
        const otroCliente = await prisma.customer.findFirst({
          where: { colppyId: clienteColppy, id: { not: inv.customer.id } },
          select: { name: true },
        })
        if (otroCliente) {
          return NextResponse.json(
            { error: `El id de Colppy ${clienteColppy} ya es del cliente ${otroCliente.name}` },
            { status: 409 }
          )
        }
        actualizarCliente = true
      }
    }

    const vinculada = await prisma.$transaction(async (tx) => {
      // Condicional: si otro pedido la vinculó en el medio, no se pisa
      const r = await tx.invoice.updateMany({
        where: { id, colppySyncStatus: 'MANUAL', colppyId: null },
        data: {
          colppyId,
          colppySyncStatus: 'OK',
          colppySyncError: null,
          notes: notaCargadaEnColppy(inv.notes, colppyId),
        },
      })
      if (r.count !== 1) return false
      await tx.cotizacionFactura.updateMany({ where: { invoiceId: id }, data: { colppyInvoiceId: colppyId } })
      if (actualizarCliente) {
        await tx.customer.update({ where: { id: inv.customer.id }, data: { colppyId: clienteColppy } })
      }
      return true
    })
    if (!vinculada) {
      return NextResponse.json({ error: 'La factura cambió mientras se vinculaba: recargá la página' }, { status: 409 })
    }

    logAudit({
      userId: session.user.id,
      userName: session.user.name || '',
      userEmail: session.user.email || '',
      action: 'UPDATE',
      entity: 'INVOICE',
      entityId: id,
      entityRef: inv.invoiceNumber,
      description:
        `Vinculó a mano la factura ${inv.invoiceNumber} con Colppy (id ${colppyId})` +
        (actualizarCliente ? ` y el cliente ${inv.customer.name} (id Colppy ${clienteColppy})` : ''),
    })

    // Colppy movió el stock al cargar la factura: refrescar los SKUs facturados
    const skus = inv.items.flatMap((it) => [it.sku, it.product?.sku]).filter((s): s is string => !!s)
    syncStockForSkusFireAndForget(skus, {
      quoteId: inv.quote?.id,
      quoteNumber: inv.quote?.quoteNumber ?? inv.invoiceNumber,
      action: 'colppy-id-manual',
    })

    return NextResponse.json({ success: true, colppyId, colppyClienteId: actualizarCliente ? clienteColppy : null })
  } catch (e) {
    logger.error('[Facturas] Error vinculando el id de Colppy:', e)
    return NextResponse.json({ error: (e as Error).message || 'Error al vincular con Colppy' }, { status: 500 })
  }
}
