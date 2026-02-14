'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Plus, Search } from 'lucide-react'
import { formatCUIT, formatCurrency } from '@/lib/utils'
import { toast } from 'sonner'
import { CUSTOMER_STATUS, PROVINCIAS_ARGENTINA } from '@/lib/constants'

interface Customer {
  id: string
  name: string
  cuit: string
  email: string | null
  phone: string | null
  city: string | null
  province: string | null
  status: string
  creditLimit: number | null
  creditCurrency: string | null
}

export default function ClientesPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [provinceFilter, setProvinceFilter] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  useEffect(() => {
    fetchCustomers()
  }, [search, statusFilter, provinceFilter, page])

  const fetchCustomers = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '20',
        ...(search && { search }),
        ...(statusFilter && { status: statusFilter }),
        ...(provinceFilter && { province: provinceFilter }),
      })

      const response = await fetch(`/api/clientes?${params}`)
      if (!response.ok) throw new Error('Error al cargar clientes')

      const data = await response.json()
      setCustomers(data.customers)
      setTotalPages(data.pagination.totalPages)
    } catch (error) {
      toast.error('Error al cargar clientes')
    } finally {
      setLoading(false)
    }
  }

  const getStatusBadge = (status: string) => {
    const statusConfig = CUSTOMER_STATUS.find((s) => s.value === status)
    const colors: Record<string, string> = {
      green: 'bg-green-100 text-green-700',
      gray: 'bg-gray-100 text-gray-700',
      red: 'bg-red-100 text-red-700',
    }
    return (
      <Badge className={colors[statusConfig?.color || 'gray']}>
        {statusConfig?.label || status}
      </Badge>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Clientes</h1>
          <p className="text-slate-500 mt-1">
            Gestiona tus clientes y sus datos de contacto
          </p>
        </div>
        <Link href="/clientes/nuevo">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Nuevo Cliente
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Lista de Clientes</CardTitle>
          <CardDescription>
            Busca y filtra tus clientes
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 mb-6 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Buscar por nombre, CUIT o email..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
                className="pl-9"
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={(value) => {
                setStatusFilter(value === 'all' ? '' : value)
                setPage(1)
              }}
            >
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {CUSTOMER_STATUS.map((status) => (
                  <SelectItem key={status.value} value={status.value}>
                    {status.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={provinceFilter}
              onValueChange={(value) => {
                setProvinceFilter(value === 'all' ? '' : value)
                setPage(1)
              }}
            >
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Provincia" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {PROVINCIAS_ARGENTINA.map((province) => (
                  <SelectItem key={province} value={province}>
                    {province}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <div className="text-center py-8">
              <p className="text-slate-500">Cargando...</p>
            </div>
          ) : customers.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-slate-500">No se encontraron clientes</p>
            </div>
          ) : (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cliente</TableHead>
                      <TableHead>CUIT</TableHead>
                      <TableHead>Contacto</TableHead>
                      <TableHead>Ubicación</TableHead>
                      <TableHead>Crédito</TableHead>
                      <TableHead>Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customers.map((customer) => (
                      <TableRow
                        key={customer.id}
                        className="cursor-pointer hover:bg-slate-50"
                        onClick={() => window.location.href = `/clientes/${customer.id}`}
                      >
                        <TableCell className="font-medium">
                          {customer.name}
                        </TableCell>
                        <TableCell>{formatCUIT(customer.cuit)}</TableCell>
                        <TableCell>
                          {customer.email && (
                            <div className="text-sm">{customer.email}</div>
                          )}
                          {customer.phone && (
                            <div className="text-sm text-slate-500">
                              {customer.phone}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {customer.city && customer.province && (
                            <div className="text-sm">
                              {customer.city}, {customer.province}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {customer.creditLimit && customer.creditCurrency && (
                            <div className="text-sm">
                              {formatCurrency(
                                Number(customer.creditLimit),
                                customer.creditCurrency as any
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>{getStatusBadge(customer.status)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    Anterior
                  </Button>
                  <span className="text-sm text-slate-600">
                    Página {page} de {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                  >
                    Siguiente
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
