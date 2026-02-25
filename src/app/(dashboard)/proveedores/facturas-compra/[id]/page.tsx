'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Loader2,
  ArrowLeft,
  CheckCircle,
  FileText,
  Truck,
  Calendar,
  DollarSign,
  Package,
  Receipt,
  CreditCard,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatNumber } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface PurchaseInvoice {
  id: string
  invoiceNumber: string
  invoiceDate: string
  dueDate: string
  status: string
  paymentStatus: string
  voucherType: string
  invoiceType: string
  cae: string | null
  caeExpirationDate: string | null
  paymentTerms: string | null
  generalDiscount: number
  subtotal: number
  discountAmount: number
  netAmount: number
  taxAmount: number
  perceptionsAmount: number
  total: number
  balance: number
  description: string | null
  internalNotes: string | null
  stockImpact: boolean
  stockImpactedAt: string | null
  supplier: {
    id: string
    name: string
    taxId: string | null
    email: string | null
  }
  items: Array<{
    id: string
    description: string
    quantity: number
    listPrice: number
    discountPercent: number
    unitPrice: number
    subtotal: number
    taxRate: number
    taxAmount: number
    total: number
    product: {
      id: string
      name: string
      sku: string | null
    } | null
    account: {
      id: string
      code: string
      name: string
    } | null
  }>
  taxes: Array<{
    id: string
    taxType: string
    rate: number
    baseAmount: number
    taxAmount: number
  }>
  perceptions: Array<{
    id: string
    jurisdiction: string
    perceptionType: string
    regulation: string | null
    rate: number
    baseAmount: number
    amount: number
    account: {
      id: string
      code: string
      name: string
    } | null
  }>
  payments: Array<{
    id: string
    amount: number
    paymentDate: string
    paymentMethod: string
  }>
  journalEntry: {
    id: string
    entryNumber: number
    date: string
    description: string
    reference: string | null
    status: string
    lines: Array<{
      id: string
      accountId: string
      description: string
      debit: number
      credit: number
      account: {
        id: string
        code: string
        name: string
      }
    }>
  } | null
}

const statusLabels: Record<string, string> = {
  DRAFT: 'Borrador',
  PENDING: 'Pendiente',
  APPROVED: 'Aprobada',
  PAID: 'Pagada',
  CANCELLED: 'Anulada',
}

const statusColors: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-800',
  PENDING: 'bg-yellow-100 text-yellow-800',
  APPROVED: 'bg-blue-100 text-blue-800',
  PAID: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800',
}

