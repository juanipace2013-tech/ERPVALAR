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
} from 'lucide-react'
import { toast } from 'sonner'

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
  productId: string
  product: Product
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
  })
  const [itemFormLoading, setItemFormLoading] = useState(false)

  // Product search
  const [productSearch, setProductSearch] = useState('')

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
    fetchProducts()
    fetchBrandDiscounts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteId])

  useEffect(() => {
    calculatePricePreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemFormData.productId, itemFormData.quantity, itemFormData.additionals])

  const fetchQuoteData = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/quotes/${quoteId}`)
      if (!response.ok) {
        throw new Error('Error al cargar cotización')
      }
      const data = await response.json()
      setQuote(data)
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar la cotización')
      router.push('/cotizaciones')
    } finally {
      setLoading(false)
    }
  }

  const fetchProducts = async () => {
    try {
      const response = await fetch('/api/productos?limit=1000')
      if (response.ok) {
        const data = await response.json()
        setProducts(data.products || [])
      }
    } catch (error) {
      console.error('Error cargando productos:', error)
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

    const product = products.find((p) => p.id === itemFormData.productId)
    if (!product) return

    const listPrice = Number(product.listPriceUSD || 0)

    // Sumar adicionales
    let additionalsTotal = 0
    for (const add of itemFormData.additionals) {
      const addProduct = products.find((p) => p.id === add.productId)
      if (addProduct && addProduct.listPriceUSD) {
        additionalsTotal += Number(addProduct.listPriceUSD)
      }
    }

    const subtotalWithAdditionals = listPrice + additionalsTotal

    // Obtener descuento de marca
    let brandDiscountPercent = 0
    if (product.brand) {
      const discount = brandDiscounts.find((d) => d.brand === product.brand)
      if (discount) {
        brandDiscountPercent = Number(discount.discountPercent) / 100
      }
    }

    // Aplicar fórmula VAL ARG
    const afterDiscount = subtotalWithAdditionals * (1 - brandDiscountPercent)
    const customerMultiplier = Number(quote.customer.priceMultiplier)
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
    if (!itemFormData.productId) {
      toast.error('Debe seleccionar un producto')
      return
    }

    try {
      setItemFormLoading(true)

      const product = products.find((p) => p.id === itemFormData.productId)
      if (!product) {
        throw new Error('Producto no encontrado')
      }

      const payload = {
        productId: itemFormData.productId,
        quantity: itemFormData.quantity,
        description: itemFormData.description || product.name,
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
    setItemFormData({
      productId: item.productId,
      quantity: item.quantity,
      description: item.description || '',
      deliveryTime: item.deliveryTime || 'Inmediato',
      isAlternative: item.isAlternative,
      alternativeToItemId: item.alternativeToItemId,
      additionals: item.additionals.map(add => ({
        productId: add.productId,
        listPrice: Number(add.listPrice),
      })),
    })
    setShowItemDialog(true)
  }

  const handleSaveItem = async () => {
    if (!itemFormData.productId) {
      toast.error('Debe seleccionar un producto')
      return
    }

    // Si estamos editando, llamar a handleEditItem
    if (editingItemId) {
      return handleEditItem()
    }

    // Si no, es agregar nuevo item
    return handleAddItem()
  }

  const handleEditItem = async () => {
    if (!editingItemId) return

    try {
      setItemFormLoading(true)

      const product = products.find((p) => p.id === itemFormData.productId)
      if (!product) {
        throw new Error('Producto no encontrado')
      }

      const payload = {
        productId: itemFormData.productId,
        quantity: itemFormData.quantity,
        description: itemFormData.description || product.name,
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
    setItemFormData({
      productId: '',
      quantity: 1,
      description: '',
      deliveryTime: 'Inmediato',
      isAlternative: false,
      alternativeToItemId: null,
      additionals: [],
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

  const filteredProducts = products.filter(
    (p) =>
      p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
      p.sku.toLowerCase().includes(productSearch.toLowerCase()) ||
      (p.brand && p.brand.toLowerCase().includes(productSearch.toLowerCase()))
  )

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
              <p className="text-sm text-muted-foreground">
                Multiplicador: {quote.customer.priceMultiplier}x
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
              <p className="font-medium font-mono">
                USD 1 = ARS {Number(quote.exchangeRate).toFixed(2)}
              </p>
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
                    {editingItemId
                      ? 'Modifique los datos del item. El precio se recalculará automáticamente.'
                      : 'Complete los datos del item. El precio se calcula automáticamente.'}
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-6">
                  {/* Product Search */}
                  <div className="space-y-2">
                    <Label>Buscar Producto</Label>
                    <Input
                      placeholder="Buscar por SKU, nombre o marca..."
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      className="mb-2"
                    />
                    <div className="max-h-48 overflow-y-auto border rounded-md">
                      {filteredProducts.slice(0, 20).map((product) => (
                        <div
                          key={product.id}
                          className={`p-3 cursor-pointer hover:bg-blue-50 border-b last:border-b-0 ${
                            itemFormData.productId === product.id
                              ? 'bg-blue-100'
                              : ''
                          }`}
                          onClick={() => {
                            setItemFormData({
                              ...itemFormData,
                              productId: product.id,
                              description: product.name,
                            })
                            setProductSearch('')
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium">{product.name}</p>
                              <p className="text-sm text-muted-foreground">
                                SKU: {product.sku}
                                {product.brand && ` | Marca: ${product.brand}`}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="font-mono font-semibold">
                                USD {product.listPriceUSD ? Number(product.listPriceUSD).toFixed(2) : '0.00'}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Selected Product */}
                  {itemFormData.productId && (
                    <div className="p-4 bg-blue-50 rounded-md">
                      <Label className="text-blue-900">Producto Seleccionado</Label>
                      <p className="font-medium">
                        {
                          products.find((p) => p.id === itemFormData.productId)
                            ?.name
                        }
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
                                {product.listPriceUSD ? Number(product.listPriceUSD).toFixed(2) : '0.00'}
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
                            USD {pricePreview.listPrice.toFixed(2)}
                          </span>
                        </div>
                        {pricePreview.additionalsTotal > 0 && (
                          <div className="flex justify-between text-sm">
                            <span>+ Adicionales:</span>
                            <span className="font-mono">
                              USD {pricePreview.additionalsTotal.toFixed(2)}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between text-sm font-medium">
                          <span>Subtotal:</span>
                          <span className="font-mono">
                            USD {pricePreview.subtotalWithAdditionals.toFixed(2)}
                          </span>
                        </div>
                        {pricePreview.brandDiscount > 0 && (
                          <div className="flex justify-between text-sm text-green-600">
                            <span>- Descuento Marca ({pricePreview.brandDiscount}%):</span>
                            <span className="font-mono">
                              USD{' '}
                              {(
                                pricePreview.subtotalWithAdditionals -
                                pricePreview.afterDiscount
                              ).toFixed(2)}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between text-sm">
                          <span>× Multiplicador Cliente ({quote.customer.priceMultiplier}x):</span>
                          <span className="font-mono">
                            USD {pricePreview.unitPrice.toFixed(2)}
                          </span>
                        </div>
                        <div className="border-t-2 border-blue-300 pt-2 mt-2">
                          <div className="flex justify-between font-bold text-lg text-blue-900">
                            <span>Precio Total ({itemFormData.quantity} ud):</span>
                            <div className="text-right">
                              <div className="font-mono">
                                USD {pricePreview.totalPrice.toFixed(2)}
                              </div>
                              <div className="text-sm font-normal text-muted-foreground">
                                ARS{' '}
                                {(pricePreview.totalPrice * Number(quote.exchangeRate)).toFixed(
                                  2
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
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
                      disabled={!itemFormData.productId || itemFormLoading}
                      className="bg-blue-600 hover:bg-blue-700"
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
                                  {mainItem.product.name}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  SKU: {mainItem.product.sku}
                                  {mainItem.product.brand &&
                                    ` | Marca: ${mainItem.product.brand}`}
                                </p>
                              </div>
                            </div>

                            {mainItem.description &&
                              mainItem.description !== mainItem.product.name && (
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
                                    {Number(add.listPrice).toFixed(2)})
                                  </p>
                                ))}
                              </div>
                            )}

                            {/* Price Breakdown */}
                            <div className="mt-3 ml-12 grid grid-cols-2 gap-2 text-sm">
                              <div>
                                <span className="text-muted-foreground">
                                  Cantidad:
                                </span>
                                <span className="ml-2 font-medium">
                                  {mainItem.quantity} {mainItem.product.unit}
                                </span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">
                                  Precio Lista:
                                </span>
                                <span className="ml-2 font-mono">
                                  USD {Number(mainItem.listPrice).toFixed(2)}
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
                                  {Number(mainItem.customerMultiplier).toFixed(2)}x
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
                                USD {Number(mainItem.unitPrice).toFixed(2)}
                              </p>
                            </div>
                            <div>
                              <p className="text-sm text-muted-foreground">
                                Total
                              </p>
                              <p className="text-xl font-mono font-bold text-blue-900">
                                USD {Number(mainItem.totalPrice).toFixed(2)}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                ARS{' '}
                                {(
                                  Number(mainItem.totalPrice) * Number(quote.exchangeRate)
                                ).toFixed(2)}
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
                                    <p className="font-medium">{alt.product.name}</p>
                                  </div>
                                  <p className="text-xs text-muted-foreground">
                                    SKU: {alt.product.sku}
                                  </p>
                                </div>
                                <div className="text-right">
                                  <p className="font-mono font-semibold">
                                    USD {Number(alt.totalPrice).toFixed(2)}
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
                USD {Number(quote.subtotal).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-2xl font-bold text-blue-900 border-t-2 pt-2">
              <span>Total:</span>
              <div className="text-right">
                <div className="font-mono">USD {Number(quote.total).toFixed(2)}</div>
                <div className="text-lg font-normal text-muted-foreground">
                  ARS {totalInARS.toFixed(2)}
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
