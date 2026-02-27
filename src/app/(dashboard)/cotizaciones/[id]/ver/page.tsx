'use client'

import { useState, useEffect, useRef } from 'react'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  ArrowLeft,
  Loader2,
  FileText,
  Send,
  CheckCircle2,
  XCircle,
  Package,
  FileSpreadsheet,
  Clock,
  Pencil,
  Download,
  ShieldCheck,
  Undo2,
  Ban,
  RotateCcw,
  AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatNumber } from '@/lib/utils'
import { SendQuoteDialog } from '@/components/quotes/SendQuoteDialog'
import { SendToColppyDialog } from '@/components/quotes/SendToColppyDialog'

interface Quote {
  id: string
  quoteNumber: string
  status: string
  date: string
  validUntil: string | null
  currency: string
  exchangeRate: number | null
  subtotal: number
  bonification: number
  total: number
  terms: string | null
  notes: string | null
  internalNotes: string | null
  statusUpdatedAt: string | null
  customerResponse: string | null
  rejectionReason: string | null
  responseDate: string | null
  customer: {
    id: string
    name: string
    businessName: string | null
    cuit: string
    taxCondition: string
    email: string | null
    phone: string | null
    address: string | null
  }
  salesPerson: {
    id: string
    name: string
    email: string
  }
  items: any[]
  deliveryNotes: Array<{
    id: string
    deliveryNumber: string
    date: string
    deliveryDate: string | null
    status: string
  }>
  invoices: Array<{
    id: string
    invoiceNumber: string
    invoiceType: string
    issueDate: string
    total: number
    status: string
    afipStatus: string
    paymentStatus: string
  }>
  statusHistory: Array<{
    id: string
    fromStatus: string
    toStatus: string
    changedBy: string
    notes: string | null
    createdAt: string
  }>
}

const statusLabels: Record<string, string> = {
  DRAFT: '📝 Borrador',
  SENT: '📧 Enviada',
  ACCEPTED: '✅ Aceptada',
  REJECTED: '❌ Rechazada',
  EXPIRED: '⏰ Vencida',
  CANCELLED: '🚫 Cancelada',
  CONVERTED: '🔄 Convertida',
}

const statusColors: Record<string, string> = {
  DRAFT: 'bg-blue-100 text-blue-800 border border-blue-200',
  SENT: 'bg-yellow-100 text-yellow-800 border border-yellow-200',
  ACCEPTED: 'bg-green-100 text-green-800 border border-green-200',
  REJECTED: 'bg-red-100 text-red-800 border border-red-200',
  EXPIRED: 'bg-gray-100 text-gray-800 border border-gray-200',
  CANCELLED: 'bg-gray-100 text-gray-600 border border-gray-200',
  CONVERTED: 'bg-purple-100 text-purple-800 border border-purple-200',
}

const deliveryNoteStatusLabels: Record<string, string> = {
  PENDING: 'Pendiente',
  PREPARING: 'En preparación',
  READY: 'Listo',
  DISPATCHED: 'Despachado',
  DELIVERED: 'Entregado',
  CANCELLED: 'Cancelado',
}

