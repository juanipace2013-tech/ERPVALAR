'use client'

import { useState, useEffect } from 'react'
import { formatCUIT } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Building2,
  MapPin,
  Phone,
  Mail,
  CreditCard,
  Clock,
  Hash,
  UserCheck,
  Loader2,
  Plus,
  Pencil,
  Trash2,
  Factory,
  Truck,
  Save,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

interface DeliveryAddress {
  id: string
  label: string
  address: string
  city: string | null
  province: string | null
  postalCode: string | null
  country: string
  contactName: string | null
  contactPhone: string | null
  contactEmail: string | null
  schedule: string | null
  notes: string | null
  isDefault: boolean
}

const emptyForm = {
  label: '',
  address: '',
  city: '',
  province: '',
  postalCode: '',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  schedule: '',
  notes: '',
  isDefault: false,
}

interface ColppyCustomer {
  id: string
  colppyId: string
  name: string
  businessName: string
  cuit: string
  taxCondition: string
  taxConditionDisplay: string
  address: string
  city: string
  province: string
  postalCode: string
  phone: string
  mobile: string
  email: string
  saldo: number
  priceMultiplier: number
  paymentTerms: string
  paymentTermsDays: number
  defaultTransportName: string
  defaultTransportAddress: string
  defaultTransportSchedule: string
  exchangeRateType?: string | null
}

interface Props {
  customer: ColppyCustomer
  cuit: string
  onCustomerUpdate?: (updated: Partial<ColppyCustomer>) => void
}

const TC_OPTIONS = [
  'TC Billete SIN IVA',
  'TC Billete CON IVA',
  'TC Divisa',
  'TC MEP',
]

const TC_BADGE_COLORS: Record<string, string> = {
  'TC Billete SIN IVA': 'bg-amber-100 text-amber-800 border-amber-300',
  'TC Billete CON IVA': 'bg-yellow-100 text-yellow-800 border-yellow-300',
  'TC Divisa': 'bg-blue-100 text-blue-800 border-blue-300',
  'TC MEP': 'bg-purple-100 text-purple-800 border-purple-300',
}
function getTCBadgeClass(type: string): string {
  return TC_BADGE_COLORS[type] || 'bg-orange-100 text-orange-800 border-orange-300'
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <Icon className="h-4 w-4 text-gray-400 mt-0.5 shrink-0" />
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-sm font-medium text-gray-900">{value || '—'}</p>
      </div>
    </div>
  )
}

function EditableRow({
  icon: Icon,
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <div className="flex items-start gap-3 py-2">
      <Icon className="h-4 w-4 text-gray-400 mt-2.5 shrink-0" />
      <div className="flex-1">
        <p className="text-xs text-gray-500 mb-1">{label}</p>
        <Input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-8 text-sm"
        />
      </div>
    </div>
  )
}

