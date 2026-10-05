/**
 * Facturas directas ("Nueva factura") para resolver. NUNCA vuelve a emitir.
 *
 *  - INCIERTA: se pidió el CAE y ARCA no lo confirmó ([DIRECTA_ARCA_INCIERTO]).
 *  - TRABADA: quedó EMITIENDO (el proceso se cortó en medio de la emisión).
 *    Qué se consulta y cuándo se concluye está en
 *    src/lib/facturacion/factura-directa-reconciliacion.ts:
 *      · con el número del intento (incierta): SOLO ese número. ARCA no llegó
 *        a él, o es de otro receptor / total, o ya es otra factura del ERP →
 *        DESCARTADA; mismo receptor y total → AUTORIZADA con su CAE;
 *      · sin número (trabada): se busca para atrás desde el día de la factura
 *        el comprobante con el MISMO receptor y el MISMO total, sin contar los
 *        que ya son otra factura del ERP. Uno solo → AUTORIZADA; ninguno y
 *        ARCA respondió todo → DESCARTADA;
 *      · varios, uno "posible" (consumidor final sin identificar) o errores
 *        de ARCA → no se concluye nada: revisar a mano.
 *    DESCARTADA: la clave se puede reusar y, si había venta de ML vinculada,
 *    se libera su candado SOLO si es el que tomó esta fila (candadoEsDeLaFila).
 *  - HUÉRFANA: AUTORIZADA (tiene CAE) sin Invoice ([DIRECTA_ORPHAN]): se
 *    registra la Invoice con crearInvoiceDirecta (la misma que usa la ruta).
 *
 * AUTORIZADA + Invoice van en una sola transacción: si crearInvoiceDirecta se
 * niega (el comprobante ya es otra factura del ERP), la fila queda como
 * estaba. Un error en una fila no corta las demás.
 *
 * Después de registrar una Invoice (con --apply) hace lo mismo que la ruta:
 * PDF a SharePoint, PDF a la venta de ML (si hay y el candado es de esta
 * factura) y alta en Colppy (si FACTURACION_REGISTRAR_COLPPY no es false).
 *
 *   npx tsx scripts/factura-directa-reconciliar.ts              diagnóstico (solo lectura: DB + consultas a ARCA)
 *   npx tsx scripts/factura-directa-reconciliar.ts --apply      aplica
 *   --id <facturaDirectaId>                                     limita a esa fila
 *
 * Requiere ARCA_* y DATABASE_URL del ambiente donde se emitió (en prod: el VPS).
 */
import 'dotenv/config'
import type { FacturaDirecta } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getArcaConfig } from '@/lib/arca/config'
import { buildQrUrl, feCompConsultar, feCompUltimoAutorizado, formatNroComprobante } from '@/lib/arca/wsfe'
import { describeCbteTipo } from '@/lib/arca/emitir'
import type { ComprobanteArca } from '@/lib/mercadolibre/reconciliar-emitiendo'
import { subirFacturaAMl } from '@/lib/mercadolibre/facturacion'
import { archivarFacturaEnSharePoint } from '@/lib/sharepoint/facturas-emitidas'
import type { IntentoEmisionArca } from '@/lib/facturacion/emision-arca'
import { fechaDesdeYmd } from '@/lib/facturacion/factura-directa-form'
import { candadoEsDeLaFila, decidirReconciliacionDirecta } from '@/lib/facturacion/factura-directa-reconciliacion'
import {
  EMITIENDO_TRABADA_MS,
  ESTADO_DIRECTA,
  colppyHabilitado,
  crearInvoiceDirecta,
  pedidoGuardado,
  registrarFacturaDirectaEnColppy,
} from '@/lib/facturacion/factura-directa'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const apply = process.argv.includes('--apply')
const idFiltro = arg('id')

