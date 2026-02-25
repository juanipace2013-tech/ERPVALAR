'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
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
} from 'lucide-react'
import { toast } from 'sonner'
import { formatNumber } from '@/lib/utils'
import { useColppyStock, refreshInventoryCache } from '@/hooks/useColppyStock'
import { StockBadge, StockWarning } from '@/components/StockBadge'

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
  productId: string
  product?: Product
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
  subtotal: number
  total: number
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
    productId: string
    listPrice: number
  }>
  // Manual item fields
  isManual: boolean
  manualSku: string
  manualBrand: string
  manualUnitPrice: string
}

export default function QuoteDetailPage() {
  const router = useRouter()
  const params = useParams()
  const quoteId = params.id as string

  const [loading, setLoading] = useState(true)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [brandDiscounts, setBrandDiscounts] = useState<BrandDiscount[]>([])

  // Item form state
  const [showItemDialog, setShowItemDialog] = useState(false)
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

  // Product search
  const [productSearch, setProductSearch] = useState('')
  const [refreshingStock, setRefreshingStock] = useState(false)
  const [searchResults, setSearchResults] = useState<typeof products>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)

  // Stock data hook - consultar stock de productos filtrados
  const filteredProductSkus = searchResults.map((p) => p.sku)

  const { stockData, loading: stockLoading } = useColppyStock(
    filteredProductSkus,
    searchResults.length > 0 && showItemDialog
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
    fetchQuoteData()
    fetchBrandDiscounts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteId])

  useEffect(() => {
    calculatePricePreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemFormData.productId, itemFormData.quantity, itemFormData.additionals, quote?.multiplier])

  // Búsqueda de productos con debounce (300ms)
  useEffect(() => {
    if (productSearch.length >= 2) {
      const timeoutId = setTimeout(() => {
        searchProducts(productSearch)
      }, 300)
      return () => clearTimeout(timeoutId)
    } else {
      setSearchResults([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productSearch])

  const fetchQuoteData = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/quotes/${quoteId}`)
      if (!response.ok) {
        throw new Error('Error al cargar cotización')
      }
      const data = await response.json()
      setQuote(data)
      setMultiplierValue(Number(data.multiplier).toFixed(2))
      setExchangeRateValue(Number(data.exchangeRate).toFixed(2))
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar la cotización')
      router.push('/cotizaciones')
    } finally {
      setLoading(false)
    }
  }

  const searchProducts = async (query: string) => {
    try {
      setSearchLoading(true)
      const params = new URLSearchParams({
        search: query,
        limit: '20',
        status: 'ACTIVE',
      })
      const response = await fetch(`/api/productos?${params.toString()}`)
      if (response.ok) {
        const data = await response.json()
        setSearchResults(data.products || [])
      } else {
        setSearchResults([])
      }
    } catch (error) {
      console.error('Error buscando productos:', error)
      setSearchResults([])
    } finally {
      setSearchLoading(false)
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

    // Obtener descuento de marca
    let brandDiscountPercent = 0
    if (selectedProduct.brand) {
      const discount = brandDiscounts.find((d) => d.brand === selectedProduct.brand)
      if (discount) {
        brandDiscountPercent = Number(discount.discountPercent) / 100
      }
    }

    // Aplicar fórmula VAL ARG
    const afterDiscount = subtotalWithAdditionals * (1 - brandDiscountPercent)
    const customerMultiplier = Number(quote.multiplier)
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
          }
        : {
            productId: itemFormData.productId,
            quantity: itemFormData.quantity,
            description: itemFormData.description || selectedProduct?.name,
            deliveryTime: itemFormData.deliveryTime,
            isAlternative: itemFormData.isAlternative,
            alternativeToItemId: itemFormData.alternativeToItemId,
            additionals: itemFormData.additionals.map((add) => ({
              productId: add.productId,
              listPrice: add.listPrice,
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
      })),
      isManual,
      manualSku: item.manualSku || '',
      manualBrand: item.manualBrand || '',
      manualUnitPrice: isManual ? String(Number(item.unitPrice).toFixed(2)) : '',
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

      const payload = itemFormData.isManual
        ? {
            isManual: true,
            manualSku: itemFormData.manualSku || null,
            manualBrand: itemFormData.manualBrand || null,
            description: itemFormData.description,
            manualUnitPrice: parseFloat(itemFormData.manualUnitPrice),
            quantity: itemFormData.quantity,
            deliveryTime: itemFormData.deliveryTime,
          }
        : {
            productId: itemFormData.productId,
            quantity: itemFormData.quantity,
            description: itemFormData.description || selectedProduct?.name,
            deliveryTime: itemFormData.deliveryTime,
            additionals: itemFormData.additionals.map((add) => ({
              productId: add.productId,
              listPrice: add.listPrice,
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

  const handleUpdateAdditional = (index: number, productId: string) => {
    const product = products.find((p) => p.id === productId)
    const listPrice = product?.listPriceUSD ? Number(product.listPriceUSD) : 0

    const newAdditionals = [...itemFormData.additionals]
    newAdditionals[index] = { productId, listPrice }

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
    })
    setProductSearch('')
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
            onClick={() => router.push('/cotizaciones')}
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
            onClick={async () => {
              try {
                const response = await fetch(`/api/cotizaciones/${quote.id}/pdf`)
                if (!response.ok) throw new Error('Error al generar PDF')

                const blob = await response.blob()
                const url = window.URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `Cotizacion-${quote.quoteNumber}.pdf`
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
              <p className="font-medium">{quote.salesPerson.name}</p>
              <p className="text-sm text-muted-foreground">
                {quote.salesPerson.email}
              </p>
            </div>
            <div>
              <Label className="text-muted-foreground">Fecha</Label>
              <p className="font-medium">
                {new Date(quote.date).toLocaleDateString('es-AR')}
              </p>
              {quote.validUntil && (
                <p className="text-sm text-muted-foreground">
                  Válida hasta:{' '}
                  {new Date(quote.validUntil).toLocaleDateString('es-AR')}
                </p>
              )}
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
                  {quote.status === 'DRAFT' && (
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
                  {quote.status === 'DRAFT' && (
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
                    } ${quote.status !== 'DRAFT' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    onClick={() => {
                      if (quote.status === 'DRAFT') {
                        handleMultiplierChange(val.toFixed(2))
                      }
                    }}
                    disabled={quote.status !== 'DRAFT' || multiplierLoading}
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
              <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>
                    {editingItemId
                      ? 'Editar Item'
                      : itemFormData.isAlternative
                        ? 'Agregar Alternativa'
                        : 'Agregar Item'}
                  </DialogTitle>
                  <DialogDescription>
                    {itemFormData.isManual
                      ? 'Item sin producto en catálogo. El precio ingresado es el precio final (sin multiplicador).'
                      : editingItemId
                        ? 'Modifique los datos del item. El precio se recalculará automáticamente.'
                        : 'Complete los datos del item. El precio se calcula automáticamente.'}
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-6">
                  {/* Mode toggle */}
                  {!itemFormData.isAlternative && (
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
                  )}

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
                      </div>
                      {itemFormData.manualUnitPrice && parseFloat(itemFormData.manualUnitPrice) > 0 && (() => {
                        const listP = parseFloat(itemFormData.manualUnitPrice)
                        const mult = Number(quote.multiplier) || 1
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

                  {/* ── CATALOG SEARCH ── */}
                  {!itemFormData.isManual && (<>
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
                      className="mb-2"
                    />
                    <div className="max-h-48 overflow-y-auto border rounded-md">
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
                            setItemFormData({
                              ...itemFormData,
                              productId: product.id,
                              description: product.name,
                            })
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

                  {/* Selected Product */}
                  {itemFormData.productId && selectedProduct && (
                    <div className="p-4 bg-blue-50 rounded-md">
                      <Label className="text-blue-900">Producto Seleccionado</Label>
                      <p className="font-medium">
                        {selectedProduct.name}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        SKU: {selectedProduct.sku} | USD {formatNumber(selectedProduct.listPriceUSD || 0)}
                      </p>
                    </div>
                  )}

                  {/* Quantity */}
                  <div className="grid gap-4 md:grid-cols-2">
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

                  {/* Delivery Time */}
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

                  {/* Additionals */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Adicionales (Máx. 5)</Label>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={handleAddAdditional}
                        disabled={itemFormData.additionals.length >= 5}
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        Agregar
                      </Button>
                    </div>
                    {itemFormData.additionals.map((additional, index) => (
                      <div key={index} className="flex gap-2 items-center">
                        <Select
                          value={additional.productId}
                          onValueChange={(value) =>
                            handleUpdateAdditional(index, value)
                          }
                        >
                          <SelectTrigger className="flex-1">
                            <SelectValue placeholder="Seleccionar adicional..." />
                          </SelectTrigger>
                          <SelectContent>
                            {products.map((product) => (
                              <SelectItem key={product.id} value={product.id}>
                                {product.name} - USD{' '}
                                {product.listPriceUSD ? formatNumber(product.listPriceUSD) : '0,00'}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() => handleRemoveAdditional(index)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>

                  {/* Price Preview */}
                  {itemFormData.productId && (
                    <Card className="bg-gradient-to-r from-blue-50 to-blue-100 border-blue-200">
                      <CardHeader>
                        <CardTitle className="text-lg text-blue-900 flex items-center gap-2">
                          <Calculator className="h-5 w-5" />
                          Cálculo de Precio
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span>Precio Lista:</span>
                          <span className="font-mono">
                            USD {formatNumber(pricePreview.listPrice)}
                          </span>
                        </div>
                        {pricePreview.additionalsTotal > 0 && (
                          <div className="flex justify-between text-sm">
                            <span>+ Adicionales:</span>
                            <span className="font-mono">
                              USD {formatNumber(pricePreview.additionalsTotal)}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between text-sm font-medium">
                          <span>Subtotal:</span>
                          <span className="font-mono">
                            USD {formatNumber(pricePreview.subtotalWithAdditionals)}
                          </span>
                        </div>
                        {pricePreview.brandDiscount > 0 && (
                          <div className="flex justify-between text-sm text-green-600">
                            <span>- Descuento Marca ({pricePreview.brandDiscount}%):</span>
                            <span className="font-mono">
                              USD{' '}
                              {formatNumber(
                                pricePreview.subtotalWithAdditionals -
                                pricePreview.afterDiscount
                              )}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between text-sm">
                          <span>× Multiplicador ({formatNumber(quote.multiplier)}x):</span>
                          <span className="font-mono">
                            USD {formatNumber(pricePreview.unitPrice)}
                          </span>
                        </div>
                        <div className="border-t-2 border-blue-300 pt-2 mt-2">
                          <div className="flex justify-between font-bold text-lg text-blue-900">
                            <span>Precio Total ({itemFormData.quantity} ud):</span>
                            <div className="text-right">
                              <div className="font-mono">
                                USD {formatNumber(pricePreview.totalPrice)}
                              </div>
                              <div className="text-sm font-normal text-muted-foreground">
                                ARS{' '}
                                {formatNumber(
                                  pricePreview.totalPrice * Number(quote.exchangeRate)
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                  </>)}

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
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <span className="text-2xl font-bold text-blue-900">
                                {mainItem.itemNumber}
                              </span>
                              <div>
                                <p className="font-semibold text-lg">
                                  {mainItem.product?.name || mainItem.description || 'Item manual'}
                                </p>
                                <p className="text-sm text-muted-foreground">
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
                                <p className="text-sm text-muted-foreground mb-2">
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
                                  <p key={idx} className="text-sm text-muted-foreground">
                                    + {add.product?.name} (USD{' '}
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
                                <span className="ml-2 font-medium">
                                  {formatNumber(mainItem.customerMultiplier)}x
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

                          <div className="text-right space-y-2">
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
                                className="flex items-start justify-between bg-blue-50 p-3 rounded-md"
                              >
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-bold text-blue-900">
                                      {mainItem.itemNumber}
                                      {String.fromCharCode(65 + altIdx)}
                                    </span>
                                    <p className="font-medium">{alt.product?.name || alt.description || 'Item manual'}</p>
                                  </div>
                                  <p className="text-xs text-muted-foreground">
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
                                <div className="text-right">
                                  <p className="font-mono font-semibold">
                                    USD {formatNumber(alt.totalPrice)}
                                  </p>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleDeleteItem(alt.id)}
                                  >
                                    <Trash2 className="h-3 w-3 text-red-600" />
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
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
            <div className="flex justify-between text-2xl font-bold text-blue-900 border-t-2 pt-2">
              <span>Total:</span>
              <div className="text-right">
                <div className="font-mono">USD {formatNumber(quote.total)}</div>
                <div className="text-lg font-normal text-muted-foreground">
                  ARS {formatNumber(totalInARS)}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

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
    </div>
  )
}
