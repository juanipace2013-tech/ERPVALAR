/**
 * Ventas de Mercado Libre trabadas en "revisar": candado MlOrderInvoice en
 * EMITIENDO sin factura. Pasa cuando se pidió el CAE y ARCA no lo confirmó
 * ([ML_ARCA_INCIERTO]): el candado queda puesto para que un reintento no saque
 * un segundo comprobante, y la venta no se puede volver a facturar.
 *
 *   npx tsx scripts/ml-reconciliar-emitiendo.ts
 *       Diagnóstico. SOLO LECTURA: DB + FECompUltimoAutorizado / FECompConsultar.
 *       Para cada candado busca en ARCA (PV de la config) las Factura A (1),
 *       Factura B (6) y FCE A (201) desde el último número autorizado hasta 20
 *       para atrás (cortando en los comprobantes de antes del candado), con total
 *       a 1 peso o menos del de la venta y documento = el CUIT/CUIL del candado
 *       o el DNI que tiene adentro.
 *        - Coincide → "ARCA tiene <Factura X> N° <n> CAE <cae> para esta venta:
 *          registrarla a mano, NO liberar". Nunca se libera.
 *        - No coincide nada → se puede liberar con --liberar.
 *   npx tsx scripts/ml-reconciliar-emitiendo.ts --liberar <packId> --apply
 *       Borra el candado de esa venta (solo si ARCA no tiene nada que coincida y
 *       todas las consultas respondieron) para que se pueda volver a facturar.
 *       Imprime lo que borró.
 *   --pack <packId>   limita el diagnóstico a esa venta.
 *
 * Nunca libera (ni recorre ARCA para) un candado que tomó una factura directa
 * ("Nueva factura") sin resolver: ese se resuelve con
 * scripts/factura-directa-reconciliar.ts --id <facturaDirectaId>. Tampoco
 * libera un candado sin CUIT/CUIL de 11 dígitos (un DNI o '0' de una B a
 * consumidor final no se puede comparar con ARCA).
 *
 * No emite nada en ARCA. Requiere ARCA_* y DATABASE_URL del ambiente donde se
 * emitió (en prod: el VPS).
 */
import 'dotenv/config'
import { prisma } from '@/lib/prisma'
import { getArcaConfig } from '@/lib/arca/config'
import { feCompConsultar, feCompUltimoAutorizado, formatNroComprobante } from '@/lib/arca/wsfe'
import { describeCbteTipo } from '@/lib/arca/emitir'
import { candadoComparable, escanearArcaParaCandado, TIPOS_FACTURA_ML, VENTANA_NUMEROS } from '@/lib/mercadolibre/reconciliar-emitiendo'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const apply = process.argv.includes('--apply')
const packFiltro = arg('pack')
const liberarPack = arg('liberar')