/** yyyymmdd → YYYY-MM-DD */
const ymdDeCbteFch = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`

/** Lo que hace la ruta después de registrar la Invoice */
async function completar(invoiceId: string, mlPackId: string | null, avisoMl: string | undefined) {
  const sp = await archivarFacturaEnSharePoint(invoiceId)
  console.log(`  SharePoint: ${JSON.stringify(sp)}`)
  if (mlPackId && avisoMl) {
    console.log(`  PDF a ML (venta ${mlPackId}): NO se sube (el candado no es de esta factura)`)
  } else if (mlPackId) {
    const ml = await subirFacturaAMl(mlPackId)
    console.log(`  PDF a ML (venta ${mlPackId}): ${ml.ok ? 'OK' : `ERROR ${ml.error}`}`)
  }
  if (colppyHabilitado()) {
    const c = await registrarFacturaDirectaEnColppy(invoiceId)
    console.log(`  Colppy: ${c.estado}${c.colppyId ? ` (${c.colppyId})` : ''}${c.error ? ` - ${c.error}` : ''}`)
  } else {
    console.log('  Colppy: NO_APLICA (FACTURACION_REGISTRAR_COLPPY=false)')
  }
}

const describir = (c: ComprobanteArca, pv: number) =>
  `${describeCbteTipo(c.cbteTipo)} N° ${formatNroComprobante(pv, c.numero)} CAE ${c.CodAutorizacion} (total ${c.ImpTotal}, doc ${c.DocTipo} ${c.DocNro}, fecha ${c.CbteFch})`

async function reconciliar(f: FacturaDirecta & { customer: { name: string } }, pv: number, cuitEmisor: string) {
  const p = pedidoGuardado(f)
  const total = Number(f.total)
  console.log(
    `\nFactura directa ${f.id} · ${f.estado} · ${f.customer.name} · Factura ${f.letra} ${f.currency} ${total} · ` +
      `receptor ${f.docTipo ?? '?'} ${f.docNro ?? '?'} · del ${p.fechaFactura} · clave ${f.idempotencyKey}${f.mlPackId ? ` · venta ML #${f.mlPackId}` : ''}`
  )

  // Huérfana: tiene CAE, falta la Invoice
  if (f.estado === ESTADO_DIRECTA.AUTORIZADA) {
    console.log(`  Emitida en ARCA: ${describeCbteTipo(f.cbteTipo ?? 0)} N° ${formatNroComprobante(f.puntoVenta ?? pv, f.cbteNumero ?? 0)} CAE ${f.cae}. Falta la Invoice del ERP.`)
    if (!apply) return
    const r = await prisma.$transaction((tx) => crearInvoiceDirecta(tx, f))
    console.log(`  INVOICE ${r.creada ? 'REGISTRADA' : 'YA EXISTÍA (vinculada)'}: ${r.invoiceNumber} (${r.invoiceId})`)
    if (r.avisoMl) console.log(`  OJO ML: ${r.avisoMl}`)
    if (r.creada) await completar(r.invoiceId, f.mlPackId, r.avisoMl)
    return
  }

  // Incierta o trabada: ¿ARCA emitió el comprobante que pidió esta fila?
  const intento = f.intento as unknown as IntentoEmisionArca | null
  const decision = await decidirReconciliacionDirecta(
    {
      id: f.id,
      letra: f.letra,
      docTipo: f.docTipo,
      docNro: f.docNro,
      total,
      fechaFactura: p.fechaFactura,
      intento: intento ? { cbteTipo: intento.cbteTipo, numero: intento.numero ?? null } : null,
    },
    {
      ultimoAutorizado: (tipo) => feCompUltimoAutorizado(tipo, pv),
      consultar: async (tipo, numero) => {
        const c = await feCompConsultar(tipo, numero, pv)
        return c
          ? { cbteTipo: tipo, numero, ImpTotal: c.ImpTotal, DocTipo: c.DocTipo, DocNro: c.DocNro, CbteFch: c.CbteFch, CodAutorizacion: c.CodAutorizacion, Resultado: c.Resultado }
          : null
      },
      invoiceDelComprobante: async (tipo, numero) => {
        const inv = await prisma.invoice.findFirst({
          where: { pointOfSale: pv, cbteTipo: tipo, cbteNumero: numero },
          select: { id: true, invoiceNumber: true, facturaDirecta: { select: { id: true } } },
        })
        return inv ? { id: inv.id, invoiceNumber: inv.invoiceNumber, facturaDirectaId: inv.facturaDirecta?.id ?? null } : null
      },
    }
  )
  const numeroIntento = intento?.numero ? `Intento: ${describeCbteTipo(intento.cbteTipo)} N° ${formatNroComprobante(pv, intento.numero)}. ` : 'Sin número de intento: se busca en ARCA. '
  console.log(`  ${numeroIntento}${decision.detalle}`)

  if (decision.accion === 'revisar') {
    for (const e of decision.errores) console.log(`  ARCA ERROR ${e}`)
    for (const c of decision.candidatos) console.log(`  CANDIDATO: ${describir(c, pv)}`)
    console.log('  No se cambia nada: revisar a mano')
    return
  }

  if (decision.accion === 'autorizar') {
    const c = decision.comprobante
    console.log(`  ARCA TIENE ${describir(c, pv)} para esta factura`)
    if (!apply) {
      console.log('  Con --apply queda AUTORIZADA con ese CAE y se registra la Invoice')
      return
    }
    const det = await feCompConsultar(c.cbteTipo, c.numero, pv)
    if (!det) {
      console.log('  ARCA no devolvió el detalle del comprobante: volver a correr')
      return
    }
    const qrUrl = buildQrUrl({
      fecha: fechaDesdeYmd(ymdDeCbteFch(c.CbteFch)), // 12:00 locales: el QR (en UTC) da el mismo día
      cuit: cuitEmisor,
      ptoVta: pv,
      tipoCmp: c.cbteTipo,
      nroCmp: c.numero,
      importe: c.ImpTotal,
      moneda: det.MonId || (f.currency === 'USD' ? 'DOL' : 'PES'),
      ctz: det.MonCotiz || 1,
      tipoDocRec: c.DocTipo,
      nroDocRec: c.DocNro,
      codAut: c.CodAutorizacion,
    })
    // AUTORIZADA + Invoice juntas: si crearInvoiceDirecta se niega, la fila queda como estaba
    const r = await prisma.$transaction(async (tx) => {
      const marcadas = await tx.facturaDirecta.updateMany({
        where: { id: f.id, estado: { in: [ESTADO_DIRECTA.INCIERTA, ESTADO_DIRECTA.EMITIENDO] }, invoiceId: null },
        data: {
          estado: ESTADO_DIRECTA.AUTORIZADA,
          puntoVenta: pv,
          cbteTipo: c.cbteTipo,
          cbteNumero: c.numero,
          cae: c.CodAutorizacion,
          caeVencimiento: fechaDesdeYmd(ymdDeCbteFch(det.FchVto)),
          docTipo: c.DocTipo,
          docNro: String(c.DocNro),
          qrUrl,
          fceVtoPago: c.cbteTipo >= 201 ? fechaDesdeYmd(p.fechaVto) : null,
          error: null,
        },
      })
      if (marcadas.count !== 1) return null
      const fila = await tx.facturaDirecta.findUniqueOrThrow({ where: { id: f.id } })
      return crearInvoiceDirecta(tx, fila)
    })
    if (!r) {
      console.log('  La fila cambió mientras tanto: volver a correr el diagnóstico')
      return
    }
    console.log(`  AUTORIZADA e INVOICE ${r.creada ? 'REGISTRADA' : 'YA EXISTÍA (vinculada)'}: ${r.invoiceNumber} (${r.invoiceId})`)
    if (r.avisoMl) console.log(`  OJO ML: ${r.avisoMl}`)
    if (r.creada) await completar(r.invoiceId, f.mlPackId, r.avisoMl)
    return
  }

  // ARCA no emitió esta factura
  if (!apply) {
    console.log('  Con --apply queda DESCARTADA (se puede volver a emitir) y se libera la venta de ML si el candado es de esta factura')
    return
  }
  const res = await prisma.$transaction(async (tx) => {
    const descartadas = await tx.facturaDirecta.updateMany({
      where: { id: f.id, estado: { in: [ESTADO_DIRECTA.INCIERTA, ESTADO_DIRECTA.EMITIENDO] }, invoiceId: null },
      data: { estado: ESTADO_DIRECTA.DESCARTADA, error: `Descartada por reconciliación: ${decision.detalle}`.slice(0, 4000) },
    })
    if (descartadas.count !== 1) return null
    if (!f.mlPackId) return { candado: 'sin venta de ML' }
    const candado = await tx.mlOrderInvoice.findUnique({ where: { packId: f.mlPackId } })
    if (!candado) return { candado: 'no estaba (no se tocó)' }
    if (!candadoEsDeLaFila(candado, f)) {
      return {
        candado: `es de otra emisión (${candado.status}, factura ${candado.invoiceId ?? '-'}, ${candado.cuit ?? 'sin doc'}, total ${candado.total ?? '?'}, del ${candado.createdAt.toISOString()}): no se tocó`,
      }
    }
    // Solo ESE candado (mismo createdAt) y si sigue EMITIENDO sin factura
    const liberados = await tx.mlOrderInvoice.deleteMany({ where: { packId: f.mlPackId, status: 'EMITIENDO', invoiceId: null, createdAt: candado.createdAt } })
    return { candado: liberados.count ? 'liberado' : 'cambió mientras tanto (no se tocó)' }
  })
  if (!res) {
    console.log('  La fila cambió mientras tanto: volver a correr el diagnóstico')
    return
  }
  console.log('  DESCARTADA')
  if (f.mlPackId) console.log(`  Candado de la venta ML #${f.mlPackId}: ${res.candado}`)
}

