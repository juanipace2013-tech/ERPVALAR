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
import { Package, Plus, Search, AlertTriangle, CheckCircle2, Loader2, ChevronUp, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { formatNumber } from '@/lib/utils'
import { useColppyStock } from '@/hooks/useColppyStock'

interface Product {
  id: string
  sku: string
  name: string
  brand: string | null
  listPriceUSD: number | null
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
  const [page, setPage] = useState(1)
  const [totalProducts, setTotalProducts] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [letterFilter, setLetterFilter] = useState<string | null>(null)
  const [orderBy, setOrderBy] = useState<string>('sku')
  const [order, setOrder] = useState<'asc' | 'desc'>('asc')

  const ITEMS_PER_PAGE = 50

  // Consultar stock de Colppy para los productos de la página actual
  const productSkus = products.map(p => p.sku)
  const { stockData, loading: stockLoading } = useColppyStock(productSkus, products.length > 0)

  useEffect(() => {
    fetchProducts()
  }, [page, search, letterFilter, orderBy, order])

  const fetchProducts = async () => {
    try {
      setLoading(true)

      // Construir query params
      const params = new URLSearchParams({
        page: page.toString(),
        limit: ITEMS_PER_PAGE.toString(),
        orderBy: orderBy,
        order: order,
      })

      if (search) {
        params.append('search', search)
      }

      if (letterFilter) {
        params.append('letter', letterFilter)
      }

      const response = await fetch(`/api/productos?${params.toString()}`)

      if (!response.ok) {
        throw new Error('Error al cargar productos')
      }

      const data = await response.json()
      setProducts(data.products || [])
      setTotalProducts(data.pagination.total)
      setTotalPages(data.pagination.totalPages)
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar productos')
    } finally {
      setLoading(false)
    }
  }

  const handleSearchChange = (value: string) => {
    setSearch(value)
    setPage(1) // Reset to first page on search
  }

  const handleLetterFilter = (letter: string | null) => {
    setLetterFilter(letter)
    setPage(1) // Reset to first page on filter
  }

  const handleSort = (field: string) => {
    if (orderBy === field) {
      // Si ya está ordenando por este campo, invertir dirección
      setOrder(order === 'asc' ? 'desc' : 'asc')
    } else {
      // Si es un campo nuevo, ordenar ascendente
      setOrderBy(field)
      setOrder('asc')
    }
    setPage(1) // Reset to first page on sort
  }

  const filteredProducts = products

  // Componente helper para headers ordenables
  const SortableHeader = ({ field, children, className = '', align = 'left' }: {
    field: string
    children: React.ReactNode
    className?: string
    align?: 'left' | 'right'
  }) => {
    const isActive = orderBy === field
    const alignClass = align === 'right' ? 'text-right' : ''

    return (
      <TableHead className={`${className} ${alignClass}`}>
        <button
          onClick={() => handleSort(field)}
          className={`flex items-center gap-1 hover:text-blue-600 transition-colors ${
            align === 'right' ? 'ml-auto' : ''
          } ${isActive ? 'text-blue-600 font-semibold' : ''}`}
        >
          {children}
          {isActive && (
            order === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
          )}
        </button>
      </TableHead>
    )
  }

  const getStockStatus = (sku: string, minStock: number) => {
    const colppyStock = stockData[sku]

    // Si hay data de Colppy, usar esa
    if (colppyStock?.found) {
      const stock = colppyStock.stock || 0
      if (stock === 0) {
        return { label: 'Sin stock', color: 'text-red-600', icon: AlertTriangle }
      }
      if (stock <= minStock) {
        return { label: 'Stock bajo', color: 'text-orange-600', icon: AlertTriangle }
      }
      return { label: 'Stock OK', color: 'text-green-600', icon: CheckCircle2 }
    }

    // Si no está en Colppy
    return { label: 'No en Colppy', color: 'text-gray-500', icon: Package }
  }

  const getColppyStock = (sku: string): number | string => {
    if (stockLoading) {
      return '-'
    }
    const colppyStock = stockData[sku]
    if (colppyStock?.found) {
      return colppyStock.stock || 0
    }
    return '-'
  }

  // Stats de la página actual usando stock de Colppy
  const lowStockCount = products.filter(p => {
    const colppyStock = stockData[p.sku]
    if (colppyStock?.found) {
      const stock = colppyStock.stock || 0
      return stock > 0 && stock <= p.minStock
    }
    return false
  }).length

  const outOfStockCount = products.filter(p => {
    const colppyStock = stockData[p.sku]
    if (colppyStock?.found) {
      return (colppyStock.stock || 0) === 0
    }
    return false
  }).length

  const activeCount = products.filter(p => p.status === 'ACTIVE').length

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
            <div className="text-2xl font-bold">{totalProducts.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              Productos registrados
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Activos (página)</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {activeCount}
            </div>
            <p className="text-xs text-muted-foreground">
              En esta página
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Stock Bajo (página)</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              {lowStockCount}
            </div>
            <p className="text-xs text-muted-foreground">
              En esta página
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sin Stock (página)</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {outOfStockCount}
            </div>
            <p className="text-xs text-muted-foreground">
              En esta página
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
          {/* Barra Alfabética */}
          <div className="mb-4 pb-4 border-b">
            <div className="flex flex-wrap gap-1 items-center">
              <span className="text-sm text-muted-foreground mr-2">Filtrar por letra:</span>
              {['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'].map((letter) => (
                <Button
                  key={letter}
                  variant={letterFilter === letter ? 'default' : 'outline'}
                  size="sm"
                  className={`h-8 w-8 p-0 ${letterFilter === letter ? 'bg-blue-600 hover:bg-blue-700' : ''}`}
                  onClick={() => handleLetterFilter(letter)}
                >
                  {letter}
                </Button>
              ))}
              <span className="mx-2 text-muted-foreground">|</span>
              <Button
                variant={letterFilter === null ? 'default' : 'outline'}
                size="sm"
                className={letterFilter === null ? 'bg-blue-600 hover:bg-blue-700' : ''}
                onClick={() => handleLetterFilter(null)}
              >
                Todos
              </Button>
            </div>
          </div>

          {/* Búsqueda */}
          <div className="mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nombre o SKU..."
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          {/* Contador de resultados */}
          {!loading && totalProducts > 0 && (
            <div className="mb-4 text-sm text-muted-foreground">
              Mostrando {((page - 1) * ITEMS_PER_PAGE) + 1}-{Math.min(page * ITEMS_PER_PAGE, totalProducts)} de {totalProducts.toLocaleString()} productos
            </div>
          )}

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
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHeader field="sku" className="w-[120px]">SKU</SortableHeader>
                    <SortableHeader field="name" className="min-w-[250px]">Nombre</SortableHeader>
                    <SortableHeader field="brand" className="w-[120px]">Marca</SortableHeader>
                    <SortableHeader field="listPriceUSD" className="w-[130px]" align="right">
                      Precio Lista USD
                    </SortableHeader>
                    <TableHead className="w-[100px]">Estado</TableHead>
                    <TableHead className="text-right w-[80px]">Stock</TableHead>
                    <TableHead className="w-[140px]">Estado Stock</TableHead>
                    <TableHead className="w-[80px]">Unidad</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProducts.map((product) => {
                    const stockStatus = getStockStatus(product.sku, product.minStock)
                    const StockIcon = stockStatus.icon
                    const colppyStock = getColppyStock(product.sku)

                    return (
                      <TableRow key={product.id}>
                        <TableCell className="font-mono text-sm">
                          {product.sku}
                        </TableCell>
                        <TableCell className="font-medium">
                          <Link
                            href={`/productos/${product.id}`}
                            className="hover:underline block truncate max-w-[250px]"
                            title={product.name}
                          >
                            {product.name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          <span className="truncate block max-w-[120px]" title={product.brand || '-'}>
                            {product.brand || '-'}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold">
                          {product.listPriceUSD
                            ? `USD ${formatNumber(product.listPriceUSD)}`
                            : '-'}
                        </TableCell>
                        <TableCell>
                          <Badge className={statusColors[product.status]}>
                            {statusLabels[product.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {stockLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin inline" />
                          ) : (
                            colppyStock
                          )}
                        </TableCell>
                        <TableCell>
                          <div className={`flex items-center gap-2 ${stockStatus.color}`}>
                            <StockIcon className="h-4 w-4" />
                            <span className="text-sm font-medium whitespace-nowrap">{stockStatus.label}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground">{product.unit}</span>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Paginación */}
          {!loading && totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(page - 1)}
                disabled={page === 1}
              >
                &lt;
              </Button>

              {/* Primera página */}
              {page > 3 && (
                <>
                  <Button
                    variant={page === 1 ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setPage(1)}
                    className={page === 1 ? 'bg-blue-600 hover:bg-blue-700' : ''}
                  >
                    1
                  </Button>
                  {page > 4 && <span className="px-2">...</span>}
                </>
              )}

              {/* Páginas cercanas */}
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p >= page - 2 && p <= page + 2)
                .map(p => (
                  <Button
                    key={p}
                    variant={p === page ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setPage(p)}
                    className={p === page ? 'bg-blue-600 hover:bg-blue-700' : ''}
                  >
                    {p}
                  </Button>
                ))}

              {/* Última página */}
              {page < totalPages - 2 && (
                <>
                  {page < totalPages - 3 && <span className="px-2">...</span>}
                  <Button
                    variant={page === totalPages ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setPage(totalPages)}
                    className={page === totalPages ? 'bg-blue-600 hover:bg-blue-700' : ''}
                  >
                    {totalPages}
                  </Button>
                </>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(page + 1)}
                disabled={page === totalPages}
              >
                &gt;
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
