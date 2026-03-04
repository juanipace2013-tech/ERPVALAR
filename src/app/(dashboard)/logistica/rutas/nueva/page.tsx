'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  ArrowLeft,
  Plus,
  Trash2,
  Loader2,
  Package,
  ArrowRight,
  GripVertical,
  MapPin,
  ChevronUp,
  ChevronDown,
  Truck,
} from 'lucide-react'
import { toast } from 'sonner'

interface PendingRemito {
  id: string
  deliveryNumber: string
  date: string
  deliveryAddress: string | null
  deliveryCity: string | null
  deliveryProvince: string | null
  bultos: number | null
  carrier: string | null
  trackingNumber: string | null
  customer: {
    id: string
    name: string
    address: string | null
    city: string | null
    province: string | null
    phone: string | null
  }
  items: Array<{
    description: string
    quantity: number
  }>
}

interface StopData {
  tempId: string
  deliveryNoteId: string | null
  deliveryNumber: string | null
  type: 'DELIVERY' | 'PICKUP'
  customerName: string
  transportType: 'OWN' | 'THIRD_PARTY'
  transportName: string
  address: string
  city: string
  zone: 'CABA' | 'NORTE' | 'SUR' | 'OESTE'
  schedule: string
  contactName: string
  contactPhone: string
  packages: number
  finalDestination: string
  trackingNumber: string
  deliveryDeadline: string
  observations: string
}

const zoneLabels: Record<string, string> = {
  CABA: 'CABA',
  NORTE: 'Zona Norte',
  SUR: 'Zona Sur',
  OESTE: 'Zona Oeste',
}

const zoneColors: Record<string, string> = {
  CABA: 'border-l-blue-500',
  NORTE: 'border-l-green-500',
  SUR: 'border-l-red-500',
  OESTE: 'border-l-yellow-500',
}

function createEmptyStop(): StopData {
  return {
    tempId: crypto.randomUUID(),
    deliveryNoteId: null,
    deliveryNumber: null,
    type: 'DELIVERY',
    customerName: '',
    transportType: 'OWN',
    transportName: '',
    address: '',
    city: '',
    zone: 'CABA',
    schedule: '',
    contactName: '',
    contactPhone: '',
    packages: 0,
    finalDestination: '',
    trackingNumber: '',
    deliveryDeadline: '',
    observations: '',
  }
}

