import { auth } from '@/auth'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { colppyLogin, colppyLogout, getColppyConfig, md5Hash, callColppyAPI, ColppySession, colppySleep, COLPPY_PAGE_THROTTLE_MS } from '@/lib/colppy'
import { logger } from '@/lib/logger'

export const maxDuration = 120 // 2 minutos para sincronizar proveedores

async function fetchAllColppySuppliers(session: ColppySession): Promise<any[]> {
  const config = getColppyConfig()
  const passwordMD5 = md5Hash(config.password)
  const allSuppliers: any[] = []
  let start = 0
  const limit = 500

  // Paginar porque puede haber muchos proveedores
  while (true) {
    const response = await callColppyAPI<any>({
      auth: { usuario: config.user, password: passwordMD5 },
      service: { provision: 'Proveedor', operacion: 'listar_proveedor' },
      parameters: {
        sesion: { usuario: session.usuario, claveSesion: session.claveSesion },
        idEmpresa: session.idEmpresa,
        start,
        limit,
        filter: [],
        order: [{ field: 'RazonSocial', dir: 'asc' }],
      },
    }, 120000)

    if (!response.response?.success) {
      throw new Error('Error cargando proveedores de Colppy')
    }

    const data = response.response.data || []
    allSuppliers.push(...data)

    logger.info(`[Sync Proveedores] Página start=${start}: ${data.length} proveedores`)

    // Si recibimos menos del limit, ya terminamos
    if (data.length < limit) break

    start += limit

    // Throttle entre páginas: nos mantiene lejos del rate limit de 60 req/min
    await colppySleep(COLPPY_PAGE_THROTTLE_MS)
  }

  return allSuppliers
}

// Mapeo de condición IVA de Colppy (numérico) a texto
const IVA_CONDITION_MAP: Record<string, string> = {
  '1': 'Responsable Inscripto',
  '2': 'Monotributo',
  '4': 'Exento',
  '5': 'Consumidor Final',
  '6': 'Responsable No Inscripto',
}

interface SyncProveedoresResult {
  total: number
  creados: number
  actualizados: number
  omitidos: number
  errores: string[]
  totalErrores: number
  tiempoMs: number
}

interface SyncStatus {
  running: boolean
  startedAt: number | null
  result: SyncProveedoresResult | null
  error: string | null
}

// Estado en module scope (se reinicia al reiniciar PM2, aceptable)
let syncStatus: SyncStatus = { running: false, startedAt: null, result: null, error: null }

/**
 * Sincroniza TODOS los proveedores de Colppy a la tabla Supplier local.
 * Upsert por CUIT normalizado: crea si no existe, actualiza si existe.
 * NO sobreescribe campos locales (notes, internalNotes, brands, category, etc).
 */
