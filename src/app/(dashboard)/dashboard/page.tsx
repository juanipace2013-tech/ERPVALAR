import { auth } from '@/auth'
import { Suspense } from 'react'

import { redirect } from 'next/navigation'
import {
  getDashboardMetrics,
  getCashFlowData,
  getIncomeExpenseData,
  getInvoicesToCollectWeekly,
  getExpenseDistribution
} from '@/lib/dashboard-queries'
import { MetricCard } from '@/components/dashboard/MetricCard'
import { DashboardCharts } from '@/components/dashboard/DashboardCharts'
import { DollarSign, CreditCard, Calendar } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

async function DashboardContent() {
  const session = await auth()

  if (!session) {
    redirect('/login')
  }

  // Obtener todos los datos en paralelo
  const [
    metrics,
    cashFlowData,
    incomeExpenseData,
    invoicesData,
    expenseDistribution
  ] = await Promise.all([
    getDashboardMetrics(),
    getCashFlowData(),
    getIncomeExpenseData(),
    getInvoicesToCollectWeekly(),
    getExpenseDistribution()
  ])

  const formatCurrency = (num: number) => {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(num).replace('ARS', '$')
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Tablero de control</h1>
          <p className="text-lg text-gray-600 mt-1">
            Hola, {session.user?.name || 'Usuario'} 👋
          </p>
        </div>
        <Button variant="outline" className="gap-2">
          <Calendar className="h-4 w-4" />
          Calendario de vencimientos
        </Button>
      </div>

      {/* Métricas principales */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Total ventas del mes"
          value={formatCurrency(metrics.salesThisMonth)}
          description="vs. mes anterior"
          icon={DollarSign}
          iconColor="text-green-600"
          trend={{
            value: Math.abs(metrics.salesChange),
            isPositive: metrics.salesChange >= 0
          }}
        />
        <MetricCard
          title="Total compras del mes"
          value={formatCurrency(metrics.purchasesThisMonth)}
          description="vs. mes anterior"
          icon={DollarSign}
          iconColor="text-red-600"
          trend={{
            value: Math.abs(metrics.purchasesChange),
            isPositive: metrics.purchasesChange >= 0
          }}
        />
        <MetricCard
          title="Facturas por cobrar"
          value={formatCurrency(metrics.invoicesToCollect)}
          description="Pendientes de pago"
          icon={CreditCard}
          iconColor="text-blue-600"
        />
        <MetricCard
          title="Facturas por pagar"
          value={formatCurrency(metrics.invoicesToPay)}
          description="Pendientes de pago"
          icon={CreditCard}
          iconColor="text-orange-600"
        />
      </div>

      {/* Gráficos con refresh y export */}
      <DashboardCharts
        initialCashFlowData={cashFlowData}
        initialIncomeExpenseData={incomeExpenseData}
        initialInvoicesData={invoicesData}
        initialExpenseDistribution={expenseDistribution}
      />

      {/* Mensaje si no hay datos */}
      {metrics.salesThisMonth === 0 && metrics.purchasesThisMonth === 0 && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="pt-6">
            <div className="text-center space-y-2">
              <p className="text-lg font-medium text-blue-900">
                ¡Bienvenido a tu nuevo dashboard!
              </p>
              <p className="text-sm text-blue-700">
                Comienza a registrar facturas de venta y compra para ver tus métricas actualizadas en tiempo real.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
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
