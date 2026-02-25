'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
  Users,
  TrendingUp,
  DollarSign,
  AlertTriangle,
  Award,
  Calendar,
  RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatNumber } from '@/lib/utils'

interface CustomerSummary {
  totalCustomers: number
  activeCustomers: number
  inactiveCustomers: number
  newThisMonth: number
  totalBalance: number
  averageBalance: number
  totalQuotes: number
  totalInvoices: number
  topCustomers: Array<{
    id: string
    name: string
    balance: number
    invoices: number
    quotes: number
  }>
  customersBySalesPerson: Array<{
    salesperson: string
    count: number
    totalBalance: number
  }>
  customersWithDebt: Array<{
    id: string
    name: string
    balance: number
    lastInvoiceDate: string | null
  }>
}

export function ClientesResumen() {
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<CustomerSummary | null>(null)

  useEffect(() => {
    fetchSummary()
  }, [])

  const fetchSummary = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/clientes/resumen')

      if (!response.ok) {
        throw new Error('Error al cargar resumen')
      }

      const data = await response.json()
      setSummary(data)
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar resumen de clientes')
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (amount: number) => {
    return `$${amount.toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`
  }

  const formatDate = (date: string | null) => {
    if (!date) return '-'
    return new Date(date).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <RefreshCw className="h-12 w-12 animate-spin text-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">Cargando resumen...</p>
        </div>
      </div>
    )
  }

  if (!summary) {
    return (
      <div className="text-center py-12 text-gray-600">
        <p>No se pudo cargar el resumen</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* KPIs Principales */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-blue-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Clientes</p>
                <p className="text-3xl font-bold text-blue-900">
                  {summary.totalCustomers}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {summary.activeCustomers} activos
                </p>
              </div>
              <Users className="h-10 w-10 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-green-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Nuevos Este Mes</p>
                <p className="text-3xl font-bold text-green-900">
                  {summary.newThisMonth}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  +{formatNumber((summary.newThisMonth / summary.totalCustomers) * 100, 1)}% del total
                </p>
              </div>
              <TrendingUp className="h-10 w-10 text-green-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-orange-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Saldo Total</p>
                <p className="text-3xl font-bold text-orange-900">
                  {formatCurrency(summary.totalBalance)}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Promedio: {formatCurrency(summary.averageBalance)}
                </p>
              </div>
              <DollarSign className="h-10 w-10 text-orange-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-purple-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Cotizaciones</p>
                <p className="text-3xl font-bold text-purple-900">
                  {summary.totalQuotes}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {summary.totalInvoices} facturas
                </p>
              </div>
              <Calendar className="h-10 w-10 text-purple-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top 10 Clientes por Saldo */}
        <Card className="border-blue-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Award className="h-5 w-5 text-blue-600" />
              Top 10 Clientes por Saldo
            </CardTitle>
            <CardDescription>
              Clientes con mayor saldo a favor
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-blue-50">
                    <TableHead className="font-semibold">#</TableHead>
                    <TableHead className="font-semibold">Cliente</TableHead>
                    <TableHead className="text-right font-semibold">Saldo</TableHead>
                    <TableHead className="text-center font-semibold">Facturas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.topCustomers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-gray-500">
                        No hay datos disponibles
                      </TableCell>
                    </TableRow>
                  ) : (
                    summary.topCustomers.slice(0, 10).map((customer, index) => (
                      <TableRow key={customer.id} className="hover:bg-blue-50">
                        <TableCell className="font-semibold text-blue-600">
                          {index + 1}
                        </TableCell>
                        <TableCell>{customer.name}</TableCell>
                        <TableCell className="text-right font-semibold text-blue-900">
                          {formatCurrency(customer.balance)}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="bg-blue-50">
                            {customer.invoices}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Clientes por Vendedor */}
        <Card className="border-green-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-green-600" />
              Distribución por Vendedor
            </CardTitle>
            <CardDescription>
              Cantidad de clientes por vendedor
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-green-50">
                    <TableHead className="font-semibold">Vendedor</TableHead>
                    <TableHead className="text-right font-semibold">Clientes</TableHead>
                    <TableHead className="text-right font-semibold">Saldo Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.customersBySalesPerson.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center py-8 text-gray-500">
                        No hay datos disponibles
                      </TableCell>
                    </TableRow>
                  ) : (
                    summary.customersBySalesPerson.map((item, index) => (
                      <TableRow key={index} className="hover:bg-green-50">
                        <TableCell className="font-semibold">{item.salesperson}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline" className="bg-green-50">
                            {item.count}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-semibold text-green-900">
                          {formatCurrency(item.totalBalance)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Clientes con Deuda */}
      <Card className="border-red-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-600" />
            Clientes con Mayor Saldo a Favor
          </CardTitle>
          <CardDescription>
            Requieren atención o seguimiento de cobros
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-red-50">
                  <TableHead className="font-semibold">Cliente</TableHead>
                  <TableHead className="text-right font-semibold">Saldo</TableHead>
                  <TableHead className="font-semibold">Última Factura</TableHead>
                  <TableHead className="font-semibold">Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.customersWithDebt.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-gray-500">
                      No hay clientes con saldo pendiente
                    </TableCell>
                  </TableRow>
                ) : (
                  summary.customersWithDebt.slice(0, 15).map((customer) => {
                    const daysSinceInvoice = customer.lastInvoiceDate
                      ? Math.floor(
                          (new Date().getTime() - new Date(customer.lastInvoiceDate).getTime()) /
                            (1000 * 60 * 60 * 24)
                        )
                      : null

                    const urgency =
                      !daysSinceInvoice || daysSinceInvoice > 60
                        ? 'high'
                        : daysSinceInvoice > 30
                        ? 'medium'
                        : 'low'

                    return (
                      <TableRow key={customer.id} className="hover:bg-red-50">
                        <TableCell className="font-semibold">{customer.name}</TableCell>
                        <TableCell className="text-right font-semibold text-red-900">
                          {formatCurrency(customer.balance)}
                        </TableCell>
                        <TableCell>{formatDate(customer.lastInvoiceDate)}</TableCell>
                        <TableCell>
                          {urgency === 'high' && (
                            <Badge className="bg-red-100 text-red-800">
                              Urgente
                            </Badge>
                          )}
                          {urgency === 'medium' && (
                            <Badge className="bg-orange-100 text-orange-800">
                              Atención
                            </Badge>
                          )}
                          {urgency === 'low' && (
                            <Badge className="bg-yellow-100 text-yellow-800">
                              Normal
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
