'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
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
import { Package, Plus, History, TrendingDown, TrendingUp, Calendar } from 'lucide-react'
import { toast } from 'sonner'

interface StockMovement {
  id: string
  date: string
  type: string
  quantity: number
  unitCost: number
  totalCost: number
  product: {
    name: string
    sku: string
  }
  user: {
    name: string
  }
  invoice?: {
    invoiceNumber: string
  }
}

const movementTypeLabels: Record<string, string> = {
  COMPRA: 'Compra',
  VENTA: 'Venta',
  AJUSTE_POSITIVO: 'Ajuste +',
  AJUSTE_NEGATIVO: 'Ajuste -',
  DEVOLUCION_CLIENTE: 'Devolución Cliente',
  DEVOLUCION_PROVEEDOR: 'Devolución Proveedor',
}

const movementTypeColors: Record<string, string> = {
  COMPRA: 'bg-green-100 text-green-800',
  VENTA: 'bg-blue-100 text-blue-800',
  AJUSTE_POSITIVO: 'bg-emerald-100 text-emerald-800',
  AJUSTE_NEGATIVO: 'bg-orange-100 text-orange-800',
  DEVOLUCION_CLIENTE: 'bg-purple-100 text-purple-800',
  DEVOLUCION_PROVEEDOR: 'bg-red-100 text-red-800',
}

export default function InventarioPage() {
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchMovements()
  }, [])

  const fetchMovements = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/inventario/movimientos?limit=50')

      if (!response.ok) {
        throw new Error('Error al cargar movimientos')
      }

      const data = await response.json()
      setMovements(data.movements || [])
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar movimientos de inventario')
    } finally {
      setLoading(false)
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

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      currencyDisplay: 'code',
    }).format(amount)
  }

  const getMovementIcon = (type: string) => {
    if (type === 'VENTA' || type === 'AJUSTE_NEGATIVO' || type === 'DEVOLUCION_PROVEEDOR') {
      return <TrendingDown className="h-4 w-4" />
    }
    return <TrendingUp className="h-4 w-4" />
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Inventario</h1>
          <p className="text-muted-foreground">
            Gestión de movimientos de stock y control de inventario
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/inventario/movimientos/nuevo">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Movimiento
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Movimientos</CardTitle>
            <History className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{movements.length}</div>
            <p className="text-xs text-muted-foreground">
              En los últimos registros
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Entradas</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {movements.filter(m => ['COMPRA', 'AJUSTE_POSITIVO', 'DEVOLUCION_CLIENTE'].includes(m.type)).length}
            </div>
            <p className="text-xs text-muted-foreground">
              Compras, ajustes y devoluciones
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Salidas</CardTitle>
            <TrendingDown className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {movements.filter(m => ['VENTA', 'AJUSTE_NEGATIVO', 'DEVOLUCION_PROVEEDOR'].includes(m.type)).length}
            </div>
            <p className="text-xs text-muted-foreground">
              Ventas y salidas de stock
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Movements Table */}
      <Card>
        <CardHeader>
          <CardTitle>Movimientos Recientes</CardTitle>
          <CardDescription>
            Historial de movimientos de inventario
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : movements.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Package className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No hay movimientos registrados</p>
              <Link href="/inventario/movimientos/nuevo">
                <Button className="mt-4" variant="outline">
                  <Plus className="mr-2 h-4 w-4" />
                  Crear primer movimiento
                </Button>
              </Link>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Cantidad</TableHead>
                    <TableHead className="text-right">Costo Unit.</TableHead>
                    <TableHead className="text-right">Costo Total</TableHead>
                    <TableHead>Usuario</TableHead>
                    <TableHead>Referencia</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.map((movement) => (
                    <TableRow key={movement.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                          {formatDate(movement.date)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={movementTypeColors[movement.type] || 'bg-gray-100 text-gray-800'}>
                          <span className="flex items-center gap-1">
                            {getMovementIcon(movement.type)}
                            {movementTypeLabels[movement.type] || movement.type}
                          </span>
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">{movement.product.name}</div>
                          <div className="text-xs text-muted-foreground">{movement.product.sku}</div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={movement.quantity > 0 ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
                          {movement.quantity > 0 ? '+' : ''}{movement.quantity}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(movement.unitCost)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(movement.totalCost)}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{movement.user.name}</div>
                      </TableCell>
                      <TableCell>
                        {movement.invoice ? (
                          <Link
                            href={`/facturas/${movement.invoice.invoiceNumber}`}
                            className="text-blue-600 hover:underline text-sm"
                          >
                            {movement.invoice.invoiceNumber}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground text-sm">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