export default function PurchaseInvoiceDetailPage() {
  const router = useRouter()
  const params = useParams()
  const [invoice, setInvoice] = useState<PurchaseInvoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState(false)

  // Payment dialog state
  const [showPaymentDialog, setShowPaymentDialog] = useState(false)
  const [registeringPayment, setRegisteringPayment] = useState(false)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0])
  const [paymentMethod, setPaymentMethod] = useState('TRANSFER')
  const [paymentReference, setPaymentReference] = useState('')
  const [paymentNotes, setPaymentNotes] = useState('')

  // Credit note dialog state
  const [showCreditNoteDialog, setShowCreditNoteDialog] = useState(false)
  const [creatingCreditNote, setCreatingCreditNote] = useState(false)
  const [creditNoteNumber, setCreditNoteNumber] = useState('')
  const [creditNoteDate, setCreditNoteDate] = useState(new Date().toISOString().split('T')[0])
  const [selectedItems, setSelectedItems] = useState<Array<{ originalItemId: string; quantity: number; reason: string }>>([])


  useEffect(() => {
    if (params.id) {
      fetchInvoice()
    }
  }, [params.id])

  const fetchInvoice = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/purchase-invoices/${params.id}`)

      if (!response.ok) {
        throw new Error('Error al cargar factura')
      }

      const data = await response.json()
      setInvoice(data)
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar factura de compra')
    } finally {
      setLoading(false)
    }
  }

  const handleApprove = async () => {
    if (!invoice) return

    try {
      setApproving(true)
      const response = await fetch(`/api/purchase-invoices/${invoice.id}/approve`, {
        method: 'POST',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error al aprobar factura')
      }

      toast.success('Factura aprobada correctamente')
      fetchInvoice()
    } catch (error: any) {
      console.error('Error:', error)
      toast.error(error.message || 'Error al aprobar factura de compra')
    } finally {
      setApproving(false)
    }
  }

  const handleRegisterPayment = async () => {
    if (!invoice) return

    // Validations
    if (!paymentAmount || parseFloat(paymentAmount) <= 0) {
      toast.error('Ingrese un monto válido')
      return
    }

    if (parseFloat(paymentAmount) > Number(invoice.balance)) {
      toast.error('El monto excede el saldo pendiente')
      return
    }

    try {
      setRegisteringPayment(true)

      const response = await fetch(`/api/purchase-invoices/${invoice.id}/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: parseFloat(paymentAmount),
          paymentDate,
          paymentMethod,
          reference: paymentReference || null,
          notes: paymentNotes || null,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error al registrar pago')
      }

      toast.success('Pago registrado correctamente')
      setShowPaymentDialog(false)
      // Reset form
      setPaymentAmount('')
      setPaymentDate(new Date().toISOString().split('T')[0])
      setPaymentMethod('TRANSFER')
      setPaymentReference('')
      setPaymentNotes('')
      // Refresh invoice
      fetchInvoice()
    } catch (error: any) {
      console.error('Error:', error)
      toast.error(error.message || 'Error al registrar pago')
    } finally {
      setRegisteringPayment(false)
    }
  }

  const handleCreateCreditNote = async () => {
    if (!invoice) return

    // Validations
    if (!creditNoteNumber) {
      toast.error('Ingrese el número de nota de crédito')
      return
    }

    if (selectedItems.length === 0) {
      toast.error('Debe seleccionar al menos un item para devolver')
      return
    }

    const invalidItems = selectedItems.filter((item) => !item.quantity || item.quantity <= 0)
    if (invalidItems.length > 0) {
      toast.error('Todas las cantidades deben ser mayores a cero')
      return
    }

    try {
      setCreatingCreditNote(true)

      const response = await fetch(`/api/purchase-invoices/${invoice.id}/credit-note`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          creditNoteNumber,
          creditNoteDate,
          items: selectedItems,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error al crear nota de crédito')
      }

      const data = await response.json()
      toast.success('Nota de crédito creada correctamente')
      setShowCreditNoteDialog(false)
      // Redirect to credit note detail
      router.push(`/proveedores/facturas-compra/${data.creditNote.id}`)
    } catch (error: any) {
      console.error('Error:', error)
      toast.error(error.message || 'Error al crear nota de crédito')
    } finally {
      setCreatingCreditNote(false)
    }
  }

  const handleToggleItem = (itemId: string, maxQuantity: number) => {
    const exists = selectedItems.find((item) => item.originalItemId === itemId)
    if (exists) {
      setSelectedItems(selectedItems.filter((item) => item.originalItemId !== itemId))
    } else {
      setSelectedItems([
        ...selectedItems,
        { originalItemId: itemId, quantity: maxQuantity, reason: '' },
      ])
    }
  }

  const handleUpdateItemQuantity = (itemId: string, quantity: number) => {
    setSelectedItems(
      selectedItems.map((item) =>
        item.originalItemId === itemId ? { ...item, quantity } : item
      )
    )
  }

  const handleUpdateItemReason = (itemId: string, reason: string) => {
    setSelectedItems(
      selectedItems.map((item) =>
        item.originalItemId === itemId ? { ...item, reason } : item
      )
    )
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

  if (!invoice) {
    return (
      <div className="container mx-auto px-6 py-8">
        <div className="text-center">
          <p className="text-gray-600">Factura no encontrada</p>
          <Button asChild className="mt-4">
            <Link href="/proveedores/facturas-compra">
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
            <Link href="/proveedores/facturas-compra">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Volver
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              Factura {invoice.invoiceNumber}
            </h1>
            <p className="text-gray-600 mt-1">{invoice.supplier.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge className={statusColors[invoice.status]}>
            {statusLabels[invoice.status]}
          </Badge>
          {invoice.status === 'PENDING' && (
            <Button
              onClick={handleApprove}
              disabled={approving}
              className="bg-green-600 hover:bg-green-700"
            >
              {approving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Aprobando...
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Aprobar Factura
                </>
              )}
            </Button>
          )}
          {(invoice.status === 'APPROVED' || invoice.status === 'PENDING') && Number(invoice.balance) > 0 && (
            <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
              <DialogTrigger asChild>
                <Button className="bg-blue-600 hover:bg-blue-700">
                  <CreditCard className="h-4 w-4 mr-2" />
                  Registrar Pago
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Registrar Pago</DialogTitle>
                  <DialogDescription>
                    Registre un pago para la factura {invoice.invoiceNumber}. Saldo pendiente: {formatCurrency(invoice.balance)}
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="paymentAmount">Monto *</Label>
                      <Input
                        id="paymentAmount"
                        type="number"
                        value={paymentAmount}
                        onChange={(e) => setPaymentAmount(e.target.value)}
                        placeholder="0.00"
                        step="0.01"
                        min="0"
                        max={Number(invoice.balance)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="paymentDate">Fecha *</Label>
                      <Input
                        id="paymentDate"
                        type="date"
                        value={paymentDate}
                        onChange={(e) => setPaymentDate(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="paymentMethod">Método de Pago *</Label>
                    <select
                      id="paymentMethod"
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="CASH">Efectivo</option>
                      <option value="TRANSFER">Transferencia</option>
                      <option value="CHECK">Cheque</option>
                      <option value="DEBIT">Débito</option>
                      <option value="CREDIT">Crédito</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="paymentReference">Referencia</Label>
                    <Input
                      id="paymentReference"
                      value={paymentReference}
                      onChange={(e) => setPaymentReference(e.target.value)}
                      placeholder="Número de transferencia, cheque, etc."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="paymentNotes">Notas</Label>
                    <Textarea
                      id="paymentNotes"
                      value={paymentNotes}
                      onChange={(e) => setPaymentNotes(e.target.value)}
                      placeholder="Notas adicionales..."
                      rows={3}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setShowPaymentDialog(false)}
                    disabled={registeringPayment}
                  >
                    Cancelar
                  </Button>
                  <Button
                    onClick={handleRegisterPayment}
                    disabled={registeringPayment}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {registeringPayment ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Registrando...
                      </>
                    ) : (
                      <>
                        <CreditCard className="h-4 w-4 mr-2" />
                        Registrar Pago
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
          {(invoice.status === 'APPROVED' || invoice.status === 'PAID') && invoice.invoiceType === 'FA' && (
            <Dialog open={showCreditNoteDialog} onOpenChange={setShowCreditNoteDialog}>
              <DialogTrigger asChild>
                <Button variant="outline" className="border-red-600 text-red-600 hover:bg-red-50">
                  <FileText className="h-4 w-4 mr-2" />
                  Nota de Crédito
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Generar Nota de Crédito</DialogTitle>
                  <DialogDescription>
                    Seleccione los items a devolver de la factura {invoice.invoiceNumber}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="creditNoteNumber">Número NC *</Label>
                      <Input
                        id="creditNoteNumber"
                        value={creditNoteNumber}
                        onChange={(e) => setCreditNoteNumber(e.target.value)}
                        placeholder="NC00001-00000001"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="creditNoteDate">Fecha NC *</Label>
                      <Input
                        id="creditNoteDate"
                        type="date"
                        value={creditNoteDate}
                        onChange={(e) => setCreditNoteDate(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="border rounded-lg p-4">
                    <h4 className="font-semibold mb-3">Items de la Factura</h4>
                    <div className="space-y-3">
                      {invoice.items.map((item) => {
                        const isSelected = selectedItems.find((si) => si.originalItemId === item.id)
                        return (
                          <div key={item.id} className="border rounded p-3">
                            <div className="flex items-start gap-3">
                              <input
                                type="checkbox"
                                checked={!!isSelected}
                                onChange={() => handleToggleItem(item.id, Number(item.quantity))}
                                className="mt-1"
                              />
                              <div className="flex-1">
                                <div className="flex justify-between">
                                  <div>
                                    <p className="font-medium">{item.description}</p>
                                    <p className="text-sm text-gray-500">
                                      Cantidad original: {Number(item.quantity)} -
                                      Precio: {formatCurrency(item.unitPrice)}
                                    </p>
                                  </div>
                                  <p className="font-semibold">{formatCurrency(item.total)}</p>
                                </div>
                                {isSelected && (
                                  <div className="grid grid-cols-2 gap-2 mt-2">
                                    <div className="space-y-1">
                                      <Label htmlFor={`qty-${item.id}`} className="text-xs">
                                        Cantidad a devolver
                                      </Label>
                                      <Input
                                        id={`qty-${item.id}`}
                                        type="number"
                                        value={isSelected.quantity}
                                        onChange={(e) =>
                                          handleUpdateItemQuantity(item.id, parseInt(e.target.value) || 0)
                                        }
                                        min="1"
                                        max={Number(item.quantity)}
                                        className="h-8"
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <Label htmlFor={`reason-${item.id}`} className="text-xs">
                                        Motivo
                                      </Label>
                                      <Input
                                        id={`reason-${item.id}`}
                                        value={isSelected.reason}
                                        onChange={(e) =>
                                          handleUpdateItemReason(item.id, e.target.value)
                                        }
                                        placeholder="Defectuoso, incorrecto..."
                                        className="h-8"
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {selectedItems.length > 0 && (
                    <div className="bg-blue-50 rounded-lg p-4">
                      <h4 className="font-semibold mb-2">Resumen de Devolución</h4>
                      <p className="text-sm text-gray-600">
                        {selectedItems.length} item(s) seleccionado(s)
                      </p>
                      <p className="text-sm text-gray-600">
                        Total a devolver: {formatCurrency(
                          selectedItems.reduce((sum, si) => {
                            const item = invoice.items.find((i) => i.id === si.originalItemId)
                            if (!item) return sum
                            return sum + (Number(item.unitPrice) * si.quantity)
                          }, 0)
                        )}
                      </p>
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setShowCreditNoteDialog(false)}
                    disabled={creatingCreditNote}
                  >
                    Cancelar
                  </Button>
                  <Button
                    onClick={handleCreateCreditNote}
                    disabled={creatingCreditNote}
                    className="bg-red-600 hover:bg-red-700"
                  >
                    {creatingCreditNote ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Generando...
                      </>
                    ) : (
                      <>
                        <FileText className="h-4 w-4 mr-2" />
                        Generar NC
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
                <p className="text-sm text-gray-600">Fecha</p>
                <p className="font-semibold">{formatDate(invoice.invoiceDate)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Calendar className="h-8 w-8 text-orange-500" />
              <div>
                <p className="text-sm text-gray-600">Vencimiento</p>
                <p className="font-semibold">{formatDate(invoice.dueDate)}</p>
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
                <p className="font-semibold text-lg">{formatCurrency(invoice.total)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <DollarSign className="h-8 w-8 text-red-500" />
              <div>
                <p className="text-sm text-gray-600">Saldo</p>
                <p className="font-semibold text-lg">{formatCurrency(invoice.balance)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="factura" className="space-y-6">
        <TabsList>
          <TabsTrigger value="factura">Información de Factura</TabsTrigger>
          <TabsTrigger value="adicional">Información Adicional</TabsTrigger>
        </TabsList>

        {/* Tab: Información de Factura */}
        <TabsContent value="factura" className="space-y-6">
          {/* Supplier Info */}
          <Card>
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
                  <p className="font-semibold">{invoice.supplier.name}</p>
                </div>
                {invoice.supplier.taxId && (
                  <div>
                    <p className="text-sm text-gray-600">CUIT</p>
                    <p className="font-semibold">{invoice.supplier.taxId}</p>
                  </div>
                )}
                {invoice.supplier.email && (
                  <div>
                    <p className="text-sm text-gray-600">Email</p>
                    <p className="font-semibold">{invoice.supplier.email}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Invoice Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Receipt className="h-5 w-5" />
                Datos de Factura
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Tipo Comprobante</p>
                  <p className="font-semibold">Factura {invoice.voucherType}</p>
                </div>
                {invoice.cae && (
                  <div>
                    <p className="text-sm text-gray-600">CAE</p>
                    <p className="font-mono font-semibold">{invoice.cae}</p>
                  </div>
                )}
                {invoice.caeExpirationDate && (
                  <div>
                    <p className="text-sm text-gray-600">Vencimiento CAE</p>
                    <p className="font-semibold">
                      {formatDate(invoice.caeExpirationDate)}
                    </p>
                  </div>
                )}
                {invoice.paymentTerms && (
                  <div>
                    <p className="text-sm text-gray-600">Condiciones de Pago</p>
                    <p className="font-semibold">{invoice.paymentTerms}</p>
                  </div>
                )}
                {invoice.description && (
                  <div className="md:col-span-3">
                    <p className="text-sm text-gray-600">Descripción</p>
                    <p className="font-semibold">{invoice.description}</p>
                  </div>
                )}
                {invoice.stockImpact && (
                  <div>
                    <p className="text-sm text-gray-600">Impacto en Stock</p>
                    <Badge variant="outline" className="bg-green-50 text-green-700">
                      ✓ Aplicado {invoice.stockImpactedAt && `el ${formatDate(invoice.stockImpactedAt)}`}
                    </Badge>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Items */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                Items de Factura
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Descripción</TableHead>
                      <TableHead className="text-right">Cantidad</TableHead>
                      <TableHead className="text-right">Precio Lista</TableHead>
                      <TableHead className="text-right">Descuento</TableHead>
                      <TableHead className="text-right">Precio Unit.</TableHead>
                      <TableHead className="text-right">Subtotal</TableHead>
                      <TableHead className="text-right">IVA ({invoice.items[0]?.taxRate || 21}%)</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoice.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{item.description}</p>
                            {item.product && (
                              <p className="text-sm text-gray-500">
                                SKU: {item.product.sku || item.product.id}
                              </p>
                            )}
                            {item.account && (
                              <p className="text-xs text-gray-400">
                                Cuenta: {item.account.code} - {item.account.name}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {formatNumber(item.quantity)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(item.listPrice)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatNumber(item.discountPercent)}%
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(item.unitPrice)}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {formatCurrency(item.subtotal)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(item.taxAmount)}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {formatCurrency(item.total)}
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
                      <span className="font-semibold">
                        {formatCurrency(invoice.subtotal)}
                      </span>
                    </div>
                    {invoice.generalDiscount > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">
                          Descuento General ({formatNumber(invoice.generalDiscount)}%):
                        </span>
                        <span className="font-semibold text-red-600">
                          -{formatCurrency(invoice.discountAmount)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-gray-600">Neto:</span>
                      <span className="font-semibold">
                        {formatCurrency(invoice.netAmount)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">IVA:</span>
                      <span className="font-semibold">
                        {formatCurrency(invoice.taxAmount)}
                      </span>
                    </div>
                    {invoice.perceptionsAmount > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Percepciones:</span>
                        <span className="font-semibold">
                          {formatCurrency(invoice.perceptionsAmount)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between text-lg border-t pt-2">
                      <span className="font-bold">Total:</span>
                      <span className="font-bold text-blue-600">
                        {formatCurrency(invoice.total)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Taxes */}
          {invoice.taxes.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Detalle de Impuestos</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tipo</TableHead>
                      <TableHead className="text-right">Alícuota</TableHead>
                      <TableHead className="text-right">Base Imponible</TableHead>
                      <TableHead className="text-right">Importe</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoice.taxes.map((tax) => (
                      <TableRow key={tax.id}>
                        <TableCell>{tax.taxType}</TableCell>
                        <TableCell className="text-right">
                          {formatNumber(tax.rate)}%
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(tax.baseAmount)}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {formatCurrency(tax.taxAmount)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Perceptions */}
          {invoice.perceptions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Percepciones IIBB</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Jurisdicción</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Regulación</TableHead>
                      <TableHead className="text-right">Alícuota</TableHead>
                      <TableHead className="text-right">Base</TableHead>
                      <TableHead className="text-right">Importe</TableHead>
                      <TableHead>Cuenta</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoice.perceptions.map((perception) => (
                      <TableRow key={perception.id}>
                        <TableCell>{perception.jurisdiction}</TableCell>
                        <TableCell>{perception.perceptionType}</TableCell>
                        <TableCell>{perception.regulation || '-'}</TableCell>
                        <TableCell className="text-right">
                          {formatNumber(perception.rate)}%
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(perception.baseAmount)}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {formatCurrency(perception.amount)}
                        </TableCell>
                        <TableCell>
                          {perception.account ? (
                            <span className="text-xs">
                              {perception.account.code} - {perception.account.name}
                            </span>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Tab: Información Adicional */}
        <TabsContent value="adicional" className="space-y-6">
          {/* Journal Entry */}
          {invoice.journalEntry ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Asiento Contable #{invoice.journalEntry.entryNumber}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="mb-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <p className="text-sm text-gray-600">Fecha</p>
                      <p className="font-semibold">
                        {formatDate(invoice.journalEntry.date)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Estado</p>
                      <Badge variant="outline" className="bg-green-50 text-green-700">
                        {invoice.journalEntry.status}
                      </Badge>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Referencia</p>
                      <p className="font-semibold">
                        {invoice.journalEntry.reference || '-'}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4">
                    <p className="text-sm text-gray-600">Descripción</p>
                    <p className="font-semibold">{invoice.journalEntry.description}</p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Código</TableHead>
                        <TableHead>Cuenta</TableHead>
                        <TableHead>Descripción</TableHead>
                        <TableHead className="text-right">Debe</TableHead>
                        <TableHead className="text-right">Haber</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoice.journalEntry.lines.map((line) => (
                        <TableRow key={line.id}>
                          <TableCell className="font-mono">
                            {line.account.code}
                          </TableCell>
                          <TableCell>{line.account.name}</TableCell>
                          <TableCell className="text-gray-600">
                            {line.description}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {Number(line.debit) > 0
                              ? formatCurrency(line.debit)
                              : '-'}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {Number(line.credit) > 0
                              ? formatCurrency(line.credit)
                              : '-'}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-bold border-t-2">
                        <TableCell colSpan={3} className="text-right">
                          Totales:
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(
                            invoice.journalEntry.lines.reduce(
                              (sum, line) => sum + Number(line.debit),
                              0
                            )
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(
                            invoice.journalEntry.lines.reduce(
                              (sum, line) => sum + Number(line.credit),
                              0
                            )
                          )}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <FileText className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-600">
                  No hay asiento contable generado
                </p>
                <p className="text-sm text-gray-500 mt-2">
                  El asiento se generará automáticamente al aprobar la factura
                </p>
              </CardContent>
            </Card>
          )}

          {/* Payments */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                Historial de Pagos
              </CardTitle>
            </CardHeader>
            <CardContent>
              {invoice.payments.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Método</TableHead>
                      <TableHead className="text-right">Importe</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoice.payments.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell>{formatDate(payment.paymentDate)}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{payment.paymentMethod}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {formatCurrency(payment.amount)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-8">
                  <p className="text-gray-600">No hay pagos registrados</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Internal Notes */}
          {invoice.internalNotes && (
            <Card>
              <CardHeader>
                <CardTitle>Notas Internas</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-700 whitespace-pre-wrap">
                  {invoice.internalNotes}
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
