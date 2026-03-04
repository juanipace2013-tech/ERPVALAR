'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
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
  ArrowDownToLine,
  Plus,
  CheckCircle2,
  Search,
  MapPin,
  Eye,
} from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface Retiro {
  id: string
  routeId: string
  route: {
    id: string
    date: string
    createdBy: { id: string; name: string }
  }
  supplier: {
    id: string
    name: string
    legalName: string | null
    address: string | null
    city: string | null
    phone: string | null
  } | null
  customerName: string
  address: string | null
  city: string | null
  zone: string
  materialDescription: string | null
  observations: string | null
  contactName: string | null
  contactPhone: string | null
  status: string
  completedAt: string | null
}

interface SupplierResult {
  id: string
  name: string
  legalName: string | null
  address: string | null
  city: string | null
  phone: string | null
  province: string | null
}

const ZONE_BADGE: Record<string, string> = {
  CABA: 'bg-blue-100 text-blue-800',
  NORTE: 'bg-green-100 text-green-800',
  SUR: 'bg-orange-100 text-orange-800',
  OESTE: 'bg-yellow-100 text-yellow-800',
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function RetirosPage() {
  const [retiros, setRetiros] = useState<Retiro[]>([])
  const [loading, setLoading] = useState(true)

  // Filtros
  const [filterStatus, setFilterStatus] = useState('ALL')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [filterSearch, setFilterSearch] = useState('')

  // Dialog nuevo retiro
  const [showNewDialog, setShowNewDialog] = useState(false)
  const [saving, setSaving] = useState(false)

  // Form fields
  const [supplierSearch, setSupplierSearch] = useState('')
  const [supplierResults, setSupplierResults] = useState<SupplierResult[]>([])
  const [searchingSuppliers, setSearchingSuppliers] = useState(false)
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null)
  const [showSupplierDropdown, setShowSupplierDropdown] = useState(false)

  const [formName, setFormName] = useState('')
  const [formAddress, setFormAddress] = useState('')
  const [formCity, setFormCity] = useState('')
  const [formZone, setFormZone] = useState('CABA')
  const [formMaterial, setFormMaterial] = useState('')
  const [formDate, setFormDate] = useState('')
  const [formContact, setFormContact] = useState('')
  const [formPhone, setFormPhone] = useState('')
  const [formObs, setFormObs] = useState('')

  // Dialog completar
  const [showCompleteDialog, setShowCompleteDialog] = useState(false)
  const [completingRetiro, setCompletingRetiro] = useState<Retiro | null>(null)
  const [completing, setCompleting] = useState(false)

  // ─── Fetch retiros ─────────────────────────────────────────────────────────

  const fetchRetiros = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (filterStatus !== 'ALL') params.append('status', filterStatus)
      if (filterDateFrom) params.append('dateFrom', filterDateFrom)
      if (filterDateTo) params.append('dateTo', filterDateTo)
      if (filterSearch) params.append('search', filterSearch)

      const res = await fetch(`/api/logistica/retiros?${params.toString()}`)
      if (!res.ok) throw new Error('Error')
      const data = await res.json()
      setRetiros(data)
    } catch (e) {
      toast.error('Error al cargar retiros')
    } finally {
      setLoading(false)
    }
  }, [filterStatus, filterDateFrom, filterDateTo, filterSearch])

  useEffect(() => {
    fetchRetiros()
  }, [fetchRetiros])

  // ─── Supplier search (debounced) ──────────────────────────────────────────

  useEffect(() => {
    if (supplierSearch.length < 2) {
      setSupplierResults([])
      return
    }
    const timeout = setTimeout(async () => {
      try {
        setSearchingSuppliers(true)
        const res = await fetch(`/api/proveedores?search=${encodeURIComponent(supplierSearch)}&limit=10`)
        if (res.ok) {
          const data = await res.json()
          setSupplierResults(data.suppliers || [])
          setShowSupplierDropdown(true)
        }
      } catch (e) {
        console.error(e)
      } finally {
        setSearchingSuppliers(false)
      }
    }, 300)
    return () => clearTimeout(timeout)
  }, [supplierSearch])

  // ─── Select supplier ────────────────────────────────────────────────────────

  const selectSupplier = (s: SupplierResult) => {
    setSelectedSupplierId(s.id)
    setFormName(s.name)
    setFormAddress(s.address || '')
    setFormCity(s.city || '')
    setFormContact('')
    setFormPhone(s.phone || '')
    setSupplierSearch(s.name)
    setShowSupplierDropdown(false)
  }

  // ─── Reset form ──────────────────────────────────────────────────────────────

  const resetForm = () => {
    setSupplierSearch('')
    setSelectedSupplierId(null)
    setFormName('')
    setFormAddress('')
    setFormCity('')
    setFormZone('CABA')
    setFormMaterial('')
    setFormDate('')
    setFormContact('')
    setFormPhone('')
    setFormObs('')
    setShowSupplierDropdown(false)
  }

  // ─── Submit new retiro ───────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!formName.trim()) {
      toast.error('El nombre del proveedor es obligatorio')
      return
    }
    if (!formDate) {
      toast.error('La fecha programada es obligatoria')
      return
    }

    try {
      setSaving(true)
      const res = await fetch('/api/logistica/retiros', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierId: selectedSupplierId,
          customerName: formName,
          address: formAddress || null,
          city: formCity || null,
          zone: formZone,
          materialDescription: formMaterial || null,
          observations: formObs || null,
          scheduledDate: formDate,
          contactName: formContact || null,
          contactPhone: formPhone || null,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Error')
      }

      toast.success('Retiro creado correctamente')
      setShowNewDialog(false)
      resetForm()
      fetchRetiros()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al crear retiro')
    } finally {
      setSaving(false)
    }
  }

  // ─── Complete retiro ─────────────────────────────────────────────────────────

  const handleComplete = async () => {
    if (!completingRetiro) return
    try {
      setCompleting(true)
      const res = await fetch(
        `/api/logistica/rutas/${completingRetiro.routeId}/stops/${completingRetiro.id}/change-status`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'PICKED_UP' }),
        }
      )
      if (!res.ok) throw new Error('Error')

      toast.success('Retiro completado')
      setShowCompleteDialog(false)
      setCompletingRetiro(null)
      fetchRetiros()
    } catch (e) {
      toast.error('Error al completar retiro')
    } finally {
      setCompleting(false)
    }
  }

  const clearFilters = () => {
    setFilterStatus('ALL')
    setFilterDateFrom('')
    setFilterDateTo('')
    setFilterSearch('')
  }

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="container mx-auto px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ArrowDownToLine className="h-8 w-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Retiros de Proveedores</h1>
            <p className="text-gray-600 text-sm mt-0.5">
              Gestión de retiros de materiales de proveedores
            </p>
          </div>
        </div>
        <Button
          className="bg-blue-600 hover:bg-blue-700"
          onClick={() => {
            resetForm()
            setShowNewDialog(true)
          }}
        >
          <Plus className="h-4 w-4 mr-2" /> Nuevo Retiro
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="border-l-4 border-l-gray-400">
          <CardContent className="py-3 px-4">
            <p className="text-xs text-gray-500">Pendientes</p>
            <p className="text-2xl font-bold text-gray-900">
              {retiros.filter((r) => r.status === 'PENDING').length}
            </p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-green-400">
          <CardContent className="py-3 px-4">
            <p className="text-xs text-gray-500">Completados</p>
            <p className="text-2xl font-bold text-gray-900">
              {retiros.filter((r) => r.status === 'PICKED_UP').length}
            </p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-blue-400">
          <CardContent className="py-3 px-4">
            <p className="text-xs text-gray-500">Total</p>
            <p className="text-2xl font-bold text-gray-900">{retiros.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Buscar</label>
              <Input
                placeholder="Proveedor..."
                value={filterSearch}
                onChange={(e) => setFilterSearch(e.target.value)}
                className="h-8 text-sm w-44"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Desde</label>
              <Input
                type="date"
                value={filterDateFrom}
                onChange={(e) => setFilterDateFrom(e.target.value)}
                className="h-8 text-sm w-36"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Hasta</label>
              <Input
                type="date"
                value={filterDateTo}
                onChange={(e) => setFilterDateTo(e.target.value)}
                className="h-8 text-sm w-36"
              />
            </div>
            <div className="min-w-[140px]">
              <label className="text-xs text-gray-500 mb-1 block">Estado</label>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos</SelectItem>
                  <SelectItem value="PENDING">Pendiente</SelectItem>
                  <SelectItem value="COMPLETED">Completado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" size="sm" className="h-8" onClick={clearFilters}>
              Limpiar
            </Button>
            <span className="text-xs text-gray-500 self-end pb-1 ml-auto">
              {retiros.length} retiros
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

      {/* Tabla */}
      {!loading && (
        <Card>
          <CardContent className="pt-4">
            {retiros.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <ArrowDownToLine className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                <p>No hay retiros registrados</p>
                <p className="text-sm mt-1">
                  Haz clic en &quot;Nuevo Retiro&quot; para crear uno
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Proveedor</TableHead>
                      <TableHead>Dirección</TableHead>
                      <TableHead>Material</TableHead>
                      <TableHead>Zona</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Completado</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {retiros.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap text-sm">
                          {new Date(r.route.date).toLocaleDateString('es-AR')}
                        </TableCell>
                        <TableCell>
                          <p className="font-medium">{r.supplier?.name || r.customerName}</p>
                          {r.supplier?.legalName && r.supplier.legalName !== r.supplier.name && (
                            <p className="text-xs text-gray-500">{r.supplier.legalName}</p>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-gray-600">
                          {[r.address, r.city].filter(Boolean).join(', ') || '—'}
                        </TableCell>
                        <TableCell className="text-sm max-w-[200px] truncate">
                          {r.materialDescription || '—'}
                        </TableCell>
                        <TableCell>
                          <Badge className={`text-xs ${ZONE_BADGE[r.zone] || 'bg-gray-100 text-gray-800'}`}>
                            {r.zone}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {r.status === 'PICKED_UP' ? (
                            <Badge className="bg-green-100 text-green-800 text-xs">Completado</Badge>
                          ) : (
                            <Badge className="bg-gray-100 text-gray-800 text-xs">Pendiente</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-gray-500">
                          {r.completedAt
                            ? new Date(r.completedAt).toLocaleString('es-AR', {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            {r.status === 'PENDING' && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs text-green-700 border-green-300 hover:bg-green-50"
                                onClick={() => {
                                  setCompletingRetiro(r)
                                  setShowCompleteDialog(true)
                                }}
                              >
                                <CheckCircle2 className="h-3 w-3 mr-1" /> Completar
                              </Button>
                            )}
                            <Link href={`/logistica/rutas/${r.routeId}`}>
                              <Button variant="ghost" size="sm" className="h-7 text-xs">
                                <Eye className="h-3 w-3 mr-1" /> Ruta
                              </Button>
                            </Link>
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
      )}

      {/* Dialog: Nuevo Retiro */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Nuevo Retiro de Proveedor</DialogTitle>
            <DialogDescription>
              Programar un retiro de materiales de un proveedor
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Supplier search */}
            <div className="relative">
              <label className="text-sm font-medium mb-1 block">Proveedor *</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Buscar proveedor..."
                  value={supplierSearch}
                  onChange={(e) => {
                    setSupplierSearch(e.target.value)
                    setSelectedSupplierId(null)
                    setFormName(e.target.value)
                  }}
                  onFocus={() => supplierResults.length > 0 && setShowSupplierDropdown(true)}
                  className="pl-9"
                />
                {searchingSuppliers && (
                  <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-gray-400" />
                )}
              </div>

              {/* Dropdown results */}
              {showSupplierDropdown && supplierResults.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-white border rounded-md shadow-lg max-h-48 overflow-y-auto">
                  {supplierResults.map((s) => (
                    <button
                      key={s.id}
                      className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b last:border-b-0 text-sm"
                      onClick={() => selectSupplier(s)}
                    >
                      <p className="font-medium">{s.name}</p>
                      {s.address && (
                        <p className="text-xs text-gray-500 flex items-center gap-1">
                          <MapPin className="h-3 w-3" /> {s.address}{s.city ? `, ${s.city}` : ''}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Address + City */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">Dirección</label>
                <Input
                  placeholder="Dirección"
                  value={formAddress}
                  onChange={(e) => setFormAddress(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Ciudad</label>
                <Input
                  placeholder="Ciudad"
                  value={formCity}
                  onChange={(e) => setFormCity(e.target.value)}
                />
              </div>
            </div>

            {/* Zone + Date */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">Zona</label>
                <Select value={formZone} onValueChange={setFormZone}>
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
              <div>
                <label className="text-sm font-medium mb-1 block">Fecha programada *</label>
                <Input
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                />
              </div>
            </div>

            {/* Material */}
            <div>
              <label className="text-sm font-medium mb-1 block">Material a retirar</label>
              <Textarea
                placeholder="Descripción del material..."
                value={formMaterial}
                onChange={(e) => setFormMaterial(e.target.value)}
                rows={2}
              />
            </div>

            {/* Contact */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">Contacto</label>
                <Input
                  placeholder="Nombre contacto"
                  value={formContact}
                  onChange={(e) => setFormContact(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Teléfono</label>
                <Input
                  placeholder="Teléfono"
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                />
              </div>
            </div>

            {/* Observations */}
            <div>
              <label className="text-sm font-medium mb-1 block">Observaciones</label>
              <Textarea
                placeholder="Observaciones..."
                value={formObs}
                onChange={(e) => setFormObs(e.target.value)}
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewDialog(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Crear Retiro
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Completar Retiro */}
      <Dialog open={showCompleteDialog} onOpenChange={setShowCompleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Completar Retiro</DialogTitle>
            <DialogDescription>
              {completingRetiro && (
                <>
                  Proveedor: <span className="font-semibold text-gray-800">{completingRetiro.supplier?.name || completingRetiro.customerName}</span>
                  {completingRetiro.materialDescription && (
                    <> — {completingRetiro.materialDescription}</>
                  )}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="py-2">
            <div className="flex items-center gap-2 text-green-700 bg-green-50 p-3 rounded-lg">
              <CheckCircle2 className="h-5 w-5" />
              <p className="text-sm">
                Se marcará este retiro como <strong>completado</strong> y se registrará la fecha de completado.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCompleteDialog(false)} disabled={completing}>
              Cancelar
            </Button>
            <Button
              onClick={handleComplete}
              disabled={completing}
              className="bg-green-600 hover:bg-green-700"
            >
              {completing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirmar Completado
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
