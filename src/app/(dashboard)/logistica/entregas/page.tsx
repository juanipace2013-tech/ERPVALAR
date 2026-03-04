'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Loader2,
  PackageCheck,
  Package,
  Truck,
  MapPin,
  Clock,
  CheckCircle2,
  XCircle,
  ArrowRight,
  RotateCcw,
  FileText,
} from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface EntregaStop {
  id: string
  routeId: string
  route: {
    id: string
    date: string
    status: string
    createdBy: { id: string; name: string }
  }
  deliveryNote: { id: string; deliveryNumber: string } | null
  customerName: string
  address: string | null
  city: string | null
  zone: string
  transportType: string
  transportName: string | null
  packages: number
  status: string
  completedAt: string | null
  observations: string | null
  contactName: string | null
  contactPhone: string | null
}

type KanbanStatus = 'PENDING' | 'PREPARING' | 'IN_ROUTE' | 'DELIVERED' | 'NOT_DELIVERED'

// ─── Constantes ──────────────────────────────────────────────────────────────

const COLUMNS: { key: KanbanStatus; label: string; color: string; borderColor: string; bgColor: string }[] = [
  { key: 'PENDING', label: 'Pendiente', color: 'bg-gray-500', borderColor: 'border-l-gray-400', bgColor: 'bg-gray-50' },
  { key: 'PREPARING', label: 'En Preparación', color: 'bg-yellow-500', borderColor: 'border-l-yellow-400', bgColor: 'bg-yellow-50' },
  { key: 'IN_ROUTE', label: 'En Ruta', color: 'bg-blue-500', borderColor: 'border-l-blue-400', bgColor: 'bg-blue-50' },
  { key: 'DELIVERED', label: 'Entregado', color: 'bg-green-500', borderColor: 'border-l-green-400', bgColor: 'bg-green-50' },
  { key: 'NOT_DELIVERED', label: 'No Entregado', color: 'bg-red-500', borderColor: 'border-l-red-400', bgColor: 'bg-red-50' },
]

