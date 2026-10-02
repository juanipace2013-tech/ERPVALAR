/**
 * Reconciliación de comprobantes de exportación (WSFEX) sin resolver: filas
 * FacturaExportacion PENDIENTE o INCIERTA (ARCA no respondió y el resultado
 * no se pudo confirmar) y AUTORIZADAS sin Invoice ("huérfanas": hubo CAE pero
 * el ERP no pudo guardar la factura). Mientras haya una PENDIENTE/INCIERTA no
 * se puede emitir otra Factura E.
 *
 *   npx tsx scripts/arca-fex-reconciliar.ts
 *       Diagnóstico. SOLO LECTURA: DB + FEXGetLast_CMP / FEXGetCMP.
 *   npx tsx scripts/arca-fex-reconciliar.ts --apply
 *       Aplica lo que se concluye SIN reenviar nada a ARCA:
 *        - PENDIENTE/INCIERTA que ARCA tiene autorizada igual a lo enviado
 *          (FEXGetCMP: Id, total, fecha, receptor) → AUTORIZADA (recuperada) + Invoice.
 *        - AUTORIZADA sin Invoice → crea la Invoice, la CotizacionFactura y
 *          el avance de la cotización (registrarInvoiceExportacion).
 *   npx tsx scripts/arca-fex-reconciliar.ts --reenviar <fexId> --apply
 *       Para una PENDIENTE/INCIERTA que ARCA NO tiene: reenvía a FEXAuthorize
 *       el MISMO cuerpo <Cmp> guardado (mismo Id, mismo número). Si ARCA ya lo
 *       había procesado devuelve el mismo CAE (Reproceso 'S'). 'A' → AUTORIZADA
 *       + Invoice; 'R' confirmado con FEXGetCMP → RECHAZADA (libera el número).
 *       Nunca arma un Cmp nuevo ni usa otro Id. Es la ÚNICA opción del script
 *       que puede crear un comprobante en ARCA.
 *   npx tsx scripts/arca-fex-reconciliar.ts --descartar <fexId> --apply
 *       Para una PENDIENTE/INCIERTA que ARCA NO tiene y que no se puede
 *       reenviar (ej. ARCA responde Fault siempre): la marca RECHAZADA y libera
 *       el número, solo si FEXGetCMP no la encuentra y FEXGetLast_CMP es el
 *       número anterior. Correrlo después de esperar un rato, no en caliente.
 *   --id <fexId>   limita el diagnóstico/aplicación a esa fila.
 *
 * Siempre controla además que el último número de ARCA coincida con el último
 * AUTORIZADO del ERP (en prod el PV de exportación es solo del ERP).
 *
 * Requiere ARCA_* y DATABASE_URL del ambiente donde se emitió (en prod: el VPS).
 */
import 'dotenv/config'
import { prisma } from '@/lib/prisma'
import { getArcaConfig } from '@/lib/arca/config'
import { ESTADO_FEX, coincideConEnviado, numeroInternoExportacion } from '@/lib/arca/emitir-exportacion'
import {
  FEX_ERR_TRANSITORIOS,
  FexFaultError,
  fechaDesdeYmd,
  fexAuthorize,
  fexGetCmp,
  fexGetLastCmp,
  formatFexErrores,
  type FexCmp,
  type FexCmpConsultado,
} from '@/lib/arca/wsfex'
import {
  persistenciaFacturaExportacion,
  registrarInvoiceExportacion,
  type LineaExportacion,
} from '@/lib/facturacion/factura-exportacion'
import { sincronizarComisionesDeQuote } from '@/lib/comisiones/liquidacion'
import { archivarFacturaEnSharePoint } from '@/lib/sharepoint/facturas-emitidas'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const apply = process.argv.includes('--apply')
const idFiltro = arg('id')
const reenviarId = arg('reenviar')
const descartarId = arg('descartar')

/** Números que ARCA tiene autorizados y el ERP no (por tipo, en el PV de exportación) */
async function controlarNumeracion(pv: number) {
  for (const tipo of [19, 20, 21]) {
    let ultimo: number
    try {
      ultimo = await fexGetLastCmp(tipo, pv)
    } catch (e) {
      console.log(`Numeración tipo ${tipo}: FEXGetLast_CMP ERROR ${(e as Error).message}`)
      continue
    }
    const r = await prisma.facturaExportacion.aggregate({
      where: { puntoVenta: pv, cbteTipo: tipo, estado: ESTADO_FEX.AUTORIZADA },
      _max: { cbteNumero: true },
    })
    const local = r._max.cbteNumero ?? 0
    if (ultimo === local) continue
    console.log(`
Numeración tipo ${tipo} PV ${pv}: ARCA tiene hasta el ${ultimo} y el ERP AUTORIZADAS hasta el ${local}`)
    for (let n = local + 1; n <= ultimo; n++) {
      const { c, error } = await consultar(tipo, pv, n)
      const filas = await prisma.facturaExportacion.findMany({
        where: { puntoVenta: pv, cbteTipo: tipo, cbteNumero: n },
        select: { fexId: true, estado: true, request: true },
      })
      const coincide = c ? filas.find((f) => coincideConEnviado(c, f.request as unknown as FexCmp)) : undefined
      console.log(
        `  N° ${n}: ${error ? `FEXGetCMP ERROR ${error}` : c ? `ARCA Id ${c.Id} CAE ${c.Cae} total ${c.Imp_total}` : 'ARCA no lo encuentra'} · ` +
          (filas.length ? filas.map((f) => `ERP Id ${f.fexId} ${f.estado}`).join(', ') : 'sin fila en el ERP') +
          (coincide ? ` → coincide con la fila Id ${coincide.fexId}: revisar a mano (marcarla AUTORIZADA y registrarla)` : '')
      )
    }
  }
}

