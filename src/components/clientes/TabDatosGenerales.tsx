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
}

interface Props {
  customer: ColppyCustomer
  cuit: string
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

export default function TabDatosGenerales({ customer, cuit }: Props) {
  const [salesPersonId, setSalesPersonId] = useState<string | null>(null)
  const [users, setUsers] = useState<{ id: string; name: string; email: string }[]>([])
  const [loadingSalesPerson, setLoadingSalesPerson] = useState(true)
  const [saving, setSaving] = useState(false)

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
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1">
            <InfoRow icon={Building2} label="Razón Social" value={customer.businessName} />
            <InfoRow icon={Building2} label="Nombre Fantasía" value={customer.name} />
            <InfoRow icon={Hash} label="CUIT" value={customer.cuit ? formatCUIT(customer.cuit) : '—'} />
            <InfoRow icon={CreditCard} label="Condición IVA" value={customer.taxConditionDisplay} />
            <InfoRow icon={MapPin} label="Dirección" value={fullAddress} />
            <InfoRow icon={Phone} label="Teléfono" value={phones} />
            <InfoRow icon={Mail} label="Email" value={customer.email} />
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
              <p className="text-sm font-mono text-gray-700">{customer.priceMultiplier}x</p>
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
