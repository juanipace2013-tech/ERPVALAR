'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ArrowLeft, Save, Loader2, Package, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface Product {
  id: string
  sku: string
  name: string
  stockQuantity: number
  unit: string
  averageCost: number | null
  lastCost: number | null
}

const movementTypeLabels: Record<string, string> = {
  COMPRA: 'Compra',
  AJUSTE_POSITIVO: 'Ajuste Positivo (+)',
  AJUSTE_NEGATIVO: 'Ajuste Negativo (-)',
  DEVOLUCION_CLIENTE: 'Devolución de Cliente',
  DEVOLUCION_PROVEEDOR: 'Devolución a Proveedor',
  TRANSFERENCIA: 'Transferencia',
}

const movementTypeDescriptions: Record<string, string> = {
  COMPRA: 'Entrada de mercadería por compra a proveedor',
  AJUSTE_POSITIVO: 'Incremento manual de stock (ej: inventario físico)',
  AJUSTE_NEGATIVO: 'Disminución manual de stock (ej: rotura, pérdida)',
  DEVOLUCION_CLIENTE: 'Entrada por devolución de cliente',
  DEVOLUCION_PROVEEDOR: 'Salida por devolución a proveedor',
  TRANSFERENCIA: 'Transferencia entre depósitos',
}

