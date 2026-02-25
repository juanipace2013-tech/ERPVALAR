'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Loader2,
  ArrowLeft,
  Calendar,
  DollarSign,
  Package,
  Truck,
  FileText,
  CheckCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatNumber } from '@/lib/utils'

interface PurchaseOrder {
  id: string
  orderNumber: string
  orderDate: string
  expectedDate: string | null
  receivedDate: string | null
  status: string
  currency: string
  subtotal: number
  taxAmount: number
  discount: number
  total: number
  notes: string | null
  supplier: {
    id: string
    name: string
    taxId: string | null
    email: string | null
  }
  items: Array<{
    id: string
    quantity: number
    receivedQty: number
    unitCost: number
    discount: number
    taxRate: number
    subtotal: number
    description: string | null
    product: {
      id: string
      name: string
      sku: string | null
    }
  }>
  user: {
    id: string
    name: string
    email: string
  }
  purchaseInvoices: Array<{
    id: string
    invoiceNumber: string
    invoiceDate: string
    total: number
    status: string
  }>
}

const statusLabels: Record<string, string> = {
  DRAFT: 'Borrador',
  PENDING: 'Pendiente',
  APPROVED: 'Aprobada',
  RECEIVED: 'Recibida',
  PARTIALLY_RECEIVED: 'Parcialmente Recibida',
  CANCELLED: 'Anulada',
}

const statusColors: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-800',
  PENDING: 'bg-yellow-100 text-yellow-800',
  APPROVED: 'bg-blue-100 text-blue-800',
  RECEIVED: 'bg-green-100 text-green-800',
  PARTIALLY_RECEIVED: 'bg-orange-100 text-orange-800',
  CANCELLED: 'bg-red-100 text-red-800',
}

