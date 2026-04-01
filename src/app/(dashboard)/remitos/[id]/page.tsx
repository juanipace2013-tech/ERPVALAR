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
  Pencil,
  Trash2,
  Mail,
} from 'lucide-react'
import { toast } from 'sonner'
import { Copy, Tag } from 'lucide-react'
import { generateRemitoPDF, type RemitoPDFData, type CaiPDFData } from '@/lib/pdf/remito-generator'
import { generateShippingLabels, type ShippingLabelData } from '@/lib/pdf/shipping-label-generator'
import { SendRemitoDialog } from '@/components/remitos/SendRemitoDialog'
import { DuplicateDeliveryNoteDialog } from '@/components/remitos/DuplicateDeliveryNoteDialog'
import { getLocalDateString } from '@/lib/utils'

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
  deliveryContactName: string | null
  deliveryContactPhone: string | null
  carrier: string | null
  transportAddress: string | null
  trackingNumber: string | null
  purchaseOrder: string | null
  customerInvoiceNumber: string | null
  totalAmountARS: string | number | null
  bultos: string | null
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
  } | null
  supplier: {
    id: string
    name: string
    legalName: string | null
    taxId: string | null
    email: string | null
    phone: string | null
    address: string | null
    city: string | null
    province: string | null
  } | null
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
  PREPARING: 'En Proceso',
  READY: 'Listo',
  DISPATCHED: 'Despachado',
  DELIVERED: 'Entregado',
  CANCELLED: 'Cancelado',
}

