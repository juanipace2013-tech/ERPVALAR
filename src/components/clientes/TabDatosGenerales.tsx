'use client'

import { formatCUIT } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import {
  Building2,
  MapPin,
  Phone,
  Mail,
  CreditCard,
  Clock,
  Hash,
} from 'lucide-react'

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

export default function TabDatosGenerales({ customer }: Props) {
  const fullAddress = [customer.address, customer.city, customer.province, customer.postalCode]
    .filter(Boolean)
    .join(', ')

  const phones = [customer.phone, customer.mobile].filter(Boolean).join(' / ')

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