async function main() {
  const cfg = getArcaConfig()
  const pv = cfg.puntoVenta
  console.log(
    `ARCA ${cfg.env.toUpperCase()} · CUIT ${cfg.cuit} · PV ${String(pv).padStart(4, '0')} · ${apply ? 'APLICA cambios' : 'solo diagnóstico (agregar --apply para aplicar)'}`
  )

  const trabadaAntes = new Date(Date.now() - EMITIENDO_TRABADA_MS)
  const filas = await prisma.facturaDirecta.findMany({
    where: {
      ...(idFiltro ? { id: idFiltro } : {}),
      OR: [
        { estado: ESTADO_DIRECTA.INCIERTA },
        { estado: ESTADO_DIRECTA.AUTORIZADA, invoiceId: null },
        { estado: ESTADO_DIRECTA.EMITIENDO, updatedAt: { lt: trabadaAntes } },
      ],
    },
    include: { customer: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  })
  if (!filas.length) {
    console.log('Nada para reconciliar (no hay facturas directas inciertas, trabadas ni huérfanas).')
    return
  }

  let conError = 0
  for (const f of filas) {
    // Una fila con problemas no corta las demás
    try {
      await reconciliar(f, pv, cfg.cuit)
    } catch (e) {
      conError++
      console.log(`  ERROR: ${(e as Error).message}. Revisar esta fila a mano (lo que iba en una transacción no se aplicó)`)
    }
  }
  if (conError) {
    console.log(`\n${conError} fila(s) con error: revisar a mano`)
    process.exitCode = 1
  }
}

main()
  .catch((e) => {
    console.error('Error:', (e as Error).message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