export default function PurchaseOrderDetailPage() {
  const router = useRouter()
  const params = useParams()
  const [order, setOrder] = useState<PurchaseOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [converting, setConverting] = useState(false)
  const [showConvertDialog, setShowConvertDialog] = useState(false)

  // Convert to invoice form data
  const [voucherType, setVoucherType] = useState('A')
  const [pointOfSale, setPointOfSale] = useState('')
  const [invoiceNumberSuffix, setInvoiceNumberSuffix] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0])
  const [dueDate, setDueDate] = useState('')
  const [paymentTerms, setPaymentTerms] = useState('')
  const [generalDiscount, setGeneralDiscount] = useState(0)

  useEffect(() => {
    if (params.id) {
      fetchOrder()
    }
  }, [params.id])

  const fetchOrder = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/purchase-orders/${params.id}`)

      if (!response.ok) {
        throw new Error('Error al cargar orden')
      }

      const data = await response.json()
      setOrder(data)
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar orden de compra')
    } finally {
      setLoading(false)
    }
  }

  const handleConvertToInvoice = async () => {
    if (!order) return

    // Validations
    if (!voucherType || !pointOfSale || !invoiceNumberSuffix) {
      toast.error('Complete todos los campos requeridos de la factura')
      return
    }

    try {
      setConverting(true)

      const response = await fetch(`/api/purchase-orders/${order.id}/convert-to-invoice`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          voucherType,
          pointOfSale,
          invoiceNumberSuffix,
          invoiceDate,
          dueDate: dueDate || new Date(new Date(invoiceDate).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          paymentTerms: paymentTerms || null,
          generalDiscount,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error al convertir orden')
      }

      const data = await response.json()
      toast.success('Orden convertida a factura correctamente')
      setShowConvertDialog(false)
      router.push(`/proveedores/facturas-compra/${data.id}`)
    } catch (error: any) {
      console.error('Error:', error)
      toast.error(error.message || 'Error al convertir orden a factura')
    } finally {
      setConverting(false)
    }
  }

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  }

  const formatCurrency = (amount: number) => {
    return `$${Number(amount).toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

  if (!order) {
    return (
      <div className="container mx-auto px-6 py-8">
        <div className="text-center">
          <p className="text-gray-600">Orden de compra no encontrada</p>
          <Button asChild className="mt-4">
            <Link href="/proveedores/ordenes-compra">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Volver al listado
            </Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Button variant="outline" asChild>
            <Link href="/proveedores/ordenes-compra">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Volver
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              Orden {order.orderNumber}
            </h1>
            <p className="text-gray-600 mt-1">{order.supplier.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge className={statusColors[order.status]}>
            {statusLabels[order.status]}
          </Badge>
          {(order.status === 'APPROVED' || order.status === 'PENDING') && (
            <Dialog open={showConvertDialog} onOpenChange={setShowConvertDialog}>
              <DialogTrigger asChild>
                <Button className="bg-green-600 hover:bg-green-700">
                  <FileText className="h-4 w-4 mr-2" />
                  Generar Factura
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Convertir a Factura de Compra</DialogTitle>
                  <DialogDescription>
                    Complete los datos para generar una factura de compra basada en esta orden
                  </DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="voucherType">Tipo Comprobante *</Label>
                    <select
                      id="voucherType"
                      value={voucherType}
                      onChange={(e) => setVoucherType(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="A">A - Factura A</option>
                      <option value="B">B - Factura B</option>
                      <option value="C">C - Factura C</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="invoiceDate">Fecha Factura *</Label>
                    <Input
                      id="invoiceDate"
                      type="date"
                      value={invoiceDate}
                      onChange={(e) => setInvoiceDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pointOfSale">Punto de Venta *</Label>
                    <Input
                      id="pointOfSale"
                      value={pointOfSale}
                      onChange={(e) => setPointOfSale(e.target.value)}
                      placeholder="00001"
                      maxLength={5}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="invoiceNumberSuffix">Número *</Label>
                    <Input
                      id="invoiceNumberSuffix"
                      value={invoiceNumberSuffix}
                      onChange={(e) => setInvoiceNumberSuffix(e.target.value)}
                      placeholder="00000001"
                      maxLength={8}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dueDate">Fecha Vencimiento</Label>
                    <Input
                      id="dueDate"
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="generalDiscount">Descuento General %</Label>
                    <Input
                      id="generalDiscount"
                      type="number"
                      value={generalDiscount}
                      onChange={(e) => setGeneralDiscount(parseFloat(e.target.value) || 0)}
                      step="0.01"
                      min="0"
                      max="100"
                    />
                  </div>
                  <div className="col-span-2 space-y-2">
                    <Label htmlFor="paymentTerms">Condiciones de Pago</Label>
                    <Input
                      id="paymentTerms"
                      value={paymentTerms}
                      onChange={(e) => setPaymentTerms(e.target.value)}
                      placeholder="Ej: Cuenta corriente 30 días"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setShowConvertDialog(false)}
                    disabled={converting}
                  >
                    Cancelar
                  </Button>
                  <Button
                    onClick={handleConvertToInvoice}
                    disabled={converting}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    {converting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Generando...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Generar Factura
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Calendar className="h-8 w-8 text-blue-500" />
              <div>
                <p className="text-sm text-gray-600">Fecha Orden</p>
                <p className="font-semibold">{formatDate(order.orderDate)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Calendar className="h-8 w-8 text-orange-500" />
              <div>
                <p className="text-sm text-gray-600">Fecha Esperada</p>
                <p className="font-semibold">
                  {order.expectedDate ? formatDate(order.expectedDate) : '-'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <DollarSign className="h-8 w-8 text-green-500" />
              <div>
                <p className="text-sm text-gray-600">Total</p>
                <p className="font-semibold text-lg">{formatCurrency(order.total)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Package className="h-8 w-8 text-purple-500" />
              <div>
                <p className="text-sm text-gray-600">Items</p>
                <p className="font-semibold text-lg">{order.items.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Supplier Info */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            Información del Proveedor
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-sm text-gray-600">Nombre</p>
              <p className="font-semibold">{order.supplier.name}</p>
            </div>
            {order.supplier.taxId && (
              <div>
                <p className="text-sm text-gray-600">CUIT</p>
                <p className="font-semibold">{order.supplier.taxId}</p>
              </div>
            )}
            {order.supplier.email && (
              <div>
                <p className="text-sm text-gray-600">Email</p>
                <p className="font-semibold">{order.supplier.email}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Items */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Items de la Orden
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead className="text-right">Recibido</TableHead>
                  <TableHead className="text-right">Costo Unit.</TableHead>
                  <TableHead className="text-right">Desc %</TableHead>
                  <TableHead className="text-right">IVA %</TableHead>
                  <TableHead className="text-right">Subtotal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{item.product.name}</p>
                        {item.product.sku && (
                          <p className="text-sm text-gray-500">SKU: {item.product.sku}</p>
                        )}
                        {item.description && (
                          <p className="text-xs text-gray-400">{item.description}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{item.quantity}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={item.receivedQty >= item.quantity ? 'default' : 'outline'}>
                        {item.receivedQty}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(item.unitCost)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatNumber(item.discount)}%
                    </TableCell>
                    <TableCell className="text-right">
                      {formatNumber(item.taxRate)}%
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {formatCurrency(item.subtotal)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Totals */}
          <div className="border-t mt-4 pt-4">
            <div className="flex justify-end">
              <div className="w-full md:w-1/2 space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-600">Subtotal:</span>
                  <span className="font-semibold">{formatCurrency(order.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">IVA:</span>
                  <span className="font-semibold">{formatCurrency(order.taxAmount)}</span>
                </div>
                {order.discount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Descuento:</span>
                    <span className="font-semibold text-red-600">
                      -{formatCurrency(order.discount)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-lg border-t pt-2">
                  <span className="font-bold">Total:</span>
                  <span className="font-bold text-blue-600">
                    {formatCurrency(order.total)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Purchase Invoices */}
      {order.purchaseInvoices.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Facturas Generadas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Número</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.purchaseInvoices.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-mono font-semibold">
                      {invoice.invoiceNumber}
                    </TableCell>
                    <TableCell>{formatDate(invoice.invoiceDate)}</TableCell>
                    <TableCell className="text-right font-semibold">
                      {formatCurrency(invoice.total)}
                    </TableCell>
                    <TableCell>
                      <Badge>{invoice.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        asChild
                      >
                        <Link href={`/proveedores/facturas-compra/${invoice.id}`}>
                          Ver
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Notes */}
      {order.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Notas</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-700 whitespace-pre-wrap">{order.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
