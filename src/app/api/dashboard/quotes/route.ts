import { auth } from '@/auth'
import { NextResponse } from 'next/server'
import {
  getQuoteDashboardMetrics,
  getCotizacionesPorMes,
  getTopClientesMes,
  getCotizacionesRecientes,
  getCotizacionesPorVencer,
  getProductosMasCotizados,
  getTipoCambioActual
} from '@/lib/quote-dashboard-queries'

/**
 * GET /api/dashboard/quotes
 * Obtiene todos los datos del dashboard de cotizaciones
 */
export async function GET() {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    // Ejecutar todas las queries en paralelo para máximo rendimiento
    const [
      metrics,
      cotizacionesPorMes,
      topClientes,
      cotizacionesRecientes,
      cotizacionesPorVencer,
      productosMasCotizados,
      tipoCambio
    ] = await Promise.all([
      getQuoteDashboardMetrics(),
      getCotizacionesPorMes(),
      getTopClientesMes(),
      getCotizacionesRecientes(),
      getCotizacionesPorVencer(),
      getProductosMasCotizados(),
      getTipoCambioActual()
    ])

    return NextResponse.json({
      metrics,
      cotizacionesPorMes,
      topClientes,
      cotizacionesRecientes,
      cotizacionesPorVencer,
      productosMasCotizados,
      tipoCambio
    })
  } catch (error) {
    console.error('Error en dashboard de cotizaciones:', error)
    return NextResponse.json(
      { error: 'Error al obtener datos del dashboard' },
      { status: 500 }
    )
  }
}
