import { auth } from '@/auth'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const maxDuration = 120 // 2 minutos para sincronizar proveedores

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

async function fetchAllColppySuppliers(claveSesion: string): Promise<any[]> {
  const passwordMD5 = md5(COLPPY_PASSWORD)
  const allSuppliers: any[] = []
  let start = 0
  const limit = 500

  // Paginar porque puede haber muchos proveedores
  while (true) {
    const response = await callColppyAPI({
      auth: { usuario: COLPPY_USER, password: passwordMD5 },
      service: { provision: 'Proveedor', operacion: 'listar_proveedor' },
      parameters: {
        sesion: { usuario: COLPPY_USER, claveSesion },
        idEmpresa: COLPPY_ID_EMPRESA,
        start,
        limit,
        filter: [],
        order: [{ field: 'RazonSocial', dir: 'asc' }],
      },
    })

    if (response.result?.estado !== 0 || !response.response?.success) {
      throw new Error(response.result?.mensaje || 'Error cargando proveedores de Colppy')
    }

    const data = response.response.data || []
    allSuppliers.push(...data)

    console.log(`[Sync Proveedores] Página start=${start}: ${data.length} proveedores`)

    // Si recibimos menos del limit, ya terminamos
    if (data.length < limit) break

    start += limit

    // Pausa breve entre páginas para no saturar
    await new Promise(resolve => setTimeout(resolve, 200))
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

/**
 * POST /api/proveedores/sync-colppy
 * Sincroniza TODOS los proveedores de Colppy a la tabla Supplier local.
 * Upsert por CUIT normalizado: crea si no existe, actualiza si existe.
 * NO sobreescribe campos locales (notes, internalNotes, brands, category, etc).
 */
export async function POST() {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    console.log('[Sync Proveedores] Iniciando sincronización de proveedores...')
    const startTime = Date.now()

    // 1. Obtener sesión de Colppy
    const claveSesion = await getColppySession()

    // 2. Traer TODOS los proveedores de Colppy
    const colppySuppliers = await fetchAllColppySuppliers(claveSesion)
    console.log(`[Sync Proveedores] ${colppySuppliers.length} proveedores recibidos de Colppy`)

    // Log del primer proveedor para ver la estructura
    if (colppySuppliers.length > 0) {
      console.log('[Sync Proveedores] Ejemplo de proveedor:', JSON.stringify(colppySuppliers[0], null, 2))
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
        console.log(`[Sync Proveedores] Progreso: ${Math.min(i + BATCH_SIZE, colppySuppliers.length)}/${colppySuppliers.length}`)
      }
    }

    const elapsed = Date.now() - startTime
    console.log(`[Sync Proveedores] Completado en ${elapsed}ms: ${creados} creados, ${actualizados} actualizados, ${omitidos} omitidos, ${errores.length} errores`)

    return NextResponse.json({
      total: colppySuppliers.length,
      creados,
      actualizados,
      omitidos,
      errores: errores.slice(0, 50),
      totalErrores: errores.length,
      tiempoMs: elapsed,
    })
  } catch (error: any) {
    console.error('[Sync Proveedores] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Error al sincronizar proveedores' },
      { status: 500 }
    )
  }
}