async function runSyncProveedores(): Promise<SyncProveedoresResult> {
    logger.info('[Sync Proveedores] Iniciando sincronización de proveedores...')
    const startTime = Date.now()
    let colppySession: ColppySession | null = null

    try {
    // 1. Obtener sesión de Colppy
    colppySession = await colppyLogin()

    // 2. Traer TODOS los proveedores de Colppy
    const colppySuppliers = await fetchAllColppySuppliers(colppySession)
    logger.info(`[Sync Proveedores] ${colppySuppliers.length} proveedores recibidos de Colppy`)

    // Log del primer proveedor para ver la estructura
    if (colppySuppliers.length > 0) {
      logger.info('[Sync Proveedores] Ejemplo de proveedor:', JSON.stringify(colppySuppliers[0], null, 2))
    }

    // 3. Cargar TODOS los CUITs existentes en la base local
    const existingSuppliers = await prisma.supplier.findMany({
      select: { id: true, taxId: true },
    })
    const existingByTaxId = new Map<string, string>() // CUIT normalizado → id
    existingSuppliers.forEach(s => {
      if (s.taxId) {
        existingByTaxId.set(s.taxId.replace(/\D/g, ''), s.id)
      }
    })

    // 4. Procesar en batches
    let creados = 0
    let actualizados = 0
    let omitidos = 0
    const errores: string[] = []
    const BATCH_SIZE = 50

    for (let i = 0; i < colppySuppliers.length; i += BATCH_SIZE) {
      const batch = colppySuppliers.slice(i, i + BATCH_SIZE)
      const operations = []

      for (const p of batch) {
        try {
          const cuit = (p.CUIT || '').trim()
          const normalizedCuit = cuit.replace(/\D/g, '')

          // Saltar proveedores sin CUIT válido (11 dígitos)
          if (normalizedCuit.length !== 11) {
            omitidos++
            continue
          }

          // Formatear CUIT con guiones: XX-XXXXXXXX-X
          const formattedCuit = `${normalizedCuit.slice(0, 2)}-${normalizedCuit.slice(2, 10)}-${normalizedCuit.slice(10)}`

          const name = (p.NombreFantasia || p.RazonSocial || '').trim()
          const legalName = (p.RazonSocial || '').trim() || null
          const colppyId = String(p.idProveedor || p.id || '')
          const email = (p.Email || '').trim() || null
          const phone = (p.Telefono || '').trim() || null
          const mobile = (p.Celular || '').trim() || null
          const address = (p.DirPostal || p.Direccion || '').trim() || null
          const city = (p.DirPostalCiudad || p.Ciudad || '').trim() || null
          const province = (p.DirPostalProvincia || p.Provincia || '').trim() || null
          const postalCode = (p.DirPostalCodigoPostal || p.CodigoPostal || '').trim() || null
          const website = (p.Web || p.Website || '').trim() || null

          // Extraer condición de pago (días)
          const paymentDaysRaw = parseInt(
            String(p.idCondicionPago || p.IdCondicionPago || p.condicionPago || '30')
          )
          const paymentDays = isNaN(paymentDaysRaw) ? 30 : paymentDaysRaw

          const existingId = existingByTaxId.get(normalizedCuit)

          if (existingId) {
            // UPDATE: actualizar datos de Colppy, pero NO tocar notes, internalNotes, brands, category, discount, etc.
            operations.push(
              prisma.supplier.update({
                where: { id: existingId },
                data: {
                  name: name || undefined,
                  legalName: legalName || undefined,
                  colppyId,
                  email,
                  phone,
                  mobile,
                  address,
                  city,
                  province,
                  postalCode,
                  website,
                  paymentDays,
                },
              }).then(() => { actualizados++ })
            )
          } else {
            // CREATE: nuevo proveedor
            operations.push(
              prisma.supplier.create({
                data: {
                  name: name || formattedCuit,
                  legalName,
                  taxId: formattedCuit,
                  colppyId,
                  email,
                  phone,
                  mobile,
                  address,
                  city,
                  province,
                  postalCode,
                  website,
                  paymentDays,
                  status: 'ACTIVE',
                },
              }).then(() => {
                creados++
                // Agregar al mapa para evitar duplicados en el mismo batch
                existingByTaxId.set(normalizedCuit, 'new')
              })
            )
          }
        } catch (err: any) {
          errores.push(`CUIT ${p.CUIT}: ${err.message}`)
        }
      }

      // Ejecutar batch en paralelo
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

      // Log progreso
      if ((i + BATCH_SIZE) % 200 === 0 || i + BATCH_SIZE >= colppySuppliers.length) {
        logger.info(`[Sync Proveedores] Progreso: ${Math.min(i + BATCH_SIZE, colppySuppliers.length)}/${colppySuppliers.length}`)
      }
    }

    const elapsed = Date.now() - startTime
    logger.info(`[Sync Proveedores] Completado en ${elapsed}ms: ${creados} creados, ${actualizados} actualizados, ${omitidos} omitidos, ${errores.length} errores`)

    return {
      total: colppySuppliers.length,
      creados,
      actualizados,
      omitidos,
      errores: errores.slice(0, 50),
      totalErrores: errores.length,
      tiempoMs: elapsed,
    }
    } finally {
      if (colppySession) {
        await colppyLogout(colppySession).catch(() => {})
      }
    }
}

/**
 * POST /api/proveedores/sync-colppy
 * Inicia la sincronización en background y responde inmediatamente
 * (antes bloqueaba el request hasta 2 minutos). GET devuelve el estado
 * para polling — mismo patrón que /api/clientes/sync-colppy.
 */
export async function POST() {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    if (syncStatus.running) {
      return NextResponse.json({
        status: 'already_running',
        message: 'Sincronización ya en progreso',
        startedAt: syncStatus.startedAt,
      })
    }

    syncStatus = { running: true, startedAt: Date.now(), result: null, error: null }

    // Disparar sync en background (sin await)
    runSyncProveedores()
      .then((result) => {
        syncStatus = { running: false, startedAt: null, result, error: null }
      })
      .catch((error: any) => {
        logger.error('[Sync Proveedores] Error:', error)
        syncStatus = {
          running: false,
          startedAt: null,
          result: null,
          error: error.message || 'Error al sincronizar proveedores',
        }
      })

    return NextResponse.json({
      status: 'syncing',
      message: 'Sincronización iniciada en background',
    })
  } catch (error: any) {
    logger.error('[Sync Proveedores] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Error al sincronizar proveedores' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/proveedores/sync-colppy
 * Devuelve el estado actual del sync (para polling desde la UI).
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
    return NextResponse.json({ status: 'error', error: syncStatus.error })
  }

  if (syncStatus.result) {
    return NextResponse.json({ status: 'done', result: syncStatus.result })
  }

  return NextResponse.json({ status: 'idle' })
}