export default function NuevaRutaPage() {
  const router = useRouter()
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState('')
  const [stops, setStops] = useState<StopData[]>([])
  const [saving, setSaving] = useState(false)

  // Pending remitos
  const [pendingRemitos, setPendingRemitos] = useState<PendingRemito[]>([])
  const [loadingRemitos, setLoadingRemitos] = useState(true)

  // Manual stop dialog
  const [showManualDialog, setShowManualDialog] = useState(false)
  const [manualStop, setManualStop] = useState<StopData>(createEmptyStop())

  useEffect(() => {
    fetchPendingRemitos()
  }, [])

  const fetchPendingRemitos = async () => {
    try {
      setLoadingRemitos(true)
      const response = await fetch('/api/logistica/remitos-pendientes')
      if (!response.ok) throw new Error()
      const data = await response.json()
      setPendingRemitos(data)
    } catch {
      toast.error('Error al cargar remitos pendientes')
    } finally {
      setLoadingRemitos(false)
    }
  }

  const addRemitoToRoute = (remito: PendingRemito) => {
    // Check if already added
    if (stops.some((s) => s.deliveryNoteId === remito.id)) {
      toast.error('Este remito ya fue agregado')
      return
    }

    const newStop: StopData = {
      tempId: crypto.randomUUID(),
      deliveryNoteId: remito.id,
      deliveryNumber: remito.deliveryNumber,
      type: 'DELIVERY',
      customerName: remito.customer.name,
      transportType: remito.carrier ? 'THIRD_PARTY' : 'OWN',
      transportName: remito.carrier || '',
      address: remito.deliveryAddress || remito.customer.address || '',
      city: remito.deliveryCity || remito.customer.city || '',
      zone: 'CABA',
      schedule: '',
      contactName: '',
      contactPhone: remito.customer.phone || '',
      packages: remito.bultos || 0,
      finalDestination: '',
      trackingNumber: remito.trackingNumber || '',
      deliveryDeadline: '',
      observations: '',
    }

    setStops((prev) => [...prev, newStop])
    toast.success(`Remito ${remito.deliveryNumber} agregado`)
  }

  const removeStop = (tempId: string) => {
    setStops((prev) => prev.filter((s) => s.tempId !== tempId))
  }

  const moveStop = (index: number, direction: 'up' | 'down') => {
    const newStops = [...stops]
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= newStops.length) return
    ;[newStops[index], newStops[targetIndex]] = [newStops[targetIndex], newStops[index]]
    setStops(newStops)
  }

  const updateStop = (tempId: string, field: keyof StopData, value: any) => {
    setStops((prev) =>
      prev.map((s) => (s.tempId === tempId ? { ...s, [field]: value } : s))
    )
  }

  const addManualStop = () => {
    if (!manualStop.customerName.trim()) {
      toast.error('El nombre del cliente/proveedor es requerido')
      return
    }
    setStops((prev) => [...prev, { ...manualStop, tempId: crypto.randomUUID() }])
    setShowManualDialog(false)
    setManualStop(createEmptyStop())
    toast.success('Parada manual agregada')
  }

  const handleSave = async () => {
    if (!date) {
      toast.error('La fecha es requerida')
      return
    }
    if (stops.length === 0) {
      toast.error('Debe agregar al menos una parada')
      return
    }

    try {
      setSaving(true)
      const response = await fetch('/api/logistica/rutas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          notes: notes || null,
          stops: stops.map((stop, index) => ({
            deliveryNoteId: stop.deliveryNoteId,
            order: index + 1,
            type: stop.type,
            customerName: stop.customerName,
            transportType: stop.transportType,
            transportName: stop.transportName || null,
            address: stop.address || null,
            city: stop.city || null,
            zone: stop.zone,
            schedule: stop.schedule || null,
            contactName: stop.contactName || null,
            contactPhone: stop.contactPhone || null,
            packages: stop.packages || 0,
            finalDestination: stop.finalDestination || null,
            trackingNumber: stop.trackingNumber || null,
            deliveryDeadline: stop.deliveryDeadline || null,
            observations: stop.observations || null,
          })),
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error al crear hoja de ruta')
      }

      const route = await response.json()
      toast.success('Hoja de ruta creada exitosamente')
      router.push(`/logistica/rutas/${route.id}`)
    } catch (error) {
      console.error('Error:', error)
      toast.error(error instanceof Error ? error.message : 'Error al crear hoja de ruta')
    } finally {
      setSaving(false)
    }
  }

  // Filter out already-added remitos
  const availableRemitos = pendingRemitos.filter(
    (r) => !stops.some((s) => s.deliveryNoteId === r.id)
  )

  // Group stops by zone for display
  const stopsByZone = ['CABA', 'NORTE', 'SUR', 'OESTE'].map((zone) => ({
    zone,
    stops: stops
      .map((s, i) => ({ ...s, globalIndex: i }))
      .filter((s) => s.zone === zone),
  })).filter((g) => g.stops.length > 0)

  const totalPackages = stops.reduce((sum, s) => sum + (s.packages || 0), 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/logistica/rutas">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-blue-900">Nueva Hoja de Ruta</h1>
          <p className="text-muted-foreground">Arma la hoja de ruta del dia</p>
        </div>
      </div>

      {/* Date & Notes */}
      <Card className="border-blue-200">
        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label>Fecha del recorrido *</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <Label>Notas generales</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notas para la hoja de ruta..."
                rows={2}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left panel: Pending remitos */}
        <div className="lg:col-span-1 space-y-4">
          <Card className="border-blue-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Package className="h-5 w-5" />
                Remitos Pendientes
                <Badge variant="outline" className="ml-auto">{availableRemitos.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 max-h-[600px] overflow-y-auto">
              {loadingRemitos ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                </div>
              ) : availableRemitos.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-4">No hay remitos pendientes</p>
              ) : (
                availableRemitos.map((remito) => (
                  <div
                    key={remito.id}
                    className="border rounded-lg p-3 hover:bg-blue-50/50 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm">{remito.deliveryNumber}</p>
                        <p className="text-sm text-gray-700 truncate">{remito.customer.name}</p>
                        <p className="text-xs text-gray-500 truncate">
                          {remito.deliveryAddress || remito.customer.address || 'Sin direccion'}
                        </p>
                        {remito.bultos && (
                          <p className="text-xs text-gray-500">{remito.bultos} bultos</p>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-2 shrink-0"
                        onClick={() => addRemitoToRoute(remito)}
                      >
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right panel: Route stops */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Paradas de la Ruta
              <Badge variant="outline">{stops.length}</Badge>
              {totalPackages > 0 && (
                <Badge variant="outline" className="bg-blue-50">{totalPackages} bultos</Badge>
              )}
            </h2>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setManualStop({ ...createEmptyStop(), type: 'PICKUP' })
                setShowManualDialog(true)
              }}
            >
              <Plus className="h-4 w-4 mr-1" /> Parada Manual
            </Button>
          </div>

          {stops.length === 0 ? (
            <Card className="border-dashed border-2 border-gray-300">
              <CardContent className="text-center py-12">
                <Truck className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500">No hay paradas en la ruta</p>
                <p className="text-gray-400 text-sm mt-1">
                  Agrega remitos del panel izquierdo o crea paradas manuales
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {stops.map((stop, index) => (
                <Card
                  key={stop.tempId}
                  className={`border-l-4 ${zoneColors[stop.zone] || 'border-l-gray-300'}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      {/* Order controls */}
                      <div className="flex flex-col items-center gap-0.5 pt-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => moveStop(index, 'up')}
                          disabled={index === 0}
                        >
                          <ChevronUp className="h-4 w-4" />
                        </Button>
                        <span className="text-sm font-bold text-gray-400">{index + 1}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => moveStop(index, 'down')}
                          disabled={index === stops.length - 1}
                        >
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </div>

                      {/* Stop details */}
                      <div className="flex-1 space-y-3">
                        {/* Top row: name & remito number */}
                        <div className="flex items-center gap-2 flex-wrap">
                          {stop.type === 'PICKUP' && (
                            <Badge className="bg-purple-100 text-purple-700">RETIRO</Badge>
                          )}
                          {stop.deliveryNumber && (
                            <Badge variant="outline" className="font-mono">{stop.deliveryNumber}</Badge>
                          )}
                          <span className="font-semibold">{stop.customerName}</span>
                        </div>

                        {/* Editable fields */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div>
                            <Label className="text-xs">Direccion</Label>
                            <Input
                              value={stop.address}
                              onChange={(e) => updateStop(stop.tempId, 'address', e.target.value)}
                              placeholder="Direccion"
                              className="h-8 text-sm"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Ciudad</Label>
                            <Input
                              value={stop.city}
                              onChange={(e) => updateStop(stop.tempId, 'city', e.target.value)}
                              placeholder="Ciudad"
                              className="h-8 text-sm"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Zona</Label>
                            <Select
                              value={stop.zone}
                              onValueChange={(v) => updateStop(stop.tempId, 'zone', v)}
                            >
                              <SelectTrigger className="h-8 text-sm">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="CABA">CABA</SelectItem>
                                <SelectItem value="NORTE">Norte</SelectItem>
                                <SelectItem value="SUR">Sur</SelectItem>
                                <SelectItem value="OESTE">Oeste</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs">Transporte</Label>
                            <Select
                              value={stop.transportType}
                              onValueChange={(v) => updateStop(stop.tempId, 'transportType', v)}
                            >
                              <SelectTrigger className="h-8 text-sm">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="OWN">Propio</SelectItem>
                                <SelectItem value="THIRD_PARTY">Tercero</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        {stop.transportType === 'THIRD_PARTY' && (
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <Label className="text-xs">Nombre transporte</Label>
                              <Input
                                value={stop.transportName}
                                onChange={(e) => updateStop(stop.tempId, 'transportName', e.target.value)}
                                placeholder="Ej: Cruz del Sur"
                                className="h-8 text-sm"
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Nro de guia</Label>
                              <Input
                                value={stop.trackingNumber}
                                onChange={(e) => updateStop(stop.tempId, 'trackingNumber', e.target.value)}
                                placeholder="Numero de seguimiento"
                                className="h-8 text-sm"
                              />
                            </div>
                          </div>
                        )}

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div>
                            <Label className="text-xs">Bultos</Label>
                            <Input
                              type="number"
                              min="0"
                              value={stop.packages}
                              onChange={(e) => updateStop(stop.tempId, 'packages', parseInt(e.target.value) || 0)}
                              className="h-8 text-sm"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Horario recepcion</Label>
                            <Input
                              value={stop.schedule}
                              onChange={(e) => updateStop(stop.tempId, 'schedule', e.target.value)}
                              placeholder="Ej: 8 a 16"
                              className="h-8 text-sm"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Contacto</Label>
                            <Input
                              value={stop.contactName}
                              onChange={(e) => updateStop(stop.tempId, 'contactName', e.target.value)}
                              placeholder="Nombre"
                              className="h-8 text-sm"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Telefono</Label>
                            <Input
                              value={stop.contactPhone}
                              onChange={(e) => updateStop(stop.tempId, 'contactPhone', e.target.value)}
                              placeholder="Telefono"
                              className="h-8 text-sm"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs">Destino final (interior)</Label>
                            <Input
                              value={stop.finalDestination}
                              onChange={(e) => updateStop(stop.tempId, 'finalDestination', e.target.value)}
                              placeholder="Destino interior si aplica"
                              className="h-8 text-sm"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Observaciones</Label>
                            <Input
                              value={stop.observations}
                              onChange={(e) => updateStop(stop.tempId, 'observations', e.target.value)}
                              placeholder="Notas de esta parada"
                              className="h-8 text-sm"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Delete button */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 shrink-0"
                        onClick={() => removeStop(stop.tempId)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Summary */}
          {stops.length > 0 && (
            <Card className="bg-blue-50 border-blue-200">
              <CardContent className="p-4">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div className="flex gap-4 text-sm">
                    <span><strong>{stops.length}</strong> paradas</span>
                    <span><strong>{stops.filter((s) => s.type === 'DELIVERY').length}</strong> entregas</span>
                    <span><strong>{stops.filter((s) => s.type === 'PICKUP').length}</strong> retiros</span>
                    <span><strong>{totalPackages}</strong> bultos</span>
                  </div>
                  <div className="flex gap-2">
                    {Object.entries(
                      stops.reduce((acc, s) => {
                        acc[s.zone] = (acc[s.zone] || 0) + 1
                        return acc
                      }, {} as Record<string, number>)
                    ).map(([zone, count]) => (
                      <Badge key={zone} variant="outline" className="text-xs">
                        {zoneLabels[zone]} ({count})
                      </Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Save button */}
          <div className="flex justify-end gap-3">
            <Button variant="outline" asChild>
              <Link href="/logistica/rutas">Cancelar</Link>
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || stops.length === 0}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Crear Hoja de Ruta
            </Button>
          </div>
        </div>
      </div>

      {/* Manual Stop Dialog */}
      <Dialog open={showManualDialog} onOpenChange={setShowManualDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Agregar Parada Manual</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Tipo</Label>
                <Select
                  value={manualStop.type}
                  onValueChange={(v: 'DELIVERY' | 'PICKUP') =>
                    setManualStop((prev) => ({ ...prev, type: v }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DELIVERY">Entrega</SelectItem>
                    <SelectItem value="PICKUP">Retiro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Zona</Label>
                <Select
                  value={manualStop.zone}
                  onValueChange={(v: 'CABA' | 'NORTE' | 'SUR' | 'OESTE') =>
                    setManualStop((prev) => ({ ...prev, zone: v }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CABA">CABA</SelectItem>
                    <SelectItem value="NORTE">Norte</SelectItem>
                    <SelectItem value="SUR">Sur</SelectItem>
                    <SelectItem value="OESTE">Oeste</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Nombre del cliente/proveedor *</Label>
              <Input
                value={manualStop.customerName}
                onChange={(e) =>
                  setManualStop((prev) => ({ ...prev, customerName: e.target.value }))
                }
                placeholder="Nombre"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Direccion</Label>
                <Input
                  value={manualStop.address}
                  onChange={(e) =>
                    setManualStop((prev) => ({ ...prev, address: e.target.value }))
                  }
                  placeholder="Direccion"
                />
              </div>
              <div>
                <Label>Ciudad</Label>
                <Input
                  value={manualStop.city}
                  onChange={(e) =>
                    setManualStop((prev) => ({ ...prev, city: e.target.value }))
                  }
                  placeholder="Ciudad"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Transporte</Label>
                <Select
                  value={manualStop.transportType}
                  onValueChange={(v: 'OWN' | 'THIRD_PARTY') =>
                    setManualStop((prev) => ({ ...prev, transportType: v }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="OWN">Propio</SelectItem>
                    <SelectItem value="THIRD_PARTY">Tercero</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Bultos</Label>
                <Input
                  type="number"
                  min="0"
                  value={manualStop.packages}
                  onChange={(e) =>
                    setManualStop((prev) => ({ ...prev, packages: parseInt(e.target.value) || 0 }))
                  }
                />
              </div>
            </div>
            {manualStop.transportType === 'THIRD_PARTY' && (
              <div>
                <Label>Nombre del transporte</Label>
                <Input
                  value={manualStop.transportName}
                  onChange={(e) =>
                    setManualStop((prev) => ({ ...prev, transportName: e.target.value }))
                  }
                  placeholder="Ej: Cruz del Sur, Via Cargo"
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Contacto</Label>
                <Input
                  value={manualStop.contactName}
                  onChange={(e) =>
                    setManualStop((prev) => ({ ...prev, contactName: e.target.value }))
                  }
                  placeholder="Nombre contacto"
                />
              </div>
              <div>
                <Label>Telefono</Label>
                <Input
                  value={manualStop.contactPhone}
                  onChange={(e) =>
                    setManualStop((prev) => ({ ...prev, contactPhone: e.target.value }))
                  }
                  placeholder="Telefono"
                />
              </div>
            </div>
            <div>
              <Label>Observaciones</Label>
              <Textarea
                value={manualStop.observations}
                onChange={(e) =>
                  setManualStop((prev) => ({ ...prev, observations: e.target.value }))
                }
                placeholder="Notas adicionales..."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowManualDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={addManualStop} className="bg-blue-600 hover:bg-blue-700">
              Agregar Parada
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
