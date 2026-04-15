import { auth } from '@/auth'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { colppyLogin, colppyLogout, getColppyConfig, md5Hash, callColppyAPI, ColppySession } from '@/lib/colppy'
import { mapColppyTaxCondition } from '@/lib/colppy-tax-map'
import { logger } from '@/lib/logger'

// Sync corre en background, el endpoint responde inmediatamente

async function fetchAllColppyCustomers(session: ColppySession): Promise<any[]> {
  const config = getColppyConfig()
  const passwordMD5 = md5Hash(config.password)
  const response = await callColppyAPI<any>({
    auth: { usuario: config.user, password: passwordMD5 },
    service: { provision: 'Cliente', operacion: 'listar_cliente' },
    parameters: {
      sesion: { usuario: session.usuario, claveSesion: session.claveSesion },
      idEmpresa: session.idEmpresa,
      start: 0,
      limit: 10000, // Traer todos
      filter: [],
      order: [{ field: 'NombreFantasia', dir: 'asc' }],
    },
  })
  if (!response.response?.success) {
    throw new Error('Error cargando clientes de Colppy')
  }
  return response.response.data || []
}

// Mapeo de condición IVA: ver src/lib/colppy-tax-map.ts (fuente única de verdad)

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
  logger.info('[Sync Colppy] Iniciando sincronización de clientes...')
  const startTime = Date.now()
  let session: ColppySession | null = null

  try {
  // 1. Obtener sesión de Colppy
  session = await colppyLogin()

  // 2. Traer TODOS los clientes de Colppy
  const colppyCustomers = await fetchAllColppyCustomers(session)
  logger.info(`[Sync Colppy] ${colppyCustomers.length} clientes recibidos de Colppy`)

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
        const { taxCondition } = mapColppyTaxCondition(
          c.idCondicionIva,
          `CUIT ${c.CUIT}, cliente ${c.NombreFantasia || c.RazonSocial}`
        )
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

        const balance = parseFloat(c.Saldo || '0')
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
                balance,
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
                balance,
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
      logger.info(`[Sync Colppy] Progreso: ${Math.min(i + BATCH_SIZE, colppyCustomers.length)}/${colppyCustomers.length}`)
    }
  }

  const elapsed = Date.now() - startTime
  logger.info(`[Sync Colppy] Completado en ${elapsed}ms: ${creados} creados, ${actualizados} actualizados, ${omitidos} omitidos, ${errores.length} errores`)

  return {
    total: colppyCustomers.length,
    creados,
    actualizados,
    omitidos,
    totalErrores: errores.length,
    tiempoMs: elapsed,
  }
  } finally {
    if (session) {
      await colppyLogout(session).catch(() => {})
    }
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
        logger.error('[Sync Colppy] Error:', err)
        syncStatus = { running: false, startedAt: null, result: null, error: err.message || 'Error desconocido' }
      })

    return NextResponse.json({
      status: 'syncing',
      message: 'Sincronización iniciada en background',
    })
  } catch (error: any) {
    logger.error('[Sync Colppy] Error:', error)
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
