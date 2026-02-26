'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Loader2, AlertCircle, FileText, Truck, ExternalLink, BarChart3 } from 'lucide-react'
import { formatNumber, formatDateAR, formatCurrency } from '@/lib/utils'

interface Props {
  cuit: string
}

interface LocalQuote {
  id: string
  quoteNumber: string
  status: string
  total: number
  currency: string
  createdAt: string
  validUntil: string | null
}

interface LocalDeliveryNote {
  id: string
  deliveryNumber: string
  status: string
  date: string
}

interface LocalInvoice {
  id: string
  invoiceNumber: string | null
  invoiceType: string | null
  total: number
  status: string
  issueDate: string
}

interface LocalCustomerData {
  found: boolean
  customer: {
    id: string
    name: string
    quotes: LocalQuote[]
    deliveryNotes: LocalDeliveryNote[]
    invoices: LocalInvoice[]
    _count: {
      quotes: number
      deliveryNotes: number
      invoices: number
    }
    stats: {
      totalQuoted: number
      acceptedQuotes: number
      conversionRate: number
    }
  } | null
}

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  DRAFT: { label: 'Borrador', className: 'bg-gray-100 text-gray-800' },
  SENT: { label: 'Enviada', className: 'bg-blue-100 text-blue-800' },
  ACCEPTED: { label: 'Aceptada', className: 'bg-green-100 text-green-800' },
  REJECTED: { label: 'Rechazada', className: 'bg-red-100 text-red-800' },
  EXPIRED: { label: 'Vencida', className: 'bg-orange-100 text-orange-800' },
  INVOICED: { label: 'Facturada', className: 'bg-purple-100 text-purple-800' },
  CANCELLED: { label: 'Cancelada', className: 'bg-gray-100 text-gray-600' },
}

const DN_STATUS_BADGES: Record<string, { label: string; className: string }> = {
  DRAFT: { label: 'Borrador', className: 'bg-gray-100 text-gray-800' },
  PENDING: { label: 'Pendiente', className: 'bg-yellow-100 text-yellow-800' },
  DELIVERED: { label: 'Entregado', className: 'bg-green-100 text-green-800' },
  CANCELLED: { label: 'Cancelado', className: 'bg-red-100 text-red-800' },
}

export default function TabComercial({ cuit }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState<LocalCustomerData | null>(null)

  const fetchData = useCallback(async () => {
    if (!cuit) {
      setData({ found: false, customer: null })
      return
    }
    setLoading(true)
    setError('')
    try {
      const cleanCuit = cuit.replace(/\D/g, '')
      const res = await fetch(`/api/clientes/by-cuit/${cleanCuit}`)
      if (!res.ok) throw new Error('Error al cargar datos comerciales')
      const result = await res.json()
      setData(result)
    } catch (e: any) {
      setError(e.message || 'Error al cargar datos comerciales')
    } finally {
      setLoading(false)
    }
  }, [cuit])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-2" />
        <p className="text-red-600 text-sm">{error}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={fetchData}>
          Reintentar
        </Button>
      </div>
    )
  }

  if (!data?.found || !data.customer) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <BarChart3 className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">Este cliente no tiene actividad comercial en el ERP</p>
          <p className="text-xs text-gray-400 mt-1">No se encontraron cotizaciones, remitos ni facturas locales</p>
        </CardContent>
      </Card>
    )
  }

  const { customer } = data

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-xs text-gray-500">Cotizaciones</p>
            <p className="text-xl font-bold text-gray-800">{customer._count.quotes}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-xs text-gray-500">Remitos</p>
            <p className="text-xl font-bold text-gray-800">{customer._count.deliveryNotes}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-xs text-gray-500">Total Cotizado</p>
            <p className="text-lg font-bold text-blue-600">$ {formatNumber(customer.stats.totalQuoted)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-xs text-gray-500">Conversión</p>
            <p className="text-xl font-bold text-green-600">{customer.stats.conversionRate.toFixed(0)}%</p>
          </CardContent>
        </Card>
      </div>

      {/* Cotizaciones */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-600" />
            Cotizaciones
          </CardTitle>
        </CardHeader>
        <CardContent>
          {customer.quotes.length === 0 ? (
            <p className="text-center text-gray-400 py-4">Sin cotizaciones</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Número</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customer.quotes.map((q) => {
                    const badge = STATUS_BADGES[q.status] || STATUS_BADGES.DRAFT
                    return (
                      <TableRow key={q.id}>
                        <TableCell className="font-mono text-sm font-medium">{q.quoteNumber}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          {formatDateAR(q.createdAt)}
                        </TableCell>
                        <TableCell>
                          <Badge className={`${badge.className} text-xs`}>{badge.label}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatCurrency(q.total, (q.currency as 'ARS' | 'USD') || 'USD')}
                        </TableCell>
                        <TableCell>
                          <Link href={`/cotizaciones/${q.id}/ver`}>
                            <Button variant="ghost" size="sm" className="h-7 text-xs text-blue-600">
                              <ExternalLink className="h-3 w-3 mr-1" />
                              Ver
                            </Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Remitos */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Truck className="h-5 w-5 text-blue-600" />
            Remitos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {customer.deliveryNotes.length === 0 ? (
            <p className="text-center text-gray-400 py-4">Sin remitos</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Número</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customer.deliveryNotes.map((dn) => {
                    const badge = DN_STATUS_BADGES[dn.status] || DN_STATUS_BADGES.DRAFT
                    return (
                      <TableRow key={dn.id}>
                        <TableCell className="font-mono text-sm font-medium">{dn.deliveryNumber}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          {formatDateAR(dn.date)}
                        </TableCell>
                        <TableCell>
                          <Badge className={`${badge.className} text-xs`}>{badge.label}</Badge>
                        </TableCell>
                        <TableCell>
                          <Link href={`/remitos/${dn.id}`}>
                            <Button variant="ghost" size="sm" className="h-7 text-xs text-blue-600">
                              <ExternalLink className="h-3 w-3 mr-1" />
                              Ver
                            </Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
