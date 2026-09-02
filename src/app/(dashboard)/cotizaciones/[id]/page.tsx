'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
// Select imports removed - additionals now use search-based selector
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  ArrowLeft,
  Save,
  Loader2,
  Plus,
  Trash2,
  Calculator,
  Package,
  X,
  Pencil,
  RefreshCw,
  Search,
  CalendarDays,
  Eye,
  AlertTriangle,
  History,
  UserRoundPen,
} from 'lucide-react'
import { toast } from 'sonner'
import { useSession } from 'next-auth/react'
import { formatNumber, getLocalDateString } from '@/lib/utils'
import { useColppyStock, refreshInventoryCache } from '@/hooks/useColppyStock'
import { StockBadge, StockWarning } from '@/components/StockBadge'
import { CertificadosDialog } from '@/components/quotes/CertificadosDialog'
import { getConjuntosGenebre, type ConjuntoOpcion, type ConjuntoTipo } from '@/lib/genebre-conjuntos'
import { getBobinasElectrovalvula, type BobinaKit, ELECTROVALVULAS_NAMUR, type NamurKit } from '@/lib/genebre-electrovalvulas'

interface Product {
  id: string
  sku: string
  name: string
  brand: string | null
  listPriceUSD: number | null
  unit: string | null
}

interface BrandDiscount {
  brand: string
  discountPercent: number
}

interface Additional {
  productId: string | null
  product?: Product | null
  description?: string | null
  listPrice: number
  position: number
}

interface QuoteItem {
  id: string
  itemNumber: number
  productId: string | null
  product: Product | null
  manualSku: string | null
  manualBrand: string | null
  description: string | null
  quantity: number
  listPrice: number
  brandDiscount: number
  customerMultiplier: number
  multiplierOverride: number | null
  unitPrice: number
  totalPrice: number
  deliveryTime: string | null
  isAlternative: boolean
  alternativeToItemId: string | null
  additionals: Additional[]
}

interface Quote {
  id: string
  quoteNumber: string
  status: string
  customerId: string
  customer: {
    id: string
    name: string
    businessName: string | null
    priceMultiplier: number
    taxCondition?: string
  }
  salesPersonId: string
  salesPerson: {
    id: string
    name: string
    email: string
  }
  date: string
  validUntil: string | null
  exchangeRate: number
  multiplier: number
  currency: string
  terms: string | null
  notes: string | null
  tenderNumber: string | null
  subtotal: number
  bonification: number
  total: number
  pricesIncludeTax: boolean
  items: QuoteItem[]
}

interface ItemFormData {
  productId: string
  quantity: number
  description: string
  deliveryTime: string
  isAlternative: boolean
  alternativeToItemId: string | null
  additionals: Array<{
    productId: string | null
    listPrice: number
    productName?: string
    productSku?: string
    isManual?: boolean
    manualDescription?: string
  }>
  // Manual item fields
  isManual: boolean
  manualSku: string
  manualBrand: string
  manualUnitPrice: string
  // Brand discount override (percentage, e.g. "40" = 40%)
  brandDiscountOverride: string
  // Multiplier override per item (e.g. "1.25")
  multiplierOverride: string
}

interface AuditLogEntry {
  id: string
  accion: string
  valorAnterior: { id: string; nombre: string; email: string } | null
  valorNuevo: { id: string; nombre: string; email: string } | null
  motivo: string | null
  createdAt: string
  usuario: { id: string; name: string; email: string }
}

interface UserOption {
  id: string
  name: string
  email: string
  role: string
}

