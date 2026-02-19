import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { MetricCard } from '@/components/dashboard/MetricCard'
import { Users, Package, TrendingUp, DollarSign } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

async function getDashboardData() {
  try {
    // Consultas básicas de clientes y productos
    const totalCustomers = await prisma.customer.count()
    const activeCustomers = await prisma.customer.count({ where: { status: 'ACTIVE' } })
    const totalProducts = await prisma.product.count()
    const activeProducts = await prisma.product.count({ where: { status: 'ACTIVE' } })

    // Consultas de oportunidades con manejo de errores
    let openOpportunities = 0
    let totalOpportunityValue = 0

    try {
      openOpportunities = await prisma.opportunity.count({
        where: {
          stage: {
            notIn: ['CLOSED_WON', 'CLOSED_LOST'],
          },
        },
      })

      const aggregateResult = await prisma.opportunity.aggregate({
        where: {
          stage: {
            notIn: ['CLOSED_WON', 'CLOSED_LOST'],
          },
        },
        _sum: {
          estimatedValue: true,
        },
      })

      totalOpportunityValue = Number(aggregateResult._sum.estimatedValue || 0)
    } catch (error) {
      console.log('No opportunities data available yet')
    }

    // Obtener actividades recientes
    const recentActivities = await prisma.activity.findMany({
      take: 10,
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        user: {
          select: {
            name: true,
          },
        },
      },
    })

    return {
      totalCustomers,
      activeCustomers,
      totalProducts,
      activeProducts,
      openOpportunities,
      totalOpportunityValue,
      recentActivities,
    }
  } catch (error) {
    console.error('Error fetching dashboard data:', error)
    // Retornar valores por defecto en caso de error
    return {
      totalCustomers: 0,
      activeCustomers: 0,
      totalProducts: 0,
      activeProducts: 0,
      openOpportunities: 0,
      totalOpportunityValue: 0,
      recentActivities: [],
    }
  }
}

export default async function DashboardPage() {
  const session = await auth()
  const data = await getDashboardData()

  return (
    <div className="space-y-6">
      {/* Header con gradiente azul */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-lg p-6 text-white shadow-lg">
        <h1 className="text-3xl font-bold">
          Bienvenido, {session?.user.name}
        </h1>
        <p className="text-blue-100 mt-2">
          Aquí tienes un resumen de tu negocio
        </p>
      </div>

      {/* Métricas principales */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Clientes"
          value={data.totalCustomers}
          description={`${data.activeCustomers} activos`}
          icon={Users}
          iconColor="text-blue-600"
        />
        <MetricCard
          title="Productos"
          value={data.totalProducts}
          description={`${data.activeProducts} activos`}
          icon={Package}
          iconColor="text-emerald-600"
        />
        <MetricCard
          title="Oportunidades Abiertas"
          value={data.openOpportunities}
          description="En el pipeline de ventas"
          icon={TrendingUp}
          iconColor="text-amber-600"
        />
        <MetricCard
          title="Valor en Pipeline"
          value={formatCurrency(Number(data.totalOpportunityValue), 'ARS')}
          description="Valor total estimado"
          icon={DollarSign}
          iconColor="text-indigo-600"
        />
      </div>

      {/* Actividad reciente */}
      <Card className="shadow-md border-blue-100">
        <CardHeader className="border-b border-blue-100 bg-blue-50/50">
          <CardTitle className="text-blue-900">Actividad Reciente</CardTitle>
          <CardDescription className="text-blue-700">
            Últimas acciones realizadas en el sistema
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          {data.recentActivities.length > 0 ? (
            <div className="space-y-4">
              {data.recentActivities.map((activity) => (
                <div
                  key={activity.id}
                  className="flex items-start gap-4 border-b border-blue-100 pb-4 last:border-0 last:pb-0 hover:bg-blue-50/50 transition-colors p-3 rounded-lg"
                >
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-blue-600"></div>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">
                      {activity.title}
                    </p>
                    <p className="text-xs text-gray-600 mt-1">
                      Por {activity.user.name} •{' '}
                      {new Date(activity.createdAt).toLocaleDateString('es-AR', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-3">
                <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <p className="text-sm text-gray-600">
                No hay actividades recientes
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
