'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Package, Plus, Search, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'

interface Product {
  id: string
  sku: string
  name: string
  stockQuantity: number
  minStock: number
  status: string
  unit: string
  prices: Array<{
    amount: number
    priceType: string
    currency: string
  }>
}

const statusLabels: Record<string, string> = {
  ACTIVE: 'Activo',
  INACTIVE: 'Inactivo',
  DISCONTINUED: 'Discontinuado',
}

const statusColors: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-800',
  INACTIVE: 'bg-gray-100 text-gray-800',
  DISCONTINUED: 'bg-red-100 text-red-800',
}

export default function ProductosPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetchProducts()
  }, [])

  const fetchProducts = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/productos?limit=100')

      if (!response.ok) {
        throw new Error('Error al cargar productos')
      }

      const data = await response.json()
      setProducts(data.products || [])
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar productos')
    } finally {
      setLoading(false)
    }
  }

  const filteredProducts = products.filter(product =>
    product.name.toLowerCase().includes(search.toLowerCase()) ||
    product.sku.toLowerCase().includes(search.toLowerCase())
  )

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: currency || 'ARS',
    }).format(amount)
  }

  const getStockStatus = (product: Product) => {
    if (product.stockQuantity === 0) {
      return { label: 'Sin stock', color: 'text-red-600', icon: AlertTriangle }
    }
    if (product.stockQuantity <= product.minStock) {
      return { label: 'Stock bajo', color: 'text-orange-600', icon: AlertTriangle }
    }
    return { label: 'Stock OK', color: 'text-green-600', icon: CheckCircle2 }
  }

  const getSalePrice = (product: Product) => {
    const salePrice = product.prices.find(p => p.priceType === 'SALE')
    return salePrice ? formatCurrency(Number(salePrice.amount), salePrice.currency) : '-'
  }

  const lowStockCount = products.filter(p => p.stockQuantity <= p.minStock && p.stockQuantity > 0).length
  const outOfStockCount = products.filter(p => p.stockQuantity === 0).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Productos</h1>
          <p className="text-muted-foreground">
            Gestión de productos y control de stock
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/productos/nuevo">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Producto
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Productos</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{products.length}</div>
            <p className="text-xs text-muted-foreground">
              Productos registrados
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Activos</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {products.filter(p => p.status === 'ACTIVE').length}
            </div>
            <p className="text-xs text-muted-foreground">
              Disponibles para venta
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Stock Bajo</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              {lowStockCount}
            </div>
            <p className="text-xs text-muted-foreground">
              Requieren reposición
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sin Stock</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {outOfStockCount}
            </div>
            <p className="text-xs text-muted-foreground">
              Agotados
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <Card>
        <CardHeader>
          <CardTitle>Listado de Productos</CardTitle>
          <CardDescription>
            Búsqueda y gestión de productos
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nombre o SKU..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Package className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                {search ? 'No se encontraron productos' : 'No hay productos registrados'}
              </p>
              {!search && (
                <Link href="/productos/nuevo">
                  <Button className="mt-4" variant="outline">
                    <Plus className="mr-2 h-4 w-4" />
                    Crear primer producto
                  </Button>
                </Link>
              )}
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead className="text-right">Mín. Stock</TableHead>
                    <TableHead>Estado Stock</TableHead>
                    <TableHead className="text-right">Precio Venta</TableHead>
                    <TableHead>Unidad</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProducts.map((product) => {
                    const stockStatus = getStockStatus(product)
                    const StockIcon = stockStatus.icon

                    return (
                      <TableRow key={product.id}>
                        <TableCell className="font-mono text-sm">
                          {product.sku}
                        </TableCell>
                        <TableCell className="font-medium">
                          <Link
                            href={`/productos/${product.id}`}
                            className="hover:underline"
                          >
                            {product.name}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Badge className={statusColors[product.status]}>
                            {statusLabels[product.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {product.stockQuantity}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {product.minStock}
                        </TableCell>
                        <TableCell>
                          <div className={`flex items-center gap-2 ${stockStatus.color}`}>
                            <StockIcon className="h-4 w-4" />
                            <span className="text-sm font-medium">{stockStatus.label}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {getSalePrice(product)}
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground">{product.unit}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Link href={`/inventario/productos/${product.id}/stock`}>
                            <Button variant="ghost" size="sm">
                              Ver Stock
                            </Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
