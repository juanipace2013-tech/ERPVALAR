/**
 * Cron diario (9:00 AR en el VPS): sincroniza la facturación de Colppy y
 * refresca todas las liquidaciones de comisiones ABIERTAS, para que las NC
 * hechas en Colppy anulen solas las facturas de la planilla sin depender de
 * acordarse de sincronizar a mano.
 *
 * Rango del sync: últimos 40 días (cubre NC de fin de mes sobre facturas del
 * mes anterior). Crontab:
 *   0 9 * * * cd /home/deploy/crm-valarg && npx tsx scripts/sync-colppy-diario.ts >> /home/deploy/logs/sync-colppy.log 2>&1
 *
 * Uso manual: npx tsx scripts/sync-colppy-diario.ts [dias]
 */
import { prisma } from '@/lib/prisma'
import { syncColppyFacturas } from '@/lib/facturacion/sync-colppy'
import { abrirYSincronizar } from '@/lib/comisiones/liquidacion'

const DIAS_DEFAULT = 40

async function main() {
  const dias = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : DIAS_DEFAULT
  const hasta = new Date()
  const desde = new Date(hasta.getTime() - dias * 24 * 60 * 60 * 1000)

  console.log(`\n===== ${hasta.toISOString()} — sync diario Colppy (últimos ${dias} días) =====`)

  const resumen = await syncColppyFacturas(desde, hasta)
  console.log(
    `Sync ${resumen.rangoFechas.desde} → ${resumen.rangoFechas.hasta}: ` +
      `${resumen.created} creadas, ${resumen.updated} actualizadas, ${resumen.skipped} omitidas, ` +
      `${resumen.errors} errores${resumen.partial ? ' (PARCIAL)' : ''}`
  )
  if (resumen.errors > 0) console.log('Errores:', JSON.stringify(resumen.errorDetails))

  // Refrescar liquidaciones ABIERTAS: corre la detección de NC (anula
  // facturas), sincroniza líneas y recalcula tramo/comisiones.
  const abiertas = await prisma.comisionLiquidacion.findMany({
    where: { estado: 'ABIERTA' },
    include: { vendedor: { select: { name: true } } },
    orderBy: [{ anio: 'asc' }, { mes: 'asc' }],
  })

  for (const liq of abiertas) {
    const antes = Number(liq.totalFacturadoUsd)
    try {
      const despues = await abrirYSincronizar(liq.vendedorId, liq.anio, liq.mes)
      const nuevo = Number(despues.totalFacturadoUsd)
      const delta = nuevo - antes
      console.log(
        `Liquidación ${liq.mes}/${liq.anio} ${liq.vendedor.name}: ` +
          `USD ${nuevo.toLocaleString('es-AR')}` +
          (Math.abs(delta) >= 0.01 ? ` (${delta > 0 ? '+' : ''}${delta.toLocaleString('es-AR')} vs ayer)` : ' (sin cambios)')
      )
    } catch (e) {
      console.error(
        `Liquidación ${liq.mes}/${liq.anio} ${liq.vendedor.name}: ERROR refrescando —`,
        e instanceof Error ? e.message : e
      )
    }
  }
}

main()
  .catch((e) => {
    console.error('ERROR:', e.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
