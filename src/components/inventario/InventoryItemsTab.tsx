'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import { Search, Package, Check, X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

interface Product {
  id: string
  sku: string
  name: string
  type: string
  unit: string
  stockQuantity: number
  minStock: number
  maxStock: number | null
  averageCost: number | null
  lastCost: number | null
  status: string
  supplier: { id: string; name: string } | null
  prices: Array<{ amount: number; priceType: string; currency: string }>
}

interface MovementHistory {
  id: string
  type: string
  quantity: number
  unitCost: number
  stockBefore: number
  stockAfter: number
  date: string
  reference: string | null
  userName: string
}

const formatCurrency = (amount: number | null) => {
  if (amount === null || amount === undefined) return '-'
  return `$${Number(amount).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const movementTypeLabels: Record<string, string> = {
  COMPRA: 'Compra', VENTA: 'Venta', AJUSTE_POSITIVO: 'Ajuste +',
  AJUSTE_NEGATIVO: 'Ajuste -', DEVOLUCION_CLIENTE: 'Dev. Cli.',
  DEVOLUCION_PROVEEDOR: 'Dev. Prov.', TRANSFERENCIA: 'Transfer.',
}

export default function InventoryItemsTab() {
  const router = useRouter()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('ALL')
  const [belowMinFilter, setBelowMinFilter] = useState(false)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const limit = 20

  // Drawer state
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [history, setHistory] = useState<MovementHistory[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  // Inline edit state
  const [editingMinStock, setEditingMinStock] = useState<string | null>(null)
  const [editMinValue, setEditMinValue] = useState('')

  const fetchProducts = useCallback(async () => {
    try {
      setLoading(true)
      let url = `/api/productos?page=${page}&limit=${limit}`
      if (typeFilter !== 'ALL') url += `&type=${typeFilter}`
      if (search) url += `&search=${encodeURIComponent(search)}`
      if (belowMinFilter) url += `&belowMin=true`

      const response = await fetch(url)
      if (!response.ok) throw new Error('Error al cargar productos')
      const data = await response.json()
      setProducts(data.products || [])
      setTotalPages(data.pagination?.totalPages || 1)
    } catch {
      toast.error('Error al cargar items de inventario')
    } finally {
      setLoading(false)
    }
  }, [page, typeFilter, belowMinFilter, search])

  useEffect(() => {
    fetchProducts()
  }, [fetchProducts])

  const handleSearch = () => {
    setPage(1)
    fetchProducts()
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch()
  }

  const openProductDrawer = async (product: Product) => {
    setSelectedProduct(product)
    setDrawerOpen(true)
    setHistoryLoading(true)
    try {
      const res = await fetch(`/api/inventory/product/${product.id}/history?limit=20`)
      if (res.ok) {
        const data = await res.json()
        setHistory(data.movements || [])
      }
    } catch {
      // ignore
    } finally {
      setHistoryLoading(false)
    }
  }

  const handleSaveMinStock = async (productId: string) => {
    try {
      const res = await fetch(`/api/inventory/products/${productId}/stock-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minStock: parseInt(editMinValue) || 0 }),
      })
      if (!res.ok) throw new Error()
      toast.success('Stock mínimo actualizado')
      setEditingMinStock(null)
      fetchProducts()
    } catch {
      toast.error('Error al actualizar')
    }
  }

  const getStockColor = (product: Product) => {
    if (product.stockQuantity === 0 || (product.minStock > 0 && product.stockQuantity < product.minStock)) {
      return 'bg-red-100 text-red-800'
    }
    if (product.minStock > 0 && product.stockQuantity < product.minStock * 1.5) {
      return 'bg-yellow-100 text-yellow-800'
    }
    return 'bg-green-100 text-green-800'
  }

  return (
    <>
      <Card className="border-blue-200">
        <CardContent className="p-6">
          {/* Filters */}
          <div className="mb-6 flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por código o descripción..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleKeyPress}
                className="pl-10"
              />
            </div>
            <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(1) }}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos los tipos</SelectItem>
                <SelectItem value="PRODUCT">Productos</SelectItem>
                <SelectItem value="SERVICE">Servicios</SelectItem>
                <SelectItem value="COMBO">Combos</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant={belowMinFilter ? 'default' : 'outline'}
              onClick={() => { setBelowMinFilter(!belowMinFilter); setPage(1) }}
              className={belowMinFilter ? 'bg-red-600 hover:bg-red-700' : ''}
            >
              Solo bajo mínimo
            </Button>
            <Button onClick={handleSearch} className="bg-blue-600 hover:bg-blue-700">
              <Search className="mr-2 h-4 w-4" />
              Buscar
            </Button>
          </div>

          {/* Table */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-12">
              <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">{search ? 'No se encontraron items' : 'No hay items registrados'}</p>
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-blue-100 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-blue-50 hover:bg-blue-50">
                      <TableHead className="font-semibold text-blue-900">Código</TableHead>
                      <TableHead className="font-semibold text-blue-900">Descripción</TableHead>
                      <TableHead className="text-right font-semibold text-blue-900">P. Venta</TableHead>
                      <TableHead className="text-right font-semibold text-blue-900">Últ. Costo</TableHead>
                      <TableHead className="text-right font-semibold text-blue-900">Cto. Prom.</TableHead>
                      <TableHead className="text-right font-semibold text-blue-900">Mín.</TableHead>
                      <TableHead className="text-right font-semibold text-blue-900">Disponible</TableHead>
                      <TableHead className="text-right font-semibold text-blue-900">Valor Stock</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {products.map((product) => {
                      const salePrice = product.prices?.find(p => p.priceType === 'SALE')
                      const stockValue = product.stockQuantity * Number(product.averageCost || 0)

                      return (
                        <TableRow
                          key={product.id}
                          className="cursor-pointer hover:bg-blue-50 transition-colors"
                          onClick={() => openProductDrawer(product)}
                        >
                          <TableCell className="font-mono text-sm font-medium text-blue-700">
                            {product.sku}
                          </TableCell>
                          <TableCell className="max-w-lg">
                            <div className="font-medium text-gray-900 truncate" title={product.name}>{product.name}</div>
                            {product.supplier && (
                              <div className="text-xs text-gray-500 truncate">{product.supplier.name}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {salePrice ? formatCurrency(Number(salePrice.amount)) : '-'}
                          </TableCell>
                          <TableCell className="text-right text-gray-600 text-sm">
                            {formatCurrency(product.lastCost)}
                          </TableCell>
                          <TableCell className="text-right text-gray-600 text-sm">
                            {formatCurrency(product.averageCost)}
                          </TableCell>
                          <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                            {editingMinStock === product.id ? (
                              <div className="flex items-center gap-1 justify-end">
                                <Input
                                  type="number"
                                  value={editMinValue}
                                  onChange={(e) => setEditMinValue(e.target.value)}
                                  className="w-16 h-7 text-sm text-right"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSaveMinStock(product.id)
                                    if (e.key === 'Escape') setEditingMinStock(null)
                                  }}
                                />
                                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleSaveMinStock(product.id)}>
                                  <Check className="h-3 w-3" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditingMinStock(null)}>
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            ) : (
                              <span
                                className="cursor-pointer hover:underline text-sm"
                                onClick={() => {
                                  setEditingMinStock(product.id)
                                  setEditMinValue(String(product.minStock))
                                }}
                              >
                                {product.minStock || '-'}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge className={getStockColor(product)}>
                              {product.stockQuantity}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right text-sm font-medium">
                            {stockValue > 0 ? formatCurrency(stockValue) : '-'}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="mt-4 flex items-center justify-between">
                <div className="text-sm text-muted-foreground">Página {page} de {totalPages}</div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                    Anterior
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                    Siguiente
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Product Detail Drawer */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent className="w-[500px] sm:max-w-[500px] overflow-y-auto">
          {selectedProduct && (
            <>
              <SheetHeader>
                <SheetTitle>{selectedProduct.name}</SheetTitle>
                <p className="text-sm text-gray-500 font-mono">{selectedProduct.sku}</p>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                {/* Stock Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-gray-500">Stock actual</p>
                    <p className="text-2xl font-bold">{selectedProduct.stockQuantity}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Stock mínimo</p>
                    <p className="text-2xl font-bold">{selectedProduct.minStock}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Último costo</p>
                    <p className="font-semibold">{formatCurrency(selectedProduct.lastCost)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Costo promedio</p>
                    <p className="font-semibold">{formatCurrency(selectedProduct.averageCost)}</p>
                  </div>
                </div>

                {/* Edit min/max */}
                <div className="border rounded-lg p-4 space-y-3">
                  <h4 className="text-sm font-semibold">Configuración de stock</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-500">Stock mínimo</label>
                      <Input
                        type="number"
                        defaultValue={selectedProduct.minStock}
                        onBlur={async (e) => {
                          const val = parseInt(e.target.value)
                          if (val !== selectedProduct.minStock) {
                            const res = await fetch(`/api/inventory/products/${selectedProduct.id}/stock-settings`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ minStock: val }),
                            })
                            if (res.ok) {
                              toast.success('Stock mínimo actualizado')
                              fetchProducts()
                            }
                          }
                        }}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">Stock máximo</label>
                      <Input
                        type="number"
                        defaultValue={selectedProduct.maxStock || ''}
                        placeholder="Sin límite"
                        onBlur={async (e) => {
                          const val = e.target.value ? parseInt(e.target.value) : null
                          const res = await fetch(`/api/inventory/products/${selectedProduct.id}/stock-settings`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ maxStock: val }),
                          })
                          if (res.ok) toast.success('Stock máximo actualizado')
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Movement History */}
                <div>
                  <h4 className="text-sm font-semibold mb-3">Historial de movimientos</h4>
                  {historyLoading ? (
                    <div className="flex justify-center py-4">
                      <Loader2 className="h-5 w-5 animate-spin" />
                    </div>
                  ) : history.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-4">Sin movimientos</p>
                  ) : (
                    <div className="space-y-2">
                      {history.map(m => (
                        <div key={m.id} className="flex items-center justify-between border-b pb-2">
                          <div>
                            <Badge className={`text-xs ${
                              m.quantity > 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                            }`}>
                              {movementTypeLabels[m.type] || m.type}
                            </Badge>
                            <p className="text-xs text-gray-500 mt-1">
                              {new Date(m.date).toLocaleDateString('es-AR')} - {m.userName}
                            </p>
                            {m.reference && (
                              <p className="text-xs text-gray-400">{m.reference}</p>
                            )}
                          </div>
                          <div className="text-right">
                            <p className={`font-semibold ${m.quantity > 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                            </p>
                            <p className="text-xs text-gray-500">
                              {m.stockBefore} → {m.stockAfter}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <Button
                    variant="outline"
                    className="w-full mt-3"
                    onClick={() => {
                      setDrawerOpen(false)
                      router.push(`/inventario/items/${selectedProduct.id}`)
                    }}
                  >
                    Ver historial completo
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}