export default function TabDatosGenerales({ customer, cuit, onCustomerUpdate }: Props) {
  const [salesPersonId, setSalesPersonId] = useState<string | null>(null)
  const [users, setUsers] = useState<{ id: string; name: string; email: string }[]>([])
  const [loadingSalesPerson, setLoadingSalesPerson] = useState(true)
  const [saving, setSaving] = useState(false)

  // Inline edit state
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState({
    name: '',
    address: '',
    phone: '',
    mobile: '',
    email: '',
    priceMultiplier: 1,
  })
  const [savingEdit, setSavingEdit] = useState(false)

  // Transport edit state
  const [isEditingTransport, setIsEditingTransport] = useState(false)
  const [transportForm, setTransportForm] = useState({
    defaultTransportName: '',
    defaultTransportAddress: '',
    defaultTransportSchedule: '',
  })
  const [savingTransport, setSavingTransport] = useState(false)

  // TC type state
  const [exchangeRateType, setExchangeRateType] = useState<string | null>(null)
  const [isEditingTC, setIsEditingTC] = useState(false)
  const [tcSelectValue, setTcSelectValue] = useState<string>('none')
  const [tcCustomValue, setTcCustomValue] = useState('')
  const [savingTC, setSavingTC] = useState(false)

  // Delivery addresses state
  const [localCustomerId, setLocalCustomerId] = useState<string | null>(null)
  const [deliveryAddresses, setDeliveryAddresses] = useState<DeliveryAddress[]>([])
  const [loadingAddresses, setLoadingAddresses] = useState(false)
  const [addressModalOpen, setAddressModalOpen] = useState(false)
  const [editingAddress, setEditingAddress] = useState<DeliveryAddress | null>(null)
  const [addressForm, setAddressForm] = useState(emptyForm)
  const [savingAddress, setSavingAddress] = useState(false)

  const fullAddress = [customer.address, customer.city, customer.province, customer.postalCode]
    .filter(Boolean)
    .join(', ')

  const phones = [customer.phone, customer.mobile].filter(Boolean).join(' / ')

  const fetchDeliveryAddresses = async (custId: string) => {
    setLoadingAddresses(true)
    try {
      const res = await fetch(`/api/clientes/${custId}/delivery-addresses`)
      if (res.ok) {
        const data = await res.json()
        setDeliveryAddresses(data.addresses || [])
      }
    } catch {
      // No crítico
    } finally {
      setLoadingAddresses(false)
    }
  }

  // Cargar vendedor actual y lista de usuarios
  useEffect(() => {
    const normalizedCuit = cuit.replace(/\D/g, '')
    if (!normalizedCuit || normalizedCuit.length < 7) {
      setLoadingSalesPerson(false)
      return
    }

    Promise.all([
      fetch(`/api/clientes/by-cuit/${normalizedCuit}`).then((r) => r.ok ? r.json() : null),
      fetch('/api/users').then((r) => r.ok ? r.json() : null),
    ]).then(([customerData, usersData]) => {
      if (customerData?.found && customerData.customer?.salesPerson) {
        setSalesPersonId(customerData.customer.salesPerson.id)
      }
      if (customerData?.found && customerData.customer?.id) {
        setLocalCustomerId(customerData.customer.id)
        fetchDeliveryAddresses(customerData.customer.id)
        const tc = customerData.customer.exchangeRateType || null
        setExchangeRateType(tc)
      }
      if (usersData?.users) {
        setUsers(usersData.users)
      }
    }).catch(() => {
      // No es crítico
    }).finally(() => {
      setLoadingSalesPerson(false)
    })
  }, [cuit])

  // ─── Inline edit handlers ──────────────────────────────────────────────────

  const startEditing = () => {
    setEditForm({
      name: customer.name || '',
      address: customer.address || '',
      phone: customer.phone || '',
      mobile: customer.mobile || '',
      email: customer.email || '',
      priceMultiplier: customer.priceMultiplier || 1,
    })
    setIsEditing(true)
  }

  const cancelEditing = () => {
    setIsEditing(false)
  }

  const handleSaveEdit = async () => {
    if (!localCustomerId) {
      toast.error('Cliente no encontrado en la base de datos local')
      return
    }
    setSavingEdit(true)
    try {
      const res = await fetch(`/api/clientes/${localCustomerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editForm.name,
          address: editForm.address,
          phone: editForm.phone,
          mobile: editForm.mobile,
          email: editForm.email || null,
          priceMultiplier: Number(editForm.priceMultiplier) || 1,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Error al guardar')
      }
      toast.success('Datos del cliente actualizados')
      setIsEditing(false)
      onCustomerUpdate?.({
        name: editForm.name,
        address: editForm.address,
        phone: editForm.phone,
        mobile: editForm.mobile,
        email: editForm.email,
        priceMultiplier: Number(editForm.priceMultiplier) || 1,
      })
    } catch (e: any) {
      toast.error(e.message || 'Error al guardar cambios')
    } finally {
      setSavingEdit(false)
    }
  }

  // ─── Transport edit handlers ───────────────────────────────────────────────

  const startEditingTransport = () => {
    setTransportForm({
      defaultTransportName: customer.defaultTransportName || '',
      defaultTransportAddress: customer.defaultTransportAddress || '',
      defaultTransportSchedule: customer.defaultTransportSchedule || '',
    })
    setIsEditingTransport(true)
  }

  const handleSaveTransport = async () => {
    if (!localCustomerId) {
      toast.error('Cliente no encontrado en la base de datos local')
      return
    }
    setSavingTransport(true)
    try {
      const res = await fetch(`/api/clientes/${localCustomerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultTransportName: transportForm.defaultTransportName || null,
          defaultTransportAddress: transportForm.defaultTransportAddress || null,
          defaultTransportSchedule: transportForm.defaultTransportSchedule || null,
        }),
      })
      if (!res.ok) throw new Error()
      toast.success('Transporte habitual actualizado')
      setIsEditingTransport(false)
      onCustomerUpdate?.({
        defaultTransportName: transportForm.defaultTransportName,
        defaultTransportAddress: transportForm.defaultTransportAddress,
        defaultTransportSchedule: transportForm.defaultTransportSchedule,
      })
    } catch {
      toast.error('Error al guardar transporte')
    } finally {
      setSavingTransport(false)
    }
  }

  // ─── TC type handlers ─────────────────────────────────────────────────────

  const startEditingTC = () => {
    const current = exchangeRateType || customer.exchangeRateType || null
    if (current && TC_OPTIONS.includes(current)) {
      setTcSelectValue(current)
      setTcCustomValue('')
    } else if (current) {
      setTcSelectValue('Otro')
      setTcCustomValue(current)
    } else {
      setTcSelectValue('none')
      setTcCustomValue('')
    }
    setIsEditingTC(true)
  }

  const handleSaveTC = async () => {
    if (!localCustomerId) {
      toast.error('Cliente no encontrado en la base de datos local')
      return
    }
    const value = tcSelectValue === 'none'
      ? null
      : tcSelectValue === 'Otro'
      ? (tcCustomValue.trim() || null)
      : tcSelectValue

    setSavingTC(true)
    try {
      const res = await fetch(`/api/clientes/${localCustomerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exchangeRateType: value }),
      })
      if (!res.ok) throw new Error()
      setExchangeRateType(value)
      setIsEditingTC(false)
      toast.success('Tipo de cambio actualizado')
      onCustomerUpdate?.({ exchangeRateType: value })
    } catch {
      toast.error('Error al guardar tipo de cambio')
    } finally {
      setSavingTC(false)
    }
  }

  // ─── Delivery address handlers ─────────────────────────────────────────────

  const openAddressModal = (addr?: DeliveryAddress) => {
    if (addr) {
      setEditingAddress(addr)
      setAddressForm({
        label: addr.label,
        address: addr.address,
        city: addr.city || '',
        province: addr.province || '',
        postalCode: addr.postalCode || '',
        contactName: addr.contactName || '',
        contactPhone: addr.contactPhone || '',
        contactEmail: addr.contactEmail || '',
        schedule: addr.schedule || '',
        notes: addr.notes || '',
        isDefault: addr.isDefault,
      })
    } else {
      setEditingAddress(null)
      setAddressForm(emptyForm)
    }
    setAddressModalOpen(true)
  }

  const handleSaveAddress = async () => {
    if (!localCustomerId) return
    if (!addressForm.label.trim() || !addressForm.address.trim()) {
      toast.error('Nombre y dirección son requeridos')
      return
    }
    setSavingAddress(true)
    try {
      const url = editingAddress
        ? `/api/clientes/${localCustomerId}/delivery-addresses/${editingAddress.id}`
        : `/api/clientes/${localCustomerId}/delivery-addresses`
      const res = await fetch(url, {
        method: editingAddress ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addressForm),
      })
      if (!res.ok) throw new Error()
      toast.success(editingAddress ? 'Dirección actualizada' : 'Dirección creada')
      setAddressModalOpen(false)
      fetchDeliveryAddresses(localCustomerId)
    } catch {
      toast.error('Error al guardar dirección')
    } finally {
      setSavingAddress(false)
    }
  }

  const handleDeleteAddress = async (addrId: string) => {
    if (!localCustomerId) return
    try {
      const res = await fetch(`/api/clientes/${localCustomerId}/delivery-addresses/${addrId}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error()
      toast.success('Dirección eliminada')
      fetchDeliveryAddresses(localCustomerId)
    } catch {
      toast.error('Error al eliminar dirección')
    }
  }

  const handleSalesPersonChange = async (value: string) => {
    const newSalesPersonId = value === 'none' ? null : value
    const previousId = salesPersonId
    setSalesPersonId(newSalesPersonId)
    setSaving(true)

    try {
      const normalizedCuit = cuit.replace(/\D/g, '')
      const res = await fetch('/api/clientes/assign-salesperson', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cuit: normalizedCuit,
          salesPersonId: newSalesPersonId,
        }),
      })

      if (!res.ok) {
        throw new Error('Error al asignar vendedor')
      }

      const data = await res.json()
      const vendedorName = data.salesPerson?.name || 'Sin asignar'
      toast.success(`Vendedor actualizado: ${vendedorName}`)
    } catch {
      // Revertir en caso de error
      setSalesPersonId(previousId)
      toast.error('Error al asignar vendedor')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Datos Generales */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-gray-400 uppercase tracking-wider">Datos del Cliente</p>
            {localCustomerId && !isEditing && (
              <Button
                size="sm"
                variant="outline"
                onClick={startEditing}
                className="h-7 text-xs"
              >
                <Pencil className="h-3.5 w-3.5 mr-1" />
                Editar
              </Button>
            )}
            {isEditing && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={cancelEditing}
                  disabled={savingEdit}
                  className="h-7 text-xs"
                >
                  <X className="h-3.5 w-3.5 mr-1" />
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  onClick={handleSaveEdit}
                  disabled={savingEdit}
                  className="h-7 text-xs bg-blue-600 hover:bg-blue-700"
                >
                  {savingEdit ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                  Guardar
                </Button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1">
            {/* Campos NO editables (Colppy/AFIP) */}
            <InfoRow icon={Building2} label="Razón Social" value={customer.businessName} />

            {/* Nombre Fantasía — editable */}
            {isEditing ? (
              <EditableRow
                icon={Building2}
                label="Nombre Fantasía"
                value={editForm.name}
                onChange={(v) => setEditForm({ ...editForm, name: v })}
                placeholder="Nombre fantasía"
              />
            ) : (
              <InfoRow icon={Building2} label="Nombre Fantasía" value={customer.name} />
            )}

            {/* CUIT y Condición IVA — NO editables */}
            <InfoRow icon={Hash} label="CUIT" value={customer.cuit ? formatCUIT(customer.cuit) : '—'} />
            <InfoRow icon={CreditCard} label="Condición IVA" value={customer.taxConditionDisplay} />

            {/* Dirección — editable */}
            {isEditing ? (
              <EditableRow
                icon={MapPin}
                label="Dirección"
                value={editForm.address}
                onChange={(v) => setEditForm({ ...editForm, address: v })}
                placeholder="Dirección completa"
              />
            ) : (
              <InfoRow icon={MapPin} label="Dirección" value={fullAddress} />
            )}

            {/* Teléfono — editable */}
            {isEditing ? (
              <EditableRow
                icon={Phone}
                label="Teléfono"
                value={editForm.phone}
                onChange={(v) => setEditForm({ ...editForm, phone: v })}
                placeholder="Teléfono"
              />
            ) : (
              <InfoRow icon={Phone} label="Teléfono" value={phones} />
            )}

            {/* Email — editable */}
            {isEditing ? (
              <EditableRow
                icon={Mail}
                label="Email"
                value={editForm.email}
                onChange={(v) => setEditForm({ ...editForm, email: v })}
                placeholder="Email"
                type="email"
              />
            ) : (
              <InfoRow icon={Mail} label="Email" value={customer.email} />
            )}

            {/* Condición de pago — read only (viene de Colppy) */}
            <InfoRow icon={Clock} label="Condición de Pago" value={customer.paymentTerms} />

            {/* Vendedor Asignado */}
            <div className="flex items-start gap-3 py-2">
              <UserCheck className="h-4 w-4 text-gray-400 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-xs text-gray-500">Vendedor Asignado</p>
                {loadingSalesPerson ? (
                  <Loader2 className="h-4 w-4 animate-spin text-gray-400 mt-1" />
                ) : (
                  <div className="flex items-center gap-2 mt-0.5">
                    <Select
                      value={salesPersonId || 'none'}
                      onValueChange={handleSalesPersonChange}
                      disabled={saving}
                    >
                      <SelectTrigger className="h-8 w-[220px] text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">
                          <span className="text-gray-400">Sin asignar</span>
                        </SelectItem>
                        {users.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />}
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Transporte Habitual */}
      {localCustomerId && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Truck className="h-4 w-4 text-blue-600" />
                <p className="text-xs text-gray-400 uppercase tracking-wider">Transporte Habitual</p>
              </div>
              {!isEditingTransport && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={startEditingTransport}
                  className="h-7 text-xs"
                >
                  <Pencil className="h-3.5 w-3.5 mr-1" />
                  {customer.defaultTransportName ? 'Editar' : 'Agregar'}
                </Button>
              )}
              {isEditingTransport && (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setIsEditingTransport(false)}
                    disabled={savingTransport}
                    className="h-7 text-xs"
                  >
                    <X className="h-3.5 w-3.5 mr-1" />
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveTransport}
                    disabled={savingTransport}
                    className="h-7 text-xs bg-blue-600 hover:bg-blue-700"
                  >
                    {savingTransport ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                    Guardar
                  </Button>
                </div>
              )}
            </div>

            {isEditingTransport ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label className="text-xs text-gray-500">Transporte</Label>
                  <Input
                    value={transportForm.defaultTransportName}
                    onChange={(e) => setTransportForm({ ...transportForm, defaultTransportName: e.target.value })}
                    placeholder="Ej: LOGINTER, ANDREANI, OCA"
                    className="h-8 text-sm mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Dirección / Sucursal</Label>
                  <Input
                    value={transportForm.defaultTransportAddress}
                    onChange={(e) => setTransportForm({ ...transportForm, defaultTransportAddress: e.target.value })}
                    placeholder="Ej: Sucursal Retiro, Terminal de cargas"
                    className="h-8 text-sm mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Horario</Label>
                  <Input
                    value={transportForm.defaultTransportSchedule}
                    onChange={(e) => setTransportForm({ ...transportForm, defaultTransportSchedule: e.target.value })}
                    placeholder="Ej: L a V 8:00 a 17:00"
                    className="h-8 text-sm mt-1"
                  />
                </div>
              </div>
            ) : customer.defaultTransportName ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-gray-500">Transporte</p>
                  <p className="text-sm font-medium text-gray-900">{customer.defaultTransportName}</p>
                </div>
                {customer.defaultTransportAddress && (
                  <div>
                    <p className="text-xs text-gray-500">Dirección / Sucursal</p>
                    <p className="text-sm font-medium text-gray-900">{customer.defaultTransportAddress}</p>
                  </div>
                )}
                {customer.defaultTransportSchedule && (
                  <div>
                    <p className="text-xs text-gray-500">Horario</p>
                    <p className="text-sm font-medium text-gray-900">{customer.defaultTransportSchedule}</p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-500 text-center py-2">
                Sin transporte asignado — Se usará como valor por defecto en remitos
              </p>
            )}

            {customer.defaultTransportName && !isEditingTransport && (
              <p className="text-xs text-gray-400 mt-3">
                Se usará como valor por defecto en remitos de este cliente
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tipo de Cambio */}
      {localCustomerId && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <p className="text-xs text-gray-400 uppercase tracking-wider">Tipo de Cambio</p>
              </div>
              {!isEditingTC && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={startEditingTC}
                  className="h-7 text-xs"
                >
                  <Pencil className="h-3.5 w-3.5 mr-1" />
                  {(exchangeRateType || customer.exchangeRateType) ? 'Editar' : 'Agregar'}
                </Button>
              )}
              {isEditingTC && (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setIsEditingTC(false)}
                    disabled={savingTC}
                    className="h-7 text-xs"
                  >
                    <X className="h-3.5 w-3.5 mr-1" />
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveTC}
                    disabled={savingTC}
                    className="h-7 text-xs bg-blue-600 hover:bg-blue-700"
                  >
                    {savingTC ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                    Guardar
                  </Button>
                </div>
              )}
            </div>

            {isEditingTC ? (
              <div className="space-y-3">
                <div>
                  <Label className="text-xs text-gray-500">Tipo de Cambio Preferido</Label>
                  <Select value={tcSelectValue} onValueChange={setTcSelectValue}>
                    <SelectTrigger className="h-8 text-sm mt-1">
                      <SelectValue placeholder="Sin especificar" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin especificar</SelectItem>
                      {TC_OPTIONS.map((opt) => (
                        <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                      ))}
                      <SelectItem value="Otro">Otro (texto libre)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {tcSelectValue === 'Otro' && (
                  <div>
                    <Label className="text-xs text-gray-500">Especificar tipo</Label>
                    <Input
                      value={tcCustomValue}
                      onChange={(e) => setTcCustomValue(e.target.value)}
                      placeholder="Ej: TC BNA, TC Oficial..."
                      className="h-8 text-sm mt-1"
                    />
                  </div>
                )}
              </div>
            ) : (
              (() => {
                const tc = exchangeRateType ?? customer.exchangeRateType ?? null
                return tc ? (
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-semibold px-3 py-1 rounded-full border ${getTCBadgeClass(tc)}`}>
                      {tc}
                    </span>
                    <p className="text-xs text-gray-400">Se mostrará en cotizaciones y facturación</p>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 text-center py-2">
                    Sin tipo de cambio asignado — Se usará el TC vigente en el momento de facturar
                  </p>
                )
              })()
            )}
          </CardContent>
        </Card>
      )}

      {/* Datos Internos Colppy */}
      <Card>
        <CardContent className="pt-6">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">Datos Internos Colppy</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-gray-500">ID Colppy</p>
              <p className="text-sm font-mono text-gray-700">{customer.colppyId || customer.id}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Multiplicador Precio</p>
              {isEditing ? (
                <Input
                  type="number"
                  step="0.001"
                  min="0.001"
                  value={editForm.priceMultiplier}
                  onChange={(e) => setEditForm({ ...editForm, priceMultiplier: parseFloat(e.target.value) || 1 })}
                  className="h-8 text-sm font-mono mt-1 w-24"
                />
              ) : (
                <p className="text-sm font-mono text-gray-700">{customer.priceMultiplier}x</p>
              )}
            </div>
            <div>
              <p className="text-xs text-gray-500">Condición IVA (código)</p>
              <p className="text-sm font-mono text-gray-700">{customer.taxCondition}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Direcciones de Entrega */}
      {localCustomerId && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Factory className="h-4 w-4 text-blue-600" />
                <p className="text-xs text-gray-400 uppercase tracking-wider">Direcciones de Entrega</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openAddressModal()}
                className="h-7 text-xs"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Agregar
              </Button>
            </div>

            {loadingAddresses ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
              </div>
            ) : deliveryAddresses.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">
                Sin direcciones de entrega adicionales. Se usará la dirección fiscal.
              </p>
            ) : (
              <div className="space-y-3">
                {deliveryAddresses.map((addr) => (
                  <div
                    key={addr.id}
                    className="flex items-start justify-between border rounded-lg p-3 hover:bg-gray-50"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-semibold text-gray-900">{addr.label}</p>
                        {addr.isDefault && (
                          <Badge variant="outline" className="text-xs py-0 px-1.5 h-4 text-blue-700 border-blue-300">
                            Principal
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-gray-700">{addr.address}</p>
                      <p className="text-xs text-gray-500">
                        {[addr.city, addr.province, addr.postalCode && `CP ${addr.postalCode}`].filter(Boolean).join(', ')}
                      </p>
                      {(addr.contactName || addr.contactPhone) && (
                        <p className="text-xs text-gray-500 mt-1">
                          {[addr.contactName, addr.contactPhone].filter(Boolean).join(' - ')}
                        </p>
                      )}
                      {addr.schedule && (
                        <p className="text-xs text-gray-400 mt-0.5">{addr.schedule}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 ml-2 shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => openAddressModal(addr)}
                      >
                        <Pencil className="h-3.5 w-3.5 text-gray-500" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => handleDeleteAddress(addr.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Modal crear/editar dirección */}
      <Dialog open={addressModalOpen} onOpenChange={setAddressModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingAddress ? 'Editar dirección de entrega' : 'Nueva dirección de entrega'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label>Nombre / Etiqueta *</Label>
                <Input
                  placeholder="Ej: Planta Salta, Depósito BA"
                  value={addressForm.label}
                  onChange={(e) => setAddressForm({ ...addressForm, label: e.target.value })}
                />
              </div>
              <div className="col-span-2">
                <Label>Dirección *</Label>
                <Input
                  placeholder="Calle, número, piso"
                  value={addressForm.address}
                  onChange={(e) => setAddressForm({ ...addressForm, address: e.target.value })}
                />
              </div>
              <div>
                <Label>Ciudad</Label>
                <Input
                  value={addressForm.city}
                  onChange={(e) => setAddressForm({ ...addressForm, city: e.target.value })}
                />
              </div>
              <div>
                <Label>Provincia</Label>
                <Input
                  value={addressForm.province}
                  onChange={(e) => setAddressForm({ ...addressForm, province: e.target.value })}
                />
              </div>
              <div>
                <Label>Código Postal</Label>
                <Input
                  value={addressForm.postalCode}
                  onChange={(e) => setAddressForm({ ...addressForm, postalCode: e.target.value })}
                />
              </div>
            </div>

            <div className="border-t pt-4">
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">Contacto en destino</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Nombre contacto</Label>
                  <Input
                    value={addressForm.contactName}
                    onChange={(e) => setAddressForm({ ...addressForm, contactName: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Teléfono</Label>
                  <Input
                    value={addressForm.contactPhone}
                    onChange={(e) => setAddressForm({ ...addressForm, contactPhone: e.target.value })}
                  />
                </div>
                <div className="col-span-2">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={addressForm.contactEmail}
                    onChange={(e) => setAddressForm({ ...addressForm, contactEmail: e.target.value })}
                  />
                </div>
              </div>
            </div>

            <div className="border-t pt-4">
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <Label>Horario de recepción</Label>
                  <Input
                    placeholder="Ej: Lunes a viernes 8 a 17hs"
                    value={addressForm.schedule}
                    onChange={(e) => setAddressForm({ ...addressForm, schedule: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Notas</Label>
                  <Textarea
                    placeholder="Ej: Entrar por portón 3, preguntar por Juan"
                    value={addressForm.notes}
                    onChange={(e) => setAddressForm({ ...addressForm, notes: e.target.value })}
                    rows={2}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="isDefault"
                    checked={addressForm.isDefault}
                    onCheckedChange={(checked) =>
                      setAddressForm({ ...addressForm, isDefault: checked === true })
                    }
                  />
                  <label htmlFor="isDefault" className="text-sm">
                    Dirección de entrega principal (por defecto)
                  </label>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddressModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleSaveAddress}
              disabled={savingAddress}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {savingAddress && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editingAddress ? 'Guardar cambios' : 'Crear dirección'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
