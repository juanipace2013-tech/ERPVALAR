import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

import {
  COMISIONES_INICIO,
  calcularComisionLinea,
  getEscala,
  getTipoCambioMes,
  mesHabilitado,
  redondear2,
  tasaParaTotal,
  tcParaOperacion,
  type TipoOperacion,
} from './calculo'

// Estados de CotizacionFactura que NO cuentan para comisiones.
// (Los valores válidos son BORRADOR / ANULADA / ERROR_GUARDADO; una factura
// enviada a Colppy queda en BORRADOR hasta que se anule.)
const ESTADOS_FACTURA_EXCLUIDOS = ['ANULADA', 'ERROR_GUARDADO']

function rangoMes(anio: number, mes: number): { desde: Date; hasta: Date } {
  return { desde: new Date(anio, mes - 1, 1), hasta: new Date(anio, mes, 1) }
}

/** Facturas parciales del vendedor imputadas al mes (por fecha de factura). */
export async function facturasDelMes(vendedorId: string, anio: number, mes: number) {
  const { desde, hasta } = rangoMes(anio, mes)
  return prisma.cotizacionFactura.findMany({
    where: {
      fecha: { gte: desde, lt: hasta },
      estado: { notIn: ESTADOS_FACTURA_EXCLUIDOS },
      cotizacion: { salesPersonId: vendedorId },
    },
    include: {
      cotizacion: {
        select: {
          id: true,
          quoteNumber: true,
          customerId: true,
          customer: { select: { name: true } },
        },
      },
    },
    orderBy: { fecha: 'asc' },
  })
}

// Prefijo del marcador en errorMessage cuando una factura se anula por una NC
// de Colppy detectada automáticamente: "ANULADA_POR_NC:<invoiceId>: NC ...".
const MARCA_ANULADA_POR_NC = 'ANULADA_POR_NC:'

/**
 * Detecta NC totales hechas directo en Colppy y anula la CotizacionFactura
 * correspondiente para que deje de contar en comisiones.
 *
 * Las NC entran al ERP por el sync de facturación (tabla Invoice con
 * transactionType CREDIT_NOTE). Una NC anula una factura del mes si es del
 * mismo cliente, en USD, por el mismo monto (tolerancia 0,5% / mín USD 1 por
 * redondeos de TC) y de fecha igual o posterior. El monto comparable es el
 * subtotal (neto gravado) de la NC: montoUSD de la factura parcial es neto
 * sin IVA, mientras que Invoice.total incluye IVA. Cada NC anula UNA sola
 * factura (queda referenciada en errorMessage).
 *
 * Best-effort: nunca lanza, para no bloquear la sincronización de la
 * liquidación.
 */
