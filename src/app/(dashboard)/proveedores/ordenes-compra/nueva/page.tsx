'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, ArrowLeft, Plus, Trash2, Save, X } from 'lucide-react'
import { toast } from 'sonner'
import { getLocalDateString } from '@/lib/utils'

interface Supplier {
  id: string
  name: string
  taxId: string | null
}

interface Product {
  id: string
  name: string
  sku: string | null
  lastCost: number | null
  averageCost: number | null
}

interface OrderItem {
  productId: string
  productName: string
  quantity: number
  unitCost: number
  discount: number
  taxRate: number
  subtotal: number
}

// Selector de producto con búsqueda debounced + opción de item manual.
// Reemplaza el <Select> que renderizaba el catálogo entero (miles de items).
function ProductPicker({
  productId,
  productName,
  onSelect,
  onManual,
  onClear,
}: {
  productId: string
  productName: string
  onSelect: (product: Product) => void
  onManual: (name: string) => void
  onClear: () => void
}) {
  const [searchTerm, setSearchTerm] = useState('')
  const [results, setResults] = useState<Product[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Búsqueda debounced contra el endpoint (limit 20, solo activos)
  useEffect(() => {
    const trimmed = searchTerm.trim()
    if (trimmed.length < 2) {
      setResults([])
      return
    }
    const timeout = setTimeout(async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ search: trimmed, limit: '20', status: 'ACTIVE' })
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
  }, [searchTerm])

  // Cerrar el dropdown al hacer click afuera
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Estado seleccionado: producto del catálogo o item manual
  if (productId || productName) {
    const isManual = !productId
    return (
      <div className="flex items-center gap-1 min-w-0">
        <span
          className={`text-xs truncate flex-1 px-1.5 py-1 rounded ${
            isManual ? 'text-amber-700 bg-amber-50' : 'text-green-700 bg-green-50'
          }`}
          title={productName}
        >
          {isManual && '✎ '}
          {productName}
        </span>
        <button
          type="button"
          onClick={onClear}
          className="flex-shrink-0 text-gray-400 hover:text-red-500 p-0.5"
          title="Cambiar producto"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    )
  }

  const trimmed = searchTerm.trim()
  return (
    <div ref={containerRef} className="relative">
      <Input
        className="h-9 text-sm"
        placeholder="Buscar producto..."
        value={searchTerm}
        onChange={(e) => {
          setSearchTerm(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false)
            setSearchTerm('')
          }
        }}
      />
      {open && trimmed.length >= 2 && (
        <div className="absolute z-50 top-full left-0 w-80 mt-1 bg-white border rounded-md shadow-lg max-h-60 overflow-y-auto">
          {loading && results.length === 0 && (
            <div className="px-3 py-2 text-xs text-gray-500 flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Buscando...
            </div>
          )}
          {results.map((p) => (
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
              {p.sku && (
                <span className="font-mono font-semibold text-blue-700 whitespace-nowrap">
                  {p.sku}
                </span>
              )}
              <span className="text-gray-600 truncate">{p.name}</span>
            </button>
          ))}
          {!loading && results.length === 0 && (
            <div className="px-3 py-2 text-xs text-gray-400">Sin resultados en el catálogo</div>
          )}
          {/* Opción de item manual */}
          <button
            type="button"
            className="w-full text-left px-2 py-2 text-xs hover:bg-amber-50 border-t bg-gray-50 flex items-center gap-1.5 text-amber-700 font-medium"
            onClick={() => {
              onManual(trimmed)
              setSearchTerm('')
              setOpen(false)
              setResults([])
            }}
          >
            <Plus className="h-3 w-3" />
            Usar “{trimmed}” como item manual
          </button>
        </div>
      )}
    </div>
  )
}

