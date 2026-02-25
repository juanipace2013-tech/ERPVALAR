'use client'

import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  FileText,
  TrendingUp,
  Clock,
  Package,
  DollarSign,
  Calendar,
  Users,
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line
} from 'recharts'

interface DashboardClientProps {
  userName: string
  data: {
    metrics: any
    cotizacionesPorMes: any[]
    topClientes: any[]
    cotizacionesRecientes: any[]
    cotizacionesPorVencer: any[]
    productosMasCotizados: any[]
    tipoCambio: any
  }
}

export function DashboardClient({ userName, data }: DashboardClientProps) {
  const {
    metrics,
    cotizacionesPorMes,
    topClientes,
    cotizacionesRecientes,
    cotizacionesPorVencer,
    productosMasCotizados,
    tipoCambio
  } = data

  const formatCurrency = (num: number) => {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(num)
  }

  const formatDate = (date: string | Date) => {
    return new Date(date).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    })
  }

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      DRAFT: { label: 'Borrador', variant: 'secondary' },
      SENT: { label: 'Enviada', variant: 'default' },
      ACCEPTED: { label: 'Aceptada', variant: 'default' },
      REJECTED: { label: 'Rechazada', variant: 'destructive' },
      CONVERTED: { label: 'Convertida', variant: 'outline' },
      EXPIRED: { label: 'Vencida', variant: 'destructive' }
    }
    const config = statusConfig[status] || { label: status, variant: 'outline' }
    return <Badge variant={config.variant}>{config.label}</Badge>
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Dashboard de Cotizaciones</h1>
          <p className="text-lg text-gray-600 mt-1">
            Hola, {userName} 👋
          </p>
        </div>
        <Link href="/cotizaciones/nueva">
          <Button className="gap-2 bg-blue-600 hover:bg-blue-700">
            <FileText className="h-4 w-4" />
            Nueva Cotización
          </Button>
        </Link>
      </div>

      {/* FILA 1: 4 TARJETAS KPI */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* KPI 1: Cotizaciones del mes */}
        <Card className="border-blue-200 bg-gradient-to-br from-blue-50 to-white">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-gray-700">
              Cotizaciones del mes
            </CardTitle>
            <FileText className="h-5 w-5 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-gray-900">
              {metrics.cotizacionesMes.cantidad}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <p className="text-sm text-gray-600">
                {formatCurrency(metrics.cotizacionesMes.totalUSD)}
              </p>
              {metrics.cotizacionesMes.cambioVsMesAnterior !== 0 && (
                <div className={`flex items-center text-xs font-medium ${
                  metrics.cotizacionesMes.cambioVsMesAnterior >= 0 ? 'text-green-600' : 'text-red-600'
                }`}>
                  {metrics.cotizacionesMes.cambioVsMesAnterior >= 0 ? (
                    <ArrowUpRight className="h-3 w-3" />
                  ) : (
                    <ArrowDownRight className="h-3 w-3" />
                  )}
                  {Math.abs(metrics.cotizacionesMes.cambioVsMesAnterior).toFixed(1)}%
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* KPI 2: Tasa de conversión */}
        <Card className="border-green-200 bg-gradient-to-br from-green-50 to-white">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-gray-700">
              Tasa de conversión
            </CardTitle>
            <TrendingUp className="h-5 w-5 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-gray-900">
              {metrics.tasaConversion.porcentaje.toFixed(1)}%
            </div>
            <p className="text-sm text-gray-600 mt-2">
              {metrics.tasaConversion.aceptadas} de {metrics.tasaConversion.resueltas} resueltas
            </p>
          </CardContent>
        </Card>

        {/* KPI 3: Cotizaciones pendientes */}
        <Card className="border-orange-200 bg-gradient-to-br from-orange-50 to-white">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-gray-700">
              Cotizaciones pendientes
            </CardTitle>
            <Clock className="h-5 w-5 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-gray-900">
              {metrics.cotizacionesPendientes.cantidad}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <p className="text-sm text-gray-600">
                {formatCurrency(metrics.cotizacionesPendientes.totalUSD)}
              </p>
              {metrics.cotizacionesPendientes.porVencer > 0 && (
                <Badge variant="destructive" className="text-xs">
                  {metrics.cotizacionesPendientes.porVencer} por vencer
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* KPI 4: Productos en stock */}
        <Card className="border-purple-200 bg-gradient-to-br from-purple-50 to-white">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-gray-700">
              Productos en stock
            </CardTitle>
            <Package className="h-5 w-5 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-gray-900">
              {metrics.productosEnStock.conStock}
            </div>
            <p className="text-sm text-gray-600 mt-2">
              de {metrics.productosEnStock.total} productos
            </p>
          </CardContent>
        </Card>
      </div>

      {/* FILA 2: GRÁFICO + TOP CLIENTES */}
      <div className="grid gap-4 lg:grid-cols-5">
        {/* Gráfico de cotizaciones por mes (60% = 3/5) */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-gray-900">
              Cotizaciones por mes (últimos 6 meses)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={cotizacionesPorMes}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="mes"
                  tick={{ fill: '#6b7280', fontSize: 12 }}
                  axisLine={{ stroke: '#d1d5db' }}
                />
                <YAxis
                  tick={{ fill: '#6b7280', fontSize: 12 }}
                  axisLine={{ stroke: '#d1d5db' }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px'
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: '12px' }}
                />
                <Bar dataKey="aceptadas" name="Aceptadas" fill="#10b981" stackId="a" />
                <Bar dataKey="pendientes" name="Pendientes" fill="#f59e0b" stackId="a" />
                <Bar dataKey="rechazadas" name="Rechazadas" fill="#ef4444" stackId="a" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Top 5 clientes del mes (40% = 2/5) */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Users className="h-5 w-5 text-blue-600" />
              Top 5 Clientes del mes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {topClientes.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-8">
                  No hay datos de clientes este mes
                </p>
              ) : (
                topClientes.map((cliente, index) => (
                  <div key={index} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {cliente.cliente}
                      </p>
                      <p className="text-xs text-gray-500">
                        {cliente.cotizaciones} cotización{cliente.cotizaciones !== 1 ? 'es' : ''}
                      </p>
                    </div>
                    <div className="text-right ml-3">
                      <p className="text-sm font-semibold text-blue-600">
                        {formatCurrency(cliente.totalUSD)}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* FILA 3: COTIZACIONES RECIENTES + POR VENCER */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Cotizaciones recientes */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-600" />
              Cotizaciones recientes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {cotizacionesRecientes.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-8">
                  No hay cotizaciones recientes
                </p>
              ) : (
                cotizacionesRecientes.map((cotizacion) => (
                  <Link
                    key={cotizacion.id}
                    href={`/cotizaciones/${cotizacion.id}/ver`}
                    className="block"
                  >
                    <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-all">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-sm font-medium text-gray-900">
                            {cotizacion.numero}
                          </p>
                          {getStatusBadge(cotizacion.estado)}
                        </div>
                        <p className="text-xs text-gray-500 truncate">
                          {cotizacion.cliente}
                        </p>
                        <p className="text-xs text-gray-400">
                          {formatDate(cotizacion.fecha)}
                        </p>
                      </div>
                      <div className="text-right ml-3">
                        <p className="text-sm font-semibold text-gray-900">
                          {formatCurrency(cotizacion.totalUSD)}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))
              )}
            </div>
            {cotizacionesRecientes.length > 0 && (
              <Link href="/cotizaciones">
                <Button variant="outline" className="w-full mt-4 text-blue-600 hover:text-blue-700 hover:bg-blue-50">
                  Ver todas las cotizaciones
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>

        {/* Cotizaciones por vencer */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Calendar className="h-5 w-5 text-orange-600" />
              Cotizaciones por vencer (próximos 7 días)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {cotizacionesPorVencer.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-8">
                  No hay cotizaciones por vencer
                </p>
              ) : (
                cotizacionesPorVencer.map((cotizacion) => (
                  <Link
                    key={cotizacion.id}
                    href={`/cotizaciones/${cotizacion.id}/ver`}
                    className="block"
                  >
                    <div className="flex items-center justify-between p-3 rounded-lg border border-orange-200 bg-orange-50 hover:border-orange-300 hover:bg-orange-100 transition-all">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-sm font-medium text-gray-900">
                            {cotizacion.numero}
                          </p>
                          <Badge variant="destructive" className="text-xs">
                            {cotizacion.diasRestantes} día{cotizacion.diasRestantes !== 1 ? 's' : ''}
                          </Badge>
                        </div>
                        <p className="text-xs text-gray-600 truncate">
                          {cotizacion.cliente}
                        </p>
                        <p className="text-xs text-gray-500">
                          Vence: {formatDate(cotizacion.vence)}
                        </p>
                      </div>
                      <div className="text-right ml-3">
                        <p className="text-sm font-semibold text-gray-900">
                          {formatCurrency(cotizacion.totalUSD)}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* FILA 4: TIPO DE CAMBIO + PRODUCTOS MÁS COTIZADOS */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Tipo de cambio actual */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-green-600" />
              Tipo de Cambio USD/ARS
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tipoCambio.actual ? (
              <>
                <div className="flex items-baseline gap-3 mb-4">
                  <div className="text-4xl font-bold text-gray-900">
                    ${tipoCambio.actual.valor.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-sm text-gray-500">
                    {formatDate(tipoCambio.actual.fecha)}
                  </div>
                </div>
                {tipoCambio.ultimos.length > 0 && (
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={tipoCambio.ultimos}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis
                        dataKey="fecha"
                        tick={{ fill: '#6b7280', fontSize: 11 }}
                        axisLine={{ stroke: '#d1d5db' }}
                      />
                      <YAxis
                        tick={{ fill: '#6b7280', fontSize: 11 }}
                        axisLine={{ stroke: '#d1d5db' }}
                        domain={['dataMin - 50', 'dataMax + 50']}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#fff',
                          border: '1px solid #e5e7eb',
                          borderRadius: '6px',
                          fontSize: '12px'
                        }}
                        formatter={(value: number) => [`$${value.toFixed(2)}`, 'Tipo de cambio']}
                      />
                      <Line
                        type="monotone"
                        dataKey="valor"
                        stroke="#10b981"
                        strokeWidth={2}
                        dot={{ fill: '#10b981', r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
                <Link href="/tipo-cambio">
                  <Button variant="outline" className="w-full mt-4 text-green-600 hover:text-green-700 hover:bg-green-50">
                    Ver historial completo
                  </Button>
                </Link>
              </>
            ) : (
              <div className="text-center py-8">
                <p className="text-sm text-gray-500 mb-4">
                  No hay tipo de cambio configurado
                </p>
                <Link href="/tipo-cambio">
                  <Button className="bg-green-600 hover:bg-green-700">
                    Configurar tipo de cambio
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Productos más cotizados */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-purple-600" />
              Productos más cotizados del mes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {productosMasCotizados.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-8">
                  No hay productos cotizados este mes
                </p>
              ) : (
                productosMasCotizados.map((producto, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-200 hover:border-purple-200 hover:bg-purple-50 transition-all"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-xs font-mono">
                          {producto.sku}
                        </Badge>
                        <span className="text-xs font-semibold text-purple-600">
                          #{index + 1}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {producto.nombre}
                      </p>
                      <p className="text-xs text-gray-500">
                        {producto.cantidadTotal} unidades
                      </p>
                    </div>
                    <div className="text-right ml-3">
                      <p className="text-lg font-bold text-purple-600">
                        {producto.vecesCotizado}
                      </p>
                      <p className="text-xs text-gray-500">
                        veces
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
            {productosMasCotizados.length > 0 && (
              <Link href="/productos">
                <Button variant="outline" className="w-full mt-4 text-purple-600 hover:text-purple-700 hover:bg-purple-50">
                  Ver todos los productos
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