async function anularFacturasPorNC(vendedorId: string, anio: number, mes: number) {
  try {
    const { desde, hasta } = rangoMes(anio, mes)
    const facturas = await prisma.cotizacionFactura.findMany({
      where: {
        fecha: { gte: desde, lt: hasta },
        estado: { notIn: ESTADOS_FACTURA_EXCLUIDOS },
        cotizacion: { salesPersonId: vendedorId },
      },
      include: { cotizacion: { select: { customerId: true, quoteNumber: true } } },
    })
    if (facturas.length === 0) return

    const customerIds = [...new Set(facturas.map((f) => f.cotizacion.customerId))]
    const ncs = await prisma.invoice.findMany({
      where: {
        transactionType: 'CREDIT_NOTE',
        customerId: { in: customerIds },
        currency: 'USD',
        status: { not: 'CANCELLED' },
      },
      select: {
        id: true,
        invoiceNumber: true,
        customerId: true,
        subtotal: true,
        total: true,
        issueDate: true,
      },
    })
    if (ncs.length === 0) return

    // NCs que ya anularon otra factura (marcadas en errorMessage)
    const yaUsadas = await prisma.cotizacionFactura.findMany({
      where: { errorMessage: { startsWith: MARCA_ANULADA_POR_NC } },
      select: { errorMessage: true },
    })
    const ncIdsUsados = new Set(
      yaUsadas.map((u) => u.errorMessage?.split(':')[1]).filter(Boolean)
    )

    const UN_DIA_MS = 24 * 60 * 60 * 1000
    for (const factura of facturas) {
      const monto = Number(factura.montoUSD)
      const tolerancia = Math.max(1, monto * 0.005)
      const nc = ncs.find((n) => {
        // Neto de la NC (sin IVA); si el sync no trajo subtotal, cae al total.
        const netoNC = Number(n.subtotal) > 0 ? Number(n.subtotal) : Number(n.total)
        return (
          !ncIdsUsados.has(n.id) &&
          n.customerId === factura.cotizacion.customerId &&
          n.issueDate.getTime() >= factura.fecha.getTime() - UN_DIA_MS &&
          Math.abs(netoNC - monto) <= tolerancia
        )
      })
      if (!nc) continue

      ncIdsUsados.add(nc.id)
      await prisma.cotizacionFactura.update({
        where: { id: factura.id },
        data: {
          estado: 'ANULADA',
          errorMessage: `${MARCA_ANULADA_POR_NC}${nc.id}: NC ${nc.invoiceNumber} de Colppy anula esta factura`,
        },
      })
      logger.info(
        `[COMISIONES_NC] Factura ${factura.numeroFactura} (${factura.cotizacion.quoteNumber}) anulada por NC ${nc.invoiceNumber} de Colppy: no cuenta para comisiones`
      )
    }
  } catch (e) {
    logger.warn('[COMISIONES_NC] Error detectando NC de Colppy (no bloquea la sincronización)', e)
  }
}

/**
 * Crea (si no existe) la liquidación del mes y sincroniza sus líneas con las
 * CotizacionFactura del mes: agrega las facturas nuevas y elimina las líneas
 * cuya factura fue anulada o cambió de mes. Respeta el tipoOperacion elegido
 * a mano en líneas existentes. Solo opera sobre liquidaciones ABIERTAS.
 */
export async function abrirYSincronizar(vendedorId: string, anio: number, mes: number) {
  if (!mesHabilitado(anio, mes)) {
    throw new Error(
      `Las comisiones en el ERP arrancan en ${COMISIONES_INICIO.mes}/${COMISIONES_INICIO.anio}: ` +
        `${mes}/${anio} se liquida en la planilla Excel`
    )
  }

  const config = await prisma.vendedorComisionConfig.findUnique({ where: { vendedorId } })

  const liquidacion = await prisma.comisionLiquidacion.upsert({
    where: { vendedorId_anio_mes: { vendedorId, anio, mes } },
    create: {
      vendedorId,
      anio,
      mes,
      basicoArs: config ? config.basicoArs : 0,
    },
    update: {},
  })

  if (liquidacion.estado === 'CERRADA') return liquidacion

  // NC totales hechas directo en Colppy anulan la factura antes de sincronizar
  await anularFacturasPorNC(vendedorId, anio, mes)

  const [facturas, lineas] = await Promise.all([
    facturasDelMes(vendedorId, anio, mes),
    prisma.comisionLinea.findMany({ where: { liquidacionId: liquidacion.id } }),
  ])

  const facturaIds = new Set(facturas.map((f) => f.id))
  const yaSnapshotteadas = new Set(
    lineas.filter((l) => l.facturaParcialId).map((l) => l.facturaParcialId as string)
  )

  // Líneas con factura de origen que ya no corresponde al mes (anulada/movida).
  const aEliminar = lineas.filter((l) => l.facturaParcialId && !facturaIds.has(l.facturaParcialId))
  if (aEliminar.length > 0) {
    await prisma.comisionLinea.deleteMany({ where: { id: { in: aEliminar.map((l) => l.id) } } })
  }

  const nuevas = facturas.filter((f) => !yaSnapshotteadas.has(f.id))
  if (nuevas.length > 0) {
    await prisma.comisionLinea.createMany({
      data: nuevas.map((f) => ({
        vendedorId,
        liquidacionId: liquidacion.id,
        clienteNombre: f.cotizacion.customer.name,
        presupuesto: f.cotizacion.quoteNumber,
        numeroFactura: f.numeroFactura,
        clienteId: f.cotizacion.customerId,
        cotizacionId: f.cotizacion.id,
        facturaParcialId: f.id,
        importeFacturadoUsd: f.montoUSD,
        anioImputacion: anio,
        mesImputacion: mes,
        estado: 'FACTURADO' as const,
      })),
    })
  }

  // Refrescar montos de líneas existentes por si la factura cambió.
  for (const linea of lineas) {
    if (!linea.facturaParcialId) continue
    const factura = facturas.find((f) => f.id === linea.facturaParcialId)
    if (!factura) continue
    if (
      Number(factura.montoUSD) !== Number(linea.importeFacturadoUsd) ||
      factura.numeroFactura !== linea.numeroFactura
    ) {
      await prisma.comisionLinea.update({
        where: { id: linea.id },
        data: { importeFacturadoUsd: factura.montoUSD, numeroFactura: factura.numeroFactura },
      })
    }
  }

  return recalcular(liquidacion.id)
}

