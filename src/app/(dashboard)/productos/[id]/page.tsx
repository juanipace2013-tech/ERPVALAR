'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
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
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Loader2, Package, Pencil, Save, X } from 'lucide-react'
import { toast } from 'sonner'

interface Category {
  id: string
  name: string
}

interface Supplier {
  id: string
  name: string
}

interface ProductPrice {
  id: string
  currency: string
  priceType: string
  amount: string | number
  validFrom: string
  validUntil: string | null
}

interface Product {
  id: string
  sku: string
  name: string
  description: string | null
  type: string
  categoryId: string | null
  supplierId: string | null
  brand: string | null
  stockQuantity: number
  minStock: number
  maxStock: number | null
  unit: string
  lastCost: string | number | null
  averageCost: string | number | null
  listPriceUSD: string | number | null
  status: string
  isTaxable: boolean
  taxRate: string | number
  trackInventory: boolean
  allowNegative: boolean
  notes: string | null
  createdAt: string
  updatedAt: string
  category: Category | null
  supplier: Supplier | null
  prices: ProductPrice[]
}

const STATUS_MAP: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
  ACTIVE: { label: 'Activo', variant: 'default' },
  INACTIVE: { label: 'Inactivo', variant: 'secondary' },
  DISCONTINUED: { label: 'Discontinuado', variant: 'destructive' },
}

const TYPE_MAP: Record<string, string> = {
  PRODUCT: 'Producto',
  SERVICE: 'Servicio',
  COMBO: 'Combo',
}

const UNIT_MAP: Record<string, string> = {
  UN: 'Unidad',
  KG: 'Kilogramo',
  LT: 'Litro',
  MT: 'Metro',
  M2: 'Metro\u00B2',
  M3: 'Metro\u00B3',
}

function getPrice(prices: ProductPrice[], priceType: string, currency: string): string {
  const price = prices.find(
    (p) => p.priceType === priceType && p.currency === currency && !p.validUntil
  )
  return price ? String(Number(price.amount).toFixed(2)) : ''
}

function formatCurrency(value: string | number | null | undefined, currency: string = 'USD'): string {
  if (value === null || value === undefined || value === '') return '-'
  const num = typeof value === 'string' ? parseFloat(value) : value
  if (isNaN(num)) return '-'
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(num)
}

