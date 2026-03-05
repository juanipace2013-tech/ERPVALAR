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
 * Obtener métricas principales del dashboard de cotizaciones
 */
export async function getQuoteDashboardMetrics(): Promise<QuoteDashboardMetrics> {
  const now = new Date()
  const inicioMes = startOfMonth(now)
  const finMes = endOfMonth(now)
  const inicioMesAnterior = startOfMonth(subMonths(now, 1))
  const finMesAnterior = endOfMonth(subMonths(now, 1))

  // 1. Cotizaciones del mes
  const cotizacionesMes = await prisma.quote.findMany({
    where: {
      date: { gte: inicioMes, lte: finMes }
    }
  })

  const cotizacionesMesAnterior = await prisma.quote.findMany({
    where: {
      date: { gte: inicioMesAnterior, lte: finMesAnterior }
    }
  })

  const totalUSDMes = cotizacionesMes.reduce((sum, q) => sum + Number(q.total || 0), 0)
  const cambioVsMesAnterior =
    cotizacionesMesAnterior.length > 0
      ? ((cotizacionesMes.length - cotizacionesMesAnterior.length) / cotizacionesMesAnterior.length) * 100
      : 0

  // 2. Tasa de conversión
  const resueltas = await prisma.quote.findMany({
    where: {
      date: { gte: inicioMes },
      status: { in: ['ACCEPTED', 'CONVERTED', 'REJECTED'] }
    }
  })

  const aceptadas = resueltas.filter(q => ['ACCEPTED', 'CONVERTED'].includes(q.status)).length
  const tasaConversion = resueltas.length > 0 ? (aceptadas / resueltas.length) * 100 : 0

  // 3. Cotizaciones pendientes
  const pendientes = await prisma.quote.findMany({
    where: { status: 'SENT' }
  })

  const totalUSDPendientes = pendientes.reduce((sum, q) => sum + Number(q.total || 0), 0)

  const hoyMas3Dias = addDays(now, 3)
  const porVencer = pendientes.filter(
    q => q.validUntil && new Date(q.validUntil) <= hoyMas3Dias && new Date(q.validUntil) >= now
  ).length

  // 4. Productos en stock
  const productosConStock = await prisma.product.count({
    where: { stockQuantity: { gt: 0 } }
  })

  const totalProductos = await prisma.product.count()

  return {
    cotizacionesMes: {
      cantidad: cotizacionesMes.length,
      totalUSD: totalUSDMes,
      cambioVsMesAnterior
    },
    tasaConversion: {
      porcentaje: tasaConversion,
      aceptadas,
      resueltas: resueltas.length
    },
    cotizacionesPendientes: {
      cantidad: pendientes.length,
      totalUSD: totalUSDPendientes,
      porVencer
    },
    productosEnStock: {
      conStock: productosConStock,
      total: totalProductos
    }
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

  // Traer todas las cotizaciones del rango completo en una sola query
  const rangoFin = endOfMonth(addMonths(inicio, 5))
  const todasCotizaciones = await prisma.quote.findMany({
    where: {
      date: { gte: inicio, lte: rangoFin }
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
      date: { gte: inicioMes, lte: finMes }
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
 * Obtener cotizaciones por vencer (próximos 2 días)
 */
export async function getCotizacionesPorVencer(): Promise<CotizacionPorVencer[]> {
  const hoy = new Date()
  const mas2Dias = addDays(hoy, 2)

  const cotizaciones = await prisma.quote.findMany({
    where: {
      status: 'SENT',
      validUntil: {
        gte: hoy,
        lte: mas2Dias
      }
    },
    include: {
      customer: true
    },
    orderBy: {
      validUntil: 'asc'
    }
  })

  return cotizaciones.map(q => {
    const vence = new Date(q.validUntil!)
    const diffTime = vence.getTime() - hoy.getTime()
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

    return {
      id: q.id,
      numero: q.quoteNumber,
      cliente: q.customer.name,
      totalUSD: Number(q.total || 0),
      vence,
      diasRestantes: diffDays
    }
  })
}

/**
 * Obtener top 10 productos más cotizados del mes
 */
export async function getProductosMasCotizados(): Promise<ProductoMasCotizado[]> {
  const inicioMes = startOfMonth(new Date())

  const items = await prisma.quoteItem.findMany({
    where: {
      quote: {
        date: { gte: inicioMes }
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
 * Obtener ranking de vendedores del mes actual
 */
export async function getRankingVendedores(): Promise<VendedorRanking[]> {
  const now = new Date()
  const inicioMes = startOfMonth(now)
  const finMes = endOfMonth(now)

  // Todas las cotizaciones del mes agrupadas por vendedor
  const vendedores = await prisma.quote.groupBy({
    by: ['salesPersonId'],
    where: { date: { gte: inicioMes, lte: finMes } },
    _sum: { total: true },
    _count: true,
  })

  // Cotizaciones aceptadas/convertidas del mes agrupadas por vendedor
  const aceptadasPorVendedor = await prisma.quote.groupBy({
    by: ['salesPersonId'],
    where: {
      date: { gte: inicioMes, lte: finMes },
      status: { in: ['ACCEPTED', 'CONVERTED'] },
    },
    _count: true,
    _sum: { total: true },
  })

  // Mapa de aceptadas por salesPersonId (cantidad y monto)
  const aceptadasMap = new Map<string, { count: number; monto: number }>()
  aceptadasPorVendedor.forEach(v => {
    aceptadasMap.set(v.salesPersonId, {
      count: v._count,
      monto: Number(v._sum.total || 0),
    })
  })

  // Traer nombres de usuarios
  const userIds = vendedores.map(v => v.salesPersonId)
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true },
  })
  const userMap = new Map<string, string>()
  users.forEach(u => {
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
 * Obtener tipo de cambio actual y últimos 10 registros
 */
export async function getTipoCambioActual() {
  const actual = await prisma.exchangeRate.findFirst({
    where: {
      fromCurrency: 'USD',
      toCurrency: 'ARS'
    },
    orderBy: {
      validFrom: 'desc'
    }
  })

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

  return {
    actual: actual ? {
      valor: Number(actual.rate),
      fecha: actual.validFrom
    } : null,
    ultimos: ultimos.reverse().map(tc => ({
      fecha: format(new Date(tc.validFrom), 'dd/MM', { locale: es }),
      valor: Number(tc.rate)
    }))
  }
}
