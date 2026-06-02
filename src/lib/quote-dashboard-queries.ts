import { prisma } from './prisma'
import { startOfMonth, endOfMonth, subMonths, addMonths, format, addDays } from 'date-fns'
import { es } from 'date-fns/locale'

export interface QuoteDashboardMetrics {
  cotizacionesMes: {
    cantidad: number
    totalUSD: number
    cambioVsMesAnterior: number
  }
  tasaConversion: {
    porcentaje: number
    aceptadas: number
    resueltas: number
  }
  cotizacionesPendientes: {
    cantidad: number
    totalUSD: number
    porVencer: number
  }
  productosEnStock: {
    conStock: number
    total: number
  }
}

export interface CotizacionesPorMes {
  mes: string
  aceptadas: number
  rechazadas: number
  pendientes: number
}

export interface TopCliente {
  cliente: string
  cotizaciones: number
  totalUSD: number
}

export interface CotizacionReciente {
  id: string
  numero: string
  cliente: string
  totalUSD: number
  estado: string
  fecha: Date
}

export interface CotizacionPorVencer {
  id: string
  numero: string
  cliente: string
  totalUSD: number
  vence: Date
  diasRestantes: number
}

export interface ProductoMasCotizado {
  sku: string
  nombre: string
  vecesCotizado: number
  cantidadTotal: number
}

/**
 * Obtener métricas principales del dashboard de cotizaciones.
 *
 * Refactor 2026-05-28: las 6 queries que originalmente corrían en serie
 * (1.2 s a 200ms/RTT contra Oregon) ahora corren en paralelo con Promise.all
 * (~200 ms). Los `findMany + .length/.reduce` se reemplazaron por `count` y
 * `aggregate({ _sum: { total } })` para no transferir filas solo para
 * contarlas/sumarlas. La lógica de cálculo se preservó EXACTA: misma
 * matemática para porcentajes y conteos, mismo shape del retorno.
 */
export async function getQuoteDashboardMetrics(): Promise<QuoteDashboardMetrics> {
  const now = new Date()
  const inicioMes = startOfMonth(now)
  const finMes = endOfMonth(now)
  const inicioMesAnterior = startOfMonth(subMonths(now, 1))
  const finMesAnterior = endOfMonth(subMonths(now, 1))
  const hoyMas3Dias = addDays(now, 3)

  const [
    aggMes,
    countMesAnterior,
    countResueltas,
    countAceptadas,
    aggPendientes,
    countPorVencer,
    productosConStock,
    totalProductos,
  ] = await Promise.all([
    // 1. Cotizaciones del mes (count + sum total, excluyendo anuladas)
    prisma.quote.aggregate({
      where: {
        date: { gte: inicioMes, lte: finMes },
        status: { not: 'CANCELLED' },
      },
      _count: true,
      _sum: { total: true },
    }),
    // 2. Cotizaciones del mes anterior (solo count, para % de cambio)
    prisma.quote.count({
      where: {
        date: { gte: inicioMesAnterior, lte: finMesAnterior },
        status: { not: 'CANCELLED' },
      },
    }),
    // 3. Resueltas del mes (denominador de tasa de conversión)
    prisma.quote.count({
      where: {
        date: { gte: inicioMes },
        status: { in: ['ACCEPTED', 'CONVERTED', 'REJECTED'] },
      },
    }),
    // 4. Aceptadas del mes (numerador de tasa de conversión)
    prisma.quote.count({
      where: {
        date: { gte: inicioMes },
        status: { in: ['ACCEPTED', 'CONVERTED'] },
      },
    }),
    // 5. Pendientes totales (count + sum)
    prisma.quote.aggregate({
      where: { status: 'SENT' },
      _count: true,
      _sum: { total: true },
    }),
    // 6. Pendientes por vencer en los próximos 3 días (replica el filtro
    //    JS original: validUntil entre `now` y `now+3d`).
    prisma.quote.count({
      where: {
        status: 'SENT',
        validUntil: { gte: now, lte: hoyMas3Dias },
      },
    }),
    // 7. Productos con stock > 0
    prisma.product.count({ where: { stockQuantity: { gt: 0 } } }),
    // 8. Total de productos
    prisma.product.count(),
  ])

  const cantidadMes = aggMes._count
  const totalUSDMes = Number(aggMes._sum.total || 0)
  const cambioVsMesAnterior =
    countMesAnterior > 0
      ? ((cantidadMes - countMesAnterior) / countMesAnterior) * 100
      : 0

  const tasaConversion =
    countResueltas > 0 ? (countAceptadas / countResueltas) * 100 : 0

  return {
    cotizacionesMes: {
      cantidad: cantidadMes,
      totalUSD: totalUSDMes,
      cambioVsMesAnterior,
    },
    tasaConversion: {
      porcentaje: tasaConversion,
      aceptadas: countAceptadas,
      resueltas: countResueltas,
    },
    cotizacionesPendientes: {
      cantidad: aggPendientes._count,
      totalUSD: Number(aggPendientes._sum.total || 0),
      porVencer: countPorVencer,
    },
    productosEnStock: {
      conStock: productosConStock,
      total: totalProductos,
    },
  }
}

