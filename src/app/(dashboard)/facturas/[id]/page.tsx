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
import { ArrowLeft, Loader2, FileText, Download, RefreshCw, FileMinus, ExternalLink, AlertTriangle, CheckCircle2, Copy, Globe, Link2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency as formatCurrencyAR } from '@/lib/utils'
import { calcularImportesNc, calcularNcImporte, parseNumeroAr, type ContextoNc, type LineaAcreditable } from '@/lib/facturacion/nc-unidades'
import { esCbteExportacion } from '@/lib/arca/fex-params'
import { esClienteExterior, etiquetaIdFiscal, idFiscalParaMostrar } from '@/lib/cliente-exterior'
import { estadoSubidaMl, etiquetaColppyAsociado, ncRequiereRegistroColppy, puedeReintentarColppy } from '@/lib/facturacion/factura-directa-ui'

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

/** Datos de exportación de una Factura E (FacturaExportacion; Decimal llega como string) */
interface ExportacionInfo {
  fexId: string
  estado: string
  regimen: string
  tipoExpo: number
  desNumero: string | null
  fobUSD: number | string | null
  permisoExistente: string | null
  dstCmp: number
  cuitPais: string | null
  idImpositivo: string | null
  domicilio: string
  incoterm: string | null
  incotermDs: string | null
  formaPago: string | null
  idioma: number
  monedaCtz: number | string
  canMisMonExt: string | null
  obsComerciales: string | null
  totalUSD: number | string
  mercaderiaUSD: number | string
  manualUSD: number | string
  reproceso: boolean
  recuperado: boolean
  fechaCbte: string | null
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
    city?: string | null
    taxCondition?: string | null
    country?: string | null
    taxIdExterior?: string | null
    colppyId?: string | null
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
  updatedAt?: string | null
  /** Venta de Mercado Libre facturada con este comprobante (candado + subida del PDF) */
  mlOrderInvoice?: { packId: string; status: string; mlUploadStatus: string | null; mlUploadError: string | null; updatedAt?: string | null } | null
  /** Factura directa (/facturas/nueva, sin cotización) */
  facturaDirecta?: { id: string; mlPackId: string | null; createdAt: string; condicionPago: string | null } | null
  relatedInvoice?: { id: string; invoiceNumber: string; invoiceType: string; total: number | string; cae: string | null } | null
  relatedInvoices: RelatedInvoice[]
  /** Solo Factura E (exportación) */
  exportacion?: ExportacionInfo | null
}

