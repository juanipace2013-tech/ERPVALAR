'use client'

import { use, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  ArrowLeft,
  History,
  Info,
  TrendingUp,
  TrendingDown,
  Calendar,
  Package,
} from 'lucide-react'
import { toast } from 'sonner'

interface Product {
  id: string
  sku: string
  name: string
  description: string
  type: string
  unit: string
  stockQuantity: number
  minStock: number
  averageCost: number | null
  lastCost: number | null
  status: string
  trackInventory: boolean
  prices: Array<{
    amount: number
    priceType: string
    currency: string
  }>
}

interface StockMovement {
  id: string
  date: string
  type: string
  quantity: number
  unitCost: number
  totalCost: number
  reference: string | null
  notes: string | null
  warehouse?: {
    name: string
    code: string
  } | null
  invoice?: {
    invoiceNumber: string
  } | null
  user: {
    name: string
  }
}

const movementTypeLabels: Record<string, string> = {
  COMPRA: 'Compra',
  VENTA: 'Venta',
  AJUSTE_POSITIVO: 'Ajuste +',
  AJUSTE_NEGATIVO: 'Ajuste -',
  DEVOLUCION_CLIENTE: 'Dev. Cliente',
  DEVOLUCION_PROVEEDOR: 'Dev. Proveedor',
  TRANSFERENCIA: 'Transferencia',
}

const documentTypeLabels: Record<string, string> = {
  COMPRA: 'FAC',
  VENTA: 'FAV',
  AJUSTE_POSITIVO: 'AJI',
  AJUSTE_NEGATIVO: 'AJI',
  DEVOLUCION_CLIENTE: 'DEV',
  DEVOLUCION_PROVEEDOR: 'DEV',
  TRANSFERENCIA: 'TRA',
}