/**
 * Obtener cotizaciones por mes desde marzo 2026 (inicio del sistema)
 * Muestra 6 meses: desde marzo 2026 hacia adelante.
 * Cuando el mes actual supere agosto 2026, se desplaza la ventana para
 * que el mes actual siempre esté incluido.
 */
export async function getCotizacionesPorMes(): Promise<CotizacionesPorMes[]> {
  const meses: CotizacionesPorMes[] = []
  const SISTEMA_INICIO = new Date(2026, 2, 1) // Marzo 2026 (mes index 2)
  const ahora = new Date()

  // Inicio de la ventana: marzo 2026, o desplazar si el mes actual
  // ya no cabe en los 6 meses desde marzo
  const mesActual = startOfMonth(ahora)
  const limiteSinDesplazar = addMonths(SISTEMA_INICIO, 5) // agosto 2026
  const inicio = mesActual > limiteSinDesplazar
    ? startOfMonth(subMonths(mesActual, 5))
    : SISTEMA_INICIO

  // Traer todas las cotizaciones del rango completo en una sola query (excluir anuladas)
  const rangoFin = endOfMonth(addMonths(inicio, 5))
  const todasCotizaciones = await prisma.quote.findMany({
    where: {
      date: { gte: inicio, lte: rangoFin },
      status: { not: 'CANCELLED' }
    },
    select: { date: true, status: true }
  })

  for (let i = 0; i < 6; i++) {
    const mesInicio = startOfMonth(addMonths(inicio, i))
    const mesFin = endOfMonth(addMonths(inicio, i))

    const cotizacionesMes = todasCotizaciones.filter(q => {
      const d = new Date(q.date)
      return d >= mesInicio && d <= mesFin
    })

    meses.push({
      mes: format(mesInicio, 'MMM', { locale: es }),
      aceptadas: cotizacionesMes.filter(q => ['ACCEPTED', 'CONVERTED'].includes(q.status)).length,
      rechazadas: cotizacionesMes.filter(q => q.status === 'REJECTED').length,
      pendientes: cotizacionesMes.filter(q => q.status === 'SENT').length
    })
  }

  return meses
}

/**
 * Obtener top 5 clientes del mes por total USD
 */
export async function getTopClientesMes(): Promise<TopCliente[]> {
  const inicioMes = startOfMonth(new Date())
  const finMes = endOfMonth(new Date())

  const cotizaciones = await prisma.quote.findMany({
    where: {
      date: { gte: inicioMes, lte: finMes },
      status: { not: 'CANCELLED' }
    },
    include: {
      customer: true
    }
  })

  // Agrupar por cliente
  const clienteMap = new Map<string, { cotizaciones: number; totalUSD: number }>()

  cotizaciones.forEach(q => {
    const cliente = q.customer.name
    const existing = clienteMap.get(cliente) || { cotizaciones: 0, totalUSD: 0 }
    clienteMap.set(cliente, {
      cotizaciones: existing.cotizaciones + 1,
      totalUSD: existing.totalUSD + Number(q.total || 0)
    })
  })

  // Convertir a array y ordenar
  return Array.from(clienteMap.entries())
    .map(([cliente, data]) => ({
      cliente,
      cotizaciones: data.cotizaciones,
      totalUSD: data.totalUSD
    }))
    .sort((a, b) => b.totalUSD - a.totalUSD)
    .slice(0, 5)
}

/**
 * Obtener últimas 10 cotizaciones
 */
export async function getCotizacionesRecientes(): Promise<CotizacionReciente[]> {
  const cotizaciones = await prisma.quote.findMany({
    take: 10,
    orderBy: { date: 'desc' },
    include: {
      customer: true
    }
  })

  return cotizaciones.map(q => ({
    id: q.id,
    numero: q.quoteNumber,
    cliente: q.customer.name,
    totalUSD: Number(q.total || 0),
    estado: q.status,
    fecha: q.date
  }))
}

