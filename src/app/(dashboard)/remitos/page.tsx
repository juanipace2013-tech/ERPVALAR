'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import {
  Loader2,
  Search,
  Package,
  Eye,
  FileSpreadsheet,
  MoreHorizontal,
  Filter,
} from 'lucide-react'
import { toast } from 'sonner'

interface DeliveryNote {
  id: string
  deliveryNumber: string
  date: string
  deliveryDate: string | null
  status: string
  customer: {
    id: string
    name: string
    cuit: string
  }
  quote: {
    id: string
    quoteNumber: string
  } | null
  items: Array<{
    id: string
    quantity: number
  }>
  invoices: Array<{
    id: string
    invoiceNumber: string
  }>
}

const statusLabels: Record<string, string> = {
  PENDING: 'Pendiente',
  PREPARING: 'En Preparación',
  READY: 'Listo',
  DISPATCHED: 'Despachado',
  DELIVERED: 'Entregado',
  CANCELLED: 'Cancelado',
}

const statusColors: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-800',
  PREPARING: 'bg-yellow-100 text-yellow-800',
  READY: 'bg-blue-100 text-blue-800',
  DISPATCHED: 'bg-purple-100 text-purple-800',
  DELIVERED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800',
}

export default function RemitosPage() {
  const router = useRouter()
  const [deliveryNotes, setDeliveryNotes] = useState<DeliveryNote[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  useEffect(() => {
    fetchDeliveryNotes()
  }, [])

  const fetchDeliveryNotes = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (statusFilter !== 'all') {
        params.append('status', statusFilter)
      }
      if (searchTerm) {
        params.append('search', searchTerm)
      }

      const response = await fetch(`/api/delivery-notes?${params.toString()}`)

      if (!response.ok) {
        throw new Error('Error al cargar remitos')
      }

      const data = await response.json()
      setDeliveryNotes(data)
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar remitos')
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = () => {
    fetchDeliveryNotes()
  }

  const handleStatusFilterChange = (value: string) => {
    setStatusFilter(value)
    setTimeout(() => {
      fetchDeliveryNotes()
    }, 100)
  }

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  }

  const getTotalItems = (items: Array<{ quantity: number }>) => {
    return items.reduce((sum, item) => sum + item.quantity, 0)
  }

  const filteredDeliveryNotes = deliveryNotes.filter((dn) => {
    const matchesSearch =
      !searchTerm ||
      dn.deliveryNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      dn.customer.name.toLowerCase().includes(searchTerm.toLowerCase())
    return matchesSearch
  })

  return (
    <div className="container mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Remitos</h1>
          <p className="text-gray-600 mt-1">
            Gestión de remitos y despachos de mercadería
          </p>
        </div>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Buscar por número o cliente..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  className="pl-10"
                />
              </div>
            </div>
            <div>
              <Select value={statusFilter} onValueChange={handleStatusFilterChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Filtrar por estado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los estados</SelectItem>
                  <SelectItem value="PENDING">Pendiente</SelectItem>
                  <SelectItem value="PREPARING">En Preparación</SelectItem>
                  <SelectItem value="READY">Listo</SelectItem>
                  <SelectItem value="DISPATCHED">Despachado</SelectItem>
                  <SelectItem value="DELIVERED">Entregado</SelectItem>
                  <SelectItem value="CANCELLED">Cancelado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Remitos</p>
                <p className="text-2xl font-bold">{deliveryNotes.length}</p>
              </div>
              <Package className="h-8 w-8 text-gray-400" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Pendientes</p>
                <p className="text-2xl font-bold text-yellow-600">
                  {deliveryNotes.filter((dn) => dn.status === 'PENDING').length}
                </p>
              </div>
              <Package className="h-8 w-8 text-yellow-400" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">En Proceso</p>
                <p className="text-2xl font-bold text-blue-600">
                  {
                    deliveryNotes.filter(
                      (dn) =>
                        dn.status === 'PREPARING' ||
                        dn.status === 'READY' ||
                        dn.status === 'DISPATCHED'
                    ).length
                  }
                </p>
              </div>
              <Package className="h-8 w-8 text-blue-400" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Entregados</p>
                <p className="text-2xl font-bold text-green-600">
                  {deliveryNotes.filter((dn) => dn.status === 'DELIVERED').length}
                </p>
              </div>
              <Package className="h-8 w-8 text-green-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : filteredDeliveryNotes.length === 0 ? (
            <div className="text-center py-12">
              <Package className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-600">No se encontraron remitos</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Número</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Cotización</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Factura</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDeliveryNotes.map((dn) => (
                    <TableRow
                      key={dn.id}
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() => router.push(`/remitos/${dn.id}`)}
                    >
                      <TableCell className="font-mono font-semibold">
                        {dn.deliveryNumber}
                      </TableCell>
                      <TableCell>{formatDate(dn.date)}</TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{dn.customer.name}</p>
                          <p className="text-sm text-gray-500">{dn.customer.cuit}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        {dn.quote ? (
                          <Link
                            href={`/cotizaciones/${dn.quote.id}/ver`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-blue-600 hover:underline"
                          >
                            {dn.quote.quoteNumber}
                          </Link>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {getTotalItems(dn.items)} unidades
                      </TableCell>
                      <TableCell>
                        <Badge className={statusColors[dn.status]}>
                          {statusLabels[dn.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {dn.invoices.length > 0 ? (
                          <Link
                            href={`/facturas/${dn.invoices[0].id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-blue-600 hover:underline"
                          >
                            {dn.invoices[0].invoiceNumber}
                          </Link>
                        ) : (
                          <span className="text-gray-400">Pendiente</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Acciones</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation()
                                router.push(`/remitos/${dn.id}`)
                              }}
                            >
                              <Eye className="mr-2 h-4 w-4" />
                              Ver Detalle
                            </DropdownMenuItem>
                            {dn.invoices.length === 0 &&
                              (dn.status === 'READY' ||
                                dn.status === 'DISPATCHED' ||
                                dn.status === 'DELIVERED') && (
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    router.push(`/remitos/${dn.id}?action=generate-invoice`)
                                  }}
                                >
                                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                                  Generar Factura
                                </DropdownMenuItem>
                              )}
                          </DropdownMenuContent>
                        </DropdownMenu>
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
