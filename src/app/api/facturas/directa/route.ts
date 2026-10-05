/**
 * POST /api/facturas/directa — emite una factura directa ("Nueva factura",
 * sin cotización): Factura A, B o FCE A en ARCA (PV 7), la registra en el ERP,
 * archiva el PDF, lo sube a la venta de ML (si se vinculó) y la registra en
 * Colppy (FACTURACION_REGISTRAR_COLPPY). Ver src/lib/facturacion/factura-directa.ts.
 *
 * Roles: ADMIN, GERENTE, CONTADOR (ROLES.FINANZAS).
 *
 * Body: { idempotencyKey (UUID), customerId, moneda: 'ARS'|'USD', tipoCambio?,
 *         condicionPago, preciosConIva, documentoReceptorB?: { docTipo: 96|86, docNro },
 *         lineas: [{ productId?, descripcion, cantidad, precioUnitario, comentario? }],
 *         observaciones?, mlVenta?, confirmaciones?: string[] }
 *   confirmaciones = las FIRMAS (confirmacionesRequeridas[].firma de la vista
 *   previa o del 409) que el usuario tildó: un código suelto no confirma, y si
 *   el motivo cambió desde la vista previa se vuelve a pedir (409).
 *
 * 201 { invoiceId, invoiceNumber, cae, caeVencimiento, total, currency, pdfUrl,
 *       colppy: { estado, error? }, ml: { packId, uploadOk, error? } | null, repetida: false }
 * 200 lo mismo con repetida: true (la clave ya había emitido: no se emite de nuevo)
 * 400 body mal formado · 401/403 sesión/rol · 404 cliente, producto o venta de ML
 * 409 CONFIRMACION_REQUERIDA (confirmacionesRequeridas con firma, faltantes = códigos) · EMISION_PENDIENTE ·
 *     EN_CURSO · YA_FACTURADA · ARCA_INCIERTO · ERP_HUERFANA (clave ya usada)
 * 422 validaciones (errores[]) · ARCA_RECHAZO (errores[] de ARCA)
 * 502 ARCA_INCIERTO (NO reintentar) · ARCA_NO_SOLICITADA (se puede reintentar con la misma clave)
 * 503 EMISOR_NO_ARCA · ARCA_NO_CONFIGURADO · FUERA_DE_HORARIO
 * 500 ERP_HUERFANA (emitida en ARCA, sin registrar en el ERP: NO reintentar)
 * Errores: { error, codigo, ...extra }.
 */
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole, ROLES } from '@/lib/authz'
import { logger } from '@/lib/logger'
import { logAudit } from '@/lib/audit'
import { validarPedidoFacturaDirecta } from '@/lib/facturacion/factura-directa-form'
import { FacturaDirectaError, emitirFacturaDirecta } from '@/lib/facturacion/factura-directa'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const forbidden = requireRole(session, ROLES.FINANZAS, 'Sin permisos para emitir facturas directas')
  if (forbidden) return forbidden

  const body = await req.json().catch(() => null)
  const { pedido, errores } = validarPedidoFacturaDirecta(body, { requiereClave: true })
  if (!pedido) {
    return NextResponse.json({ error: errores.join(' · ') || 'Pedido inválido', codigo: 'PEDIDO_INVALIDO', errores }, { status: 400 })
  }

  try {
    const r = await emitirFacturaDirecta(pedido, { id: session.user.id })
    if (!r.repetida) {
      logAudit({
        userId: session.user.id,
        userName: session.user.name || '',
        userEmail: session.user.email || '',
        action: 'CREATE',
        entity: 'INVOICE',
        entityId: r.invoiceId,
        entityRef: r.invoiceNumber,
        description: `Factura directa ${r.invoiceNumber} CAE ${r.cae} (${r.currency} ${r.total})${r.ml ? ` - Venta Mercado Libre #${r.ml.packId}` : ''}`,
      })
    }
    return NextResponse.json(r, { status: r.repetida ? 200 : 201 })
  } catch (e) {
    if (e instanceof FacturaDirectaError) {
      return NextResponse.json({ error: e.message, codigo: e.codigo, ...e.extra }, { status: e.status })
    }
    logger.error('[Factura directa] Error emitiendo', { customerId: pedido.customerId, error: (e as Error).message, stack: (e as Error).stack })
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
