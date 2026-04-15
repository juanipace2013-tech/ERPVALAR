/**
 * Script de CORRECCIÓN MASIVA: re-sincroniza taxCondition de clientes locales
 * con el mapeo correcto de idCondicionIva de Colppy.
 *
 * Contexto (bug fix abril 2026): el mapa anterior en sync-colppy/route.ts
 * tenía IDs 2 y 4 invertidos y le faltaba el ID 3, lo que dejó ~miles de
 * clientes con taxCondition incorrecto en el ERP. Este script consulta
 * Colppy, compara con el estado local y actualiza solo los que difieren.
 *
 * Uso: npx tsx scripts/fix-colppy-tax-condition.ts [--dry-run]
 *
 * --dry-run: no escribe en la DB, solo reporta los cambios que haría.
 */

import 'dotenv/config'
import * as crypto from 'crypto'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const COLPPY_ENDPOINT = 'https://login.colppy.com/lib/frontera2/service.php'
const COLPPY_USER = process.env.COLPPY_USER || ''
const COLPPY_PASSWORD = process.env.COLPPY_PASSWORD || ''
const COLPPY_ID_EMPRESA = process.env.COLPPY_ID_EMPRESA || ''

const DRY_RUN = process.argv.includes('--dry-run')

// Mismo mapeo que el fix de route.ts
const TAX_CONDITION_MAP: Record<string, string> = {
  '1': 'RESPONSABLE_INSCRIPTO',
  '2': 'EXENTO',
  '3': 'CONSUMIDOR_FINAL',
  '4': 'MONOTRIBUTO',
  '6': 'RESPONSABLE_NO_INSCRIPTO',
}

function md5(t: string): string {
  return crypto.createHash('md5').update(t).digest('hex')
}

