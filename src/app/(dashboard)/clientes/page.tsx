'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Search,
  UserPlus,
  Upload,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  RefreshCw,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react'
import { toast } from 'sonner'
import { ClientesResumen } from '@/components/clientes/ClientesResumen'

interface Customer {
  id: string
  name: string
  businessName: string | null
  cuit: string
  balance: number
  status: string
  salesPerson: {
    id: string
    name: string
    email: string
  } | null
  _count: {
    opportunities: number
    quotes: number
    invoices: number
  }
}

interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

export default function ClientesPage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0,
  })

  // Active Tab
  const [activeTab, setActiveTab] = useState<'gestion' | 'resumen'>('gestion')

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('ACTIVE')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState('balance')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  useEffect(() => {
    fetchCustomers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, pagination.page, sortBy, sortOrder])

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (pagination.page === 1) {
        fetchCustomers()
      } else {
        setPagination({ ...pagination, page: 1 })
      }
    }, 500)

    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery])

  const fetchCustomers = async () => {
    try {
      setLoading(true)

      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        status: statusFilter,
        sortBy,
        sortOrder,
      })

      if (searchQuery) {
        params.append('search', searchQuery)
      }

      console.log('Fetching customers with params:', params.toString())

      const response = await fetch(`/api/clientes?${params}`)

      console.log('Response status:', response.status, response.statusText)

      if (!response.ok) {
        if (response.status === 401) {
          toast.error('Sesión expirada. Por favor inicia sesión nuevamente.')
          window.location.href = '/login'
          return
        }

        let errorMessage = `Error ${response.status}: ${response.statusText}`
        try {
          const errorData = await response.json()
          console.error('Error data:', errorData)
          errorMessage = errorData.error || errorData.message || errorMessage
        } catch (e) {
          console.error('Could not parse error response:', e)
        }

        throw new Error(errorMessage)
      }

      const data = await response.json()
      console.log('Customers loaded:', data.customers?.length || 0)
      setCustomers(data.customers || [])
      setPagination(data.pagination || pagination)
    } catch (error) {
      console.error('Error fetching customers:', error)
      toast.error(error instanceof Error ? error.message : 'Error al cargar clientes')
    } finally {
      setLoading(false)
    }
  }

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(column)
      setSortOrder('desc')
    }
  }

  const getSortIcon = (column: string) => {
    if (sortBy !== column) {
      return <ArrowUpDown className="h-4 w-4 ml-1 text-gray-400" />
    }
    return sortOrder === 'asc' ? (
      <ArrowUp className="h-4 w-4 ml-1 text-blue-600" />
    ) : (
      <ArrowDown className="h-4 w-4 ml-1 text-blue-600" />
    )
  }

  const handleCustomerClick = (customerId: string) => {
    router.push(`/clientes/${customerId}`)
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('es-AR', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  }

  const goToPage = (page: number) => {
    setPagination({ ...pagination, page })
  }

  const startIndex = (pagination.page - 1) * pagination.limit + 1
  const endIndex = Math.min(pagination.page * pagination.limit, pagination.total)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-blue-900">
            Clientes
          </h1>
          <p className="text-muted-foreground">
            Gestión y administración de clientes
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchCustomers}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Actualizar
          </Button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <Card className="border-blue-200">
        <CardContent className="p-4">
          <div className="flex gap-2 flex-wrap">
            <Button
              variant={activeTab === 'gestion' ? 'default' : 'outline'}
              className={activeTab === 'gestion' ? 'bg-blue-600 hover:bg-blue-700' : ''}
              onClick={() => setActiveTab('gestion')}
            >
              Gestión de clientes
            </Button>
            <Button
              variant={activeTab === 'resumen' ? 'default' : 'outline'}
              className={activeTab === 'resumen' ? 'bg-blue-600 hover:bg-blue-700' : ''}
              onClick={() => setActiveTab('resumen')}
            >
              Resumen clientes
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Main Content */}
      <Card className="border-blue-200">
        <CardContent className="p-6">
          {activeTab === 'resumen' ? (
            <ClientesResumen />
          ) : (
            <>
              {/* Title and Tabs */}
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-blue-900 mb-4">
                  Lista de clientes
                </h2>

            <Tabs
              value={statusFilter}
              onValueChange={setStatusFilter}
              className="mb-6"
            >
              <TabsList className="bg-blue-50">
                <TabsTrigger
                  value="ACTIVE"
                  className="data-[state=active]:bg-blue-600 data-[state=active]:text-white"
                >
                  Activos
                </TabsTrigger>
                <TabsTrigger
                  value="INACTIVE"
                  className="data-[state=active]:bg-blue-600 data-[state=active]:text-white"
                >
                  Inactivos
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Search */}
            <div className="flex items-center gap-2 mb-6">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Buscar cliente..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {/* Table */}
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="h-8 w-8 animate-spin text-blue-600" />
              </div>
            ) : customers.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <p>No se encontraron clientes</p>
              </div>
            ) : (
              <>
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-blue-50">
                        <TableHead
                          className="cursor-pointer hover:bg-blue-100 transition-colors"
                          onClick={() => handleSort('name')}
                        >
                          <div className="flex items-center font-semibold text-blue-900">
                            Nombre
                            {getSortIcon('name')}
                          </div>
                        </TableHead>
                        <TableHead
                          className="cursor-pointer hover:bg-blue-100 transition-colors"
                          onClick={() => handleSort('businessName')}
                        >
                          <div className="flex items-center font-semibold text-blue-900">
                            Razón social
                            {getSortIcon('businessName')}
                          </div>
                        </TableHead>
                        <TableHead
                          className="text-right cursor-pointer hover:bg-blue-100 transition-colors"
                          onClick={() => handleSort('balance')}
                        >
                          <div className="flex items-center justify-end font-semibold text-blue-900">
                            Saldo
                            {getSortIcon('balance')}
                          </div>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {customers.map((customer) => (
                        <TableRow
                          key={customer.id}
                          className="cursor-pointer hover:bg-blue-50 transition-colors"
                          onClick={() => handleCustomerClick(customer.id)}
                        >
                          <TableCell className="font-medium">
                            {customer.name}
                          </TableCell>
                          <TableCell>
                            {customer.businessName || customer.name}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(Number(customer.balance))}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination */}
                <div className="flex items-center justify-between mt-6">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => goToPage(1)}
                      disabled={pagination.page === 1}
                    >
                      <ChevronsLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => goToPage(pagination.page - 1)}
                      disabled={pagination.page === 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>

                    <span className="text-sm text-muted-foreground px-4">
                      Página <span className="font-semibold">{pagination.page}</span> de{' '}
                      <span className="font-semibold">{pagination.totalPages}</span>
                    </span>

                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => goToPage(pagination.page + 1)}
                      disabled={pagination.page === pagination.totalPages}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => goToPage(pagination.totalPages)}
                      disabled={pagination.page === pagination.totalPages}
                    >
                      <ChevronsRight className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="flex items-center gap-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={fetchCustomers}
                    >
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Actualizar
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      Mostrando{' '}
                      <span className="font-semibold">
                        {startIndex} - {endIndex}
                      </span>{' '}
                      de <span className="font-semibold">{pagination.total}</span>
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex gap-3">
        <Button
          className="bg-blue-600 hover:bg-blue-700"
          onClick={() => router.push('/clientes/nuevo')}
        >
          <UserPlus className="h-4 w-4 mr-2" />
          Nuevo cliente
        </Button>
        <Button
          variant="outline"
          onClick={() => router.push('/clientes/importar')}
        >
          <Upload className="h-4 w-4 mr-2" />
          Importar
        </Button>
      </div>
    </div>
  )
}
