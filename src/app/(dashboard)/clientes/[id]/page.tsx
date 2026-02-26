'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Loader2, Users, AlertCircle } from 'lucide-react'
import { formatCUIT, formatNumber } from '@/lib/utils'
import ClienteDetailTabs from '@/components/clientes/ClienteDetailTabs'

// ─── Tipos ───────────────────────────────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isCUIT(value: string): boolean {
  const clean = value.replace(/\D/g, '')
  return /^\d{11}$/.test(clean)
}

// ─── Página ──────────────────────────────────────────────────────────────────

export default function ClienteDetailPage() {
  const params = useParams()
  const router = useRouter()
  const rawId = params.id as string

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [customer, setCustomer] = useState<ColppyCustomer | null>(null)
  const [cuit, setCuit] = useState('')

  const loadCustomer = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      if (isCUIT(rawId)) {
        // ─── Búsqueda por CUIT ────────────────────────────────────────────
        const cleanCuit = rawId.replace(/\D/g, '')
        setCuit(cleanCuit)

        // Buscar en cache de Colppy por CUIT
        const colppyRes = await fetch(`/api/colppy/clientes?search=${cleanCuit}&limit=5`)
        if (!colppyRes.ok) throw new Error('Error buscando en Colppy')
        const colppyData = await colppyRes.json()

        // Buscar match exacto por CUIT
        const match = (colppyData.customers || []).find(
          (c: ColppyCustomer) => c.cuit?.replace(/\D/g, '') === cleanCuit
        )

        if (match) {
          setCustomer(match)
        } else {
          throw new Error('Cliente no encontrado en Colppy')
        }
      } else {
        // ─── Búsqueda por ID local (backward compat) ─────────────────────
        // Obtener datos del cliente local para extraer CUIT
        const localRes = await fetch(`/api/clientes/${rawId}`)
        if (!localRes.ok) throw new Error('Cliente no encontrado')
        const localData = await localRes.json()

        const localCuit = localData.cuit?.replace(/\D/g, '') || ''
        setCuit(localCuit)

        if (localCuit && localCuit.length === 11) {
          // Buscar en Colppy por CUIT
          const colppyRes = await fetch(`/api/colppy/clientes?search=${localCuit}&limit=5`)
          if (colppyRes.ok) {
            const colppyData = await colppyRes.json()
            const match = (colppyData.customers || []).find(
              (c: ColppyCustomer) => c.cuit?.replace(/\D/g, '') === localCuit
            )
            if (match) {
              setCustomer(match)
              return
            }
          }
        }

        // Si no encontramos en Colppy, armar un customer parcial desde los datos locales
        setCustomer({
          id: localData.id,
          colppyId: '',
          name: localData.name || '',
          businessName: localData.businessName || localData.name || '',
          cuit: localData.cuit || '',
          taxCondition: localData.taxCondition || '',
          taxConditionDisplay: localData.taxCondition || '',
          address: localData.address || '',
          city: localData.city || '',
          province: localData.province || '',
          postalCode: localData.postalCode || '',
          phone: localData.phone || '',
          mobile: localData.mobile || '',
          email: localData.email || '',
          saldo: parseFloat(localData.balance) || 0,
          priceMultiplier: localData.priceMultiplier || 1,
          paymentTerms: localData.paymentTerms ? `${localData.paymentTerms} días` : 'Sin dato',
          paymentTermsDays: localData.paymentTerms || 0,
        })
      }
    } catch (e: any) {
      setError(e.message || 'Error al cargar cliente')
    } finally {
      setLoading(false)
    }
  }, [rawId])

  useEffect(() => {
    loadCustomer()
  }, [loadCustomer])

  // ─── Loading ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <Loader2 className="h-10 w-10 animate-spin text-blue-600 mb-3" />
        <p className="text-gray-500">Cargando datos del cliente...</p>
      </div>
    )
  }

  // ─── Error ──────────────────────────────────────────────────────────────────

  if (error || !customer) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => router.push('/clientes')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Volver a Clientes
        </Button>
        <div className="text-center py-16">
          <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-3" />
          <p className="text-red-600 text-lg font-medium">{error || 'Cliente no encontrado'}</p>
          <p className="text-gray-500 text-sm mt-1">
            No se pudo encontrar el cliente con ID: {rawId}
          </p>
          <Button variant="outline" className="mt-4" onClick={loadCustomer}>
            Reintentar
          </Button>
        </div>
      </div>
    )
  }

  // ─── Saldo indicator ───────────────────────────────────────────────────────

  const saldoColor = customer.saldo <= 0
    ? 'text-green-600'
    : customer.saldo > 100000
    ? 'text-red-600'
    : 'text-yellow-600'

  const saldoBadge = customer.saldo <= 0
    ? 'bg-green-100 text-green-800'
    : customer.saldo > 100000
    ? 'bg-red-100 text-red-800'
    : 'bg-yellow-100 text-yellow-800'

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Back */}
      <Button variant="ghost" onClick={() => router.push('/clientes')} className="text-gray-500">
        <ArrowLeft className="h-4 w-4 mr-2" />
        Volver a Clientes
      </Button>

      {/* Header */}
      <Card className="border-blue-200">
        <CardContent className="pt-6 pb-5">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center">
                <Users className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  {customer.businessName || customer.name}
                </h1>
                {customer.businessName && customer.name !== customer.businessName && (
                  <p className="text-sm text-gray-500">{customer.name}</p>
                )}
                <div className="flex items-center gap-3 mt-1">
                  <span className="font-mono text-sm text-gray-600">
                    {customer.cuit ? formatCUIT(customer.cuit) : 'Sin CUIT'}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {customer.taxConditionDisplay || customer.taxCondition}
                  </Badge>
                  {customer.paymentTerms && (
                    <Badge variant="outline" className="text-xs">
                      {customer.paymentTerms}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">Saldo CC</p>
              <p className={`text-2xl font-bold ${saldoColor}`}>
                $ {formatNumber(customer.saldo)}
              </p>
              <Badge className={`${saldoBadge} text-xs mt-1`}>
                {customer.saldo <= 0 ? 'Al día' : 'Deudor'}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <ClienteDetailTabs
        colppyCustomer={customer}
        cuit={cuit || customer.cuit?.replace(/\D/g, '') || ''}
      />
    </div>
  )
}