const statusColors: Record<string, string> = {
  PENDING: 'bg-orange-100 text-orange-800',
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

  const [showSendEmailDialog, setShowSendEmailDialog] = useState(false)
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false)

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
    setDeliveryDate(status === 'DELIVERED' ? getLocalDateString() : '')
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
    setInvoiceDueDate(getLocalDateString(dueDate))
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

  const handleDownloadPDF = async () => {
    if (!deliveryNote) return
    try {
      let caiData: CaiPDFData | null = null
      let deliveryNumber = deliveryNote.deliveryNumber

      // Si el remito ya tiene CAI o podemos asignarle uno, obtener datos
      const caiRes = await fetch(`/api/delivery-notes/${id}/allocate-cai`, {
        method: 'POST',
      })

      if (caiRes.ok) {
        const caiResult = await caiRes.json()
        deliveryNumber = caiResult.deliveryNumber
        caiData = {
          caiNumber: caiResult.caiNumber,
          caiExpirationDate: new Intl.DateTimeFormat('es-AR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
          }).format(new Date(caiResult.caiExpirationDate)),
        }
        // Refresh si se asignó un nuevo número
        if (!caiResult.alreadyAllocated) {
          fetchDeliveryNote()
        }
      }
      // Si falla (no hay CAI activo), genera PDF sin CAI (PV 0002 legacy)

      const recipientName = deliveryNote.supplier?.name || deliveryNote.customer?.name || ''
      const recipientLegalName = deliveryNote.supplier?.legalName || deliveryNote.customer?.businessName || null
      const recipientTaxId = deliveryNote.supplier?.taxId || deliveryNote.customer?.cuit || ''

      const pdfData: RemitoPDFData = {
        deliveryNumber,
        date: new Date(deliveryNote.date),
        customer: {
          name: recipientName,
          businessName: recipientLegalName,
          cuit: recipientTaxId,
          address: deliveryNote.deliveryAddress || deliveryNote.supplier?.address || deliveryNote.customer?.address || null,
          city: deliveryNote.deliveryCity || deliveryNote.supplier?.city || deliveryNote.customer?.city || null,
          province: deliveryNote.deliveryProvince || deliveryNote.supplier?.province || deliveryNote.customer?.province || null,
          taxCondition: deliveryNote.customer?.taxCondition || null,
        },
        items: deliveryNote.items.map((item) => ({
          sku: item.sku || item.product?.sku || null,
          description: item.description || item.product?.name || '',
          quantity: Number(item.quantity),
          unit: item.unit || item.product?.unit || 'UN',
        })),
        carrier: deliveryNote.carrier,
        transportAddress: deliveryNote.transportAddress,
        deliveryType: deliveryNote.deliveryType,
        purchaseOrder: deliveryNote.purchaseOrder,
        customerInvoiceNumber: deliveryNote.customerInvoiceNumber,
        bultos: deliveryNote.bultos,
        totalAmountARS: deliveryNote.totalAmountARS
          ? Number(deliveryNote.totalAmountARS)
          : null,
        notes: deliveryNote.notes,
        cai: caiData,
      }
      const blob = await generateRemitoPDF(pdfData)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Remito-${deliveryNumber.replace(/\s/g, '-')}.pdf`
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

  const handleDownloadLabel = () => {
    if (!deliveryNote) return
    try {
      const recipient = deliveryNote.customer || deliveryNote.supplier

      const labelData: ShippingLabelData = {
        deliveryNumber: deliveryNote.deliveryNumber,
        date: new Date(deliveryNote.date),
        customer: {
          name: recipient?.name || 'Sin destinatario',
          businessName: deliveryNote.customer?.businessName || deliveryNote.supplier?.legalName || null,
          cuit: recipient
            ? (deliveryNote.customer?.cuit || deliveryNote.supplier?.taxId || '')
            : '',
          phone: recipient?.phone || null,
          address: recipient?.address || null,
          city: recipient?.city || null,
          province: recipient?.province || null,
        },
        deliveryAddress: deliveryNote.deliveryAddress,
        deliveryCity: deliveryNote.deliveryCity,
        deliveryProvince: deliveryNote.deliveryProvince,
        deliveryPostalCode: deliveryNote.deliveryPostalCode,
        deliveryContactName: deliveryNote.deliveryContactName,
        deliveryContactPhone: deliveryNote.deliveryContactPhone,
        carrier: deliveryNote.carrier,
        transportAddress: deliveryNote.transportAddress,
        purchaseOrder: deliveryNote.purchaseOrder,
        bultos: deliveryNote.bultos,
      }

      const blob = generateShippingLabels(labelData)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Rotulo-${deliveryNote.deliveryNumber.replace(/\s/g, '-')}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success('Rótulo generado correctamente')
    } catch (error) {
      console.error('Error generating label:', error)
      toast.error('Error al generar el rótulo')
    }
  }

  const handleDownloadExcel = async () => {
    if (!deliveryNote) return
    try {
      toast.info('Generando Excel...')
      const response = await fetch(`/api/delivery-notes/${id}/excel`)
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Error al generar Excel')
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Remito-${deliveryNote.deliveryNumber.replace(/\s/g, '-')}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success('Excel generado correctamente')
    } catch (error) {
      console.error('Error downloading Excel:', error)
      toast.error(error instanceof Error ? error.message : 'Error al generar el Excel')
    }
  }

  const handleDelete = async () => {
    if (!deliveryNote) return
    const confirmed = window.confirm(
      `¿Estás seguro de eliminar el remito ${deliveryNote.deliveryNumber}?\n\nEsta acción no se puede deshacer.`
    )
    if (!confirmed) return

    try {
      setActionLoading(true)
      const response = await fetch(`/api/delivery-notes/${id}`, { method: 'DELETE' })
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Error al eliminar')
      }
      toast.success('Remito eliminado correctamente')
      router.push('/remitos')
    } catch (error) {
      console.error('Error deleting delivery note:', error)
      toast.error(error instanceof Error ? error.message : 'Error al eliminar el remito')
    } finally {
      setActionLoading(false)
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
              {deliveryNote.supplier ? 'Proveedor' : 'Cliente'}: {deliveryNote.supplier?.name || deliveryNote.customer?.name}
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

            <Button variant="outline" onClick={handleDownloadLabel}>
              <Tag className="h-4 w-4 mr-2" />
              Imprimir Rótulo
            </Button>

            <Button variant="outline" onClick={() => setShowSendEmailDialog(true)}>
              <Mail className="h-4 w-4 mr-2" />
              Enviar por Email
            </Button>

            <Button variant="outline" onClick={() => setShowDuplicateDialog(true)}>
              <Copy className="h-4 w-4 mr-2" />
              Duplicar
            </Button>

            <Button variant="outline" onClick={handleDownloadExcel}>
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              Descargar Excel
            </Button>

            {deliveryNote.status === 'PENDING' && (
              <Button
                variant="outline"
                asChild
              >
                <Link href={`/remitos/${id}/editar`}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Editar
                </Link>
              </Button>
            )}

            {['PENDING', 'PREPARING', 'READY'].includes(deliveryNote.status) &&
              deliveryNote.invoices.length === 0 && (
                <Button
                  variant="outline"
                  className="border-red-300 text-red-700 hover:bg-red-50"
                  onClick={handleDelete}
                  disabled={actionLoading}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Eliminar
                </Button>
              )}

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
                  onClick={() => window.open(`/api${deliveryNote.signedDocUrl!}`, '_blank')}
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
                {deliveryNote.transportAddress && (
                  <div>
                    <p className="text-sm text-gray-600">Dir. Transporte</p>
                    <p className="font-semibold">{deliveryNote.transportAddress}</p>
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
          {(deliveryNote.deliveryAddress || deliveryNote.customer?.address || deliveryNote.supplier?.address) && (
            <Card>
              <CardHeader>
                <CardTitle>Dirección de Entrega</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="font-medium">
                  {deliveryNote.deliveryAddress || deliveryNote.customer?.address || deliveryNote.supplier?.address}
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
                    {(deliveryNote.items || []).reduce((sum: number, item: { quantity: number }) => sum + Number(item.quantity), 0)} unidades
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Notas */}
          {(deliveryNote.notes || deliveryNote.internalNotes) && (
            <Card>
              <CardHeader>
                <CardTitle>Notas</CardTitle>
              </CardHeader>
              <CardContent className="space-y-0">
                {deliveryNote.notes && (
                  <p className="text-sm text-gray-700 whitespace-pre-line">{deliveryNote.notes}</p>
                )}
                {deliveryNote.internalNotes && (
                  <>
                    {deliveryNote.notes && <hr className="my-3 border-gray-200" />}
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-sm">🔒</span>
                      <span className="text-sm font-semibold text-gray-500">Notas Internas</span>
                    </div>
                    <p className="text-sm text-gray-500 whitespace-pre-line">{deliveryNote.internalNotes}</p>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Destinatario (Cliente o Proveedor) */}
          <Card>
            <CardHeader>
              <CardTitle>{deliveryNote.supplier ? 'Proveedor' : 'Cliente'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {deliveryNote.supplier ? (
                <>
                  <div>
                    <p className="text-sm text-gray-600">Nombre</p>
                    <p className="font-semibold">{deliveryNote.supplier.name}</p>
                  </div>
                  {deliveryNote.supplier.taxId && (
                    <div>
                      <p className="text-sm text-gray-600">CUIT</p>
                      <p className="font-mono text-sm">{deliveryNote.supplier.taxId}</p>
                    </div>
                  )}
                  {deliveryNote.supplier.email && (
                    <div>
                      <p className="text-sm text-gray-600">Email</p>
                      <p className="text-sm">{deliveryNote.supplier.email}</p>
                    </div>
                  )}
                  {deliveryNote.supplier.phone && (
                    <div>
                      <p className="text-sm text-gray-600">Teléfono</p>
                      <p className="text-sm">{deliveryNote.supplier.phone}</p>
                    </div>
                  )}
                  <Button variant="outline" className="w-full mt-2" asChild>
                    <Link href={`/proveedores/${deliveryNote.supplier.id}`}>Ver Proveedor</Link>
                  </Button>
                </>
              ) : deliveryNote.customer ? (
                <>
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
                </>
              ) : null}
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

      {/* Dialog enviar remito por email */}
      {deliveryNote && (
        <SendRemitoDialog
          deliveryNote={{
            id: deliveryNote.id,
            deliveryNumber: deliveryNote.deliveryNumber,
            customer: {
              name: deliveryNote.supplier?.name || deliveryNote.customer?.name || '',
              businessName: deliveryNote.supplier?.legalName || deliveryNote.customer?.businessName || null,
              email: deliveryNote.supplier?.email || deliveryNote.customer?.email || null,
            },
            itemCount: deliveryNote.items.length,
            signedDocUrl: deliveryNote.signedDocUrl,
          }}
          open={showSendEmailDialog}
          onOpenChange={setShowSendEmailDialog}
        />
      )}

      {deliveryNote && (
        <DuplicateDeliveryNoteDialog
          open={showDuplicateDialog}
          onOpenChange={setShowDuplicateDialog}
          deliveryNoteId={deliveryNote.id}
          recipientName={deliveryNote.supplier?.name || deliveryNote.customer?.name || 'Sin destinatario'}
          onDuplicated={(newId) => {
            setShowDuplicateDialog(false)
            toast.success('Remito duplicado correctamente')
            router.push(`/remitos/${newId}`)
          }}
        />
      )}
    </div>
  )
}