export default function NewPurchaseOrderPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])

  // Form data
  const [supplierId, setSupplierId] = useState('')
  const [orderDate, setOrderDate] = useState(getLocalDateString())
  const [expectedDate, setExpectedDate] = useState('')
  const [currency, setCurrency] = useState('ARS')
  const [notes, setNotes] = useState('')
  const [status, setStatus] = useState('DRAFT')
  const [items, setItems] = useState<OrderItem[]>([])

  useEffect(() => {
    fetchSuppliers()
  }, [])

  const fetchSuppliers = async () => {
    try {
      const response = await fetch('/api/proveedores?limit=1000')
      if (response.ok) {
        const data = await response.json()
        setSuppliers(data.suppliers || [])
      }
    } catch (error) {
      console.error('Error loading suppliers:', error)
      setSuppliers([])
    }
  }

  const addItem = () => {
    setItems([
      ...items,
      {
        productId: '',
        productName: '',
        quantity: 1,
        unitCost: 0,
        discount: 0,
        taxRate: 21,
        subtotal: 0,
      },
    ])
  }

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index))
  }

  const updateItem = (index: number, field: keyof OrderItem, value: any) => {
    const newItems = [...items]
    newItems[index] = { ...newItems[index], [field]: value }

    // Recalculate subtotal
    const item = newItems[index]
    item.subtotal = item.quantity * item.unitCost

    setItems(newItems)
  }

  // Seleccionar un producto del catálogo: completa nombre y costo
  const selectProduct = (index: number, product: Product) => {
    const newItems = [...items]
    newItems[index] = {
      ...newItems[index],
      productId: product.id,
      productName: product.name,
      unitCost: Number(product.lastCost ?? product.averageCost) || 0,
    }
    newItems[index].subtotal = newItems[index].quantity * newItems[index].unitCost
    setItems(newItems)
  }

  // Cargar un item manual: nombre libre, sin producto del catálogo
  const setManualProduct = (index: number, name: string) => {
    const newItems = [...items]
    newItems[index] = { ...newItems[index], productId: '', productName: name }
    setItems(newItems)
  }

  // Limpiar la selección para volver a buscar
  const clearProduct = (index: number) => {
    const newItems = [...items]
    newItems[index] = { ...newItems[index], productId: '', productName: '' }
    setItems(newItems)
  }

  const calculateSubtotal = () => {
    return items.reduce((sum, item) => sum + item.subtotal, 0)
  }

  const calculateTaxAmount = () => {
    return items.reduce((sum, item) => {
      const itemNet = item.subtotal * (1 - item.discount / 100)
      return sum + itemNet * (item.taxRate / 100)
    }, 0)
  }

  const calculateTotal = () => {
    return calculateSubtotal() + calculateTaxAmount()
  }

  const formatCurrency = (amount: number) => {
    return `$${Number(amount).toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`
  }

  const handleSubmit = async () => {
    // Validations
    if (!supplierId) {
      toast.error('Debe seleccionar un proveedor')
      return
    }

    if (items.length === 0) {
      toast.error('Debe agregar al menos un item')
      return
    }

    const invalidItems = items.filter(
      (item) =>
        (!item.productId && !item.productName.trim()) ||
        item.quantity <= 0 ||
        item.unitCost <= 0
    )
    if (invalidItems.length > 0) {
      toast.error('Todos los items deben tener producto (o nombre manual), cantidad y precio válidos')
      return
    }

    try {
      setLoading(true)

      const response = await fetch('/api/purchase-orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          supplierId,
          orderDate,
          expectedDate: expectedDate || null,
          currency,
          notes,
          status,
          items: items.map((item) => ({
            productId: item.productId || null,
            description: item.productName,
            quantity: item.quantity,
            unitCost: item.unitCost,
            discount: item.discount,
            taxRate: item.taxRate,
          })),
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error al crear orden de compra')
      }

      const data = await response.json()
      toast.success('Orden de compra creada correctamente')
      router.push(`/proveedores/ordenes-compra/${data.id}`)
    } catch (error: any) {
      console.error('Error:', error)
      toast.error(error.message || 'Error al crear orden de compra')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button variant="outline" asChild>
          <Link href="/proveedores/ordenes-compra">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Volver
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Nueva Orden de Compra</h1>
          <p className="text-gray-600 mt-1">
            Complete los datos para crear una nueva orden de compra
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Form */}
        <div className="lg:col-span-2 space-y-6">
          {/* Supplier and Dates */}
          <Card>
            <CardHeader>
              <CardTitle>Información General</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="supplier">Proveedor *</Label>
                  <Select value={supplierId} onValueChange={setSupplierId}>
                    <SelectTrigger id="supplier">
                      <SelectValue placeholder="Seleccionar proveedor" />
                    </SelectTrigger>
                    <SelectContent>
                      {suppliers.map((supplier) => (
                        <SelectItem key={supplier.id} value={supplier.id}>
                          {supplier.name} {supplier.taxId && `(${supplier.taxId})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="orderDate">Fecha de Orden *</Label>
                  <Input
                    id="orderDate"
                    type="date"
                    value={orderDate}
                    onChange={(e) => setOrderDate(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="expectedDate">Fecha Esperada de Entrega</Label>
                  <Input
                    id="expectedDate"
                    type="date"
                    value={expectedDate}
                    onChange={(e) => setExpectedDate(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="currency">Moneda</Label>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger id="currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ARS">ARS - Pesos</SelectItem>
                      <SelectItem value="USD">USD - Dólares</SelectItem>
                      <SelectItem value="EUR">EUR - Euros</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="status">Estado</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger id="status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DRAFT">Borrador</SelectItem>
                      <SelectItem value="PENDING">Pendiente</SelectItem>
                      <SelectItem value="APPROVED">Aprobada</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notas</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Notas adicionales sobre esta orden..."
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>

          {/* Items */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Items de la Orden</CardTitle>
                <Button onClick={addItem} size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Agregar Item
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {items.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No hay items agregados. Haga clic en "Agregar Item" para comenzar.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[250px]">Producto</TableHead>
                        <TableHead className="w-[100px]">Cantidad</TableHead>
                        <TableHead className="w-[120px]">Costo Unit.</TableHead>
                        <TableHead className="w-[100px]">Desc %</TableHead>
                        <TableHead className="w-[100px]">IVA %</TableHead>
                        <TableHead className="w-[120px]">Subtotal</TableHead>
                        <TableHead className="w-[50px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((item, index) => (
                        <TableRow key={index}>
                          <TableCell>
                            <ProductPicker
                              productId={item.productId}
                              productName={item.productName}
                              onSelect={(product) => selectProduct(index, product)}
                              onManual={(name) => setManualProduct(index, name)}
                              onClear={() => clearProduct(index)}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              value={item.quantity}
                              onChange={(e) =>
                                updateItem(
                                  index,
                                  'quantity',
                                  parseInt(e.target.value) || 0
                                )
                              }
                              min="1"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              value={item.unitCost}
                              onChange={(e) =>
                                updateItem(
                                  index,
                                  'unitCost',
                                  parseFloat(e.target.value) || 0
                                )
                              }
                              step="0.01"
                              min="0"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              value={item.discount}
                              onChange={(e) =>
                                updateItem(
                                  index,
                                  'discount',
                                  parseFloat(e.target.value) || 0
                                )
                              }
                              step="0.01"
                              min="0"
                              max="100"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              value={item.taxRate}
                              onChange={(e) =>
                                updateItem(
                                  index,
                                  'taxRate',
                                  parseFloat(e.target.value) || 0
                                )
                              }
                              step="0.01"
                              min="0"
                            />
                          </TableCell>
                          <TableCell className="font-semibold">
                            {formatCurrency(item.subtotal)}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeItem(index)}
                            >
                              <Trash2 className="h-4 w-4 text-red-600" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Summary */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Resumen</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between">
                <span className="text-gray-600">Subtotal:</span>
                <span className="font-semibold">{formatCurrency(calculateSubtotal())}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">IVA:</span>
                <span className="font-semibold">{formatCurrency(calculateTaxAmount())}</span>
              </div>
              <div className="flex justify-between text-lg border-t pt-4">
                <span className="font-bold">Total:</span>
                <span className="font-bold text-blue-600">
                  {formatCurrency(calculateTotal())}
                </span>
              </div>

              <Button
                onClick={handleSubmit}
                disabled={loading}
                className="w-full"
                size="lg"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creando...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Crear Orden de Compra
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
