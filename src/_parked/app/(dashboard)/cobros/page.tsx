'use client'

import { useState, useEffect, useCallback } from 'react'
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
import {
  Banknote,
  Plus,
  Search,
  CheckCircle2,
  Clock,
  Eye,
  Pencil,
  ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'

interface Receipt {
  id: string
  receiptNumber: string
  status: string
  date: string
  description: string | null
  totalApplied: number
  totalWithholdings: number
  totalCobrado: number
  customer: {
    id: string
    name: string
    cuit: string
  }
  user: {
    id: string
    name: string
  }
  journalEntry: {
    id: string
    entryNumber: number
  } | null
  _count: {
    invoiceApplications: number
    withholdingGroups: number
  }
}

interface Stats {
  totalApplied: number
  totalWithholdings: number
  totalCobrado: number
  count: number
  byStatus: Array<{
    status: string
    _count: { _all: number }
    _sum: { totalApplied: number | null }
  }>
}

const statusLabels: Record<string, string> = {
  BORRADOR: 'Borrador',
  APROBADO: 'Aprobado',
  ANULADO: 'Anulado',
}

const statusColors: Record<string, string> = {
  BORRADOR: 'bg-gray-100 text-gray-800',
  APROBADO: 'bg-green-100 text-green-800',
  ANULADO: 'bg-red-100 text-red-800',
}

const formatARS = (amount: number) => {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
  }).format(amount)
}

const formatDate = (date: string) => {
  return new Date(date).toLocaleDateString('es-AR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

export default function CobrosPage() {
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  // Debounce search input by 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const fetchReceipts = useCallback(async (searchTerm: string) => {
    try {
      setLoading(true)
      const params = new URLSearchParams({ pageSize: '50' })
      if (searchTerm) params.set('search', searchTerm)

      const response = await fetch(`/api/cobros?${params}`)

      if (!response.ok) {
        throw new Error('Error al cargar cobros')
      }

      const data = await response.json()
      setReceipts(data.receipts || [])
      setStats(data.stats || null)
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar cobros')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchReceipts(debouncedSearch)
  }, [debouncedSearch, fetchReceipts])

  // Derived stats from API stats object
  const totalApplied =
    stats?.byStatus.find((s) => s.status === 'APROBADO')?._sum.totalApplied ?? 0
  const totalWithholdings =
    stats?.byStatus.find((s) => s.status === 'APROBADO')?._sum.totalApplied !== undefined
      ? (stats?.totalWithholdings ?? 0) // use aggregate for withholdings
      : 0
  const countAprobado =
    stats?.byStatus.find((s) => s.status === 'APROBADO')?._count._all ?? 0
  const countBorrador =
    stats?.byStatus.find((s) => s.status === 'BORRADOR')?._count._all ?? 0

  // Total retenciones for APROBADO — we filter client-side from loaded receipts
  const totalRetencionesAprobado = receipts
    .filter((r) => r.status === 'APROBADO')
    .reduce((sum, r) => sum + Number(r.totalWithholdings), 0)

  const totalAplicadoAprobado = receipts
    .filter((r) => r.status === 'APROBADO')
    .reduce((sum, r) => sum + Number(r.totalApplied), 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Banknote className="h-8 w-8 text-primary" />
            Cobros
          </h1>
          <p className="text-muted-foreground">
            Gestión de recibos de cobro a clientes
          </p>
        </div>
        <Link href="/cobros/nuevo">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Nuevo Recibo
          </Button>
        </Link>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Aplicado</CardTitle>
            <Banknote className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatARS(totalAplicadoAprobado)}
            </div>
            <p className="text-xs text-muted-foreground">
              Recibos aprobados
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Aprobados</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {countAprobado}
            </div>
            <p className="text-xs text-muted-foreground">
              {countAprobado === 1 ? 'recibo aprobado' : 'recibos aprobados'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Borradores</CardTitle>
            <Clock className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-500">
              {countBorrador}
            </div>
            <p className="text-xs text-muted-foreground">
              {countBorrador === 1 ? 'recibo pendiente' : 'recibos pendientes'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Retenciones</CardTitle>
            <ShieldCheck className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {formatARS(totalRetencionesAprobado)}
            </div>
            <p className="text-xs text-muted-foreground">
              Retenciones en aprobados
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Receipts Table */}
      <Card>
        <CardHeader>
          <CardTitle>Listado de Cobros</CardTitle>
          <CardDescription>
            Todos los recibos de cobro registrados
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nro. recibo o cliente..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : receipts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Banknote className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                {search ? 'No se encontraron recibos' : 'No hay recibos registrados'}
              </p>
              {!search && (
                <Link href="/cobros/nuevo">
                  <Button className="mt-4" variant="outline">
                    <Plus className="mr-2 h-4 w-4" />
                    Crear primer recibo
                  </Button>
                </Link>
              )}
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nro. Recibo</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Total Aplicado</TableHead>
                    <TableHead className="text-right">Retenciones</TableHead>
                    <TableHead className="text-right">Total Cobrado</TableHead>
                    <TableHead className="text-center">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {receipts.map((receipt) => (
                    <TableRow key={receipt.id}>
                      <TableCell className="font-mono font-semibold">
                        {receipt.receiptNumber}
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">{receipt.customer.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {receipt.customer.cuit}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{formatDate(receipt.date)}</TableCell>
                      <TableCell>
                        <Badge className={statusColors[receipt.status]}>
                          {statusLabels[receipt.status] ?? receipt.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatARS(Number(receipt.totalApplied))}
                      </TableCell>
                      <TableCell className="text-right">
                        {Number(receipt.totalWithholdings) > 0
                          ? formatARS(Number(receipt.totalWithholdings))
                          : <span className="text-muted-foreground">-</span>}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatARS(Number(receipt.totalCobrado))}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Link href={`/cobros/${receipt.id}`}>
                            <Button variant="ghost" size="icon" title="Ver detalle">
                              <Eye className="h-4 w-4" />
                            </Button>
                          </Link>
                          {receipt.status === 'BORRADOR' && (
                            <Link href={`/cobros/${receipt.id}`}>
                              <Button variant="ghost" size="icon" title="Editar">
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </Link>
                          )}
                        </div>
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