async function callColppy(payload: any): Promise<any> {
  const res = await fetch(COLPPY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  return res.json()
}

async function login() {
  const passwordMD5 = md5(COLPPY_PASSWORD)
  const resp = await callColppy({
    auth: { usuario: COLPPY_USER, password: passwordMD5 },
    service: { provision: 'Usuario', operacion: 'iniciar_sesion' },
    parameters: { usuario: COLPPY_USER, password: passwordMD5 },
  })
  if (!resp.response?.success) throw new Error('Login falló: ' + JSON.stringify(resp))
  const data = resp.response.data
  return {
    usuario: COLPPY_USER,
    claveSesion: data.claveSesion || data.clavesesion || data.ClaveSesion,
    idEmpresa: COLPPY_ID_EMPRESA,
  }
}

async function logout(session: { usuario: string; claveSesion: string }) {
  try {
    const passwordMD5 = md5(COLPPY_PASSWORD)
    await callColppy({
      auth: { usuario: COLPPY_USER, password: passwordMD5 },
      service: { provision: 'Usuario', operacion: 'cerrar_sesion' },
      parameters: { sesion: { usuario: session.usuario, claveSesion: session.claveSesion } },
    })
  } catch {}
}

async function fetchAllColppyCustomers(session: any): Promise<any[]> {
  const passwordMD5 = md5(COLPPY_PASSWORD)
  const resp = await callColppy({
    auth: { usuario: COLPPY_USER, password: passwordMD5 },
    service: { provision: 'Cliente', operacion: 'listar_cliente' },
    parameters: {
      sesion: { usuario: session.usuario, claveSesion: session.claveSesion },
      idEmpresa: session.idEmpresa,
      start: 0,
      limit: 20000,
      filter: [],
      order: [{ field: 'NombreFantasia', dir: 'asc' }],
    },
  })
  if (!resp.response?.success) throw new Error('listar_cliente falló')
  return resp.response.data || []
}

function normalizeCuit(cuit: string | null | undefined): string | null {
  if (!cuit) return null
  const n = cuit.replace(/\D/g, '')
  return n.length === 11 ? n : null
}

async function main() {
  if (!COLPPY_USER || !COLPPY_PASSWORD || !COLPPY_ID_EMPRESA) {
    console.error('❌ Faltan variables de entorno Colppy')
    process.exit(1)
  }

  console.log(`🔧 Fix masivo de taxCondition ${DRY_RUN ? '(DRY-RUN)' : '(APLICANDO CAMBIOS)'}\n`)

  const session = await login()
  console.log('✅ Login Colppy OK')

  try {
    // 1. Todos los clientes de Colppy (clave: CUIT normalizado → idCondicionIva)
    const colppyCustomers = await fetchAllColppyCustomers(session)
    console.log(`📦 Recibidos ${colppyCustomers.length} clientes de Colppy\n`)

    const colppyByCuit = new Map<string, { idCondicionIva: string; name: string }>()
    for (const c of colppyCustomers) {
      const n = normalizeCuit(c.CUIT)
      if (!n) continue
      colppyByCuit.set(n, {
        idCondicionIva: String(c.idCondicionIva ?? ''),
        name: (c.NombreFantasia || c.RazonSocial || '').toString(),
      })
    }
    console.log(`   (${colppyByCuit.size} con CUIT válido indexables)`)

    // 2. Clientes locales con CUIT (cuit es String NOT NULL en el schema, pero
    // puede ser '' — filtramos los vacíos. Luego normalizeCuit descarta los
    // que no tengan 11 dígitos).
    const localCustomers = await prisma.customer.findMany({
      where: { cuit: { not: '' } },
      select: { id: true, name: true, cuit: true, taxCondition: true, colppyId: true },
    })
    console.log(`📂 ${localCustomers.length} clientes locales con CUIT\n`)

    // 3. Calcular diffs
    type Change = {
      id: string
      cuit: string
      name: string
      oldTax: string
      newTax: string
      idCondIva: string
    }
    const changes: Change[] = []
    let noColppyMatch = 0
    let unknownId = 0
    let unchanged = 0

    for (const local of localCustomers) {
      const nCuit = normalizeCuit(local.cuit)
      if (!nCuit) continue
      const colppy = colppyByCuit.get(nCuit)
      if (!colppy) {
        noColppyMatch++
        continue
      }
      const mapped = TAX_CONDITION_MAP[colppy.idCondicionIva]
      if (!mapped) {
        unknownId++
        console.log(
          `  ⚠️  idCondicionIva desconocido "${colppy.idCondicionIva}" — ` +
            `CUIT ${local.cuit} (${local.name}) — se omite (revisar manual)`
        )
        continue
      }
      if (local.taxCondition === mapped) {
        unchanged++
        continue
      }
      changes.push({
        id: local.id,
        cuit: local.cuit!,
        name: local.name,
        oldTax: local.taxCondition,
        newTax: mapped,
        idCondIva: colppy.idCondicionIva,
      })
    }

    // 4. Reportar
    console.log('═══════════════════════════════════════════════════════════════════')
    console.log('  RESUMEN PREVIO')
    console.log('═══════════════════════════════════════════════════════════════════')
    console.log(`  Clientes locales con CUIT: ${localCustomers.length}`)
    console.log(`  Sin match en Colppy:       ${noColppyMatch}`)
    console.log(`  idCondicionIva desconocido: ${unknownId}`)
    console.log(`  Ya correctos:              ${unchanged}`)
    console.log(`  A CAMBIAR:                 ${changes.length}`)
    console.log('═══════════════════════════════════════════════════════════════════\n')

    // Breakdown por transición
    const byTransition = new Map<string, number>()
    for (const ch of changes) {
      const k = `${ch.oldTax} → ${ch.newTax}`
      byTransition.set(k, (byTransition.get(k) || 0) + 1)
    }
    console.log('  Transiciones:')
    for (const [k, n] of [...byTransition.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${k.padEnd(60)} ${n}`)
    }
    console.log('')

    // Muestra de hasta 15 cambios
    console.log('  Muestra (primeros 15):')
    for (const ch of changes.slice(0, 15)) {
      console.log(
        `    ${ch.cuit.padEnd(15)} id=${ch.idCondIva}  ${ch.oldTax.padEnd(24)}→ ${ch.newTax.padEnd(24)}  ${ch.name.slice(0, 40)}`
      )
    }
    console.log('')

    if (changes.length === 0) {
      console.log('✅ Nada que actualizar.')
      return
    }

    if (DRY_RUN) {
      console.log('🧪 DRY-RUN: no se aplicaron cambios. Quitar --dry-run para ejecutar.')
      return
    }

    // 5. Aplicar en batches
    console.log(`✏️  Aplicando ${changes.length} updates...\n`)
    const BATCH = 50
    let done = 0
    let errors = 0
    for (let i = 0; i < changes.length; i += BATCH) {
      const batch = changes.slice(i, i + BATCH)
      const results = await Promise.allSettled(
        batch.map((ch) =>
          prisma.customer.update({
            where: { id: ch.id },
            data: { taxCondition: ch.newTax as any },
          })
        )
      )
      for (const r of results) {
        if (r.status === 'fulfilled') done++
        else {
          errors++
          console.error('  ❌', r.reason?.message || r.reason)
        }
      }
      console.log(`   progreso: ${Math.min(i + BATCH, changes.length)}/${changes.length}`)
    }

    console.log(`\n✅ Completado: ${done} actualizados, ${errors} errores`)
  } finally {
    await logout(session)
    console.log('✅ Logout Colppy OK')
  }
}

main()
  .catch((e) => {
    console.error('❌ Error:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