/**
 * Recalcula tramo, comisiones y neto de una liquidación ABIERTA a partir de
 * sus líneas. Sobre una CERRADA no toca nada (valores congelados).
 */
export async function recalcular(liquidacionId: string) {
  const liquidacion = await prisma.comisionLiquidacion.findUniqueOrThrow({
    where: { id: liquidacionId },
    include: { lineas: true, ajustes: true },
  })
  if (liquidacion.estado === 'CERRADA') return liquidacion

  const escala = await getEscala(liquidacion.anio, liquidacion.mes)
  const tc = await getTipoCambioMes(liquidacion.anio, liquidacion.mes)

  const totalUsd = redondear2(
    liquidacion.lineas.reduce((sum, l) => sum + Number(l.importeFacturadoUsd ?? 0), 0)
  )
  const tasaMes = tasaParaTotal(totalUsd, escala)

  let comisionesArs = 0
  for (const linea of liquidacion.lineas) {
    const importe = Number(linea.importeFacturadoUsd ?? 0)
    const tcLinea = tcParaOperacion(tc, linea.tipoOperacion as TipoOperacion)
    const { comisionUsd, comisionArs } = calcularComisionLinea(importe, tasaMes, tcLinea)
    if (comisionArs !== null) comisionesArs += comisionArs
    await prisma.comisionLinea.update({
      where: { id: linea.id },
      data: { tasaAplicada: tasaMes, tipoCambio: tcLinea, comisionUsd, comisionArs },
    })
  }
  comisionesArs = redondear2(comisionesArs)

  const ajustesTotal = liquidacion.ajustes.reduce((sum, a) => sum + Number(a.montoArs), 0)
  const netoArs = redondear2(Number(liquidacion.basicoArs) + comisionesArs + ajustesTotal)

  return prisma.comisionLiquidacion.update({
    where: { id: liquidacionId },
    data: {
      totalFacturadoUsd: totalUsd,
      tasaMes,
      comisionesArs,
      // Si falta el TC del mes el neto queda parcial (solo líneas con TC);
      // cerrar() lo bloquea y la UI lo señala.
      netoArs,
    },
    include: { lineas: true, ajustes: true },
  })
}