export default function QuoteDetailPage() {
  const router = useRouter()
  const params = useParams()
  const quoteId = params.id as string
  const { data: session } = useSession()

  const [loading, setLoading] = useState(true)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [brandDiscounts, setBrandDiscounts] = useState<BrandDiscount[]>([])

  // Editable en DRAFT, SENT y REVISED — bloqueado en estados finales
  const isEditable = quote ? ['DRAFT', 'SENT', 'REVISED'].includes(quote.status) : false

  // Item form state
  const [showItemDialog, setShowItemDialog] = useState(false)
  const [showCertificados, setShowCertificados] = useState(false)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [itemFormData, setItemFormData] = useState<ItemFormData>({
    productId: '',
    quantity: 1,
    description: '',
    deliveryTime: 'Inmediato',
    isAlternative: false,
    alternativeToItemId: null,
    additionals: [],
    isManual: false,
    manualSku: '',
    manualBrand: '',
    manualUnitPrice: '',
    brandDiscountOverride: '',
    multiplierOverride: '',
  })
  const [itemFormLoading, setItemFormLoading] = useState(false)

  // Multiplier
  const [multiplierValue, setMultiplierValue] = useState('')
  const [multiplierLoading, setMultiplierLoading] = useState(false)
  const [showCustomMultiplier, setShowCustomMultiplier] = useState(false)
  const [saveToCustomer, setSaveToCustomer] = useState(false)

  // Exchange rate
  const [exchangeRateValue, setExchangeRateValue] = useState('')
  const [exchangeRateLoading, setExchangeRateLoading] = useState(false)
  const [showEditExchangeRate, setShowEditExchangeRate] = useState(false)
  const [currentTCLoading, setCurrentTCLoading] = useState(false)

  // Referencia (tenderNumber)
  const [referenceValue, setReferenceValue] = useState('')
  const [referenceLoading, setReferenceLoading] = useState(false)
  const [showEditReference, setShowEditReference] = useState(false)

  // Validity date
  const [showEditValidity, setShowEditValidity] = useState(false)
  const [validityValue, setValidityValue] = useState('')
  const [validityLoading, setValidityLoading] = useState(false)

  // Bonification
  const [bonificationValue, setBonificationValue] = useState('')
  const [bonificationLoading, setBonificationLoading] = useState(false)
  const [showEditBonification, setShowEditBonification] = useState(false)

  // IVA incluido (Factura B para CF / Monotributo / Exento)
  const [pricesIncludeTaxLoading, setPricesIncludeTaxLoading] = useState(false)
  const [showIvaConfirm, setShowIvaConfirm] = useState<null | { target: boolean }>(null)

  // Reasignar vendedor
  const [showReasignarModal, setShowReasignarModal] = useState(false)
  const [reasignarLoading, setReasignarLoading] = useState(false)
  const [vendedores, setVendedores] = useState<UserOption[]>([])
  const [nuevoVendedorId, setNuevoVendedorId] = useState('')
  const [reasignarMotivo, setReasignarMotivo] = useState('')

  // Historial de cambios
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([])
  const [auditLogsLoading, setAuditLogsLoading] = useState(false)

  // Additional product search (per-index) — legacy, kept for compatibility
  const [additionalSearchTerms, setAdditionalSearchTerms] = useState<Record<number, string>>({})
  const [additionalSearchResults, setAdditionalSearchResults] = useState<Record<number, Product[]>>({})
  const [additionalSearchLoading, setAdditionalSearchLoading] = useState<Record<number, boolean>>({})

  // Additional product search — single search input (new)
  const [addlSearchTerm, setAddlSearchTerm] = useState('')
  const [addlSearchResults, setAddlSearchResults] = useState<Product[]>([])
  const [addlSearchLoading, setAddlSearchLoading] = useState(false)

  // Manual additional mini-form state
  const [showManualAddlForm, setShowManualAddlForm] = useState(false)
  const [manualAddlDescription, setManualAddlDescription] = useState('')
  const [manualAddlPrice, setManualAddlPrice] = useState('')

  // Conjuntos armados GENEBRE (actuador + dados según tabla)
  const [conjuntoLoading, setConjuntoLoading] = useState<string | null>(null)
  // SKUs agregados por el último conjunto elegido: al elegir otro, se reemplazan
  const [lastConjuntoSkus, setLastConjuntoSkus] = useState<string[]>([])
  // Tipo del último conjunto agregado: si es neumático se ofrece la NAMUR
  const [lastConjuntoTipo, setLastConjuntoTipo] = useState<ConjuntoTipo | null>(null)

  // Electroválvula NAMUR para conjuntos neumáticos (según tensión)
  const [namurLoading, setNamurLoading] = useState<string | null>(null)
  // SKU agregado por la última NAMUR elegida: al elegir otra tensión, se reemplaza
  const [lastNamurSku, setLastNamurSku] = useState<string | null>(null)

  // Kits bobina + conector para electroválvulas GENEBRE (según tensión)
  const [bobinaKitLoading, setBobinaKitLoading] = useState<string | null>(null)
  // SKUs agregados por el último kit de bobina elegido: al elegir otra tensión, se reemplazan
  const [lastBobinaKitSkus, setLastBobinaKitSkus] = useState<string[]>([])

  // Product search
  const [productSearch, setProductSearch] = useState('')
  const [refreshingStock, setRefreshingStock] = useState(false)
  const [searchResults, setSearchResults] = useState<typeof products>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const searchAbortRef = useRef<AbortController | null>(null)
  const addlSearchAbortRef = useRef<Record<number, AbortController | null>>({})
  const addlSingleAbortRef = useRef<AbortController | null>(null)

  // Stock data hook - consultar stock de productos filtrados (main + adicionales + seleccionados)
  const filteredProductSkus = [...new Set([
    ...searchResults.map((p) => p.sku),
    ...addlSearchResults.map((p) => p.sku),
    ...(selectedProduct ? [selectedProduct.sku] : []),
    ...itemFormData.additionals.filter(a => a.productSku && !a.isManual).map(a => a.productSku!),
  ])]

  const { stockData, loading: stockLoading } = useColppyStock(
    filteredProductSkus,
    filteredProductSkus.length > 0 && showItemDialog
  )

  // Stock data para items de la cotización
  const quoteItemSkus = quote?.items?.filter((item) => item.product).map((item) => item.product!.sku) || []
  const { stockData: quoteStockData, loading: quoteStockLoading } = useColppyStock(
    quoteItemSkus,
    quoteItemSkus.length > 0
  )

  // Price preview
  const [pricePreview, setPricePreview] = useState({
    listPrice: 0,
    additionalsTotal: 0,
    subtotalWithAdditionals: 0,
    brandDiscount: 0,
    afterDiscount: 0,
    unitPrice: 0,
    totalPrice: 0,
  })

  useEffect(() => {
    fetchQuoteData({ silent: false })
    fetchBrandDiscounts()
    fetchAuditLogs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteId])

  useEffect(() => {
    calculatePricePreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemFormData.productId, itemFormData.quantity, itemFormData.additionals, itemFormData.brandDiscountOverride, itemFormData.multiplierOverride, quote?.multiplier])

  // Búsqueda de productos con debounce (300ms)
  useEffect(() => {
    if (productSearch.length >= 2) {
      const timeoutId = setTimeout(() => {
        searchProducts(productSearch)
      }, 300)
      return () => clearTimeout(timeoutId)
    } else {
      searchAbortRef.current?.abort()
      setSearchLoading(false)
      setSearchResults([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productSearch])

  // Debounce para búsqueda de adicionales (300ms por cada índice)
  useEffect(() => {
    const timeouts: NodeJS.Timeout[] = []
    for (const [indexStr, term] of Object.entries(additionalSearchTerms)) {
      const index = Number(indexStr)
      if (term.length >= 2) {
        const t = setTimeout(() => {
          searchAdditionalProducts(index, term)
        }, 300)
        timeouts.push(t)
      } else {
        setAdditionalSearchResults(prev => ({ ...prev, [index]: [] }))
      }
    }
    return () => timeouts.forEach(t => clearTimeout(t))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [additionalSearchTerms])

  // Debounce para búsqueda de adicionales — input único
  useEffect(() => {
    if (addlSearchTerm.length < 2) {
      addlSingleAbortRef.current?.abort()
      setAddlSearchLoading(false)
      setAddlSearchResults([])
      return
    }
    const timeout = setTimeout(async () => {
      // Cancelar la búsqueda anterior si sigue en vuelo (evita respuestas fuera de orden)
      addlSingleAbortRef.current?.abort()
      const controller = new AbortController()
      addlSingleAbortRef.current = controller

      setAddlSearchLoading(true)
      try {
        const params = new URLSearchParams({ search: addlSearchTerm, limit: '20', status: 'ACTIVE' })
        const response = await fetch(`/api/productos?${params.toString()}`, {
          signal: controller.signal,
        })
        if (response.ok) {
          const data = await response.json()
          setAddlSearchResults(data.products || [])
        } else {
          setAddlSearchResults([])
        }
        setAddlSearchLoading(false)
      } catch {
        if (controller.signal.aborted) return
        setAddlSearchResults([])
        setAddlSearchLoading(false)
      }
    }, 300)
    return () => clearTimeout(timeout)
  }, [addlSearchTerm])

  // silent=true: refresca datos sin desmontar la página (sin spinner de carga completa)
  const fetchQuoteData = async ({ silent = true }: { silent?: boolean } = {}) => {
    try {
      if (!silent) setLoading(true)
      const response = await fetch(`/api/quotes/${quoteId}`)
      if (!response.ok) {
        throw new Error('Error al cargar cotización')
      }
      const data = await response.json()
      setQuote(data)
      setMultiplierValue(Number(data.multiplier).toFixed(2))
      setExchangeRateValue(Number(data.exchangeRate).toFixed(2))
      setBonificationValue(Number(data.bonification || 0).toFixed(2))
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar la cotización')
      router.push('/cotizaciones')
    } finally {
      setLoading(false)
    }
  }

  const fetchVendedores = async () => {
    try {
      const response = await fetch('/api/users?vendedores=true')
      if (response.ok) {
        const data = await response.json()
        setVendedores(data.users || [])
      }
    } catch {
      toast.error('Error al cargar vendedores')
    }
  }

  const fetchAuditLogs = async () => {
    try {
      setAuditLogsLoading(true)
      const response = await fetch(`/api/quotes/${quoteId}/audit-log`)
      if (response.ok) {
        const data = await response.json()
        setAuditLogs(data.logs || [])
      }
    } catch {
      console.error('Error fetching audit logs')
    } finally {
      setAuditLogsLoading(false)
    }
  }

  const handleReasignarVendedor = async () => {
    if (!nuevoVendedorId) return
    const estadosCerrados = ['ACCEPTED', 'REJECTED', 'CONVERTED', 'FACTURADA_PARCIAL']
    if (quote && estadosCerrados.includes(quote.status) && !reasignarMotivo.trim()) {
      toast.error('Se requiere motivo para reasignar cotizaciones cerradas')
      return
    }

    try {
      setReasignarLoading(true)
      const response = await fetch(`/api/quotes/${quoteId}/vendedor`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nuevoVendedorId,
          motivo: reasignarMotivo.trim() || undefined,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        toast.error(data.error || 'Error al reasignar vendedor')
        return
      }
      const vendedor = vendedores.find((v) => v.id === nuevoVendedorId)
      toast.success(`Vendedor reasignado a ${vendedor?.name || 'nuevo vendedor'}`)
      setShowReasignarModal(false)
      setNuevoVendedorId('')
      setReasignarMotivo('')
      await fetchQuoteData()
      await fetchAuditLogs()
    } catch {
      toast.error('Error al reasignar vendedor')
    } finally {
      setReasignarLoading(false)
    }
  }

  const openReasignarModal = async () => {
    await fetchVendedores()
    setNuevoVendedorId('')
    setReasignarMotivo('')
    setShowReasignarModal(true)
  }

  const searchProducts = async (query: string) => {
    // Cancelar la búsqueda anterior si sigue en vuelo (evita respuestas fuera de orden)
    searchAbortRef.current?.abort()
    const controller = new AbortController()
    searchAbortRef.current = controller

    try {
      setSearchLoading(true)
      const params = new URLSearchParams({
        search: query,
        limit: '20',
        status: 'ACTIVE',
      })
      const response = await fetch(`/api/productos?${params.toString()}`, {
        signal: controller.signal,
      })
      if (response.ok) {
        const data = await response.json()
        setSearchResults(data.products || [])
      } else {
        setSearchResults([])
      }
      setSearchLoading(false)
    } catch (error) {
      if (controller.signal.aborted) return
      console.error('Error buscando productos:', error)
      setSearchResults([])
      setSearchLoading(false)
    }
  }

  const searchAdditionalProducts = async (index: number, query: string) => {
    if (query.length < 2) {
      setAdditionalSearchResults(prev => ({ ...prev, [index]: [] }))
      return
    }
    // Cancelar la búsqueda anterior de este índice si sigue en vuelo
    addlSearchAbortRef.current[index]?.abort()
    const controller = new AbortController()
    addlSearchAbortRef.current[index] = controller

    try {
      setAdditionalSearchLoading(prev => ({ ...prev, [index]: true }))
      const params = new URLSearchParams({
        search: query,
        limit: '20',
        status: 'ACTIVE',
      })
      const response = await fetch(`/api/productos?${params.toString()}`, {
        signal: controller.signal,
      })
      if (response.ok) {
        const data = await response.json()
        setAdditionalSearchResults(prev => ({ ...prev, [index]: data.products || [] }))
      } else {
        setAdditionalSearchResults(prev => ({ ...prev, [index]: [] }))
      }
      setAdditionalSearchLoading(prev => ({ ...prev, [index]: false }))
    } catch (error) {
      if (controller.signal.aborted) return
      console.error('Error buscando adicionales:', error)
      setAdditionalSearchResults(prev => ({ ...prev, [index]: [] }))
      setAdditionalSearchLoading(prev => ({ ...prev, [index]: false }))
    }
  }

  const fetchBrandDiscounts = async () => {
    try {
      const response = await fetch('/api/brands/discounts')
      if (response.ok) {
        const data = await response.json()
        setBrandDiscounts(data.discounts || [])
      }
    } catch (error) {
      console.error('Error cargando descuentos:', error)
    }
  }

  const handleMultiplierChange = async (newValue: string) => {
    const numValue = parseFloat(newValue)
    if (isNaN(numValue) || numValue < 0.5 || numValue > 3.0) {
      toast.error('El multiplicador debe estar entre 0.50 y 3.00')
      return
    }

    try {
      setMultiplierLoading(true)
      const response = await fetch(`/api/quotes/${quoteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          multiplier: numValue,
          saveMultiplierToCustomer: saveToCustomer,
        }),
      })

      if (!response.ok) throw new Error('Error al actualizar multiplicador')

      setMultiplierValue(numValue.toFixed(2))
      setShowCustomMultiplier(false)
      toast.success(`Multiplicador actualizado a ${formatNumber(numValue)}x`)
      if (saveToCustomer) {
        toast.success('Multiplicador guardado en el cliente para futuras cotizaciones')
      }
      await fetchQuoteData()
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al actualizar multiplicador')
    } finally {
      setMultiplierLoading(false)
    }
  }

  const handleValidityChange = async (dateStr: string) => {
    if (!dateStr) return
    try {
      setValidityLoading(true)
      const response = await fetch(`/api/quotes/${quoteId}/extend-validity`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ validUntil: new Date(dateStr).toISOString() }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Error al actualizar')
      setShowEditValidity(false)
      toast.success('Fecha de vencimiento actualizada')
      await fetchQuoteData()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Error al actualizar fecha'
      toast.error(message)
    } finally {
      setValidityLoading(false)
    }
  }

  const handleQuickValidity = (days: number) => {
    const date = new Date()
    date.setDate(date.getDate() + days)
    const dateStr = getLocalDateString(date)
    setValidityValue(dateStr)
    handleValidityChange(dateStr)
  }

  const handleReferenceChange = async () => {
    try {
      setReferenceLoading(true)
      const response = await fetch(`/api/quotes/${quoteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenderNumber: referenceValue.trim() || null }),
      })
      if (!response.ok) throw new Error()
      setShowEditReference(false)
      toast.success(referenceValue.trim() ? 'Referencia actualizada' : 'Referencia eliminada')
      await fetchQuoteData()
    } catch {
      toast.error('Error al actualizar referencia')
    } finally {
      setReferenceLoading(false)
    }
  }

  const handleExchangeRateChange = async (newValue: string) => {
    const numValue = parseFloat(newValue)
    if (isNaN(numValue) || numValue <= 0) {
      toast.error('El tipo de cambio debe ser mayor a 0')
      return
    }
    try {
      setExchangeRateLoading(true)
      const response = await fetch(`/api/quotes/${quoteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exchangeRate: numValue }),
      })
      if (!response.ok) throw new Error()
      setExchangeRateValue(numValue.toFixed(2))
      setShowEditExchangeRate(false)
      toast.success(`Tipo de cambio actualizado a ARS ${formatNumber(numValue)}`)
      await fetchQuoteData()
    } catch {
      toast.error('Error al actualizar tipo de cambio')
    } finally {
      setExchangeRateLoading(false)
    }
  }

  const handleBonificationChange = async (newValue: string) => {
    const numValue = parseFloat(newValue)
    if (isNaN(numValue) || numValue < 0 || numValue > 100) {
      toast.error('La bonificación debe estar entre 0% y 100%')
      return
    }
    try {
      setBonificationLoading(true)
      const response = await fetch(`/api/quotes/${quoteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bonification: numValue }),
      })
      if (!response.ok) throw new Error()
      setBonificationValue(numValue.toFixed(2))
      setShowEditBonification(false)
      toast.success(`Bonificación actualizada a ${numValue}%`)
      await fetchQuoteData()
    } catch {
      toast.error('Error al actualizar bonificación')
    } finally {
      setBonificationLoading(false)
    }
  }

  const handleTogglePricesIncludeTax = async (newValue: boolean) => {
    if (!quote) return
    // Si hay items, pedimos confirmación porque se van a reescalar precios por 1.21.
    if (quote.items.length > 0 && !showIvaConfirm) {
      setShowIvaConfirm({ target: newValue })
      return
    }
    try {
      setPricesIncludeTaxLoading(true)
      const response = await fetch(`/api/quotes/${quoteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pricesIncludeTax: newValue }),
      })
      if (!response.ok) throw new Error()
      toast.success(
        newValue
          ? 'Precios ahora INCLUYEN IVA 21% (Factura B)'
          : 'Precios ahora SIN IVA (se suma aparte, Factura A)'
      )
      setShowIvaConfirm(null)
      await fetchQuoteData()
    } catch {
      toast.error('Error al cambiar el modo de IVA')
    } finally {
      setPricesIncludeTaxLoading(false)
    }
  }

  const handleFetchCurrentTC = async () => {
    try {
      setCurrentTCLoading(true)
      const response = await fetch('/api/tipo-cambio')
      if (!response.ok) throw new Error()
      const data = await response.json()
      const usdArs = (data.rates || []).find(
        (r: { fromCurrency: string; toCurrency: string; rate: number }) =>
          r.fromCurrency === 'USD' && r.toCurrency === 'ARS'
      )
      if (usdArs) {
        setExchangeRateValue(Number(usdArs.rate).toFixed(2))
      } else {
        toast.error('No se encontró TC USD/ARS vigente')
      }
    } catch {
      toast.error('Error al obtener tipo de cambio actual')
    } finally {
      setCurrentTCLoading(false)
    }
  }

  const handleRefreshStock = async () => {
    try {
      setRefreshingStock(true)
      const result = await refreshInventoryCache()
      if (result.success) {
        toast.success(`Stock actualizado: ${result.total} items en cache`)
      } else {
        toast.error('Error al actualizar stock')
      }
    } catch (error) {
      console.error('Error refreshing stock:', error)
      toast.error('Error al actualizar stock')
    } finally {
      setRefreshingStock(false)
    }
  }

  const calculatePricePreview = () => {
    if (!quote || !itemFormData.productId) {
      setPricePreview({
        listPrice: 0,
        additionalsTotal: 0,
        subtotalWithAdditionals: 0,
        brandDiscount: 0,
        afterDiscount: 0,
        unitPrice: 0,
        totalPrice: 0,
      })
      return
    }

    if (!selectedProduct) return

    const listPrice = Number(selectedProduct.listPriceUSD || 0)

    // Sumar adicionales (usar el precio guardado en add.listPrice)
    let additionalsTotal = 0
    for (const add of itemFormData.additionals) {
      additionalsTotal += Number(add.listPrice || 0)
    }

    const subtotalWithAdditionals = listPrice + additionalsTotal

    // Obtener descuento de marca (desde el override del formulario)
    let brandDiscountPercent = 0
    const overrideVal = parseFloat(itemFormData.brandDiscountOverride)
    if (!isNaN(overrideVal) && overrideVal > 0) {
      brandDiscountPercent = overrideVal / 100
    }

    // Aplicar fórmula VAL ARG
    const afterDiscount = subtotalWithAdditionals * (1 - brandDiscountPercent)
    const multOverride = parseFloat(itemFormData.multiplierOverride)
    const customerMultiplier = (!isNaN(multOverride) && multOverride > 0) ? multOverride : Number(quote.multiplier)
    const unitPrice = afterDiscount * customerMultiplier
    const totalPrice = unitPrice * itemFormData.quantity

    setPricePreview({
      listPrice,
      additionalsTotal,
      subtotalWithAdditionals,
      brandDiscount: brandDiscountPercent * 100,
      afterDiscount,
      unitPrice,
      totalPrice,
    })
  }

  const handleAddItem = async () => {
    try {
      setItemFormLoading(true)

      const multOverrideVal = parseFloat(itemFormData.multiplierOverride)
      const multiplierOverride = (!isNaN(multOverrideVal) && multOverrideVal > 0) ? multOverrideVal : null

      const payload = itemFormData.isManual
        ? {
            productId: null,
            manualSku: itemFormData.manualSku || null,
            manualBrand: itemFormData.manualBrand || null,
            description: itemFormData.description,
            manualUnitPrice: parseFloat(itemFormData.manualUnitPrice),
            quantity: itemFormData.quantity,
            deliveryTime: itemFormData.deliveryTime || 'A confirmar',
            isAlternative: itemFormData.isAlternative,
            alternativeToItemId: itemFormData.alternativeToItemId,
            multiplierOverride,
          }
        : {
            productId: itemFormData.productId,
            quantity: itemFormData.quantity,
            description: itemFormData.description || selectedProduct?.name,
            deliveryTime: itemFormData.deliveryTime,
            isAlternative: itemFormData.isAlternative,
            alternativeToItemId: itemFormData.alternativeToItemId,
            brandDiscount: itemFormData.brandDiscountOverride
              ? parseFloat(itemFormData.brandDiscountOverride) / 100
              : undefined,
            multiplierOverride,
            additionals: itemFormData.additionals.map((add) => ({
              productId: add.productId || null,
              listPrice: add.listPrice,
              description: add.isManual ? (add.manualDescription || '') : undefined,
            })),
          }

      const response = await fetch(`/api/quotes/${quoteId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || 'Error al agregar item')
      }

      toast.success('Item agregado exitosamente')
      setShowItemDialog(false)
      resetItemForm()
      await fetchQuoteData()
    } catch (error) {
      console.error('Error:', error)
      toast.error(error instanceof Error ? error.message : 'Error al agregar item')
    } finally {
      setItemFormLoading(false)
    }
  }

  const handleDeleteItem = async (itemId: string) => {
    if (!confirm('¿Está seguro de eliminar este item?')) return

    try {
      const response = await fetch(`/api/quotes/items/${itemId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Error al eliminar item')
      }

      toast.success('Item eliminado')
      await fetchQuoteData()
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al eliminar item')
    }
  }

  const handleOpenEditDialog = (item: QuoteItem) => {
    setEditingItemId(item.id)
    const isManual = !item.productId
    setSelectedProduct(item.product)
    setLastConjuntoSkus([])
    setLastConjuntoTipo(null)
    setLastBobinaKitSkus([])
    setLastNamurSku(null)
    setItemFormData({
      productId: item.productId || '',
      quantity: item.quantity,
      description: item.description || '',
      deliveryTime: item.deliveryTime || (isManual ? 'A confirmar' : 'Inmediato'),
      isAlternative: item.isAlternative,
      alternativeToItemId: item.alternativeToItemId,
      additionals: item.additionals.map(add => ({
        productId: add.productId,
        listPrice: Number(add.listPrice),
        productName: add.product?.name || '',
        productSku: add.product?.sku || '',
        isManual: !add.productId,
        manualDescription: add.description || '',
      })),
      isManual,
      manualSku: item.manualSku || '',
      manualBrand: item.manualBrand || '',
      manualUnitPrice: isManual ? String(Number(item.listPrice).toFixed(2)) : '',
      brandDiscountOverride: item.productId
        ? String(Number(item.brandDiscount) * 100)
        : '',
      multiplierOverride: item.multiplierOverride !== null && item.multiplierOverride !== undefined
        ? String(Number(item.multiplierOverride))
        : '',
    })
    setShowItemDialog(true)
  }

  const handleSaveItem = async () => {
    if (itemFormData.isManual) {
      if (!itemFormData.description.trim()) {
        toast.error('La descripción es obligatoria para items manuales')
        return
      }
      const price = parseFloat(itemFormData.manualUnitPrice)
      if (isNaN(price) || price <= 0) {
        toast.error('El precio unitario debe ser mayor a 0')
        return
      }
    } else if (!itemFormData.productId) {
      toast.error('Debe seleccionar un producto')
      return
    }

    if (editingItemId) {
      return handleEditItem()
    }
    return handleAddItem()
  }

  const handleEditItem = async () => {
    if (!editingItemId) return

    try {
      setItemFormLoading(true)

      const editMultOverrideVal = parseFloat(itemFormData.multiplierOverride)
      const editMultiplierOverride = (!isNaN(editMultOverrideVal) && editMultOverrideVal > 0) ? editMultOverrideVal : null

      const payload = itemFormData.isManual
        ? {
            isManual: true,
            manualSku: itemFormData.manualSku || null,
            manualBrand: itemFormData.manualBrand || null,
            description: itemFormData.description,
            manualUnitPrice: parseFloat(itemFormData.manualUnitPrice),
            quantity: itemFormData.quantity,
            deliveryTime: itemFormData.deliveryTime,
            multiplierOverride: editMultiplierOverride,
          }
        : {
            productId: itemFormData.productId,
            quantity: itemFormData.quantity,
            description: itemFormData.description || selectedProduct?.name,
            deliveryTime: itemFormData.deliveryTime,
            brandDiscount: itemFormData.brandDiscountOverride
              ? parseFloat(itemFormData.brandDiscountOverride) / 100
              : undefined,
            multiplierOverride: editMultiplierOverride,
            additionals: itemFormData.additionals.map((add) => ({
              productId: add.productId || null,
              listPrice: add.listPrice,
              description: add.isManual ? (add.manualDescription || '') : undefined,
            })),
          }

      const response = await fetch(`/api/quotes/items/${editingItemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || 'Error al editar item')
      }

      toast.success('Item actualizado exitosamente')
      setShowItemDialog(false)
      setEditingItemId(null)
      resetItemForm()
      await fetchQuoteData()
    } catch (error) {
      console.error('Error:', error)
      toast.error(error instanceof Error ? error.message : 'Error al editar item')
    } finally {
      setItemFormLoading(false)
    }
  }

  const handleAddAdditional = () => {
    if (itemFormData.additionals.length >= 5) {
      toast.error('Máximo 5 adicionales por item')
      return
    }

    setItemFormData({
      ...itemFormData,
      additionals: [
        ...itemFormData.additionals,
        { productId: '', listPrice: 0 },
      ],
    })
  }

  const handleRemoveAdditional = (index: number) => {
    setItemFormData({
      ...itemFormData,
      additionals: itemFormData.additionals.filter((_, i) => i !== index),
    })
  }

  const handleAddAdditionalFromSearch = (product: Product) => {
    if (itemFormData.additionals.length >= 5) {
      toast.error('Máximo 5 adicionales por item')
      return
    }
    const listPrice = product.listPriceUSD ? Number(product.listPriceUSD) : 0
    setItemFormData({
      ...itemFormData,
      additionals: [
        ...itemFormData.additionals,
        { productId: product.id, listPrice, productName: product.name, productSku: product.sku },
      ],
    })
    setAddlSearchTerm('')
    setAddlSearchResults([])
  }

  const handleAddManualAdditional = () => {
    if (itemFormData.additionals.length >= 5) {
      toast.error('Máximo 5 adicionales por item')
      return
    }
    const description = manualAddlDescription.trim()
    const price = parseFloat(manualAddlPrice)
    if (!description) {
      toast.error('La descripción del adicional es obligatoria')
      return
    }
    if (isNaN(price) || price < 0) {
      toast.error('El precio debe ser un número válido')
      return
    }
    setItemFormData({
      ...itemFormData,
      additionals: [
        ...itemFormData.additionals,
        { productId: null, listPrice: price, isManual: true, manualDescription: description },
      ],
    })
    setManualAddlDescription('')
    setManualAddlPrice('')
    setShowManualAddlForm(false)
  }

  // Agrega el kit de un conjunto armado GENEBRE (actuador + dados) como adicionales.
  // Si ya se había agregado otro conjunto, sus componentes se reemplazan por los del nuevo.
  const handleAddConjunto = async (opcion: ConjuntoOpcion) => {
    if (opcion.cotizar || !opcion.actuadorSku) return
    const kitSkus = [opcion.actuadorSku, ...(opcion.dadoSkus || [])]
    setConjuntoLoading(opcion.tipo)
    try {
      const resultados = await Promise.all(
        kitSkus.map(async (sku) => {
          const params = new URLSearchParams({ search: sku, limit: '10', status: 'ACTIVE' })
          const response = await fetch(`/api/productos?${params.toString()}`)
          if (!response.ok) return { sku, product: null }
          const data = await response.json()
          const exact = (data.products || []).find((p: Product) => p.sku === sku)
          return { sku, product: (exact as Product) || null }
        })
      )

      const encontrados = resultados.filter((r) => r.product).map((r) => r.product!)
      const faltantes = resultados.filter((r) => !r.product).map((r) => r.sku)

      // Conservar adicionales ajenos al conjunto anterior. Si el nuevo conjunto
      // no es neumático, la electroválvula NAMUR ya no aplica: se saca también.
      const esNeumatico = opcion.tipo === 'DOBLE_EFECTO' || opcion.tipo === 'SIMPLE_EFECTO'
      const restantes = itemFormData.additionals.filter(
        (a) =>
          !a.productSku ||
          (!lastConjuntoSkus.includes(a.productSku) &&
            (esNeumatico || a.productSku !== lastNamurSku))
      )
      const nuevos = encontrados.map((p) => ({
        productId: p.id,
        listPrice: p.listPriceUSD ? Number(p.listPriceUSD) : 0,
        productName: p.name,
        productSku: p.sku,
      }))

      if (restantes.length + nuevos.length > 5) {
        toast.error(
          `El conjunto necesita ${nuevos.length} adicionales y ya hay ${restantes.length} — supera el máximo de 5. Eliminá adicionales primero.`
        )
        return
      }

      setItemFormData({ ...itemFormData, additionals: [...restantes, ...nuevos] })
      setLastConjuntoSkus(encontrados.map((p) => p.sku))
      setLastConjuntoTipo(opcion.tipo)
      if (!esNeumatico) setLastNamurSku(null)

      if (faltantes.length > 0) {
        toast.warning(`Componentes no encontrados en el catálogo: ${faltantes.join(', ')}`)
      } else {
        toast.success(`Conjunto ${opcion.label} agregado (${nuevos.map((n) => n.productSku).join(' + ')})`)
      }
      if (opcion.nota) {
        toast.info(opcion.nota, { duration: 10000 })
      }
    } catch {
      toast.error('Error al buscar los componentes del conjunto')
    } finally {
      setConjuntoLoading(null)
    }
  }

  // Agrega bobina + conector de una electroválvula GENEBRE como adicionales,
  // según la tensión elegida. Si ya se había elegido otra tensión, se reemplaza.
  const handleAddBobinaKit = async (kit: BobinaKit) => {
    const kitSkus = [kit.bobinaSku, kit.conectorSku]
    setBobinaKitLoading(kit.tension)
    try {
      const resultados = await Promise.all(
        kitSkus.map(async (sku) => {
          const params = new URLSearchParams({ search: sku, limit: '10', status: 'ACTIVE' })
          const response = await fetch(`/api/productos?${params.toString()}`)
          if (!response.ok) return { sku, product: null }
          const data = await response.json()
          const exact = (data.products || []).find((p: Product) => p.sku === sku)
          return { sku, product: (exact as Product) || null }
        })
      )

      const encontrados = resultados.filter((r) => r.product).map((r) => r.product!)
      const faltantes = resultados.filter((r) => !r.product).map((r) => r.sku)

      // Conservar adicionales ajenos al kit de bobina anterior
      const restantes = itemFormData.additionals.filter(
        (a) => !a.productSku || !lastBobinaKitSkus.includes(a.productSku)
      )
      const nuevos = encontrados.map((p) => ({
        productId: p.id,
        listPrice: p.listPriceUSD ? Number(p.listPriceUSD) : 0,
        productName: p.name,
        productSku: p.sku,
      }))

      if (restantes.length + nuevos.length > 5) {
        toast.error(
          `El kit necesita ${nuevos.length} adicionales y ya hay ${restantes.length} — supera el máximo de 5. Eliminá adicionales primero.`
        )
        return
      }

      setItemFormData({ ...itemFormData, additionals: [...restantes, ...nuevos] })
      setLastBobinaKitSkus(encontrados.map((p) => p.sku))

      if (faltantes.length > 0) {
        toast.warning(`Componentes no encontrados en el catálogo: ${faltantes.join(', ')}`)
      } else {
        toast.success(`Kit ${kit.tension} agregado (${nuevos.map((n) => n.productSku).join(' + ')})`)
      }
      if (kit.nota) {
        toast.info(kit.nota, { duration: 10000 })
      }
    } catch {
      toast.error('Error al buscar los componentes del kit')
    } finally {
      setBobinaKitLoading(null)
    }
  }

  // Agrega la electroválvula NAMUR de la tensión elegida como adicional del
  // conjunto neumático. Si ya se había elegido otra tensión, se reemplaza.
  const handleAddNamur = async (kit: NamurKit) => {
    setNamurLoading(kit.tension)
    try {
      const params = new URLSearchParams({ search: kit.sku, limit: '10', status: 'ACTIVE' })
      const response = await fetch(`/api/productos?${params.toString()}`)
      const data = response.ok ? await response.json() : { products: [] }
      const product = ((data.products || []) as Product[]).find((p) => p.sku === kit.sku)

      if (!product) {
        toast.warning(`Electroválvula no encontrada en el catálogo: ${kit.sku}`)
        return
      }

      // Conservar adicionales ajenos a la NAMUR anterior
      const restantes = itemFormData.additionals.filter(
        (a) => !a.productSku || a.productSku !== lastNamurSku
      )

      if (restantes.length + 1 > 5) {
        toast.error('Ya hay 5 adicionales — eliminá uno para agregar la electroválvula NAMUR.')
        return
      }

      setItemFormData({
        ...itemFormData,
        additionals: [
          ...restantes,
          {
            productId: product.id,
            listPrice: product.listPriceUSD ? Number(product.listPriceUSD) : 0,
            productName: product.name,
            productSku: product.sku,
          },
        ],
      })
      setLastNamurSku(product.sku)
      toast.success(`Electroválvula NAMUR ${kit.tension} agregada (${product.sku})`)
    } catch {
      toast.error('Error al buscar la electroválvula NAMUR')
    } finally {
      setNamurLoading(null)
    }
  }

  const handleUpdateAdditional = (index: number, product: Product) => {
    const listPrice = product.listPriceUSD ? Number(product.listPriceUSD) : 0

    const newAdditionals = [...itemFormData.additionals]
    newAdditionals[index] = {
      productId: product.id,
      listPrice,
      productName: product.name,
      productSku: product.sku,
    }

    setItemFormData({
      ...itemFormData,
      additionals: newAdditionals,
    })
  }

  const resetItemForm = () => {
    setEditingItemId(null)
    setSelectedProduct(null)
    setItemFormData({
      productId: '',
      quantity: 1,
      description: '',
      deliveryTime: 'Inmediato',
      isAlternative: false,
      alternativeToItemId: null,
      additionals: [],
      isManual: false,
      manualSku: '',
      manualBrand: '',
      manualUnitPrice: '',
      brandDiscountOverride: '',
      multiplierOverride: '',
    })
    setProductSearch('')
    setAddlSearchTerm('')
    setAddlSearchResults([])
    setShowManualAddlForm(false)
    setManualAddlDescription('')
    setManualAddlPrice('')
    setConjuntoLoading(null)
    setLastConjuntoSkus([])
    setLastConjuntoTipo(null)
    setBobinaKitLoading(null)
    setLastBobinaKitSkus([])
    setNamurLoading(null)
    setLastNamurSku(null)
  }

  const handleOpenAlternativeDialog = (parentItemId: string) => {
    setItemFormData({
      ...itemFormData,
      isAlternative: true,
      alternativeToItemId: parentItemId,
    })
    setShowItemDialog(true)
  }

  // Productos filtrados vienen del servidor
  const filteredProducts = searchResults

  // Agrupar items por número base (principal + alternativas)
  const groupedItems = quote?.items.reduce((acc, item) => {
    if (item.isAlternative) {
      const parentNumber = item.itemNumber
      if (!acc[parentNumber]) {
        acc[parentNumber] = []
      }
      acc[parentNumber].push(item)
    } else {
      if (!acc[item.itemNumber]) {
        acc[item.itemNumber] = []
      }
      acc[item.itemNumber].unshift(item)
    }
    return acc
  }, {} as Record<number, QuoteItem[]>) || {}

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

  if (!quote) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Cotización no encontrada</p>
      </div>
    )
  }

  const totalInARS = Number(quote.total) * Number(quote.exchangeRate)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => (window.history.length > 1 ? router.back() : router.push('/cotizaciones'))}
            className="text-blue-600 hover:text-blue-700"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-blue-900">
              {quote.quoteNumber}
            </h1>
            <p className="text-muted-foreground">{quote.customer.name}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => router.push(`/cotizaciones/${quote.id}/ver`)}
            title="Ver detalle completo"
          >
            <Eye className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={() => setShowCertificados(true)}>
            Certificados
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              try {
                const response = await fetch(`/api/cotizaciones/${quote.id}/pdf`)
                if (!response.ok) throw new Error('Error al generar PDF')

                const blob = await response.blob()
                const url = window.URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                const safeName = (quote.customer.businessName || quote.customer.name).replace(/[/\\:*?"<>|]/g, '-').trim()
                a.download = `Cotizacion-${quote.quoteNumber} ${safeName}.pdf`
                document.body.appendChild(a)
                a.click()
                window.URL.revokeObjectURL(url)
                document.body.removeChild(a)

                toast.success('PDF generado correctamente')
              } catch (error) {
                console.error('Error:', error)
                toast.error('Error al generar PDF')
              }
            }}
          >
            Descargar PDF
          </Button>
        </div>
      </div>

      {/* Quote Info */}
      <Card className="border-blue-200">
        <CardHeader>
          <CardTitle className="text-blue-900">Información de la Cotización</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label className="text-muted-foreground">Cliente</Label>
              <p className="font-medium">
                {quote.customer.businessName || quote.customer.name}
              </p>
            </div>
            <div>
              <Label className="text-muted-foreground">Vendedor</Label>
              <div className="flex items-center gap-2">
                <p className="font-medium">{quote.salesPerson.name}</p>
                {session?.user?.role === 'ADMIN' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-blue-900"
                    onClick={openReasignarModal}
                    title="Reasignar vendedor"
                  >
                    <UserRoundPen className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {quote.salesPerson.email}
              </p>
            </div>
            <div>
              <Label className="text-muted-foreground">Fecha</Label>
              <p className="font-medium">
                {new Date(quote.date).toLocaleDateString('es-AR')}
              </p>
              {/* Válida hasta - editable en DRAFT y SENT */}
              <div className="mt-1">
                <Label className="text-muted-foreground text-xs">Válida hasta</Label>
                {showEditValidity ? (
                  <div className="space-y-2 mt-1">
                    <div className="flex items-center gap-2">
                      <Input
                        type="date"
                        value={validityValue}
                        onChange={(e) => setValidityValue(e.target.value)}
                        className="w-44 h-8 text-sm"
                        disabled={validityLoading}
                        min={getLocalDateString()}
                      />
                      <Button
                        size="sm"
                        className="h-8 bg-blue-600 hover:bg-blue-700"
                        onClick={() => handleValidityChange(validityValue)}
                        disabled={validityLoading || !validityValue}
                      >
                        {validityLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8"
                        onClick={() => setShowEditValidity(false)}
                        disabled={validityLoading}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="flex gap-1 flex-wrap">
                      {[7, 15, 30, 60].map(days => (
                        <button
                          key={days}
                          type="button"
                          className="text-xs px-2 py-0.5 rounded border border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600 transition-colors cursor-pointer"
                          onClick={() => handleQuickValidity(days)}
                          disabled={validityLoading}
                        >
                          {days}d
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <p className="text-sm text-muted-foreground">
                      {quote.validUntil
                        ? new Date(quote.validUntil).toLocaleDateString('es-AR')
                        : 'Sin fecha'}
                    </p>
                    {(quote.status === 'DRAFT' || quote.status === 'SENT') && (
                      <button
                        type="button"
                        className="text-gray-400 hover:text-blue-600 transition-colors"
                        onClick={() => {
                          setValidityValue(
                            quote.validUntil
                              ? getLocalDateString(new Date(quote.validUntil))
                              : ''
                          )
                          setShowEditValidity(true)
                        }}
                        title="Editar fecha de vencimiento"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="mt-1">
                <Label className="text-muted-foreground text-xs">Referencia</Label>
                {showEditReference ? (
                  <div className="flex items-center gap-2 mt-1">
                    <Input
                      type="text"
                      value={referenceValue}
                      onChange={(e) => setReferenceValue(e.target.value)}
                      className="w-48 h-8 text-sm"
                      disabled={referenceLoading}
                      placeholder="Ej: Licitación LP-2026-0451"
                      onKeyDown={(e) => e.key === 'Enter' && handleReferenceChange()}
                    />
                    <Button
                      size="sm"
                      className="h-8 bg-blue-600 hover:bg-blue-700"
                      onClick={handleReferenceChange}
                      disabled={referenceLoading}
                    >
                      {referenceLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8"
                      onClick={() => {
                        setShowEditReference(false)
                        setReferenceValue(quote.tenderNumber || '')
                      }}
                      disabled={referenceLoading}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <p className="text-sm font-medium">
                      {quote.tenderNumber || '—'}
                    </p>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0"
                      onClick={() => {
                        setReferenceValue(quote.tenderNumber || '')
                        setShowEditReference(true)
                      }}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
            <div>
              <Label className="text-muted-foreground">Tipo de Cambio</Label>
              {showEditExchangeRate ? (
                <div className="space-y-2 mt-1">
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      step="0.01"
                      min="1"
                      value={exchangeRateValue}
                      onChange={(e) => setExchangeRateValue(e.target.value)}
                      className="w-28 font-mono h-8 text-sm"
                      disabled={exchangeRateLoading || currentTCLoading}
                      placeholder="Ej: 1390.00"
                    />
                    <Button
                      size="sm"
                      className="h-8 bg-blue-600 hover:bg-blue-700"
                      onClick={() => handleExchangeRateChange(exchangeRateValue)}
                      disabled={exchangeRateLoading || currentTCLoading}
                    >
                      {exchangeRateLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8"
                      onClick={() => {
                        setShowEditExchangeRate(false)
                        setExchangeRateValue(Number(quote.exchangeRate).toFixed(2))
                      }}
                      disabled={exchangeRateLoading}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={handleFetchCurrentTC}
                    disabled={exchangeRateLoading || currentTCLoading}
                  >
                    {currentTCLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                    Usar TC actual
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <p className="font-medium font-mono">
                    USD 1 = ARS {formatNumber(quote.exchangeRate)}
                  </p>
                  {isEditable && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0"
                      onClick={() => setShowEditExchangeRate(true)}
                      title="Cambiar tipo de cambio"
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              )}
            </div>
            <div>
              <Label className="text-muted-foreground">Multiplicador</Label>
              {showCustomMultiplier ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      step="0.01"
                      min="0.50"
                      max="3.00"
                      value={multiplierValue}
                      onChange={(e) => setMultiplierValue(e.target.value)}
                      className="w-24 font-mono font-semibold h-8 text-sm"
                      disabled={multiplierLoading}
                    />
                    <span className="text-sm text-muted-foreground">x</span>
                    <Button
                      size="sm"
                      className="h-8 bg-blue-600 hover:bg-blue-700"
                      onClick={() => handleMultiplierChange(multiplierValue)}
                      disabled={multiplierLoading}
                    >
                      {multiplierLoading ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Save className="h-3 w-3" />
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8"
                      onClick={() => {
                        setShowCustomMultiplier(false)
                        setMultiplierValue(Number(quote.multiplier).toFixed(2))
                      }}
                      disabled={multiplierLoading}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={saveToCustomer}
                      onChange={(e) => setSaveToCustomer(e.target.checked)}
                      className="rounded"
                    />
                    Guardar en cliente para futuras cotizaciones
                  </label>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <p className={`font-medium font-mono ${Number(quote.multiplier) > 1 ? 'text-amber-600' : ''}`}>
                    {formatNumber(quote.multiplier)}x
                  </p>
                  {isEditable && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0"
                      onClick={() => setShowCustomMultiplier(true)}
                      title="Cambiar multiplicador"
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  )}
                  {Number(quote.multiplier) > 1 && (
                    <span className="text-xs text-amber-600 font-medium">
                      +{((Number(quote.multiplier) - 1) * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
              )}
              <div className="mt-1 flex flex-wrap gap-1">
                {[1.00, 1.05, 1.10, 1.15, 1.20, 1.25, 1.30].map((val) => (
                  <button
                    key={val}
                    type="button"
                    className={`text-xs px-1.5 py-0.5 rounded border transition-colors ${
                      Number(quote.multiplier).toFixed(2) === val.toFixed(2)
                        ? 'bg-blue-100 border-blue-400 text-blue-700 font-semibold'
                        : 'border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600'
                    } ${!isEditable ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    onClick={() => {
                      if (isEditable) {
                        handleMultiplierChange(val.toFixed(2))
                      }
                    }}
                    disabled={!isEditable || multiplierLoading}
                  >
                    {formatNumber(val)}x
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-muted-foreground">Estado</Label>
              <p className="font-medium capitalize">{quote.status}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Items */}
      <Card className="border-blue-200">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-blue-900">Items de la Cotización</CardTitle>
            <Dialog open={showItemDialog} onOpenChange={setShowItemDialog}>
              <DialogTrigger asChild>
                <Button
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700"
                  onClick={() => {
                    resetItemForm()
                    setShowItemDialog(true)
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Agregar Item
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
                <DialogHeader className="shrink-0">
                  <DialogTitle>
                    {editingItemId
                      ? 'Editar Item'
                      : itemFormData.isAlternative
                        ? 'Agregar Alternativa'
                        : 'Agregar Item'}
                  </DialogTitle>
                  <DialogDescription>
                    {itemFormData.isManual
                      ? 'Item sin producto en catálogo. El precio ingresado es el precio lista (se aplica multiplicador).'
                      : editingItemId
                        ? 'Modifique los datos del item. El precio se recalculará automáticamente.'
                        : 'Complete los datos del item. El precio se calcula automáticamente.'}
                  </DialogDescription>
                </DialogHeader>

                <div className="overflow-y-auto flex-1 pr-1 space-y-6">
                  {/* Mode toggle */}
                  <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                    <button
                      type="button"
                      className={`flex-1 py-2 text-sm font-medium transition-colors ${
                        !itemFormData.isManual
                          ? 'bg-blue-600 text-white'
                          : 'bg-white text-gray-600 hover:bg-gray-50'
                      }`}
                      onClick={() => setItemFormData({ ...itemFormData, isManual: false })}
                    >
                      Buscar en Catálogo
                    </button>
                    <button
                      type="button"
                      className={`flex-1 py-2 text-sm font-medium transition-colors ${
                        itemFormData.isManual
                          ? 'bg-purple-600 text-white'
                          : 'bg-white text-gray-600 hover:bg-gray-50'
                      }`}
                      onClick={() => setItemFormData({ ...itemFormData, isManual: true, productId: '' })}
                    >
                      Item Manual
                    </button>
                  </div>

                  {/* ── MANUAL ITEM FORM ── */}
                  {itemFormData.isManual && (
                    <div className="space-y-4 p-4 border border-purple-200 rounded-lg bg-purple-50">
                      <p className="text-xs text-purple-700 font-medium">
                        Fabricación especial o artículo no listado.
                        {Number(quote.multiplier) > 1 && (
                          <span className="ml-1 text-amber-700">
                            Se aplica el multiplicador del cliente ({formatNumber(quote.multiplier)}x).
                          </span>
                        )}
                      </p>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-1">
                          <Label>Descripción <span className="text-red-500">*</span></Label>
                          <Input
                            value={itemFormData.description}
                            onChange={(e) => setItemFormData({ ...itemFormData, description: e.target.value })}
                            placeholder="Ej: Válvula especial DN200 PN40..."
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Precio Unitario USD <span className="text-red-500">*</span></Label>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={itemFormData.manualUnitPrice}
                            onChange={(e) => setItemFormData({ ...itemFormData, manualUnitPrice: e.target.value })}
                            placeholder="0.00"
                            className="font-mono"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>SKU / Código (opcional)</Label>
                          <Input
                            value={itemFormData.manualSku}
                            onChange={(e) => setItemFormData({ ...itemFormData, manualSku: e.target.value })}
                            placeholder="Ej: FAB-001"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Marca (opcional)</Label>
                          <Input
                            value={itemFormData.manualBrand}
                            onChange={(e) => setItemFormData({ ...itemFormData, manualBrand: e.target.value })}
                            placeholder="Ej: GENEBRE"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Cantidad</Label>
                          <Input
                            type="number"
                            min="1"
                            value={itemFormData.quantity}
                            onChange={(e) => setItemFormData({ ...itemFormData, quantity: parseInt(e.target.value) || 1 })}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Plazo de Entrega</Label>
                          <Input
                            value={itemFormData.deliveryTime}
                            onChange={(e) => setItemFormData({ ...itemFormData, deliveryTime: e.target.value })}
                            placeholder="Ej: A confirmar, 30 días..."
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="flex items-center gap-1">
                            Multiplicador
                            {itemFormData.multiplierOverride && (
                              <span className="text-xs text-amber-600 font-normal">(personalizado)</span>
                            )}
                          </Label>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={itemFormData.multiplierOverride}
                            onChange={(e) => setItemFormData({ ...itemFormData, multiplierOverride: e.target.value })}
                            placeholder={`${formatNumber(quote.multiplier)} (cotización)`}
                            className={`font-mono ${itemFormData.multiplierOverride ? 'border-amber-400 bg-amber-50' : ''}`}
                          />
                        </div>
                      </div>
                      {itemFormData.manualUnitPrice && parseFloat(itemFormData.manualUnitPrice) > 0 && (() => {
                        const listP = parseFloat(itemFormData.manualUnitPrice)
                        const manualMultOverride = parseFloat(itemFormData.multiplierOverride)
                        const mult = (!isNaN(manualMultOverride) && manualMultOverride > 0) ? manualMultOverride : (Number(quote.multiplier) || 1)
                        const unitP = listP * mult
                        const totalP = unitP * itemFormData.quantity
                        return (
                          <div className="space-y-1 border-t border-purple-200 pt-2 text-sm">
                            <div className="flex justify-between text-muted-foreground">
                              <span>Precio Lista:</span>
                              <span className="font-mono">USD {formatNumber(listP)}</span>
                            </div>
                            {mult > 1 && (
                              <div className="flex justify-between text-amber-700">
                                <span>× Multiplicador ({formatNumber(mult)}x):</span>
                                <span className="font-mono">USD {formatNumber(unitP)}</span>
                              </div>
                            )}
                            <div className="flex justify-between font-semibold text-purple-800 border-t border-purple-200 pt-1">
                              <span>Total ({itemFormData.quantity} ud):</span>
                              <span className="font-mono">USD {formatNumber(totalP)}</span>
                            </div>
                          </div>
                        )
                      })()}
                    </div>
                  )}

                  {/* ── CATALOG SEARCH — Layout 2 columnas ── */}
                  {!itemFormData.isManual && (
                  <div className="grid grid-cols-5 gap-6">
                    {/* ═══ COLUMNA IZQUIERDA (60%): Búsqueda + Datos ═══ */}
                    <div className="col-span-3 space-y-4">
                      {/* Buscar Producto */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label>Buscar Producto</Label>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleRefreshStock}
                            disabled={refreshingStock}
                            className="text-xs"
                          >
                            <RefreshCw className={`h-3 w-3 mr-1 ${refreshingStock ? 'animate-spin' : ''}`} />
                            Actualizar Stock
                          </Button>
                        </div>
                        <Input
                          placeholder="Buscar por SKU, nombre o marca... (mín. 2 caracteres)"
                          value={productSearch}
                          onChange={(e) => setProductSearch(e.target.value)}
                        />
                        <div className="max-h-[200px] overflow-y-auto border rounded-md">
                          {searchLoading ? (
                            <div className="p-8 text-center text-muted-foreground">
                              <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                              <p className="text-sm">Buscando productos...</p>
                            </div>
                          ) : productSearch.length >= 2 && filteredProducts.length === 0 ? (
                            <div className="p-8 text-center text-muted-foreground">
                              <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
                              <p className="text-sm">No se encontraron productos</p>
                              <p className="text-xs">Intenta con otro término de búsqueda</p>
                            </div>
                          ) : productSearch.length < 2 ? (
                            <div className="p-8 text-center text-muted-foreground">
                              <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                              <p className="text-sm">Escribe al menos 2 caracteres para buscar</p>
                            </div>
                          ) : null}
                          {!searchLoading && filteredProducts.map((product) => (
                            <div
                              key={product.id}
                              className={`p-3 cursor-pointer hover:bg-blue-50 border-b last:border-b-0 ${
                                itemFormData.productId === product.id
                                  ? 'bg-blue-100'
                                  : ''
                              }`}
                              onClick={() => {
                                setSelectedProduct(product)
                                // Auto-popular descuento de marca
                                let autoDiscount = ''
                                if (product.brand) {
                                  const discount = brandDiscounts.find((d) => d.brand === product.brand)
                                  if (discount) {
                                    autoDiscount = String(Number(discount.discountPercent))
                                  }
                                }
                                setItemFormData({
                                  ...itemFormData,
                                  productId: product.id,
                                  description: product.name,
                                  brandDiscountOverride: autoDiscount,
                                })
                                setLastConjuntoSkus([])
                                setLastConjuntoTipo(null)
                                setLastBobinaKitSkus([])
                                setLastNamurSku(null)
                                setProductSearch('')
                              }}
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <p className="font-medium">{product.name}</p>
                                  <p className="text-sm text-muted-foreground">
                                    SKU: {product.sku}
                                    {product.brand && ` | Marca: ${product.brand}`}
                                  </p>
                                  <div className="mt-1">
                                    <StockBadge
                                      sku={product.sku}
                                      stock={stockData[product.sku]?.stock}
                                      found={stockData[product.sku]?.found}
                                      loading={stockLoading}
                                      size="sm"
                                    />
                                  </div>
                                </div>
                                <div className="text-right">
                                  <p className="font-mono font-semibold">
                                    USD {product.listPriceUSD ? formatNumber(product.listPriceUSD) : '0,00'}
                                  </p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Producto Seleccionado */}
                      {itemFormData.productId && selectedProduct && (
                        <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium line-clamp-2">{selectedProduct.name}</p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span className="font-mono">SKU: {selectedProduct.sku}</span>
                              <StockBadge
                                sku={selectedProduct.sku}
                                stock={stockData[selectedProduct.sku]?.stock}
                                found={stockData[selectedProduct.sku]?.found}
                                loading={stockLoading}
                                size="sm"
                              />
                            </div>
                          </div>
                          <span className="text-sm font-mono font-semibold shrink-0 ml-3">USD {formatNumber(selectedProduct.listPriceUSD || 0)}</span>
                        </div>
                      )}

                      {/* Cantidad + Desc. Marca + Multiplicador + Descripción */}
                      <div className="grid gap-4 grid-cols-4">
                        <div className="space-y-2">
                          <Label>Cantidad</Label>
                          <Input
                            type="number"
                            min="1"
                            value={itemFormData.quantity}
                            onChange={(e) =>
                              setItemFormData({
                                ...itemFormData,
                                quantity: parseInt(e.target.value) || 1,
                              })
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Desc. Marca (%)</Label>
                          <Input
                            type="number"
                            step="0.1"
                            min="0"
                            max="100"
                            value={itemFormData.brandDiscountOverride}
                            onChange={(e) =>
                              setItemFormData({
                                ...itemFormData,
                                brandDiscountOverride: e.target.value,
                              })
                            }
                            placeholder="0"
                            className="font-mono"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="flex items-center gap-1">
                            Multiplicador
                            {itemFormData.multiplierOverride && (
                              <span className="text-[10px] text-amber-600 font-normal">(custom)</span>
                            )}
                          </Label>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={itemFormData.multiplierOverride}
                            onChange={(e) =>
                              setItemFormData({
                                ...itemFormData,
                                multiplierOverride: e.target.value,
                              })
                            }
                            placeholder={`${formatNumber(quote.multiplier)}`}
                            className={`font-mono ${itemFormData.multiplierOverride ? 'border-amber-400 bg-amber-50' : ''}`}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Descripción (Opcional)</Label>
                          <Input
                            value={itemFormData.description}
                            onChange={(e) =>
                              setItemFormData({
                                ...itemFormData,
                                description: e.target.value,
                              })
                            }
                            placeholder="Descripción personalizada..."
                          />
                        </div>
                      </div>

                      {/* Plazo de Entrega */}
                      <div className="space-y-2">
                        <Label>Plazo de Entrega</Label>
                        <Input
                          value={itemFormData.deliveryTime}
                          onChange={(e) =>
                            setItemFormData({
                              ...itemFormData,
                              deliveryTime: e.target.value,
                            })
                          }
                          placeholder="Ej: Inmediato, 15 días, 30 días..."
                        />
                      </div>
                    </div>

                    {/* ═══ COLUMNA DERECHA (40%): Adicionales + Precio ═══ */}
                    <div className="col-span-2 space-y-4">
                      {/* Adicionales */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Label className="text-sm font-semibold">Adicionales</Label>
                          <span className="text-xs text-muted-foreground">{itemFormData.additionals.length}/5</span>
                        </div>

                        {/* Conjuntos armados GENEBRE: actuador + dados según tabla de aplicación */}
                        {!itemFormData.isManual && selectedProduct && (() => {
                          const conjuntos = getConjuntosGenebre(selectedProduct.sku)
                          if (conjuntos.length === 0) return null
                          return (
                            <div className="rounded-md border border-blue-200 bg-blue-50/60 p-2 space-y-1.5">
                              <p className="text-xs font-semibold text-blue-800">
                                ⚙ Conjunto armado GENEBRE
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {conjuntos.map((opcion) => (
                                  <Button
                                    key={opcion.tipo}
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={!!opcion.cotizar || conjuntoLoading !== null}
                                    title={
                                      opcion.cotizar
                                        ? 'La tabla GENEBRE indica COTIZAR para esta combinación'
                                        : [opcion.actuadorSku, ...(opcion.dadoSkus || [])].join(' + ')
                                    }
                                    className="h-7 text-xs bg-white border-blue-300 text-blue-700 hover:bg-blue-100"
                                    onClick={() => handleAddConjunto(opcion)}
                                  >
                                    {conjuntoLoading === opcion.tipo && (
                                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                    )}
                                    {opcion.label}
                                    {opcion.cotizar ? ' (cotizar)' : ''}
                                  </Button>
                                ))}
                              </div>
                            </div>
                          )
                        })()}

                        {/* Electroválvula NAMUR para conjuntos neumáticos (elegir tensión) */}
                        {!itemFormData.isManual &&
                          (lastConjuntoTipo === 'DOBLE_EFECTO' || lastConjuntoTipo === 'SIMPLE_EFECTO') && (
                            <div className="rounded-md border border-violet-200 bg-violet-50/60 p-2 space-y-1.5">
                              <p className="text-xs font-semibold text-violet-800">
                                ⚡ Electroválvula NAMUR (opcional, elegir tensión)
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {ELECTROVALVULAS_NAMUR.map((kit) => (
                                  <Button
                                    key={kit.tension}
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={namurLoading !== null}
                                    title={kit.sku}
                                    className="h-7 text-xs bg-white border-violet-300 text-violet-700 hover:bg-violet-100"
                                    onClick={() => handleAddNamur(kit)}
                                  >
                                    {namurLoading === kit.tension && (
                                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                    )}
                                    {kit.tension}
                                  </Button>
                                ))}
                              </div>
                            </div>
                          )}

                        {/* Kits bobina + conector para electroválvulas GENEBRE sin bobina */}
                        {!itemFormData.isManual && selectedProduct && (() => {
                          const kits = getBobinasElectrovalvula(selectedProduct.sku)
                          if (kits.length === 0) return null
                          return (
                            <div className="rounded-md border border-amber-200 bg-amber-50/60 p-2 space-y-1.5">
                              <p className="text-xs font-semibold text-amber-800">
                                🔌 Bobina + conector (elegir tensión)
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {kits.map((kit) => (
                                  <Button
                                    key={kit.tension}
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={bobinaKitLoading !== null}
                                    title={`${kit.bobinaSku} + ${kit.conectorSku}`}
                                    className="h-7 text-xs bg-white border-amber-300 text-amber-700 hover:bg-amber-100"
                                    onClick={() => handleAddBobinaKit(kit)}
                                  >
                                    {bobinaKitLoading === kit.tension && (
                                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                    )}
                                    {kit.tension}
                                  </Button>
                                ))}
                              </div>
                            </div>
                          )
                        })()}

                        {/* Buscador de adicionales — siempre visible si < 5 */}
                        {itemFormData.additionals.length < 5 && (
                          <div className="relative">
                            <div className="relative">
                              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                              <Input
                                placeholder="Buscar adicional por SKU o nombre..."
                                value={addlSearchTerm}
                                onChange={(e) => setAddlSearchTerm(e.target.value)}
                                className="text-sm pl-8"
                              />
                            </div>
                            {/* Dropdown flotante de resultados */}
                            {addlSearchLoading && (
                              <div className="absolute z-[100] w-full mt-1 bg-white border rounded-md shadow-lg p-3 text-center">
                                <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                                <span className="text-sm text-muted-foreground">Buscando...</span>
                              </div>
                            )}
                            {!addlSearchLoading && addlSearchTerm.length >= 2 && addlSearchResults.length === 0 && (
                              <div className="absolute z-[100] w-full mt-1 bg-white border rounded-md shadow-lg p-3 text-center text-sm text-muted-foreground">
                                No se encontraron productos
                              </div>
                            )}
                            {!addlSearchLoading && addlSearchResults.length > 0 && (
                              <div className="absolute z-[100] w-full mt-1 bg-white border rounded-md shadow-lg max-h-[240px] overflow-y-auto">
                                {addlSearchResults.map((product) => (
                                  <button
                                    key={product.id}
                                    type="button"
                                    className="w-full text-left px-3 py-2.5 hover:bg-blue-50 border-b last:border-0 transition-colors"
                                    onClick={() => handleAddAdditionalFromSearch(product)}
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium truncate">{product.name}</p>
                                        <p className="text-xs text-muted-foreground font-mono">
                                          SKU: {product.sku}{product.brand ? ` | ${product.brand}` : ''}
                                        </p>
                                        <div className="mt-0.5">
                                          <StockBadge
                                            sku={product.sku}
                                            stock={stockData[product.sku]?.stock}
                                            found={stockData[product.sku]?.found}
                                            loading={stockLoading}
                                            size="sm"
                                          />
                                        </div>
                                      </div>
                                      <span className="text-sm font-mono font-semibold shrink-0 text-blue-700">
                                        USD {product.listPriceUSD ? formatNumber(product.listPriceUSD) : '0,00'}
                                      </span>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Botón + Adicional libre */}
                        {itemFormData.additionals.length < 5 && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="w-full text-xs border-dashed border-orange-300 text-orange-600 hover:bg-orange-50"
                            onClick={() => setShowManualAddlForm(!showManualAddlForm)}
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            + Adicional libre (sin producto)
                          </Button>
                        )}

                        {/* Mini-form para adicional manual */}
                        {showManualAddlForm && itemFormData.additionals.length < 5 && (
                          <div className="border border-orange-200 bg-orange-50 rounded-lg p-3 space-y-2">
                            <p className="text-xs font-semibold text-orange-700">Adicional libre</p>
                            <div className="space-y-1">
                              <Label className="text-xs">Descripción</Label>
                              <Input
                                value={manualAddlDescription}
                                onChange={(e) => setManualAddlDescription(e.target.value)}
                                placeholder="Ej: Servicio de armado, Ensayo de presión..."
                                className="text-sm h-8"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Precio Lista USD</Label>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                value={manualAddlPrice}
                                onChange={(e) => setManualAddlPrice(e.target.value)}
                                placeholder="0.00"
                                className="text-sm h-8 font-mono"
                              />
                            </div>
                            <div className="flex gap-2">
                              <Button
                                type="button"
                                size="sm"
                                className="flex-1 h-7 text-xs bg-orange-600 hover:bg-orange-700"
                                onClick={handleAddManualAdditional}
                              >
                                Agregar
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs"
                                onClick={() => { setShowManualAddlForm(false); setManualAddlDescription(''); setManualAddlPrice('') }}
                              >
                                Cancelar
                              </Button>
                            </div>
                          </div>
                        )}

                        {/* Lista de adicionales seleccionados */}
                        <div className="space-y-2">
                          {itemFormData.additionals.length === 0 && !addlSearchTerm && !showManualAddlForm && (
                            <div className="text-center py-3 text-muted-foreground border border-dashed rounded-lg">
                              <Package className="h-4 w-4 mx-auto mb-1 opacity-40" />
                              <p className="text-xs">Sin adicionales</p>
                            </div>
                          )}
                          {itemFormData.additionals.map((additional, index) =>
                            additional.isManual ? (
                              <div key={index} className="flex items-center justify-between bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium truncate">{additional.manualDescription || 'Adicional libre'}</p>
                                  <p className="text-xs text-orange-600 font-medium">Adicional libre</p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0 ml-2">
                                  <span className="text-sm font-mono font-semibold">USD {formatNumber(additional.listPrice)}</span>
                                  <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-400 hover:text-red-600 hover:bg-red-50" onClick={() => handleRemoveAdditional(index)}>
                                    <X className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </div>
                            ) : additional.productId ? (
                              <div key={index} className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium truncate">{additional.productName || 'Producto seleccionado'}</p>
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <span className="font-mono">SKU: {additional.productSku || '—'}</span>
                                    {additional.productSku && (
                                      <StockBadge
                                        sku={additional.productSku}
                                        stock={stockData[additional.productSku]?.stock}
                                        found={stockData[additional.productSku]?.found}
                                        loading={stockLoading}
                                        size="sm"
                                      />
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0 ml-2">
                                  <span className="text-sm font-mono font-semibold">USD {formatNumber(additional.listPrice)}</span>
                                  <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-400 hover:text-red-600 hover:bg-red-50" onClick={() => handleRemoveAdditional(index)}>
                                    <X className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </div>
                            ) : null
                          )}
                        </div>
                      </div>

                      {/* Cálculo de Precio */}
                      {itemFormData.productId && (
                        <div className="bg-gradient-to-b from-blue-50 to-blue-100 border border-blue-200 rounded-lg p-4 space-y-2">
                          <p className="text-sm font-semibold text-blue-900 flex items-center gap-1.5 pb-2 border-b border-blue-200">
                            <Calculator className="h-4 w-4" />
                            Cálculo de Precio
                          </p>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Precio Lista:</span>
                            <span className="font-mono">USD {formatNumber(pricePreview.listPrice)}</span>
                          </div>
                          {itemFormData.additionals.map((add, i) => (
                            <div key={i} className={`flex justify-between text-sm ${add.isManual ? 'text-orange-700' : 'text-blue-700'}`}>
                              <span className="truncate mr-2">+ {add.isManual ? (add.manualDescription || 'Adicional libre') : (add.productName || add.productSku)}</span>
                              <span className="font-mono shrink-0">USD {formatNumber(add.listPrice)}</span>
                            </div>
                          ))}
                          {pricePreview.additionalsTotal > 0 && (
                            <div className="flex justify-between text-xs text-muted-foreground border-t border-blue-200 pt-1">
                              <span>Subtotal:</span>
                              <span className="font-mono">USD {formatNumber(pricePreview.subtotalWithAdditionals)}</span>
                            </div>
                          )}
                          {pricePreview.brandDiscount > 0 && (
                            <div className="flex justify-between text-sm text-green-600">
                              <span>- Desc. Marca ({pricePreview.brandDiscount}%):</span>
                              <span className="font-mono">-USD {formatNumber(pricePreview.subtotalWithAdditionals - pricePreview.afterDiscount)}</span>
                            </div>
                          )}
                          <div className={`flex justify-between text-sm ${itemFormData.multiplierOverride ? 'text-amber-700 font-medium' : ''}`}>
                            <span className={itemFormData.multiplierOverride ? '' : 'text-muted-foreground'}>
                              x Multiplicador ({(() => {
                                const mo = parseFloat(itemFormData.multiplierOverride)
                                return (!isNaN(mo) && mo > 0) ? formatNumber(mo) : formatNumber(quote.multiplier)
                              })()}x){itemFormData.multiplierOverride && ' ✏️'}:
                            </span>
                            <span className="font-mono">USD {formatNumber(pricePreview.unitPrice)}</span>
                          </div>
                          <div className="border-t-2 border-blue-300 pt-2 mt-1">
                            <div className="flex justify-between font-bold text-base text-blue-900">
                              <span>Total ({itemFormData.quantity} ud):</span>
                              <span className="font-mono">USD {formatNumber(pricePreview.totalPrice)}</span>
                            </div>
                            <p className="text-right text-xs text-muted-foreground font-mono mt-0.5">
                              ARS {formatNumber(pricePreview.totalPrice * Number(quote.exchangeRate))}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  )}

                  {/* Actions */}
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setShowItemDialog(false)
                        resetItemForm()
                      }}
                      disabled={itemFormLoading}
                    >
                      Cancelar
                    </Button>
                    <Button
                      onClick={handleSaveItem}
                      disabled={itemFormLoading || (!itemFormData.isManual && !itemFormData.productId)}
                      className={itemFormData.isManual ? 'bg-purple-600 hover:bg-purple-700' : 'bg-blue-600 hover:bg-blue-700'}
                    >
                      {itemFormLoading ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          {editingItemId ? 'Guardando...' : 'Agregando...'}
                        </>
                      ) : (
                        <>
                          {editingItemId ? (
                            <>
                              <Save className="mr-2 h-4 w-4" />
                              Guardar cambios
                            </>
                          ) : (
                            <>
                              <Plus className="mr-2 h-4 w-4" />
                              Agregar Item
                            </>
                          )}
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {quote.items.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No hay items en esta cotización</p>
              <p className="text-sm">Haga clic en &quot;Agregar Item&quot; para comenzar</p>
            </div>
          ) : (
            <div className="space-y-8">
              {Object.keys(groupedItems)
                .sort((a, b) => parseInt(a) - parseInt(b))
                .map((itemNumber) => {
                  const items = groupedItems[parseInt(itemNumber)]
                  const mainItem = items[0]
                  const alternatives = items.slice(1)

                  return (
                    <div key={itemNumber} className="border rounded-lg p-4">
                      {/* Main Item */}
                      <div className="space-y-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3 mb-2">
                              <span className="text-2xl font-bold text-blue-900 shrink-0">
                                {mainItem.itemNumber}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p
                                  className="font-semibold text-lg truncate"
                                  title={mainItem.product?.name || mainItem.description || 'Item manual'}
                                >
                                  {mainItem.product?.name || mainItem.description || 'Item manual'}
                                </p>
                                <p
                                  className="text-sm text-muted-foreground truncate"
                                  title={
                                    mainItem.product
                                      ? `SKU: ${mainItem.product.sku}${mainItem.product.brand ? ` | Marca: ${mainItem.product.brand}` : ''}`
                                      : `${mainItem.manualSku ? `Código: ${mainItem.manualSku}` : ''}${mainItem.manualBrand ? ` | Marca: ${mainItem.manualBrand}` : ''}`
                                  }
                                >
                                  {mainItem.product
                                    ? `SKU: ${mainItem.product.sku}${mainItem.product.brand ? ` | Marca: ${mainItem.product.brand}` : ''}`
                                    : `${mainItem.manualSku ? `Código: ${mainItem.manualSku}` : ''}${mainItem.manualBrand ? ` | Marca: ${mainItem.manualBrand}` : ''}`
                                  }
                                </p>
                                {!mainItem.product && (
                                  <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-medium">
                                    Item Manual
                                  </span>
                                )}
                                {mainItem.product && (
                                  <div className="mt-1">
                                    <StockBadge
                                      sku={mainItem.product.sku}
                                      stock={quoteStockData[mainItem.product.sku]?.stock}
                                      found={quoteStockData[mainItem.product.sku]?.found}
                                      loading={quoteStockLoading}
                                      showQuantity={true}
                                      size="sm"
                                    />
                                  </div>
                                )}
                              </div>
                            </div>

                            {mainItem.description &&
                              (!mainItem.product || mainItem.description !== mainItem.product.name) &&
                              !!mainItem.product && (
                                <p
                                  className="text-sm text-muted-foreground mb-2 truncate"
                                  title={mainItem.description}
                                >
                                  {mainItem.description}
                                </p>
                              )}

                            {/* Additionals */}
                            {mainItem.additionals.length > 0 && (
                              <div className="mt-2 ml-12 space-y-1">
                                <p className="text-xs font-medium text-muted-foreground">
                                  Adicionales:
                                </p>
                                {mainItem.additionals.map((add, idx) => (
                                  <p key={idx} className={`text-sm ${add.productId ? 'text-muted-foreground' : 'text-orange-600'}`}>
                                    + {add.product?.name || add.description || 'Adicional libre'} (USD{' '}
                                    {formatNumber(add.listPrice)})
                                  </p>
                                ))}
                              </div>
                            )}

                            {/* Stock Warning */}
                            {mainItem.product && quoteStockData[mainItem.product.sku]?.found &&
                              quoteStockData[mainItem.product.sku]?.stock !== undefined &&
                              mainItem.quantity > quoteStockData[mainItem.product.sku].stock && (
                                <div className="mt-2 ml-12">
                                  <StockWarning
                                    requested={mainItem.quantity}
                                    available={quoteStockData[mainItem.product.sku].stock}
                                  />
                                </div>
                              )}

                            {/* Price Breakdown */}
                            <div className="mt-3 ml-12 grid grid-cols-2 gap-2 text-sm">
                              <div>
                                <span className="text-muted-foreground">
                                  Cantidad:
                                </span>
                                <span className="ml-2 font-medium">
                                  {mainItem.quantity} {mainItem.product?.unit || 'UN'}
                                </span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">
                                  Precio Lista:
                                </span>
                                <span className="ml-2 font-mono">
                                  USD {formatNumber(mainItem.listPrice)}
                                </span>
                              </div>
                              {mainItem.brandDiscount > 0 && (
                                <div>
                                  <span className="text-muted-foreground">
                                    Desc. Marca:
                                  </span>
                                  <span className="ml-2 font-medium text-green-600">
                                    {(Number(mainItem.brandDiscount) * 100).toFixed(0)}%
                                  </span>
                                </div>
                              )}
                              <div>
                                <span className="text-muted-foreground">
                                  Multiplicador:
                                </span>
                                <span className={`ml-2 font-medium ${mainItem.multiplierOverride !== null ? 'text-amber-600' : ''}`}>
                                  {formatNumber(mainItem.customerMultiplier)}x
                                  {mainItem.multiplierOverride !== null && ' ✏️'}
                                </span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">
                                  Plazo:
                                </span>
                                <span className="ml-2 font-medium">
                                  {mainItem.deliveryTime || 'Inmediato'}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="text-right space-y-2 shrink-0 min-w-[160px]">
                            <div>
                              <p className="text-sm text-muted-foreground">
                                Precio Unitario
                              </p>
                              <p className="text-lg font-mono font-semibold text-blue-900">
                                USD {formatNumber(mainItem.unitPrice)}
                              </p>
                            </div>
                            <div>
                              <p className="text-sm text-muted-foreground">
                                Total
                              </p>
                              <p className="text-xl font-mono font-bold text-blue-900">
                                USD {formatNumber(mainItem.totalPrice)}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                ARS{' '}
                                {formatNumber(
                                  Number(mainItem.totalPrice) * Number(quote.exchangeRate)
                                )}
                              </p>
                            </div>
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleOpenEditDialog(mainItem)}
                                title="Editar item"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  handleOpenAlternativeDialog(mainItem.id)
                                }
                              >
                                + Alt
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleDeleteItem(mainItem.id)}
                              >
                                <Trash2 className="h-4 w-4 text-red-600" />
                              </Button>
                            </div>
                          </div>
                        </div>

                        {/* Alternatives */}
                        {alternatives.length > 0 && (
                          <div className="ml-12 mt-4 space-y-3 border-l-2 border-blue-200 pl-6">
                            <p className="text-sm font-medium text-blue-900">
                              Alternativas:
                            </p>
                            {alternatives.map((alt, altIdx) => (
                              <div
                                key={alt.id}
                                className="flex items-start justify-between gap-3 bg-blue-50 p-3 rounded-md"
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-bold text-blue-900 shrink-0">
                                      {mainItem.itemNumber}
                                      {String.fromCharCode(65 + altIdx)}
                                    </span>
                                    <p
                                      className="font-medium truncate"
                                      title={alt.product?.name || alt.description || 'Item manual'}
                                    >
                                      {alt.product?.name || alt.description || 'Item manual'}
                                    </p>
                                  </div>
                                  <p
                                    className="text-xs text-muted-foreground truncate"
                                    title={alt.product ? `SKU: ${alt.product.sku}` : alt.manualSku ? `Código: ${alt.manualSku}` : ''}
                                  >
                                    {alt.product ? `SKU: ${alt.product.sku}` : alt.manualSku ? `Código: ${alt.manualSku}` : ''}
                                  </p>
                                  {alt.product && (
                                    <div className="mt-1">
                                      <StockBadge
                                        sku={alt.product.sku}
                                        stock={quoteStockData[alt.product.sku]?.stock}
                                        found={quoteStockData[alt.product.sku]?.found}
                                        loading={quoteStockLoading}
                                        showQuantity={true}
                                        size="sm"
                                      />
                                    </div>
                                  )}
                                  {alt.product && quoteStockData[alt.product.sku]?.found &&
                                    quoteStockData[alt.product.sku]?.stock !== undefined &&
                                    alt.quantity > quoteStockData[alt.product.sku].stock && (
                                      <div className="mt-1">
                                        <StockWarning
                                          requested={alt.quantity}
                                          available={quoteStockData[alt.product.sku].stock}
                                        />
                                      </div>
                                    )}
                                </div>
                                <div className="text-right flex flex-col items-end gap-1 shrink-0">
                                  <p className="font-mono font-semibold">
                                    USD {formatNumber(alt.totalPrice)}
                                  </p>
                                  <div className="flex gap-1">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleOpenEditDialog(alt)}
                                      title="Editar alternativa"
                                    >
                                      <Pencil className="h-3 w-3" />
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => handleDeleteItem(alt.id)}
                                    >
                                      <Trash2 className="h-3 w-3 text-red-600" />
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              <div className="flex justify-end pt-4 border-t">
                <Button
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700"
                  onClick={() => {
                    resetItemForm()
                    setShowItemDialog(true)
                  }}
                  disabled={!isEditable}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Agregar Item
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Totals */}
      <Card className="border-blue-200 bg-gradient-to-r from-blue-50 to-white">
        <CardContent className="pt-6">
          <div className="space-y-2">
            <div className="flex justify-between text-lg">
              <span className="text-muted-foreground">Subtotal:</span>
              <span className="font-mono font-semibold">
                USD {formatNumber(quote.subtotal)}
              </span>
            </div>

            {/* Bonificación */}
            <div className="flex justify-between items-center text-base">
              <div className="flex items-center gap-2">
                <span className={Number(quote.bonification) > 0 ? 'text-green-700 font-medium' : 'text-muted-foreground'}>
                  Bonificación:
                </span>
                {showEditBonification ? (
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      step="0.5"
                      min="0"
                      max="100"
                      value={bonificationValue}
                      onChange={(e) => setBonificationValue(e.target.value)}
                      className="w-20 font-mono font-semibold h-8 text-sm"
                      disabled={bonificationLoading}
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                    <Button
                      size="sm"
                      className="h-8 bg-green-600 hover:bg-green-700"
                      onClick={() => handleBonificationChange(bonificationValue)}
                      disabled={bonificationLoading}
                    >
                      {bonificationLoading ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Save className="h-3 w-3" />
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8"
                      onClick={() => {
                        setShowEditBonification(false)
                        setBonificationValue(Number(quote.bonification || 0).toFixed(2))
                      }}
                      disabled={bonificationLoading}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <span className={`font-mono font-semibold ${Number(quote.bonification) > 0 ? 'text-green-700' : 'text-muted-foreground'}`}>
                      {Number(quote.bonification || 0).toFixed(2)}%
                    </span>
                    {isEditable && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        onClick={() => setShowEditBonification(true)}
                        title="Cambiar bonificación"
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {Number(quote.bonification) > 0 && (
                <span className="font-mono text-green-700 font-medium">
                  - USD {formatNumber(Number(quote.subtotal) * Number(quote.bonification) / 100)}
                </span>
              )}
            </div>

            <div className="flex justify-between text-2xl font-bold text-blue-900 border-t-2 pt-2">
              <span>Total:</span>
              <div className="text-right">
                <div className="font-mono">USD {formatNumber(quote.total)}</div>
                <div className="text-lg font-normal text-muted-foreground">
                  ARS {formatNumber(totalInARS)}
                </div>
              </div>
            </div>

            {/* IVA incluido (Factura B) */}
            <div className="flex justify-between items-center text-sm border-t pt-2 mt-2">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Modo IVA:</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    quote.pricesIncludeTax
                      ? 'bg-amber-100 text-amber-800 border border-amber-300'
                      : 'bg-blue-100 text-blue-800 border border-blue-300'
                  }`}
                >
                  {quote.pricesIncludeTax
                    ? 'IVA incluido (Factura B)'
                    : 'IVA aparte (Factura A)'}
                </span>
                {quote.customer.taxCondition &&
                  quote.customer.taxCondition !== 'RESPONSABLE_INSCRIPTO' &&
                  !quote.pricesIncludeTax && (
                    <span
                      className="text-xs text-red-600"
                      title="Cliente no RI: AFIP exige IVA incluido en Factura B"
                    >
                      ⚠ debería incluir IVA
                    </span>
                  )}
              </div>
              {isEditable && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleTogglePricesIncludeTax(!quote.pricesIncludeTax)}
                  disabled={pricesIncludeTaxLoading}
                  className="h-7 text-xs"
                >
                  {pricesIncludeTaxLoading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : quote.pricesIncludeTax ? (
                    'Quitar IVA incluido'
                  ) : (
                    'Incluir IVA en precios'
                  )}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Modal confirmación toggle pricesIncludeTax */}
      <Dialog
        open={!!showIvaConfirm}
        onOpenChange={(open) => !open && setShowIvaConfirm(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {showIvaConfirm?.target
                ? '¿Incluir IVA 21% en todos los precios?'
                : '¿Quitar IVA incluido de todos los precios?'}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 pt-2 text-sm">
                {showIvaConfirm?.target ? (
                  <>
                    <p>
                      Se van a <strong>multiplicar por 1.21</strong> los precios
                      unitarios y totales de todos los ítems (
                      {quote?.items.length ?? 0}). Esto se usa para clientes de
                      Factura B (Consumidor Final, Monotributo, Exento).
                    </p>
                    <p className="text-amber-700">
                      El total de la cotización va a <strong>aumentar ~21%</strong>.
                    </p>
                  </>
                ) : (
                  <>
                    <p>
                      Se van a <strong>dividir por 1.21</strong> los precios
                      unitarios y totales de todos los ítems (
                      {quote?.items.length ?? 0}). Úsalo solo para clientes
                      Responsable Inscripto (Factura A con IVA discriminado).
                    </p>
                    <p className="text-amber-700">
                      El total de la cotización va a <strong>bajar ~17%</strong>.
                    </p>
                  </>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="outline"
              onClick={() => setShowIvaConfirm(null)}
              disabled={pricesIncludeTaxLoading}
            >
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (showIvaConfirm) {
                  const target = showIvaConfirm.target
                  setShowIvaConfirm(null)
                  // Llamada directa al fetch; bypass del guardia de confirmación
                  ;(async () => {
                    try {
                      setPricesIncludeTaxLoading(true)
                      const res = await fetch(`/api/quotes/${quoteId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ pricesIncludeTax: target }),
                      })
                      if (!res.ok) throw new Error()
                      toast.success(
                        target
                          ? 'Precios ahora INCLUYEN IVA 21% (Factura B)'
                          : 'Precios ahora SIN IVA (Factura A)'
                      )
                      await fetchQuoteData()
                    } catch {
                      toast.error('Error al cambiar el modo de IVA')
                    } finally {
                      setPricesIncludeTaxLoading(false)
                    }
                  })()
                }
              }}
              disabled={pricesIncludeTaxLoading}
            >
              {pricesIncludeTaxLoading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Confirmar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Terms and Notes */}
      {(quote.terms || quote.notes) && (
        <div className="grid gap-6 md:grid-cols-2">
          {quote.terms && (
            <Card className="border-blue-200">
              <CardHeader>
                <CardTitle className="text-blue-900">
                  Condiciones de Pago
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{quote.terms}</p>
              </CardContent>
            </Card>
          )}
          {quote.notes && (
            <Card className="border-blue-200">
              <CardHeader>
                <CardTitle className="text-blue-900">Notas Internas</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{quote.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Historial de cambios */}
      <Card className="border-blue-200">
        <CardHeader>
          <CardTitle className="text-blue-900 flex items-center gap-2">
            <History className="h-5 w-5" />
            Historial de cambios
          </CardTitle>
        </CardHeader>
        <CardContent>
          {auditLogsLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : auditLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin cambios registrados</p>
          ) : (
            <div className="space-y-3">
              {auditLogs.map((log) => (
                <div key={log.id} className="flex gap-3 border-b border-gray-100 pb-3 last:border-0 last:pb-0">
                  <div className="flex-shrink-0 mt-0.5">
                    <div className="h-2 w-2 rounded-full bg-blue-400 mt-1.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-sm font-medium">{log.usuario.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(log.createdAt).toLocaleDateString('es-AR', {
                          day: '2-digit', month: '2-digit', year: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700">
                      {log.accion === 'REASIGNAR_VENDEDOR' && log.valorAnterior && log.valorNuevo
                        ? `Reasignó el vendedor de ${(log.valorAnterior as { nombre: string }).nombre} a ${(log.valorNuevo as { nombre: string }).nombre}`
                        : log.accion}
                    </p>
                    {log.motivo && (
                      <p className="text-sm italic text-muted-foreground mt-0.5">
                        {log.motivo}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal Reasignar Vendedor */}
      <Dialog open={showReasignarModal} onOpenChange={setShowReasignarModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reasignar vendedor</DialogTitle>
            <DialogDescription>
              Cotización {quote.quoteNumber}. Vendedor actual: {quote.salesPerson.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {(['ACCEPTED', 'REJECTED', 'CONVERTED', 'FACTURADA_PARCIAL'].includes(quote.status)) && (
              <Alert variant="destructive" className="border-amber-300 bg-amber-50 text-amber-900 [&>svg]:text-amber-600">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Esta cotización está cerrada. El motivo es obligatorio.
                </AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label>Nuevo vendedor</Label>
              <Select value={nuevoVendedorId} onValueChange={setNuevoVendedorId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar vendedor..." />
                </SelectTrigger>
                <SelectContent>
                  {vendedores
                    .filter((v) => v.id !== quote.salesPersonId)
                    .map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name} ({v.email})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>
                Motivo del cambio
                {['ACCEPTED', 'REJECTED', 'CONVERTED', 'FACTURADA_PARCIAL'].includes(quote.status) && (
                  <span className="text-red-500 ml-1">*</span>
                )}
              </Label>
              <Textarea
                value={reasignarMotivo}
                onChange={(e) => setReasignarMotivo(e.target.value)}
                placeholder="Ej: error al crear la cotización, reasignación de cuenta…"
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowReasignarModal(false)}
                disabled={reasignarLoading}
              >
                Cancelar
              </Button>
              <Button
                onClick={handleReasignarVendedor}
                disabled={
                  reasignarLoading ||
                  !nuevoVendedorId ||
                  (['ACCEPTED', 'REJECTED', 'CONVERTED', 'FACTURADA_PARCIAL'].includes(quote.status) && !reasignarMotivo.trim())
                }
                className="bg-[#1B365D] hover:bg-[#152a4a]"
              >
                {reasignarLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Reasignar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <CertificadosDialog
        open={showCertificados}
        onOpenChange={setShowCertificados}
        quoteId={quote.id}
        customerName={quote.customer.businessName || quote.customer.name}
        items={quote.items
          .filter((item) => !item.isAlternative)
          .map((item) => ({
            id: item.id,
            itemNumber: item.itemNumber,
            description: item.description || item.product?.name || '',
            quantity: item.quantity,
          }))}
      />
    </div>
  )
}