/**
 * Cotizaciones que requieren seguimiento:
 *  - SENT que vencen en los próximos 5 días
 *  - SENT que vencieron en los últimos 30 días (sin respuesta)
 * Orden: primero las que vencen pronto, luego las vencidas (más recientes primero).
 * Máximo 15 resultados.
 */
export async function getCotizacionesPorVencer(): Promise<CotizacionPorVencer[]> {
  const hoy = new Date()
  const mas5Dias = addDays(hoy, 5)
  const hace30Dias = addDays(hoy, -30)

  const cotizaciones = await prisma.quote.findMany({
    where: {
      status: 'SENT',
      validUntil: {
        gte: hace30Dias,
        lte: mas5Dias,
      },
    },
    include: {
      customer: true,
    },
    orderBy: {
      validUntil: 'asc',
    },
  })

  const mapped = cotizaciones.map(q => {
    const vence = new Date(q.validUntil!)
    const diffTime = vence.getTime() - hoy.getTime()
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

    return {
      id: q.id,
      numero: q.quoteNumber,
      cliente: q.customer.name,
      totalUSD: Number(q.total || 0),
      vence,
      diasRestantes: diffDays,
    }
  })

  // Separar: por vencer (>=0) primero asc, luego vencidas (<0) desc (más recientes primero)
  const porVencer = mapped.filter(c => c.diasRestantes >= 0).sort((a, b) => a.diasRestantes - b.diasRestantes)
  const vencidas = mapped.filter(c => c.diasRestantes < 0).sort((a, b) => b.diasRestantes - a.diasRestantes)

  return [...porVencer, ...vencidas].slice(0, 15)
}

/**
 * Obtener top 10 productos más cotizados del mes
 */
export async function getProductosMasCotizados(): Promise<ProductoMasCotizado[]> {
  const inicioMes = startOfMonth(new Date())

  const items = await prisma.quoteItem.findMany({
    where: {
      quote: {
        date: { gte: inicioMes },
        status: { not: 'CANCELLED' }
      }
    },
    include: {
      product: true
    }
  })

  // Agrupar por producto
  const productoMap = new Map<string, { sku: string; nombre: string; veces: number; cantidad: number }>()

  items.forEach(item => {
    if (!item.product || !item.productId) return
    const key = item.productId
    const existing = productoMap.get(key) || {
      sku: item.product.sku,
      nombre: item.product.name,
      veces: 0,
      cantidad: 0
    }
    productoMap.set(key, {
      ...existing,
      veces: existing.veces + 1,
      cantidad: existing.cantidad + item.quantity
    })
  })

  return Array.from(productoMap.values())
    .map(p => ({
      sku: p.sku,
      nombre: p.nombre,
      vecesCotizado: p.veces,
      cantidadTotal: p.cantidad
    }))
    .sort((a, b) => b.vecesCotizado - a.vecesCotizado)
    .slice(0, 10)
}

export interface VendedorRanking {
  nombre: string
  cotizaciones: number
  totalUSD: number
  aceptadas: number
  montoAceptadas: number
  tasaConversion: number
  ticketPromedio: number
}

/**
 * Obtener ranking de vendedores del mes actual.
 *
 * Refactor 2026-05-28: las 3 queries antes serializadas (600 ms a 200ms/RTT)
 * ahora corren en paralelo (~200 ms). La lookup de users se cambió de
 * "traer solo los IDs del groupBy" a "traer todos los users con role
 * comercial" para no depender del resultado del groupBy. El set es chico
 * (~10 usuarios con role ADMIN/GERENTE/VENDEDOR), el costo extra es nulo.
 * CONTADOR queda excluido (no participa de ventas).
 */
