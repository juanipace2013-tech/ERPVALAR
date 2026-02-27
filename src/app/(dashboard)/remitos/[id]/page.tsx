'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import {
  ArrowLeft,
  Loader2,
  Package,
  CheckCircle2,
  Truck,
  FileSpreadsheet,
  Download,
  Clock,
  Upload,
  ExternalLink,
  RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'
import { generateRemitoPDF, type RemitoPDFData } from '@/lib/pdf/remito-generator'

interface DeliveryNote {
  id: string
  deliveryNumber: string
  date: string
  deliveryDate: string | null
  status: string
  deliveryAddress: string | null
  deliveryCity: string | null
  deliveryProvince: string | null
  deliveryPostalCode: string | null
  carrier: string | null
  transportAddress: string | null
  trackingNumber: string | null
  purchaseOrder: string | null
  customerInvoiceNumber: string | null
  totalAmountARS: string | number | null
  bultos: number | null
  preparedBy: string | null
  deliveredBy: string | null
  receivedBy: string | null
  notes: string | null
  internalNotes: string | null
  signedDocUrl: string | null
  signedDocName: string | null
  signedAt: string | null
  customer: {
    id: string
    name: string
    businessName: string | null
    cuit: string
    email: string | null
    phone: string | null
    address: string | null
    city: string | null
    province: string | null
    taxCondition: string | null
  }
  quote: {
    id: string
    quoteNumber: string
    currency: string
  } | null
  items: Array<{
    id: string
    productId: string | null
    sku: string | null
    unit: string
    product: {
      id: string
      sku: string
      name: string
      brand: string | null
      unit: string
    } | null
    description: string
    quantity: number
    warehouseLocation: string | null
    batchNumber: string | null
    serialNumber: string | null
  }>
  invoices: Array<{
    id: string
    invoiceNumber: string
    invoiceType: string
    issueDate: string
    total: number
  }>
}

const statusLabels: Record<string, string> = {
  PENDING: 'Pendiente',
  PREPARING: 'En Preparación',
  READY: 'Listo',
  DISPATCHED: 'Despachado',
  DELIVERED: 'Entregado',
  CANCELLED: 'Cancelado',
}

const statusColors: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-800',
  PREPARING: 'bg-yellow-100 text-yellow-800',
  READY: 'bg-blue-100 text-blue-800',
  DISPATCHED: 'bg-purple-100 text-purple-800',
  DELIVERED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800',
}