const REGIMEN_LABEL: Record<string, string> = {
  EXPORTA_SIMPLE: 'Exporta Simple',
  DESPACHANTE: 'Con despachante',
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

type LineaNc = LineaAcreditable

/** Cantidad tipeada en la devolución: vacío = 0; "1.000" = 1000 (formato argentino); no numérico = NaN */
const parseCantidad = (v: string | undefined) => {
  const t = (v ?? '').trim()
  return t === '' ? 0 : parseNumeroAr(t)
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
  // ARCA no confirmó una NC (ARCA_INCIERTO): no se puede volver a emitir desde esta pantalla hasta revisarla
  const [ncBloqueada, setNcBloqueada] = useState<string | null>(null)
  const [ncMotivo, setNcMotivo] = useState('')
  const [ncParcial, setNcParcial] = useState('')
  // Devolución por unidades: líneas de la factura con lo disponible
  const [ncModo, setNcModo] = useState<'UNIDADES' | 'IMPORTE' | 'TOTAL'>('UNIDADES')
  const [ncLineas, setNcLineas] = useState<LineaNc[] | null>(null)
  const [ncLineasError, setNcLineasError] = useState<string | null>(null)
  const [ncCantidades, setNcCantidades] = useState<Record<number, string>>({})
  const [ncContexto, setNcContexto] = useState<ContextoNc | null>(null)
  // Devolución: ¿las unidades vuelven a quedar pendientes en la cotización? (default no)
  const [ncPendiente, setNcPendiente] = useState(false)
  const [ncLoading, setNcLoading] = useState(false)
  // Factura E: carga manual en Colppy (pegar el id)
  const [colppyIdManual, setColppyIdManual] = useState('')
  const [colppyClienteIdManual, setColppyClienteIdManual] = useState('')
  const [vinculandoColppy, setVinculandoColppy] = useState(false)
  const [subiendoMl, setSubiendoMl] = useState(false)

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
      if (data.borradorFce) {
        toast.success('Borrador creado en Colppy', {
          description: `ID ${data.colppyId}: abrilo en Colppy, tildá "Factura de crédito electrónica MiPyME (FCE)" y aprobalo`,
          duration: 15000,
        })
      } else {
        toast.success('Registrada en Colppy', { description: `ID Colppy ${data.colppyId}` })
      }
      fetchInvoice()
    } catch (e) {
      toast.error('No se pudo registrar en Colppy', { description: (e as Error).message })
    } finally {
      setRetrying(false)
    }
  }

  // Factura E (v1): se carga a mano en Colppy y acá se pega el id que le dio Colppy
  const vincularColppy = async () => {
    try {
      setVinculandoColppy(true)
      const colppyId = colppyIdManual.trim()
      const colppyClienteId = colppyClienteIdManual.trim()
      const r = await fetch(`/api/facturas/${id}/colppy-id`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ colppyId, ...(colppyClienteId ? { colppyClienteId } : {}) }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok || !data.success) throw new Error(data.error || 'No se pudo vincular con Colppy')
      toast.success('Factura vinculada con Colppy', {
        description: `ID Colppy ${data.colppyId}${data.colppyClienteId ? ` · cliente ${data.colppyClienteId}` : ''}`,
      })
      setColppyIdManual('')
      setColppyClienteIdManual('')
      fetchInvoice()
    } catch (e) {
      toast.error('No se pudo vincular con Colppy', { description: (e as Error).message })
    } finally {
      setVinculandoColppy(false)
    }
  }

  // Venta de ML: reintentar la subida del PDF de la factura a la venta
  const reintentarSubidaMl = async (packId: string) => {
    try {
      setSubiendoMl(true)
      const r = await fetch(`/api/mercadolibre/facturacion/${encodeURIComponent(packId)}/subir`, { method: 'POST' })
      const data = await r.json().catch(() => ({}))
      if (!r.ok || !data.ok) throw new Error(data.error || 'No se pudo subir la factura a Mercado Libre')
      toast.success('Factura subida a Mercado Libre')
      fetchInvoice()
    } catch (e) {
      toast.error('No se pudo subir a Mercado Libre', { description: (e as Error).message })
    } finally {
      setSubiendoMl(false)
    }
  }

  const copiar = async (texto: string, que: string) => {
    try {
      await navigator.clipboard.writeText(texto)
      toast.success(`${que} copiado`)
    } catch {
      toast.error('No se pudo copiar al portapapeles')
    }
  }

  const emitirNC = async () => {
    try {
      setNcLoading(true)
      const body: {
        modo: 'UNIDADES' | 'IMPORTE' | 'TOTAL'
        pendienteEnCotizacion?: boolean
        motivo?: string
        netoParcial?: number
        unidades?: Array<{ index: number; cantidad: number }>
      } = {
        modo: ncModo,
        motivo: ncMotivo.trim() || undefined,
      }
      if (ncModo === 'UNIDADES') {
        body.pendienteEnCotizacion = ncPendiente
        body.unidades = Object.entries(ncCantidades)
          .map(([index, c]) => ({ index: Number(index), cantidad: parseCantidad(c) }))
          .filter((u) => u.cantidad !== 0)
        if (!body.unidades.length) throw new Error('Indicá cuántas unidades se devuelven')
        // Misma validación que el servidor (enteros, máximos, etc.)
        if (ncLineas && ncContexto) calcularImportesNc(ncLineas, body.unidades, ncContexto)
      } else if (ncModo === 'IMPORTE') {
        body.netoParcial = parseNumeroAr(ncParcial)
        if (!(body.netoParcial > 0)) throw new Error('Indicá el neto del ajuste (ej.: 5.000,50)')
      }
      const r = await fetch(`/api/facturas/${id}/nota-credito`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await r.json()
      if (!r.ok && data.codigo === 'ARCA_INCIERTO') {
        // La NC pudo quedar autorizada en ARCA: cerrar y bloquear, nunca reintentar
        setNcOpen(false)
        setNcBloqueada(data.error)
        toast.error('ARCA no confirmó la nota de crédito: NO reintentes', { description: data.error, duration: Infinity })
        fetchInvoice()
        return
      }
      if (!r.ok) throw new Error(data.error || 'Error al emitir la nota de crédito')
      toast.success(data.colppyPendiente ? 'NC emitida (pendiente en Colppy)' : data.colppyBorradorFce ? 'NC MiPyME emitida: borrador en Colppy' : 'Nota de crédito emitida', {
        description: `${data.numero} · ${formatCurrency(data.total, invoice?.currency)} · CAE ${data.cae}${data.esTotal ? ' · factura anulada' : ''}${data.colppyBorradorFce ? ' — en Colppy tildá FCE y aprobala' : ''}`,
        duration: data.colppyBorradorFce ? 20000 : 12000,
        action: data.pdfUrl ? { label: 'Ver PDF', onClick: () => window.open(data.pdfUrl, '_blank') } : undefined,
      })
      for (const a of (data.advertencias || []) as string[]) toast.warning('Atención', { description: a, duration: 20000 })
      if (data.pdfUrl) window.open(data.pdfUrl, '_blank')
      setNcOpen(false)
      setNcMotivo('')
      setNcParcial('')
      setNcCantidades({})
      fetchInvoice()
    } catch (e) {
      toast.error('No se pudo emitir la nota de crédito', { description: (e as Error).message, duration: 15000 })
    } finally {
      setNcLoading(false)
    }
  }

  // Al abrir el diálogo de NC: líneas para la devolución por unidades
  useEffect(() => {
    if (!ncOpen) return
    let vigente = true
    setNcLineas(null)
    setNcContexto(null)
    setNcLineasError(null)
    setNcCantidades({})
    setNcPendiente(false)
    setNcModo('UNIDADES')
    fetch(`/api/facturas/${id}/nota-credito`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error || 'No se pudieron cargar las líneas')
        if (!vigente) return
        setNcLineas(d.lineas)
        setNcContexto(d.contexto)
      })
      .catch((e) => {
        if (!vigente) return
        setNcLineasError((e as Error).message)
        // Sin líneas no hay devolución por unidades (si el usuario no eligió otro modo)
        setNcModo((m) => (m === 'UNIDADES' ? 'IMPORTE' : m))
      })
    return () => {
      vigente = false
    }
  }, [ncOpen, id])

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
  // Factura/NC/ND E (exportación, WSFEX): sin IVA, sin NC A/B y carga manual en Colppy
  const esExportacion = esCbteExportacion(invoice.cbteTipo) || invoice.invoiceType === 'E'
  const exportacion = invoice.exportacion ?? null
  const cargaManualColppy = invoice.colppySyncStatus === 'MANUAL' && !invoice.colppyId
  const clienteExterior = esClienteExterior(invoice.customer)
  const ncVigentes = invoice.relatedInvoices.filter((r) => r.transactionType === 'CREDIT_NOTE' && r.status !== 'CANCELLED')
  const acreditado = ncVigentes.reduce((s, r) => s + Number(r.total), 0)

  // Vista previa de la NC por unidades: mismo cálculo que el servidor
  const ncPreview: null | { error: string } | { neto: number; iva: number; total: number; devuelveTodo: boolean; agotaTodo: boolean } = (() => {
    if (!ncLineas || !ncContexto) return null
    const seleccion = Object.entries(ncCantidades)
      .map(([index, c]) => ({ index: Number(index), cantidad: parseCantidad(c) }))
      .filter((u) => u.cantidad !== 0)
    if (!seleccion.length) return null
    try {
      const r = calcularImportesNc(ncLineas, seleccion, ncContexto)
      return { neto: r.neto, iva: r.iva, total: r.total, devuelveTodo: r.devuelveTodo, agotaTodo: r.agotaTodo }
    } catch (e) {
      return { error: (e as Error).message }
    }
  })()
  // Vista previa del ajuste por importe (formato argentino: 5.000,50)
  const ncImportePreview: null | { error: string } | { neto: number; iva: number; total: number } = (() => {
    if (!ncParcial.trim()) return null
    const pedido = parseNumeroAr(ncParcial)
    if (!(pedido > 0)) return { error: 'Importe inválido (ej.: 5.000,50)' }
    if (!ncContexto) {
      const neto = Math.round(pedido * 100) / 100
      const iva = Math.round(neto * 0.21 * 100) / 100
      return { neto, iva, total: Math.round((neto + iva) * 100) / 100 }
    }
    // Mismo cálculo que el servidor (tope, saldo exacto, total de la factura)
    try {
      return calcularNcImporte(pedido, ncContexto)
    } catch (e) {
      return { error: (e as Error).message }
    }
  })()
  // La NC de una Factura E va por WSFEX (NC E, fase 2): este diálogo emite NC A/B y no aplica
  const puedeNC = esArca && esFactura && !esExportacion && invoice.status !== 'CANCELLED' && acreditado < Number(invoice.total) - 0.01
  // Factura del ERP todavía sin registrar en Colppy (sin payload): la NC se rechaza hasta registrarla
  const ncEsperaColppy = ncRequiereRegistroColppy(invoice)
  // Subida del PDF a la venta de ML: sin resultado y reciente puede estar en curso (no se ofrece reintentar)
  const subidaMl = invoice.mlOrderInvoice ? estadoSubidaMl(invoice.mlOrderInvoice) : null
  const nroFiscal =
    invoice.pointOfSale && invoice.cbteNumero
      ? `${String(invoice.pointOfSale).padStart(4, '0')}-${String(invoice.cbteNumero).padStart(8, '0')}`
      : invoice.invoiceNumber

  // Factura E: datos para cargarla a mano en Colppy (montos en formato argentino)
  const nro2 = (n: number | string | null | undefined) =>
    Number(n ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const nombreCliente = invoice.customer.businessName || invoice.customer.name
  const idFiscalCliente = clienteExterior ? idFiscalParaMostrar(invoice.customer) : invoice.customer.cuit
  const etiquetaIdCliente = clienteExterior ? etiquetaIdFiscal(invoice.customer.country) : 'CUIT'
  const tcFactura = exportacion?.monedaCtz ?? invoice.exchangeRate
  const textoColppy = [
    `Factura E ${nroFiscal} — fecha ${formatDate(invoice.issueDate)}`,
    `Cliente: ${nombreCliente} — ${etiquetaIdCliente} ${idFiscalCliente}${invoice.customer.country ? ` — ${invoice.customer.country}` : ''}`,
    exportacion?.domicilio ? `Domicilio: ${exportacion.domicilio}` : '',
    `Moneda USD — TC ARCA ${tcFactura ? Number(tcFactura).toLocaleString('es-AR') : '—'} — IVA exento (exportación)`,
    `CAE ${invoice.cae ?? '—'} (vence ${formatDate(invoice.caeExpiration)})`,
    exportacion?.desNumero ? `Exporta Simple: DES ${exportacion.desNumero}, FOB USD ${nro2(exportacion.fobUSD)}` : '',
    exportacion?.incoterm ? `Incoterm ${exportacion.incoterm}${exportacion.incotermDs ? ` ${exportacion.incotermDs}` : ''} — Forma de pago: ${exportacion.formaPago ?? '—'}` : '',
    'Ítems:',
    ...invoice.items.map(
      (it) =>
        `${it.sku || it.product?.sku || '(sin código)'} | ${it.description ?? ''} | ${Number(it.quantity)} x USD ${nro2(it.unitPrice)}` +
        `${Number(it.discount) ? ` | Dto ${Number(it.discount)}%` : ''} | USD ${nro2(it.subtotal)}`
    ),
    `Total USD ${nro2(invoice.total)}`,
  ]
    .filter(Boolean)
    .join('\n')

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
          {invoice.facturaDirecta && (
            <Badge className="bg-indigo-100 text-indigo-800 hover:bg-indigo-100" title="Emitida desde Nueva factura, sin cotización">
              Factura directa
            </Badge>
          )}
          {invoice.mlOrderInvoice && <Badge className="bg-yellow-100 text-yellow-900 hover:bg-yellow-100">Mercado Libre</Badge>}
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
        {puedeReintentarColppy(invoice) && (
          <Button variant="outline" onClick={reintentarColppy} disabled={retrying}>
            {retrying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Reintentar registro en Colppy
          </Button>
        )}
        {puedeNC && (
          <Button
            variant="destructive"
            onClick={() => setNcOpen(true)}
            disabled={!!ncBloqueada || ncEsperaColppy}
            title={ncBloqueada ?? (ncEsperaColppy ? 'Registrá primero la factura en Colppy ("Reintentar registro en Colppy") y después emití la nota de crédito' : undefined)}
          >
            <FileMinus className="h-4 w-4 mr-2" />
            {ncBloqueada ? 'NC sin confirmar en ARCA: revisar' : 'Emitir nota de crédito'}
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
          {/* Factura E: carga manual en Colppy (v1) */}
          {cargaManualColppy && (
            <Card id="cargar-colppy" className="border-amber-300">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-amber-900">
                  <AlertTriangle className="h-5 w-5 text-amber-600" />
                  Cargar en Colppy (a mano)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <ol className="list-decimal pl-5 space-y-1 text-gray-700">
                  <li>
                    Solo la primera vez: en Colppy, dar de alta el cliente del exterior y el talonario no electrónico letra E, punto de venta{' '}
                    {String(invoice.pointOfSale ?? 10).padStart(4, '0')}.
                  </li>
                  <li>
                    Cargar la factura de venta <b>E {nroFiscal}</b> en dólares, exenta (exportación) y aprobada, con los códigos de producto
                    para que mueva el stock. Los datos están abajo.
                  </li>
                  <li>Pegar acá el id que le dio Colppy, antes del sync de las 9:00 (si no, el sync la toma como una factura nueva).</li>
                </ol>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 rounded border bg-gray-50 p-3">
                  <CampoCopiable etiqueta="Cliente" valor={nombreCliente} onCopiar={copiar} />
                  <CampoCopiable etiqueta={etiquetaIdCliente} valor={idFiscalCliente} onCopiar={copiar} mono />
                  <CampoCopiable etiqueta="País" valor={invoice.customer.country ?? '—'} onCopiar={copiar} />
                  <CampoCopiable etiqueta="Domicilio" valor={exportacion?.domicilio ?? invoice.customer.address ?? '—'} onCopiar={copiar} />
                  <CampoCopiable etiqueta="Comprobante" valor={`E ${nroFiscal}`} onCopiar={copiar} mono />
                  <CampoCopiable etiqueta="Fecha" valor={formatDate(invoice.issueDate)} onCopiar={copiar} />
                  <CampoCopiable etiqueta="Moneda / TC ARCA" valor={`USD / ${tcFactura ? Number(tcFactura).toLocaleString('es-AR') : '—'}`} onCopiar={copiar} />
                  <CampoCopiable etiqueta="Total USD (exento)" valor={nro2(invoice.total)} onCopiar={copiar} />
                  <CampoCopiable etiqueta="CAE" valor={invoice.cae ?? '—'} onCopiar={copiar} mono />
                  <CampoCopiable etiqueta="Vencimiento CAE" valor={formatDate(invoice.caeExpiration)} onCopiar={copiar} />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-gray-500">Los ítems (códigos, cantidades y precios) son los del detalle de abajo.</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => copiar(textoColppy, 'Datos de la factura')}>
                    <Copy className="h-4 w-4 mr-1" />
                    Copiar todo
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end border-t pt-3">
                  <div className="space-y-1">
                    <Label htmlFor="colppy-id-manual">Id de la factura en Colppy</Label>
                    <Input
                      id="colppy-id-manual"
                      value={colppyIdManual}
                      onChange={(e) => setColppyIdManual(e.target.value.replace(/\D/g, ''))}
                      inputMode="numeric"
                      placeholder="Ej.: 123456789"
                      autoComplete="off"
                    />
                  </div>
                  {!invoice.customer.colppyId ? (
                    <div className="space-y-1">
                      <Label htmlFor="colppy-cliente-id-manual">Id del cliente en Colppy (opcional)</Label>
                      <Input
                        id="colppy-cliente-id-manual"
                        value={colppyClienteIdManual}
                        onChange={(e) => setColppyClienteIdManual(e.target.value.replace(/\D/g, ''))}
                        inputMode="numeric"
                        placeholder="Si no, se toma de la factura en Colppy"
                        autoComplete="off"
                      />
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500 pb-2">Cliente ya vinculado en Colppy (id {invoice.customer.colppyId}).</p>
                  )}
                  <Button
                    type="button"
                    onClick={vincularColppy}
                    disabled={vinculandoColppy || !/^\d{1,20}$/.test(colppyIdManual.trim())}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {vinculandoColppy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Link2 className="h-4 w-4 mr-2" />}
                    Vincular con Colppy
                  </Button>
                </div>
                <p className="text-xs text-gray-500">
                  Antes de vincular, el ERP lee esa factura en Colppy y controla que sea esta (letra E, número, cliente y total).
                  Pasa la factura a «Registrada», vincula la comisión y vuelve a sincronizar el stock de los artículos facturados.
                  Lo pueden hacer administración, gerencia o contaduría.
                </p>
              </CardContent>
            </Card>
          )}

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

          {/* Factura E: datos de exportación */}
          {esExportacion && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Globe className="h-5 w-5 text-blue-600" />
                  Exportación
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {exportacion ? (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <DatoExportacion etiqueta="Régimen" valor={REGIMEN_LABEL[exportacion.regimen] ?? exportacion.regimen} />
                      <DatoExportacion etiqueta="N° de DES" valor={exportacion.desNumero ?? '—'} mono />
                      <DatoExportacion
                        etiqueta="FOB del DES"
                        valor={exportacion.fobUSD !== null ? formatCurrency(exportacion.fobUSD, 'USD') : '—'}
                      />
                      <DatoExportacion
                        etiqueta="Incoterm"
                        valor={exportacion.incoterm ? `${exportacion.incoterm}${exportacion.incotermDs ? ` ${exportacion.incotermDs}` : ''}` : '—'}
                      />
                      <DatoExportacion etiqueta="Forma de pago" valor={exportacion.formaPago ?? '—'} />
                      <DatoExportacion
                        etiqueta="Destino"
                        valor={`${invoice.customer.country ?? '—'} (código ARCA ${exportacion.dstCmp})`}
                      />
                      <DatoExportacion etiqueta="CUIT país" valor={exportacion.cuitPais ?? '—'} mono />
                      <DatoExportacion etiqueta={`${etiquetaIdCliente} (Id impositivo)`} valor={exportacion.idImpositivo ?? '—'} mono />
                      <DatoExportacion
                        etiqueta="TC oficial ARCA"
                        valor={`${Number(exportacion.monedaCtz).toLocaleString('es-AR')}${exportacion.canMisMonExt === 'S' ? ' · paga en dólares' : ''}`}
                      />
                      <DatoExportacion etiqueta="Mercadería (comisiona)" valor={formatCurrency(exportacion.mercaderiaUSD, 'USD')} />
                      <DatoExportacion etiqueta="Flete / seguro" valor={formatCurrency(exportacion.manualUSD, 'USD')} />
                      <DatoExportacion
                        etiqueta="Punto de venta / Id ARCA"
                        valor={`${String(invoice.pointOfSale ?? '').padStart(4, '0')} · Id ${exportacion.fexId}`}
                        mono
                      />
                    </div>
                    {exportacion.obsComerciales && (
                      <div>
                        <p className="text-sm text-gray-600">Observaciones comerciales</p>
                        <p className="text-sm whitespace-pre-line">{exportacion.obsComerciales}</p>
                      </div>
                    )}
                    {(exportacion.recuperado || exportacion.reproceso) && (
                      <p className="text-xs text-gray-500">
                        {exportacion.recuperado
                          ? 'El CAE se recuperó consultando el comprobante en ARCA después de un corte.'
                          : 'ARCA la devolvió como reproceso del mismo Id.'}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-gray-500">La factura no tiene datos de exportación vinculados.</p>
                )}
                <p className="text-xs text-gray-500">
                  Para anularla o corregirla hace falta una nota de crédito o débito E (exportación), que todavía no está disponible en el
                  ERP. Una NC E además mueve el saldo FOB del DES.
                </p>
              </CardContent>
            </Card>
          )}

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
                      {!esExportacion && <TableHead className="w-[70px] text-right">IVA %</TableHead>}
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
                        {!esExportacion && <TableCell className="text-right">{Number(item.taxRate)}%</TableCell>}
                        <TableCell className="text-right font-semibold">{formatCurrency(item.subtotal, invoice.currency)}</TableCell>
                      </TableRow>
                    ))}
                    {invoice.items.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={esExportacion ? 4 : 5} className="text-center text-gray-500 py-6">Sin detalle de ítems</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="mt-4 space-y-2">
                {esExportacion ? (
                  <>
                    {exportacion && (
                      <>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">Mercadería:</span>
                          <span className="font-semibold">{formatCurrency(exportacion.mercaderiaUSD, invoice.currency)}</span>
                        </div>
                        {Number(exportacion.manualUSD) > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">Flete / seguro:</span>
                            <span className="font-semibold">{formatCurrency(exportacion.manualUSD, invoice.currency)}</span>
                          </div>
                        )}
                      </>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">IVA:</span>
                      <span className="font-semibold">Exento — operación de exportación</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Neto gravado:</span>
                      <span className="font-semibold">{formatCurrency(invoice.subtotal, invoice.currency)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">IVA:</span>
                      <span className="font-semibold">{formatCurrency(invoice.taxAmount, invoice.currency)}</span>
                    </div>
                  </>
                )}
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
                      {etiquetaColppyAsociado(r.colppySyncStatus) && (
                        <Badge className="ml-2 bg-amber-100 text-amber-800">{etiquetaColppyAsociado(r.colppySyncStatus)}</Badge>
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
                  {invoice.colppySyncStatus === 'BORRADOR_FCE' ? (
                    <div>
                      <p className="font-semibold text-blue-700 flex items-center">
                        <AlertTriangle className="h-4 w-4 mr-1" /> Borrador en Colppy (ID {invoice.colppyId})
                      </p>
                      <p className="text-xs text-gray-600 mt-1">
                        Abrilo en Colppy, verificá que esté tildada &quot;Factura de crédito electrónica MiPyME (FCE)&quot; y aprobalo. Revisá que quede con el
                        número {String(invoice.pointOfSale ?? 7).padStart(4, '0')}-{String(invoice.cbteNumero ?? '').padStart(8, '0')}.
                      </p>
                    </div>
                  ) : cargaManualColppy ? (
                    <div>
                      <p className="font-semibold text-amber-700 flex items-center">
                        <AlertTriangle className="h-4 w-4 mr-1" /> Pendiente de cargar a mano
                      </p>
                      <p className="text-xs text-gray-600 mt-1">
                        La Factura E no se registra sola en Colppy: cargala con los datos de «Cargar en Colppy» y pegá el id.
                      </p>
                    </div>
                  ) : invoice.colppySyncStatus === 'OK' || (!invoice.colppySyncStatus && invoice.colppyId) ? (
                    <p className="font-semibold text-green-700 flex items-center">
                      <CheckCircle2 className="h-4 w-4 mr-1" /> Registrada (ID {invoice.colppyId})
                    </p>
                  ) : invoice.colppySyncStatus === 'NO_APLICA' && !invoice.colppyId ? (
                    <div>
                      <p className="font-semibold text-gray-700">No se registra en Colppy</p>
                      <p className="text-xs text-gray-600 mt-1">Se emitió con el registro en Colppy apagado (FACTURACION_REGISTRAR_COLPPY=false).</p>
                    </div>
                  ) : invoice.colppySyncStatus === 'REGISTRANDO' && !invoice.colppyId ? (
                    <div>
                      <p className="font-semibold text-blue-700 flex items-center">
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Registrando en Colppy…
                      </p>
                      <p className="text-xs text-gray-600 mt-1">
                        Actualizá la página en unos minutos. Si queda así más de 15 minutos, aparece «Reintentar registro en Colppy».
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p className="font-semibold text-amber-700 flex items-center">
                        <AlertTriangle className="h-4 w-4 mr-1" /> {invoice.colppySyncStatus === 'ERROR' && invoice.colppyId ? `Revisar en Colppy (ID ${invoice.colppyId})` : invoice.colppySyncStatus === 'ERROR' ? 'Error al registrar' : 'Pendiente de registrar'}
                      </p>
                      {invoice.colppySyncError && <p className="text-xs text-gray-600 mt-1 break-words">{invoice.colppySyncError}</p>}
                      {ncEsperaColppy && puedeNC && (
                        <p className="text-xs text-gray-600 mt-1">Para emitir una nota de crédito, primero registrala en Colppy.</p>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {invoice.mlOrderInvoice && (
            <Card>
              <CardHeader>
                <CardTitle>Mercado Libre</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <p className="text-gray-600">Venta</p>
                  <p className="font-mono font-semibold">#{invoice.mlOrderInvoice.packId}</p>
                </div>
                <div>
                  <p className="text-gray-600">PDF en la venta</p>
                  {subidaMl?.estado === 'ok' ? (
                    <p className="font-semibold text-green-700 flex items-center">
                      <CheckCircle2 className="h-4 w-4 mr-1" /> Subido a Mercado Libre
                    </p>
                  ) : subidaMl?.estado === 'en-curso' ? (
                    <div>
                      <p className="font-semibold text-blue-700 flex items-center">
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Subiendo a Mercado Libre…
                      </p>
                      <p className="text-xs text-gray-600 mt-1">Actualizá la página en unos minutos. Si sigue sin subirse, aparece «Reintentar subida a ML».</p>
                    </div>
                  ) : (
                    <div>
                      <p className="font-semibold text-amber-700 flex items-center">
                        <AlertTriangle className="h-4 w-4 mr-1" /> {invoice.mlOrderInvoice.mlUploadStatus === 'ERROR' ? 'No se pudo subir' : 'Sin subir'}
                      </p>
                      {invoice.mlOrderInvoice.mlUploadError && <p className="text-xs text-gray-600 mt-1 break-words">{invoice.mlOrderInvoice.mlUploadError}</p>}
                    </div>
                  )}
                </div>
                {subidaMl?.puedeReintentar && invoice.pdfUrl && (
                  <Button variant="outline" size="sm" className="w-full" onClick={() => reintentarSubidaMl(invoice.mlOrderInvoice!.packId)} disabled={subiendoMl}>
                    {subiendoMl ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                    Reintentar subida a ML
                  </Button>
                )}
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
                <p className="text-sm text-gray-600">{clienteExterior ? `${etiquetaIdFiscal(invoice.customer.country)} · ${invoice.customer.country ?? ''}` : 'CUIT'}</p>
                <p className="font-mono text-sm">{clienteExterior ? idFiscalParaMostrar(invoice.customer) : invoice.customer.cuit}</p>
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
            <div className="flex gap-2">
              {([
                ['UNIDADES', 'Devolución por unidades'],
                ['IMPORTE', 'Ajuste por importe'],
                ['TOTAL', 'Total (anula la factura)'],
              ] as const).map(([m, label]) => (
                <Button
                  key={m}
                  type="button"
                  size="sm"
                  variant={ncModo === m ? 'default' : 'outline'}
                  disabled={(m === 'UNIDADES' && !ncLineas) || (m === 'TOTAL' && acreditado > 0)}
                  onClick={() => setNcModo(m)}
                  className="h-8 text-xs"
                >
                  {label}
                </Button>
              ))}
            </div>

            {ncModo === 'UNIDADES' && (
              <div className="space-y-2">
                {!ncLineas && !ncLineasError && <Loader2 className="h-4 w-4 animate-spin" />}
                {ncLineas && (
                  <>
                    <div className="max-h-64 overflow-auto rounded border">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="p-2 text-left">Producto</th>
                            <th className="p-2 text-right">Facturado</th>
                            <th className="p-2 text-right">Devuelto</th>
                            <th className="p-2 text-right w-24">Devolver</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ncLineas.map((l) => {
                            const valor = ncCantidades[l.index] ?? ''
                            const n = parseCantidad(valor)
                            const invalida =
                              !Number.isFinite(n) ||
                              n < 0 ||
                              n > l.cantidadDisponible ||
                              (Number.isInteger(l.cantidadFacturada) && !Number.isInteger(n))
                            return (
                              <tr key={l.index} className="border-t align-top">
                                <td className="p-2">
                                  {l.codigo && <span className="font-mono text-gray-500 mr-1">{l.codigo}</span>}
                                  {l.descripcion.slice(0, 80)}
                                  <div className="text-gray-500">
                                    {formatCurrency(l.netoUnitario, invoice.currency)} neto c/u
                                    {!l.conStock && ' · sin artículo de stock'}
                                    {l.vinculo === 'ADICIONAL' && l.adicionalDe != null && ` · adicional de la línea ${l.adicionalDe + 1}`}
                                  </div>
                                  {l.vinculo === 'SIN_VINCULO' && ncPendiente && (
                                    <div className="text-amber-700">No se pudo vincular con la cotización: no vuelve a quedar pendiente</div>
                                  )}
                                </td>
                                <td className="p-2 text-right">{l.cantidadFacturada}</td>
                                <td className="p-2 text-right">{l.cantidadAcreditada || '—'}</td>
                                <td className="p-2 text-right">
                                  <Input
                                    value={valor}
                                    onChange={(e) => {
                                      const v = e.target.value
                                      setNcCantidades((c) => {
                                        const next = { ...c, [l.index]: v }
                                        // Los adicionales van con su ítem: misma cantidad (editable)
                                        for (const a of ncLineas) {
                                          if (a.adicionalDe === l.index && a.cantidadDisponible > 0) next[a.index] = v
                                        }
                                        return next
                                      })
                                    }}
                                    inputMode="numeric"
                                    placeholder="0"
                                    disabled={l.cantidadDisponible <= 0}
                                    className={`h-7 text-right text-xs ${invalida ? 'border-red-500' : ''}`}
                                    title={`Máximo ${l.cantidadDisponible}`}
                                  />
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    {ncPreview && 'error' in ncPreview && (
                      <p className="text-xs text-red-700">{ncPreview.error}</p>
                    )}
                    {ncPreview && 'neto' in ncPreview && (
                      <div className="rounded bg-gray-50 p-2 text-sm">
                        <div className="flex justify-between"><span>Neto</span><span>{formatCurrency(ncPreview.neto, invoice.currency)}</span></div>
                        <div className="flex justify-between"><span>IVA 21%</span><span>{formatCurrency(ncPreview.iva, invoice.currency)}</span></div>
                        <div className="flex justify-between font-semibold"><span>Total NC</span><span>{formatCurrency(ncPreview.total, invoice.currency)}</span></div>
                        {ncPreview.devuelveTodo && (ncPendiente || !invoice.quote) && (
                          <p className="mt-1 text-xs text-red-700">
                            Se devuelve todo: sale como NC total y la factura queda anulada{invoice.quote ? ' (la cotización se reabre)' : ''}.
                          </p>
                        )}
                        {ncPreview.devuelveTodo && !ncPendiente && invoice.quote && (
                          <p className="mt-1 text-xs text-gray-500">
                            Se devuelve todo: la factura queda acreditada completa y la cotización no cambia. Si es para volver a facturar
                            (error de datos), usá «Total (anula la factura)» o tildá la casilla de abajo.
                          </p>
                        )}
                        {!ncPreview.devuelveTodo && ncPreview.agotaTodo && (
                          <p className="mt-1 text-xs text-gray-500">Es lo último que quedaba: toma el saldo pendiente exacto de la factura.</p>
                        )}
                      </div>
                    )}
                    {ncContexto && ncContexto.factor < 1 && (
                      <p className="text-xs text-amber-700">
                        La factura ya tiene un ajuste por importe: el precio de las unidades devueltas baja en la misma proporción ({Math.round((1 - ncContexto.factor) * 1000) / 10}%).
                      </p>
                    )}
                    {invoice.quote && (
                      <label className="flex items-start gap-2 text-xs">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={ncPendiente}
                          onChange={(e) => setNcPendiente(e.target.checked)}
                        />
                        <span>
                          Las unidades devueltas vuelven a quedar <b>pendientes de facturar</b> en la cotización (cambio o reposición).
                          <span className="block text-gray-500">
                            Sin tildar: el cliente ya no las quiere y la cotización queda como está.
                          </span>
                        </span>
                      </label>
                    )}
                    <p className="text-xs text-gray-500">
                      Devuelve el stock en Colppy, se aplica a la factura y la comisión baja en el mes de la NC.
                    </p>
                  </>
                )}
              </div>
            )}
            {ncLineasError && ncModo !== 'TOTAL' && (
              <p className="text-xs text-amber-700">Devolución por unidades no disponible: {ncLineasError}</p>
            )}

            {ncModo === 'IMPORTE' && (
              <div className="space-y-2">
                <Label htmlFor="nc-parcial">Neto del ajuste</Label>
                <Input
                  id="nc-parcial"
                  placeholder={`Neto de la factura: ${Number(invoice.subtotal).toLocaleString('es-AR')}`}
                  value={ncParcial}
                  onChange={(e) => setNcParcial(e.target.value)}
                  inputMode="decimal"
                />
                {ncImportePreview && 'error' in ncImportePreview && <p className="text-xs text-red-700">{ncImportePreview.error}</p>}
                {ncImportePreview && 'neto' in ncImportePreview && (
                  <div className="rounded bg-gray-50 p-2 text-sm">
                    <div className="flex justify-between"><span>Neto</span><span>{formatCurrency(ncImportePreview.neto, invoice.currency)}</span></div>
                    <div className="flex justify-between"><span>IVA 21%</span><span>{formatCurrency(ncImportePreview.iva, invoice.currency)}</span></div>
                    <div className="flex justify-between font-semibold"><span>Total NC</span><span>{formatCurrency(ncImportePreview.total, invoice.currency)}</span></div>
                  </div>
                )}
                <p className="text-xs text-gray-500">
                  Sobre el neto se calcula el IVA 21%. Para diferencias de precio o bonificaciones: no devuelve stock ni toca la cotización.
                </p>
              </div>
            )}
            {ncModo === 'TOTAL' && (
              <p className="text-sm text-red-700">
                Anula la factura completa: devuelve todo el stock, los ítems vuelven a estar pendientes en la cotización y se quita la comisión.
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="nc-motivo">Motivo</Label>
              <Textarea id="nc-motivo" value={ncMotivo} onChange={(e) => setNcMotivo(e.target.value)} placeholder="Ej.: cambio de CUIT / error en importe / devolución" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNcOpen(false)} disabled={ncLoading}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={emitirNC}
              disabled={
                ncLoading ||
                (ncModo === 'UNIDADES' && (!ncPreview || 'error' in ncPreview)) ||
                (ncModo === 'IMPORTE' && (!ncImportePreview || 'error' in ncImportePreview))
              }
            >
              {ncLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileMinus className="h-4 w-4 mr-2" />}
              {ncModo === 'UNIDADES' ? 'Emitir NC por devolución' : ncModo === 'IMPORTE' ? 'Emitir NC por importe' : 'Emitir NC total y anular'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Dato de la tarjeta de exportación */
function DatoExportacion({ etiqueta, valor, mono }: { etiqueta: string; valor: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-sm text-gray-600">{etiqueta}</p>
      <p className={`font-semibold break-words ${mono ? 'font-mono text-sm' : ''}`}>{valor}</p>
    </div>
  )
}

/** Dato para copiar a Colppy, con botón de copiar */
function CampoCopiable({
  etiqueta,
  valor,
  onCopiar,
  mono,
}: {
  etiqueta: string
  valor: string
  onCopiar: (texto: string, que: string) => void
  mono?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-2 border-b border-dashed border-gray-200 py-1">
      <div className="min-w-0">
        <p className="text-xs text-gray-500">{etiqueta}</p>
        <p className={`break-words ${mono ? 'font-mono' : 'font-medium'}`}>{valor}</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 flex-shrink-0 text-gray-500"
        onClick={() => onCopiar(valor, etiqueta)}
        aria-label={`Copiar ${etiqueta}`}
        title={`Copiar ${etiqueta}`}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
