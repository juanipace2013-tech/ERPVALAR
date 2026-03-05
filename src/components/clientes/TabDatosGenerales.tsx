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
} from 'lucide-react'
import { toast } from 'sonner'

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

  const fullAddress = [customer.address, customer.city, customer.province, customer.postalCode]
    .filter(Boolean)
    .join(', ')

  const phones = [customer.phone, customer.mobile].filter(Boolean).join(' / ')

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
      if (usersData?.users) {
        setUsers(usersData.users)
      }
    }).catch(() => {
      // No es crítico
    }).finally(() => {
      setLoadingSalesPerson(false)
    })
  }, [cuit])

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
    </div>
  )
}
