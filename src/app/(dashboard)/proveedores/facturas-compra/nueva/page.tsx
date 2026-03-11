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
  Send,
} from 'lucide-react'
import { toast } from 'sonner'

// ============ PAYMENT TERM NORMALIZATION ============

const VALID_PAYMENT_DAYS = [7, 15, 30, 45, 60, 90, 120, 150, 180]

/**
 * Normaliza el texto de condición de pago del OCR al formato de Colppy.
 * Ej: "CUENTA CORRIENTE 30 DIAS" → "a 30 Dias"
 *     "Contado" → "Contado"
 */
function normalizePaymentTerm(raw: string): string {
  if (!raw) return ''
  const lower = raw.toLowerCase()

  if (lower.includes('contado') || lower.includes('efectivo')) return 'Contado'

  // Buscar número de días
  const match = lower.match(/(\d+)\s*d[ií]as?/)
  if (match) {
    const dias = parseInt(match[1])
    const closest = VALID_PAYMENT_DAYS.reduce((prev, curr) =>
      Math.abs(curr - dias) < Math.abs(prev - dias) ? curr : prev
    )
    return `a ${closest} Dias`
  }

  // Si tiene solo un número
  const numMatch = lower.match(/\b(\d+)\b/)
  if (numMatch) {
    const dias = parseInt(numMatch[1])
    if (dias >= 7 && dias <= 180) {
      const closest = VALID_PAYMENT_DAYS.reduce((prev, curr) =>
        Math.abs(curr - dias) < Math.abs(prev - dias) ? curr : prev
      )
      return `a ${closest} Dias`
    }
  }

  // Si dice "cuenta corriente" sin número, asumir 30 días
  if (lower.includes('cuenta corriente') || lower.includes('cta cte')) return 'a 30 Dias'

  return ''
}

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

interface OcrPercepcion {
  descripcion: string
  porcentaje: number | null
  monto: number
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
    tipoComprobante?: string // legacy support
    puntoVenta: string
    numero: string
    fecha: string
    fechaVencimiento: string | null
    cae: string | null
    vencimientoCae: string | null
    condicionPago: string | null
    moneda: string
    tipoCambio: number | null
    descuentoGeneral?: number
    totalUsd?: number | null
  }
  items: Array<{
    codigo: string | null
    descripcion: string
    unidad?: string
    cantidad: number
    precioUnitario: number
    descuento?: number
    bonificacion?: number // legacy support
    importe?: number
    subtotal?: number // legacy support
    alicuotaIva: number
  }>
  totales: {
    // New format
    subtotalBruto?: number
    descuentoGeneral?: number
    subtotalNeto?: number
    percepciones?: OcrPercepcion[]
    totalPercepciones?: number
    // Legacy format support
    subtotal?: number
    netoNoGravado?: number
    exento?: number
    iva21: number
    iva105: number
    iva27: number
    percepcionIIBB?: number
    percepcionIva?: number
    impuestosInternos?: number
    otrosImpuestos?: number
    descuento?: number
    total: number
  }
}

// ============ PRODUCT SEARCH CELL ============

