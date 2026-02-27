'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
  ArrowLeft,
  ArrowRight,
  Loader2,
  Package,
  Truck,
  Plus,
  Trash2,
  Search,
  User,
  ClipboardList,
  DollarSign,
  CheckCircle2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  ColppyCustomerSearch,
  type ColppyCustomer,
} from '@/components/ColppyCustomerSearch'

// ── Interfaces ────────────────────────────────────────────────────────────────

interface QuoteItem {
  id: string
  description: string | null
  quantity: number
  isAlternative: boolean
  product: { name: string; sku: string; unit: string } | null
  manualSku?: string | null
}

interface Quote {
  id: string
  quoteNumber: string
  status: string
  subtotal: number | string
  total: number | string
  currency: string
  customer: {
    id: string
    name: string
    businessName: string | null
    cuit: string | null
    address: string | null
    city: string | null
    province: string | null
    taxCondition: string | null
  }
  items: QuoteItem[]
  exchangeRate?: number | string | null
}

interface RemitoItem {
  tempId: string
  productId: string | null
  sku: string
  description: string
  quantity: number
  unit: string
}

interface ProductResult {
  id: string
  sku: string
  name: string
  brand: string | null
  unit: string
  status: string
}

// ── Step indicators ───────────────────────────────────────────────────────────

const STEPS_DIRECT = [
  { num: 1, label: 'Cliente', icon: User },
  { num: 2, label: 'Datos', icon: Truck },
  { num: 3, label: 'Items', icon: ClipboardList },
  { num: 4, label: 'Valor', icon: DollarSign },
]

