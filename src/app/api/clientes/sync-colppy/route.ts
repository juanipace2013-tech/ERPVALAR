import { auth } from '@/auth'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const maxDuration = 120 // 2 minutos para sincronizar ~5600 clientes

// Colppy config
const COLPPY_ENDPOINT = 'https://login.colppy.com/lib/frontera2/service.php'
const COLPPY_USER = process.env.COLPPY_USER || ''
const COLPPY_PASSWORD = process.env.COLPPY_PASSWORD || ''
const COLPPY_ID_EMPRESA = process.env.COLPPY_ID_EMPRESA || ''

function md5(text: string): string {
  const crypto = require('crypto')
  return crypto.createHash('md5').update(text).digest('hex')
}

async function callColppyAPI(payload: any): Promise<any> {
  const response = await fetch(COLPPY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120000), // 2 min timeout
  })
  const text = await response.text()
  if (text.trim().startsWith('<')) {
    throw new Error('Sesión expirada (HTML recibido)')
  }
  return JSON.parse(text)
}

async function getColppySession(): Promise<string> {
  const passwordMD5 = md5(COLPPY_PASSWORD)
  const response = await callColppyAPI({
    auth: { usuario: COLPPY_USER, password: passwordMD5 },
    service: { provision: 'Usuario', operacion: 'iniciar_sesion' },
    parameters: { usuario: COLPPY_USER, password: passwordMD5 },
  })
  if (response.result?.estado !== 0) {
    throw new Error(`Error login Colppy: ${response.result?.mensaje}`)
  }
  return response.response.data.claveSesion
}

async function fetchAllColppyCustomers(claveSesion: string): Promise<any[]> {
  const passwordMD5 = md5(COLPPY_PASSWORD)
  const response = await callColppyAPI({
    auth: { usuario: COLPPY_USER, password: passwordMD5 },
    service: { provision: 'Cliente', operacion: 'listar_cliente' },
    parameters: {
      sesion: { usuario: COLPPY_USER, claveSesion },
      idEmpresa: COLPPY_ID_EMPRESA,
      start: 0,
      limit: 10000, // Traer todos
      filter: [],
      order: [{ field: 'NombreFantasia', dir: 'asc' }],
    },
  })
  if (response.result?.estado !== 0 || !response.response?.success) {
    throw new Error(response.result?.mensaje || 'Error cargando clientes de Colppy')
  }
  return response.response.data || []
}

// Mapeo de condición IVA de Colppy a enum de Prisma
const TAX_CONDITION_MAP: Record<string, string> = {
  '1': 'RESPONSABLE_INSCRIPTO',
  '2': 'MONOTRIBUTO',
  '4': 'EXENTO',
  '5': 'CONSUMIDOR_FINAL',
  '6': 'RESPONSABLE_NO_INSCRIPTO',
}

/**
 * POST /api/clientes/sync-colppy
 * Sincroniza TODOS los clientes de Colppy a la tabla Customer local.
 * Upsert por CUIT normalizado: crea si no existe, actualiza si existe.
 * NO sobreescribe salesPersonId ni notes (datos locales).
 */
