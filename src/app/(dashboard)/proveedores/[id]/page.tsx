'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Checkbox } from '@/components/ui/checkbox'
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
import {
  ArrowLeft,
  Save,
  Loader2,
  Pencil,
  X as XIcon,
  Info,
  Package,
  ShoppingCart,
  StickyNote,
  Star,
} from 'lucide-react'
import { toast } from 'sonner'

interface Supplier {
  id: string
  name: string
  legalName: string | null
  taxId: string | null
  email: string | null
  phone: string | null
  mobile: string | null
  website: string | null
  address: string | null
  city: string | null
  province: string | null
  postalCode: string | null
  discount: number
  paymentDays: number
  balance: number
  category: string | null
  brands: string[]
  status: string
  isPreferred: boolean
  paymentTerms: string | null
  accountNumber: string | null
  notes: string | null
  internalNotes: string | null
  buyerUser: {
    id: string
    name: string
    email: string
  } | null
  createdAt: string
  updatedAt: string
  _count?: {
    products: number
  }
}

interface Product {
  id: string
  sku: string
  name: string
  brand: string | null
  stockQuantity: number
  lastCost: number | null
  status: string
}

interface AccountMovement {
  id: string
  type: 'PURCHASE_ORDER' | 'PAYMENT'
  date: string
  reference: string
  description: string
  status: string
  currency: string
  debit: number
  credit: number
  balance: number
  items?: Array<{
    product: string
    quantity: number
    unitCost: number
    subtotal: number
  }>
  user: string
  paidAmount?: number
  pendingAmount?: number
  method?: string
  notes?: string | null
}

interface AccountStats {
  totalPurchases: number
  totalPaid: number
  currentBalance: number
  pendingOrders: number
  totalOrders: number
  totalPayments: number
}

const PROVINCIAS = [
  'Buenos Aires',
  'CABA',
  'Catamarca',
  'Chaco',
  'Chubut',
  'Córdoba',
  'Corrientes',
  'Entre Ríos',
  'Formosa',
  'Jujuy',
  'La Pampa',
  'La Rioja',
  'Mendoza',
  'Misiones',
  'Neuquén',
  'Río Negro',
  'Salta',
  'San Juan',
  'San Luis',
  'Santa Cruz',
  'Santa Fe',
  'Santiago del Estero',
  'Tierra del Fuego',
  'Tucumán',
]