function StepIndicator({
  steps,
  currentStep,
}: {
  steps: typeof STEPS_DIRECT
  currentStep: number
}) {
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {steps.map((step, idx) => {
        const Icon = step.icon
        const isActive = currentStep === step.num
        const isDone = currentStep > step.num
        return (
          <div key={step.num} className="flex items-center gap-2">
            {idx > 0 && (
              <div
                className={`w-8 h-0.5 ${
                  isDone ? 'bg-blue-500' : 'bg-gray-200'
                }`}
              />
            )}
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-300'
                  : isDone
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-400'
              }`}
            >
              {isDone ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <Icon className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">{step.label}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════

export default function NuevoRemitoPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const quoteId = searchParams.get('quoteId')

  // Si viene quoteId → modo cotización (flujo original)
  // Si no → modo directo (nuevo)
  const isFromQuote = !!quoteId

  // ── Quote mode state ──
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(isFromQuote)

  // ── Direct mode state ──
  const [step, setStep] = useState(1)
  const [customer, setCustomer] = useState<ColppyCustomer | null>(null)

  // ── Shared form fields ──
  const [carrier, setCarrier] = useState('')
  const [transportAddress, setTransportAddress] = useState('')
  const [purchaseOrder, setPurchaseOrder] = useState('')
  const [customerInvoiceNumber, setCustomerInvoiceNumber] = useState('')
  const [invoiceRef, setInvoiceRef] = useState('')
  const [bultos, setBultos] = useState('')
  const [notes, setNotes] = useState('')
  const [remitoDate, setRemitoDate] = useState(
    new Date().toISOString().split('T')[0]
  )
  const [totalAmountARS, setTotalAmountARS] = useState('')

  // ── Items state (direct mode) ──
  const [items, setItems] = useState<RemitoItem[]>([])
  const [productSearch, setProductSearch] = useState('')
  const [productResults, setProductResults] = useState<ProductResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [showProductDropdown, setShowProductDropdown] = useState(false)
  const productSearchRef = useRef<HTMLDivElement>(null)

  // Manual item fields
  const [manualSku, setManualSku] = useState('')
  const [manualDesc, setManualDesc] = useState('')
  const [manualQty, setManualQty] = useState('1')
  const [manualUnit, setManualUnit] = useState('UN')

  const [submitting, setSubmitting] = useState(false)

  // ── Load quote if from quote ──
  useEffect(() => {
    if (isFromQuote) {
      fetchQuote()
    }
  }, [quoteId])

  // ── Product search debounce ──
  useEffect(() => {
    if (productSearch.length < 2) {
      setProductResults([])
      setShowProductDropdown(false)
      return
    }
    const timeout = setTimeout(() => searchProducts(productSearch), 300)
    return () => clearTimeout(timeout)
  }, [productSearch])

  // ── Click outside to close dropdown ──
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        productSearchRef.current &&
        !productSearchRef.current.contains(e.target as Node)
      ) {
        setShowProductDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // ══════════════════════════════════════════════════════════════════════════
  // FETCH FUNCTIONS
  // ══════════════════════════════════════════════════════════════════════════

  const fetchQuote = async () => {
    try {
      const res = await fetch(`/api/quotes/${quoteId}`)
      if (!res.ok) throw new Error('Error al cargar cotización')
      const data = await res.json()
      setQuote(data)
    } catch {
      toast.error('Error al cargar la cotización')
      router.push('/cotizaciones')
    } finally {
      setQuoteLoading(false)
    }
  }

  const searchProducts = async (query: string) => {
    try {
      setSearchLoading(true)
      const params = new URLSearchParams({
        search: query,
        limit: '15',
        status: 'ACTIVE',
      })
      const res = await fetch(`/api/productos?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        setProductResults(data.products || [])
        setShowProductDropdown(true)
      }
    } catch {
      setProductResults([])
    } finally {
      setSearchLoading(false)
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ITEM HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  const addProductItem = (product: ProductResult) => {
    setItems((prev) => [
      ...prev,
      {
        tempId: crypto.randomUUID(),
        productId: product.id,
        sku: product.sku,
        description: product.name,
        quantity: 1,
        unit: product.unit || 'UN',
      },
    ])
    setProductSearch('')
    setShowProductDropdown(false)
    toast.success(`${product.sku} agregado`)
  }

  const addManualItem = () => {
    if (!manualDesc.trim()) {
      toast.error('La descripción es requerida')
      return
    }
    setItems((prev) => [
      ...prev,
      {
        tempId: crypto.randomUUID(),
        productId: null,
        sku: manualSku.trim(),
        description: manualDesc.trim(),
        quantity: parseFloat(manualQty) || 1,
        unit: manualUnit || 'UN',
      },
    ])
    setManualSku('')
    setManualDesc('')
    setManualQty('1')
    setManualUnit('UN')
    toast.success('Item agregado')
  }

  const removeItem = (tempId: string) => {
    setItems((prev) => prev.filter((i) => i.tempId !== tempId))
  }

  const updateItemQty = (tempId: string, qty: number) => {
    setItems((prev) =>
      prev.map((i) => (i.tempId === tempId ? { ...i, quantity: qty } : i))
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SUBMIT
  // ══════════════════════════════════════════════════════════════════════════

  const handleSubmitFromQuote = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!quote) return

    setSubmitting(true)
    try {
      const res = await fetch(`/api/quotes/${quoteId}/generate-delivery-note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          carrier: carrier || undefined,
          transportAddress: transportAddress || undefined,
          purchaseOrder: purchaseOrder || undefined,
          customerInvoiceNumber: customerInvoiceNumber || undefined,
          bultos: bultos ? parseInt(bultos) : undefined,
          notes: notes || undefined,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Error al generar remito')
      }

      const deliveryNote = await res.json()
      toast.success(`Remito ${deliveryNote.deliveryNumber} generado`)
      router.push(`/remitos/${deliveryNote.id}`)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Error al generar remito'
      )
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmitDirect = async () => {
    if (!customer) {
      toast.error('Seleccioná un cliente')
      return
    }
    if (items.length === 0) {
      toast.error('Agregá al menos un item')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/delivery-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          colppyCustomer: {
            name: customer.name,
            businessName: customer.businessName,
            cuit: customer.cuit,
            taxCondition: customer.taxCondition,
            email: customer.email,
            phone: customer.phone,
            mobile: customer.mobile,
            address: customer.address,
            city: customer.city,
            province: customer.province,
            postalCode: customer.postalCode,
          },
          date: remitoDate,
          carrier: carrier || undefined,
          transportAddress: transportAddress || undefined,
          purchaseOrder: purchaseOrder || undefined,
          customerInvoiceNumber: customerInvoiceNumber || undefined,
          invoiceRef: invoiceRef || undefined,
          bultos: bultos || undefined,
          totalAmountARS: totalAmountARS || undefined,
          notes: notes || undefined,
          items: items.map((item) => ({
            productId: item.productId,
            sku: item.sku,
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
          })),
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Error al crear remito')
      }

      const deliveryNote = await res.json()
      toast.success(`Remito ${deliveryNote.deliveryNumber} creado`)
      router.push(`/remitos/${deliveryNote.id}`)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Error al crear remito'
      )
    } finally {
      setSubmitting(false)
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER — QUOTE MODE (original flow)
  // ══════════════════════════════════════════════════════════════════════════

  if (isFromQuote) {
    if (quoteLoading) {
      return (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      )
    }

    if (!quote) return null

    const mainItems = quote.items.filter((i) => !i.isAlternative)

    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center gap-4">
          <Link href={`/cotizaciones/${quoteId}/ver`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Volver
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Package className="h-6 w-6 text-blue-600" />
              Generar Remito
            </h1>
            <p className="text-sm text-gray-500">
              Cotización {quote.quoteNumber} ·{' '}
              {quote.customer.businessName || quote.customer.name}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmitFromQuote} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Datos del cliente</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="font-semibold">
                  {quote.customer.businessName || quote.customer.name}
                </p>
                {quote.customer.cuit && (
                  <p className="text-gray-500">CUIT: {quote.customer.cuit}</p>
                )}
                {quote.customer.address && (
                  <p className="text-gray-500">{quote.customer.address}</p>
                )}
                {quote.customer.city && (
                  <p className="text-gray-500">
                    {quote.customer.city}
                    {quote.customer.province
                      ? `, ${quote.customer.province}`
                      : ''}
                  </p>
                )}
              </div>
              <div>
                {quote.customer.taxCondition && (
                  <p className="text-gray-500">
                    IVA: {quote.customer.taxCondition}
                  </p>
                )}
                <Badge variant="outline" className="mt-1">
                  {quote.currency}{' '}
                  {Number(quote.subtotal).toLocaleString('es-AR', {
                    minimumFractionDigits: 2,
                  })}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Items a remitir ({mainItems.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Descripción</TableHead>
                    <TableHead className="text-right w-24">Cantidad</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mainItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <p className="font-medium">
                          {item.product?.sku || item.manualSku
                            ? `${item.product?.sku || item.manualSku} - `
                            : ''}
                          {item.description || item.product?.name}
                        </p>
                      </TableCell>
                      <TableCell className="text-right">
                        {item.quantity} {item.product?.unit || 'UN'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Truck className="h-4 w-4" />
                Datos del remito
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="purchaseOrder">OC del cliente</Label>
                <Input
                  id="purchaseOrder"
                  placeholder="Número de orden de compra"
                  value={purchaseOrder}
                  onChange={(e) => setPurchaseOrder(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="customerInvoiceNumber">Factura del cliente</Label>
                <Input
                  id="customerInvoiceNumber"
                  placeholder="Número de factura del cliente"
                  value={customerInvoiceNumber}
                  onChange={(e) => setCustomerInvoiceNumber(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bultos">Cantidad de bultos</Label>
                <Input
                  id="bultos"
                  type="number"
                  min="1"
                  placeholder="Ej: 3"
                  value={bultos}
                  onChange={(e) => setBultos(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="carrier">Transporte</Label>
                <Input
                  id="carrier"
                  placeholder="Nombre del transporte"
                  value={carrier}
                  onChange={(e) => setCarrier(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="transportAddress">
                  Dirección del transporte
                </Label>
                <Input
                  id="transportAddress"
                  placeholder="Dirección del transporte"
                  value={transportAddress}
                  onChange={(e) => setTransportAddress(e.target.value)}
                />
              </div>
              <div className="space-y-2 col-span-2">
                <Label htmlFor="notes">Observaciones</Label>
                <Textarea
                  id="notes"
                  placeholder="Observaciones adicionales..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-3">
            <Link href={`/cotizaciones/${quoteId}/ver`}>
              <Button variant="outline" type="button">
                Cancelar
              </Button>
            </Link>
            <Button
              type="submit"
              disabled={submitting}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generando...
                </>
              ) : (
                <>
                  <Package className="h-4 w-4 mr-2" /> Generar Remito
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER — DIRECT MODE (multi-step wizard)
  // ══════════════════════════════════════════════════════════════════════════

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/remitos">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Volver
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Package className="h-6 w-6 text-blue-600" />
            Nuevo Remito Directo
          </h1>
          <p className="text-sm text-gray-500">
            Crear remito sin cotización vinculada
          </p>
        </div>
      </div>

      <StepIndicator steps={STEPS_DIRECT} currentStep={step} />

      {/* ── PASO 1: CLIENTE ── */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5 text-blue-600" />
              Paso 1 — Seleccionar Cliente
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ColppyCustomerSearch value={customer} onChange={setCustomer} />

            <div className="flex justify-end pt-4">
              <Button
                onClick={() => setStep(2)}
                disabled={!customer}
                className="bg-blue-600 hover:bg-blue-700"
              >
                Siguiente
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── PASO 2: DATOS DEL REMITO ── */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5 text-blue-600" />
              Paso 2 — Datos del Remito
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="remitoDate">Fecha</Label>
                <Input
                  id="remitoDate"
                  type="date"
                  value={remitoDate}
                  onChange={(e) => setRemitoDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="d-carrier">Transporte</Label>
                <Input
                  id="d-carrier"
                  placeholder="Nombre del transporte"
                  value={carrier}
                  onChange={(e) => setCarrier(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="d-transportAddress">
                  Dirección del transporte
                </Label>
                <Input
                  id="d-transportAddress"
                  placeholder="Dirección del transporte"
                  value={transportAddress}
                  onChange={(e) => setTransportAddress(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="d-purchaseOrder">
                  O.C. / Pedido Nº{' '}
                  <span className="text-gray-400 font-normal">(opcional)</span>
                </Label>
                <Input
                  id="d-purchaseOrder"
                  placeholder="Número de orden de compra"
                  value={purchaseOrder}
                  onChange={(e) => setPurchaseOrder(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="d-customerInvoiceNumber">
                  Factura del cliente{' '}
                  <span className="text-gray-400 font-normal">(opcional)</span>
                </Label>
                <Input
                  id="d-customerInvoiceNumber"
                  placeholder="Número de factura del cliente"
                  value={customerInvoiceNumber}
                  onChange={(e) => setCustomerInvoiceNumber(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="d-invoiceRef">
                  Nº Factura asociada{' '}
                  <span className="text-gray-400 font-normal">(opcional)</span>
                </Label>
                <Input
                  id="d-invoiceRef"
                  placeholder="Ej: A 0001-00012345"
                  value={invoiceRef}
                  onChange={(e) => setInvoiceRef(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="d-bultos">
                  Cantidad de bultos{' '}
                  <span className="text-gray-400 font-normal">(opcional)</span>
                </Label>
                <Input
                  id="d-bultos"
                  type="number"
                  min="1"
                  placeholder="Ej: 3"
                  value={bultos}
                  onChange={(e) => setBultos(e.target.value)}
                />
              </div>
              <div className="space-y-2 col-span-2">
                <Label htmlFor="d-notes">
                  Notas{' '}
                  <span className="text-gray-400 font-normal">(opcional)</span>
                </Label>
                <Textarea
                  id="d-notes"
                  placeholder="Observaciones adicionales..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                />
              </div>
            </div>

            <div className="flex justify-between pt-4">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Anterior
              </Button>
              <Button
                onClick={() => setStep(3)}
                className="bg-blue-600 hover:bg-blue-700"
              >
                Siguiente
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── PASO 3: ITEMS ── */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-blue-600" />
              Paso 3 — Agregar Items
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Buscador de producto */}
            <div>
              <Label className="text-sm font-semibold mb-2 block">
                Buscar producto
              </Label>
              <div className="relative" ref={productSearchRef}>
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Buscar por SKU o nombre..."
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  className="pl-10"
                />
                {searchLoading && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-blue-500" />
                )}

                {showProductDropdown && productResults.length > 0 && (
                  <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto">
                    {productResults.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => addProductItem(p)}
                        className="w-full p-3 text-left hover:bg-blue-50 transition-colors border-b border-gray-50 last:border-0"
                      >
                        <span className="font-mono font-bold text-sm text-blue-700">
                          {p.sku}
                        </span>
                        <span className="text-sm text-gray-700 ml-2">
                          {p.name}
                        </span>
                        {p.brand && (
                          <Badge variant="outline" className="ml-2 text-xs">
                            {p.brand}
                          </Badge>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {showProductDropdown &&
                  !searchLoading &&
                  productResults.length === 0 &&
                  productSearch.length >= 2 && (
                    <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-4 text-center text-sm text-gray-500">
                      No se encontraron productos
                    </div>
                  )}
              </div>
            </div>

            {/* O agregar item manual */}
            <div>
              <Label className="text-sm font-semibold mb-2 block">
                O agregar item manual
              </Label>
              <div className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs text-gray-500">Código</Label>
                  <Input
                    placeholder="SKU"
                    value={manualSku}
                    onChange={(e) => setManualSku(e.target.value)}
                    className="text-sm"
                  />
                </div>
                <div className="col-span-5 space-y-1">
                  <Label className="text-xs text-gray-500">
                    Descripción *
                  </Label>
                  <Input
                    placeholder="Descripción del item"
                    value={manualDesc}
                    onChange={(e) => setManualDesc(e.target.value)}
                    className="text-sm"
                  />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs text-gray-500">Cantidad</Label>
                  <Input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={manualQty}
                    onChange={(e) => setManualQty(e.target.value)}
                    className="text-sm"
                  />
                </div>
                <div className="col-span-1 space-y-1">
                  <Label className="text-xs text-gray-500">Unid.</Label>
                  <Input
                    placeholder="UN"
                    value={manualUnit}
                    onChange={(e) => setManualUnit(e.target.value)}
                    className="text-sm"
                  />
                </div>
                <div className="col-span-2">
                  <Button
                    type="button"
                    onClick={addManualItem}
                    variant="outline"
                    className="w-full"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Agregar
                  </Button>
                </div>
              </div>
            </div>

            {/* Lista de items */}
            {items.length > 0 ? (
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50">
                      <TableHead className="w-24">Código</TableHead>
                      <TableHead>Descripción</TableHead>
                      <TableHead className="w-20 text-center">Cant.</TableHead>
                      <TableHead className="w-16 text-center">Unid.</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => (
                      <TableRow key={item.tempId}>
                        <TableCell className="font-mono text-sm font-semibold">
                          {item.sku || '—'}
                        </TableCell>
                        <TableCell className="text-sm">
                          {item.description}
                        </TableCell>
                        <TableCell className="text-center">
                          <Input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={item.quantity}
                            onChange={(e) =>
                              updateItemQty(
                                item.tempId,
                                parseFloat(e.target.value) || 1
                              )
                            }
                            className="w-16 mx-auto text-center text-sm h-8"
                          />
                        </TableCell>
                        <TableCell className="text-center text-sm">
                          {item.unit}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeItem(item.tempId)}
                            className="text-red-500 hover:text-red-700 hover:bg-red-50 h-8 w-8 p-0"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="bg-gray-50 px-4 py-2 text-sm text-gray-600 border-t">
                  {items.length} item{items.length !== 1 ? 's' : ''} ·{' '}
                  {items
                    .reduce((s, i) => s + i.quantity, 0)
                    .toLocaleString('es-AR')}{' '}
                  unidades
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400 border-2 border-dashed rounded-lg">
                <ClipboardList className="h-10 w-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm">
                  No hay items agregados. Buscá un producto o agregá uno manual.
                </p>
              </div>
            )}

            <div className="flex justify-between pt-4">
              <Button variant="outline" onClick={() => setStep(2)}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Anterior
              </Button>
              <Button
                onClick={() => setStep(4)}
                disabled={items.length === 0}
                className="bg-blue-600 hover:bg-blue-700"
              >
                Siguiente
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── PASO 4: VALOR DECLARADO + CONFIRMACIÓN ── */}
      {step === 4 && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-blue-600" />
                Paso 4 — Valor Declarado y Confirmación
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="max-w-sm space-y-2">
                <Label htmlFor="d-totalARS">Valor Declarado (ARS)</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-semibold">
                    $
                  </span>
                  <Input
                    id="d-totalARS"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={totalAmountARS}
                    onChange={(e) => setTotalAmountARS(e.target.value)}
                    className="pl-7"
                  />
                </div>
                <p className="text-xs text-gray-400">
                  Siempre en pesos argentinos. Dejá vacío si no aplica.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Resumen */}
          <Card className="border-blue-200 bg-blue-50/30">
            <CardHeader>
              <CardTitle className="text-base">Resumen del Remito</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-gray-500">Cliente</p>
                  <p className="font-semibold">{customer?.name}</p>
                  {customer?.cuit && (
                    <p className="text-gray-500 text-xs">
                      CUIT: {customer.cuit}
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-gray-500">Fecha</p>
                  <p className="font-semibold">
                    {new Date(remitoDate + 'T12:00:00').toLocaleDateString(
                      'es-AR'
                    )}
                  </p>
                </div>
                {carrier && (
                  <div>
                    <p className="text-gray-500">Transporte</p>
                    <p className="font-semibold">{carrier}</p>
                  </div>
                )}
                {purchaseOrder && (
                  <div>
                    <p className="text-gray-500">O.C.</p>
                    <p className="font-semibold">{purchaseOrder}</p>
                  </div>
                )}
                {invoiceRef && (
                  <div>
                    <p className="text-gray-500">Factura</p>
                    <p className="font-semibold">{invoiceRef}</p>
                  </div>
                )}
                {bultos && (
                  <div>
                    <p className="text-gray-500">Bultos</p>
                    <p className="font-semibold">{bultos}</p>
                  </div>
                )}
              </div>

              <div className="pt-2 border-t">
                <p className="text-gray-500 mb-1">
                  Items ({items.length})
                </p>
                <ul className="space-y-1">
                  {items.map((item) => (
                    <li key={item.tempId} className="flex justify-between">
                      <span>
                        {item.sku && (
                          <span className="font-mono text-xs font-bold text-blue-700 mr-1">
                            {item.sku}
                          </span>
                        )}
                        {item.description}
                      </span>
                      <span className="font-semibold">
                        {item.quantity} {item.unit}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {totalAmountARS && (
                <div className="pt-2 border-t">
                  <p className="text-gray-500">Valor Declarado</p>
                  <p className="font-bold text-lg">
                    ${' '}
                    {parseFloat(totalAmountARS).toLocaleString('es-AR', {
                      minimumFractionDigits: 2,
                    })}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(3)}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Anterior
            </Button>
            <Button
              onClick={handleSubmitDirect}
              disabled={submitting}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creando...
                </>
              ) : (
                <>
                  <Package className="h-4 w-4 mr-2" /> Crear Remito
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