function ProductSearchCell({
  itemId,
  productId,
  linkedProduct,
  onSelect,
  onClear,
}: {
  itemId: string
  productId: string | null
  linkedProduct: { sku: string; name: string } | undefined
  onSelect: (product: Product) => void
  onClear: () => void
}) {
  const [searchTerm, setSearchTerm] = useState('')
  const [results, setResults] = useState<Product[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Debounced search
  useEffect(() => {
    if (searchTerm.length >= 2) {
      const timeout = setTimeout(async () => {
        setLoading(true)
        try {
          const params = new URLSearchParams({ search: searchTerm, limit: '20', status: 'ACTIVE' })
          const res = await fetch(`/api/productos?${params}`)
          if (res.ok) {
            const data = await res.json()
            setResults(data.products || [])
          }
        } catch (err) {
          console.error('Product search error:', err)
        } finally {
          setLoading(false)
        }
      }, 300)
      return () => clearTimeout(timeout)
    } else {
      setResults([])
    }
  }, [searchTerm])

  // Click outside to close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (productId && linkedProduct) {
    return (
      <div className="flex items-center gap-1 min-w-0">
        <span
          className="text-xs truncate flex-1 font-mono text-green-700 bg-green-50 px-1.5 py-1 rounded"
          title={`${linkedProduct.sku} - ${linkedProduct.name}`}
        >
          {linkedProduct.sku}
        </span>
        <button
          type="button"
          onClick={onClear}
          className="flex-shrink-0 text-gray-400 hover:text-red-500 p-0.5"
          title="Desvincular producto"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative">
      <Input
        className="h-8 text-xs"
        placeholder="Buscar SKU/nombre..."
        value={searchTerm}
        onChange={(e) => { setSearchTerm(e.target.value); setOpen(true) }}
        onFocus={() => { if (searchTerm.length >= 2) setOpen(true) }}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false) }}
      />
      {open && (results.length > 0 || loading) && (
        <div className="absolute z-50 top-full left-0 w-72 mt-1 bg-white border rounded-md shadow-lg max-h-52 overflow-y-auto">
          {loading && results.length === 0 && (
            <div className="px-3 py-2 text-xs text-gray-500 flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Buscando...
            </div>
          )}
          {results.map(p => (
            <button
              key={p.id}
              type="button"
              className="w-full text-left px-2 py-1.5 text-xs hover:bg-blue-50 border-b last:border-0 flex gap-1"
              onClick={() => {
                onSelect(p)
                setSearchTerm('')
                setOpen(false)
                setResults([])
              }}
            >
              <span className="font-mono font-semibold text-blue-700 whitespace-nowrap">{p.sku}</span>
              <span className="text-gray-600 truncate">{p.name}</span>
            </button>
          ))}
          {!loading && results.length === 0 && searchTerm.length >= 2 && (
            <div className="px-3 py-2 text-xs text-gray-400">Sin resultados</div>
          )}
        </div>
      )}
    </div>
  )
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
  const [linkedProducts, setLinkedProducts] = useState<Record<string, { sku: string; name: string }>>({})

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
      id: 'default-1',
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

  // Percepciones (array dinámico)
  interface PercepcionItem {
    id: string
    descripcion: string
    porcentaje: number | null
    monto: number
  }
  const [percepciones, setPercepciones] = useState<PercepcionItem[]>([])

  // Legacy fields - still used for manual entry compatibility
  const [percepcionIIBB, setPercepcionIIBB] = useState(0)
  const [percepcionIva, setPercepcionIva] = useState(0)
  const [otrosImpuestos, setOtrosImpuestos] = useState(0)

  // Total USD
  const [totalUsd, setTotalUsd] = useState<number | null>(null)

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

  useEffect(() => {
    fetchSuppliers()
  }, [fetchSuppliers])

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

  // ============ PRODUCT AUTO-LINK ============

  /**
   * Genera variantes de SKU quitando progresivamente ceros iniciales de la primera parte.
   * Ej: "0012416 04" → ["2416 04", "12416 04", "012416 04", "0012416 04"]
   */
  const generateSkuVariants = (supplierCode: string): string[] => {
    const code = supplierCode.trim()
    if (!code) return []

    const parts = code.split(/\s+/)
    const variants: string[] = []
    const seen = new Set<string>()

    const addVariant = (v: string) => {
      if (!seen.has(v)) { seen.add(v); variants.push(v) }
    }

    // Strip all leading zeros from first part (most aggressive)
    const firstPartStripped = parts[0].replace(/^0+/, '') || parts[0]
    const rest = parts.slice(1)
    addVariant([firstPartStripped, ...rest].join(' '))

    // Progressively add back leading zeros
    let current = firstPartStripped
    for (let i = 1; i <= parts[0].length - firstPartStripped.length; i++) {
      current = '0' + current
      addVariant([current, ...rest].join(' '))
    }

    // Original code (if not already added)
    addVariant(code)

    return variants
  }

  /**
   * Después del OCR, intenta vincular automáticamente cada item con un producto
   * del ERP buscando por SKU con normalización de ceros iniciales.
   */
  const autoLinkProducts = async (ocrItems: InvoiceItem[]) => {
    const itemsWithCode = ocrItems.filter(item => item.supplierProductCode.trim())
    if (itemsWithCode.length === 0) return

    const newLinked: Record<string, { sku: string; name: string }> = {}
    const updates: Record<string, string> = {} // itemId → productId

    await Promise.all(itemsWithCode.map(async (item) => {
      const variants = generateSkuVariants(item.supplierProductCode)
      if (variants.length === 0) return

      // Buscar con la variante más corta (sin ceros) para máximo alcance
      const searchTerm = variants[0]
      try {
        const params = new URLSearchParams({ search: searchTerm, limit: '20', status: 'ACTIVE' })
        const res = await fetch(`/api/productos?${params}`)
        if (!res.ok) return
        const data = await res.json()
        const prods: Product[] = data.products || []

        // Buscar match exacto de SKU contra cualquier variante
        const variantsLower = variants.map(v => v.toLowerCase())
        const match = prods.find(p => variantsLower.includes(p.sku.toLowerCase().trim()))

        if (match) {
          updates[item.id] = match.id
          newLinked[item.id] = { sku: match.sku, name: match.name }
        }
      } catch (err) {
        console.error('Auto-link error for code:', item.supplierProductCode, err)
      }
    }))

    const matchCount = Object.keys(updates).length
    if (matchCount > 0) {
      setItems(prev => prev.map(item => {
        const productId = updates[item.id]
        return productId ? { ...item, productId } : item
      }))
      setLinkedProducts(prev => ({ ...prev, ...newLinked }))
      toast.success(`${matchCount} producto(s) vinculados automáticamente`)
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
        if (result.debug?.truncated) {
          toast.warning('⚠️ La respuesta de IA fue truncada. Algunos items pueden faltar.')
        }
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

      // Parse tipo: new format "FC A" → voucherType="A", invoiceType="FA"
      // Also handles "ND A", "NC A", etc.
      if (f.tipo) {
        const tipoStr = f.tipo.toUpperCase().trim()
        // New format: "FC A", "FC B", "ND A", "NC A", etc.
        const match = tipoStr.match(/^(FC|ND|NC|FA)\s*([ABC])$/)
        if (match) {
          const compType = match[1] === 'FC' ? 'FA' : match[1]
          setInvoiceType(compType)
          setVoucherType(match[2])
        } else if (['A', 'B', 'C'].includes(tipoStr)) {
          // Legacy format: just the letter
          setVoucherType(tipoStr)
        } else {
          setVoucherType(tipoStr)
        }
      }
      if (f.tipoComprobante) setInvoiceType(f.tipoComprobante)
      if (f.puntoVenta) setPointOfSale(f.puntoVenta)
      if (f.numero) setInvoiceNumberSuffix(f.numero)
      if (f.fecha) setInvoiceDate(f.fecha)
      if (f.fechaVencimiento) setDueDate(f.fechaVencimiento)
      if (f.cae) setCae(f.cae)
      if (f.vencimientoCae) setCaeExpiration(f.vencimientoCae)
      if (f.condicionPago) setPaymentTerms(normalizePaymentTerm(f.condicionPago))
      if (f.moneda) setCurrency(f.moneda)
      if (f.tipoCambio) setExchangeRate(f.tipoCambio)

      // Descuento general from factura (new format)
      if (f.descuentoGeneral && f.descuentoGeneral > 0) {
        setGeneralDiscount(f.descuentoGeneral)
      }

      // Total USD
      if (f.totalUsd) {
        setTotalUsd(f.totalUsd)
      }
    }

    // Items
    if (data.items && data.items.length > 0) {
      const mappedItems = data.items.map((item, idx) => ({
        id: `ocr-${idx}-${Date.now()}`,
        productId: null,
        supplierProductCode: item.codigo || '',
        description: item.descripcion || '',
        unit: item.unidad || 'UN',
        quantity: Number(item.cantidad) || 0,
        listPrice: Number(item.precioUnitario) || 0,
        bonificacion: Number(item.descuento) || Number(item.bonificacion) || 0,
        taxRate: Number(item.alicuotaIva) || 21,
      }))
      setItems(mappedItems)
      // Auto-vincular productos por código de proveedor
      autoLinkProducts(mappedItems)
    }

    // Totals - percepciones
    if (data.totales) {
      // New format: percepciones as array
      if (data.totales.percepciones && Array.isArray(data.totales.percepciones) && data.totales.percepciones.length > 0) {
        const percItems = data.totales.percepciones.map((p, idx) => ({
          id: String(idx + 1),
          descripcion: p.descripcion || `Percepción ${idx + 1}`,
          porcentaje: p.porcentaje ? Number(p.porcentaje) : null,
          monto: Number(p.monto) || 0,
        }))
        setPercepciones(percItems)

        // Also set legacy fields for calculation compatibility
        const totalPerc = percItems.reduce((sum, p) => sum + p.monto, 0)
        // Split between IIBB and others heuristically
        const iibbPerc = percItems.filter((p) =>
          /iibb|ingresos brutos|agip|arba|buenos aires|jujuy|salta|córdoba|mendoza|santa fe/i.test(p.descripcion)
        )
        const ivaPerc = percItems.filter((p) => /iva|percep.*iva/i.test(p.descripcion) && !/iibb/i.test(p.descripcion))
        const otherPerc = percItems.filter(
          (p) =>
            !iibbPerc.includes(p) && !ivaPerc.includes(p)
        )
        setPercepcionIIBB(iibbPerc.reduce((s, p) => s + p.monto, 0))
        setPercepcionIva(ivaPerc.reduce((s, p) => s + p.monto, 0))
        setOtrosImpuestos(otherPerc.reduce((s, p) => s + p.monto, 0))
      } else {
        // Legacy format: flat fields
        setPercepcionIIBB(Number(data.totales.percepcionIIBB) || 0)
        setPercepcionIva(Number(data.totales.percepcionIva) || 0)
        setOtrosImpuestos(
          (Number(data.totales.impuestosInternos) || 0) + (Number(data.totales.otrosImpuestos) || 0)
        )
      }

      // Descuento general fallback from totales
      if (!data.factura?.descuentoGeneral && data.totales.descuentoGeneral && data.totales.subtotalBruto) {
        const discPct = (data.totales.descuentoGeneral / data.totales.subtotalBruto) * 100
        setGeneralDiscount(Math.round(discPct * 100) / 100)
      } else if (!data.factura?.descuentoGeneral && data.totales.descuento && data.totales.subtotal) {
        // Legacy fallback
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
        id: `manual-${Date.now()}`,
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

  const handleProductLink = (itemId: string, product: Product) => {
    setItems(
      items.map((item) =>
        item.id === itemId
          ? { ...item, productId: product.id }
          : item
      )
    )
    setLinkedProducts(prev => ({ ...prev, [itemId]: { sku: product.sku, name: product.name } }))
  }

  const handleProductClear = (itemId: string) => {
    setItems(
      items.map((item) =>
        item.id === itemId
          ? { ...item, productId: null }
          : item
      )
    )
    setLinkedProducts(prev => {
      const next = { ...prev }
      delete next[itemId]
      return next
    })
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
    if (percepciones.length > 0) {
      return percepciones.reduce((sum, p) => sum + p.monto, 0)
    }
    return percepcionIIBB + percepcionIva + otrosImpuestos
  }

  const calculateTotal = () => {
    return calculateNetAmount() + calculateTaxAmount() + calculatePerceptionsTotal()
  }

  // ============ SUBMIT ============

  const [sendingToColppy, setSendingToColppy] = useState(false)

  const handleSubmit = async (sendToColppy = false) => {
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
      if (sendToColppy) setSendingToColppy(true)

      const perceptions: Array<{
        jurisdiction: string
        perceptionType: string
        rate: number
        baseAmount: number
        amount: number
        description?: string
      }> = []

      if (percepciones.length > 0) {
        // Use individual percepciones from OCR
        for (const perc of percepciones) {
          if (perc.monto > 0) {
            // Detect jurisdiction from description
            let jurisdiction = 'NACIONAL'
            let perceptionType = 'IIBB'
            const desc = (perc.descripcion || '').toUpperCase()
            if (/AGIP|CABA|C\.A\.B\.A/i.test(desc)) jurisdiction = 'CABA'
            else if (/ARBA|BUENOS AIRES|BS\.?AS|PBA/i.test(desc)) jurisdiction = 'ARBA'
            else if (/JUJUY/i.test(desc)) jurisdiction = 'JUJUY'
            else if (/SALTA/i.test(desc)) jurisdiction = 'SALTA'
            else if (/CÓRDOBA|CORDOBA/i.test(desc)) jurisdiction = 'CORDOBA'
            else if (/MENDOZA/i.test(desc)) jurisdiction = 'MENDOZA'
            else if (/SANTA FE/i.test(desc)) jurisdiction = 'SANTA FE'

            if (/IVA/i.test(desc) && !/IIBB/i.test(desc)) {
              perceptionType = 'IVA'
              jurisdiction = 'NACIONAL'
            }

            perceptions.push({
              jurisdiction,
              perceptionType,
              rate: perc.porcentaje || 0,
              baseAmount: calculateNetAmount(),
              amount: perc.monto,
              description: perc.descripcion,
            })
          }
        }
      } else {
        // Legacy manual entry
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
        if (otrosImpuestos > 0) {
          perceptions.push({
            jurisdiction: 'NACIONAL',
            perceptionType: 'OTROS',
            rate: 0,
            baseAmount: calculateNetAmount(),
            amount: otrosImpuestos,
          })
        }
      }

      // 1. Guardar la factura en el ERP
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

      // 2. Si pidió enviar a Colppy, hacerlo ahora
      if (sendToColppy) {
        try {
          const colppyResponse = await fetch(`/api/purchase-invoices/${invoice.id}/send-to-colppy`, {
            method: 'POST',
          })
          const colppyData = await colppyResponse.json()

          if (colppyResponse.ok) {
            toast.success(colppyData.message || 'Factura enviada a Colppy')
          } else {
            toast.error(`Factura guardada, pero falló Colppy: ${colppyData.error}`)
          }
        } catch (colppyError: any) {
          toast.error(`Factura guardada, pero error al enviar a Colppy: ${colppyError.message}`)
        }
      }

      router.push(`/proveedores/facturas-compra/${invoice.id}`)
    } catch (error) {
      console.error('Error:', error)
      toast.error(error instanceof Error ? error.message : 'Error al crear factura')
    } finally {
      setLoading(false)
      setSendingToColppy(false)
    }
  }

  // ============ FORMAT HELPERS ============

  const fmt = (n: number) =>
    n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // Helper para inputs numéricos como text
  // Soporta formato argentino: 38.289,75 (punto=miles, coma=decimal) y también 38289.75
  const parseNumericInput = (val: string): number => {
    if (!val) return 0
    // Si tiene coma, asumir formato AR: quitar puntos de miles, coma→punto decimal
    if (val.includes(',')) {
      const cleaned = val.replace(/[^0-9.,]/g, '').replace(/\./g, '').replace(',', '.')
      return Number(cleaned) || 0
    }
    // Formato estándar: solo números y punto decimal
    const cleaned = val.replace(/[^0-9.]/g, '')
    return Number(cleaned) || 0
  }
  // Formato simple para Cant y Bonif% (sin separadores de miles)
  const fmtInput = (n: number): string => (n > 0 ? String(n) : '')
  // Formato argentino para P.Unit y montos (con separadores de miles y 2 decimales)
  const fmtInputAR = (n: number): string =>
    n > 0 ? n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''

  // Track qué input tiene foco para no formatear mientras se edita
  const [editingField, setEditingField] = useState<string | null>(null)

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
          <Button onClick={() => handleSubmit(false)} disabled={loading || sendingToColppy}>
            {loading && !sendingToColppy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            <Save className="h-4 w-4 mr-2" />
            Guardar
          </Button>
          <Button
            onClick={() => handleSubmit(true)}
            disabled={loading || sendingToColppy}
            className="bg-purple-600 hover:bg-purple-700"
          >
            {sendingToColppy ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Guardar y Enviar a Colppy
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
                  <Select value={paymentTerms || undefined} onValueChange={setPaymentTerms}>
                    <SelectTrigger id="paymentTerms">
                      <SelectValue placeholder="Seleccionar" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Contado">Contado</SelectItem>
                      <SelectItem value="a 7 Dias">7 Días</SelectItem>
                      <SelectItem value="a 15 Dias">15 Días</SelectItem>
                      <SelectItem value="a 30 Dias">30 Días</SelectItem>
                      <SelectItem value="a 45 Dias">45 Días</SelectItem>
                      <SelectItem value="a 60 Dias">60 Días</SelectItem>
                      <SelectItem value="a 90 Dias">90 Días</SelectItem>
                      <SelectItem value="a 120 Dias">120 Días</SelectItem>
                      <SelectItem value="a 150 Dias">150 Días</SelectItem>
                      <SelectItem value="a 180 Dias">180 Días</SelectItem>
                    </SelectContent>
                  </Select>
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
                <Table className="min-w-[960px]">
                  <TableHeader>
                    <TableRow className="bg-gray-50">
                      <TableHead className="w-52">Producto</TableHead>
                      <TableHead className="w-24">Cód.Prov</TableHead>
                      <TableHead className="min-w-[180px]">Descripción</TableHead>
                      <TableHead className="w-[75px] text-right">Cant</TableHead>
                      <TableHead className="w-[130px] text-right">P.Unit</TableHead>
                      <TableHead className="w-[75px] text-right">Bonif%</TableHead>
                      <TableHead className="w-20">IVA%</TableHead>
                      <TableHead className="w-[140px] text-right">Subtotal</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="w-52">
                          <ProductSearchCell
                            itemId={item.id}
                            productId={item.productId}
                            linkedProduct={linkedProducts[item.id]}
                            onSelect={(product) => handleProductLink(item.id, product)}
                            onClear={() => handleProductClear(item.id)}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            className="h-8 text-xs"
                            value={item.supplierProductCode}
                            onChange={(e) => updateItem(item.id, 'supplierProductCode', e.target.value)}
                          />
                        </TableCell>
                        <TableCell className="min-w-[180px]">
                          <Input
                            className="h-8 text-xs truncate"
                            title={item.description}
                            value={item.description}
                            onChange={(e) => updateItem(item.id, 'description', e.target.value)}
                          />
                        </TableCell>
                        <TableCell className="w-[75px]">
                          <Input
                            className="h-8 text-xs text-right font-mono w-full"
                            inputMode="decimal"
                            value={fmtInput(item.quantity)}
                            placeholder="0"
                            onChange={(e) => updateItem(item.id, 'quantity', parseNumericInput(e.target.value))}
                          />
                        </TableCell>
                        <TableCell className="w-[130px]">
                          <Input
                            className="h-8 text-xs text-right font-mono w-full"
                            inputMode="decimal"
                            value={editingField === `price-${item.id}` ? fmtInput(item.listPrice) : fmtInputAR(item.listPrice)}
                            placeholder="0,00"
                            onFocus={() => setEditingField(`price-${item.id}`)}
                            onBlur={() => setEditingField(null)}
                            onChange={(e) => updateItem(item.id, 'listPrice', parseNumericInput(e.target.value))}
                          />
                        </TableCell>
                        <TableCell className="w-[75px]">
                          <Input
                            className="h-8 text-xs text-right font-mono w-full"
                            inputMode="decimal"
                            value={fmtInput(item.bonificacion)}
                            placeholder="0"
                            onChange={(e) => updateItem(item.id, 'bonificacion', parseNumericInput(e.target.value))}
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
                        <TableCell className="text-right font-mono text-xs w-[140px] whitespace-nowrap">
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
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-sm font-medium">Percepciones e Impuestos</Label>
                  {percepciones.length === 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setPercepciones([
                          ...percepciones,
                          { id: Date.now().toString(), descripcion: '', porcentaje: null, monto: 0 },
                        ])
                      }
                    >
                      <Plus className="h-3 w-3 mr-1" /> Agregar
                    </Button>
                  )}
                </div>

                {/* Individual percepciones from OCR */}
                {percepciones.length > 0 ? (
                  <div className="space-y-2">
                    {percepciones.map((perc) => (
                      <div key={perc.id} className="flex items-center gap-2">
                        <Input
                          value={perc.descripcion}
                          onChange={(e) =>
                            setPercepciones(
                              percepciones.map((p) =>
                                p.id === perc.id ? { ...p, descripcion: e.target.value } : p
                              )
                            )
                          }
                          className="h-8 text-sm flex-1"
                          placeholder="Descripción (ej: PERCEP. AGIP)"
                        />
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={perc.monto || ''}
                          onChange={(e) => {
                            const newMonto = Number(e.target.value)
                            setPercepciones(
                              percepciones.map((p) =>
                                p.id === perc.id ? { ...p, monto: newMonto } : p
                              )
                            )
                            // Update legacy totals
                            const updated = percepciones.map((p) =>
                              p.id === perc.id ? { ...p, monto: newMonto } : p
                            )
                            const total = updated.reduce((s, p) => s + p.monto, 0)
                            setPercepcionIIBB(total)
                            setPercepcionIva(0)
                            setOtrosImpuestos(0)
                          }}
                          className="h-8 text-sm w-36"
                          placeholder="Monto"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const updated = percepciones.filter((p) => p.id !== perc.id)
                            setPercepciones(updated)
                            const total = updated.reduce((s, p) => s + p.monto, 0)
                            setPercepcionIIBB(total)
                            setPercepcionIva(0)
                            setOtrosImpuestos(0)
                          }}
                        >
                          <Trash2 className="h-3 w-3 text-red-600" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setPercepciones([
                          ...percepciones,
                          { id: Date.now().toString(), descripcion: '', porcentaje: null, monto: 0 },
                        ])
                      }
                    >
                      <Plus className="h-3 w-3 mr-1" /> Agregar percepción
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-4">
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
                )}
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
                {percepciones.length > 0 ? (
                  percepciones.filter((p) => p.monto > 0).map((perc) => (
                    <div key={perc.id} className="flex justify-between text-sm">
                      <span className="text-gray-600 truncate max-w-[200px]" title={perc.descripcion}>
                        {perc.descripcion || 'Percepción'}:
                      </span>
                      <span className="font-mono font-semibold">${fmt(perc.monto)}</span>
                    </div>
                  ))
                ) : (
                  calculatePerceptionsTotal() > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Percepciones:</span>
                      <span className="font-mono font-semibold">${fmt(calculatePerceptionsTotal())}</span>
                    </div>
                  )
                )}
                <div className="flex justify-between text-lg pt-2 border-t">
                  <span className="font-bold">TOTAL:</span>
                  <span className="font-mono font-bold text-blue-600">
                    ${fmt(calculateTotal())}
                  </span>
                </div>
                {totalUsd && (
                  <div className="flex justify-between text-sm text-gray-500">
                    <span>Total USD:</span>
                    <span className="font-mono font-semibold text-green-700">
                      USD {totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
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

          {/* Bottom Save Buttons */}
          <div className="flex justify-end gap-2 pb-8">
            <Button variant="outline" onClick={() => router.back()}>
              Cancelar
            </Button>
            <Button onClick={() => handleSubmit(false)} disabled={loading || sendingToColppy} size="lg">
              {loading && !sendingToColppy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <Save className="h-4 w-4 mr-2" />
              Guardar
            </Button>
            <Button
              onClick={() => handleSubmit(true)}
              disabled={loading || sendingToColppy}
              size="lg"
              className="bg-purple-600 hover:bg-purple-700"
            >
              {sendingToColppy ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Guardar y Enviar a Colppy
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
