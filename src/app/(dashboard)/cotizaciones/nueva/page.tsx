'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowLeft, Save, Loader2, DollarSign } from 'lucide-react'
import { toast } from 'sonner'
import { ColppyCustomerSearch, type ColppyCustomer } from '@/components/ColppyCustomerSearch'

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
  const [selectedCustomer, setSelectedCustomer] = useState<ColppyCustomer | null>(null)
  const [_products, setProducts] = useState<Product[]>([])
  const [_brandDiscounts, setBrandDiscounts] = useState<BrandDiscount[]>([])

  // Calcular fecha de vigencia: hoy + 5 días
  const getDefaultValidUntil = () => {
    const date = new Date()
    date.setDate(date.getDate() + 5)
    return date.toISOString().split('T')[0] // yyyy-mm-dd
  }

  const [formData, setFormData] = useState({
    terms: '',
    notes: '',
    validUntil: getDefaultValidUntil(),
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

  // Manejar selección de cliente y autocompletar condición de pago
  const handleCustomerSelect = (customer: ColppyCustomer | null) => {
    setSelectedCustomer(customer)

    if (customer) {
      // Autocompletar condición de pago desde Colppy
      const condicionTexto = customer.paymentTerms || 'Contado'
      setFormData(prev => ({
        ...prev,
        terms: `Condición de pago: ${condicionTexto}. Precios válidos por 5 días corridos desde la fecha de emisión.`,
      }))
    } else {
      // Si se deselecciona el cliente, limpiar términos
      setFormData(prev => ({
        ...prev,
        terms: '',
      }))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!selectedCustomer) {
      toast.error('Debe seleccionar un cliente')
      return
    }

    try {
      setLoading(true)

      const quoteData = {
        colppyCustomer: selectedCustomer, // Enviar datos del cliente de Colppy
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
              <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-2">
                <div className="lg:col-span-2">
                  <ColppyCustomerSearch
                    value={selectedCustomer}
                    onChange={handleCustomerSelect}
                    placeholder="Buscar cliente por nombre o CUIT en Colppy..."
                    disabled={loading}
                  />
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

                {selectedCustomer && (
                  <div className="space-y-2">
                    <Label className="text-blue-900">Multiplicador del Cliente</Label>
                    <p className={`font-mono font-semibold text-lg ${
                      selectedCustomer.priceMultiplier > 1 ? 'text-amber-600' : 'text-gray-700'
                    }`}>
                      {Number(selectedCustomer.priceMultiplier).toFixed(2)}x
                      {selectedCustomer.priceMultiplier > 1 && (
                        <span className="text-sm ml-2">
                          (+{((selectedCustomer.priceMultiplier - 1) * 100).toFixed(0)}%)
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Se precargará en la cotización. Editable luego.
                    </p>
                  </div>
                )}
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
                  <p className="text-xs text-muted-foreground">
                    Por defecto 5 días. Modificable según acuerdo con el cliente.
                  </p>
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
                <p className="text-xs text-muted-foreground">
                  Precargado desde Colppy. Podés editarlo según el acuerdo con el cliente.
                </p>
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