export async function getRankingVendedores(): Promise<VendedorRanking[]> {
  const now = new Date()
  const inicioMes = startOfMonth(now)
  const finMes = endOfMonth(now)

  const [vendedores, aceptadasPorVendedor, comercialUsers] = await Promise.all([
    // Todas las cotizaciones del mes agrupadas por vendedor (excluir anuladas)
    prisma.quote.groupBy({
      by: ['salesPersonId'],
      where: { date: { gte: inicioMes, lte: finMes }, status: { not: 'CANCELLED' } },
      _sum: { total: true },
      _count: true,
    }),
    // Ventas CERRADAS del mes agrupadas por vendedor.
    // Se atribuyen al mes de la FECHA DE ACEPTACIÓN (responseDate), NO al de
    // emisión de la cotización (date). Así una cotización emitida en Mayo y
    // aceptada en Junio cuenta como venta cerrada de Junio. El filtro de
    // período (responseDate) y el de estado (ACCEPTED/CONVERTED) usan el mismo
    // criterio de "cierre": responseDate se setea al pasar a ACCEPTED y no se
    // pisa al convertir a CONVERTED.
    prisma.quote.groupBy({
      by: ['salesPersonId'],
      where: {
        responseDate: { gte: inicioMes, lte: finMes },
        status: { in: ['ACCEPTED', 'CONVERTED'] },
      },
      _count: true,
      _sum: { total: true },
    }),
    // Lookup de todos los users con role comercial (set chico, ~10 personas).
    // Lo hacemos en paralelo con los dos groupBy en vez de en serie tras ellos.
    prisma.user.findMany({
      where: { role: { in: ['VENDEDOR', 'ADMIN', 'GERENTE'] } },
      select: { id: true, name: true },
    }),
  ])

  // Mapa de aceptadas por salesPersonId (cantidad y monto)
  const aceptadasMap = new Map<string, { count: number; monto: number }>()
  aceptadasPorVendedor.forEach(v => {
    aceptadasMap.set(v.salesPersonId, {
      count: v._count,
      monto: Number(v._sum.total || 0),
    })
  })

  // Mapa de nombres de users comerciales
  const userMap = new Map<string, string>()
  comercialUsers.forEach(u => {
    userMap.set(u.id, u.name || 'Sin nombre')
  })

  // Combinar datos
  const ranking: VendedorRanking[] = vendedores.map(v => {
    const totalUSD = Number(v._sum.total || 0)
    const cotizaciones = v._count
    const aceptadasData = aceptadasMap.get(v.salesPersonId) || { count: 0, monto: 0 }
    const aceptadas = aceptadasData.count
    const montoAceptadas = aceptadasData.monto
    const tasaConversion = cotizaciones > 0 ? (aceptadas / cotizaciones) * 100 : 0
    const ticketPromedio = cotizaciones > 0 ? totalUSD / cotizaciones : 0

    return {
      nombre: userMap.get(v.salesPersonId) || 'Sin nombre',
      cotizaciones,
      totalUSD,
      aceptadas,
      montoAceptadas,
      tasaConversion,
      ticketPromedio,
    }
  })

  // Ordenar por total cotizado USD descendente
  return ranking.sort((a, b) => b.totalUSD - a.totalUSD)
}

/**
 * Obtener tipo de cambio actual y últimos 10 registros.
 *
 * Refactor 2026-05-28: las 2 queries serializadas se fusionaron en 1.
 * El `findFirst` original era equivalente al primer elemento del `findMany`
 * con el mismo orderBy. Lo derivamos en JS y nos ahorramos un RTT (~200 ms
 * contra Oregon). Si no hay registros, `actual` queda null como antes.
 */
export async function getTipoCambioActual() {
  const ultimos = await prisma.exchangeRate.findMany({
    where: {
      fromCurrency: 'USD',
      toCurrency: 'ARS'
    },
    orderBy: {
      validFrom: 'desc'
    },
    take: 10
  })

  const actual = ultimos[0] ?? null

  return {
    actual: actual ? {
      valor: Number(actual.rate),
      fecha: actual.validFrom
    } : null,
    // slice() para no mutar el array al revertirlo (el orig hacía reverse
    // directo, lo que mutaba `ultimos` antes de mapear; acá lo evitamos por
    // claridad sin cambiar el resultado).
    ultimos: ultimos.slice().reverse().map(tc => ({
      fecha: format(new Date(tc.validFrom), 'dd/MM', { locale: es }),
      valor: Number(tc.rate)
    }))
  }
}

/**
 * Obtener conteo de cotizaciones vencidas sin seguimiento reciente.
 *
 * Refactor 2026-05-28: cambio `findMany select: { id } + .length` por
 * `count(...)` con el mismo where. Mismo SQL en el server, misma latencia,
 * pero ahorra transferir 657 (o cuantas haya) IDs por la red solo para
 * descartarlos. Shape del retorno preservado.
 */
export async function getCotizacionesSinSeguimiento() {
  const hace7dias = new Date()
  hace7dias.setDate(hace7dias.getDate() - 7)

  // Cotizaciones vencidas hace +7 días en estados activos sin seguimiento reciente
  const cantidad = await prisma.quote.count({
    where: {
      validUntil: { lt: hace7dias },
      status: { in: ['SENT', 'EXPIRED'] },
      AND: [
        {
          OR: [
            { seguimientos: { none: {} } },
            { seguimientos: { every: { fecha: { lt: hace7dias } } } },
          ],
        },
      ],
    },
  })

  return { cantidad }
}
