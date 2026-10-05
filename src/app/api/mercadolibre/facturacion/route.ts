/**
 * GET  /api/mercadolibre/facturacion — ventas ML (desde el corte de cada
 *      pestaña) con su pestaña (clase A/B), conteos y estado de facturación.
 *      Una sola respuesta para las dos pestañas: se filtra en el cliente.
 * POST /api/mercadolibre/facturacion { packId, clase, cuit?, lineas?, confirmarFacturaEnMl?, estadoFacturaEnMlConfirmado?, nombre?, domicilio? }
 *      emite la factura (A: RI / Monotributo, B: consumidor final / exento)
 *      con el borrador revisado por el usuario (ARCA PV 7 → Colppy) y sube el
 *      PDF a la venta de ML. Si ARCA dice que va por la otra letra: 409
 *      { codigo: 'CLASE_INCORRECTA', claseCorrecta }. Factura en ML sin confirmar
 *      (o ML no pudo verificarlo): 409 { codigo: 'FACTURA_EN_ML', facturaEnMl }. La
 *      confirmación vale para el estado que vio el usuario (estadoFacturaEnMlConfirmado:
 *      true = "ya tiene factura", null = "ML no pudo verificarlo"): si ahora ML dice que
 *      tiene factura y se había confirmado otra cosa, 409 de nuevo con facturaEnMl true.
 *      GET: si una página del listado de ML falla, truncado + avisoListado.
 *      ARCA no confirmó el CAE pedido: 502 { codigo: 'ARCA_INCIERTO' } (no reintentar).
 */
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { logAudit } from '@/lib/audit'
import { PadronError } from '@/lib/arca/padron'
import {
  FacturacionMlError,
  facturarVentaMl,
  listarVentasMl,
  type DomicilioComprador,
  type LineaFacturaMl,
} from '@/lib/mercadolibre/facturacion'

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  try {
    return NextResponse.json(await listarVentasMl())
  } catch (e) {
    logger.error('[ML Facturación] Error listando ventas', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

interface BodyFacturaMl {
  packId?: string
  clase?: unknown
  cuit?: string
  lineas?: LineaFacturaMl[]
  confirmarFacturaEnMl?: unknown
  estadoFacturaEnMlConfirmado?: unknown
  nombre?: string
  domicilio?: Partial<DomicilioComprador>
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as BodyFacturaMl
  const packId = String(body.packId ?? '').trim()
  if (!/^\d+$/.test(packId)) return NextResponse.json({ error: 'packId inválido' }, { status: 400 })
  if (body.clase !== 'A' && body.clase !== 'B') {
    return NextResponse.json({ error: 'clase inválida: tiene que ser "A" o "B"', codigo: 'CLASE_INVALIDA' }, { status: 400 })
  }
  const clase = body.clase

  try {
    const r = await facturarVentaMl({
      packId,
      clase,
      cuitManual: typeof body.cuit === 'string' ? body.cuit : null,
      lineas: body.lineas,
      confirmarFacturaEnMl: body.confirmarFacturaEnMl === true,
      estadoFacturaEnMlConfirmado:
        body.estadoFacturaEnMlConfirmado === true ? true : body.estadoFacturaEnMlConfirmado === null ? null : undefined,
      nombre: typeof body.nombre === 'string' ? body.nombre : null,
      domicilio: body.domicilio && typeof body.domicilio === 'object' ? body.domicilio : null,
      user: { id: session.user.id },
    })
    logAudit({
      userId: session.user.id,
      userName: session.user.name || '',
      userEmail: session.user.email || '',
      action: 'CREATE',
      entity: 'INVOICE',
      entityId: r.invoiceId,
      entityRef: r.invoiceNumber,
      description: `Facturó venta de Mercado Libre #${packId} (Factura ${r.clase}): ${r.invoiceNumber} CAE ${r.cae}`,
    })
    return NextResponse.json({ success: true, ...r, pdfUrl: `/api/facturas/${r.invoiceId}/pdf` })
  } catch (e) {
    if (e instanceof FacturacionMlError) {
      return NextResponse.json(
        {
          error: e.message,
          ...(e.codigo ? { codigo: e.codigo } : {}),
          ...(e.claseCorrecta ? { claseCorrecta: e.claseCorrecta } : {}),
          // FACTURA_EN_ML: true = tiene factura en ML, null = ML no lo pudo confirmar
          ...(e.facturaEnMl !== undefined ? { facturaEnMl: e.facturaEnMl } : {}),
        },
        { status: e.status }
      )
    }
    // Error del padrón (no "no existe"): falla de ARCA, no del pedido
    if (e instanceof PadronError) return NextResponse.json({ error: `ARCA (padrón): ${e.message}` }, { status: 502 })
    logger.error(`[ML Facturación] Error facturando ${packId}`, e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