export default function NuevoMovimientoPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const productIdParam = searchParams.get('productId')

  const [loading, setLoading] = useState(false)
  const [products, setProducts] = useState<Product[]>([])
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)

  // Form state
  const [formData, setFormData] = useState({
    productId: productIdParam || '',
    type: 'COMPRA',
    quantity: 0,
    unitCost: 0,
    reference: '',
    notes: '',
    date: new Date().toISOString().split('T')[0], // Fecha de hoy en formato YYYY-MM-DD
  })

  useEffect(() => {
    fetchProducts()
  }, [])

  useEffect(() => {
    if (formData.productId) {
      const product = products.find(p => p.id === formData.productId)
      setSelectedProduct(product || null)

      // Si el producto tiene costo, pre-llenar el campo
      if (product && !formData.unitCost) {
        const suggestedCost = product.averageCost || product.lastCost || 0
        handleChange('unitCost', Number(suggestedCost))
      }
    }
  }, [formData.productId, products])

  const fetchProducts = async () => {
    try {
      const response = await fetch('/api/productos?limit=1000')
      if (response.ok) {
        const data = await response.json()
        setProducts(data.products || [])
      }
    } catch (error) {
      console.error('Error al cargar productos:', error)
      toast.error('Error al cargar productos')
    }
  }

  const handleChange = (field: string, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const getQuantityDirection = () => {
    const type = formData.type
    if (type === 'COMPRA' || type === 'AJUSTE_POSITIVO' || type === 'DEVOLUCION_CLIENTE') {
      return 'positive' // Entrada
    }
    return 'negative' // Salida
  }

  const calculateNewStock = () => {
    if (!selectedProduct) return 0

    const direction = getQuantityDirection()
    const quantity = Math.abs(Number(formData.quantity))

    if (direction === 'positive') {
      return selectedProduct.stockQuantity + quantity
    } else {
      return selectedProduct.stockQuantity - quantity
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Validaciones
    if (!formData.productId) {
      toast.error('Debe seleccionar un producto')
      return
    }

    if (!formData.type) {
      toast.error('Debe seleccionar un tipo de movimiento')
      return
    }

    const quantity = Number(formData.quantity)
    if (quantity <= 0) {
      toast.error('La cantidad debe ser mayor a 0')
      return
    }

    const unitCost = Number(formData.unitCost)
    if (unitCost < 0) {
      toast.error('El costo no puede ser negativo')
      return
    }

    // Validar que no quede stock negativo (a menos que el producto lo permita)
    const newStock = calculateNewStock()
    if (newStock < 0 && selectedProduct && !(selectedProduct as any).allowNegative) {
      toast.error(`Stock insuficiente. Disponible: ${selectedProduct.stockQuantity}`)
      return
    }

    try {
      setLoading(true)

      // Preparar datos para la API
      const direction = getQuantityDirection()
      const finalQuantity = direction === 'positive' ? quantity : -quantity

      const movementData = {
        productId: formData.productId,
        type: formData.type,
        quantity: finalQuantity,
        unitCost: unitCost,
        currency: 'ARS',
        reference: formData.reference || null,
        notes: formData.notes || null,
        date: new Date(formData.date).toISOString(),
      }

      const response = await fetch('/api/inventario/movimientos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(movementData),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error al crear el movimiento')
      }

      const data = await response.json()
      toast.success('Movimiento registrado exitosamente')
      router.push(`/inventario/items/${formData.productId}`)
    } catch (error: any) {
      console.error('Error:', error)
      toast.error(error.message || 'Error al crear el movimiento')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.back()}
            className="text-blue-600 hover:text-blue-700"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-blue-900">
              Nuevo Movimiento de Inventario
            </h1>
            <p className="text-muted-foreground">
              Registrar entrada o salida de stock
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid gap-6">
          {/* Producto y Tipo */}
          <Card className="border-blue-200">
            <CardHeader>
              <CardTitle className="text-blue-900">Información del Movimiento</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="productId" className="text-blue-900">
                    Producto <span className="text-red-500">*</span>
                  </Label>
                  <Select
                    value={formData.productId}
                    onValueChange={(value) => handleChange('productId', value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar producto..." />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((product) => (
                        <SelectItem key={product.id} value={product.id}>
                          {product.sku} - {product.name} (Stock: {product.stockQuantity})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="type" className="text-blue-900">
                    Tipo de Movimiento <span className="text-red-500">*</span>
                  </Label>
                  <Select
                    value={formData.type}
                    onValueChange={(value) => handleChange('type', value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(movementTypeLabels).map(([key, label]) => (
                        <SelectItem key={key} value={key}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {movementTypeDescriptions[formData.type]}
                  </p>
                </div>
              </div>

              {selectedProduct && (
                <Alert className="border-blue-200 bg-blue-50">
                  <Package className="h-4 w-4 text-blue-600" />
                  <AlertDescription className="text-sm">
                    <strong>Stock actual:</strong> {selectedProduct.stockQuantity} {selectedProduct.unit}
                    {selectedProduct.averageCost && (
                      <> • <strong>Costo promedio:</strong> ${Number(selectedProduct.averageCost).toLocaleString('es-AR')}</>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="date" className="text-blue-900">
                    Fecha <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="date"
                    type="date"
                    value={formData.date}
                    onChange={(e) => handleChange('date', e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reference" className="text-blue-900">
                    Referencia
                  </Label>
                  <Input
                    id="reference"
                    value={formData.reference}
                    onChange={(e) => handleChange('reference', e.target.value)}
                    placeholder="Ej: FAC-001, REM-123"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Cantidad y Costo */}
          <Card className="border-blue-200">
            <CardHeader>
              <CardTitle className="text-blue-900">Cantidad y Costos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="quantity" className="text-blue-900">
                    Cantidad <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="quantity"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={formData.quantity}
                    onChange={(e) => handleChange('quantity', e.target.value)}
                    placeholder="0"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Ingrese siempre un valor positivo. La dirección se determina por el tipo.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="unitCost" className="text-blue-900">
                    Costo Unitario (ARS) <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="unitCost"
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.unitCost}
                    onChange={(e) => handleChange('unitCost', e.target.value)}
                    placeholder="0.00"
                    required
                  />
                </div>
              </div>

              {selectedProduct && formData.quantity > 0 && (
                <Alert className={
                  getQuantityDirection() === 'positive'
                    ? 'border-green-200 bg-green-50'
                    : 'border-orange-200 bg-orange-50'
                }>
                  <AlertCircle className={
                    getQuantityDirection() === 'positive'
                      ? 'h-4 w-4 text-green-600'
                      : 'h-4 w-4 text-orange-600'
                  } />
                  <AlertDescription className="text-sm">
                    <strong>Impacto:</strong>{' '}
                    {getQuantityDirection() === 'positive' ? 'Entrada' : 'Salida'} de{' '}
                    {Math.abs(Number(formData.quantity))} {selectedProduct.unit}
                    <br />
                    <strong>Stock nuevo:</strong> {calculateNewStock()} {selectedProduct.unit}
                    {' '}
                    ({getQuantityDirection() === 'positive' ? '+' : '-'}
                    {Math.abs(Number(formData.quantity))})
                    <br />
                    <strong>Costo total:</strong> $
                    {(Math.abs(Number(formData.quantity)) * Number(formData.unitCost)).toLocaleString('es-AR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="notes" className="text-blue-900">
                  Notas / Observaciones
                </Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  onChange={(e) => handleChange('notes', e.target.value)}
                  placeholder="Agregar detalles adicionales del movimiento..."
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>

          {/* Botones */}
          <div className="flex justify-end gap-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className="bg-blue-600 hover:bg-blue-700"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Registrando...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Registrar Movimiento
                </>
              )}
            </Button>
          </div>
        </div>
      </form>
    </div>
  )
}
