'use client'

import { use, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
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
import { ArrowLeft, Save, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

interface Category {
  id: string
  name: string
}

interface Product {
  id: string
  sku: string
  name: string
  description: string | null
  type: string
  unit: string
  categoryId: string | null
  brand: string | null
  stockQuantity: number
  minStock: number
  maxStock: number | null
  isTaxable: boolean
  taxRate: number
  trackInventory: boolean
  allowNegative: boolean
  lastCost: number | null
  averageCost: number | null
  prices: Array<{
    priceType: string
    amount: number
  }>
}

export default function EditarItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [categories, setCategories] = useState<Category[]>([])
  const [product, setProduct] = useState<Product | null>(null)

  // Form state
  const [formData, setFormData] = useState({
    sku: '',
    name: '',
    description: '',
    type: 'PRODUCT',
    unit: 'UN',
    categoryId: '',
    brand: '',
    stockQuantity: 0,
    minStock: 0,
    maxStock: 0,
    salePrice: 0,
    cost: 0,
    isTaxable: true,
    taxRate: 21,
    trackInventory: true,
    allowNegative: false,
  })

  useEffect(() => {
    fetchProduct()
    fetchCategories()
  }, [id])

  const fetchProduct = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/productos/${id}`)

      if (!response.ok) {
        throw new Error('Error al cargar producto')
      }

      const data: Product = await response.json()
      setProduct(data)

      // Cargar datos en el formulario
      const salePrice = data.prices.find(p => p.priceType === 'SALE')
      const costPrice = data.prices.find(p => p.priceType === 'COST')

      setFormData({
        sku: data.sku,
        name: data.name,
        description: data.description || '',
        type: data.type,
        unit: data.unit,
        categoryId: data.categoryId || '',
        brand: data.brand || '',
        stockQuantity: data.stockQuantity,
        minStock: data.minStock,
        maxStock: data.maxStock || 0,
        salePrice: salePrice ? Number(salePrice.amount) : 0,
        cost: costPrice ? Number(costPrice.amount) : Number(data.lastCost || 0),
        isTaxable: data.isTaxable,
        taxRate: Number(data.taxRate),
        trackInventory: data.trackInventory,
        allowNegative: data.allowNegative,
      })
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar el producto')
      router.push('/inventario/items')
    } finally {
      setLoading(false)
    }
  }

  const fetchCategories = async () => {
    try {
      const response = await fetch('/api/categorias')
      if (response.ok) {
        const data = await response.json()
        setCategories(data)
      }
    } catch (error) {
      console.error('Error al cargar categorías:', error)
    }
  }

  const handleChange = (field: string, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Validaciones básicas
    if (!formData.sku || !formData.name) {
      toast.error('El código y nombre son obligatorios')
      return
    }

    if (formData.salePrice <= 0) {
      toast.error('El precio de venta debe ser mayor a 0')
      return
    }

    try {
      setSaving(true)

      // Preparar datos para la API
      const costValue = formData.cost ? parseFloat(String(formData.cost)) : null

      const productData = {
        sku: formData.sku,
        name: formData.name,
        description: formData.description || null,
        type: formData.type,
        unit: formData.unit,
        categoryId: formData.categoryId || null,
        brand: formData.brand || null,
        stockQuantity: parseInt(String(formData.stockQuantity)) || 0,
        minStock: parseInt(String(formData.minStock)) || 0,
        maxStock: formData.maxStock && parseInt(String(formData.maxStock)) > 0
          ? parseInt(String(formData.maxStock))
          : null,
        isTaxable: formData.isTaxable,
        taxRate: parseFloat(String(formData.taxRate)),
        trackInventory: formData.trackInventory,
        allowNegative: formData.allowNegative,
        status: 'ACTIVE',
        prices: [
          {
            currency: 'ARS',
            priceType: 'SALE',
            amount: parseFloat(String(formData.salePrice)),
            validFrom: new Date().toISOString(),
          },
          // Solo incluir precio COST si hay un costo válido
          ...(costValue && costValue > 0 ? [{
            currency: 'ARS',
            priceType: 'COST',
            amount: costValue,
            validFrom: new Date().toISOString(),
          }] : []),
        ],
      }

      const response = await fetch(`/api/productos/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(productData),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error al actualizar el producto')
      }

      toast.success('Producto actualizado exitosamente')
      router.push(`/inventario/items/${id}`)
    } catch (error: any) {
      console.error('Error:', error)
      toast.error(error.message || 'Error al actualizar el producto')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (!product) {
    return null
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push(`/inventario/items/${id}`)}
            className="text-blue-600 hover:text-blue-700"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-blue-900">
              Editar Item
            </h1>
            <p className="text-muted-foreground">
              Modificar información del producto
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid gap-6">
          {/* Información Básica */}
          <Card className="border-blue-200">
            <CardHeader>
              <CardTitle className="text-blue-900">Información Básica</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="sku" className="text-blue-900">
                    Código SKU <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="sku"
                    value={formData.sku}
                    onChange={(e) => handleChange('sku', e.target.value.toUpperCase())}
                    placeholder="PROD-001"
                    className="font-mono"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="type" className="text-blue-900">
                    Tipo <span className="text-red-500">*</span>
                  </Label>
                  <Select value={formData.type} onValueChange={(value) => handleChange('type', value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PRODUCT">Producto</SelectItem>
                      <SelectItem value="SERVICE">Servicio</SelectItem>
                      <SelectItem value="COMBO">Combo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="name" className="text-blue-900">
                  Nombre <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  placeholder="Nombre del producto"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description" className="text-blue-900">
                  Descripción
                </Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => handleChange('description', e.target.value)}
                  placeholder="Descripción detallada del producto"
                  rows={3}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="categoryId" className="text-blue-900">
                    Categoría
                  </Label>
                  <Select
                    value={formData.categoryId}
                    onValueChange={(value) => handleChange('categoryId', value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar..." />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="brand" className="text-blue-900">
                    Marca
                  </Label>
                  <Input
                    id="brand"
                    value={formData.brand}
                    onChange={(e) => handleChange('brand', e.target.value)}
                    placeholder="Ej: Samsung, HP, etc."
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="unit" className="text-blue-900">
                    Unidad de Medida <span className="text-red-500">*</span>
                  </Label>
                  <Select value={formData.unit} onValueChange={(value) => handleChange('unit', value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="UN">Unidad (UN)</SelectItem>
                      <SelectItem value="KG">Kilogramo (KG)</SelectItem>
                      <SelectItem value="LT">Litro (LT)</SelectItem>
                      <SelectItem value="MT">Metro (MT)</SelectItem>
                      <SelectItem value="M2">Metro Cuadrado (M2)</SelectItem>
                      <SelectItem value="M3">Metro Cúbico (M3)</SelectItem>
                      <SelectItem value="HS">Hora (HS)</SelectItem>
                      <SelectItem value="DIA">Día (DIA)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Precios y Costos */}
          <Card className="border-blue-200">
            <CardHeader>
              <CardTitle className="text-blue-900">Precios y Costos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="salePrice" className="text-blue-900">
                    Precio de Venta (ARS) <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="salePrice"
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.salePrice}
                    onChange={(e) => handleChange('salePrice', e.target.value)}
                    placeholder="0.00"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cost" className="text-blue-900">
                    Costo (ARS)
                  </Label>
                  <Input
                    id="cost"
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.cost}
                    onChange={(e) => handleChange('cost', e.target.value)}
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-blue-900">
                    <input
                      type="checkbox"
                      checked={formData.isTaxable}
                      onChange={(e) => handleChange('isTaxable', e.target.checked)}
                      className="mr-2"
                    />
                    Aplica IVA
                  </Label>
                </div>

                {formData.isTaxable && (
                  <div className="space-y-2">
                    <Label htmlFor="taxRate" className="text-blue-900">
                      Tasa de IVA (%)
                    </Label>
                    <Input
                      id="taxRate"
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={formData.taxRate}
                      onChange={(e) => handleChange('taxRate', e.target.value)}
                    />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Inventario */}
          {formData.type !== 'SERVICE' && (
            <Card className="border-blue-200">
              <CardHeader>
                <CardTitle className="text-blue-900">Control de Inventario</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-blue-900">
                    <input
                      type="checkbox"
                      checked={formData.trackInventory}
                      onChange={(e) => handleChange('trackInventory', e.target.checked)}
                      className="mr-2"
                    />
                    Trackear inventario
                  </Label>
                </div>

                {formData.trackInventory && (
                  <>
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label htmlFor="stockQuantity" className="text-blue-900">
                          Stock Actual
                        </Label>
                        <Input
                          id="stockQuantity"
                          type="number"
                          min="0"
                          value={formData.stockQuantity}
                          onChange={(e) => handleChange('stockQuantity', e.target.value)}
                          placeholder="0"
                          disabled
                        />
                        <p className="text-xs text-muted-foreground">
                          El stock se modifica mediante movimientos
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="minStock" className="text-blue-900">
                          Stock Mínimo
                        </Label>
                        <Input
                          id="minStock"
                          type="number"
                          min="0"
                          value={formData.minStock}
                          onChange={(e) => handleChange('minStock', e.target.value)}
                          placeholder="0"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="maxStock" className="text-blue-900">
                          Stock Máximo
                        </Label>
                        <Input
                          id="maxStock"
                          type="number"
                          min="0"
                          value={formData.maxStock}
                          onChange={(e) => handleChange('maxStock', e.target.value)}
                          placeholder="Sin límite"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-blue-900">
                        <input
                          type="checkbox"
                          checked={formData.allowNegative}
                          onChange={(e) => handleChange('allowNegative', e.target.checked)}
                          className="mr-2"
                        />
                        Permitir stock negativo
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Si se activa, se podrán registrar ventas aunque no haya stock disponible
                      </p>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* Botones */}
          <div className="flex justify-end gap-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push(`/inventario/items/${id}`)}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className="bg-blue-600 hover:bg-blue-700"
              disabled={saving}
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Guardando...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Guardar Cambios
                </>
              )}
            </Button>
          </div>
        </div>
      </form>
    </div>
  )
}
