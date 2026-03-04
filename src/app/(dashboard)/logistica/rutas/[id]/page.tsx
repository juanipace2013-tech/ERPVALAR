'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  ArrowLeft,
  Loader2,
  Play,
  CheckCircle2,
  Download,
  Map,
  Truck,
  Package,
  Phone,
  MapPin,
  Clock,
  Edit,
  AlertCircle,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { generateRutaPDF, type RutaPDFData } from '@/lib/pdf/ruta-generator'

interface DeliveryStop {
  id: string
  order: number
  type: string
  customerName: string
  address: string | null
  city: string | null
  zone: string
  transportType: string
  transportName: string | null
  packages: number
  schedule: string | null
  contactName: string | null
  contactPhone: string | null
  finalDestination: string | null
  trackingNumber: string | null
  deliveryDeadline: string | null
  observations: string | null
  status: string
  completedAt: string | null
  deliveryNote: {
    id: string
    deliveryNumber: string
    status: string
    customer: { name: string }
  } | null
}

interface DeliveryRoute {
  id: string
  date: string
  status: string
  notes: string | null
  createdBy: { id: string; name: string }
  stops: DeliveryStop[]
  createdAt: string
}

const routeStatusLabels: Record<string, string> = {
  PLANNING: 'Planificacion',
  IN_PROGRESS: 'En Curso',
  COMPLETED: 'Completada',
}

const routeStatusColors: Record<string, string> = {
  PLANNING: 'bg-yellow-100 text-yellow-800',
  IN_PROGRESS: 'bg-blue-100 text-blue-800',
  COMPLETED: 'bg-green-100 text-green-800',
}

const stopStatusLabels: Record<string, string> = {
  PENDING: 'Pendiente',
  PREPARING: 'En Preparacion',
  IN_ROUTE: 'En Ruta',
  DELIVERED: 'Entregado',
  NOT_DELIVERED: 'No Entregado',
  PICKED_UP: 'Retirado',
}

const stopStatusColors: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-800',
  PREPARING: 'bg-yellow-100 text-yellow-800',
  IN_ROUTE: 'bg-blue-100 text-blue-800',
  DELIVERED: 'bg-green-100 text-green-800',
  NOT_DELIVERED: 'bg-red-100 text-red-800',
  PICKED_UP: 'bg-purple-100 text-purple-800',
}

const zoneLabels: Record<string, string> = {
  CABA: 'CABA',
  NORTE: 'Zona Norte',
  SUR: 'Zona Sur',
  OESTE: 'Zona Oeste',
}

const zoneBgColors: Record<string, string> = {
  CABA: 'bg-blue-500',
  NORTE: 'bg-green-500',
  SUR: 'bg-red-500',
  OESTE: 'bg-yellow-500',
}

const TERMINAL_STATUSES = ['DELIVERED', 'NOT_DELIVERED', 'PICKED_UP']