export default function DeliveryNoteDetailPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const id = params?.id as string

  const fileInputRef = useRef<HTMLInputElement>(null)

  const [deliveryNote, setDeliveryNote] = useState<DeliveryNote | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [uploadLoading, setUploadLoading] = useState(false)

  // Dialogs
  const [showStatusDialog, setShowStatusDialog] = useState(false)
  const [newStatus, setNewStatus] = useState('')
  const [deliveryDate, setDeliveryDate] = useState('')
  const [receivedBy, setReceivedBy] = useState('')
  const [statusNotes, setStatusNotes] = useState('')

  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false)
  const [pointOfSale, setPointOfSale] = useState('0001')
  const [invoiceDueDate, setInvoiceDueDate] = useState('')
  const [invoiceNotes, setInvoiceNotes] = useState('')

  useEffect(() => {
    fetchDeliveryNote()

    // Check if we should open invoice dialog
    if (searchParams?.get('action') === 'generate-invoice') {
      setShowInvoiceDialog(true)
    }
  }, [id, searchParams])

  const fetchDeliveryNote = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/delivery-notes/${id}`)

      if (!response.ok) {
        throw new Error('Error al cargar remito')
      }

      const data = await response.json()
      setDeliveryNote(data)
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar remito')
      router.push('/remitos')
    } finally {
      setLoading(false)
    }
  }

  const handleChangeStatus = (status: string) => {
    setNewStatus(status)
    setDeliveryDate(status === 'DELIVERED' ? new Date().toISOString().split('T')[0] : '')
    setReceivedBy('')
    setStatusNotes('')
    setShowStatusDialog(true)
  }

  const confirmChangeStatus = async () => {
    try {
      setActionLoading(true)
      const response = await fetch(`/api/delivery-notes/${id}/change-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newStatus,
          deliveryDate: deliveryDate || undefined,
          receivedBy: receivedBy || undefined,
          notes: statusNotes || undefined,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error al cambiar estado')
      }

      toast.success('Estado actualizado correctamente')
      setShowStatusDialog(false)
      fetchDeliveryNote()
    } catch (error) {
      console.error('Error:', error)
      toast.error(error instanceof Error ? error.message : 'Error al cambiar estado')
    } finally {
      setActionLoading(false)
    }
  }

  const handleGenerateInvoice = () => {
    setPointOfSale('0001')
    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() + 30)
    setInvoiceDueDate(dueDate.toISOString().split('T')[0])
    setInvoiceNotes('')
    setShowInvoiceDialog(true)
  }

  const confirmGenerateInvoice = async () => {
    try {
      setActionLoading(true)
      const response = await fetch(`/api/delivery-notes/${id}/generate-invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pointOfSale,
          dueDate: invoiceDueDate,
          notes: invoiceNotes,
        }),
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

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  }

  const formatCurrency = (amount: number, currency: string = 'ARS') => {
    const symbol = currency === 'USD' ? 'USD' : 'ARS'
    return `${symbol} ${amount.toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`
  }

  const handleDownloadPDF = () => {
    if (!deliveryNote) return
    try {
      const pdfData: RemitoPDFData = {
        deliveryNumber: deliveryNote.deliveryNumber,
        date: new Date(deliveryNote.date),
        customer: {
          name: deliveryNote.customer.name,
          businessName: deliveryNote.customer.businessName,
          cuit: deliveryNote.customer.cuit,
          address: deliveryNote.customer.address,
          city: deliveryNote.customer.city,
          province: deliveryNote.customer.province,
          taxCondition: deliveryNote.customer.taxCondition,
        },
        items: deliveryNote.items.map((item) => ({
          sku: item.sku || item.product?.sku || null,
          description: item.description || item.product?.name || '',
          quantity: Number(item.quantity),
          unit: item.unit || item.product?.unit || 'UN',
        })),
        carrier: deliveryNote.carrier,
        transportAddress: deliveryNote.transportAddress,
        purchaseOrder: deliveryNote.purchaseOrder,
        customerInvoiceNumber: deliveryNote.customerInvoiceNumber,
        bultos: deliveryNote.bultos,
        totalAmountARS: deliveryNote.totalAmountARS
          ? Number(deliveryNote.totalAmountARS)
          : null,
        notes: deliveryNote.notes,
      }
      const blob = generateRemitoPDF(pdfData)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Remito-${deliveryNote.deliveryNumber.replace(/\s/g, '-')}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success('PDF generado correctamente')
    } catch (error) {
      console.error('Error generating PDF:', error)
      toast.error('Error al generar el PDF')
    }
  }

  const handleUploadSigned = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf']
    if (!allowedTypes.includes(file.type)) {
      toast.error('Tipo de archivo no permitido. Solo JPG, PNG o PDF.')
      return
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error('El archivo excede el límite de 10MB.')
      return
    }

    try {
      setUploadLoading(true)
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch(`/api/delivery-notes/${id}/upload-signed`, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error al subir archivo')
      }

      const updated = await response.json()
      setDeliveryNote((prev) =>
        prev
          ? {
              ...prev,
              signedDocUrl: updated.signedDocUrl,
              signedDocName: updated.signedDocName,
              signedAt: updated.signedAt,
            }
          : prev
      )
      toast.success('Remito firmado adjuntado correctamente')
    } catch (error) {
      console.error('Error:', error)
      toast.error(error instanceof Error ? error.message : 'Error al subir archivo')
    } finally {
      setUploadLoading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">Cargando remito...</p>
        </div>
      </div>
    )
  }

  if (!deliveryNote) {
    return (
      <div className="container mx-auto px-6 py-8">
        <Card>
          <CardContent className="text-center py-12">
            <Package className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-600">Remito no encontrado</p>
            <Button asChild className="mt-4">
              <Link href="/remitos">Volver a Remitos</Link>
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
            <Link href="/remitos">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              Remito {deliveryNote.deliveryNumber}
            </h1>
            <p className="text-sm text-gray-600 mt-1">
              Cliente: {deliveryNote.customer.name}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={statusColors[deliveryNote.status]}>
            {statusLabels[deliveryNote.status]}
          </Badge>
        </div>
      </div>

      {/* Actions */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Acciones</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {deliveryNote.status === 'PENDING' && (
              <Button onClick={() => handleChangeStatus('PREPARING')} disabled={actionLoading}>
                <Package className="h-4 w-4 mr-2" />
                Iniciar Preparación
              </Button>
            )}

            {deliveryNote.status === 'PREPARING' && (
              <Button onClick={() => handleChangeStatus('READY')} disabled={actionLoading}>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Marcar como Listo
              </Button>
            )}

            {deliveryNote.status === 'READY' && (
              <Button onClick={() => handleChangeStatus('DISPATCHED')} disabled={actionLoading}>
                <Truck className="h-4 w-4 mr-2" />
                Marcar como Despachado
              </Button>
            )}

            {deliveryNote.status === 'DISPATCHED' && (
              <Button onClick={() => handleChangeStatus('DELIVERED')} disabled={actionLoading}>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Marcar como Entregado
              </Button>
            )}

            {deliveryNote.invoices.length === 0 &&
              (deliveryNote.status === 'READY' ||
                deliveryNote.status === 'DISPATCHED' ||
                deliveryNote.status === 'DELIVERED') && (
                <Button
                  variant="outline"
                  onClick={handleGenerateInvoice}
                  disabled={actionLoading}
                >
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Generar Factura
                </Button>
              )}

            <Button variant="outline" onClick={handleDownloadPDF}>
              <Download className="h-4 w-4 mr-2" />
              Descargar PDF
            </Button>

            {/* Signed document upload/view */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.pdf"
              className="hidden"
              onChange={handleUploadSigned}
            />

            {deliveryNote.signedDocUrl ? (
              <>
                <Button
                  variant="outline"
                  className="border-green-300 text-green-700 hover:bg-green-50"
                  onClick={() => window.open(deliveryNote.signedDocUrl!, '_blank')}
                >
                  <CheckCircle2 className="h-4 w-4 mr-2 text-green-600" />
                  Ver Remito Firmado
                  <ExternalLink className="h-3 w-3 ml-1" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadLoading}
                >
                  <RefreshCw className="h-4 w-4 mr-1" />
                  Reemplazar
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadLoading}
              >
                {uploadLoading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                Adjuntar Remito Firmado
              </Button>
            )}

            {actionLoading && <Loader2 className="h-5 w-5 animate-spin text-blue-600" />}
          </div>

          {/* Signed doc info */}
          {deliveryNote.signedDocUrl && deliveryNote.signedAt && (
            <p className="text-xs text-gray-500 mt-3">
              Adjuntado el {formatDate(deliveryNote.signedAt)}
              {deliveryNote.signedDocName && ` — ${deliveryNote.signedDocName}`}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Información Principal */}
        <div className="lg:col-span-2 space-y-6">
          {/* Datos del Remito */}
          <Card>
            <CardHeader>
              <CardTitle>Información del Remito</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Número</p>
                  <p className="font-semibold font-mono">{deliveryNote.deliveryNumber}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Estado</p>
                  <Badge className={statusColors[deliveryNote.status]}>
                    {statusLabels[deliveryNote.status]}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Fecha de Emisión</p>
                  <p className="font-semibold">{formatDate(deliveryNote.date)}</p>
                </div>
                {deliveryNote.deliveryDate && (
                  <div>
                    <p className="text-sm text-gray-600">Fecha de Entrega</p>
                    <p className="font-semibold">{formatDate(deliveryNote.deliveryDate)}</p>
                  </div>
                )}
                {deliveryNote.carrier && (
                  <div>
                    <p className="text-sm text-gray-600">Transportista</p>
                    <p className="font-semibold">{deliveryNote.carrier}</p>
                  </div>
                )}
                {deliveryNote.trackingNumber && (
                  <div>
                    <p className="text-sm text-gray-600">Nº de Seguimiento</p>
                    <p className="font-mono text-sm">{deliveryNote.trackingNumber}</p>
                  </div>
                )}
              </div>

              {deliveryNote.receivedBy && (
                <div className="mt-4 p-3 bg-green-50 rounded-lg">
                  <p className="text-sm font-semibold text-green-900 mb-1">
                    Recibido por
                  </p>
                  <p className="text-sm text-green-800">{deliveryNote.receivedBy}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Dirección de Entrega */}
          {(deliveryNote.deliveryAddress || deliveryNote.customer.address) && (
            <Card>
              <CardHeader>
                <CardTitle>Dirección de Entrega</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="font-medium">
                  {deliveryNote.deliveryAddress || deliveryNote.customer.address}
                </p>
                <p className="text-sm text-gray-600">
                  {deliveryNote.deliveryCity && `${deliveryNote.deliveryCity}, `}
                  {deliveryNote.deliveryProvince}
                  {deliveryNote.deliveryPostalCode && ` - CP ${deliveryNote.deliveryPostalCode}`}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Items */}
          <Card>
            <CardHeader>
              <CardTitle>Items del Remito</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50">
                      <TableHead>Producto</TableHead>
                      <TableHead className="text-right">Cantidad</TableHead>
                      <TableHead>Ubicación</TableHead>
                      <TableHead>Lote</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deliveryNote.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{item.description || item.product?.name}</p>
                            {(item.sku || item.product?.sku) && (
                              <p className="text-sm text-gray-500">SKU: {item.sku || item.product?.sku}</p>
                            )}
                            {item.product?.brand && (
                              <p className="text-sm text-gray-500">{item.product.brand}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {Number(item.quantity)} {item.unit || item.product?.unit || 'UN'}
                        </TableCell>
                        <TableCell>
                          {item.warehouseLocation || <span className="text-gray-400">-</span>}
                        </TableCell>
                        <TableCell>
                          {item.batchNumber || <span className="text-gray-400">-</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                <div className="flex justify-between items-center">
                  <span className="font-semibold">Total de Items:</span>
                  <span className="text-lg font-bold">
                    {deliveryNote.items.reduce((sum, item) => sum + Number(item.quantity), 0)} unidades
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Notas */}
          {deliveryNote.notes && (
            <Card>
              <CardHeader>
                <CardTitle>Notas</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-700">{deliveryNote.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Cliente */}
          <Card>
            <CardHeader>
              <CardTitle>Cliente</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-sm text-gray-600">Nombre</p>
                <p className="font-semibold">{deliveryNote.customer.name}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">CUIT</p>
                <p className="font-mono text-sm">{deliveryNote.customer.cuit}</p>
              </div>
              {deliveryNote.customer.email && (
                <div>
                  <p className="text-sm text-gray-600">Email</p>
                  <p className="text-sm">{deliveryNote.customer.email}</p>
                </div>
              )}
              {deliveryNote.customer.phone && (
                <div>
                  <p className="text-sm text-gray-600">Teléfono</p>
                  <p className="text-sm">{deliveryNote.customer.phone}</p>
                </div>
              )}
              <Button variant="outline" className="w-full mt-2" asChild>
                <Link href={`/clientes/${deliveryNote.customer.id}`}>Ver Cliente</Link>
              </Button>
            </CardContent>
          </Card>

          {/* Cotización Origen */}
          {deliveryNote.quote && (
            <Card>
              <CardHeader>
                <CardTitle>Cotización Origen</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-semibold mb-2">{deliveryNote.quote.quoteNumber}</p>
                <Button variant="outline" className="w-full" asChild>
                  <Link href={`/cotizaciones/${deliveryNote.quote.id}/ver`}>
                    Ver Cotización
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Facturas Relacionadas */}
          {deliveryNote.invoices.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Facturas Relacionadas</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {deliveryNote.invoices.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between p-2 bg-gray-50 rounded"
                  >
                    <div>
                      <p className="text-sm font-semibold">
                        Factura {inv.invoiceType} {inv.invoiceNumber}
                      </p>
                      <p className="text-xs text-gray-600">
                        {formatCurrency(inv.total, deliveryNote.quote?.currency || 'ARS')}
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

      {/* Dialog: Cambiar Estado */}
      <Dialog open={showStatusDialog} onOpenChange={setShowStatusDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Cambiar Estado a {statusLabels[newStatus]}
            </DialogTitle>
            <DialogDescription>
              Complete la información adicional del cambio de estado.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {newStatus === 'DELIVERED' && (
              <>
                <div>
                  <Label htmlFor="deliveryDate">Fecha de Entrega *</Label>
                  <Input
                    id="deliveryDate"
                    type="date"
                    value={deliveryDate}
                    onChange={(e) => setDeliveryDate(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="receivedBy">Recibido por *</Label>
                  <Input
                    id="receivedBy"
                    value={receivedBy}
                    onChange={(e) => setReceivedBy(e.target.value)}
                    placeholder="Nombre de quien recibe"
                    required
                  />
                </div>
              </>
            )}
            <div>
              <Label htmlFor="statusNotes">Notas (opcional)</Label>
              <Textarea
                id="statusNotes"
                value={statusNotes}
                onChange={(e) => setStatusNotes(e.target.value)}
                placeholder="Agregar comentarios..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowStatusDialog(false)}
              disabled={actionLoading}
            >
              Cancelar
            </Button>
            <Button onClick={confirmChangeStatus} disabled={actionLoading}>
              {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Generar Factura */}
      <Dialog open={showInvoiceDialog} onOpenChange={setShowInvoiceDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generar Factura desde Remito</DialogTitle>
            <DialogDescription>
              Configure los datos de la factura a generar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="pointOfSale">Punto de Venta</Label>
              <Input
                id="pointOfSale"
                value={pointOfSale}
                onChange={(e) => setPointOfSale(e.target.value)}
                placeholder="0001"
                maxLength={4}
              />
            </div>
            <div>
              <Label htmlFor="invoiceDueDate">Fecha de Vencimiento</Label>
              <Input
                id="invoiceDueDate"
                type="date"
                value={invoiceDueDate}
                onChange={(e) => setInvoiceDueDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="invoiceNotes">Notas (opcional)</Label>
              <Textarea
                id="invoiceNotes"
                value={invoiceNotes}
                onChange={(e) => setInvoiceNotes(e.target.value)}
                placeholder="Notas adicionales para la factura..."
                rows={3}
              />
            </div>
            <div className="p-3 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-900">
                <strong>Tipo de factura:</strong> Se determinará automáticamente según la
                condición IVA del cliente.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowInvoiceDialog(false)}
              disabled={actionLoading}
            >
              Cancelar
            </Button>
            <Button onClick={confirmGenerateInvoice} disabled={actionLoading}>
              {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Generar Factura
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