export default function ProductoDetallePage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  // Edit mode data
  const [categories, setCategories] = useState<Category[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])

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
    salePrice: '',
    purchasePrice: '',
  })

  const fetchProduct = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      const response = await fetch(`/api/productos/${id}`)
      if (!response.ok) {
        if (response.status === 404) throw new Error('Producto no encontrado')
        throw new Error('Error al cargar producto')
      }
      const data: Product = await response.json()
      setProduct(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    if (id) fetchProduct()
  }, [id, fetchProduct])

  const populateForm = (p: Product) => {
    setFormData({
      sku: p.sku || '',
      name: p.name || '',
      description: p.description || '',
      type: p.type || 'PRODUCT',
      categoryId: p.categoryId || '',
      supplierId: p.supplierId || '',
      brand: p.brand || '',
      stockQuantity: p.stockQuantity || 0,
      minStock: p.minStock || 0,
      maxStock: p.maxStock != null ? String(p.maxStock) : '',
      unit: p.unit || 'UN',
      lastCost: p.lastCost != null ? String(Number(p.lastCost)) : '',
      averageCost: p.averageCost != null ? String(Number(p.averageCost)) : '',
      listPriceUSD: p.listPriceUSD != null ? String(Number(p.listPriceUSD)) : '',
      status: p.status || 'ACTIVE',
      isTaxable: p.isTaxable ?? true,
      taxRate: p.taxRate != null ? String(Number(p.taxRate)) : '21',
      trackInventory: p.trackInventory ?? true,
      allowNegative: p.allowNegative ?? false,
      notes: p.notes || '',
      salePrice: getPrice(p.prices, 'SALE', 'ARS'),
      purchasePrice: getPrice(p.prices, 'COST', 'ARS'),
    })
  }

  const handleEdit = async () => {
    if (!product) return
    populateForm(product)

    // Load categories and suppliers for selects
    try {
      const [catRes, supRes] = await Promise.all([
        fetch('/api/productos/categories'),
        fetch('/api/proveedores?status=ACTIVE'),
      ])
      if (catRes.ok) {
        const data = await catRes.json()
        setCategories(data.categories || [])
      }
      if (supRes.ok) {
        const data = await supRes.json()
        setSuppliers(data.suppliers || [])
      }
    } catch (err) {
      console.error('Error loading categories/suppliers:', err)
    }

    setEditing(true)
  }

  const handleCancel = () => {
    setEditing(false)
  }

  const handleChange = (field: string, value: string | number | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleSave = async () => {
    if (!formData.sku.trim()) {
      toast.error('El SKU es obligatorio')
      return
    }
    if (!formData.name.trim()) {
      toast.error('El nombre es obligatorio')
      return
    }

    try {
      setSaving(true)

      const payload: Record<string, unknown> = {
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
        prices: [] as Array<{ priceType: string; amount: number; currency: string }>,
      }

      const prices = payload.prices as Array<{ priceType: string; amount: number; currency: string }>

      if (formData.salePrice) {
        prices.push({
          priceType: 'SALE',
          amount: parseFloat(formData.salePrice),
          currency: 'ARS',
        })
      }

      if (formData.purchasePrice) {
        prices.push({
          priceType: 'COST',
          amount: parseFloat(formData.purchasePrice),
          currency: 'ARS',
        })
      }

      const response = await fetch(`/api/productos/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.message || err.error || 'Error al guardar')
      }

      const updated: Product = await response.json()
      setProduct(updated)
      setEditing(false)
      toast.success('Producto actualizado exitosamente')
    } catch (err) {
      console.error('Error saving product:', err)
      toast.error(err instanceof Error ? err.message : 'Error al guardar producto')
    } finally {
      setSaving(false)
    }
  }

  // --- Loading / Error states ---
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">Cargando producto...</p>
        </div>
      </div>
    )
  }

  if (error || !product) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Package className="h-12 w-12 text-gray-400 mx-auto" />
          <p className="mt-4 text-gray-600">{error || 'Producto no encontrado'}</p>
          <Button variant="outline" className="mt-4" onClick={() => router.push('/productos')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver al listado
          </Button>
        </div>
      </div>
    )
  }

  const statusInfo = STATUS_MAP[product.status] || STATUS_MAP.ACTIVE

  // --- RENDER ---
  return (
    <div className="container mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/productos">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold text-gray-900">{product.name}</h1>
              <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              SKU: {product.sku}
              {product.brand && <> &middot; {product.brand}</>}
              {product.category && <> &middot; {product.category.name}</>}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {editing ? (
            <>
              <Button variant="outline" onClick={handleCancel} disabled={saving}>
                <X className="mr-2 h-4 w-4" />
                Cancelar
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Guardar
              </Button>
            </>
          ) : (
            <Button onClick={handleEdit}>
              <Pencil className="mr-2 h-4 w-4" />
              Editar
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Info Basica */}
          <Card>
            <CardHeader>
              <CardTitle>Informaci&oacute;n B&aacute;sica</CardTitle>
              <CardDescription>Datos principales del producto</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>SKU / C&oacute;digo</Label>
                  {editing ? (
                    <Input
                      value={formData.sku}
                      onChange={(e) => handleChange('sku', e.target.value)}
                    />
                  ) : (
                    <p className="text-sm font-mono bg-gray-50 px-3 py-2 rounded-md">{product.sku}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Nombre</Label>
                  {editing ? (
                    <Input
                      value={formData.name}
                      onChange={(e) => handleChange('name', e.target.value)}
                    />
                  ) : (
                    <p className="text-sm px-3 py-2">{product.name}</p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Descripci&oacute;n</Label>
                {editing ? (
                  <Textarea
                    value={formData.description}
                    onChange={(e) => handleChange('description', e.target.value)}
                    rows={3}
                  />
                ) : (
                  <p className="text-sm text-gray-600 px-3 py-2">
                    {product.description || <span className="text-gray-400 italic">Sin descripci&oacute;n</span>}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Tipo</Label>
                  {editing ? (
                    <Select value={formData.type} onValueChange={(v) => handleChange('type', v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PRODUCT">Producto</SelectItem>
                        <SelectItem value="SERVICE">Servicio</SelectItem>
                        <SelectItem value="COMBO">Combo</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm px-3 py-2">{TYPE_MAP[product.type] || product.type}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Categor&iacute;a</Label>
                  {editing ? (
                    <Select value={formData.categoryId} onValueChange={(v) => handleChange('categoryId', v)}>
                      <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                      <SelectContent>
                        {categories.map((cat) => (
                          <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm px-3 py-2">{product.category?.name || <span className="text-gray-400">-</span>}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Marca</Label>
                  {editing ? (
                    <Input
                      value={formData.brand}
                      onChange={(e) => handleChange('brand', e.target.value)}
                    />
                  ) : (
                    <p className="text-sm px-3 py-2">{product.brand || <span className="text-gray-400">-</span>}</p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Proveedor</Label>
                {editing ? (
                  <Select value={formData.supplierId} onValueChange={(v) => handleChange('supplierId', v)}>
                    <SelectTrigger><SelectValue placeholder="Seleccionar proveedor" /></SelectTrigger>
                    <SelectContent>
                      {suppliers.map((sup) => (
                        <SelectItem key={sup.id} value={sup.id}>{sup.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-sm px-3 py-2">{product.supplier?.name || <span className="text-gray-400">-</span>}</p>
                )}
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
                  <Label>Stock Actual</Label>
                  {editing ? (
                    <Input
                      type="number"
                      value={formData.stockQuantity}
                      onChange={(e) => handleChange('stockQuantity', e.target.value)}
                      min="0"
                    />
                  ) : (
                    <p className="text-sm font-semibold px-3 py-2">{product.stockQuantity}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Stock M&iacute;nimo</Label>
                  {editing ? (
                    <Input
                      type="number"
                      value={formData.minStock}
                      onChange={(e) => handleChange('minStock', e.target.value)}
                      min="0"
                    />
                  ) : (
                    <p className="text-sm px-3 py-2">{product.minStock}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Stock M&aacute;ximo</Label>
                  {editing ? (
                    <Input
                      type="number"
                      value={formData.maxStock}
                      onChange={(e) => handleChange('maxStock', e.target.value)}
                      placeholder="Opcional"
                      min="0"
                    />
                  ) : (
                    <p className="text-sm px-3 py-2">{product.maxStock ?? <span className="text-gray-400">-</span>}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Unidad</Label>
                  {editing ? (
                    <Select value={formData.unit} onValueChange={(v) => handleChange('unit', v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="UN">Unidad</SelectItem>
                        <SelectItem value="KG">Kilogramo</SelectItem>
                        <SelectItem value="LT">Litro</SelectItem>
                        <SelectItem value="MT">Metro</SelectItem>
                        <SelectItem value="M2">Metro&sup2;</SelectItem>
                        <SelectItem value="M3">Metro&sup3;</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm px-3 py-2">{UNIT_MAP[product.unit] || product.unit}</p>
                  )}
                </div>
              </div>

              {editing && (
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
              )}

              {!editing && (
                <div className="flex items-center gap-4 text-sm text-gray-500">
                  {product.trackInventory ? (
                    <span className="text-green-600">Controla inventario</span>
                  ) : (
                    <span className="text-gray-400">No controla inventario</span>
                  )}
                  {product.allowNegative && (
                    <span className="text-amber-600">Permite stock negativo</span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Notas */}
          <Card>
            <CardHeader>
              <CardTitle>Notas Adicionales</CardTitle>
            </CardHeader>
            <CardContent>
              {editing ? (
                <Textarea
                  value={formData.notes}
                  onChange={(e) => handleChange('notes', e.target.value)}
                  placeholder="Notas internas sobre el producto"
                  rows={3}
                />
              ) : (
                <p className="text-sm text-gray-600">
                  {product.notes || <span className="text-gray-400 italic">Sin notas</span>}
                </p>
              )}
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
              {editing ? (
                <>
                  <div className="space-y-2">
                    <Label>Precio de Venta (ARS)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={formData.salePrice}
                      onChange={(e) => handleChange('salePrice', e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Precio de Compra (ARS)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={formData.purchasePrice}
                      onChange={(e) => handleChange('purchasePrice', e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>&Uacute;ltimo Costo</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={formData.lastCost}
                      onChange={(e) => handleChange('lastCost', e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Precio Lista (USD)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={formData.listPriceUSD}
                      onChange={(e) => handleChange('listPriceUSD', e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-500">Venta (ARS)</span>
                    <span className="text-sm font-semibold">
                      {formatCurrency(getPrice(product.prices, 'SALE', 'ARS'), 'ARS')}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-500">Compra (ARS)</span>
                    <span className="text-sm font-semibold">
                      {formatCurrency(getPrice(product.prices, 'COST', 'ARS'), 'ARS')}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-500">&Uacute;ltimo Costo</span>
                    <span className="text-sm font-semibold">
                      {formatCurrency(product.lastCost, 'ARS')}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-500">Precio Lista (USD)</span>
                    <span className="text-sm font-semibold">
                      {formatCurrency(product.listPriceUSD, 'USD')}
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Impuestos */}
          <Card>
            <CardHeader>
              <CardTitle>Impuestos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {editing ? (
                <>
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
                      <Label>Al&iacute;cuota IVA (%)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.taxRate}
                        onChange={(e) => handleChange('taxRate', e.target.value)}
                      />
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-500">Gravado</span>
                    <Badge variant={product.isTaxable ? 'default' : 'secondary'}>
                      {product.isTaxable ? 'S\u00ED' : 'No'}
                    </Badge>
                  </div>
                  {product.isTaxable && (
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-500">IVA</span>
                      <span className="text-sm font-semibold">{Number(product.taxRate)}%</span>
                    </div>
                  )}
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
              {editing ? (
                <Select value={formData.status} onValueChange={(v) => handleChange('status', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Activo</SelectItem>
                    <SelectItem value="INACTIVE">Inactivo</SelectItem>
                    <SelectItem value="DISCONTINUED">Discontinuado</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
              )}
            </CardContent>
          </Card>

          {/* Info adicional (solo vista) */}
          {!editing && (
            <Card>
              <CardHeader>
                <CardTitle>Informaci&oacute;n</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-gray-500">
                <div className="flex justify-between">
                  <span>Creado</span>
                  <span>{new Date(product.createdAt).toLocaleDateString('es-AR')}</span>
                </div>
                <div className="flex justify-between">
                  <span>Actualizado</span>
                  <span>{new Date(product.updatedAt).toLocaleDateString('es-AR')}</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Boton guardar en sidebar (modo edicion) */}
          {editing && (
            <div className="space-y-2">
              <Button className="w-full" onClick={handleSave} disabled={saving}>
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
              <Button
                variant="outline"
                className="w-full"
                onClick={handleCancel}
                disabled={saving}
              >
                Cancelar
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