export default function RutaDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params?.id as string

  const [route, setRoute] = useState<DeliveryRoute | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)

  // Stop status dialog
  const [showStopDialog, setShowStopDialog] = useState(false)
  const [selectedStop, setSelectedStop] = useState<DeliveryStop | null>(null)
  const [newStopStatus, setNewStopStatus] = useState('')

  useEffect(() => {
    fetchRoute()
  }, [id])

  const fetchRoute = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/logistica/rutas/${id}`)
      if (!response.ok) throw new Error('Error al cargar ruta')
      const data = await response.json()
      setRoute(data)
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar hoja de ruta')
      router.push('/logistica/rutas')
    } finally {
      setLoading(false)
    }
  }

  const handleChangeRouteStatus = async (status: string) => {
    try {
      setActionLoading(true)
      const response = await fetch(`/api/logistica/rutas/${id}/change-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error al cambiar estado')
      }

      toast.success(`Ruta ${status === 'IN_PROGRESS' ? 'iniciada' : 'completada'}`)
      fetchRoute()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al cambiar estado')
    } finally {
      setActionLoading(false)
    }
  }

  const openStopStatusDialog = (stop: DeliveryStop, status: string) => {
    setSelectedStop(stop)
    setNewStopStatus(status)
    setShowStopDialog(true)
  }

  const confirmStopStatusChange = async () => {
    if (!selectedStop) return
    try {
      setActionLoading(true)
      const response = await fetch(
        `/api/logistica/rutas/${id}/stops/${selectedStop.id}/change-status`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStopStatus }),
        }
      )

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error')
      }

      toast.success(`Parada actualizada a ${stopStatusLabels[newStopStatus]}`)
      setShowStopDialog(false)
      fetchRoute()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al cambiar estado')
    } finally {
      setActionLoading(false)
    }
  }

  const handleDownloadPDF = () => {
    if (!route) return
    try {
      const pdfData: RutaPDFData = {
        date: new Date(route.date),
        status: route.status,
        notes: route.notes,
        createdBy: route.createdBy.name,
        stops: route.stops.map((s) => ({
          order: s.order,
          type: s.type,
          customerName: s.customerName,
          address: s.address,
          city: s.city,
          zone: s.zone,
          transportType: s.transportType,
          transportName: s.transportName,
          packages: s.packages,
          schedule: s.schedule,
          contactName: s.contactName,
          contactPhone: s.contactPhone,
          finalDestination: s.finalDestination,
          observations: s.observations,
          deliveryNumber: s.deliveryNote?.deliveryNumber || null,
        })),
      }
      const blob = generateRutaPDF(pdfData)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const dateStr = new Date(route.date).toISOString().split('T')[0]
      a.download = `Hoja-de-Ruta-${dateStr}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success('PDF generado correctamente')
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al generar PDF')
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('es-AR', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">Cargando hoja de ruta...</p>
        </div>
      </div>
    )
  }

  if (!route) {
    return (
      <div className="container mx-auto px-6 py-8">
        <Card>
          <CardContent className="text-center py-12">
            <Map className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-600">Hoja de ruta no encontrada</p>
            <Button asChild className="mt-4">
              <Link href="/logistica/rutas">Volver</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Group stops by zone
  const stopsByZone = ['CABA', 'NORTE', 'SUR', 'OESTE']
    .map((zone) => ({
      zone,
      stops: route.stops.filter((s) => s.zone === zone),
    }))
    .filter((g) => g.stops.length > 0)

  const totalDeliveries = route.stops.filter((s) => s.type === 'DELIVERY').length
  const totalPickups = route.stops.filter((s) => s.type === 'PICKUP').length
  const totalPackages = route.stops.reduce((sum, s) => sum + s.packages, 0)
  const completedStops = route.stops.filter((s) => TERMINAL_STATUSES.includes(s.status)).length
  const allResolved = route.stops.length > 0 && completedStops === route.stops.length

  return (
    <div className="container mx-auto px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/logistica/rutas">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              Hoja de Ruta - {formatDate(route.date)}
            </h1>
            <p className="text-sm text-gray-600 mt-1">
              Creada por {route.createdBy.name}
            </p>
          </div>
        </div>
        <Badge className={`text-sm px-3 py-1 ${routeStatusColors[route.status]}`}>
          {routeStatusLabels[route.status]}
        </Badge>
      </div>

      {/* Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Acciones</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {route.status === 'PLANNING' && (
              <>
                <Button
                  onClick={() => handleChangeRouteStatus('IN_PROGRESS')}
                  disabled={actionLoading}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Play className="h-4 w-4 mr-2" />
                  Iniciar Ruta
                </Button>
                <Button variant="outline" asChild>
                  <Link href={`/logistica/rutas/nueva?edit=${route.id}`}>
                    <Edit className="h-4 w-4 mr-2" />
                    Editar
                  </Link>
                </Button>
              </>
            )}

            {route.status === 'IN_PROGRESS' && allResolved && (
              <Button
                onClick={() => handleChangeRouteStatus('COMPLETED')}
                disabled={actionLoading}
                className="bg-green-600 hover:bg-green-700"
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Completar Ruta
              </Button>
            )}

            {route.status === 'IN_PROGRESS' && !allResolved && (
              <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 px-3 py-2 rounded-lg">
                <AlertCircle className="h-4 w-4" />
                Resuelve todas las paradas para completar la ruta ({completedStops}/{route.stops.length})
              </div>
            )}

            <Button variant="outline" onClick={handleDownloadPDF}>
              <Download className="h-4 w-4 mr-2" />
              Descargar PDF
            </Button>

            {actionLoading && <Loader2 className="h-5 w-5 animate-spin text-blue-600" />}
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{route.stops.length}</p>
            <p className="text-sm text-gray-500">Paradas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-green-600">{totalDeliveries}</p>
            <p className="text-sm text-gray-500">Entregas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-purple-600">{totalPickups}</p>
            <p className="text-sm text-gray-500">Retiros</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-orange-600">{totalPackages}</p>
            <p className="text-sm text-gray-500">Bultos</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-emerald-600">
              {route.stops.length > 0
                ? Math.round((completedStops / route.stops.length) * 100)
                : 0}%
            </p>
            <p className="text-sm text-gray-500">Completado</p>
          </CardContent>
        </Card>
      </div>

      {/* Stops by Zone */}
      {stopsByZone.map((group) => (
        <Card key={group.zone} className="overflow-hidden">
          <div className={`${zoneBgColors[group.zone]} px-4 py-2 flex items-center justify-between`}>
            <h3 className="text-white font-semibold">
              {zoneLabels[group.zone]} ({group.stops.length} paradas)
            </h3>
            <Badge className="bg-white/20 text-white border-0">
              {group.stops.filter((s) => TERMINAL_STATUSES.includes(s.status)).length}/{group.stops.length} resueltas
            </Badge>
          </div>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <TableHead className="w-12 text-center">#</TableHead>
                  <TableHead>Remito</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Direccion</TableHead>
                  <TableHead>Transporte</TableHead>
                  <TableHead className="text-center">Bultos</TableHead>
                  <TableHead>Horario</TableHead>
                  <TableHead>Contacto</TableHead>
                  <TableHead>Destino Final</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Accion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.stops.map((stop) => (
                  <TableRow
                    key={stop.id}
                    className={
                      stop.status === 'DELIVERED' || stop.status === 'PICKED_UP'
                        ? 'bg-green-50/50'
                        : stop.status === 'NOT_DELIVERED'
                          ? 'bg-red-50/50'
                          : ''
                    }
                  >
                    <TableCell className="text-center font-mono font-bold text-gray-400">
                      {stop.order}
                    </TableCell>
                    <TableCell>
                      {stop.type === 'PICKUP' ? (
                        <Badge className="bg-purple-100 text-purple-700 text-xs">RETIRO</Badge>
                      ) : stop.deliveryNote ? (
                        <Link
                          href={`/remitos/${stop.deliveryNote.id}`}
                          className="text-blue-600 hover:underline font-mono text-sm"
                        >
                          {stop.deliveryNote.deliveryNumber}
                        </Link>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{stop.customerName}</TableCell>
                    <TableCell>
                      <div className="flex items-start gap-1">
                        <MapPin className="h-3 w-3 text-gray-400 mt-0.5 shrink-0" />
                        <span className="text-sm">
                          {[stop.address, stop.city].filter(Boolean).join(', ') || '-'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Truck className="h-3 w-3 text-gray-400" />
                        <span className="text-sm">
                          {stop.transportType === 'OWN'
                            ? 'Propio'
                            : stop.transportName || 'Tercero'}
                        </span>
                      </div>
                      {stop.trackingNumber && (
                        <p className="text-xs text-gray-500 mt-0.5">
                          Guia: {stop.trackingNumber}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-center font-semibold">
                      {stop.packages || '-'}
                    </TableCell>
                    <TableCell>
                      {stop.schedule ? (
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3 text-gray-400" />
                          <span className="text-sm">{stop.schedule}</span>
                        </div>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell>
                      {stop.contactName || stop.contactPhone ? (
                        <div>
                          {stop.contactName && (
                            <p className="text-sm">{stop.contactName}</p>
                          )}
                          {stop.contactPhone && (
                            <div className="flex items-center gap-1 text-xs text-gray-500">
                              <Phone className="h-3 w-3" />
                              {stop.contactPhone}
                            </div>
                          )}
                        </div>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{stop.finalDestination || '-'}</span>
                    </TableCell>
                    <TableCell>
                      <Badge className={stopStatusColors[stop.status]}>
                        {stopStatusLabels[stop.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {route.status === 'IN_PROGRESS' && !TERMINAL_STATUSES.includes(stop.status) && (
                        <div className="flex gap-1 justify-end">
                          {stop.type === 'PICKUP' ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-purple-600 border-purple-300 hover:bg-purple-50"
                              onClick={() => openStopStatusDialog(stop, 'PICKED_UP')}
                            >
                              Retirado
                            </Button>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-green-600 border-green-300 hover:bg-green-50"
                                onClick={() => openStopStatusDialog(stop, 'DELIVERED')}
                              >
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Entregado
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-red-600 border-red-300 hover:bg-red-50"
                                onClick={() => openStopStatusDialog(stop, 'NOT_DELIVERED')}
                              >
                                <XCircle className="h-3 w-3 mr-1" />
                                No Ent.
                              </Button>
                            </>
                          )}
                        </div>
                      )}
                      {TERMINAL_STATUSES.includes(stop.status) && stop.completedAt && (
                        <span className="text-xs text-gray-500">
                          {new Date(stop.completedAt).toLocaleTimeString('es-AR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}

      {/* Notes */}
      {route.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Observaciones</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{route.notes}</p>
          </CardContent>
        </Card>
      )}

      {/* Stop Status Change Dialog */}
      <Dialog open={showStopDialog} onOpenChange={setShowStopDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Cambiar estado de parada
            </DialogTitle>
            <DialogDescription>
              {selectedStop && (
                <span>
                  {selectedStop.customerName} &rarr;{' '}
                  <Badge className={stopStatusColors[newStopStatus]}>
                    {stopStatusLabels[newStopStatus]}
                  </Badge>
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-gray-600">
              {newStopStatus === 'DELIVERED' &&
                'Se marcara esta parada como entregada. Si tiene un remito vinculado, el remito tambien se actualizara.'}
              {newStopStatus === 'NOT_DELIVERED' &&
                'Se marcara esta parada como no entregada.'}
              {newStopStatus === 'PICKED_UP' &&
                'Se marcara este retiro como completado.'}
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowStopDialog(false)}
              disabled={actionLoading}
            >
              Cancelar
            </Button>
            <Button
              onClick={confirmStopStatusChange}
              disabled={actionLoading}
              className={
                newStopStatus === 'DELIVERED' || newStopStatus === 'PICKED_UP'
                  ? 'bg-green-600 hover:bg-green-700'
                  : 'bg-red-600 hover:bg-red-700'
              }
            >
              {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
