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
import {
  MARCA_ANULADA_POR_NC,
  MARCA_NC_COLPPY,
  buscarRefactura,
  leerMarcaNC,
  mismoImporte,
  mismoNumeroComprobante,
  netoComprobante,
} from './nc-colppy'

// Estados de CotizacionFactura que NO cuentan para comisiones.
// (Valores: BORRADOR (Colppy), EMITIDA (ARCA), NOTA_CREDITO (devolución por
// unidades: montos NEGATIVOS, restan en el mes de la NC), ANULADA,
// ERROR_GUARDADO.)
const ESTADOS_FACTURA_EXCLUIDOS = ['ANULADA', 'ERROR_GUARDADO']

/**
 * Prefijo en errorMessage de la fila NOTA_CREDITO de una devolución cuyas
 * unidades NO vuelven a pendiente (el cliente ya no las quiere): resta en
 * comisiones pero no es saldo a facturar en el pipeline.
 */
export const MARCA_NC_SIN_PENDIENTE = 'SIN_PENDIENTE:'

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

// Ventana hacia atrás para cruzar una NC de Colppy contra facturas de meses
// anteriores (evita matchear por coincidencia de importe con ventas viejas).
const MESES_ATRAS_NC = 12

const UN_DIA_MS = 24 * 60 * 60 * 1000

/**
 * Filtro de facturas que una NC de Colppy puede descontar: no anulada ni con
 * NC emitida por el ERP (esa NC ya impactó: fila negativa / ANULADA).
 * (Filtro positivo: un NOT sobre la relación opcional excluiría en SQL las
 * filas sin factura vinculada, que son las de Colppy.)
 */
const FILTRO_FACTURA_SIN_NC_ERP = {
  OR: [
    { invoiceId: null },
    {
      invoice: {
        is: {
          status: { not: 'CANCELLED' as const },
          relatedInvoices: { none: { transactionType: 'CREDIT_NOTE' as const, status: { not: 'CANCELLED' as const } } },
        },
      },
    },
  ],
}

/**
 * NC de Colppy en USD de esos clientes. Las NC emitidas por el ERP (ARCA) ya
 * impactan en comisiones al emitirse y están vinculadas a su factura
 * (relatedInvoiceId); si entraran acá, por coincidencia de importe podían
 * descontar OTRA factura del mismo cliente. Solo se buscan NC de Colppy.
 */
function ncsColppy(customerIds: string[], issueDate: { gte?: Date; lt: Date }) {
  return prisma.invoice.findMany({
    where: {
      transactionType: 'CREDIT_NOTE',
      customerId: { in: customerIds },
      currency: 'USD',
      status: { not: 'CANCELLED' },
      relatedInvoiceId: null,
      issueDate,
    },
    select: { id: true, invoiceNumber: true, customerId: true, subtotal: true, total: true, issueDate: true },
    orderBy: { issueDate: 'asc' },
  })
}

/** Ventas (FAV) en USD de esos clientes, para detectar refacturaciones. */
function favsColppy(customerIds: string[]) {
  return prisma.invoice.findMany({
    where: {
      transactionType: 'SALE',
      customerId: { in: customerIds },
      currency: 'USD',
      status: { not: 'CANCELLED' },
    },
    select: { id: true, invoiceNumber: true, customerId: true, subtotal: true, total: true, issueDate: true },
  })
}

/** NC de Colppy ya consumidas y facturas ya descontadas por una NC de mes posterior. */
async function ncsYaUsadas() {
  const marcadas = await prisma.cotizacionFactura.findMany({
    where: {
      OR: [
        { errorMessage: { startsWith: MARCA_ANULADA_POR_NC } },
        { errorMessage: { contains: MARCA_NC_COLPPY } },
      ],
    },
    select: { errorMessage: true },
  })
  const ncIds = new Set<string>()
  const facturaIds = new Set<string>()
  for (const m of marcadas) {
    const marca = leerMarcaNC(m.errorMessage)
    if (!marca) continue
    ncIds.add(marca.ncId)
    if (marca.facturaId) facturaIds.add(marca.facturaId)
  }
  return { ncIds, facturaIds }
}