async function consultar(tipo: number, pv: number, nro: number): Promise<{ c: FexCmpConsultado | null; error: string | null }> {
  try {
    return { c: await fexGetCmp(tipo, pv, nro), error: null }
  } catch (e) {
    return { c: null, error: (e as Error).message }
  }
}

/** Crea la Invoice de una fila AUTORIZADA + comisiones y SharePoint */
async function registrar(fexId: number, quoteId: string | null) {
  const r = await registrarInvoiceExportacion(fexId)
  console.log(`  Invoice ${r.creada ? 'CREADA' : 'ya existía'}: ${r.numeroInterno} (${r.invoiceId})`)
  if (!r.creada) return
  if (quoteId) {
    await sincronizarComisionesDeQuote(quoteId, { crearLiquidacion: true })
    console.log('  Comisiones de la cotización sincronizadas')
  }
  const a = await archivarFacturaEnSharePoint(r.invoiceId)
  console.log(`  SharePoint: ${a.ok ? a.path : `no archivada (${a.error})`}`)
}

async function main() {
  const cfg = getArcaConfig()
  console.log(
    `ARCA ${cfg.env.toUpperCase()} · CUIT ${cfg.cuit} · ${apply ? 'APLICA cambios' : 'solo diagnóstico (agregar --apply para aplicar)'}`
  )
  if ((reenviarId || descartarId) && !apply) console.log('--reenviar / --descartar no hacen nada sin --apply (diagnóstico)')
  if (cfg.puntoVentaExportacion) await controlarNumeracion(cfg.puntoVentaExportacion)

  const filas = await prisma.facturaExportacion.findMany({
    where: {
      ...(idFiltro ? { fexId: BigInt(idFiltro) } : {}),
      OR: [
        { estado: { in: [ESTADO_FEX.PENDIENTE, ESTADO_FEX.INCIERTA] } },
        { estado: ESTADO_FEX.AUTORIZADA, invoiceId: null },
      ],
    },
    orderBy: { fexId: 'asc' },
  })
  if (!filas.length) {
    console.log('Nada para reconciliar.')
    return
  }

  for (const f of filas) {
    const fexId = Number(f.fexId)
    const numero = numeroInternoExportacion(f.cbteTipo, f.puntoVenta, f.cbteNumero)
    console.log(`\n${numero} · Id ${fexId} · ${f.estado} · ${f.createdAt.toISOString()} · total USD ${f.totalUSD}`)
    if (f.errores) console.log(`  Último error: ${f.errores}`)

    if (f.estado === ESTADO_FEX.AUTORIZADA) {
      console.log(`  AUTORIZADA (CAE ${f.cae}) sin Invoice en el ERP (huérfana)`)
      if (apply) await registrar(fexId, f.quoteId)
      continue
    }

    const cmp = f.request as unknown as FexCmp
    const persistencia = persistenciaFacturaExportacion({
      quoteId: f.quoteId,
      customerId: f.customerId,
      userId: f.createdById,
      lineas: f.lineas as unknown as LineaExportacion[],
    })

    let ultimo: number | null = null
    try {
      ultimo = await fexGetLastCmp(f.cbteTipo, f.puntoVenta)
    } catch (e) {
      console.log(`  FEXGetLast_CMP: ERROR ${(e as Error).message}`)
    }
    const { c, error } = await consultar(f.cbteTipo, f.puntoVenta, f.cbteNumero)
    if (error) {
      console.log(`  FEXGetCMP: ERROR ${error} (sin poder consultar no se concluye nada)`)
      continue
    }

    if (c && coincideConEnviado(c, cmp)) {
      console.log(`  ARCA lo tiene AUTORIZADO igual a lo enviado: CAE ${c.Cae}, vto ${c.Fch_venc_Cae}`)
      if (apply) {
        await persistencia.marcarAutorizada(fexId, {
          cae: c.Cae,
          caeVencimiento: fechaDesdeYmd(c.Fch_venc_Cae),
          fechaCbte: c.Fecha_cbte,
          reproceso: false,
          recuperado: true,
          motivosObs: c.Motivos_Obs || null,
          response: c.raw,
        })
        console.log('  Marcada AUTORIZADA (recuperada)')
        await registrar(fexId, f.quoteId)
      }
      continue
    }
    if (c) {
      console.log(
        `  El N° ya existe en ARCA pero NO coincide con lo enviado (Id ${c.Id}, total ${c.Imp_total}, fecha ${c.Fecha_cbte}, ` +
          `receptor ${c.Id_impositivo || c.Cuit_pais_cliente}): revisar a mano, no se toca`
      )
      continue
    }

    console.log(`  ARCA no tiene el N° ${numero} (último autorizado: ${ultimo ?? 'desconocido'})`)
    if (descartarId !== undefined && Number(descartarId) === fexId) {
      if (!apply) continue
      if (ultimo === null || ultimo !== f.cbteNumero - 1) {
        console.log(`  No se descarta: el último número en ARCA es ${ultimo ?? '?'} y esta fila tiene el ${f.cbteNumero}. Revisar a mano`)
        continue
      }
      const mensaje = `Descartada a mano con arca-fex-reconciliar: ARCA no la tiene (FEXGetCMP) y su último N° es ${ultimo}. Antes: ${f.errores ?? f.estado}`
      await persistencia.marcarRechazada(fexId, { errores: [], mensaje, response: null })
      console.log('  DESCARTADA (RECHAZADA): el número queda libre para la próxima emisión')
      continue
    }
    if (reenviarId === undefined || Number(reenviarId) !== fexId) {
      console.log(`  Para resolverlo: reenviar el MISMO Id con --reenviar ${fexId} --apply (o, si ARCA lo rechaza siempre con un Fault, --descartar ${fexId} --apply)`)
      continue
    }
    if (!apply) continue
    if (ultimo === null || ultimo !== f.cbteNumero - 1) {
      console.log(`  No se reenvía: el próximo número en ARCA es ${ultimo === null ? '?' : ultimo + 1} y esta fila tiene el ${f.cbteNumero}. Revisar a mano`)
      continue
    }

    console.log(`  Reenviando el MISMO <Cmp> (Id ${fexId}) a FEXAuthorize...`)
    let r
    try {
      r = await fexAuthorize(f.cmpXml)
    } catch (e) {
      console.log(
        e instanceof FexFaultError
          ? `  ARCA respondió con un Fault: ${e.message}. Sigue ${f.estado}; si se repite y ARCA no lo tiene, --descartar ${fexId} --apply`
          : `  FEXAuthorize sin respuesta: ${(e as Error).message}. Sigue ${f.estado}; volver a correr más tarde`
      )
      continue
    }
    if (r.Resultado === 'A' && r.Cae && (!r.Id || r.Id === fexId) && (!r.Cbte_nro || r.Cbte_nro === f.cbteNumero)) {
      console.log(`  AUTORIZADA: CAE ${r.Cae}${r.Reproceso ? ' (reproceso: ya estaba procesada)' : ''}`)
      await persistencia.marcarAutorizada(fexId, {
        cae: r.Cae,
        caeVencimiento: fechaDesdeYmd(r.Fch_venc_Cae),
        fechaCbte: r.Fch_cbte || cmp.Fecha_cbte,
        reproceso: r.Reproceso,
        recuperado: true,
        motivosObs: r.Motivos_Obs || null,
        response: r.raw,
      })
      await registrar(fexId, f.quoteId)
      continue
    }
    const transitorio = r.errores.some((e) => FEX_ERR_TRANSITORIOS.has(e.Code))
    if (!transitorio && (r.Resultado === 'R' || r.errores.length)) {
      // Confirmar que no quedó autorizado antes de liberar el número
      const otra = await consultar(f.cbteTipo, f.puntoVenta, f.cbteNumero)
      if (otra.error || otra.c) {
        console.log(`  Rechazo de ARCA (${formatFexErrores(r.errores)}) pero FEXGetCMP ${otra.error ? `falló (${otra.error})` : 'ahora lo encuentra'}: revisar a mano`)
        continue
      }
      const mensaje = formatFexErrores(r.errores) || r.Motivos_Obs || 'ARCA rechazó el comprobante sin detalle'
      await persistencia.marcarRechazada(fexId, { errores: r.errores, mensaje, response: r.raw })
      console.log(`  RECHAZADA: ${mensaje}. El número queda libre para la próxima emisión`)
      continue
    }
    console.log(`  Respuesta sin resultado claro (${formatFexErrores(r.errores) || `Resultado '${r.Resultado}'`}): sigue ${f.estado}`)
  }
}

main()
  .catch((e) => {
    console.error('Error:', (e as Error).message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