export default function ItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [product, setProduct] = useState<Product | null>(null)
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMovements, setLoadingMovements] = useState(false)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const limit = 20

  useEffect(() => {
    fetchProduct()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    if (product) {
      fetchMovements()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product, page])

  const fetchProduct = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/productos/${id}`)

      if (!response.ok) {
        throw new Error('Error al cargar producto')
      }

      const data = await response.json()
      setProduct(data)
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar el item')
      router.push('/inventario/items')
    } finally {
      setLoading(false)
    }
  }

  const fetchMovements = async () => {
    try {
      setLoadingMovements(true)
      const response = await fetch(
        `/api/inventario/productos/${id}/stock?limit=${limit}&offset=${(page - 1) * limit}`
      )

      if (!response.ok) {
        throw new Error('Error al cargar movimientos')
      }

      const data = await response.json()
      setMovements(data.movements || [])
      // Calculate total pages from movements count
      const totalMovements = data.movements?.length || 0
      setTotalPages(Math.max(1, Math.ceil(totalMovements / limit)))
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar movimientos')
    } finally {
      setLoadingMovements(false)
    }
  }

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('es-AR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatCurrency = (amount: number | null) => {
    if (amount === null) return '-'
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 2,
    }).format(amount)
  }

  const getSalePrice = () => {
    if (!product) return '-'
    const salePrice = product.prices.find(p => p.priceType === 'SALE')
    return salePrice ? formatCurrency(Number(salePrice.amount)) : '-'
  }

  const getCostPrice = () => {
    if (!product) return '-'
    const cost = product.averageCost || product.lastCost
    return formatCurrency(cost ? Number(cost) : null)
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
            onClick={() => router.push('/inventario/items')}
            className="text-blue-600 hover:text-blue-700"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-blue-900">
              {product.name}
            </h1>
            <p className="text-muted-foreground">
              Código: <span className="font-mono font-semibold text-blue-700">{product.sku}</span>
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => router.push(`/inventario/movimientos/nuevo?productId=${id}`)}
          >
            Nuevo Movimiento
          </Button>
          <Button
            className="bg-blue-600 hover:bg-blue-700"
            onClick={() => router.push(`/inventario/items/${id}/editar`)}
          >
            Editar
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-blue-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-blue-900">Stock Disponible</CardTitle>
            <Package className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-700">{product.stockQuantity}</div>
            <p className="text-xs text-muted-foreground">
              Stock mínimo: {product.minStock}
            </p>
          </CardContent>
        </Card>

        <Card className="border-blue-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-blue-900">Precio de Venta</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{getSalePrice()}</div>
            <p className="text-xs text-muted-foreground">
              Por {product.unit}
            </p>
          </CardContent>
        </Card>

        <Card className="border-blue-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-blue-900">Costo Calculado</CardTitle>
            <TrendingDown className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-700">{getCostPrice()}</div>
            <p className="text-xs text-muted-foreground">
              Costo promedio
            </p>
          </CardContent>
        </Card>

        <Card className="border-blue-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-blue-900">Movimientos</CardTitle>
            <History className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{movements.length}</div>
            <p className="text-xs text-muted-foreground">
              Total registrados
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="movimientos" className="w-full">
        <TabsList className="bg-blue-50 border-blue-200">
          <TabsTrigger value="movimientos" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white">
            <History className="mr-2 h-4 w-4" />
            Movimientos
          </TabsTrigger>
          <TabsTrigger value="info" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white">
            <Info className="mr-2 h-4 w-4" />
            Información general
          </TabsTrigger>
        </TabsList>

        <TabsContent value="movimientos" className="mt-6">
          <Card className="border-blue-200">
            <CardContent className="p-6">
              <div className="mb-4">
                <h3 className="text-lg font-semibold text-blue-900 mb-1">Historial de Movimientos</h3>
                <p className="text-sm text-muted-foreground">
                  Registro completo de entradas y salidas de stock
                </p>
              </div>

              {loadingMovements ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
              ) : movements.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <History className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No hay movimientos registrados</p>
                </div>
              ) : (
                <>
                  <div className="rounded-lg border border-blue-100 overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-blue-50 hover:bg-blue-50">
                          <TableHead className="font-semibold text-blue-900">Fecha</TableHead>
                          <TableHead className="font-semibold text-blue-900">Depósito</TableHead>
                          <TableHead className="font-semibold text-blue-900">Descripción</TableHead>
                          <TableHead className="font-semibold text-blue-900">TipoDoc</TableHead>
                          <TableHead className="text-right font-semibold text-blue-900">Precio</TableHead>
                          <TableHead className="text-right font-semibold text-blue-900">Cantidad</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {movements.map((movement) => (
                          <TableRow key={movement.id} className="hover:bg-blue-50">
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Calendar className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm">{formatDate(movement.date)}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className="text-sm">
                                {movement.warehouse?.name || 'Principal'}
                              </span>
                            </TableCell>
                            <TableCell>
                              <div>
                                <div className="font-medium text-sm">
                                  {movementTypeLabels[movement.type] || movement.type}
                                </div>
                                {movement.notes && (
                                  <div className="text-xs text-muted-foreground">
                                    {movement.notes}
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="font-mono text-xs">
                                {documentTypeLabels[movement.type] || 'DOC'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <span className="text-sm">
                                {formatCurrency(movement.unitCost)}
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              <Badge
                                variant={movement.quantity > 0 ? 'default' : 'destructive'}
                                className={movement.quantity > 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}
                              >
                                <span className="flex items-center gap-1 font-semibold">
                                  {movement.quantity > 0 ? (
                                    <TrendingUp className="h-3 w-3" />
                                  ) : (
                                    <TrendingDown className="h-3 w-3" />
                                  )}
                                  {Math.abs(movement.quantity)}
                                </span>
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="mt-4 flex items-center justify-between">
                      <div className="text-sm text-muted-foreground">
                        Mostrando {movements.length} movimientos
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
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="info" className="mt-6">
          <Card className="border-blue-200">
            <CardContent className="p-6">
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-blue-900 mb-4">Información General</h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Código SKU</label>
                      <p className="text-base font-mono font-semibold text-blue-700">{product.sku}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Nombre</label>
                      <p className="text-base font-semibold">{product.name}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Tipo</label>
                      <p className="text-base">{product.type}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Unidad de Medida</label>
                      <p className="text-base">{product.unit}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Estado</label>
                      <p className="text-base">{product.status}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Trackea Inventario</label>
                      <p className="text-base">{product.trackInventory ? 'Sí' : 'No'}</p>
                    </div>
                  </div>
                </div>

                {product.description && (
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Descripción</label>
                    <p className="text-base mt-1">{product.description}</p>
                  </div>
                )}

                <div>
                  <h4 className="text-md font-semibold text-blue-900 mb-3">Precios</h4>
                  <div className="space-y-2">
                    {product.prices.map((price, index) => (
                      <div key={index} className="flex justify-between items-center border-b pb-2">
                        <span className="text-sm text-muted-foreground">{price.priceType}</span>
                        <span className="font-semibold">
                          {formatCurrency(Number(price.amount))}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
