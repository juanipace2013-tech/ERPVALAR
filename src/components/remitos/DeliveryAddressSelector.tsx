'use client'

import { useState, useEffect } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MapPin, Factory, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

interface DeliveryAddress {
  id: string
  label: string
  address: string
  city: string | null
  province: string | null
  postalCode: string | null
  contactName: string | null
  contactPhone: string | null
  isDefault: boolean
}

interface AddressSelection {
  deliveryAddress: string | null
  deliveryCity: string | null
  deliveryProvince: string | null
  deliveryPostalCode: string | null
}

interface Props {
  customerId: string | null
  fiscalAddress: {
    address: string | null
    city: string | null
    province: string | null
    postalCode: string | null
  }
  onSelect: (address: AddressSelection) => void
  initialValue?: string // 'fiscal' | addressId
}

export default function DeliveryAddressSelector({
  customerId,
  fiscalAddress,
  onSelect,
  initialValue,
}: Props) {
  const [addresses, setAddresses] = useState<DeliveryAddress[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<string>(initialValue || '')

  useEffect(() => {
    if (!customerId) return
    setLoading(true)
    fetch(`/api/clientes/${customerId}/delivery-addresses`)
      .then((r) => (r.ok ? r.json() : { addresses: [] }))
      .then((data) => {
        setAddresses(data.addresses || [])
        // Auto-seleccionar si no hay initialValue
        if (!initialValue && data.addresses?.length > 0) {
          const defaultAddr = data.addresses.find((a: DeliveryAddress) => a.isDefault)
          if (defaultAddr) {
            setSelected(defaultAddr.id)
            onSelect({
              deliveryAddress: defaultAddr.address,
              deliveryCity: defaultAddr.city,
              deliveryProvince: defaultAddr.province,
              deliveryPostalCode: defaultAddr.postalCode,
            })
          } else {
            setSelected('fiscal')
          }
        }
      })
      .catch(() => setAddresses([]))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId])

  // No renderizar si no hay direcciones de entrega
  if (!customerId || loading) {
    if (loading) {
      return (
        <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando direcciones...
        </div>
      )
    }
    return null
  }

  if (addresses.length === 0) return null

  const handleChange = (value: string) => {
    setSelected(value)
    if (value === 'fiscal') {
      onSelect({
        deliveryAddress: fiscalAddress.address,
        deliveryCity: fiscalAddress.city,
        deliveryProvince: fiscalAddress.province,
        deliveryPostalCode: fiscalAddress.postalCode,
      })
    } else {
      const addr = addresses.find((a) => a.id === value)
      if (addr) {
        onSelect({
          deliveryAddress: addr.address,
          deliveryCity: addr.city,
          deliveryProvince: addr.province,
          deliveryPostalCode: addr.postalCode,
        })
      }
    }
  }

  const formatShortAddress = (addr: string | null, city: string | null, province: string | null) => {
    return [addr, city, province].filter(Boolean).join(', ')
  }

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium flex items-center gap-1.5">
        <MapPin className="h-4 w-4 text-gray-500" />
        Dirección de entrega
      </label>
      <Select value={selected} onValueChange={handleChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Seleccionar dirección de entrega" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="fiscal">
            <div className="flex items-center gap-2">
              <span>Dirección fiscal</span>
              <span className="text-xs text-gray-500 truncate max-w-[300px]">
                {formatShortAddress(fiscalAddress.address, fiscalAddress.city, fiscalAddress.province)}
              </span>
            </div>
          </SelectItem>
          {addresses.map((addr) => (
            <SelectItem key={addr.id} value={addr.id}>
              <div className="flex items-center gap-2">
                <Factory className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                <span className="font-medium">{addr.label}</span>
                {addr.isDefault && (
                  <Badge variant="outline" className="text-xs py-0 px-1.5 h-4">
                    Principal
                  </Badge>
                )}
                <span className="text-xs text-gray-500 truncate max-w-[250px]">
                  {formatShortAddress(addr.address, addr.city, addr.province)}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