async function main() {
  const cfg = getArcaConfig()
  const pv = cfg.puntoVenta
  console.log(
    `ARCA ${cfg.env.toUpperCase()} · CUIT ${cfg.cuit} · PV ${String(pv).padStart(4, '0')} · ${apply ? 'APLICA cambios' : 'solo diagnóstico (agregar --apply para aplicar)'}`
  )
  if (liberarPack && !apply) console.log('--liberar no hace nada sin --apply (diagnóstico)')
  console.log(`Busca ${TIPOS_FACTURA_ML.map(describeCbteTipo).join(', ')}: del último autorizado para atrás hasta el día del candado (tope ${VENTANA_NUMEROS} números)`)

  const filas = await prisma.mlOrderInvoice.findMany({
    where: { status: 'EMITIENDO', invoiceId: null, ...(packFiltro ? { packId: packFiltro } : {}) },
    orderBy: { createdAt: 'asc' },
  })
  if (!filas.length) {
    console.log('Nada para reconciliar (no hay ventas en EMITIENDO sin factura).')
    return
  }

  for (const f of filas) {
    const total = f.total === null ? null : Number(f.total)
    console.log(
      `\nVenta ML #${f.packId} · candado del ${f.createdAt.toISOString()} · ${f.cuit ?? 'sin CUIT'} · total ${total ?? '?'} · órdenes ${f.orderIds.join(', ')}`
    )

    // Candado de una factura directa ("Nueva factura") sin resolver (emitiendo,
    // incierta o con CAE y sin Invoice): lo resuelve su propia reconciliación
    // (sabe el número pedido y el documento exacto)
    const directa = await prisma.facturaDirecta.findFirst({
      where: {
        mlPackId: f.packId,
        OR: [{ estado: { in: ['EMITIENDO', 'INCIERTA'] } }, { estado: 'AUTORIZADA', invoiceId: null }],
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, estado: true, invoiceId: true },
    })
    if (directa) {
      console.log(
        `  Es de la factura directa ${directa.id} (${directa.estado}${directa.invoiceId ? `, factura ${directa.invoiceId}` : ''}): ` +
          `resolver con scripts/factura-directa-reconciliar.ts --id ${directa.id}. No se libera desde acá`
      )
      if (liberarPack === f.packId) console.log('  No se libera: el candado es de una factura directa')
      continue
    }

    const r = await escanearArcaParaCandado(
      { packId: f.packId, cuit: f.cuit, total, createdAt: f.createdAt },
      {
        ultimoAutorizado: (tipo) => feCompUltimoAutorizado(tipo, pv),
        consultar: async (tipo, numero) => {
          const c = await feCompConsultar(tipo, numero, pv)
          return c
            ? {
                cbteTipo: tipo,
                numero,
                ImpTotal: c.ImpTotal,
                DocTipo: c.DocTipo,
                DocNro: c.DocNro,
                CbteFch: c.CbteFch,
                CodAutorizacion: c.CodAutorizacion,
                Resultado: c.Resultado,
              }
            : null
        },
      }
    )
    for (const e of r.errores) console.log(`  ARCA ERROR ${e}`)

    if (r.coincidencias.length) {
      for (const c of r.coincidencias) {
        console.log(
          `  ARCA tiene ${describeCbteTipo(c.cbteTipo)} N° ${formatNroComprobante(pv, c.numero)} CAE ${c.CodAutorizacion} para esta venta ` +
            `(total ${c.ImpTotal}, doc ${c.DocTipo} ${c.DocNro}, fecha ${c.CbteFch}): registrarla a mano, NO liberar`
        )
      }
      if (liberarPack === f.packId) console.log('  No se libera: ARCA tiene un comprobante para esta venta')
      continue
    }
    if (r.posibles.length) {
      for (const c of r.posibles) {
        console.log(
          `  POSIBLE: ARCA tiene ${describeCbteTipo(c.cbteTipo)} N° ${formatNroComprobante(pv, c.numero)} CAE ${c.CodAutorizacion} al mismo comprador ` +
            `por otro total (${c.ImpTotal}, fecha ${c.CbteFch}): ¿borrador editado? Revisar a mano, NO liberar`
        )
      }
      if (liberarPack === f.packId) console.log('  No se libera: hay un comprobante al mismo comprador desde el candado')
      continue
    }
    if (r.errores.length) {
      console.log('  No se pudo revisar todo en ARCA: no se concluye nada (volver a correr más tarde). No se libera')
      continue
    }
    if (!candadoComparable({ cuit: f.cuit, total })) {
      console.log(`  El candado no tiene CUIT/CUIL de 11 dígitos (${f.cuit ?? 'sin CUIT'}) o total: no se puede comparar con ARCA. Revisar a mano, no se libera`)
      continue
    }
    console.log(`  ARCA no tiene ningún comprobante a ${f.cuit} (ni a su DNI) desde el candado (${r.revisados} comprobantes revisados)`)

    if (liberarPack !== f.packId) {
      console.log(`  Para liberarla (volver a facturar): --liberar ${f.packId} --apply`)
      continue
    }
    if (!apply) continue
    // Solo si sigue en EMITIENDO sin factura (nadie la registró mientras tanto)
    const borradas = await prisma.mlOrderInvoice.deleteMany({ where: { packId: f.packId, status: 'EMITIENDO', invoiceId: null } })
    if (borradas.count !== 1) {
      console.log('  No se borró nada: el candado cambió mientras tanto. Volver a correr el diagnóstico')
      continue
    }
    console.log(
      `  CANDADO BORRADO: ${JSON.stringify({
        id: f.id,
        packId: f.packId,
        orderIds: f.orderIds,
        cuit: f.cuit,
        total,
        buyerNickname: f.buyerNickname,
        createdAt: f.createdAt.toISOString(),
        createdById: f.createdById,
      })}. La venta se puede volver a facturar desde /mercadolibre/facturacion`
    )
  }
  if (liberarPack && !filas.some((f) => f.packId === liberarPack)) {
    console.log(`\n--liberar ${liberarPack}: esa venta no tiene un candado en EMITIENDO sin factura`)
  }
}

main()
  .catch((e) => {
    console.error('Error:', (e as Error).message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