export async function POST() {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    console.log('[Sync Colppy] Iniciando sincronización de clientes...')
    const startTime = Date.now()

    // 1. Obtener sesión de Colppy
    const claveSesion = await getColppySession()

    // 2. Traer TODOS los clientes de Colppy
    const colppyCustomers = await fetchAllColppyCustomers(claveSesion)
    console.log(`[Sync Colppy] ${colppyCustomers.length} clientes recibidos de Colppy`)

    // 3. Cargar TODOS los CUITs existentes en la base local (para saber cuáles crear vs actualizar)
    const existingCustomers = await prisma.customer.findMany({
      select: { id: true, cuit: true },
    })
    const existingByCuit = new Map<string, string>() // CUIT normalizado → id
    existingCustomers.forEach(c => {
      if (c.cuit) {
        existingByCuit.set(c.cuit.replace(/\D/g, ''), c.id)
      }
    })

    // 4. Procesar en batches
    let creados = 0
    let actualizados = 0
    let omitidos = 0
    const errores: string[] = []
    const BATCH_SIZE = 50

    for (let i = 0; i < colppyCustomers.length; i += BATCH_SIZE) {
      const batch = colppyCustomers.slice(i, i + BATCH_SIZE)
      const operations = []

      for (const c of batch) {
        try {
          const cuit = (c.CUIT || '').trim()
          const normalizedCuit = cuit.replace(/\D/g, '')

          // Saltar clientes sin CUIT válido
          if (normalizedCuit.length !== 11) {
            omitidos++
            continue
          }

          // Formatear CUIT con guiones: XX-XXXXXXXX-X
          const formattedCuit = `${normalizedCuit.slice(0, 2)}-${normalizedCuit.slice(2, 10)}-${normalizedCuit.slice(10)}`

          const name = (c.NombreFantasia || c.RazonSocial || '').trim()
          const businessName = (c.RazonSocial || '').trim()
          const taxCondition = TAX_CONDITION_MAP[String(c.idCondicionIva)] || 'RESPONSABLE_INSCRIPTO'
          const colppyId = String(c.idCliente || '')
          const email = (c.Email || '').trim() || null
          const phone = (c.Telefono || '').trim() || null
          const mobile = (c.Celular || '').trim() || null
          const address = (c.DirPostal || '').trim() || null
          const city = (c.DirPostalCiudad || '').trim() || null
          const province = (c.DirPostalProvincia || '').trim() || null
          const postalCode = (c.DirPostalCodigoPostal || '').trim() || null

          // Extraer días de pago
          const paymentTermsDays = parseInt(
            String(c.idCondicionPago || c.IdCondicionPago || c.condicionPago || '0')
          ) || null

          const existingId = existingByCuit.get(normalizedCuit)

          if (existingId) {
            // UPDATE: actualizar datos de Colppy, pero NO tocar salesPersonId ni notes
            operations.push(
              prisma.customer.update({
                where: { id: existingId },
                data: {
                  name: name || undefined,
                  businessName: businessName || undefined,
                  taxCondition: taxCondition as any,
                  colppyId,
                  email,
                  phone,
                  mobile,
                  address,
                  city,
                  province,
                  postalCode,
                  paymentTerms: paymentTermsDays,
                },
              }).then(() => { actualizados++ })
            )
          } else {
            // CREATE: nuevo cliente
            operations.push(
              prisma.customer.create({
                data: {
                  name: name || formattedCuit,
                  businessName: businessName || null,
                  cuit: formattedCuit,
                  taxCondition: taxCondition as any,
                  colppyId,
                  email,
                  phone,
                  mobile,
                  address,
                  city,
                  province,
                  postalCode,
                  paymentTerms: paymentTermsDays,
                },
              }).then(() => {
                creados++
                // Agregar al mapa para evitar duplicados en el mismo batch
                existingByCuit.set(normalizedCuit, 'new')
              })
            )
          }
        } catch (err: any) {
          errores.push(`CUIT ${c.CUIT}: ${err.message}`)
        }
      }

      // Ejecutar batch en paralelo (con manejo de errores individual)
      const results = await Promise.allSettled(operations)
      results.forEach((r, idx) => {
        if (r.status === 'rejected') {
          const reason = r.reason?.message || 'Error desconocido'
          // No duplicar errores de unique constraint (CUIT repetido en Colppy)
          if (!reason.includes('Unique constraint')) {
            errores.push(reason)
          } else {
            omitidos++
          }
        }
      })

      // Log progreso cada 500 clientes
      if ((i + BATCH_SIZE) % 500 === 0 || i + BATCH_SIZE >= colppyCustomers.length) {
        console.log(`[Sync Colppy] Progreso: ${Math.min(i + BATCH_SIZE, colppyCustomers.length)}/${colppyCustomers.length}`)
      }
    }

    const elapsed = Date.now() - startTime
    console.log(`[Sync Colppy] Completado en ${elapsed}ms: ${creados} creados, ${actualizados} actualizados, ${omitidos} omitidos, ${errores.length} errores`)

    return NextResponse.json({
      total: colppyCustomers.length,
      creados,
      actualizados,
      omitidos,
      errores: errores.slice(0, 50), // Limitar a 50 errores en la respuesta
      totalErrores: errores.length,
      tiempoMs: elapsed,
    })
  } catch (error: any) {
    console.error('[Sync Colppy] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Error al sincronizar clientes' },
      { status: 500 }
    )
  }
}
