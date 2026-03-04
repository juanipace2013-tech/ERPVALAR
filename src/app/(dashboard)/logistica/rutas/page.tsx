'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
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
import {
  Plus,
  Search,
  Loader2,
  XCircle,
  Map,
  Eye,
  CalendarDays,
} from 'lucide-react'
import { toast } from 'sonner'

interface DeliveryRoute {
  id: string
  date: string
  status: string
  notes: string | null
  createdBy: { id: string; name: string }
  stops: Array<{ id: string; status: string; zone: string; type: string }>
  _count: { stops: number }
}

const statusLabels: Record<string, string> = {
  PLANNING: 'Planificacion',
  IN_PROGRESS: 'En Curso',
  COMPLETED: 'Completada',
}

const statusColors: Record<string, string> = {
  PLANNING: 'bg-yellow-100 text-yellow-800',
  IN_PROGRESS: 'bg-blue-100 text-blue-800',
  COMPLETED: 'bg-green-100 text-green-800',
}

const zoneLabels: Record<string, string> = {
  CABA: 'CABA',
  NORTE: 'Norte',
  SUR: 'Sur',
  OESTE: 'Oeste',
}

const zoneColors: Record<string, string> = {
  CABA: 'bg-blue-100 text-blue-700',
  NORTE: 'bg-green-100 text-green-700',
  SUR: 'bg-red-100 text-red-700',
  OESTE: 'bg-yellow-100 text-yellow-700',
}

export default function RutasPage() {
  const [routes, setRoutes] = useState<DeliveryRoute[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const fetchRoutes = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (statusFilter !== 'ALL') params.append('status', statusFilter)
      if (dateFrom) params.append('dateFrom', dateFrom)
      if (dateTo) params.append('dateTo', dateTo)

      const url = `/api/logistica/rutas${params.toString() ? `?${params.toString()}` : ''}`
      const response = await fetch(url)

      if (!response.ok) throw new Error('Error al cargar rutas')

      const data = await response.json()
      setRoutes(data)
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar hojas de ruta')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, dateFrom, dateTo])

  useEffect(() => {
    fetchRoutes()
  }, [fetchRoutes])

  const handleClearFilters = () => {
    setStatusFilter('ALL')
    setDateFrom('')
    setDateTo('')
  }

  const hasActiveFilters = statusFilter !== 'ALL' || dateFrom !== '' || dateTo !== ''

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('es-AR', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  }

  const getZoneSummary = (stops: DeliveryRoute['stops']) => {
    const zones: Record<string, number> = {}
    stops.forEach((s) => {
      zones[s.zone] = (zones[s.zone] || 0) + 1
    })
    return zones
  }

  const getStopStatusSummary = (stops: DeliveryRoute['stops']) => {
    const delivered = stops.filter((s) => s.status === 'DELIVERED' || s.status === 'PICKED_UP').length
    const pending = stops.filter((s) => s.status === 'PENDING' || s.status === 'PREPARING').length
    const inRoute = stops.filter((s) => s.status === 'IN_ROUTE').length
    const failed = stops.filter((s) => s.status === 'NOT_DELIVERED').length
    return { delivered, pending, inRoute, failed, total: stops.length }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-blue-900">Hojas de Ruta</h1>
          <p className="text-muted-foreground">Gestion de hojas de ruta diarias</p>
        </div>
        <Link href="/logistica/rutas/nueva">
          <Button className="bg-blue-600 hover:bg-blue-700">
            <Plus className="mr-2 h-4 w-4" /> Nueva Hoja de Ruta
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <Card className="border-blue-200">
        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Desde</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Hasta</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Estado</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos</SelectItem>
                  <SelectItem value="PLANNING">Planificacion</SelectItem>
                  <SelectItem value="IN_PROGRESS">En Curso</SelectItem>
                  <SelectItem value="COMPLETED">Completada</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={fetchRoutes} className="bg-blue-600 hover:bg-blue-700">
                <Search className="mr-2 h-4 w-4" /> Buscar
              </Button>
              {hasActiveFilters && (
                <Button variant="outline" onClick={handleClearFilters} className="text-gray-600">
                  <XCircle className="mr-2 h-4 w-4" /> Limpiar
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="border-blue-200">
        <CardContent className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : routes.length === 0 ? (
            <div className="text-center py-12">
              <Map className="h-16 w-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 text-lg">No hay hojas de ruta</p>
              <p className="text-gray-400 text-sm mt-1">Crea una nueva hoja de ruta para empezar</p>
              <Link href="/logistica/rutas/nueva">
                <Button className="mt-4 bg-blue-600 hover:bg-blue-700">
                  <Plus className="mr-2 h-4 w-4" /> Nueva Hoja de Ruta
                </Button>
              </Link>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead>Fecha</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Paradas</TableHead>
                    <TableHead>Zonas</TableHead>
                    <TableHead>Progreso</TableHead>
                    <TableHead>Creado por</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {routes.map((route) => {
                    const zones = getZoneSummary(route.stops)
                    const progress = getStopStatusSummary(route.stops)
                    return (
                      <TableRow key={route.id} className="hover:bg-blue-50/30">
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <CalendarDays className="h-4 w-4 text-gray-400" />
                            <span className="font-medium">{formatDate(route.date)}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={statusColors[route.status]}>
                            {statusLabels[route.status]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="font-semibold">{route._count.stops}</span>
                          <span className="text-gray-500 text-sm ml-1">paradas</span>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1 flex-wrap">
                            {Object.entries(zones).map(([zone, count]) => (
                              <Badge key={zone} variant="outline" className={`text-xs ${zoneColors[zone] || ''}`}>
                                {zoneLabels[zone] || zone} ({count})
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          {progress.total > 0 && (
                            <div className="flex items-center gap-2">
                              <div className="w-24 bg-gray-200 rounded-full h-2">
                                <div
                                  className="bg-green-500 h-2 rounded-full transition-all"
                                  style={{ width: `${(progress.delivered / progress.total) * 100}%` }}
                                />
                              </div>
                              <span className="text-xs text-gray-500">
                                {progress.delivered}/{progress.total}
                              </span>
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-gray-600">{route.createdBy.name}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Link href={`/logistica/rutas/${route.id}`}>
                            <Button variant="outline" size="sm">
                              <Eye className="h-4 w-4 mr-1" /> Ver
                            </Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
