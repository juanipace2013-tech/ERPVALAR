'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Plus,
  Search,
  FileSpreadsheet,
  TrendingUp,
  Settings,
  Upload,
  DollarSign,
  Package,
} from 'lucide-react'
import { toast } from 'sonner'

interface Product {
  id: string
  sku: string
  name: string
  type: string
  unit: string
  stockQuantity: number
  averageCost: number | null
  lastCost: number | null
  status: string
  prices: Array<{
    amount: number
    priceType: string
    currency: string
  }>
}

const productTypeLabels: Record<string, string> = {
  PRODUCT: 'Producto',
  SERVICE: 'Servicio',
  COMBO: 'Combo',
}

const productTypeColors: Record<string, string> = {
  PRODUCT: 'bg-blue-100 text-blue-800',
  SERVICE: 'bg-purple-100 text-purple-800',
  COMBO: 'bg-green-100 text-green-800',
}

export default function ItemsInventarioPage() {
  const router = useRouter()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('ALL')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const limit = 20

  useEffect(() => {
    fetchProducts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, typeFilter])

  const fetchProducts = async () => {
    try {
      setLoading(true)
      let url = `/api/productos?page=${page}&limit=${limit}`

      if (typeFilter !== 'ALL') {
        url += `&type=${typeFilter}`
      }

      if (search) {
        url += `&search=${encodeURIComponent(search)}`
      }

      const response = await fetch(url)

      if (!response.ok) {
        throw new Error('Error al cargar productos')
      }

      const data = await response.json()
      setProducts(data.products || [])
      setTotalPages(data.pagination?.totalPages || 1)
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar items de inventario')
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = () => {
    setPage(1)
    fetchProducts()
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  const formatCurrency = (amount: number | null, currency: string = 'ARS') => {
    if (amount === null) return '-'
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(amount)
  }

  const getSalePrice = (product: Product) => {
    const salePrice = product.prices.find(p => p.priceType === 'SALE')
    return salePrice ? formatCurrency(Number(salePrice.amount), salePrice.currency) : '-'
  }

  const getCalculatedCost = (product: Product) => {
    const cost = product.averageCost || product.lastCost
    return formatCurrency(cost ? Number(cost) : null)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-blue-900">Inventario</h1>
          <p className="text-muted-foreground">
            Gestión completa de items de inventario
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => toast.info('Próximamente')}>
            <TrendingUp className="mr-2 h-4 w-4" />
            Actualizar precios
          </Button>
          <Button variant="outline" onClick={() => toast.info('Próximamente')}>
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Reportes
          </Button>
          <Link href="/inventario/items/importar">
            <Button variant="outline">
              <Upload className="mr-2 h-4 w-4" />
              Importar items
            </Button>
          </Link>
          <Link href="/inventario/movimientos/nuevo">
            <Button variant="outline">
              <Package className="mr-2 h-4 w-4" />
              Nuevo Movimiento
            </Button>
          </Link>
          <Link href="/inventario/items/nuevo">
            <Button className="bg-blue-600 hover:bg-blue-700">
              <Plus className="mr-2 h-4 w-4" />
              Agregar Item
            </Button>
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="items" className="w-full">
        <TabsList className="bg-blue-50 border-blue-200">
          <TabsTrigger value="items" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white">
            <Package className="mr-2 h-4 w-4" />
            Items de inventario
          </TabsTrigger>
          <TabsTrigger value="config" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white">
            <Settings className="mr-2 h-4 w-4" />
            Configuración de inventario
          </TabsTrigger>
          <TabsTrigger value="prices" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white">
            <DollarSign className="mr-2 h-4 w-4" />
            Listas de precios
          </TabsTrigger>
        </TabsList>

        <TabsContent value="items" className="mt-6">
          <Card className="border-blue-200">
            <CardContent className="p-6">
              {/* Search and Filters */}
              <div className="mb-6 flex gap-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar por código o descripción..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyPress={handleKeyPress}
                    className="pl-10"
                  />
                </div>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Todos los tipos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Todos los tipos</SelectItem>
                    <SelectItem value="PRODUCT">Productos</SelectItem>
                    <SelectItem value="SERVICE">Servicios</SelectItem>
                    <SelectItem value="COMBO">Combos</SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={handleSearch} className="bg-blue-600 hover:bg-blue-700">
                  <Search className="mr-2 h-4 w-4" />
                  Buscar
                </Button>
              </div>

              {/* Table */}
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
              ) : products.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Package className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground text-lg">
                    {search ? 'No se encontraron items' : 'No hay items registrados'}
                  </p>
                  {!search && (
                    <Link href="/inventario/items/nuevo">
                      <Button className="mt-4 bg-blue-600 hover:bg-blue-700">
                        <Plus className="mr-2 h-4 w-4" />
                        Agregar primer item
                      </Button>
                    </Link>
                  )}
                </div>
              ) : (
                <>
                  <div className="rounded-lg border border-blue-100 overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-blue-50 hover:bg-blue-50">
                          <TableHead className="font-semibold text-blue-900">Código</TableHead>
                          <TableHead className="font-semibold text-blue-900">Descripción</TableHead>
                          <TableHead className="font-semibold text-blue-900">Tipo</TableHead>
                          <TableHead className="font-semibold text-blue-900">UM</TableHead>
                          <TableHead className="text-right font-semibold text-blue-900">P. Venta</TableHead>
                          <TableHead className="text-right font-semibold text-blue-900">Cto. Calculado</TableHead>
                          <TableHead className="text-right font-semibold text-blue-900">Disponible</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {products.map((product) => (
                          <TableRow
                            key={product.id}
                            className="cursor-pointer hover:bg-blue-50 transition-colors"
                            onClick={() => router.push(`/inventario/items/${product.id}`)}
                          >
                            <TableCell className="font-mono text-sm font-medium text-blue-700">
                              {product.sku}
                            </TableCell>
                            <TableCell>
                              <div className="font-medium text-gray-900">{product.name}</div>
                            </TableCell>
                            <TableCell>
                              <Badge className={productTypeColors[product.type] || 'bg-gray-100 text-gray-800'}>
                                {productTypeLabels[product.type] || product.type}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <span className="text-sm text-gray-600">{product.unit}</span>
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {getSalePrice(product)}
                            </TableCell>
                            <TableCell className="text-right text-gray-600">
                              {getCalculatedCost(product)}
                            </TableCell>
                            <TableCell className="text-right">
                              <Badge
                                variant={product.stockQuantity > 0 ? 'default' : 'destructive'}
                                className={product.stockQuantity > 0 ? 'bg-green-100 text-green-800' : ''}
                              >
                                {product.stockQuantity}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Pagination */}
                  <div className="mt-4 flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">
                      Mostrando {products.length} items
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1}
                      >
                        Anterior
                      </Button>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">
                          Página {page} de {totalPages}
                        </span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages}
                      >
                        Siguiente
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="config" className="mt-6">
          <Card className="border-blue-200">
            <CardContent className="p-6">
              <div className="text-center py-12">
                <Settings className="h-12 w-12 text-blue-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">Configuración de Inventario</h3>
                <p className="text-muted-foreground">
                  Próximamente: Gestión de depósitos, configuración de costos y más.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="prices" className="mt-6">
          <Card className="border-blue-200">
            <CardContent className="p-6">
              <div className="text-center py-12">
                <DollarSign className="h-12 w-12 text-blue-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">Listas de Precios</h3>
                <p className="text-muted-foreground">
                  Próximamente: Gestión de múltiples listas de precios.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
