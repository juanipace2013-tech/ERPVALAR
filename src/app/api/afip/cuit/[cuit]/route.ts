import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

interface AFIPData {
  cuit: string
  denominacion: string
  razonSocial: string
  tipoPersona: 'FISICA' | 'JURIDICA'
  condicionIVA: string
  domicilioFiscal: {
    direccion: string
    localidad: string
    provincia: string
    codigoPostal: string
  }
  email?: string
  telefono?: string
  actividadPrincipal?: string
  fechaInscripcion?: string
  estadoContribuyente: 'ACTIVO' | 'INACTIVO'
}

// Función para consultar AFIP usando servicio público
// NOTA: Esta implementación usa el servicio público de AFIP que no requiere autenticación
// Para producción con más datos, considerar usar Web Services oficiales con certificados
async function consultarAFIP(cuit: string): Promise<AFIPData | null> {
  try {
    // Validar formato CUIT
    const cuitLimpio = cuit.replace(/[-\s]/g, '')
    if (cuitLimpio.length !== 11 || !/^\d+$/.test(cuitLimpio)) {
      throw new Error('CUIT inválido')
    }

    console.log(`[AFIP] Consultando CUIT real: ${cuitLimpio}`)

    // Intentar consulta a servicio público de AFIP
    // Usamos el servicio de consulta pública que está disponible sin autenticación
    try {
      // AFIP tiene un servicio público de consulta de constancia
      // URL: https://www.afip.gob.ar/sitio/externos/default.asp

      // Opción 1: Servicio público de AFIP (requiere parsing HTML o usar API pública)
      // Por ahora usaremos una API pública de terceros que consulta AFIP

      await fetch(
        `https://api.argentinadatos.com/v1/cotizaciones/dolares`,
        {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'CRM-Valarg/1.0',
          },
          signal: AbortSignal.timeout(10000), // 10 segundos timeout
        }
      )

      // NOTA: Este es un endpoint de prueba. Para producción real con AFIP:
      // 1. Usar una API de terceros confiable (ej: API de datos fiscales)
      // 2. O implementar scraping del sitio público de AFIP
      // 3. O usar los Web Services oficiales con certificados

      // Por ahora, hacemos una consulta básica al padrón público
      // Simulamos la consulta con datos reales cuando es posible

      // Intentamos extraer información básica del CUIT
      const tipoPersona = cuitLimpio.substring(0, 2)
      const esCuitEmpresa = ['30', '33', '34'].includes(tipoPersona)
      const esCuitPersona = ['20', '23', '24', '27'].includes(tipoPersona)

      if (!esCuitEmpresa && !esCuitPersona) {
        console.log(`[AFIP] CUIT con tipo desconocido: ${tipoPersona}`)
        return null
      }

      // Intentar obtener datos reales mediante scraping simple
      const datosReales = await consultarAFIPPublico(cuitLimpio)

      if (datosReales) {
        console.log(`[AFIP] Datos obtenidos del servicio público`)
        return datosReales
      }

      // Si no pudimos obtener datos reales, retornar null
      // Esto forzará un error 404 al usuario indicando que debe usar otra opción
      console.log(`[AFIP] No se pudieron obtener datos del servicio público`)
      console.log(`[AFIP] El servicio público de AFIP podría estar restringido`)
      console.log(`[AFIP] Opciones: 1) Configurar Web Services oficiales, 2) Usar API de terceros`)

      return null
    } catch (fetchError) {
      console.error('[AFIP] Error en consulta pública:', fetchError)
      throw fetchError
    }
  } catch (error) {
    console.error('[AFIP] Error al consultar:', error)
    return null
  }
}

// Función auxiliar para consultar el servicio público de AFIP
async function consultarAFIPPublico(cuit: string): Promise<AFIPData | null> {
  try {
    // AFIP tiene una API pública de consulta de constancia de inscripción
    // Endpoint: https://soa.afip.gob.ar/sr-padron/v2/persona/{cuit}

    const url = `https://soa.afip.gob.ar/sr-padron/v2/persona/${cuit}`

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
      signal: AbortSignal.timeout(8000),
    })

    if (!response.ok) {
      console.log(`[AFIP] Respuesta del servicio público: ${response.status}`)
      return null
    }

    const data = await response.json()

    // Parsear respuesta de AFIP
    if (data && data.datosGenerales) {
      const dg = data.datosGenerales
      const impuesto = data.datosMonotributo || data.datosRegimenGeneral || {}

      return {
        cuit: cuit,
        denominacion: dg.nombre || dg.razonSocial || '',
        razonSocial: dg.razonSocial || dg.nombre || '',
        tipoPersona: dg.tipoPersona === 'FISICA' ? 'FISICA' : 'JURIDICA',
        condicionIVA: determinarCondicionIVA(impuesto),
        domicilioFiscal: {
          direccion: data.domicilioFiscal?.direccion || '',
          localidad: data.domicilioFiscal?.localidad || '',
          provincia: data.domicilioFiscal?.descripcionProvincia || '',
          codigoPostal: data.domicilioFiscal?.codigoPostal || '',
        },
        actividadPrincipal: data.actividades?.[0]?.descripcion,
        fechaInscripcion: dg.fechaInscripcion,
        estadoContribuyente: dg.estadoClave === 'ACTIVO' ? 'ACTIVO' : 'INACTIVO',
      }
    }

    return null
  } catch (error) {
    console.log(`[AFIP] No se pudo consultar servicio público:`, error instanceof Error ? error.message : 'Error desconocido')
    return null
  }
}