const ZONE_BADGE: Record<string, string> = {
  CABA: 'bg-blue-100 text-blue-800',
  NORTE: 'bg-green-100 text-green-800',
  SUR: 'bg-orange-100 text-orange-800',
  OESTE: 'bg-yellow-100 text-yellow-800',
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pendiente',
  PREPARING: 'En Preparación',
  IN_ROUTE: 'En Ruta',
  DELIVERED: 'Entregado',
  NOT_DELIVERED: 'No Entregado',
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function EntregasKanbanPage() {
  const [stops, setStops] = useState<EntregaStop[]>([])
  const [vendedores, setVendedores] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)

  // Filtros
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [zoneFilter, setZoneFilter] = useState('ALL')
  const [transportFilter, setTransportFilter] = useState('ALL')
  const [vendedorFilter, setVendedorFilter] = useState('ALL')

  // Dialog confirmación
  const [showConfirm, setShowConfirm] = useState(false)
  const [selectedStop, setSelectedStop] = useState<EntregaStop | null>(null)
  const [newStatus, setNewStatus] = useState<string>('')
  const [actionLoading, setActionLoading] = useState(false)

  // ─── Fetch data ──────────────────────────────────────────────────────────────

  const fetchStops = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (dateFrom) params.append('dateFrom', dateFrom)
      if (dateTo) params.append('dateTo', dateTo)
      if (zoneFilter !== 'ALL') params.append('zone', zoneFilter)
      if (transportFilter !== 'ALL') params.append('transportType', transportFilter)
      if (vendedorFilter !== 'ALL') params.append('vendedorId', vendedorFilter)

      const res = await fetch(`/api/logistica/entregas?${params.toString()}`)
      if (!res.ok) throw new Error('Error al cargar entregas')

      const data = await res.json()
      setStops(data.stops)
      setVendedores(data.vendedores)
    } catch (e) {
      toast.error('Error al cargar entregas')
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, zoneFilter, transportFilter, vendedorFilter])

  useEffect(() => {
    fetchStops()
  }, [fetchStops])

  // ─── Group by status ─────────────────────────────────────────────────────────

  const grouped = useMemo(() => {
    const map: Record<KanbanStatus, EntregaStop[]> = {
      PENDING: [],
      PREPARING: [],
      IN_ROUTE: [],
      DELIVERED: [],
      NOT_DELIVERED: [],
    }
    for (const s of stops) {
      const key = s.status as KanbanStatus
      if (map[key]) {
        map[key].push(s)
      }
    }
    return map
  }, [stops])

  // ─── Change status ───────────────────────────────────────────────────────────

  const requestStatusChange = (stop: EntregaStop, status: string) => {
    if (status === 'DELIVERED' || status === 'NOT_DELIVERED') {
      setSelectedStop(stop)
      setNewStatus(status)
      setShowConfirm(true)
    } else {
      executeStatusChange(stop, status)
    }
  }

  const executeStatusChange = async (stop: EntregaStop, status: string) => {
    try {
      setActionLoading(true)
      const res = await fetch(
        `/api/logistica/rutas/${stop.routeId}/stops/${stop.id}/change-status`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        }
      )
      if (!res.ok) throw new Error('Error al cambiar estado')

      toast.success(`Estado cambiado a ${STATUS_LABEL[status]}`)
      setShowConfirm(false)
      fetchStops()
    } catch (e) {
      toast.error('Error al cambiar estado')
    } finally {
      setActionLoading(false)
    }
  }

  const clearFilters = () => {
    setDateFrom('')
    setDateTo('')
    setZoneFilter('ALL')
    setTransportFilter('ALL')
    setVendedorFilter('ALL')
  }

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="container mx-auto px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <PackageCheck className="h-8 w-8 text-blue-600" />
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Entregas</h1>
          <p className="text-gray-600 text-sm mt-0.5">
            Tablero Kanban de gestión de entregas
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {COLUMNS.map((col) => (
          <Card key={col.key} className={`border-l-4 ${col.borderColor}`}>
            <CardContent className="py-3 px-4">
              <p className="text-xs text-gray-500">{col.label}</p>
              <p className="text-2xl font-bold text-gray-900">
                {grouped[col.key]?.length || 0}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Desde</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-8 text-sm w-36"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Hasta</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-8 text-sm w-36"
              />
            </div>
            <div className="min-w-[120px]">
              <label className="text-xs text-gray-500 mb-1 block">Zona</label>
              <Select value={zoneFilter} onValueChange={setZoneFilter}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todas</SelectItem>
                  <SelectItem value="CABA">CABA</SelectItem>
                  <SelectItem value="NORTE">Norte</SelectItem>
                  <SelectItem value="SUR">Sur</SelectItem>
                  <SelectItem value="OESTE">Oeste</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[120px]">
              <label className="text-xs text-gray-500 mb-1 block">Transporte</label>
              <Select value={transportFilter} onValueChange={setTransportFilter}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos</SelectItem>
                  <SelectItem value="OWN">Propio</SelectItem>
                  <SelectItem value="THIRD_PARTY">Tercero</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[150px]">
              <label className="text-xs text-gray-500 mb-1 block">Vendedor</label>
              <Select value={vendedorFilter} onValueChange={setVendedorFilter}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos</SelectItem>
                  {vendedores.map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" size="sm" className="h-8" onClick={clearFilters}>
              Limpiar
            </Button>
            <span className="text-xs text-gray-500 self-end pb-1 ml-auto">
              {stops.length} entregas
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      )}

      {/* Kanban Board */}
      {!loading && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {COLUMNS.map((col) => (
            <div key={col.key} className="flex flex-col">
              {/* Column header */}
              <div className={`${col.color} text-white px-3 py-2 rounded-t-lg flex items-center justify-between`}>
                <span className="text-sm font-semibold">{col.label}</span>
                <Badge variant="secondary" className="bg-white/20 text-white text-xs">
                  {grouped[col.key].length}
                </Badge>
              </div>

              {/* Column body */}
              <div className={`${col.bgColor} border border-t-0 rounded-b-lg p-2 space-y-2 min-h-[200px] max-h-[calc(100vh-420px)] overflow-y-auto`}>
                {grouped[col.key].length === 0 ? (
                  <p className="text-center text-xs text-gray-400 py-8">
                    Sin entregas
                  </p>
                ) : (
                  grouped[col.key].map((stop) => (
                    <DeliveryCard
                      key={stop.id}
                      stop={stop}
                      onStatusChange={requestStatusChange}
                    />
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Dialog confirmación */}
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar cambio de estado</DialogTitle>
            <DialogDescription>
              {selectedStop && (
                <>
                  <span className="font-semibold text-gray-800">{selectedStop.customerName}</span>
                  {selectedStop.deliveryNote && (
                    <> — Remito {selectedStop.deliveryNote.deliveryNumber}</>
                  )}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="py-2">
            {newStatus === 'DELIVERED' ? (
              <div className="flex items-center gap-2 text-green-700 bg-green-50 p-3 rounded-lg">
                <CheckCircle2 className="h-5 w-5" />
                <p className="text-sm">
                  Se marcará esta entrega como <strong>entregada</strong>.
                  {selectedStop?.deliveryNote && ' El remito vinculado también se actualizará.'}
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-red-700 bg-red-50 p-3 rounded-lg">
                <XCircle className="h-5 w-5" />
                <p className="text-sm">
                  Se marcará esta entrega como <strong>no entregada</strong>.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirm(false)} disabled={actionLoading}>
              Cancelar
            </Button>
            <Button
              onClick={() => selectedStop && executeStatusChange(selectedStop, newStatus)}
              disabled={actionLoading}
              className={newStatus === 'DELIVERED' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}
            >
              {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {newStatus === 'DELIVERED' ? 'Confirmar Entrega' : 'Confirmar No Entregado'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Delivery Card Component ────────────────────────────────────────────────

function DeliveryCard({
  stop,
  onStatusChange,
}: {
  stop: EntregaStop
  onStatusChange: (stop: EntregaStop, status: string) => void
}) {
  const routeDate = new Date(stop.route.date).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
  })

  return (
    <Card className="shadow-sm hover:shadow-md transition-shadow">
      <CardContent className="p-3 space-y-2">
        {/* Remito + fecha */}
        <div className="flex items-center justify-between">
          {stop.deliveryNote ? (
            <Link
              href={`/remitos/${stop.deliveryNote.id}`}
              className="text-xs font-mono text-blue-600 hover:underline flex items-center gap-1"
            >
              <FileText className="h-3 w-3" />
              {stop.deliveryNote.deliveryNumber}
            </Link>
          ) : (
            <span className="text-xs text-gray-400">Sin remito</span>
          )}
          <span className="text-xs text-gray-500">{routeDate}</span>
        </div>

        {/* Cliente */}
        <p className="text-sm font-semibold text-gray-900 leading-tight">
          {stop.customerName}
        </p>

        {/* Dirección */}
        {(stop.address || stop.city) && (
          <div className="flex items-start gap-1">
            <MapPin className="h-3 w-3 text-gray-400 mt-0.5 shrink-0" />
            <p className="text-xs text-gray-600 leading-tight">
              {[stop.address, stop.city].filter(Boolean).join(', ')}
            </p>
          </div>
        )}

        {/* Zona + Bultos + Transporte */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={`text-[10px] ${ZONE_BADGE[stop.zone] || 'bg-gray-100 text-gray-800'}`}>
            {stop.zone}
          </Badge>
          {stop.packages > 0 && (
            <span className="flex items-center gap-0.5 text-xs text-gray-500">
              <Package className="h-3 w-3" /> {stop.packages}
            </span>
          )}
          <span className="flex items-center gap-0.5 text-xs text-gray-500">
            <Truck className="h-3 w-3" />
            {stop.transportType === 'OWN' ? 'Propio' : stop.transportName || 'Tercero'}
          </span>
        </div>

        {/* Completado */}
        {stop.completedAt && (
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <Clock className="h-3 w-3" />
            {new Date(stop.completedAt).toLocaleString('es-AR', {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-1 pt-1">
          {stop.status === 'PENDING' && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px] px-2 text-yellow-700 border-yellow-300 hover:bg-yellow-50"
                onClick={() => onStatusChange(stop, 'PREPARING')}
              >
                Preparar
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px] px-2 text-blue-700 border-blue-300 hover:bg-blue-50"
                onClick={() => onStatusChange(stop, 'IN_ROUTE')}
              >
                En Ruta <ArrowRight className="h-3 w-3 ml-0.5" />
              </Button>
            </>
          )}
          {stop.status === 'PREPARING' && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px] px-2 text-blue-700 border-blue-300 hover:bg-blue-50"
                onClick={() => onStatusChange(stop, 'IN_ROUTE')}
              >
                En Ruta <ArrowRight className="h-3 w-3 ml-0.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] px-2 text-gray-500"
                onClick={() => onStatusChange(stop, 'PENDING')}
              >
                <RotateCcw className="h-3 w-3 mr-0.5" /> Pendiente
              </Button>
            </>
          )}
          {stop.status === 'IN_ROUTE' && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px] px-2 text-green-700 border-green-300 hover:bg-green-50"
                onClick={() => onStatusChange(stop, 'DELIVERED')}
              >
                <CheckCircle2 className="h-3 w-3 mr-0.5" /> Entregado
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px] px-2 text-red-700 border-red-300 hover:bg-red-50"
                onClick={() => onStatusChange(stop, 'NOT_DELIVERED')}
              >
                <XCircle className="h-3 w-3 mr-0.5" /> No Ent.
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
