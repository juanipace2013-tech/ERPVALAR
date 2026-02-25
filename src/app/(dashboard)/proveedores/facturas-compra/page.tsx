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
  Plus,
  Eye,
  MoreHorizontal,
  FileText,
  TrendingDown,
} from 'lucide-react'
import { toast } from 'sonner'

interface PurchaseInvoice {
  id: string
  invoiceNumber: string
  invoiceDate: string
  dueDate: string
  status: string
  paymentStatus: string
  voucherType: string
  cae: string | null
  supplier: {
    id: string
    name: string
    taxId: string | null
  }
  total: number
  balance: number
  items: Array<{
    id: string
    quantity: number
    total: number
  }>
}

const statusLabels: Record<string, string> = {
  DRAFT: 'Borrador',
  PENDING: 'Pendiente',
  APPROVED: 'Aprobada',
  PAID: 'Pagada',
  CANCELLED: 'Anulada',
}

const statusColors: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-800',
  PENDING: 'bg-yellow-100 text-yellow-800',
  APPROVED: 'bg-blue-100 text-blue-800',
  PAID: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800',
}

const paymentStatusLabels: Record<string, string> = {
  PENDING: 'Pendiente',
  COMPLETED: 'Pagada',
  CANCELLED: 'Cancelada',
}

export default function PurchaseInvoicesPage() {
  const router = useRouter()
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  useEffect(() => {
    fetchInvoices()
  }, [])

  const fetchInvoices = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (statusFilter !== 'all') {
        params.append('status', statusFilter)
      }
      if (searchTerm) {
        params.append('search', searchTerm)
      }

      const response = await fetch(`/api/purchase-invoices?${params.toString()}`)

      if (!response.ok) {
        throw new Error('Error al cargar facturas')
      }

      const data = await response.json()
      setInvoices(data)
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar facturas de compra')
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = () => {
    fetchInvoices()
  }

  const handleStatusFilterChange = (value: string) => {
    setStatusFilter(value)
    setTimeout(() => {
      fetchInvoices()
    }, 100)
  }

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  }

  const formatCurrency = (amount: number) => {
    return `$${Number(amount).toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`
  }

  const getTotalPurchases = () => {
    return invoices.reduce((sum, inv) => sum + Number(inv.total), 0)
  }

  const getTotalPending = () => {
    return invoices
      .filter((inv) => inv.paymentStatus === 'PENDING')
      .reduce((sum, inv) => sum + Number(inv.balance), 0)
  }

  const filteredInvoices = invoices.filter((inv) => {
    const matchesSearch =
      !searchTerm ||
      inv.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inv.supplier.name.toLowerCase().includes(searchTerm.toLowerCase())
    return matchesSearch
  })

  return (
    <div className="container mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Facturas de Compra</h1>
          <p className="text-gray-600 mt-1">
            Gestión de facturas de proveedores
          </p>
        </div>
        <Button asChild>
          <Link href="/proveedores/facturas-compra/nueva">
            <Plus className="h-4 w-4 mr-2" />
            Nueva Factura
          </Link>
        </Button>
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
                  placeholder="Buscar por número o proveedor..."
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
                  <SelectItem value="DRAFT">Borrador</SelectItem>
                  <SelectItem value="PENDING">Pendiente</SelectItem>
                  <SelectItem value="APPROVED">Aprobada</SelectItem>
                  <SelectItem value="PAID">Pagada</SelectItem>
                  <SelectItem value="CANCELLED">Anulada</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Facturas</p>
                <p className="text-2xl font-bold">{invoices.length}</p>
              </div>
              <FileText className="h-8 w-8 text-gray-400" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Compras</p>
                <p className="text-2xl font-bold text-blue-600">
                  {formatCurrency(getTotalPurchases())}
                </p>
              </div>
              <TrendingDown className="h-8 w-8 text-blue-400" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Saldo Pendiente</p>
                <p className="text-2xl font-bold text-orange-600">
                  {formatCurrency(getTotalPending())}
                </p>
              </div>
              <TrendingDown className="h-8 w-8 text-orange-400" />
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
          ) : filteredInvoices.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-600">No se encontraron facturas</p>
              <Button asChild className="mt-4">
                <Link href="/proveedores/facturas-compra/nueva">
                  <Plus className="h-4 w-4 mr-2" />
                  Crear Primera Factura
                </Link>
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Número</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Proveedor</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>CAE</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredInvoices.map((invoice) => (
                    <TableRow
                      key={invoice.id}
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() => router.push(`/proveedores/facturas-compra/${invoice.id}`)}
                    >
                      <TableCell className="font-mono font-semibold">
                        {invoice.invoiceNumber}
                      </TableCell>
                      <TableCell>{formatDate(invoice.invoiceDate)}</TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{invoice.supplier.name}</p>
                          {invoice.supplier.taxId && (
                            <p className="text-sm text-gray-500">
                              {invoice.supplier.taxId}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">Factura {invoice.voucherType}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatCurrency(invoice.total)}
                      </TableCell>
                      <TableCell className="text-right">
                        {Number(invoice.balance) > 0 ? (
                          <span className="text-orange-600 font-semibold">
                            {formatCurrency(invoice.balance)}
                          </span>
                        ) : (
                          <span className="text-green-600">Pagada</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge className={statusColors[invoice.status]}>
                          {statusLabels[invoice.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {invoice.cae ? (
                          <span className="text-sm font-mono text-green-600">
                            ✓ {invoice.cae.slice(-6)}
                          </span>
                        ) : (
                          <span className="text-sm text-gray-400">Sin CAE</span>
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
                                router.push(`/proveedores/facturas-compra/${invoice.id}`)
                              }}
                            >
                              <Eye className="mr-2 h-4 w-4" />
                              Ver Detalle
                            </DropdownMenuItem>
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
