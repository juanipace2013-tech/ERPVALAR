'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Loader2, FileText, Printer, Download, Mail, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'

interface InvoiceItem {
  id: string
  description: string
  quantity: number
  unitPrice: number
  discount: number
  taxRate: number
  subtotal: number
  product?: {
    id: string
    name: string
    sku: string
  }
}

interface Invoice {
  id: string
  invoiceNumber: string
  invoiceType: string
  status: string
  currency: string
  issueDate: string
  dueDate: string
  notes: string | null
  customer: {
    id: string
    name: string
    cuit: string
    email: string | null
    phone: string | null
    address: string | null
  }
  items: InvoiceItem[]
  subtotal: number
  taxAmount: number
  discount: number
  total: number
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

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchInvoice()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const fetchInvoice = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/facturas/${id}`)

      if (!response.ok) {
        throw new Error('Error al cargar factura')
      }

      const data = await response.json()
      setInvoice(data)
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar factura')
      router.push('/facturas')
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (amount: number, currency: string = 'ARS') => {
    const symbol = currency === 'USD' ? 'USD' : 'ARS'
    return `${symbol} ${amount.toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`
  }

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">Cargando factura...</p>
        </div>
      </div>
    )
  }

  if (!invoice) {
    return (
      <div className="container mx-auto px-6 py-8">
        <Card>
          <CardContent className="text-center py-12">
            <FileText className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-600">Factura no encontrada</p>
            <Button asChild className="mt-4">
              <Link href="/facturas">Volver a Facturas</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/facturas">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              {typeLabels[invoice.invoiceType]} {invoice.invoiceNumber}
            </h1>
            <p className="text-sm text-gray-600 mt-1">
              Cliente: {invoice.customer.name}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={statusColors[invoice.status]}>
            {statusLabels[invoice.status]}
          </Badge>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 mb-6">
        <Button variant="outline" asChild>
          <Link href={`/facturas/${id}/imprimir`}>
            <Printer className="h-4 w-4 mr-2" />
            Imprimir
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href={`/facturas/${id}/imprimir`}>
            <Download className="h-4 w-4 mr-2" />
            Descargar PDF
          </Link>
        </Button>
        <Button variant="outline">
          <Mail className="h-4 w-4 mr-2" />
          Enviar por Email
        </Button>
        {invoice.status === 'AUTHORIZED' && (
          <Button variant="default">
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Marcar como Pagada
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Información Principal */}
        <div className="lg:col-span-2 space-y-6">
          {/* Datos de la Factura */}
          <Card>
            <CardHeader>
              <CardTitle>Información de la Factura</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Número de Factura</p>
                  <p className="font-semibold">{invoice.invoiceNumber}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Tipo</p>
                  <p className="font-semibold">{typeLabels[invoice.invoiceType]}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Fecha de Emisión</p>
                  <p className="font-semibold">{formatDate(invoice.issueDate)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Fecha de Vencimiento</p>
                  <p className="font-semibold">{formatDate(invoice.dueDate)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Moneda</p>
                  <p className="font-semibold">{invoice.currency}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Estado</p>
                  <Badge className={statusColors[invoice.status]}>
                    {statusLabels[invoice.status]}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Items */}
          <Card>
            <CardHeader>
              <CardTitle>Detalles de Productos/Servicios</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50">
                      <TableHead>Descripción</TableHead>
                      <TableHead className="text-right">Cantidad</TableHead>
                      <TableHead className="text-right">Precio Unit.</TableHead>
                      <TableHead className="text-right">Desc. %</TableHead>
                      <TableHead className="text-right">IVA %</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoice.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{item.description}</TableCell>
                        <TableCell className="text-right">{item.quantity}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(item.unitPrice, invoice.currency)}
                        </TableCell>
                        <TableCell className="text-right">{item.discount}%</TableCell>
                        <TableCell className="text-right">{item.taxRate}%</TableCell>
                        <TableCell className="text-right font-semibold">
                          {formatCurrency(item.subtotal, invoice.currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Totales */}
              <div className="mt-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Subtotal:</span>
                  <span className="font-semibold">
                    {formatCurrency(invoice.subtotal, invoice.currency)}
                  </span>
                </div>
                {invoice.discount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Descuento:</span>
                    <span className="font-semibold text-red-600">
                      -{formatCurrency(invoice.discount, invoice.currency)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">IVA:</span>
                  <span className="font-semibold">
                    {formatCurrency(invoice.taxAmount, invoice.currency)}
                  </span>
                </div>
                <div className="flex justify-between text-lg pt-2 border-t">
                  <span className="font-bold">Total:</span>
                  <span className="font-bold text-blue-600">
                    {formatCurrency(invoice.total, invoice.currency)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Notas */}
          {invoice.notes && (
            <Card>
              <CardHeader>
                <CardTitle>Notas</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-700">{invoice.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Información del Cliente */}
          <Card>
            <CardHeader>
              <CardTitle>Cliente</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-sm text-gray-600">Nombre</p>
                <p className="font-semibold">{invoice.customer.name}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">CUIT</p>
                <p className="font-mono text-sm">{invoice.customer.cuit}</p>
              </div>
              {invoice.customer.email && (
                <div>
                  <p className="text-sm text-gray-600">Email</p>
                  <p className="text-sm">{invoice.customer.email}</p>
                </div>
              )}
              {invoice.customer.phone && (
                <div>
                  <p className="text-sm text-gray-600">Teléfono</p>
                  <p className="text-sm">{invoice.customer.phone}</p>
                </div>
              )}
              {invoice.customer.address && (
                <div>
                  <p className="text-sm text-gray-600">Dirección</p>
                  <p className="text-sm">{invoice.customer.address}</p>
                </div>
              )}
              <Button variant="outline" className="w-full mt-2" asChild>
                <Link href={`/clientes/${invoice.customer.id}`}>
                  Ver Cliente
                </Link>
              </Button>
            </CardContent>
          </Card>

          {/* Resumen */}
          <Card>
            <CardHeader>
              <CardTitle>Resumen</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Productos:</span>
                <span className="font-semibold">{invoice.items.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Unidades:</span>
                <span className="font-semibold">
                  {invoice.items.reduce((sum, item) => sum + item.quantity, 0)}
                </span>
              </div>
              <div className="flex justify-between text-sm pt-2 border-t">
                <span className="font-semibold">Total:</span>
                <span className="font-bold text-blue-600">
                  {formatCurrency(invoice.total, invoice.currency)}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