export default function QuoteViewPage() {
  const params = useParams()
  const router = useRouter()
  const id = params?.id as string

  const [quote, setQuote] = useState<Quote | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [pdfLoading, setPdfLoading] = useState(false)

  // Dialogs
  const [showSendDialog, setShowSendDialog] = useState(false)
  const [showRejectDialog, setShowRejectDialog] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')
  const [showAcceptDialog, setShowAcceptDialog] = useState(false)
  const [customerResponse, setCustomerResponse] = useState('')
  const [showColppyDialog, setShowColppyDialog] = useState(false)

  // Revert dialog
  const [showRevertDialog, setShowRevertDialog] = useState(false)
  const [revertTarget, setRevertTarget] = useState<string>('')
  const [revertReason, setRevertReason] = useState('')
  const [revertReasonCustom, setRevertReasonCustom] = useState('')

  // BCRA indicator
  const [bcraSemaforo, setBcraSemaforo] = useState<'verde' | 'amarillo' | 'rojo' | null>(null)
  const bcraFetched = useRef(false)

  useEffect(() => {
    fetchQuote()
  }, [id])

  const fetchQuote = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/quotes/${id}`)

      if (!response.ok) {
        throw new Error('Error al cargar cotización')
      }

      const data = await response.json()
      setQuote(data)
      // Fetch BCRA indicator from session cache or API (background, no await)
      if (!bcraFetched.current && data?.customer?.cuit) {
        bcraFetched.current = true
        const cuitClean = data.customer.cuit.replace(/\D/g, '')
        if (cuitClean.length === 11) {
          const cacheKey = `bcra_${cuitClean}`
          try {
            const cached = sessionStorage.getItem(cacheKey)
            if (cached) {
              const { semaforo, ts } = JSON.parse(cached)
              if (Date.now() - ts < 24 * 60 * 60 * 1000) {
                setBcraSemaforo(semaforo)
                return
              }
            }
          } catch { /* sessionStorage might be unavailable */ }
          // Fetch in background without blocking
          fetch(`/api/bcra/${cuitClean}`)
            .then((r) => r.json())
            .then((d) => {
              if (d?.resumen?.semaforo) {
                setBcraSemaforo(d.resumen.semaforo)
                try {
                  sessionStorage.setItem(
                    cacheKey,
                    JSON.stringify({ semaforo: d.resumen.semaforo, ts: Date.now() })
                  )
                } catch { /* ignore */ }
              }
            })
            .catch(() => { /* silently fail */ })
        }
      }
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar cotización')
      router.push('/cotizaciones')
    } finally {
      setLoading(false)
    }
  }

  const changeStatus = async (newStatus: string, data?: any) => {
    try {
      setActionLoading(true)
      const response = await fetch(`/api/quotes/${id}/change-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, ...data }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error al cambiar estado')
      }

      toast.success('Estado actualizado correctamente')
      fetchQuote()
    } catch (error) {
      console.error('Error:', error)
      toast.error(error instanceof Error ? error.message : 'Error al cambiar estado')
    } finally {
      setActionLoading(false)
    }
  }

  const handleSend = () => {
    setShowSendDialog(true)
  }

  const handleEmailSent = () => {
    toast.success('Estado actualizado a Enviada')
    fetchQuote() // Recargar datos
  }

  const handleDownloadPDF = async () => {
    if (!quote) return
    try {
      setPdfLoading(true)
      const response = await fetch(`/api/cotizaciones/${id}/pdf`)
      if (!response.ok) throw new Error()
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `Cotizacion-${quote.quoteNumber}.pdf`
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Error al generar PDF')
    } finally {
      setPdfLoading(false)
    }
  }

  const handleAccept = () => {
    setShowAcceptDialog(true)
  }

  const confirmAccept = () => {
    changeStatus('ACCEPTED', { customerResponse })
    setShowAcceptDialog(false)
    setCustomerResponse('')
  }

  const handleReject = () => {
    setShowRejectDialog(true)
  }

  const confirmReject = () => {
    if (!rejectionReason.trim()) {
      toast.error('Debe ingresar un motivo de rechazo')
      return
    }
    changeStatus('REJECTED', { rejectionReason })
    setShowRejectDialog(false)
    setRejectionReason('')
  }

  const openRevertDialog = (target: string) => {
    setRevertTarget(target)
    setRevertReason('')
    setRevertReasonCustom('')
    setShowRevertDialog(true)
  }

  const confirmRevert = () => {
    const reason = revertReason === 'otro' ? revertReasonCustom : revertReason
    if (!reason.trim()) {
      toast.error('Debe seleccionar un motivo')
      return
    }
    changeStatus(revertTarget, { revertReason: reason })
    setShowRevertDialog(false)
    setRevertReason('')
    setRevertReasonCustom('')
  }

  const revertDialogConfig: Record<string, { title: string; description: string; icon: string; color: string }> = {
    ACCEPTED: {
      title: 'Revertir a Aceptada',
      description: 'La cotización volverá al estado Aceptada. Se limpiarán los datos de Colppy (factura/remito) asociados y volverá a aparecer en el tablero de facturación.',
      icon: 'undo',
      color: 'amber',
    },
    DRAFT: {
      title: revertTarget === 'DRAFT' && quote?.status === 'CANCELLED' ? 'Reactivar Cotización' : 'Revertir a Borrador',
      description: revertTarget === 'DRAFT' && quote?.status === 'CANCELLED'
        ? 'La cotización será reactivada y volverá al estado Borrador. Podrá ser editada y re-enviada.'
        : 'La cotización volverá al estado Borrador. Podrá ser editada nuevamente.',
      icon: 'undo',
      color: 'amber',
    },
    CANCELLED: {
      title: 'Cancelar Cotización',
      description: 'La cotización será cancelada. Podrá ser reactivada posteriormente si es necesario.',
      icon: 'ban',
      color: 'red',
    },
  }

  const handleGenerateInvoice = async () => {
    try {
      setActionLoading(true)
      const response = await fetch(`/api/quotes/${id}/generate-invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error al generar factura')
      }

      const invoice = await response.json()
      toast.success('Factura generada correctamente')
      router.push(`/facturas/${invoice.id}`)
    } catch (error) {
      console.error('Error:', error)
      toast.error(error instanceof Error ? error.message : 'Error al generar factura')
    } finally {
      setActionLoading(false)
    }
  }

  const formatCurrency = (amount: number) => {
    const symbol = quote?.currency === 'USD' ? 'USD' : 'ARS'
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

  const formatDateTime = (date: string) => {
    return new Date(date).toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">Cargando cotización...</p>
        </div>
      </div>
    )
  }

  if (!quote) {
    return (
      <div className="container mx-auto px-6 py-8">
        <Card>
          <CardContent className="text-center py-12">
            <FileText className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-600">Cotización no encontrada</p>
            <Button asChild className="mt-4">
              <Link href="/cotizaciones">Volver a Cotizaciones</Link>
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
            <Link href="/cotizaciones">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold text-gray-900">
                Cotización {quote.quoteNumber}
              </h1>
              <Badge className={`${statusColors[quote.status]} text-base px-3 py-1`}>
                {statusLabels[quote.status]}
              </Badge>
            </div>
            <p className="text-sm text-gray-600 mt-1">
              Cliente: {quote.customer.name}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleDownloadPDF} disabled={pdfLoading}>
            {pdfLoading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            Descargar PDF
          </Button>
        </div>
      </div>

      {/* Actions */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Acciones Disponibles</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {/* BORRADOR - puede enviar, editar, aceptar o rechazar */}
            {quote.status === 'DRAFT' && (
              <>
                <Button onClick={handleSend} disabled={actionLoading} className="bg-blue-600 hover:bg-blue-700">
                  <Send className="h-4 w-4 mr-2" />
                  Enviar al Cliente
                </Button>
                <Button variant="outline" asChild>
                  <Link href={`/cotizaciones/${quote.id}`}>
                    <Pencil className="h-4 w-4 mr-2" />
                    Editar Cotización
                  </Link>
                </Button>
                <Button onClick={handleAccept} disabled={actionLoading} className="bg-green-600 hover:bg-green-700">
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Marcar como Aceptada
                </Button>
                <Button variant="destructive" onClick={handleReject} disabled={actionLoading}>
                  <XCircle className="h-4 w-4 mr-2" />
                  Marcar como Rechazada
                </Button>
              </>
            )}

            {/* ENVIADA - esperando respuesta del cliente */}
            {quote.status === 'SENT' && (
              <>
                <Button onClick={handleAccept} disabled={actionLoading} className="bg-green-600 hover:bg-green-700">
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Marcar como Aceptada
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleReject}
                  disabled={actionLoading}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Marcar como Rechazada
                </Button>
                <Button variant="outline" onClick={handleSend} disabled={actionLoading}>
                  <Send className="h-4 w-4 mr-2" />
                  Reenviar Email
                </Button>
              </>
            )}

            {/* ACEPTADA - lista para facturar */}
            {quote.status === 'ACCEPTED' && (
              <>
                <Button onClick={() => setShowColppyDialog(true)} disabled={actionLoading} className="bg-blue-600 hover:bg-blue-700">
                  <Send className="h-4 w-4 mr-2" />
                  Enviar a Colppy
                </Button>
                <Button onClick={handleGenerateInvoice} disabled={actionLoading} className="bg-purple-600 hover:bg-purple-700">
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Generar Factura
                </Button>
                <Button onClick={() => router.push(`/remitos/nuevo?quoteId=${id}`)} variant="outline">
                  <Package className="h-4 w-4 mr-2" />
                  Generar Remito
                </Button>
                <div className="w-px h-8 bg-gray-300 mx-1" />
                <Button variant="outline" onClick={() => openRevertDialog('DRAFT')} disabled={actionLoading}>
                  <Undo2 className="h-4 w-4 mr-2" />
                  Revertir a Borrador
                </Button>
                <Button variant="outline" onClick={() => openRevertDialog('CANCELLED')} disabled={actionLoading} className="text-red-600 border-red-200 hover:bg-red-50">
                  <Ban className="h-4 w-4 mr-2" />
                  Cancelar Cotización
                </Button>
              </>
            )}

            {/* RECHAZADA - mostrar motivo y permitir duplicar */}
            {quote.status === 'REJECTED' && (
              <>
                <Button variant="outline" asChild>
                  <Link href={`/cotizaciones/nueva?duplicateFrom=${quote.id}`}>
                    <FileText className="h-4 w-4 mr-2" />
                    Duplicar Cotización
                  </Link>
                </Button>
              </>
            )}

            {/* VENCIDA - permitir renovar */}
            {quote.status === 'EXPIRED' && (
              <>
                <Button variant="outline" asChild>
                  <Link href={`/cotizaciones/nueva?duplicateFrom=${quote.id}`}>
                    <Clock className="h-4 w-4 mr-2" />
                    Renovar Cotización
                  </Link>
                </Button>
              </>
            )}

            {/* CONVERTIDA - ya tiene factura/remito, pero se puede revertir */}
            {quote.status === 'CONVERTED' && (
              <>
                <div className="text-sm text-gray-600 py-2 mr-4">
                  Esta cotización ya fue convertida en factura o remito.
                </div>
                <Button variant="outline" onClick={() => openRevertDialog('ACCEPTED')} disabled={actionLoading}>
                  <Undo2 className="h-4 w-4 mr-2" />
                  Revertir a Aceptada
                </Button>
              </>
            )}

            {/* CANCELADA - permitir reactivar o duplicar */}
            {quote.status === 'CANCELLED' && (
              <>
                <Button variant="outline" onClick={() => openRevertDialog('DRAFT')} disabled={actionLoading}>
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Reactivar Cotización
                </Button>
                <Button variant="outline" asChild>
                  <Link href={`/cotizaciones/nueva?duplicateFrom=${quote.id}`}>
                    <FileText className="h-4 w-4 mr-2" />
                    Duplicar Cotización
                  </Link>
                </Button>
              </>
            )}

            {actionLoading && (
              <Loader2 className="h-5 w-5 animate-spin text-blue-600 ml-2" />
            )}
          </div>

          {/* Información adicional según estado */}
          {quote.status === 'SENT' && quote.validUntil && (
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800">
                <Clock className="h-4 w-4 inline mr-1" />
                Esta cotización es válida hasta el {formatDate(quote.validUntil)}
              </p>
            </div>
          )}

          {quote.status === 'ACCEPTED' && (
            <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-800">
                <CheckCircle2 className="h-4 w-4 inline mr-1" />
                Cotización aceptada el {quote.responseDate ? formatDate(quote.responseDate) : 'N/A'}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Información Principal */}
        <div className="lg:col-span-2 space-y-6">
          {/* Datos de la Cotización */}
          <Card>
            <CardHeader>
              <CardTitle>Información de la Cotización</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Número</p>
                  <p className="font-semibold">{quote.quoteNumber}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Estado</p>
                  <Badge className={statusColors[quote.status]}>
                    {statusLabels[quote.status]}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Fecha</p>
                  <p className="font-semibold">{formatDate(quote.date)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Válida hasta</p>
                  <p className="font-semibold">
                    {quote.validUntil ? formatDate(quote.validUntil) : 'N/A'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Moneda</p>
                  <p className="font-semibold">{quote.currency}</p>
                </div>
                {quote.exchangeRate && (
                  <div>
                    <p className="text-sm text-gray-600">Tipo de Cambio</p>
                    <p className="font-semibold">
                      ${formatNumber(quote.exchangeRate)}
                    </p>
                  </div>
                )}
              </div>

              {quote.customerResponse && (
                <div className="mt-4 p-3 bg-green-50 rounded-lg">
                  <p className="text-sm font-semibold text-green-900 mb-1">
                    Respuesta del Cliente
                  </p>
                  <p className="text-sm text-green-800">{quote.customerResponse}</p>
                </div>
              )}

              {quote.rejectionReason && (
                <div className="mt-4 p-3 bg-red-50 rounded-lg">
                  <p className="text-sm font-semibold text-red-900 mb-1">
                    Motivo de Rechazo
                  </p>
                  <p className="text-sm text-red-800">{quote.rejectionReason}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Items */}
          <Card>
            <CardHeader>
              <CardTitle>Items de la Cotización</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50">
                      <TableHead>Item</TableHead>
                      <TableHead>Producto</TableHead>
                      <TableHead className="text-right">Cant.</TableHead>
                      <TableHead className="text-right">P. Unit.</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {quote.items
                      .filter((item: any) => !item.isAlternative)
                      .map((item: any) => (
                        <TableRow key={item.id}>
                          <TableCell>{item.itemNumber}</TableCell>
                          <TableCell>
                            <div>
                              <p className="font-medium">
                                {item.product?.name || item.description || 'Item manual'}
                              </p>
                              <p className="text-sm text-gray-500">
                                {item.product
                                  ? `SKU: ${item.product.sku}`
                                  : item.manualSku
                                    ? `Código: ${item.manualSku}`
                                    : 'Sin código'}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            {item.quantity}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(item.unitPrice)}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {formatCurrency(item.totalPrice)}
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
                    {formatCurrency(quote.subtotal)}
                  </span>
                </div>
                {Number(quote.bonification) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-green-700">Bonificación ({Number(quote.bonification)}%):</span>
                    <span className="font-semibold text-green-700">
                      - {formatCurrency(Number(quote.subtotal) * Number(quote.bonification) / 100)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-lg pt-2 border-t">
                  <span className="font-bold">Total:</span>
                  <span className="font-bold text-blue-600">
                    {formatCurrency(quote.total)}
                  </span>
                </div>
                {quote.currency === 'USD' && quote.exchangeRate && (
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>Total en ARS:</span>
                    <span>
                      ${(Number(quote.total) * Number(quote.exchangeRate)).toLocaleString('es-AR', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Términos y Notas */}
          {(quote.terms || quote.notes) && (
            <Card>
              <CardHeader>
                <CardTitle>Términos y Condiciones</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {quote.terms && (
                  <div>
                    <p className="text-sm font-semibold text-gray-700 mb-1">
                      Términos de Pago
                    </p>
                    <p className="text-sm text-gray-600">{quote.terms}</p>
                  </div>
                )}
                {quote.notes && (
                  <div>
                    <p className="text-sm font-semibold text-gray-700 mb-1">Notas</p>
                    <p className="text-sm text-gray-600">{quote.notes}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Historial de Estados */}
          {quote.statusHistory.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Historial de Estados</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {quote.statusHistory.map((history) => (
                    <div
                      key={history.id}
                      className="flex items-start gap-3 pb-3 border-b last:border-0"
                    >
                      <Clock className="h-5 w-5 text-gray-400 mt-0.5" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge className={statusColors[history.fromStatus]} variant="outline">
                            {statusLabels[history.fromStatus]}
                          </Badge>
                          <span className="text-gray-400">→</span>
                          <Badge className={statusColors[history.toStatus]}>
                            {statusLabels[history.toStatus]}
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-600 mt-1">
                          {formatDateTime(history.createdAt)}
                        </p>
                        {history.notes && (
                          <p className="text-sm text-gray-700 mt-1">{history.notes}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Cliente */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Cliente</span>
                {bcraSemaforo && (
                  <span
                    title={`BCRA: ${bcraSemaforo === 'verde' ? 'Situación Normal' : bcraSemaforo === 'amarillo' ? 'Con Observaciones' : 'Situación Irregular'}`}
                    className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                      bcraSemaforo === 'verde'
                        ? 'bg-green-100 text-green-700'
                        : bcraSemaforo === 'amarillo'
                        ? 'bg-yellow-100 text-yellow-700'
                        : 'bg-red-100 text-red-700'
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        bcraSemaforo === 'verde'
                          ? 'bg-green-500'
                          : bcraSemaforo === 'amarillo'
                          ? 'bg-yellow-500'
                          : 'bg-red-500'
                      }`}
                    />
                    BCRA
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-sm text-gray-600">Nombre</p>
                <p className="font-semibold">{quote.customer.name}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">CUIT</p>
                <p className="font-mono text-sm">{quote.customer.cuit}</p>
              </div>
              {quote.customer.email && (
                <div>
                  <p className="text-sm text-gray-600">Email</p>
                  <p className="text-sm">{quote.customer.email}</p>
                </div>
              )}
              {quote.customer.phone && (
                <div>
                  <p className="text-sm text-gray-600">Teléfono</p>
                  <p className="text-sm">{quote.customer.phone}</p>
                </div>
              )}
              <Button variant="outline" className="w-full mt-2" asChild>
                <Link href={`/clientes/${quote.customer.id}`}>Ver Cliente</Link>
              </Button>
              <Button variant="outline" className="w-full" asChild>
                <Link href={`/analisis-crediticio?cuit=${quote.customer.cuit.replace(/\D/g, '')}`}>
                  <ShieldCheck className="h-4 w-4 mr-2" />
                  Consultar BCRA
                </Link>
              </Button>
            </CardContent>
          </Card>

          {/* Vendedor */}
          <Card>
            <CardHeader>
              <CardTitle>Vendedor</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div>
                <p className="text-sm text-gray-600">Nombre</p>
                <p className="font-semibold">{quote.salesPerson.name}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Email</p>
                <p className="text-sm">{quote.salesPerson.email}</p>
              </div>
            </CardContent>
          </Card>

          {/* Documentos Relacionados */}
          {(quote.deliveryNotes.length > 0 || quote.invoices.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle>Documentos Relacionados</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {quote.deliveryNotes.map((dn) => (
                  <div
                    key={dn.id}
                    className="flex items-center justify-between p-2 bg-gray-50 rounded"
                  >
                    <div>
                      <p className="text-sm font-semibold">Remito {dn.deliveryNumber}</p>
                      <p className="text-xs text-gray-600">
                        {deliveryNoteStatusLabels[dn.status]}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/remitos/${dn.id}`}>Ver</Link>
                    </Button>
                  </div>
                ))}

                {quote.invoices.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between p-2 bg-gray-50 rounded"
                  >
                    <div>
                      <p className="text-sm font-semibold">
                        Factura {inv.invoiceType} {inv.invoiceNumber}
                      </p>
                      <p className="text-xs text-gray-600">
                        {formatCurrency(inv.total)}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/facturas/${inv.id}`}>Ver</Link>
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Dialog: Enviar Email */}
      {quote && (
        <SendQuoteDialog
          quote={{
            id: quote.id,
            quoteNumber: quote.quoteNumber,
            customer: {
              name: quote.customer.name,
              email: quote.customer.email
            },
            total: quote.total,
            currency: quote.currency
          }}
          open={showSendDialog}
          onOpenChange={setShowSendDialog}
          onSent={handleEmailSent}
        />
      )}

      {/* Dialog: Aceptar Cotización */}
      <Dialog open={showAcceptDialog} onOpenChange={setShowAcceptDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              Marcar como Aceptada
            </DialogTitle>
            <DialogDescription>
              Esta cotización será marcada como aceptada y podrá generar una factura o remito.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-800">
                ✓ Cotización: {quote.quoteNumber}
              </p>
              <p className="text-sm text-green-800">
                ✓ Cliente: {quote.customer.name}
              </p>
              <p className="text-sm text-green-800 font-semibold">
                ✓ Total: {formatCurrency(quote.total)}
              </p>
            </div>
            <div>
              <Label htmlFor="customerResponse">
                Comentarios del Cliente (opcional)
              </Label>
              <Textarea
                id="customerResponse"
                value={customerResponse}
                onChange={(e) => setCustomerResponse(e.target.value)}
                placeholder="Ej: Cliente aceptó por email, solicita entrega en 15 días..."
                rows={3}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowAcceptDialog(false)}
              disabled={actionLoading}
            >
              Cancelar
            </Button>
            <Button
              onClick={confirmAccept}
              disabled={actionLoading}
              className="bg-green-600 hover:bg-green-700"
            >
              {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Confirmar Aceptación
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Rechazar Cotización */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <XCircle className="h-5 w-5" />
              Marcar como Rechazada
            </DialogTitle>
            <DialogDescription>
              Indique el motivo por el cual el cliente rechazó la cotización. Esta información es importante para el seguimiento comercial.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-800">
                Cotización: {quote.quoteNumber}
              </p>
              <p className="text-sm text-red-800">
                Cliente: {quote.customer.name}
              </p>
            </div>
            <div>
              <Label htmlFor="rejectionReason" className="text-sm font-semibold">
                Motivo de Rechazo *
              </Label>
              <Textarea
                id="rejectionReason"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Ej: Precio muy alto, eligió otra opción, proyecto cancelado, requiere más tiempo..."
                rows={4}
                required
                className="mt-1"
              />
              <p className="text-xs text-gray-500 mt-1">
                Este motivo se guardará en el historial de la cotización
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowRejectDialog(false)}
              disabled={actionLoading}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={confirmReject}
              disabled={actionLoading || !rejectionReason.trim()}
            >
              {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <XCircle className="h-4 w-4 mr-2" />
              Confirmar Rechazo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Revertir Estado */}
      <Dialog open={showRevertDialog} onOpenChange={setShowRevertDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {revertTarget === 'CANCELLED' ? (
                <Ban className="h-5 w-5 text-red-600" />
              ) : revertTarget === 'DRAFT' && quote.status === 'CANCELLED' ? (
                <RotateCcw className="h-5 w-5 text-amber-600" />
              ) : (
                <Undo2 className="h-5 w-5 text-amber-600" />
              )}
              {revertDialogConfig[revertTarget]?.title || 'Cambiar Estado'}
            </DialogTitle>
            <DialogDescription>
              {revertDialogConfig[revertTarget]?.description || ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className={`p-3 rounded-lg border ${revertTarget === 'CANCELLED' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
              <div className="flex items-start gap-2">
                <AlertTriangle className={`h-4 w-4 mt-0.5 ${revertTarget === 'CANCELLED' ? 'text-red-600' : 'text-amber-600'}`} />
                <div className="text-sm">
                  <p className={revertTarget === 'CANCELLED' ? 'text-red-800' : 'text-amber-800'}>
                    Cotización: {quote.quoteNumber}
                  </p>
                  <p className={revertTarget === 'CANCELLED' ? 'text-red-800' : 'text-amber-800'}>
                    Cliente: {quote.customer.name}
                  </p>
                  <p className={`font-medium mt-1 ${revertTarget === 'CANCELLED' ? 'text-red-900' : 'text-amber-900'}`}>
                    {statusLabels[quote.status]} → {statusLabels[revertTarget] || revertTarget}
                  </p>
                </div>
              </div>
            </div>

            <div>
              <Label className="text-sm font-semibold">Motivo *</Label>
              <RadioGroup value={revertReason} onValueChange={(val) => { setRevertReason(val); if (val !== 'otro') setRevertReasonCustom(''); }} className="mt-2 space-y-2">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="Cliente canceló OC" id="r1" />
                  <Label htmlFor="r1" className="font-normal cursor-pointer">Cliente canceló OC</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="Error de carga" id="r2" />
                  <Label htmlFor="r2" className="font-normal cursor-pointer">Error de carga</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="Cambio de condiciones" id="r3" />
                  <Label htmlFor="r3" className="font-normal cursor-pointer">Cambio de condiciones</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="Cambio de precios" id="r4" />
                  <Label htmlFor="r4" className="font-normal cursor-pointer">Cambio de precios</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="Duplicada" id="r5" />
                  <Label htmlFor="r5" className="font-normal cursor-pointer">Duplicada</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="otro" id="r6" />
                  <Label htmlFor="r6" className="font-normal cursor-pointer">Otro</Label>
                </div>
              </RadioGroup>
              {revertReason === 'otro' && (
                <Textarea
                  value={revertReasonCustom}
                  onChange={(e) => setRevertReasonCustom(e.target.value)}
                  placeholder="Especifique el motivo..."
                  rows={3}
                  className="mt-2"
                />
              )}
              <p className="text-xs text-gray-500 mt-2">
                Este motivo se guardará en el historial de la cotización
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRevertDialog(false)} disabled={actionLoading}>
              Cancelar
            </Button>
            <Button
              onClick={confirmRevert}
              disabled={actionLoading || !revertReason || (revertReason === 'otro' && !revertReasonCustom.trim())}
              className={revertTarget === 'CANCELLED' ? 'bg-red-600 hover:bg-red-700' : ''}
              variant={revertTarget === 'CANCELLED' ? 'destructive' : 'default'}
            >
              {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {revertTarget === 'CANCELLED' ? (
                <><Ban className="h-4 w-4 mr-2" />Confirmar Cancelación</>
              ) : (
                <>Confirmar</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Enviar a Colppy */}
      {quote && (
        <SendToColppyDialog
          quote={{
            id: quote.id,
            quoteNumber: quote.quoteNumber,
            customer: {
              name: quote.customer.name,
              cuit: quote.customer.cuit,
              taxCondition: quote.customer.taxCondition,
              idCondicionPago: (quote.customer as any).paymentTerms != null
                ? String((quote.customer as any).paymentTerms)
                : undefined,
            },
            items: quote.items.map((item: any) => ({
              id: item.id,
              productSku: item.product?.sku || '',
              description: item.description || item.product?.name || '',
              quantity: item.quantity || 0,
              unitPrice: item.unitPrice || 0,
              iva: 21,
            })),
            total: quote.total,
            currency: quote.currency,
            exchangeRate: quote.exchangeRate,
            notes: quote.notes ?? undefined,
          }}
          open={showColppyDialog}
          onOpenChange={setShowColppyDialog}
          onSent={() => {
            toast.success('Enviado a Colppy exitosamente')
            fetchQuote()
          }}
        />
      )}
    </div>
  )
}
