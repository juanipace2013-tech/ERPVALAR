/**
 * GET /api/afip/cuit/[cuit] - Datos de un CUIT según la Constancia de
 * Inscripción de ARCA (servicio oficial con el certificado del ERP; ver
 * src/lib/arca/padron.ts). Lo usan las altas de clientes y proveedores.
 */
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { isArcaConfigured } from '@/lib/arca/config'
import { consultarPersona, PadronError } from '@/lib/arca/padron'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ cuit: string }> }) {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  const { cuit } = await params
  if (!isArcaConfigured()) {
    return NextResponse.json(
      { error: 'Consulta a ARCA no configurada', message: 'Falta la configuración ARCA_* en el servidor.' },
      { status: 503 }
    )
  }

  try {
    const p = await consultarPersona(cuit)
    const notes = [
      p.actividadPrincipal ? `Actividad principal: ${p.actividadPrincipal}` : '',
      p.activo ? '' : 'ATENCIÓN: CUIT inactivo en ARCA',
      ...p.observaciones.map((o) => `ARCA: ${o}`),
    ]
      .filter(Boolean)
      .join('\n')

    return NextResponse.json({
      success: true,
      source: 'ARCA',
      data: {
        cuit: p.cuit,
        name: p.razonSocial,
        businessName: p.razonSocial,
        type: p.tipoPersona === 'JURIDICA' ? 'BUSINESS' : 'INDIVIDUAL',
        taxCondition: p.condicionIva ?? undefined,
        address: p.domicilio.direccion,
        city: p.domicilio.localidad,
        province: p.domicilio.provincia || undefined,
        postalCode: p.domicilio.codigoPostal,
        country: 'Argentina',
        status: p.activo ? 'ACTIVE' : 'INACTIVE',
        notes,
      },
      rawData: p,
    })
  } catch (error) {
    if (error instanceof PadronError) {
      return NextResponse.json({ error: error.message, message: error.message }, { status: error.status })
    }
    logger.error('[Padrón] Error consultando ARCA', error)
    return NextResponse.json(
      {
        error: 'Error al consultar ARCA',
        message: error instanceof Error ? error.message : 'Error desconocido',
      },
      { status: 502 }
    )
  }
}