/**
 * NC totales hechas directo en Colppy (entran por el sync de facturación como
 * Invoice CREDIT_NOTE). Misma regla que las NC emitidas por el ERP:
 *
 * - NC del MISMO mes que la factura: anula la CotizacionFactura (deja de
 *   contar en ese mes).
 * - NC de un mes POSTERIOR: la factura queda en su mes (ya liquidado) y la NC
 *   resta en el mes de la NC con una fila NOTA_CREDITO negativa.
 *
 * Una NC matchea una factura si es del mismo cliente, en USD, por el mismo
 * neto (tolerancia 0,5% / mín USD 1) y de fecha igual o posterior. Se compara
 * el subtotal (neto) de la NC porque montoUSD de la factura es neto sin IVA.
 * Cada NC descuenta UNA sola factura (queda referenciada en errorMessage). Se
 * saltean las refacturaciones (FAV nueva por el mismo neto el día de la NC o
 * después).
 *
 * Best-effort: nunca lanza, para no bloquear la sincronización de la
 * liquidación.
 */
async function aplicarNCsDeColppy(liquidacionId: string, vendedorId: string, anio: number, mes: number) {
  try {
    await anularFacturasDelMes(vendedorId, anio, mes)
    await restarNCsSobreMesesAnteriores(liquidacionId, vendedorId, anio, mes)
  } catch (e) {
    logger.warn('[COMISIONES_NC] Error detectando NC de Colppy (no bloquea la sincronización)', e)
  }
}

