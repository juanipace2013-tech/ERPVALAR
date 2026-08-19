'use client'

import { useState, useEffect, use, useCallback } from 'react'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ArrowLeft, Loader2, FileText, Download, RefreshCw, FileMinus, ExternalLink, AlertTriangle, CheckCircle2, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency as formatCurrencyAR } from '@/lib/utils'

interface InvoiceItem {
  id: string
  description: string | null
  quantity: number | string
  unitPrice: number | string
  discount: number | string
  taxRate: number | string
  subtotal: number | string
  sku?: string | null
  product?: { id: string; name: string; sku: string } | null
}

interface RelatedInvoice {
  id: string
  invoiceNumber: string
  transactionType: string
  invoiceType: string
  total: number | string
  cae: string | null
  issueDate: string
  status: string
  colppySyncStatus: string | null
}

interface Invoice {
  id: string
  invoiceNumber: string
  invoiceType: string
  transactionType: string
  status: string
  currency: string
  exchangeRate: number | string | null
  issueDate: string
  dueDate: string
  notes: string | null
  customer: {
    id: string
    name: string
    businessName?: string | null
    cuit: string
    email: string | null
    phone: string | null
    address: string | null
    taxCondition?: string | null
  }
  quote?: { id: string; quoteNumber: string; status: string } | null
  items: InvoiceItem[]
  subtotal: number | string
  taxAmount: number | string
  discount: number | string
  total: number | string
  balance: number | string
  paymentStatus: string
  // Emisión propia (ARCA)
  emitidaPor: string | null
  pointOfSale: number | null
  cbteTipo: number | null
  cbteNumero: number | null
  cae: string | null
  caeExpiration: string | null
  afipStatus: string
  qrUrl: string | null
  arcaObservaciones: string | null
  colppyId: string | null
  colppySyncStatus: string | null
  colppySyncError: string | null
  tieneColppyPayload: boolean
  pdfUrl: string | null
  relatedInvoice?: { id: string; invoiceNumber: string; invoiceType: string; total: number | string; cae: string | null } | null
  relatedInvoices: RelatedInvoice[]
}

const statusLabels: Record<string, string> = {
  DRAFT: 'Borrador',
  PENDING: 'Pendiente',
  AUTHORIZED: 'Autorizada',
  SENT: 'Enviada',
  PAID: 'Pagada',
  OVERDUE: 'Vencida',
  CANCELLED: 'Anulada',
}

const statusColors: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-800',
  PENDING: 'bg-yellow-100 text-yellow-800',
  AUTHORIZED: 'bg-blue-100 text-blue-800',
  SENT: 'bg-purple-100 text-purple-800',
  PAID: 'bg-green-100 text-green-800',
  OVERDUE: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-gray-200 text-gray-700 line-through',
}

