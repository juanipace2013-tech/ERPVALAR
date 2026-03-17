/**
 * GET /api/cron/sync-balances?secret=CRON_SECRET
 *
 * Sync liviano: solo actualiza Customer.balance desde Colppy.
 * NO toca nombre, CUIT, dirección, etc. — solo el saldo.
 * Pensado para correr diariamente a las 18:00 ART via cron.
 *
 * GET sin ?secret devuelve el estado de la última sincronización.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import * as crypto from 'crypto'

// ─── Colppy config ──────────────────────────────────────────────────────────

const COLPPY_ENDPOINT = 'https://login.colppy.com/lib/frontera2/service.php'
const COLPPY_USER = process.env.COLPPY_USER || ''
const COLPPY_PASSWORD = process.env.COLPPY_PASSWORD || ''
const COLPPY_ID_EMPRESA = process.env.COLPPY_ID_EMPRESA || ''

function md5(text: string): string {
  return crypto.createHash('md5').update(text).digest('hex')
}

async function callColppy(payload: any): Promise<any> {
  const response = await fetch(COLPPY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  })
  const text = await response.text()
  if (text.trim().startsWith('<')) {
    throw new Error('Sesión expirada (HTML recibido)')
  }
  return JSON.parse(text)
}

// ─── Estado en memoria ──────────────────────────────────────────────────────

let lastSync: {
  completedAt: string | null
  updated: number
  errors: number
  duration: string
} = { completedAt: null, updated: 0, errors: 0, duration: '0s' }

// ─── Handler ────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')

  // Sin secret → devolver estado de última sincronización (público para la UI)
  if (!secret) {
    return NextResponse.json({
      lastSync: lastSync.completedAt ? lastSync : null,
    })
  }

  // Con secret → ejecutar sync
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startTime = Date.now()
  let updated = 0
  let errors = 0

  try {
    // 1. Login Colppy
    const passwordMD5 = md5(COLPPY_PASSWORD)
    const loginRes = await callColppy({
      auth: { usuario: COLPPY_USER, password: passwordMD5 },
      service: { provision: 'Usuario', operacion: 'iniciar_sesion' },
      parameters: { usuario: COLPPY_USER, password: passwordMD5 },
    })

    if (loginRes.result?.estado !== 0) {
      throw new Error(`Error login Colppy: ${loginRes.result?.mensaje}`)
    }

    const claveSesion = loginRes.response.data.claveSesion

    // 2. Traer todos los clientes de Colppy (solo necesitamos idCliente + Saldo)
    const listRes = await callColppy({
      auth: { usuario: COLPPY_USER, password: passwordMD5 },
      service: { provision: 'Cliente', operacion: 'listar_cliente' },
      parameters: {
        sesion: { usuario: COLPPY_USER, claveSesion },
        idEmpresa: COLPPY_ID_EMPRESA,
        start: 0,
        limit: 10000,
        filter: [],
        order: [{ field: 'NombreFantasia', dir: 'asc' }],
      },
    })

    if (listRes.result?.estado !== 0 || !listRes.response?.success) {
      throw new Error(listRes.result?.mensaje || 'Error cargando clientes de Colppy')
    }

    const colppyClients: any[] = listRes.response.data || []
    console.log(`[CRON] Sync balances: ${colppyClients.length} clientes de Colppy`)

    // 3. Cargar mapa colppyId → id de la DB local
    const localCustomers = await prisma.customer.findMany({
      select: { id: true, colppyId: true },
      where: { colppyId: { not: null } },
    })
    const localByColppyId = new Map<string, string>()
    localCustomers.forEach((c) => {
      if (c.colppyId) localByColppyId.set(c.colppyId, c.id)
    })

    // 4. Actualizar balances en batches
    const BATCH_SIZE = 50

    for (let i = 0; i < colppyClients.length; i += BATCH_SIZE) {
      const batch = colppyClients.slice(i, i + BATCH_SIZE)
      const operations = []

      for (const c of batch) {
        const colppyId = String(c.idCliente || '')
        const localId = localByColppyId.get(colppyId)
        if (!localId) continue

        const balance = parseFloat(c.Saldo || '0')

        operations.push(
          prisma.customer.update({
            where: { id: localId },
            data: { balance },
          }).then(() => { updated++ })
           .catch(() => { errors++ })
        )
      }

      await Promise.allSettled(operations)
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1)

    lastSync = {
      completedAt: new Date().toISOString(),
      updated,
      errors,
      duration: `${duration}s`,
    }

    console.log(`[CRON] Sync balances completed: ${updated} clients updated, ${errors} errors in ${duration}s`)

    return NextResponse.json({
      status: 'ok',
      updated,
      errors,
      duration: `${duration}s`,
    })
  } catch (error: any) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(1)
    console.error(`[CRON] Sync balances FAILED after ${duration}s:`, error.message)

    return NextResponse.json(
      { error: error.message, duration: `${duration}s` },
      { status: 500 }
    )
  }
}
