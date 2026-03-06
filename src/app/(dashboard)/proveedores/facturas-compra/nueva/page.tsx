'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  Loader2,
  Plus,
  Trash2,
  Save,
  Upload,
  FileText,
  Sparkles,
  Eye,
  X,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react'
import { toast } from 'sonner'

// ============ TYPES ============

interface Supplier {
  id: string
  name: string
  taxId: string | null
}

interface Product {
  id: string
  sku: string
  name: string
  costPrice: number | null
}

interface InvoiceItem {
  id: string
  productId: string | null
  supplierProductCode: string
  description: string
  unit: string
  quantity: number
  listPrice: number
  bonificacion: number
  taxRate: number
}

interface OcrData {
  proveedor: {
    razonSocial: string
    cuit: string
    condicionIva: string
    direccion: string
  }
  factura: {
    tipo: string
    tipoComprobante: string
    puntoVenta: string
    numero: string
    fecha: string
    fechaVencimiento: string | null
    cae: string | null
    vencimientoCae: string | null
    condicionPago: string | null
    moneda: string
    tipoCambio: number | null
  }
  items: Array<{
    codigo: string | null
    descripcion: string
    cantidad: number
    precioUnitario: number
    bonificacion: number
    subtotal: number
    alicuotaIva: number
  }>
  totales: {
    subtotal: number
    netoNoGravado: number
    exento: number
    iva21: number
    iva105: number
    iva27: number
    percepcionIIBB: number
    percepcionIva: number
    impuestosInternos: number
    otrosImpuestos: number
    descuento: number
    total: number
  }
}

// ============ COMPONENT ============

