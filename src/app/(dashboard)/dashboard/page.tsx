import { auth } from '@/auth'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { DashboardClient } from '@/components/dashboard/DashboardClient'
import {
  getQuoteDashboardMetrics,
  getCotizacionesPorMes,
  getTopClientesMes,
  getCotizacionesRecientes,
  getCotizacionesPorVencer,
  getProductosMasCotizados,
  getTipoCambioActual,
  getRankingVendedores
} from '@/lib/quote-dashboard-queries'

async function DashboardContent() {
  const session = await auth()

  if (!session) {
    redirect('/login')
  }

  // Ejecutar todas las queries en paralelo para máximo rendimiento
  const [
    metrics,
    cotizacionesPorMes,
    topClientes,
    cotizacionesRecientes,
    cotizacionesPorVencer,
    productosMasCotizados,
    tipoCambio,
    rankingVendedores
  ] = await Promise.all([
    getQuoteDashboardMetrics(),
    getCotizacionesPorMes(),
    getTopClientesMes(),
    getCotizacionesRecientes(),
    getCotizacionesPorVencer(),
    getProductosMasCotizados(),
    getTipoCambioActual(),
    getRankingVendedores()
  ])

  const data = {
    metrics,
    cotizacionesPorMes,
    topClientes,
    cotizacionesRecientes,
    cotizacionesPorVencer,
    productosMasCotizados,
    tipoCambio,
    rankingVendedores
  }

  return (
    <DashboardClient
      userName={session.user?.name || 'Usuario'}
      data={data}
    />
  )
}

export default function DashboardPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    }>
      <DashboardContent />
    </Suspense>
  )
}
