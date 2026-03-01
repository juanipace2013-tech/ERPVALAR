'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowLeft, Loader2, Package } from 'lucide-react'
import { toast } from 'sonner'

interface Category {
  id: string
  name: string
}

interface Supplier {
  id: string
  name: string
}

export default function NuevoProductoPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [categories, setCategories] = useState<Category[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loadingData, setLoadingData] = useState(true)

  const [formData, setFormData] = useState({
    sku: '',
    name: '',
    description: '',
    type: 'PRODUCT',
    categoryId: '',
    supplierId: '',
    brand: '',
    stockQuantity: 0,
    minStock: 0,
    maxStock: '',
    unit: 'UN',
    lastCost: '',
    averageCost: '',
    listPriceUSD: '',
    status: 'ACTIVE',
    isTaxable: true,
    taxRate: '21',
    trackInventory: true,
    allowNegative: false,
    notes: '',
    // Precios
    salePrice: '',
    purchasePrice: '',
  })

  useEffect(() => {
    loadInitialData()
  }, [])

  const loadInitialData = async () => {
    try {
      setLoadingData(true)
      // Cargar categorías y proveedores
      const [categoriesRes, suppliersRes] = await Promise.all([
        fetch('/api/productos/categories'),
        fetch('/api/proveedores?status=ACTIVE'),
      ])

      if (categoriesRes.ok) {
        const data = await categoriesRes.json()
        setCategories(data.categories || [])
      }

      if (suppliersRes.ok) {
        const data = await suppliersRes.json()
        setSuppliers(data.suppliers || [])
      }
    } catch (error) {
      console.error('Error loading data:', error)
    } finally {
      setLoadingData(false)
    }
  }

  const handleChange = (field: string, value: string | number | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Validaciones
    if (!formData.sku.trim()) {
      toast.error('El SKU es obligatorio')
      return
    }

    if (!formData.name.trim()) {
      toast.error('El nombre es obligatorio')
      return
    }

    try {
      setLoading(true)

      const payload = {
        sku: formData.sku.trim(),
        name: formData.name.trim(),
        description: formData.description.trim() || null,
        type: formData.type,
        categoryId: formData.categoryId || null,
        supplierId: formData.supplierId || null,
        brand: formData.brand.trim() || null,
        stockQuantity: parseInt(String(formData.stockQuantity)) || 0,
        minStock: parseInt(String(formData.minStock)) || 0,
        maxStock: formData.maxStock ? parseInt(formData.maxStock) : null,
        unit: formData.unit,
        lastCost: formData.lastCost ? parseFloat(formData.lastCost) : null,
        averageCost: formData.averageCost ? parseFloat(formData.averageCost) : null,
        listPriceUSD: formData.listPriceUSD ? parseFloat(formData.listPriceUSD) : null,
        status: formData.status,
        isTaxable: formData.isTaxable,
        taxRate: parseFloat(formData.taxRate),
        trackInventory: formData.trackInventory,
        allowNegative: formData.allowNegative,
        notes: formData.notes.trim() || null,
        // Precios
        prices: [] as Array<{ priceType: string; amount: number; currency: string }>,
      }

      // Agregar precio de venta si existe
      if (formData.salePrice) {
        payload.prices.push({
          priceType: 'SALE',
          amount: parseFloat(formData.salePrice),
          currency: 'ARS',
        })
      }

      // Agregar precio de compra (costo) si existe
      if (formData.purchasePrice) {
        payload.prices.push({
          priceType: 'COST',
          amount: parseFloat(formData.purchasePrice),
          currency: 'ARS',
        })
      }

      const response = await fetch('/api/productos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || error.error || 'Error al crear producto')
      }

      toast.success('Producto creado exitosamente')
      router.push('/productos')
    } catch (error) {
      console.error('Error:', error)
      toast.error(error instanceof Error ? error.message : 'Error al crear producto')
    } finally {
      setLoading(false)
    }
  }

  if (loadingData) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">Cargando formulario...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/productos">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Nuevo Producto</h1>
          <p className="text-sm text-gray-600 mt-1">
            Complete la información del producto
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Información Básica */}
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Información Básica</CardTitle>
                <CardDescription>Datos principales del producto</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="sku">SKU / Código *</Label>
                    <Input
                      id="sku"
                      value={formData.sku}
                      onChange={(e) => handleChange('sku', e.target.value)}
                      placeholder="PROD-001"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="name">Nombre *</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => handleChange('name', e.target.value)}
                      placeholder="Nombre del producto"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Descripción</Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => handleChange('description', e.target.value)}
                    placeholder="Descripción detallada del producto"
                    rows={3}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="type">Tipo</Label>
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

                  <div className="space-y-2">
                    <Label htmlFor="categoryId">Categoría</Label>
                    <Select value={formData.categoryId} onValueChange={(value) => handleChange('categoryId', value)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccionar" />
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
                    <Label htmlFor="brand">Marca</Label>
                    <Input
                      id="brand"
                      value={formData.brand}
                      onChange={(e) => handleChange('brand', e.target.value)}
                      placeholder="Marca"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="supplierId">Proveedor Principal</Label>
                  <Select value={formData.supplierId} onValueChange={(value) => handleChange('supplierId', value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar proveedor" />
                    </SelectTrigger>
                    <SelectContent>
                      {suppliers.map((sup) => (
                        <SelectItem key={sup.id} value={sup.id}>
                          {sup.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Inventario */}
            <Card>
              <CardHeader>
                <CardTitle>Inventario</CardTitle>
                <CardDescription>Control de stock y unidades</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="stockQuantity">Stock Actual</Label>
                    <Input
                      id="stockQuantity"
                      type="number"
                      value={formData.stockQuantity}
                      onChange={(e) => handleChange('stockQuantity', e.target.value)}
                      min="0"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="minStock">Stock Mínimo</Label>
                    <Input
                      id="minStock"
                      type="number"
                      value={formData.minStock}
                      onChange={(e) => handleChange('minStock', e.target.value)}
                      min="0"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="maxStock">Stock Máximo</Label>
                    <Input
                      id="maxStock"
                      type="number"
                      value={formData.maxStock}
                      onChange={(e) => handleChange('maxStock', e.target.value)}
                      placeholder="Opcional"
                      min="0"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="unit">Unidad</Label>
                    <Select value={formData.unit} onValueChange={(value) => handleChange('unit', value)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="UN">Unidad</SelectItem>
                        <SelectItem value="KG">Kilogramo</SelectItem>
                        <SelectItem value="LT">Litro</SelectItem>
                        <SelectItem value="MT">Metro</SelectItem>
                        <SelectItem value="M2">Metro²</SelectItem>
                        <SelectItem value="M3">Metro³</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex items-center space-x-4">
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={formData.trackInventory}
                      onChange={(e) => handleChange('trackInventory', e.target.checked)}
                      className="rounded"
                    />
                    <span className="text-sm">Controlar inventario</span>
                  </label>

                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={formData.allowNegative}
                      onChange={(e) => handleChange('allowNegative', e.target.checked)}
                      className="rounded"
                    />
                    <span className="text-sm">Permitir stock negativo</span>
                  </label>
                </div>
              </CardContent>
            </Card>

            {/* Notas */}
            <Card>
              <CardHeader>
                <CardTitle>Notas Adicionales</CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={formData.notes}
                  onChange={(e) => handleChange('notes', e.target.value)}
                  placeholder="Notas internas sobre el producto"
                  rows={3}
                />
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Precios */}
            <Card>
              <CardHeader>
                <CardTitle>Precios</CardTitle>
                <CardDescription>Costos y precios de venta</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="salePrice">Precio de Venta (ARS)</Label>
                  <Input
                    id="salePrice"
                    type="number"
                    step="0.01"
                    value={formData.salePrice}
                    onChange={(e) => handleChange('salePrice', e.target.value)}
                    placeholder="0.00"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="purchasePrice">Precio de Compra (ARS)</Label>
                  <Input
                    id="purchasePrice"
                    type="number"
                    step="0.01"
                    value={formData.purchasePrice}
                    onChange={(e) => handleChange('purchasePrice', e.target.value)}
                    placeholder="0.00"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="lastCost">Último Costo</Label>
                  <Input
                    id="lastCost"
                    type="number"
                    step="0.01"
                    value={formData.lastCost}
                    onChange={(e) => handleChange('lastCost', e.target.value)}
                    placeholder="0.00"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="listPriceUSD">Precio Lista (USD)</Label>
                  <Input
                    id="listPriceUSD"
                    type="number"
                    step="0.01"
                    value={formData.listPriceUSD}
                    onChange={(e) => handleChange('listPriceUSD', e.target.value)}
                    placeholder="0.00"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Impuestos */}
            <Card>
              <CardHeader>
                <CardTitle>Impuestos</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={formData.isTaxable}
                    onChange={(e) => handleChange('isTaxable', e.target.checked)}
                    className="rounded"
                    id="isTaxable"
                  />
                  <Label htmlFor="isTaxable">Producto gravado</Label>
                </div>

                {formData.isTaxable && (
                  <div className="space-y-2">
                    <Label htmlFor="taxRate">Alícuota IVA (%)</Label>
                    <Input
                      id="taxRate"
                      type="number"
                      step="0.01"
                      value={formData.taxRate}
                      onChange={(e) => handleChange('taxRate', e.target.value)}
                    />
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Estado */}
            <Card>
              <CardHeader>
                <CardTitle>Estado</CardTitle>
              </CardHeader>
              <CardContent>
                <Select value={formData.status} onValueChange={(value) => handleChange('status', value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Activo</SelectItem>
                    <SelectItem value="INACTIVE">Inactivo</SelectItem>
                    <SelectItem value="DISCONTINUED">Discontinuado</SelectItem>
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>

            {/* Botones */}
            <div className="space-y-2">
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creando...
                  </>
                ) : (
                  <>
                    <Package className="mr-2 h-4 w-4" />
                    Crear Producto
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => router.push('/productos')}
                disabled={loading}
              >
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
