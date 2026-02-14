'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Textarea } from '@/components/ui/textarea'
import {
  Receipt,
  Plus,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Eye,
  ArrowLeft,
  Package,
  DollarSign
} from 'lucide-react'
import { toast } from 'sonner'

interface Customer {
  id: string
  name: string
  businessName: string
  cuit: string
  taxCondition: string
}

interface Product {
  id: string
  sku: string
  name: string
  stockQuantity: number
  isTaxable: boolean
  taxRate: number
  prices: Array<{
    amount: number
    priceType: string
    currency: string
  }>
}

interface InvoiceItem {
  productId: string
  productName: string
  sku: string
  quantity: number
  unitPrice: number
  discount: number
  taxRate: number
  subtotal: number
  currentStock: number
}

interface InventoryPreview {
  valid: boolean
  stockErrors: Array<{
    productId: string
    productName: string
    available: number
    required: number
    message: string
  }>
  totalCMV: number
  currency: string
  products: Array<{
    productId: string
    productName: string
    currentStock: number
    requestedQuantity: number
    remainingStock: number
    unitCost: number
    totalCost: number
  }>
}

export default function NuevaFacturaPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [showPreview, setShowPreview] = useState(false)
  const [preview, setPreview] = useState<InventoryPreview | null>(null)

  // Form data
  const [customerId, setCustomerId] = useState('')
  const [invoiceType, setInvoiceType] = useState<'A' | 'B' | 'C' | 'E'>('B')
  const [currency, setCurrency] = useState<'ARS' | 'USD' | 'EUR'>('ARS')
  const [issueDate, setIssueDate] = useState(new Date().toISOString().split('T')[0])
  const [dueDate, setDueDate] = useState(
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  )
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<InvoiceItem[]>([])

  // New item
  const [selectedProductId, setSelectedProductId] = useState('')
  const [quantity, setQuantity] = useState(1)

  useEffect(() => {
    fetchCustomers()
    fetchProducts()
  }, [])

  const fetchCustomers = async () => {
    try {
      const response = await fetch('/api/clientes?limit=1000')
      if (response.ok) {
        const data = await response.json()
        setCustomers(data.customers || [])
      }
    } catch (error) {
      console.error('Error fetching customers:', error)
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
      console.error('Error fetching products:', error)
    }
  }

  const addItem = () => {
    if (!selectedProductId) {
      toast.error('Selecciona un producto')
      return
    }

    if (quantity <= 0) {
      toast.error('La cantidad debe ser mayor a 0')
      return
    }

    const product = products.find(p => p.id === selectedProductId)
    if (!product) return

    // Check if product already in items
    if (items.some(item => item.productId === selectedProductId)) {
      toast.error('El producto ya está en la lista')
      return
    }

    const salePrice = product.prices.find(p => p.priceType === 'SALE')
    if (!salePrice) {
      toast.error('El producto no tiene precio de venta definido')
      return
    }

    const unitPrice = Number(salePrice.amount)
    const subtotal = quantity * unitPrice

    const newItem: InvoiceItem = {
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      quantity,
      unitPrice,
      discount: 0,
      taxRate: Number(product.taxRate),
      subtotal,
      currentStock: product.stockQuantity,
    }

    setItems([...items, newItem])
    setSelectedProductId('')
    setQuantity(1)
    setShowPreview(false)
    setPreview(null)
  }

  const removeItem = (productId: string) => {
    setItems(items.filter(item => item.productId !== productId))
    setShowPreview(false)
    setPreview(null)
  }

  const updateItemQuantity = (productId: string, newQuantity: number) => {
    setItems(items.map(item => {
      if (item.productId === productId) {
        const subtotal = newQuantity * item.unitPrice * (1 - item.discount / 100)
        return { ...item, quantity: newQuantity, subtotal }
      }
      return item
    }))
    setShowPreview(false)
    setPreview(null)
  }

  const updateItemDiscount = (productId: string, newDiscount: number) => {
    setItems(items.map(item => {
      if (item.productId === productId) {
        const subtotal = item.quantity * item.unitPrice * (1 - newDiscount / 100)
        return { ...item, discount: newDiscount, subtotal }
      }
      return item
    }))
    setShowPreview(false)
    setPreview(null)
  }

  const calculateTotals = () => {
    const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0)
    const taxAmount = items.reduce((sum, item) => {
      return sum + (item.subtotal * item.taxRate / 100)
    }, 0)
    const total = subtotal + taxAmount

    return { subtotal, taxAmount, total, discount: 0 }
  }

  const generateInvoiceNumber = () => {
    const random = Math.floor(Math.random() * 99999).toString().padStart(5, '0')
    return `0001-${random}`
  }

  const handlePreview = async () => {
    if (items.length === 0) {
      toast.error('Agrega al menos un producto')
      return
    }

    try {
      setLoading(true)
      const response = await fetch('/api/facturas/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map(item => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: item.discount,
            taxRate: item.taxRate,
            subtotal: item.subtotal,
          })),
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error al generar preview')
      }

      const data = await response.json()
      setPreview(data.preview)
      setShowPreview(true)
    } catch (error) {
      console.error('Error:', error)
      toast.error(error instanceof Error ? error.message : 'Error al generar preview')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async () => {
    if (!customerId) {
      toast.error('Selecciona un cliente')
      return
    }

    if (items.length === 0) {
      toast.error('Agrega al menos un producto')
      return
    }

    if (preview && !preview.valid) {
      toast.error('Hay errores de stock. Revisa el preview.')
      return
    }

    try {
      setLoading(true)
      const totals = calculateTotals()

      const invoiceData = {
        invoiceNumber: generateInvoiceNumber(),
        invoiceType,
        customerId,
        currency,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        discount: totals.discount,
        total: totals.total,
        issueDate: new Date(issueDate).toISOString(),
        dueDate: new Date(dueDate).toISOString(),
        notes,
        items: items.map(item => ({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
          taxRate: item.taxRate,
          subtotal: item.subtotal,
          description: item.productName,
        })),
      }

      const response = await fetch('/api/facturas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invoiceData),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error al crear factura')
      }

      const data = await response.json()
      toast.success('Factura creada exitosamente')
      router.push(`/facturas/${data.invoice.id}`)
    } catch (error) {
      console.error('Error:', error)
      toast.error(error instanceof Error ? error.message : 'Error al crear factura')
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: currency || 'ARS',
    }).format(amount)
  }

  const totals = calculateTotals()
  const selectedCustomer = customers.find(c => c.id === customerId)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push('/facturas')}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Nueva Factura</h1>
            <p className="text-muted-foreground">
              Con descuento automático de inventario
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column - Form */}
        <div className="lg:col-span-2 space-y-6">
          {/* Customer & Type */}
          <Card>
            <CardHeader>
              <CardTitle>Datos de la Factura</CardTitle>
              <CardDescription>Información del cliente y tipo de factura</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Cliente *</Label>
                  <Select value={customerId} onValueChange={setCustomerId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona un cliente" />
                    </SelectTrigger>
                    <SelectContent>
                      {customers.map(customer => (
                        <SelectItem key={customer.id} value={customer.id}>
                          {customer.name} - {customer.cuit}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedCustomer && (
                    <p className="text-xs text-muted-foreground">
                      {selectedCustomer.businessName} - {selectedCustomer.taxCondition}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Tipo de Factura *</Label>
                  <Select value={invoiceType} onValueChange={(v: any) => setInvoiceType(v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="A">Factura A</SelectItem>
                      <SelectItem value="B">Factura B</SelectItem>
                      <SelectItem value="C">Factura C</SelectItem>
                      <SelectItem value="E">Factura E (Exportación)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>Moneda</Label>
                  <Select value={currency} onValueChange={(v: any) => setCurrency(v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ARS">Pesos (ARS)</SelectItem>
                      <SelectItem value="USD">Dólares (USD)</SelectItem>
                      <SelectItem value="EUR">Euros (EUR)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Fecha Emisión</Label>
                  <Input
                    type="date"
                    value={issueDate}
                    onChange={(e) => setIssueDate(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Fecha Vencimiento</Label>
                  <Input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Notas</Label>
                <Textarea
                  placeholder="Notas adicionales (opcional)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>

          {/* Add Products */}
          <Card>
            <CardHeader>
              <CardTitle>Agregar Productos</CardTitle>
              <CardDescription>Selecciona productos y cantidades</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-12">
                <div className="md:col-span-7 space-y-2">
                  <Label>Producto</Label>
                  <Select value={selectedProductId} onValueChange={setSelectedProductId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona un producto" />
                    </SelectTrigger>
                    <SelectContent>
                      {products
                        .filter(p => p.stockQuantity > 0)
                        .map(product => (
                          <SelectItem key={product.id} value={product.id}>
                            {product.name} - Stock: {product.stockQuantity}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="md:col-span-3 space-y-2">
                  <Label>Cantidad</Label>
                  <Input
                    type="number"
                    min="1"
                    value={quantity}
                    onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                  />
                </div>

                <div className="md:col-span-2 flex items-end">
                  <Button onClick={addItem} className="w-full">
                    <Plus className="mr-2 h-4 w-4" />
                    Agregar
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Items List */}
          {items.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Productos en la Factura</CardTitle>
                <CardDescription>{items.length} producto(s) agregado(s)</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Producto</TableHead>
                        <TableHead className="text-center">Stock Actual</TableHead>
                        <TableHead className="text-right">Cantidad</TableHead>
                        <TableHead className="text-right">Precio Unit.</TableHead>
                        <TableHead className="text-right">Desc. %</TableHead>
                        <TableHead className="text-right">IVA %</TableHead>
                        <TableHead className="text-right">Subtotal</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((item) => (
                        <TableRow key={item.productId}>
                          <TableCell>
                            <div>
                              <div className="font-medium">{item.productName}</div>
                              <div className="text-xs text-muted-foreground">{item.sku}</div>
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge
                              variant={item.currentStock >= item.quantity ? 'default' : 'destructive'}
                            >
                              {item.currentStock}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min="1"
                              max={item.currentStock}
                              value={item.quantity}
                              onChange={(e) => updateItemQuantity(item.productId, parseInt(e.target.value) || 1)}
                              className="w-20 text-right"
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(item.unitPrice)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min="0"
                              max="100"
                              value={item.discount}
                              onChange={(e) => updateItemDiscount(item.productId, parseFloat(e.target.value) || 0)}
                              className="w-16 text-right"
                            />
                          </TableCell>
                          <TableCell className="text-right">{item.taxRate}%</TableCell>
                          <TableCell className="text-right font-semibold">
                            {formatCurrency(item.subtotal)}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeItem(item.productId)}
                            >
                              <Trash2 className="h-4 w-4 text-red-600" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Preview Button */}
          {items.length > 0 && (
            <div className="flex gap-2">
              <Button
                onClick={handlePreview}
                variant="outline"
                disabled={loading}
                className="flex-1"
              >
                <Eye className="mr-2 h-4 w-4" />
                {loading ? 'Generando...' : 'Preview de Inventario'}
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={loading || !customerId || items.length === 0}
                className="flex-1"
              >
                <Receipt className="mr-2 h-4 w-4" />
                {loading ? 'Creando...' : 'Crear Factura'}
              </Button>
            </div>
          )}
        </div>

        {/* Right Column - Summary & Preview */}
        <div className="space-y-6">
          {/* Totals */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                Resumen
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal:</span>
                  <span className="font-medium">{formatCurrency(totals.subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">IVA:</span>
                  <span className="font-medium">{formatCurrency(totals.taxAmount)}</span>
                </div>
                {totals.discount > 0 && (
                  <div className="flex justify-between text-sm text-green-600">
                    <span>Descuento:</span>
                    <span className="font-medium">-{formatCurrency(totals.discount)}</span>
                  </div>
                )}
                <div className="border-t pt-2">
                  <div className="flex justify-between">
                    <span className="font-semibold">Total:</span>
                    <span className="text-2xl font-bold">{formatCurrency(totals.total)}</span>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Productos:</span>
                  <span>{items.length}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Unidades:</span>
                  <span>{items.reduce((sum, item) => sum + item.quantity, 0)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Inventory Preview */}
          {showPreview && preview && (
            <Card className={preview.valid ? 'border-green-500' : 'border-red-500'}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5" />
                  Preview de Inventario
                </CardTitle>
                <CardDescription>
                  {preview.valid ? (
                    <span className="text-green-600 flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4" />
                      Stock disponible para todos los productos
                    </span>
                  ) : (
                    <span className="text-red-600 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4" />
                      Hay productos sin stock suficiente
                    </span>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* CMV Summary */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <div className="text-sm font-medium text-blue-900 mb-1">
                    Costo de Mercadería Vendida (CMV)
                  </div>
                  <div className="text-2xl font-bold text-blue-600">
                    {formatCurrency(preview.totalCMV)}
                  </div>
                  <div className="text-xs text-blue-700 mt-1">
                    Asiento contable generado automáticamente
                  </div>
                </div>

                {/* Stock Errors */}
                {!preview.valid && preview.stockErrors.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-red-600">
                      Errores de Stock:
                    </div>
                    {preview.stockErrors.map((error, index) => (
                      <div key={index} className="bg-red-50 border border-red-200 rounded p-2">
                        <div className="text-sm font-medium text-red-900">
                          {error.productName}
                        </div>
                        <div className="text-xs text-red-700">
                          {error.message}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Products Detail */}
                <div className="space-y-2">
                  <div className="text-sm font-medium">Impacto por Producto:</div>
                  {preview.products.map((product, index) => (
                    <div key={index} className="bg-gray-50 rounded p-2 space-y-1">
                      <div className="text-sm font-medium">{product.productName}</div>
                      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <div>Stock actual: {product.currentStock}</div>
                        <div>Venta: {product.requestedQuantity}</div>
                        <div className={product.remainingStock >= 0 ? 'text-green-600' : 'text-red-600'}>
                          Quedarán: {product.remainingStock}
                        </div>
                        <div>CMV: {formatCurrency(product.totalCost)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