/** Cierra la liquidación: recalcula y congela tasa y montos en cada línea. */
export async function cerrar(liquidacionId: string) {
  const liquidacion = await recalcular(liquidacionId)
  if (liquidacion.estado === 'CERRADA') return liquidacion

  const tc = await getTipoCambioMes(liquidacion.anio, liquidacion.mes)
  const sinTc = liquidacion.lineas.some(
    (l) => tcParaOperacion(tc, l.tipoOperacion as TipoOperacion) === null
  )
  if (sinTc) {
    throw new Error(
      `Falta cargar el tipo de cambio de ${liquidacion.mes}/${liquidacion.anio} para cerrar la liquidación`
    )
  }

  await prisma.comisionLinea.updateMany({
    where: { liquidacionId },
    data: { estado: 'LIQUIDADO' },
  })
  return prisma.comisionLiquidacion.update({
    where: { id: liquidacionId },
    data: { estado: 'CERRADA', cerradaEn: new Date() },
    include: { lineas: true, ajustes: true },
  })
}

/** Reabre una liquidación cerrada (vuelve las líneas a FACTURADO). */
export async function reabrir(liquidacionId: string) {
  await prisma.comisionLinea.updateMany({
    where: { liquidacionId },
    data: { estado: 'FACTURADO' },
  })
  return prisma.comisionLiquidacion.update({
    where: { id: liquidacionId },
    data: { estado: 'ABIERTA', cerradaEn: null },
    include: { lineas: true, ajustes: true },
  })
}

/**
 * Impacto automático de la facturación en comisiones. Se llama después de
 * facturar (send-to-colppy / generate-invoice) y después de revertir una
 * facturación: sincroniza la liquidación de cada mes tocado por las facturas
 * de la cotización.
 *
 * - crearLiquidacion true (alta de factura): si el mes no tiene liquidación,
 *   la crea ABIERTA para que la venta impacte apenas se factura.
 * - crearLiquidacion false (reversión): solo toca liquidaciones existentes
 *   (no tiene sentido crear una vacía para sacar una línea que no está).
 * - Un mes CERRADO no se toca nunca: queda logueado para reabrir a mano.
 *
 * NUNCA lanza: la facturación no puede fallar por un problema de comisiones.
 */
export async function sincronizarComisionesDeQuote(
  quoteId: string,
  opts: { crearLiquidacion: boolean }
): Promise<void> {
  try {
    const quote = await prisma.quote.findUnique({
      where: { id: quoteId },
      select: {
        quoteNumber: true,
        salesPersonId: true,
        // Todas las facturas (incluidas anuladas) para cubrir también la
        // limpieza de meses donde la factura dejó de contar.
        facturas: { select: { fecha: true } },
      },
    })
    if (!quote) return

    const meses = new Map<string, { anio: number; mes: number }>()
    for (const f of quote.facturas) {
      const anio = f.fecha.getFullYear()
      const mes = f.fecha.getMonth() + 1
      meses.set(`${anio}-${mes}`, { anio, mes })
    }

    for (const { anio, mes } of meses.values()) {
      // Antes del arranque del módulo la liquidación vive en el Excel.
      if (!mesHabilitado(anio, mes)) continue
      const existente = await prisma.comisionLiquidacion.findUnique({
        where: { vendedorId_anio_mes: { vendedorId: quote.salesPersonId, anio, mes } },
        select: { estado: true },
      })
      if (!existente && !opts.crearLiquidacion) continue
      if (existente?.estado === 'CERRADA') {
        logger.warn(
          `[COMISIONES_SYNC] Liquidación ${mes}/${anio} CERRADA: la facturación de ${quote.quoteNumber} no impacta hasta reabrirla`
        )
        continue
      }
      await abrirYSincronizar(quote.salesPersonId, anio, mes)
    }
  } catch (e) {
    logger.warn('[COMISIONES_SYNC] Error sincronizando comisiones (no bloquea la facturación)', e)
  }
}

/**
 * Pipeline "cerrado" del vendedor: cotizaciones aprobadas (ACCEPTED /
 * FACTURADA_PARCIAL) con saldo sin facturar. Solo USD — es forecast, no se
 * paga y no empuja el tramo de la escala.
 */
