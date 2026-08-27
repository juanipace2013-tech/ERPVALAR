/**
 * Importa el histórico de ausencias extraído del Excel
 * "VACACIONES VAL ARG S.R.L..xlsx" (JSON generado offline).
 *
 *   npx tsx scripts/import-vacaciones.ts <ruta/vacaciones.json>           # dry-run
 *   npx tsx scripts/import-vacaciones.ts <ruta/vacaciones.json> --apply
 *
 * Idempotente: upsert por (empleado, fecha). Crea los empleados si faltan
 * (FEDERICO queda inactivo — solo aparece en planillas viejas) y setea el
 * saldo pendiente inicial de la hoja "Empleados y Empresa" (GERMAN: 7).
 */
import 'dotenv/config'
import fs from 'fs'
import { prisma } from '@/lib/prisma'

const ORDEN = ['SANTIAGO', 'CAROLINA', 'GERMAN', 'PAULA', 'JUANI', 'FEDERICO']
const INACTIVOS = new Set(['FEDERICO'])
const SALDOS: Record<string, number> = { GERMAN: 7 }

interface Registro {
  empleado: string
  fecha: string // YYYY-MM-DD
  tipo: 'V' | 'P' | 'E'
}
const TIPO = { V: 'VACACIONES', P: 'PERSONAL', E: 'ENFERMEDAD' } as const

async function main() {
  const file = process.argv[2]
  const apply = process.argv.includes('--apply')
  if (!file || !fs.existsSync(file)) {
    console.error('Uso: npx tsx scripts/import-vacaciones.ts <vacaciones.json> [--apply]')
    process.exit(1)
  }
  const registros = JSON.parse(fs.readFileSync(file, 'utf8')) as Registro[]
  const nombres = [...new Set(registros.map((r) => r.empleado))]
  console.log(`${registros.length} ausencias de ${nombres.length} empleados: ${nombres.join(', ')}`)

  if (!apply) {
    const porAnio = new Map<string, number>()
    for (const r of registros) porAnio.set(r.fecha.slice(0, 4), (porAnio.get(r.fecha.slice(0, 4)) ?? 0) + 1)
    console.log('Por año:', Object.fromEntries([...porAnio.entries()].sort()))
    console.log('Dry-run: nada escrito. Correr con --apply.')
    return
  }

  const ids = new Map<string, string>()
  for (const nombre of nombres.sort((a, b) => ORDEN.indexOf(a) - ORDEN.indexOf(b))) {
    const emp = await prisma.empleado.upsert({
      where: { nombre },
      create: {
        nombre,
        activo: !INACTIVOS.has(nombre),
        orden: ORDEN.indexOf(nombre) >= 0 ? ORDEN.indexOf(nombre) : 99,
        saldoVacaciones: SALDOS[nombre] ?? null,
      },
      update: {},
    })
    ids.set(nombre, emp.id)
  }

  let n = 0
  for (const r of registros) {
    const fecha = new Date(`${r.fecha}T00:00:00.000Z`)
    await prisma.ausencia.upsert({
      where: { empleadoId_fecha: { empleadoId: ids.get(r.empleado)!, fecha } },
      create: { empleadoId: ids.get(r.empleado)!, fecha, tipo: TIPO[r.tipo] },
      update: { tipo: TIPO[r.tipo] },
    })
    n++
  }
  console.log(`Importadas ${n} ausencias. Empleados: ${ids.size}.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
