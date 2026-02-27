'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
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
import { Loader2, CheckCircle2, XCircle, FileText, Building2, Calendar, DollarSign } from 'lucide-react'
import { toast } from 'sonner'
import { formatNumber } from '@/lib/utils'

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
  customer: {
    name: string
    businessName: string | null
    cuit: string
    email: string | null
    phone: string | null
  }
  salesPerson: {
    name: string
    email: string
  }
  items: any[]
}

export default function PublicQuotePage() {
  const params = useParams()
  const router = useRouter()
  const token = params?.token as string

  const [quote, setQuote] = useState<Quote | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [showAcceptDialog, setShowAcceptDialog] = useState(false)
  const [showRejectDialog, setShowRejectDialog] = useState(false)
  const [response, setResponse] = useState('')
  const [rejectionReason, setRejectionReason] = useState('')

  useEffect(() => {
    fetchQuote()
  }, [token])

  const fetchQuote = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/public/quotes/${token}`)

      if (!response.ok) {
        throw new Error('Error al cargar cotización')
      }

      const data = await response.json()
      setQuote(data)
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar cotización')
    } finally {
      setLoading(false)
    }
  }

  const handleAccept = async () => {
    try {
      setActionLoading(true)
      const apiResponse = await fetch(`/api/public/quotes/${token}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response })
      })

      if (!apiResponse.ok) {
        throw new Error('Error al aceptar cotización')
      }

      toast.success('¡Cotización aceptada exitosamente!')
      setShowAcceptDialog(false)
      fetchQuote()
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al aceptar cotización')
    } finally {
      setActionLoading(false)
    }
  }

  const handleReject = async () => {
    if (!rejectionReason.trim()) {
      toast.error('Debe ingresar un motivo de rechazo')
      return
    }

    try {
      setActionLoading(true)
      const apiResponse = await fetch(`/api/public/quotes/${token}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rejectionReason })
      })

      if (!apiResponse.ok) {
        throw new Error('Error al rechazar cotización')
      }

      toast.success('Cotización rechazada')
      setShowRejectDialog(false)
      fetchQuote()
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al rechazar cotización')
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
      month: 'long',
      year: 'numeric',
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">Cargando cotización...</p>
        </div>
      </div>
    )
  }

  if (!quote) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <Card className="w-full max-w-md">
          <CardContent className="text-center py-12">
            <FileText className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-600 mb-4">Cotización no encontrada o token inválido</p>
            <p className="text-sm text-gray-500">
              El enlace puede haber expirado o ser incorrecto.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const canRespond = quote.status === 'SENT'

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto px-4 max-w-5xl">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                Cotización {quote.quoteNumber}
              </h1>
              <p className="text-sm text-gray-600 mt-1">
                De: Valarg
              </p>
            </div>
            <Badge
              className={
                quote.status === 'SENT'
                  ? 'bg-yellow-100 text-yellow-800 border border-yellow-200'
                  : quote.status === 'ACCEPTED'
                  ? 'bg-green-100 text-green-800 border border-green-200'
                  : quote.status === 'REJECTED'
                  ? 'bg-red-100 text-red-800 border border-red-200'
                  : 'bg-gray-100 text-gray-800 border border-gray-200'
              }
            >
              {quote.status === 'SENT' && '📧 Pendiente de Respuesta'}
              {quote.status === 'ACCEPTED' && '✅ Aceptada'}
              {quote.status === 'REJECTED' && '❌ Rechazada'}
              {quote.status === 'EXPIRED' && '⏰ Vencida'}
            </Badge>
          </div>

          {/* Actions para cliente */}
          {canRespond && (
            <div className="flex gap-3 mt-4">
              <Button
                onClick={() => setShowAcceptDialog(true)}
                className="bg-green-600 hover:bg-green-700 flex-1"
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Aceptar Cotización
              </Button>
              <Button
                onClick={() => setShowRejectDialog(true)}
                variant="destructive"
                className="flex-1"
              >
                <XCircle className="h-4 w-4 mr-2" />
                Rechazar Cotización
              </Button>
            </div>
          )}

          {!canRespond && quote.status === 'ACCEPTED' && (
            <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-green-800 text-center font-semibold">
                ✅ Esta cotización ya fue aceptada. Nos pondremos en contacto pronto.
              </p>
            </div>
          )}

          {!canRespond && quote.status === 'REJECTED' && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800 text-center">
                Esta cotización fue rechazada.
              </p>
            </div>
          )}
        </div>

        {/* Información Principal */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            {/* Detalles */}
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Detalles de la Cotización</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-start gap-3">
                    <Calendar className="h-5 w-5 text-gray-400 mt-0.5" />
                    <div>
                      <p className="text-sm text-gray-600">Fecha</p>
                      <p className="font-semibold">{formatDate(quote.date)}</p>
                    </div>
                  </div>
                  {quote.validUntil && (
                    <div className="flex items-start gap-3">
                      <Calendar className="h-5 w-5 text-gray-400 mt-0.5" />
                      <div>
                        <p className="text-sm text-gray-600">Válida hasta</p>
                        <p className="font-semibold">{formatDate(quote.validUntil)}</p>
                      </div>
                    </div>
                  )}
                  <div className="flex items-start gap-3">
                    <DollarSign className="h-5 w-5 text-gray-400 mt-0.5" />
                    <div>
                      <p className="text-sm text-gray-600">Moneda</p>
                      <p className="font-semibold">{quote.currency}</p>
                    </div>
                  </div>
                  {quote.exchangeRate && (
                    <div className="flex items-start gap-3">
                      <DollarSign className="h-5 w-5 text-gray-400 mt-0.5" />
                      <div>
                        <p className="text-sm text-gray-600">Tipo de Cambio</p>
                        <p className="font-semibold">${formatNumber(quote.exchangeRate)}</p>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Items */}
            <Card>
              <CardHeader>
                <CardTitle>Items Cotizados</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-gray-50">
                        <TableHead>Producto</TableHead>
                        <TableHead className="text-right">Cantidad</TableHead>
                        <TableHead className="text-right">P. Unitario</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {quote.items
                        .filter((item: any) => !item.isAlternative)
                        .map((item: any) => (
                          <TableRow key={item.id}>
                            <TableCell>
                              <div>
                                <p className="font-medium">{item.product?.name || item.description}</p>
                                <p className="text-sm text-gray-500">
                                  SKU: {item.product?.sku}
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
                </div>
              </CardContent>
            </Card>

            {/* Términos y Notas */}
            {(quote.terms || quote.notes) && (
              <Card className="mt-6">
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
          </div>

          {/* Sidebar */}
          <div>
            {/* Contacto */}
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Su Contacto</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-sm text-gray-600">Vendedor</p>
                  <p className="font-semibold">{quote.salesPerson.name}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Email</p>
                  <p className="text-sm">{quote.salesPerson.email}</p>
                </div>
                <Button variant="outline" className="w-full" asChild>
                  <a href={`mailto:${quote.salesPerson.email}`}>
                    Contactar Vendedor
                  </a>
                </Button>
              </CardContent>
            </Card>

            {/* Info */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-start gap-3">
                  <Building2 className="h-5 w-5 text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold">Valarg</p>
                    <p className="text-xs text-gray-600">
                      Sistema de Gestión Comercial
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Dialog Aceptar */}
        <Dialog open={showAcceptDialog} onOpenChange={setShowAcceptDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                Aceptar Cotización
              </DialogTitle>
              <DialogDescription>
                Al aceptar, nos pondremos en contacto para coordinar la entrega.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label htmlFor="response">Comentarios (opcional)</Label>
                <Textarea
                  id="response"
                  value={response}
                  onChange={(e) => setResponse(e.target.value)}
                  placeholder="Algún comentario o consulta adicional..."
                  rows={3}
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
                onClick={handleAccept}
                disabled={actionLoading}
                className="bg-green-600 hover:bg-green-700"
              >
                {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Confirmar Aceptación
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Dialog Rechazar */}
        <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-600">
                <XCircle className="h-5 w-5" />
                Rechazar Cotización
              </DialogTitle>
              <DialogDescription>
                Por favor indíquenos el motivo del rechazo para poder mejorar.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label htmlFor="rejectionReason">Motivo de Rechazo *</Label>
                <Textarea
                  id="rejectionReason"
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="Ej: Precio muy alto, requiero más tiempo, elegí otra opción..."
                  rows={4}
                  required
                />
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
                onClick={handleReject}
                disabled={actionLoading || !rejectionReason.trim()}
              >
                {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Confirmar Rechazo
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
