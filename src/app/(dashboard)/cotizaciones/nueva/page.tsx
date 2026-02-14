'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ArrowLeft, Save, Loader2, Plus, DollarSign } from 'lucide-react'
import { toast } from 'sonner'

interface Customer {
  id: string
  name: string
  priceMultiplier: number
}

interface Product {
  id: string
  sku: string
  name: string
  brand: string | null
  listPriceUSD: number | null
}

interface BrandDiscount {
  brand: string
  discountPercent: number
}

export default function NuevaCotizacionPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [quoteNumber, setQuoteNumber] = useState('')
  const [exchangeRate, setExchangeRate] = useState(0)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [brandDiscounts, setBrandDiscounts] = useState<BrandDiscount[]>([])

  const [formData, setFormData] = useState({
    customerId: '',
    terms: 'Pago: 50% anticipo, 50% contra entrega. Entrega: 15 días hábiles.',
    notes: '',
    validUntil: '',
  })

  useEffect(() => {
    fetchInitialData()
  }, [])

  const fetchInitialData = async () => {
    try {
      // Obtener próximo número
      const nextNumRes = await fetch('/api/quotes/next-number')
      if (nextNumRes.ok) {
        const data = await nextNumRes.json()
        setQuoteNumber(data.quoteNumber)
      }

      // Obtener tipo de cambio
      const tcRes = await fetch('/api/tipo-cambio?from=USD&to=ARS')
      if (tcRes.ok) {
        const data = await tcRes.json()
        if (data.rates && data.rates.length > 0) {
          setExchangeRate(Number(data.rates[0].rate))
        }
      }

      // Obtener clientes
      const custRes = await fetch('/api/clientes')
      if (custRes.ok) {
        const data = await custRes.json()
        setCustomers(data.customers || [])
      }

      // Obtener productos
      const prodRes = await fetch('/api/productos?limit=100')
      if (prodRes.ok) {
        const data = await prodRes.json()
        setProducts(data.products || [])
      }

      // Obtener descuentos de marca
      const brandRes = await fetch('/api/brands/discounts')
      if (brandRes.ok) {
        const data = await brandRes.json()
        setBrandDiscounts(data.discounts || [])
      }
    } catch (error) {
      console.error('Error cargando datos:', error)
      toast.error('Error al cargar datos iniciales')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.customerId) {
      toast.error('Debe seleccionar un cliente')
      return
    }

    try {
      setLoading(true)

      const quoteData = {
        customerId: formData.customerId,
        exchangeRate,
        currency: 'USD',
        terms: formData.terms,
        notes: formData.notes,
        validUntil: formData.validUntil
          ? new Date(formData.validUntil).toISOString()
          : null,
        subtotal: 0,
        total: 0,
      }

      const response = await fetch('/api/quotes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(quoteData),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || 'Error al crear cotización')
      }

      const quote = await response.json()
      toast.success('Cotización creada exitosamente')
      router.push(`/cotizaciones/${quote.id}`)
    } catch (error) {
      console.error('Error:', error)
      toast.error(
        error instanceof Error ? error.message : 'Error al crear cotización'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push('/cotizaciones')}
            className="text-blue-600 hover:text-blue-700"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-blue-900">
              Nueva Cotización
            </h1>
            <p className="text-muted-foreground">
              Crear una nueva cotización o presupuesto
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid gap-6">
          {/* Información General */}
          <Card className="border-blue-200">
            <CardHeader>
              <CardTitle className="text-blue-900">Información General</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="customerId" className="text-blue-900">
                    Cliente <span className="text-red-500">*</span>
                  </Label>
                  <Select
                    value={formData.customerId}
                    onValueChange={(value) =>
                      setFormData({ ...formData, customerId: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar cliente..." />
                    </SelectTrigger>
                    <SelectContent>
                      {customers.map((customer) => (
                        <SelectItem key={customer.id} value={customer.id}>
                          {customer.name} (Mult: {customer.priceMultiplier}x)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="quoteNumber" className="text-blue-900">
                    Nº Cotización
                  </Label>
                  <Input
                    id="quoteNumber"
                    value={quoteNumber}
                    disabled
                    className="font-mono bg-gray-50"
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="validUntil" className="text-blue-900">
                    Válida Hasta
                  </Label>
                  <Input
                    id="validUntil"
                    type="date"
                    value={formData.validUntil}
                    onChange={(e) =>
                      setFormData({ ...formData, validUntil: e.target.value })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-blue-900">Tipo de Cambio USD → ARS</Label>
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-5 w-5 text-blue-600" />
                    <Input
                      type="number"
                      step="0.01"
                      value={exchangeRate}
                      onChange={(e) => setExchangeRate(parseFloat(e.target.value))}
                      className="font-mono font-semibold"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Actualizado desde Banco Central
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="terms" className="text-blue-900">
                  Condiciones de Pago
                </Label>
                <Textarea
                  id="terms"
                  value={formData.terms}
                  onChange={(e) =>
                    setFormData({ ...formData, terms: e.target.value })
                  }
                  rows={3}
                  placeholder="Condiciones comerciales y de entrega..."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes" className="text-blue-900">
                  Notas Internas
                </Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  onChange={(e) =>
                    setFormData({ ...formData, notes: e.target.value })
                  }
                  rows={3}
                  placeholder="Notas y observaciones internas..."
                />
              </div>
            </CardContent>
          </Card>

          {/* Items Info */}
          <Card className="border-blue-200">
            <CardHeader>
              <CardTitle className="text-blue-900">Items de la Cotización</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8">
                <p className="text-muted-foreground mb-2">
                  Primero crea la cotización base.
                </p>
                <p className="text-sm text-muted-foreground">
                  Luego podrás agregar items con búsqueda de productos, adicionales y alternativas.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Botones */}
          <div className="flex justify-end gap-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push('/cotizaciones')}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className="bg-blue-600 hover:bg-blue-700"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Guardando...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Crear Cotización
                </>
              )}
            </Button>
          </div>
        </div>
      </form>
    </div>
  )
}