export async function pipelineCerrado(vendedorId: string) {
  const quotes = await prisma.quote.findMany({
    where: {
      salesPersonId: vendedorId,
      status: { in: ['ACCEPTED', 'FACTURADA_PARCIAL'] },
    },
    select: {
      id: true,
      quoteNumber: true,
      total: true,
      date: true,
      customer: { select: { name: true } },
      facturas: {
        where: { estado: { notIn: ESTADOS_FACTURA_EXCLUIDOS } },
        select: { montoUSD: true },
      },
    },
    orderBy: { date: 'desc' },
  })

  const items = quotes
    .map((q) => {
      const facturado = q.facturas.reduce((sum, f) => sum + Number(f.montoUSD), 0)
      const saldo = redondear2(Number(q.total) - facturado)
      return {
        quoteId: q.id,
        quoteNumber: q.quoteNumber,
        cliente: q.customer.name,
        fecha: q.date,
        totalUsd: Number(q.total),
        facturadoUsd: redondear2(facturado),
        saldoUsd: saldo,
      }
    })
    .filter((i) => i.saldoUsd > 0)

  // Saldos migrados de la planilla (ventas pre-ERP sin cotización en el sistema)
  const lineasPlanilla = await prisma.comisionLinea.findMany({
    where: { vendedorId, estado: 'CERRADO', cotizacionId: null },
  })
  const itemsPlanilla = lineasPlanilla
    .map((l) => ({
      quoteId: null as string | null,
      quoteNumber: l.presupuesto,
      cliente: l.clienteNombre,
      fecha: l.createdAt,
      totalUsd: Number(l.importeCerradoUsd ?? 0),
      facturadoUsd: Number(l.importeFacturadoUsd ?? 0),
      saldoUsd: redondear2(Number(l.importeCerradoUsd ?? 0) - Number(l.importeFacturadoUsd ?? 0)),
    }))
    .filter((i) => i.saldoUsd > 0)

  const todos = [...items, ...itemsPlanilla]
  return {
    items: todos,
    pipelineUsd: redondear2(todos.reduce((sum, i) => sum + i.saldoUsd, 0)),
  }
}

/**
 * Resumen provisorio del mes para el dashboard: si existe la liquidación usa
 * sus líneas; si no, calcula on-the-fly desde las facturas del mes (sin
 * persistir nada).
 */
export async function resumenMes(vendedorId: string, anio: number, mes: number) {
  const escala = await getEscala(anio, mes)
  const tc = await getTipoCambioMes(anio, mes)

  const liquidacion = await prisma.comisionLiquidacion.findUnique({
    where: { vendedorId_anio_mes: { vendedorId, anio, mes } },
    include: { lineas: true, ajustes: true },
  })

  if (liquidacion) {
    return {
      liquidacionId: liquidacion.id,
      estado: liquidacion.estado,
      totalFacturadoUsd: Number(liquidacion.totalFacturadoUsd),
      tasaMes: liquidacion.tasaMes === null ? null : Number(liquidacion.tasaMes),
      comisionesArs: Number(liquidacion.comisionesArs),
      cantidadFacturas: liquidacion.lineas.length,
      tcCargado: tc.billete !== null,
    }
  }

  const facturas = await facturasDelMes(vendedorId, anio, mes)
  const totalUsd = redondear2(facturas.reduce((sum, f) => sum + Number(f.montoUSD), 0))
  const tasaMes = tasaParaTotal(totalUsd, escala)
  let comisionesArs = 0
  for (const f of facturas) {
    // Sin liquidación abierta no hay tipoOperacion elegido: se asume BILLETE.
    const { comisionArs } = calcularComisionLinea(Number(f.montoUSD), tasaMes, tc.billete)
    if (comisionArs !== null) comisionesArs += comisionArs
  }

  return {
    liquidacionId: null as string | null,
    estado: null as string | null,
    totalFacturadoUsd: totalUsd,
    tasaMes,
    comisionesArs: redondear2(comisionesArs),
    cantidadFacturas: facturas.length,
    tcCargado: tc.billete !== null,
  }
}
