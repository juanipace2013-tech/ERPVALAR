'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { Receipt, Plus, Search, FileText, CheckCircle2, Clock } from 'lucide-react'
import { toast } from 'sonner'

interface Invoice {
  id: string
  invoiceNumber: string
  invoiceType: string
  status: string
  total: number
  currency: string
  issueDate: string
  dueDate: string
  customer: {
    name: string
    cuit: string
  }
  _count?: {
    stockMovements: number
    journalEntries: number
  }
}

const statusLabels: Record<string, string> = {
  DRAFT: 'Borrador',
  PENDING: 'Pendiente',
  AUTHORIZED: 'Autorizada',
  SENT: 'Enviada',
  PAID: 'Pagada',
  OVERDUE: 'Vencida',
  CANCELLED: 'Cancelada',
}

const statusColors: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-800',
  PENDING: 'bg-yellow-100 text-yellow-800',
  AUTHORIZED: 'bg-blue-100 text-blue-800',
  SENT: 'bg-purple-100 text-purple-800',
  PAID: 'bg-green-100 text-green-800',
  OVERDUE: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-gray-100 text-gray-800',
}

const typeLabels: Record<string, string> = {
  A: 'Factura A',
  B: 'Factura B',
  C: 'Factura C',
  E: 'Factura E',
}

export default function FacturasPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetchInvoices()
  }, [])

  const fetchInvoices = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/facturas?limit=50')

      if (!response.ok) {
        throw new Error('Error al cargar facturas')
      }

      const data = await response.json()
      setInvoices(data.invoices || [])
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar facturas')
    } finally {
      setLoading(false)
    }
  }

  const filteredInvoices = invoices.filter(invoice =>
    invoice.invoiceNumber.toLowerCase().includes(search.toLowerCase()) ||
    invoice.customer.name.toLowerCase().includes(search.toLowerCase()) ||
    invoice.customer.cuit.includes(search)
  )

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('es-AR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
  }

  const formatCurrency = (amount: number, currency: string) => {
    const symbol = (currency || 'ARS') === 'USD' ? 'USD' : 'ARS'
    return `${symbol} ${amount.toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`
  }

  const totalAmount = invoices
    .filter(i => i.status !== 'CANCELLED')
    .reduce((sum, i) => sum + Number(i.total), 0)

  const paidAmount = invoices
    .filter(i => i.status === 'PAID')
    .reduce((sum, i) => sum + Number(i.total), 0)

  const pendingAmount = invoices
    .filter(i => ['AUTHORIZED', 'SENT'].includes(i.status))
    .reduce((sum, i) => sum + Number(i.total), 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Facturas</h1>
          <p className="text-muted-foreground">
            Gestión de facturación con descuento automático de stock
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/facturas/nueva">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Nueva Factura
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Facturado</CardTitle>
            <Receipt className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(totalAmount, 'ARS')}
            </div>
            <p className="text-xs text-muted-foreground">
              {invoices.length} facturas emitidas
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pagadas</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {formatCurrency(paidAmount, 'ARS')}
            </div>
            <p className="text-xs text-muted-foreground">
              {invoices.filter(i => i.status === 'PAID').length} facturas
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pendientes</CardTitle>
            <Clock className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              {formatCurrency(pendingAmount, 'ARS')}
            </div>
            <p className="text-xs text-muted-foreground">
              {invoices.filter(i => ['AUTHORIZED', 'SENT'].includes(i.status)).length} facturas
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Con Inventario</CardTitle>
            <FileText className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {invoices.filter(i => i._count && i._count.stockMovements > 0).length}
            </div>
            <p className="text-xs text-muted-foreground">
              Stock descontado automáticamente
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Invoices Table */}
      <Card>
        <CardHeader>
          <CardTitle>Listado de Facturas</CardTitle>
          <CardDescription>
            Todas las facturas emitidas con integración de inventario
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por número, cliente o CUIT..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : filteredInvoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Receipt className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                {search ? 'No se encontraron facturas' : 'No hay facturas registradas'}
              </p>
              {!search && (
                <Link href="/facturas/nueva">
                  <Button className="mt-4" variant="outline">
                    <Plus className="mr-2 h-4 w-4" />
                    Crear primera factura
                  </Button>
                </Link>
              )}
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Número</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Fecha Emisión</TableHead>
                    <TableHead>Vencimiento</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-center">Stock</TableHead>
                    <TableHead className="text-center">Asiento</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredInvoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-mono font-semibold">
                        {invoice.invoiceNumber}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {typeLabels[invoice.invoiceType]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">{invoice.customer.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {invoice.customer.cuit}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={statusColors[invoice.status]}>
                          {statusLabels[invoice.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatDate(invoice.issueDate)}</TableCell>
                      <TableCell>{formatDate(invoice.dueDate)}</TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatCurrency(Number(invoice.total), invoice.currency)}
                      </TableCell>
                      <TableCell className="text-center">
                        {invoice._count && invoice._count.stockMovements > 0 ? (
                          <Badge className="bg-green-100 text-green-800">
                            ✓
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {invoice._count && invoice._count.journalEntries > 0 ? (
                          <Badge className="bg-blue-100 text-blue-800">
                            ✓
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={`/facturas/${invoice.id}`}>
                          <Button variant="ghost" size="sm">
                            Ver Detalle
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