export default function SupplierDetailPage() {
  const router = useRouter()
  const params = useParams()
  const supplierId = params.id as string

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [supplier, setSupplier] = useState<Supplier | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [accountMovements, setAccountMovements] = useState<AccountMovement[]>([])
  const [accountStats, setAccountStats] = useState<AccountStats | null>(null)
  const [loadingMovements, setLoadingMovements] = useState(false)
  const [brandInput, setBrandInput] = useState('')

  const [formData, setFormData] = useState<Partial<Supplier>>({})

  useEffect(() => {
    fetchSupplier()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId])

  const fetchSupplier = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/proveedores/${supplierId}`)
      if (!response.ok) {
        throw new Error('Proveedor no encontrado')
      }
      const data = await response.json()
      setSupplier(data)
      setFormData(data)
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar proveedor')
      router.push('/proveedores')
    } finally {
      setLoading(false)
    }
  }

  const fetchProducts = async () => {
    try {
      setLoadingProducts(true)
      const response = await fetch(`/api/productos?supplierId=${supplierId}`)
      if (response.ok) {
        const data = await response.json()
        setProducts(data.products || [])
      }
    } catch (error) {
      console.error('Error fetching products:', error)
      toast.error('Error al cargar productos')
    } finally {
      setLoadingProducts(false)
    }
  }

  const fetchAccountMovements = async () => {
    try {
      setLoadingMovements(true)
      const response = await fetch(`/api/proveedores/${supplierId}/movimientos`)
      if (response.ok) {
        const data = await response.json()
        setAccountMovements(data.movements || [])
        setAccountStats(data.stats || null)
      } else {
        toast.error('Error al cargar movimientos de cuenta')
      }
    } catch (error) {
      console.error('Error fetching account movements:', error)
      toast.error('Error al cargar movimientos de cuenta')
    } finally {
      setLoadingMovements(false)
    }
  }

  const handleSave = async () => {
    try {
      setSaving(true)

      const response = await fetch(`/api/proveedores/${supplierId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || 'Error al actualizar proveedor')
      }

      const updatedSupplier = await response.json()
      setSupplier(updatedSupplier)
      setEditing(false)
      toast.success('Proveedor actualizado exitosamente')
    } catch (error) {
      console.error('Error:', error)
      toast.error(error instanceof Error ? error.message : 'Error al actualizar proveedor')
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setFormData(supplier || {})
    setEditing(false)
  }

  const addBrand = () => {
    if (brandInput.trim() && !formData.brands?.includes(brandInput.trim())) {
      setFormData({
        ...formData,
        brands: [...(formData.brands || []), brandInput.trim()],
      })
      setBrandInput('')
    }
  }

  const removeBrand = (brand: string) => {
    setFormData({
      ...formData,
      brands: formData.brands?.filter((b) => b !== brand) || [],
    })
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('es-AR', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  }

  const getStatusLabel = (status: string) => {
    const statusLabels: Record<string, string> = {
      ACTIVE: 'Activo',
      INACTIVE: 'Inactivo',
      BLOCKED: 'Bloqueado',
    }
    return statusLabels[status] || status
  }

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      ACTIVE: 'bg-green-100 text-green-800',
      INACTIVE: 'bg-gray-100 text-gray-800',
      BLOCKED: 'bg-red-100 text-red-800',
    }
    return colors[status] || 'bg-gray-100 text-gray-800'
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

  if (!supplier) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Proveedor no encontrado</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push('/proveedores')}
            className="text-blue-600 hover:text-blue-700"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-bold tracking-tight text-blue-900">
                {supplier.name}
              </h1>
              {supplier.isPreferred && (
                <Star className="h-6 w-6 text-yellow-500 fill-yellow-500" />
              )}
            </div>
            <p className="text-muted-foreground">
              {supplier.legalName || 'Sin razón social'}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {editing ? (
            <>
              <Button variant="outline" onClick={handleCancel} disabled={saving}>
                <XIcon className="h-4 w-4 mr-2" />
                Cancelar
              </Button>
              <Button
                className="bg-blue-600 hover:bg-blue-700"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Guardando...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Guardar
                  </>
                )}
              </Button>
            </>
          ) : (
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-4 w-4 mr-2" />
              Editar
            </Button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-blue-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Saldo (lo que debemos)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-900">
              $ {formatCurrency(Number(supplier.balance))}
            </div>
          </CardContent>
        </Card>
        <Card className="border-blue-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Descuento
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {supplier.discount}%
            </div>
          </CardContent>
        </Card>
        <Card className="border-blue-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Plazo de Pago
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">
              {supplier.paymentDays} días
            </div>
          </CardContent>
        </Card>
        <Card className="border-blue-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Estado
            </CardTitle>
          </CardHeader>
          <CardContent>
            <span className={`px-3 py-1 rounded-full text-sm font-semibold ${getStatusColor(supplier.status)}`}>
              {getStatusLabel(supplier.status)}
            </span>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Card className="border-blue-200">
        <CardContent className="p-6">
          <Tabs defaultValue="info" className="w-full">
            <TabsList className="bg-blue-50">
              <TabsTrigger
                value="info"
                className="data-[state=active]:bg-blue-600 data-[state=active]:text-white"
              >
                <Info className="h-4 w-4 mr-2" />
                Información general
              </TabsTrigger>
              <TabsTrigger
                value="products"
                className="data-[state=active]:bg-blue-600 data-[state=active]:text-white"
                onClick={() => {
                  if (products.length === 0 && !loadingProducts) {
                    fetchProducts()
                  }
                }}
              >
                <Package className="h-4 w-4 mr-2" />
                Productos
              </TabsTrigger>
              <TabsTrigger
                value="purchases"
                className="data-[state=active]:bg-blue-600 data-[state=active]:text-white"
                onClick={() => {
                  if (accountMovements.length === 0 && !loadingMovements) {
                    fetchAccountMovements()
                  }
                }}
              >
                <ShoppingCart className="h-4 w-4 mr-2" />
                Cuenta corriente
              </TabsTrigger>
              <TabsTrigger
                value="notes"
                className="data-[state=active]:bg-blue-600 data-[state=active]:text-white"
              >
                <StickyNote className="h-4 w-4 mr-2" />
                Notas
              </TabsTrigger>
            </TabsList>

            {/* Tab: Información general */}
            <TabsContent value="info" className="mt-6">
              <div className="space-y-6">
                <h3 className="text-lg font-semibold text-blue-900">
                  Información del proveedor
                </h3>

                <div className="grid gap-6 md:grid-cols-2">
                  {/* Datos básicos */}
                  <div className="space-y-4">
                    <h4 className="font-medium text-blue-900">Datos básicos</h4>

                    <div className="space-y-2">
                      <Label>Nombre comercial</Label>
                      {editing ? (
                        <Input
                          value={formData.name || ''}
                          onChange={(e) =>
                            setFormData({ ...formData, name: e.target.value })
                          }
                        />
                      ) : (
                        <p className="text-sm">{supplier.name}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>Razón social</Label>
                      {editing ? (
                        <Input
                          value={formData.legalName || ''}
                          onChange={(e) =>
                            setFormData({ ...formData, legalName: e.target.value })
                          }
                        />
                      ) : (
                        <p className="text-sm">{supplier.legalName || '-'}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>CUIT</Label>
                      {editing ? (
                        <Input
                          value={formData.taxId || ''}
                          onChange={(e) =>
                            setFormData({ ...formData, taxId: e.target.value })
                          }
                        />
                      ) : (
                        <p className="text-sm">{supplier.taxId || '-'}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>Categoría</Label>
                      {editing ? (
                        <Input
                          value={formData.category || ''}
                          onChange={(e) =>
                            setFormData({ ...formData, category: e.target.value })
                          }
                        />
                      ) : (
                        <p className="text-sm">{supplier.category || '-'}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>Marcas</Label>
                      {editing ? (
                        <div className="space-y-2">
                          <div className="flex gap-2">
                            <Input
                              value={brandInput}
                              onChange={(e) => setBrandInput(e.target.value)}
                              onKeyPress={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  addBrand()
                                }
                              }}
                              placeholder="Agregar marca"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              onClick={addBrand}
                              size="sm"
                            >
                              Agregar
                            </Button>
                          </div>
                          {formData.brands && formData.brands.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {formData.brands.map((brand, idx) => (
                                <div
                                  key={idx}
                                  className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-blue-100 text-blue-800 text-sm"
                                >
                                  {brand}
                                  <button
                                    type="button"
                                    onClick={() => removeBrand(brand)}
                                    className="ml-1 hover:text-blue-900"
                                  >
                                    <XIcon className="h-3 w-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {supplier.brands.length > 0 ? (
                            supplier.brands.map((brand, idx) => (
                              <span
                                key={idx}
                                className="inline-flex items-center px-3 py-1 rounded-full bg-blue-100 text-blue-800 text-sm"
                              >
                                {brand}
                              </span>
                            ))
                          ) : (
                            <p className="text-sm text-muted-foreground">-</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Contacto */}
                  <div className="space-y-4">
                    <h4 className="font-medium text-blue-900">Contacto</h4>

                    <div className="space-y-2">
                      <Label>Email</Label>
                      {editing ? (
                        <Input
                          type="email"
                          value={formData.email || ''}
                          onChange={(e) =>
                            setFormData({ ...formData, email: e.target.value })
                          }
                        />
                      ) : (
                        <p className="text-sm">{supplier.email || '-'}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>Teléfono</Label>
                      {editing ? (
                        <Input
                          value={formData.phone || ''}
                          onChange={(e) =>
                            setFormData({ ...formData, phone: e.target.value })
                          }
                        />
                      ) : (
                        <p className="text-sm">{supplier.phone || '-'}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>Celular</Label>
                      {editing ? (
                        <Input
                          value={formData.mobile || ''}
                          onChange={(e) =>
                            setFormData({ ...formData, mobile: e.target.value })
                          }
                        />
                      ) : (
                        <p className="text-sm">{supplier.mobile || '-'}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>Sitio web</Label>
                      {editing ? (
                        <Input
                          type="url"
                          value={formData.website || ''}
                          onChange={(e) =>
                            setFormData({ ...formData, website: e.target.value })
                          }
                        />
                      ) : (
                        <p className="text-sm">
                          {supplier.website ? (
                            <a
                              href={supplier.website}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline"
                            >
                              {supplier.website}
                            </a>
                          ) : (
                            '-'
                          )}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Dirección */}
                  <div className="space-y-4">
                    <h4 className="font-medium text-blue-900">Dirección</h4>

                    <div className="space-y-2">
                      <Label>Calle y número</Label>
                      {editing ? (
                        <Input
                          value={formData.address || ''}
                          onChange={(e) =>
                            setFormData({ ...formData, address: e.target.value })
                          }
                        />
                      ) : (
                        <p className="text-sm">{supplier.address || '-'}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>Ciudad</Label>
                      {editing ? (
                        <Input
                          value={formData.city || ''}
                          onChange={(e) =>
                            setFormData({ ...formData, city: e.target.value })
                          }
                        />
                      ) : (
                        <p className="text-sm">{supplier.city || '-'}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>Provincia</Label>
                      {editing ? (
                        <Select
                          value={formData.province || ''}
                          onValueChange={(value) =>
                            setFormData({ ...formData, province: value })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar..." />
                          </SelectTrigger>
                          <SelectContent>
                            {PROVINCIAS.map((prov) => (
                              <SelectItem key={prov} value={prov}>
                                {prov}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <p className="text-sm">{supplier.province || '-'}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>Código postal</Label>
                      {editing ? (
                        <Input
                          value={formData.postalCode || ''}
                          onChange={(e) =>
                            setFormData({ ...formData, postalCode: e.target.value })
                          }
                        />
                      ) : (
                        <p className="text-sm">{supplier.postalCode || '-'}</p>
                      )}
                    </div>
                  </div>

                  {/* Información comercial */}
                  <div className="space-y-4">
                    <h4 className="font-medium text-blue-900">Información comercial</h4>

                    <div className="space-y-2">
                      <Label>Descuento (%)</Label>
                      {editing ? (
                        <Input
                          type="number"
                          step="0.01"
                          value={formData.discount || ''}
                          onChange={(e) =>
                            setFormData({ ...formData, discount: parseFloat(e.target.value) })
                          }
                        />
                      ) : (
                        <p className="text-sm">{supplier.discount}%</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>Plazo de pago (días)</Label>
                      {editing ? (
                        <Input
                          type="number"
                          value={formData.paymentDays || ''}
                          onChange={(e) =>
                            setFormData({ ...formData, paymentDays: parseInt(e.target.value) })
                          }
                        />
                      ) : (
                        <p className="text-sm">{supplier.paymentDays} días</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>Condiciones de pago</Label>
                      {editing ? (
                        <Input
                          value={formData.paymentTerms || ''}
                          onChange={(e) =>
                            setFormData({ ...formData, paymentTerms: e.target.value })
                          }
                        />
                      ) : (
                        <p className="text-sm">{supplier.paymentTerms || '-'}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>Número de cuenta</Label>
                      {editing ? (
                        <Input
                          value={formData.accountNumber || ''}
                          onChange={(e) =>
                            setFormData({ ...formData, accountNumber: e.target.value })
                          }
                        />
                      ) : (
                        <p className="text-sm">{supplier.accountNumber || '-'}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>Estado</Label>
                      {editing ? (
                        <Select
                          value={formData.status || ''}
                          onValueChange={(value) =>
                            setFormData({ ...formData, status: value })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ACTIVE">Activo</SelectItem>
                            <SelectItem value="INACTIVE">Inactivo</SelectItem>
                            <SelectItem value="BLOCKED">Bloqueado</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className={`px-3 py-1 rounded-full text-sm font-semibold ${getStatusColor(supplier.status)}`}>
                          {getStatusLabel(supplier.status)}
                        </span>
                      )}
                    </div>

                    {editing && (
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="isPreferred"
                          checked={formData.isPreferred || false}
                          onCheckedChange={(checked) =>
                            setFormData({ ...formData, isPreferred: checked === true })
                          }
                        />
                        <Label htmlFor="isPreferred" className="cursor-pointer">
                          Proveedor preferido
                        </Label>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Tab: Productos */}
            <TabsContent value="products" className="mt-6">
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-blue-900">
                  Productos del proveedor
                </h3>

                {loadingProducts ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                  </div>
                ) : products.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <p>No hay productos asociados a este proveedor</p>
                  </div>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-blue-50">
                          <TableHead className="font-semibold text-blue-900">SKU</TableHead>
                          <TableHead className="font-semibold text-blue-900">Producto</TableHead>
                          <TableHead className="font-semibold text-blue-900">Marca</TableHead>
                          <TableHead className="text-right font-semibold text-blue-900">Stock</TableHead>
                          <TableHead className="text-right font-semibold text-blue-900">Último Costo</TableHead>
                          <TableHead className="font-semibold text-blue-900">Estado</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {products.map((product) => (
                          <TableRow
                            key={product.id}
                            className="cursor-pointer hover:bg-blue-50"
                            onClick={() => router.push(`/productos/${product.id}`)}
                          >
                            <TableCell className="font-mono text-sm">{product.sku}</TableCell>
                            <TableCell className="font-medium">{product.name}</TableCell>
                            <TableCell>{product.brand || '-'}</TableCell>
                            <TableCell className="text-right">{product.stockQuantity}</TableCell>
                            <TableCell className="text-right font-mono">
                              {product.lastCost ? `$ ${formatCurrency(Number(product.lastCost))}` : '-'}
                            </TableCell>
                            <TableCell>
                              <span className={`px-2 py-1 text-xs font-semibold rounded ${
                                product.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                              }`}>
                                {product.status === 'ACTIVE' ? 'Activo' : 'Inactivo'}
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Tab: Cuenta Corriente */}
            <TabsContent value="purchases" className="mt-6">
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-blue-900">
                    Cuenta Corriente del Proveedor
                  </h3>
                </div>

                {/* Stats */}
                {accountStats && (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <Card className="border-blue-200">
                      <CardContent className="p-4">
                        <div className="text-sm text-muted-foreground">Total Compras</div>
                        <div className="text-xl font-bold text-blue-900">
                          $ {formatCurrency(accountStats.totalPurchases)}
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="border-green-200">
                      <CardContent className="p-4">
                        <div className="text-sm text-muted-foreground">Total Pagado</div>
                        <div className="text-xl font-bold text-green-600">
                          $ {formatCurrency(accountStats.totalPaid)}
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="border-orange-200">
                      <CardContent className="p-4">
                        <div className="text-sm text-muted-foreground">Saldo Actual</div>
                        <div className="text-xl font-bold text-orange-600">
                          $ {formatCurrency(accountStats.currentBalance)}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )}

                {/* Movements Table */}
                {loadingMovements ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                  </div>
                ) : accountMovements.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <ShoppingCart className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                    <p>No hay movimientos de cuenta registrados</p>
                  </div>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-blue-50">
                          <TableHead className="font-semibold text-blue-900">Fecha</TableHead>
                          <TableHead className="font-semibold text-blue-900">Tipo</TableHead>
                          <TableHead className="font-semibold text-blue-900">Referencia</TableHead>
                          <TableHead className="font-semibold text-blue-900">Descripción</TableHead>
                          <TableHead className="text-right font-semibold text-blue-900">Debe</TableHead>
                          <TableHead className="text-right font-semibold text-blue-900">Haber</TableHead>
                          <TableHead className="text-right font-semibold text-blue-900">Saldo</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {accountMovements.map((movement) => (
                          <TableRow
                            key={movement.id}
                            className="hover:bg-blue-50 cursor-pointer"
                          >
                            <TableCell className="font-mono text-sm">
                              {formatDate(movement.date)}
                            </TableCell>
                            <TableCell>
                              <span
                                className={`px-2 py-1 text-xs font-semibold rounded ${
                                  movement.type === 'PURCHASE_ORDER'
                                    ? 'bg-orange-100 text-orange-700'
                                    : 'bg-green-100 text-green-700'
                                }`}
                              >
                                {movement.type === 'PURCHASE_ORDER' ? 'Compra' : 'Pago'}
                              </span>
                            </TableCell>
                            <TableCell className="font-mono text-sm">
                              {movement.reference}
                            </TableCell>
                            <TableCell className="max-w-xs">
                              <div>
                                {movement.description}
                                {movement.items && movement.items.length > 0 && (
                                  <div className="text-xs text-muted-foreground mt-1">
                                    {movement.items.length} producto(s)
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-mono text-orange-600">
                              {movement.debit > 0 ? formatCurrency(movement.debit) : '-'}
                            </TableCell>
                            <TableCell className="text-right font-mono text-green-600">
                              {movement.credit > 0 ? formatCurrency(movement.credit) : '-'}
                            </TableCell>
                            <TableCell className="text-right font-mono font-semibold">
                              {formatCurrency(movement.balance)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Tab: Notas */}
            <TabsContent value="notes" className="mt-6">
              <div className="space-y-6">
                <h3 className="text-lg font-semibold text-blue-900">
                  Notas y observaciones
                </h3>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Notas públicas</Label>
                    {editing ? (
                      <Textarea
                        rows={5}
                        value={formData.notes || ''}
                        onChange={(e) =>
                          setFormData({ ...formData, notes: e.target.value })
                        }
                        placeholder="Información general sobre el proveedor..."
                      />
                    ) : (
                      <div className="bg-gray-50 p-4 rounded-lg min-h-[100px]">
                        <p className="text-sm whitespace-pre-wrap">
                          {supplier.notes || 'Sin notas'}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label>Notas internas (privadas)</Label>
                    {editing ? (
                      <Textarea
                        rows={5}
                        value={formData.internalNotes || ''}
                        onChange={(e) =>
                          setFormData({ ...formData, internalNotes: e.target.value })
                        }
                        placeholder="Observaciones privadas, evaluaciones, etc..."
                      />
                    ) : (
                      <div className="bg-yellow-50 p-4 rounded-lg min-h-[100px] border border-yellow-200">
                        <p className="text-sm whitespace-pre-wrap">
                          {supplier.internalNotes || 'Sin notas internas'}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="pt-4 border-t">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <Label className="text-muted-foreground">Comprador asignado</Label>
                        <p className="mt-1">{supplier.buyerUser?.name || 'Sin asignar'}</p>
                      </div>
                      <div>
                        <Label className="text-muted-foreground">Fecha de creación</Label>
                        <p className="mt-1">{formatDate(supplier.createdAt)}</p>
                      </div>
                      <div>
                        <Label className="text-muted-foreground">Última actualización</Label>
                        <p className="mt-1">{formatDate(supplier.updatedAt)}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