/** NC de Colppy del mismo mes que la factura: anula la factura. */
async function anularFacturasDelMes(vendedorId: string, anio: number, mes: number) {
  const { desde, hasta } = rangoMes(anio, mes)
  const { ncIds: ncIdsUsados, facturaIds: yaDescontadas } = await ncsYaUsadas()
  const facturas = (
    await prisma.cotizacionFactura.findMany({
      where: {
        fecha: { gte: desde, lt: hasta },
        estado: { notIn: [...ESTADOS_FACTURA_EXCLUIDOS, 'NOTA_CREDITO'] },
        cotizacion: { salesPersonId: vendedorId },
        ...FILTRO_FACTURA_SIN_NC_ERP,
      },
      include: { cotizacion: { select: { customerId: true, quoteNumber: true } } },
    })
  ).filter((f) => !yaDescontadas.has(f.id))
  if (facturas.length === 0) return

  const customerIds = [...new Set(facturas.map((f) => f.cotizacion.customerId))]
  // Solo NC hasta fin de mes: una NC de un mes posterior resta en SU mes (ver
  // restarNCsSobreMesesAnteriores), no anula la factura retroactivamente.
  const ncs = await ncsColppy(customerIds, { lt: hasta })
  if (ncs.length === 0) return
  const favs = await favsColppy(customerIds)

  for (const factura of facturas) {
    const monto = Number(factura.montoUSD)
    const nc = ncs.find(
      (n) =>
        !ncIdsUsados.has(n.id) &&
        n.customerId === factura.cotizacion.customerId &&
        n.issueDate.getTime() >= factura.fecha.getTime() - UN_DIA_MS &&
        mismoImporte(netoComprobante(n), monto)
    )
    if (!nc) continue

    const refactura = buscarRefactura(nc, favs, factura.invoiceId)
    if (refactura) {
      logger.info(
        `[COMISIONES_NC] NC ${nc.invoiceNumber} salteada: refacturación detectada (FAV ${refactura.invoiceNumber} posterior por el mismo importe) — la factura ${factura.numeroFactura} (${factura.cotizacion.quoteNumber}) sigue contando`
      )
      continue
    }

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
}

/**
 * NC de Colppy de este mes sobre una factura de un mes ANTERIOR del vendedor:
 * crea una fila NOTA_CREDITO negativa con fecha de la NC (resta en este mes),
 * como hace el ERP con sus propias NC. Si ya hay una NC manual equivalente en
 * la liquidación (mismo importe y número), no la duplica.
 */
async function restarNCsSobreMesesAnteriores(liquidacionId: string, vendedorId: string, anio: number, mes: number) {
  const { desde, hasta } = rangoMes(anio, mes)
  const desdeFacturas = new Date(anio, mes - 1 - MESES_ATRAS_NC, 1)

  const facturas = await prisma.cotizacionFactura.findMany({
    where: {
      fecha: { gte: desdeFacturas, lt: desde },
      estado: { notIn: [...ESTADOS_FACTURA_EXCLUIDOS, 'NOTA_CREDITO'] },
      cotizacion: { salesPersonId: vendedorId },
      ...FILTRO_FACTURA_SIN_NC_ERP,
    },
    include: { cotizacion: { select: { customerId: true, quoteNumber: true } } },
    // La más reciente primero ante dos facturas por el mismo importe.
    orderBy: { fecha: 'desc' },
  })
  if (facturas.length === 0) return

  const customerIds = [...new Set(facturas.map((f) => f.cotizacion.customerId))]
  const ncs = await ncsColppy(customerIds, { gte: desde, lt: hasta })
  if (ncs.length === 0) return

  const [{ ncIds: ncIdsUsados, facturaIds: yaDescontadas }, favs, ncsManuales] = await Promise.all([
    ncsYaUsadas(),
    favsColppy(customerIds),
    prisma.comisionLinea.findMany({
      where: { liquidacionId, presupuesto: 'NC', facturaParcialId: null },
      select: { id: true, numeroFactura: true, importeFacturadoUsd: true },
    }),
  ])
  const manualesUsadas = new Set<string>()

  for (const nc of ncs) {
    if (ncIdsUsados.has(nc.id)) continue
    const netoNC = netoComprobante(nc)
    const factura = facturas.find(
      (f) =>
        !yaDescontadas.has(f.id) &&
        f.cotizacion.customerId === nc.customerId &&
        mismoImporte(netoNC, Number(f.montoUSD))
    )
    if (!factura) continue

    const refactura = buscarRefactura(nc, favs, factura.invoiceId)
    if (refactura) {
      logger.info(
        `[COMISIONES_NC] NC ${nc.invoiceNumber} salteada: refacturación detectada (FAV ${refactura.invoiceNumber} posterior por el mismo importe) — la factura ${factura.numeroFactura} (${factura.cotizacion.quoteNumber}) sigue contando`
      )
      continue
    }

    // ¿Ya la cargaron a mano en la liquidación? Entonces no se duplica.
    const manual = ncsManuales.find(
      (l) =>
        !manualesUsadas.has(l.id) &&
        mismoImporte(Number(l.importeFacturadoUsd ?? 0), Number(factura.montoUSD)) &&
        (!l.numeroFactura || mismoNumeroComprobante(l.numeroFactura, nc.invoiceNumber))
    )
    if (manual) {
      manualesUsadas.add(manual.id)
      logger.info(
        `[COMISIONES_NC] NC ${nc.invoiceNumber} de Colppy ya cargada a mano en la liquidación ${mes}/${anio}: no se duplica`
      )
      continue
    }

    ncIdsUsados.add(nc.id)
    yaDescontadas.add(factura.id)
    await prisma.cotizacionFactura.create({
      data: {
        cotizacionId: factura.cotizacionId,
        numeroFactura: nc.invoiceNumber,
        fecha: nc.issueDate,
        montoUSD: -Number(factura.montoUSD),
        montoARS: -Number(factura.montoARS),
        tipoCambio: factura.tipoCambio,
        estado: 'NOTA_CREDITO',
        // SIN_PENDIENTE: la NC de Colppy no devuelve unidades a la cotización
        // (no agranda el saldo a facturar del pipeline).
        errorMessage: `${MARCA_NC_SIN_PENDIENTE} ${MARCA_NC_COLPPY}${nc.id}:${factura.id}: NC ${nc.invoiceNumber} de Colppy s/ ${factura.numeroFactura ?? 'factura'} (${factura.fecha.toISOString().slice(0, 10)})`,
        createdById: factura.createdById,
      },
    })
    logger.info(
      `[COMISIONES_NC] NC ${nc.invoiceNumber} de Colppy sobre ${factura.numeroFactura} (${factura.cotizacion.quoteNumber}, mes anterior): resta USD ${Number(factura.montoUSD)} en ${mes}/${anio}`
    )
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

  // NC hechas directo en Colppy: anulan la factura del mes o restan en este mes
  await aplicarNCsDeColppy(liquidacion.id, vendedorId, anio, mes)

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
        select: { montoUSD: true, estado: true, errorMessage: true },
      },
    },
    orderBy: { date: 'desc' },
  })

  const items = quotes
    .map((q) => {
      // Una devolución que no vuelve a pendiente no agranda el saldo a facturar
      const facturado = q.facturas
        .filter((f) => !(f.estado === 'NOTA_CREDITO' && f.errorMessage?.startsWith(MARCA_NC_SIN_PENDIENTE)))
        .reduce((sum, f) => sum + Number(f.montoUSD), 0)
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