const claseLabel = (t: string) =>
  t === 'CREDIT_NOTE' ? 'Nota de Crédito' : t === 'DEBIT_NOTE' ? 'Nota de Débito' : 'Factura'

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState(false)
  const [ncOpen, setNcOpen] = useState(false)
  const [ncMotivo, setNcMotivo] = useState('')
  const [ncParcial, setNcParcial] = useState('')
  const [ncLoading, setNcLoading] = useState(false)

  const fetchInvoice = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/facturas/${id}`)
      if (!response.ok) throw new Error('Error al cargar factura')
      setInvoice(await response.json())
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar factura')
      router.push('/facturacion')
    } finally {
      setLoading(false)
    }
  }, [id, router])

  useEffect(() => {
    fetchInvoice()
  }, [fetchInvoice])

  // Los Decimal de Prisma llegan como string vía JSON; el helper los coerciona.
  const formatCurrency = (amount: number | string, currency: string = 'ARS') =>
    formatCurrencyAR(amount, currency === 'USD' ? 'USD' : 'ARS')

  const formatDate = (date: string | null | undefined) =>
    date ? new Date(date).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-'

  const reintentarColppy = async () => {
    try {
      setRetrying(true)
      const r = await fetch(`/api/facturas/${id}/reenviar-colppy`, { method: 'POST' })
      const data = await r.json()
      if (!r.ok || !data.success) throw new Error(data.error || 'Error al reenviar a Colppy')
      toast.success('Registrada en Colppy', { description: `ID Colppy ${data.colppyId}` })
      fetchInvoice()
    } catch (e) {
      toast.error('No se pudo registrar en Colppy', { description: (e as Error).message })
    } finally {
      setRetrying(false)
    }
  }

  const emitirNC = async () => {
    try {
      setNcLoading(true)
      const body: { motivo?: string; netoParcial?: number } = { motivo: ncMotivo.trim() || undefined }
      if (ncParcial.trim()) body.netoParcial = Number(ncParcial.replace(',', '.'))
      const r = await fetch(`/api/facturas/${id}/nota-credito`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Error al emitir la nota de crédito')
      toast.success(data.colppyPendiente ? 'NC emitida (pendiente en Colppy)' : 'Nota de crédito emitida', {
        description: `${data.numero} · CAE ${data.cae}`,
        duration: 12000,
        action: data.pdfUrl ? { label: 'Ver PDF', onClick: () => window.open(data.pdfUrl, '_blank') } : undefined,
      })
      if (data.pdfUrl) window.open(data.pdfUrl, '_blank')
      setNcOpen(false)
      setNcMotivo('')
      setNcParcial('')
      fetchInvoice()
    } catch (e) {
      toast.error('No se pudo emitir la nota de crédito', { description: (e as Error).message, duration: 15000 })
    } finally {
      setNcLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    )
  }

  if (!invoice) {
    return (
      <div className="container mx-auto px-6 py-8">
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">Factura no encontrada</p>
            <Button asChild className="mt-4">
              <Link href="/facturacion">Volver</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const esArca = invoice.emitidaPor === 'ARCA'
  const esFactura = invoice.transactionType === 'SALE'
  const ncVigentes = invoice.relatedInvoices.filter((r) => r.transactionType === 'CREDIT_NOTE' && r.status !== 'CANCELLED')
  const acreditado = ncVigentes.reduce((s, r) => s + Number(r.total), 0)
  const puedeNC = esArca && esFactura && invoice.status !== 'CANCELLED' && acreditado < Number(invoice.total) - 0.01
  const nroFiscal =
    invoice.pointOfSale && invoice.cbteNumero
      ? `${String(invoice.pointOfSale).padStart(4, '0')}-${String(invoice.cbteNumero).padStart(8, '0')}`
      : invoice.invoiceNumber

  return (
    <div className="container mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              {claseLabel(invoice.transactionType)} {invoice.invoiceType} {nroFiscal}
            </h1>
            <p className="text-sm text-gray-600 mt-1">
              {invoice.customer.name}
              {invoice.quote && (
                <>
                  {' · '}
                  <Link href={`/cotizaciones/${invoice.quote.id}/ver`} className="text-blue-600 hover:underline">
                    Cotización {invoice.quote.quoteNumber}
                  </Link>
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {esArca && <Badge variant="outline">Emitida por el ERP</Badge>}
          <Badge className={statusColors[invoice.status]}>{statusLabels[invoice.status]}</Badge>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2 mb-6">
        {invoice.pdfUrl && (
          <>
            <Button variant="outline" asChild>
              <a href={invoice.pdfUrl} target="_blank" rel="noreferrer">
                <FileText className="h-4 w-4 mr-2" />
                Ver PDF
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href={`${invoice.pdfUrl}?download=1`}>
                <Download className="h-4 w-4 mr-2" />
                Descargar PDF
              </a>
            </Button>
          </>
        )}
        {esArca && invoice.colppySyncStatus && invoice.colppySyncStatus !== 'OK' && (
          <Button variant="outline" onClick={reintentarColppy} disabled={retrying}>
            {retrying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Reintentar registro en Colppy
          </Button>
        )}
        {puedeNC && (
          <Button variant="destructive" onClick={() => setNcOpen(true)}>
            <FileMinus className="h-4 w-4 mr-2" />
            Emitir nota de crédito
          </Button>
        )}
        {esFactura && invoice.quote && (
          <Button
            variant="outline"
            onClick={() => router.push(`/facturacion?repetir=${invoice.id}`)}
            title="Volver a facturar las mismas líneas (abre el tablero con las líneas preseleccionadas, editables)"
          >
            <Copy className="h-4 w-4 mr-2" />
            Repetir factura
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Datos */}
          <Card>
            <CardHeader>
              <CardTitle>Información del comprobante</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Número</p>
                  <p className="font-semibold">{nroFiscal}</p>
                  {invoice.invoiceNumber !== nroFiscal && <p className="text-xs text-gray-500">{invoice.invoiceNumber}</p>}
                </div>
                <div>
                  <p className="text-sm text-gray-600">Tipo</p>
                  <p className="font-semibold">
                    {claseLabel(invoice.transactionType)} {invoice.invoiceType}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Fecha de emisión</p>
                  <p className="font-semibold">{formatDate(invoice.issueDate)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Vencimiento</p>
                  <p className="font-semibold">{formatDate(invoice.dueDate)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Moneda</p>
                  <p className="font-semibold">
                    {invoice.currency}
                    {invoice.currency === 'USD' && invoice.exchangeRate ? ` · TC ${Number(invoice.exchangeRate).toLocaleString('es-AR')}` : ''}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Cobro</p>
                  <p className="font-semibold">
                    {invoice.paymentStatus === 'PAID' ? 'Cobrada' : invoice.paymentStatus === 'PARTIAL' ? 'Parcial' : 'Pendiente'}
                    {Number(invoice.balance) > 0 && ` · saldo ${formatCurrency(invoice.balance, invoice.currency)}`}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Items */}
          <Card>
            <CardHeader>
              <CardTitle>Detalle</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg overflow-hidden">
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow className="bg-gray-50">
                      <TableHead>Descripción</TableHead>
                      <TableHead className="w-[90px] text-right">Cantidad</TableHead>
                      <TableHead className="w-[120px] text-right">Precio Unit.</TableHead>
                      <TableHead className="w-[70px] text-right">IVA %</TableHead>
                      <TableHead className="w-[140px] text-right">Subtotal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoice.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="overflow-hidden">
                          <p className="truncate" title={item.description || ''}>
                            {(item.sku || item.product?.sku) && <span className="font-mono text-xs text-gray-500 mr-2">{item.sku || item.product?.sku}</span>}
                            {item.description}
                          </p>
                        </TableCell>
                        <TableCell className="text-right">{Number(item.quantity)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(item.unitPrice, invoice.currency)}</TableCell>
                        <TableCell className="text-right">{Number(item.taxRate)}%</TableCell>
                        <TableCell className="text-right font-semibold">{formatCurrency(item.subtotal, invoice.currency)}</TableCell>
                      </TableRow>
                    ))}
                    {invoice.items.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-gray-500 py-6">Sin detalle de ítems</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="mt-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Neto gravado:</span>
                  <span className="font-semibold">{formatCurrency(invoice.subtotal, invoice.currency)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">IVA:</span>
                  <span className="font-semibold">{formatCurrency(invoice.taxAmount, invoice.currency)}</span>
                </div>
                <div className="flex justify-between text-lg pt-2 border-t">
                  <span className="font-bold">Total:</span>
                  <span className="font-bold text-blue-600">{formatCurrency(invoice.total, invoice.currency)}</span>
                </div>
                {acreditado > 0 && (
                  <div className="flex justify-between text-sm text-red-700">
                    <span>Acreditado por NC:</span>
                    <span className="font-semibold">-{formatCurrency(acreditado, invoice.currency)}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* NC/ND asociadas */}
          {(invoice.relatedInvoices.length > 0 || invoice.relatedInvoice) && (
            <Card>
              <CardHeader>
                <CardTitle>Comprobantes asociados</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {invoice.relatedInvoice && (
                  <div className="flex items-center justify-between text-sm">
                    <span>
                      Sobre factura{' '}
                      <Link href={`/facturas/${invoice.relatedInvoice.id}`} className="text-blue-600 hover:underline">
                        {invoice.relatedInvoice.invoiceNumber}
                      </Link>
                    </span>
                    <span>{formatCurrency(invoice.relatedInvoice.total, invoice.currency)}</span>
                  </div>
                )}
                {invoice.relatedInvoices.map((r) => (
                  <div key={r.id} className="flex items-center justify-between text-sm">
                    <span>
                      {claseLabel(r.transactionType)} {r.invoiceType}{' '}
                      <Link href={`/facturas/${r.id}`} className="text-blue-600 hover:underline">
                        {r.invoiceNumber}
                      </Link>{' '}
                      <span className="text-gray-500">· {formatDate(r.issueDate)}{r.cae ? ` · CAE ${r.cae}` : ''}</span>
                      {r.colppySyncStatus && r.colppySyncStatus !== 'OK' && (
                        <Badge className="ml-2 bg-amber-100 text-amber-800">Pendiente Colppy</Badge>
                      )}
                    </span>
                    <span className={r.transactionType === 'CREDIT_NOTE' ? 'text-red-700' : ''}>
                      {r.transactionType === 'CREDIT_NOTE' ? '-' : ''}
                      {formatCurrency(r.total, invoice.currency)}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {invoice.notes && (
            <Card>
              <CardHeader>
                <CardTitle>Notas</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-700 whitespace-pre-line">{invoice.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {esArca && (
            <Card>
              <CardHeader>
                <CardTitle>Emisión electrónica (ARCA)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <p className="text-gray-600">CAE</p>
                  <p className="font-mono font-semibold">{invoice.cae}</p>
                </div>
                <div>
                  <p className="text-gray-600">Vencimiento CAE</p>
                  <p className="font-semibold">{formatDate(invoice.caeExpiration)}</p>
                </div>
                <div>
                  <p className="text-gray-600">Punto de venta / Tipo</p>
                  <p className="font-semibold">
                    {String(invoice.pointOfSale).padStart(4, '0')} · cbte {invoice.cbteTipo}
                  </p>
                </div>
                {invoice.qrUrl && (
                  <a href={invoice.qrUrl} target="_blank" rel="noreferrer" className="inline-flex items-center text-blue-600 hover:underline">
                    Verificar en ARCA <ExternalLink className="h-3 w-3 ml-1" />
                  </a>
                )}
                {invoice.arcaObservaciones && (
                  <div className="rounded bg-amber-50 border border-amber-200 p-2 text-amber-900 text-xs">
                    <AlertTriangle className="h-3 w-3 inline mr-1" />
                    {invoice.arcaObservaciones}
                  </div>
                )}
                <div className="pt-2 border-t">
                  <p className="text-gray-600">Colppy</p>
                  {invoice.colppySyncStatus === 'OK' || (!invoice.colppySyncStatus && invoice.colppyId) ? (
                    <p className="font-semibold text-green-700 flex items-center">
                      <CheckCircle2 className="h-4 w-4 mr-1" /> Registrada (ID {invoice.colppyId})
                    </p>
                  ) : (
                    <div>
                      <p className="font-semibold text-amber-700 flex items-center">
                        <AlertTriangle className="h-4 w-4 mr-1" /> {invoice.colppySyncStatus === 'ERROR' ? 'Error al registrar' : 'Pendiente de registrar'}
                      </p>
                      {invoice.colppySyncError && <p className="text-xs text-gray-600 mt-1 break-words">{invoice.colppySyncError}</p>}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Cliente</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-sm text-gray-600">Razón social</p>
                <p className="font-semibold">{invoice.customer.businessName || invoice.customer.name}</p>
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
              {invoice.customer.address && (
                <div>
                  <p className="text-sm text-gray-600">Dirección</p>
                  <p className="text-sm">{invoice.customer.address}</p>
                </div>
              )}
              <Button variant="outline" className="w-full mt-2" asChild>
                <Link href={`/clientes/${invoice.customer.id}`}>Ver cliente</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Dialog NC */}
      <Dialog open={ncOpen} onOpenChange={(o) => !ncLoading && setNcOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Emitir nota de crédito {invoice.invoiceType}</DialogTitle>
            <DialogDescription>
              Se emite en ARCA asociada a la factura {nroFiscal} y se registra en Colppy. Si es total, la factura queda anulada y
              los ítems vuelven a estar disponibles para facturar en la cotización.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded border p-3 text-sm bg-gray-50">
              <div className="flex justify-between">
                <span>Total factura</span>
                <span className="font-semibold">{formatCurrency(invoice.total, invoice.currency)}</span>
              </div>
              {acreditado > 0 && (
                <div className="flex justify-between text-red-700">
                  <span>Ya acreditado</span>
                  <span>-{formatCurrency(acreditado, invoice.currency)}</span>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="nc-parcial">Neto parcial (opcional — vacío = NC total)</Label>
              <Input
                id="nc-parcial"
                placeholder={`Neto de la factura: ${Number(invoice.subtotal).toLocaleString('es-AR')}`}
                value={ncParcial}
                onChange={(e) => setNcParcial(e.target.value)}
                inputMode="decimal"
              />
              <p className="text-xs text-gray-500">Sobre el neto se calcula el IVA 21%. Una NC parcial no anula la factura ni toca la cotización.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="nc-motivo">Motivo</Label>
              <Textarea id="nc-motivo" value={ncMotivo} onChange={(e) => setNcMotivo(e.target.value)} placeholder="Ej.: cambio de CUIT / error en importe / devolución" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNcOpen(false)} disabled={ncLoading}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={emitirNC} disabled={ncLoading}>
              {ncLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileMinus className="h-4 w-4 mr-2" />}
              {ncParcial.trim() ? 'Emitir NC parcial' : 'Emitir NC total y anular'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
