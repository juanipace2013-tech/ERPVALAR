import { auth } from '@/auth'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Sync corre en background, el endpoint responde inmediatamente

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
    signal: AbortSignal.timeout(30000), // 30s timeout
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
// Estado del sync en memoria (para polling)
let syncStatus: {
  running: boolean
  startedAt: number | null
  result: {
    total: number
    creados: number
    actualizados: number
    omitidos: number
    totalErrores: number
    tiempoMs: number
  } | null
  error: string | null
} = { running: false, startedAt: null, result: null, error: null }

async function syncColppyClients() {
  console.log('[Sync Colppy] Iniciando sincronización de clientes...')
  const startTime = Date.now()

  // 1. Obtener sesión de Colppy
  const claveSesion = await getColppySession()

  // 2. Traer TODOS los clientes de Colppy
  const colppyCustomers = await fetchAllColppyCustomers(claveSesion)
  console.log(`[Sync Colppy] ${colppyCustomers.length} clientes recibidos de Colppy`)

  // 3. Cargar TODOS los CUITs existentes en la base local
  const existingCustomers = await prisma.customer.findMany({
    select: { id: true, cuit: true },
  })
  const existingByCuit = new Map<string, string>()
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

        if (normalizedCuit.length !== 11) {
          omitidos++
          continue
        }

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

        const paymentTermsDays = parseInt(
          String(c.idCondicionPago || c.IdCondicionPago || c.condicionPago || '0')
        ) || null

        const existingId = existingByCuit.get(normalizedCuit)

        if (existingId) {
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
              existingByCuit.set(normalizedCuit, 'new')
            })
          )
        }
      } catch (err: any) {
        errores.push(`CUIT ${c.CUIT}: ${err.message}`)
      }
    }

    const results = await Promise.allSettled(operations)
    results.forEach((r) => {
      if (r.status === 'rejected') {
        const reason = r.reason?.message || 'Error desconocido'
        if (!reason.includes('Unique constraint')) {
          errores.push(reason)
        } else {
          omitidos++
        }
      }
    })

    if ((i + BATCH_SIZE) % 500 === 0 || i + BATCH_SIZE >= colppyCustomers.length) {
      console.log(`[Sync Colppy] Progreso: ${Math.min(i + BATCH_SIZE, colppyCustomers.length)}/${colppyCustomers.length}`)
    }
  }

  const elapsed = Date.now() - startTime
  console.log(`[Sync Colppy] Completado en ${elapsed}ms: ${creados} creados, ${actualizados} actualizados, ${omitidos} omitidos, ${errores.length} errores`)

  return {
    total: colppyCustomers.length,
    creados,
    actualizados,
    omitidos,
    totalErrores: errores.length,
    tiempoMs: elapsed,
  }
}

/**
 * POST /api/clientes/sync-colppy
 * Inicia sincronización en background, responde inmediatamente.
 */
export async function POST() {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    // Si ya está corriendo, no iniciar otra
    if (syncStatus.running) {
      return NextResponse.json({
        status: 'already_running',
        message: 'Sincronización ya en progreso',
        startedAt: syncStatus.startedAt,
      })
    }

    // Marcar como corriendo
    syncStatus = { running: true, startedAt: Date.now(), result: null, error: null }

    // Disparar sync en background (sin await)
    syncColppyClients()
      .then((result) => {
        syncStatus = { running: false, startedAt: null, result, error: null }
      })
      .catch((err) => {
        console.error('[Sync Colppy] Error:', err)
        syncStatus = { running: false, startedAt: null, result: null, error: err.message || 'Error desconocido' }
      })

    return NextResponse.json({
      status: 'syncing',
      message: 'Sincronización iniciada en background',
    })
  } catch (error: any) {
    console.error('[Sync Colppy] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Error al sincronizar clientes' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/clientes/sync-colppy
 * Devuelve el estado actual del sync (para polling).
 */
export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  if (syncStatus.running) {
    return NextResponse.json({
      status: 'running',
      startedAt: syncStatus.startedAt,
      elapsedMs: Date.now() - (syncStatus.startedAt || Date.now()),
    })
  }

  if (syncStatus.error) {
    return NextResponse.json({
      status: 'error',
      error: syncStatus.error,
    })
  }

  if (syncStatus.result) {
    return NextResponse.json({
      status: 'completed',
      ...syncStatus.result,
    })
  }

  return NextResponse.json({ status: 'idle' })
}