export default function NewPurchaseInvoicePage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Step management: 'upload' | 'form'
  const [step, setStep] = useState<'upload' | 'form'>('upload')
  const [loading, setLoading] = useState(false)
  const [ocrProcessing, setOcrProcessing] = useState(false)
  const [ocrUsed, setOcrUsed] = useState(false)

  // File preview
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null)

  // Data
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<Product[]>([])

  // Invoice form fields
  const [supplierId, setSupplierId] = useState('')
  const [supplierInfo, setSupplierInfo] = useState({ razonSocial: '', cuit: '', condicionIva: '', direccion: '' })
  const [voucherType, setVoucherType] = useState('A')
  const [invoiceType, setInvoiceType] = useState('FA')
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0])
  const [dueDate, setDueDate] = useState(
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  )
  const [pointOfSale, setPointOfSale] = useState('')
  const [invoiceNumberSuffix, setInvoiceNumberSuffix] = useState('')
  const [cae, setCae] = useState('')
  const [caeExpiration, setCaeExpiration] = useState('')
  const [paymentTerms, setPaymentTerms] = useState('')
  const [generalDiscount, setGeneralDiscount] = useState(0)
  const [description, setDescription] = useState('')
  const [internalNotes, setInternalNotes] = useState('')
  const [currency, setCurrency] = useState('ARS')
  const [exchangeRate, setExchangeRate] = useState(1)

  // Items
  const [items, setItems] = useState<InvoiceItem[]>([
    {
      id: '1',
      productId: null,
      supplierProductCode: '',
      description: '',
      unit: 'UN',
      quantity: 0,
      listPrice: 0,
      bonificacion: 0,
      taxRate: 21,
    },
  ])

  // Percepciones
  const [percepcionIIBB, setPercepcionIIBB] = useState(0)
  const [percepcionIva, setPercepcionIva] = useState(0)
  const [otrosImpuestos, setOtrosImpuestos] = useState(0)

  // ============ DATA FETCHING ============

  const fetchSuppliers = useCallback(async () => {
    try {
      const response = await fetch('/api/proveedores?limit=1000')
      if (response.ok) {
        const data = await response.json()
        setSuppliers(data.suppliers || [])
      }
    } catch (error) {
      console.error('Error:', error)
    }
  }, [])

  const fetchProducts = useCallback(async () => {
    try {
      const response = await fetch('/api/productos?limit=1000')
      if (response.ok) {
        const data = await response.json()
        setProducts(Array.isArray(data) ? data : (data.products || data.data || []))
      }
    } catch (error) {
      console.error('Error:', error)
    }
  }, [])

  useEffect(() => {
    fetchSuppliers()
    fetchProducts()
  }, [fetchSuppliers, fetchProducts])

  useEffect(() => {
    if (currency === 'USD') {
      fetchExchangeRate()
    } else {
      setExchangeRate(1)
    }
  }, [currency])

  const fetchExchangeRate = async () => {
    try {
      const response = await fetch('/api/tipo-cambio?currency=USD')
      if (response.ok) {
        const data = await response.json()
        if (data.length > 0) {
          setExchangeRate(Number(data[0].sellRate))
        }
      }
    } catch (error) {
      console.error('Error fetching exchange rate:', error)
    }
  }

  // ============ OCR LOGIC ============

  const handleFileSelect = async (file: File) => {
    setUploadedFile(file)

    // Create preview URL
    if (file.type.startsWith('image/')) {
      setFilePreviewUrl(URL.createObjectURL(file))
    } else if (file.type === 'application/pdf') {
      setFilePreviewUrl(URL.createObjectURL(file))
    }

    // Send to OCR
    await processOcr(file)
  }

  const processOcr = async (file: File) => {
    setOcrProcessing(true)
    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/purchase-invoices/ocr', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error al procesar factura')
      }

      const result = await response.json()
      if (result.success && result.data) {
        applyOcrData(result.data)
        setOcrUsed(true)
        setStep('form')
        toast.success('Factura procesada con IA. Revisá los datos antes de guardar.')
      }
    } catch (error) {
      console.error('OCR Error:', error)
      toast.error(error instanceof Error ? error.message : 'Error al procesar la factura con IA')
      // Allow manual entry even if OCR fails
      setStep('form')
    } finally {
      setOcrProcessing(false)
    }
  }

  const applyOcrData = (data: OcrData) => {
    // Try to match supplier by CUIT
    if (data.proveedor?.cuit) {
      const normalizedCuit = data.proveedor.cuit.replace(/[-\s]/g, '')
      const matchedSupplier = suppliers.find((s) => {
        const sTaxId = (s.taxId || '').replace(/[-\s]/g, '')
        return sTaxId === normalizedCuit
      })
      if (matchedSupplier) {
        setSupplierId(matchedSupplier.id)
      }
    }
    setSupplierInfo({
      razonSocial: data.proveedor?.razonSocial || '',
      cuit: data.proveedor?.cuit || '',
      condicionIva: data.proveedor?.condicionIva || '',
      direccion: data.proveedor?.direccion || '',
    })

    // Invoice data
    if (data.factura) {
      const f = data.factura
      if (f.tipo) setVoucherType(f.tipo)
      if (f.tipoComprobante) setInvoiceType(f.tipoComprobante)
      if (f.puntoVenta) setPointOfSale(f.puntoVenta)
      if (f.numero) setInvoiceNumberSuffix(f.numero)
      if (f.fecha) setInvoiceDate(f.fecha)
      if (f.fechaVencimiento) setDueDate(f.fechaVencimiento)
      if (f.cae) setCae(f.cae)
      if (f.vencimientoCae) setCaeExpiration(f.vencimientoCae)
      if (f.condicionPago) setPaymentTerms(f.condicionPago)
      if (f.moneda) setCurrency(f.moneda)
      if (f.tipoCambio) setExchangeRate(f.tipoCambio)
    }

    // Items
    if (data.items && data.items.length > 0) {
      setItems(
        data.items.map((item, idx) => ({
          id: String(idx + 1),
          productId: null,
          supplierProductCode: item.codigo || '',
          description: item.descripcion || '',
          unit: 'UN',
          quantity: Number(item.cantidad) || 0,
          listPrice: Number(item.precioUnitario) || 0,
          bonificacion: Number(item.bonificacion) || 0,
          taxRate: Number(item.alicuotaIva) || 21,
        }))
      )
    }

    // Totals - percepciones
    if (data.totales) {
      setPercepcionIIBB(Number(data.totales.percepcionIIBB) || 0)
      setPercepcionIva(Number(data.totales.percepcionIva) || 0)
      setOtrosImpuestos(
        (Number(data.totales.impuestosInternos) || 0) + (Number(data.totales.otrosImpuestos) || 0)
      )
      if (data.totales.descuento && data.totales.subtotal) {
        const discPct = (data.totales.descuento / data.totales.subtotal) * 100
        setGeneralDiscount(Math.round(discPct * 100) / 100)
      }
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFileSelect(file)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  // ============ ITEM CALCULATIONS ============

  const addItem = () => {
    setItems([
      ...items,
      {
        id: Date.now().toString(),
        productId: null,
        supplierProductCode: '',
        description: '',
        unit: 'UN',
        quantity: 0,
        listPrice: 0,
        bonificacion: 0,
        taxRate: 21,
      },
    ])
  }

  const removeItem = (id: string) => {
    if (items.length > 1) {
      setItems(items.filter((item) => item.id !== id))
    }
  }

  const updateItem = (id: string, field: string, value: unknown) => {
    setItems(
      items.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      )
    )
  }

  const handleProductSelect = (itemId: string, productId: string) => {
    const product = products.find((p) => p.id === productId)
    if (product) {
      setItems(
        items.map((item) =>
          item.id === itemId
            ? {
                ...item,
                productId: product.id,
                description: product.name,
                listPrice: Number(product.costPrice) || item.listPrice,
              }
            : item
        )
      )
    }
  }

  const calculateItemSubtotal = (item: InvoiceItem) => {
    const subtotal = item.quantity * item.listPrice
    const afterBonif = subtotal * (1 - item.bonificacion / 100)
    const afterDiscount = afterBonif * (1 - generalDiscount / 100)
    return afterDiscount
  }

  const calculateItemTax = (item: InvoiceItem) => {
    return calculateItemSubtotal(item) * (item.taxRate / 100)
  }

  const calculateItemTotal = (item: InvoiceItem) => {
    return calculateItemSubtotal(item) + calculateItemTax(item)
  }

  const calculateSubtotal = () => {
    return items.reduce((sum, item) => sum + item.quantity * item.listPrice, 0)
  }

  const calculateBonificacion = () => {
    return items.reduce((sum, item) => {
      const sub = item.quantity * item.listPrice
      return sum + sub * (item.bonificacion / 100)
    }, 0)
  }

  const calculateDiscount = () => {
    return (calculateSubtotal() - calculateBonificacion()) * (generalDiscount / 100)
  }

  const calculateNetAmount = () => {
    return calculateSubtotal() - calculateBonificacion() - calculateDiscount()
  }

  const calculateTaxAmount = () => {
    return items.reduce((sum, item) => sum + calculateItemTax(item), 0)
  }

  const calculatePerceptionsTotal = () => {
    return percepcionIIBB + percepcionIva + otrosImpuestos
  }

  const calculateTotal = () => {
    return calculateNetAmount() + calculateTaxAmount() + calculatePerceptionsTotal()
  }

  // ============ SUBMIT ============

  const handleSubmit = async () => {
    if (!supplierId) {
      toast.error('Debe seleccionar un proveedor')
      return
    }
    if (!pointOfSale || !invoiceNumberSuffix) {
      toast.error('Debe ingresar el número de factura completo')
      return
    }
    if (items.length === 0 || items.every((item) => item.quantity === 0)) {
      toast.error('Debe agregar al menos un item con cantidad')
      return
    }

    try {
      setLoading(true)

      const perceptions = []
      if (percepcionIIBB > 0) {
        perceptions.push({
          jurisdiction: 'CABA',
          perceptionType: 'IIBB',
          rate: 0,
          baseAmount: calculateNetAmount(),
          amount: percepcionIIBB,
        })
      }
      if (percepcionIva > 0) {
        perceptions.push({
          jurisdiction: 'NACIONAL',
          perceptionType: 'IVA',
          rate: 0,
          baseAmount: calculateNetAmount(),
          amount: percepcionIva,
        })
      }

      const response = await fetch('/api/purchase-invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierId,
          voucherType,
          invoiceType,
          invoiceDate,
          dueDate,
          pointOfSale: pointOfSale.padStart(5, '0'),
          invoiceNumberSuffix: invoiceNumberSuffix.padStart(8, '0'),
          cae: cae || undefined,
          caeExpirationDate: caeExpiration || undefined,
          paymentTerms,
          generalDiscount,
          currency,
          exchangeRate,
          description,
          internalNotes,
          items: items
            .filter((item) => item.quantity > 0)
            .map((item) => ({
              productId: item.productId,
              supplierProductCode: item.supplierProductCode,
              description: item.description,
              unit: item.unit,
              quantity: item.quantity,
              listPrice: item.listPrice * (1 - item.bonificacion / 100),
              taxRate: item.taxRate,
            })),
          perceptions: perceptions.length > 0 ? perceptions : undefined,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error al crear factura')
      }

      const invoice = await response.json()
      toast.success('Factura de compra creada correctamente')
      router.push(`/proveedores/facturas-compra/${invoice.id}`)
    } catch (error) {
      console.error('Error:', error)
      toast.error(error instanceof Error ? error.message : 'Error al crear factura')
    } finally {
      setLoading(false)
    }
  }

  // ============ FORMAT HELPERS ============

  const fmt = (n: number) =>
    n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // ============ RENDER ============

  // --- STEP 1: UPLOAD ---
  if (step === 'upload') {
    return (
      <div className="container mx-auto px-6 py-8 max-w-4xl">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/proveedores/facturas-compra">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Nueva Factura de Compra</h1>
            <p className="text-sm text-gray-600 mt-1">
              Subí una factura y la IA extrae los datos automáticamente
            </p>
          </div>
        </div>

        {/* Upload Card */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-amber-500" />
              Carga con IA (OCR)
            </CardTitle>
            <CardDescription>
              Subí un PDF o imagen de la factura. Claude analizará el documento y
              completará el formulario automáticamente. Después podés revisar y corregir
              antes de guardar.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {ocrProcessing ? (
              <div className="flex flex-col items-center justify-center py-16 space-y-4">
                <div className="relative">
                  <Loader2 className="h-12 w-12 animate-spin text-blue-600" />
                  <Sparkles className="h-5 w-5 text-amber-500 absolute -top-1 -right-1" />
                </div>
                <div className="text-center">
                  <p className="text-lg font-semibold text-gray-900">Procesando con IA...</p>
                  <p className="text-sm text-gray-500 mt-1">
                    Claude está analizando la factura y extrayendo los datos
                  </p>
                </div>
                {uploadedFile && (
                  <Badge variant="secondary" className="mt-2">
                    <FileText className="h-3 w-3 mr-1" />
                    {uploadedFile.name}
                  </Badge>
                )}
              </div>
            ) : (
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-300 rounded-lg p-16 text-center cursor-pointer
                           hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
              >
                <Upload className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-lg font-medium text-gray-700">
                  Arrastrá o hacé click para subir la factura
                </p>
                <p className="text-sm text-gray-500 mt-2">
                  Formatos: PDF, JPG, PNG (máx 10MB)
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleFileSelect(file)
                  }}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Manual entry option */}
        <div className="text-center">
          <p className="text-sm text-gray-500 mb-2">¿Preferís cargar manualmente?</p>
          <Button variant="outline" onClick={() => setStep('form')}>
            <FileText className="h-4 w-4 mr-2" />
            Carga manual sin IA
          </Button>
        </div>
      </div>
    )
  }

  // --- STEP 2: FORM (with optional file preview) ---
  return (
    <div className="container mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => {
            if (ocrUsed) {
              setStep('upload')
              setOcrUsed(false)
              setUploadedFile(null)
              setFilePreviewUrl(null)
            } else {
              router.back()
            }
          }}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Nueva Factura de Compra</h1>
            <div className="flex items-center gap-2 mt-1">
              {ocrUsed && (
                <Badge className="bg-amber-100 text-amber-800 border-amber-300">
                  <Sparkles className="h-3 w-3 mr-1" />
                  Datos extraídos por IA — Revisá antes de guardar
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.back()}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            <Save className="h-4 w-4 mr-2" />
            Guardar Factura
          </Button>
        </div>
      </div>

      <div className={`grid gap-6 ${filePreviewUrl ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
        {/* File Preview Column */}
        {filePreviewUrl && (
          <div className="order-2 lg:order-1">
            <Card className="sticky top-4">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Eye className="h-4 w-4" />
                    Documento original
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setFilePreviewUrl(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-2">
                {uploadedFile?.type === 'application/pdf' ? (
                  <iframe
                    src={filePreviewUrl}
                    className="w-full rounded border"
                    style={{ height: 'calc(100vh - 200px)', minHeight: '600px' }}
                    title="Vista previa factura"
                  />
                ) : (
                  <img
                    src={filePreviewUrl}
                    alt="Factura"
                    className="w-full rounded border object-contain max-h-[80vh]"
                  />
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Form Column */}
        <div className={`space-y-6 ${filePreviewUrl ? 'order-1 lg:order-2' : ''}`}>
          {/* OCR Info Banner */}
          {ocrUsed && !supplierId && supplierInfo.cuit && (
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="py-3 px-4">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium text-amber-800">
                      Proveedor no encontrado: {supplierInfo.razonSocial} (CUIT: {supplierInfo.cuit})
                    </p>
                    <p className="text-amber-700 mt-1">
                      Seleccioná el proveedor manualmente del listado.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {ocrUsed && supplierId && (
            <Card className="border-green-200 bg-green-50">
              <CardContent className="py-3 px-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                  <p className="text-sm font-medium text-green-800">
                    Proveedor identificado por CUIT: {supplierInfo.razonSocial}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Proveedor */}
          <Card>
            <CardHeader>
              <CardTitle>Proveedor</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <Label htmlFor="supplier">Proveedor *</Label>
                  <Select value={supplierId} onValueChange={setSupplierId}>
                    <SelectTrigger id="supplier">
                      <SelectValue placeholder="Seleccionar proveedor" />
                    </SelectTrigger>
                    <SelectContent>
                      {suppliers.map((supplier) => (
                        <SelectItem key={supplier.id} value={supplier.id}>
                          {supplier.name} {supplier.taxId && `- ${supplier.taxId}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {supplierInfo.cuit && (
                  <div className="grid grid-cols-2 gap-4 text-sm text-gray-500">
                    <div>
                      <span className="font-medium">CUIT detectado:</span> {supplierInfo.cuit}
                    </div>
                    {supplierInfo.condicionIva && (
                      <div>
                        <span className="font-medium">Cond. IVA:</span> {supplierInfo.condicionIva}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Datos de la Factura */}
          <Card>
            <CardHeader>
              <CardTitle>Datos de la Factura</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <Label htmlFor="invoiceDate">Fecha *</Label>
                  <Input
                    id="invoiceDate"
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="dueDate">Vencimiento *</Label>
                  <Input
                    id="dueDate"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="invoiceType">Tipo comprob.</Label>
                  <Select value={invoiceType} onValueChange={setInvoiceType}>
                    <SelectTrigger id="invoiceType">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FA">Fa - Factura</SelectItem>
                      <SelectItem value="NC">NC - Nota Crédito</SelectItem>
                      <SelectItem value="ND">ND - Nota Débito</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="voucherType">Tipo *</Label>
                  <Select value={voucherType} onValueChange={setVoucherType}>
                    <SelectTrigger id="voucherType">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="A">A</SelectItem>
                      <SelectItem value="B">B</SelectItem>
                      <SelectItem value="C">C</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label>Nro. factura *</Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="00031"
                      value={pointOfSale}
                      onChange={(e) => setPointOfSale(e.target.value.replace(/\D/g, ''))}
                      maxLength={5}
                      className="w-32"
                    />
                    <span className="flex items-center text-gray-500 font-mono">-</span>
                    <Input
                      placeholder="00293139"
                      value={invoiceNumberSuffix}
                      onChange={(e) => setInvoiceNumberSuffix(e.target.value.replace(/\D/g, ''))}
                      maxLength={8}
                      className="flex-1"
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="cae">CAE</Label>
                  <Input
                    id="cae"
                    value={cae}
                    onChange={(e) => setCae(e.target.value)}
                    placeholder="CAE"
                  />
                </div>
                <div>
                  <Label htmlFor="caeExpiration">Vto. CAE</Label>
                  <Input
                    id="caeExpiration"
                    type="date"
                    value={caeExpiration}
                    onChange={(e) => setCaeExpiration(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="paymentTerms">Condición Pago</Label>
                  <Input
                    id="paymentTerms"
                    value={paymentTerms}
                    onChange={(e) => setPaymentTerms(e.target.value)}
                    placeholder="Ej: 30 días"
                  />
                </div>
                <div>
                  <Label htmlFor="generalDiscount">Desc. General %</Label>
                  <Input
                    id="generalDiscount"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={generalDiscount}
                    onChange={(e) => setGeneralDiscount(Number(e.target.value))}
                  />
                </div>
                <div>
                  <Label htmlFor="currency">Moneda *</Label>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger id="currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ARS">ARS</SelectItem>
                      <SelectItem value="USD">USD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="exchangeRate">TC</Label>
                  <Input
                    id="exchangeRate"
                    type="number"
                    min="0"
                    step="0.01"
                    value={exchangeRate}
                    onChange={(e) => setExchangeRate(Number(e.target.value))}
                    disabled={currency === 'ARS'}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Items */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Items</CardTitle>
              <Button onClick={addItem} size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Agregar Item
              </Button>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50">
                      <TableHead className="w-40">Producto</TableHead>
                      <TableHead className="w-24">Cód.Prov</TableHead>
                      <TableHead>Descripción</TableHead>
                      <TableHead className="w-20">Cant</TableHead>
                      <TableHead className="w-28">P.Unit</TableHead>
                      <TableHead className="w-20">Bonif%</TableHead>
                      <TableHead className="w-20">IVA%</TableHead>
                      <TableHead className="w-28 text-right">Subtotal</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <Select
                            value={item.productId || 'none'}
                            onValueChange={(value) => {
                              if (value !== 'none') handleProductSelect(item.id, value)
                            }}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="—" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">— Sin vincular</SelectItem>
                              {products.map((product) => (
                                <SelectItem key={product.id} value={product.id}>
                                  {product.sku} - {product.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            className="h-8 text-xs"
                            value={item.supplierProductCode}
                            onChange={(e) => updateItem(item.id, 'supplierProductCode', e.target.value)}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            className="h-8 text-xs"
                            value={item.description}
                            onChange={(e) => updateItem(item.id, 'description', e.target.value)}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            className="h-8 text-xs text-right"
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.quantity || ''}
                            onChange={(e) => updateItem(item.id, 'quantity', Number(e.target.value))}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            className="h-8 text-xs text-right"
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.listPrice || ''}
                            onChange={(e) => updateItem(item.id, 'listPrice', Number(e.target.value))}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            className="h-8 text-xs text-right"
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            value={item.bonificacion || ''}
                            onChange={(e) => updateItem(item.id, 'bonificacion', Number(e.target.value))}
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={item.taxRate.toString()}
                            onValueChange={(value) => updateItem(item.id, 'taxRate', Number(value))}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">0%</SelectItem>
                              <SelectItem value="10.5">10.5%</SelectItem>
                              <SelectItem value="21">21%</SelectItem>
                              <SelectItem value="27">27%</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          ${fmt(calculateItemSubtotal(item))}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" onClick={() => removeItem(item.id)}>
                            <Trash2 className="h-3 w-3 text-red-600" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Percepciones */}
              <div className="mt-4 grid grid-cols-3 gap-4">
                <div>
                  <Label className="text-xs">Percepción IIBB</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={percepcionIIBB || ''}
                    onChange={(e) => setPercepcionIIBB(Number(e.target.value))}
                    className="h-8 text-sm"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <Label className="text-xs">Percepción IVA</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={percepcionIva || ''}
                    onChange={(e) => setPercepcionIva(Number(e.target.value))}
                    className="h-8 text-sm"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <Label className="text-xs">Otros Impuestos</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={otrosImpuestos || ''}
                    onChange={(e) => setOtrosImpuestos(Number(e.target.value))}
                    className="h-8 text-sm"
                    placeholder="0.00"
                  />
                </div>
              </div>

              {/* Totales */}
              <div className="mt-6 space-y-2 max-w-md ml-auto">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Subtotal bruto:</span>
                  <span className="font-mono font-semibold">${fmt(calculateSubtotal())}</span>
                </div>
                {calculateBonificacion() > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Bonificación items:</span>
                    <span className="font-mono text-red-600">-${fmt(calculateBonificacion())}</span>
                  </div>
                )}
                {generalDiscount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Desc. general {generalDiscount}%:</span>
                    <span className="font-mono text-red-600">-${fmt(calculateDiscount())}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm border-t pt-1">
                  <span className="text-gray-600 font-medium">Neto gravado:</span>
                  <span className="font-mono font-semibold">${fmt(calculateNetAmount())}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">IVA:</span>
                  <span className="font-mono font-semibold">${fmt(calculateTaxAmount())}</span>
                </div>
                {calculatePerceptionsTotal() > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Percepciones:</span>
                    <span className="font-mono font-semibold">${fmt(calculatePerceptionsTotal())}</span>
                  </div>
                )}
                <div className="flex justify-between text-lg pt-2 border-t">
                  <span className="font-bold">TOTAL:</span>
                  <span className="font-mono font-bold text-blue-600">
                    ${fmt(calculateTotal())}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Notas */}
          <Card>
            <CardHeader>
              <CardTitle>Notas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="description">Descripción</Label>
                <Input
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Descripción de la factura"
                />
              </div>
              <div>
                <Label htmlFor="internalNotes">Notas internas</Label>
                <Textarea
                  id="internalNotes"
                  value={internalNotes}
                  onChange={(e) => setInternalNotes(e.target.value)}
                  placeholder="Notas internas (no visibles en reportes)"
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>

          {/* Bottom Save Button */}
          <div className="flex justify-end gap-2 pb-8">
            <Button variant="outline" onClick={() => router.back()}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={loading} size="lg">
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <Save className="h-4 w-4 mr-2" />
              Guardar Factura
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