// Función auxiliar para determinar condición IVA
function determinarCondicionIVA(impuestoData: { descripcionMonotributo?: string; idImpuesto?: number; descripcion?: string }): string {
  if (impuestoData.descripcionMonotributo) {
    return 'MONOTRIBUTO'
  }
  if (impuestoData.idImpuesto === 30) {
    return 'RESPONSABLE_INSCRIPTO'
  }
  if (impuestoData.descripcion?.includes('EXENTO')) {
    return 'EXENTO'
  }
  return 'RESPONSABLE_INSCRIPTO'
}

// Mapear condición IVA de AFIP a nuestro enum
function mapearCondicionIVA(condicionAFIP: string): string {
  const mapeo: Record<string, string> = {
    'RESPONSABLE_INSCRIPTO': 'RESPONSABLE_INSCRIPTO',
    'RESPONSABLE INSCRIPTO': 'RESPONSABLE_INSCRIPTO',
    'MONOTRIBUTO': 'MONOTRIBUTO',
    'EXENTO': 'EXENTO',
    'CONSUMIDOR FINAL': 'CONSUMIDOR_FINAL',
    'NO RESPONSABLE': 'NO_RESPONSABLE',
    'RESPONSABLE NO INSCRIPTO': 'RESPONSABLE_NO_INSCRIPTO',
  }

  return mapeo[condicionAFIP.toUpperCase()] || 'RESPONSABLE_INSCRIPTO'
}

// GET /api/afip/cuit/[cuit] - Consultar datos de CUIT en AFIP
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ cuit: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { cuit } = await params

    if (!cuit) {
      return NextResponse.json(
        { error: 'CUIT requerido' },
        { status: 400 }
      )
    }

    // Consultar AFIP
    const datosAFIP = await consultarAFIP(cuit)

    if (!datosAFIP) {
      return NextResponse.json(
        {
          error: 'No se pudieron obtener datos de AFIP',
          message: 'El servicio público de AFIP no está disponible actualmente. ' +
                   'Esto puede deberse a: 1) Restricciones de CORS, 2) El CUIT no existe, ' +
                   '3) El servicio está temporalmente fuera de línea. ' +
                   'Para acceso confiable, considera configurar Web Services oficiales de AFIP.',
          cuit: cuit,
        },
        { status: 503 }
      )
    }

    // Transformar a formato compatible con nuestro formulario
    const customerData = {
      cuit: datosAFIP.cuit,
      name: datosAFIP.denominacion,
      businessName: datosAFIP.razonSocial || datosAFIP.denominacion,
      type: datosAFIP.tipoPersona === 'JURIDICA' ? 'BUSINESS' : 'INDIVIDUAL',
      taxCondition: mapearCondicionIVA(datosAFIP.condicionIVA),
      address: datosAFIP.domicilioFiscal.direccion,
      city: datosAFIP.domicilioFiscal.localidad,
      province: datosAFIP.domicilioFiscal.provincia,
      postalCode: datosAFIP.domicilioFiscal.codigoPostal,
      country: 'Argentina',
      status: datosAFIP.estadoContribuyente === 'ACTIVO' ? 'ACTIVE' : 'INACTIVE',
      email: datosAFIP.email,
      phone: datosAFIP.telefono,
      notes: datosAFIP.actividadPrincipal
        ? `Actividad principal: ${datosAFIP.actividadPrincipal}`
        : '',
    }

    return NextResponse.json({
      success: true,
      source: 'AFIP',
      data: customerData,
      rawData: datosAFIP, // Datos originales para referencia
    })
  } catch (error) {
    console.error('[AFIP] Error en endpoint:', error)
    return NextResponse.json(
      {
        error: 'Error al consultar AFIP',
        message: error instanceof Error ? error.message : 'Error desconocido'
      },
      { status: 500 }
    )
  }
}
