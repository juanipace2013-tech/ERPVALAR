'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Loader2, Package, Truck } from 'lucide-react'
import { toast } from 'sonner'

interface QuoteItem {
  id: string
  description: string | null
  quantity: number
  isAlternative: boolean
  product: { name: string; sku: string; unit: string } | null
  manualSku?: string | null
}

interface Quote {
  id: string
  quoteNumber: string
  status: string
  totalAmount: number
  currency: string
  customer: {
    id: string
    name: string
    businessName: string | null
    cuit: string | null
    address: string | null
    city: string | null
    province: string | null
    taxCondition: string | null
  }
  items: QuoteItem[]
  exchangeRate?: { rate: number } | null
}

export default function NuevoRemitoPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const quoteId = searchParams.get('quoteId')

  const [quote, setQuote] = useState<Quote | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // Campos del remito
  const [carrier, setCarrier] = useState('')
  const [transportAddress, setTransportAddress] = useState('')
  const [purchaseOrder, setPurchaseOrder] = useState('')
  const [bultos, setBultos] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (!quoteId) {
      router.push('/cotizaciones')
      return
    }
    fetchQuote()
  }, [quoteId])

  const fetchQuote = async () => {
    try {
      const res = await fetch(`/api/quotes/${quoteId}`)
      if (!res.ok) throw new Error('Error al cargar cotización')
      const data = await res.json()
      setQuote(data)
    } catch {
      toast.error('Error al cargar la cotización')
      router.push('/cotizaciones')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!quote) return

    setSubmitting(true)
    try {
      // Calcular totalAmountARS
      const exchangeRateValue = quote.exchangeRate?.rate || 1
      const totalAmountARS = quote.currency === 'USD'
        ? Number(quote.totalAmount) * exchangeRateValue
        : Number(quote.totalAmount)

      const res = await fetch(`/api/quotes/${quoteId}/generate-delivery-note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          carrier: carrier || undefined,
          transportAddress: transportAddress || undefined,
          purchaseOrder: purchaseOrder || undefined,
          bultos: bultos ? parseInt(bultos) : undefined,
          totalAmountARS,
          exchangeRate: exchangeRateValue,
          notes: notes || undefined,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Error al generar remito')
      }

      const deliveryNote = await res.json()
      toast.success(`Remito ${deliveryNote.deliveryNumber} generado`)
      router.push(`/remitos/${deliveryNote.id}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al generar remito')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

  if (!quote) return null

  const mainItems = quote.items.filter(i => !i.isAlternative)

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-4">
        <Link href={`/cotizaciones/${quoteId}/ver`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Volver
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Package className="h-6 w-6 text-blue-600" />
            Generar Remito
          </h1>
          <p className="text-sm text-gray-500">
            Cotización {quote.quoteNumber} · {quote.customer.businessName || quote.customer.name}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Info de la cotización */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Datos del cliente</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="font-semibold">{quote.customer.businessName || quote.customer.name}</p>
              {quote.customer.cuit && <p className="text-gray-500">CUIT: {quote.customer.cuit}</p>}
              {quote.customer.address && <p className="text-gray-500">{quote.customer.address}</p>}
              {quote.customer.city && (
                <p className="text-gray-500">
                  {quote.customer.city}{quote.customer.province ? `, ${quote.customer.province}` : ''}
                </p>
              )}
            </div>
            <div>
              {quote.customer.taxCondition && (
                <p className="text-gray-500">IVA: {quote.customer.taxCondition}</p>
              )}
              <Badge variant="outline" className="mt-1">
                {quote.currency} {Number(quote.totalAmount).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Items */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Items a remitir ({mainItems.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Descripción</TableHead>
                  <TableHead className="text-right w-24">Cantidad</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mainItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <p className="font-medium">
                        {item.product?.sku || item.manualSku
                          ? `${item.product?.sku || item.manualSku} - `
                          : ''}
                        {item.description || item.product?.name}
                      </p>
                    </TableCell>
                    <TableCell className="text-right">
                      {item.quantity} {item.product?.unit || 'UN'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Datos del remito */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Truck className="h-4 w-4" />
              Datos del remito
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="purchaseOrder">OC del cliente</Label>
              <Input
                id="purchaseOrder"
                placeholder="Número de orden de compra"
                value={purchaseOrder}
                onChange={(e) => setPurchaseOrder(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bultos">Cantidad de bultos</Label>
              <Input
                id="bultos"
                type="number"
                min="1"
                placeholder="Ej: 3"
                value={bultos}
                onChange={(e) => setBultos(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="carrier">Transporte</Label>
              <Input
                id="carrier"
                placeholder="Nombre del transporte"
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="transportAddress">Dirección del transporte</Label>
              <Input
                id="transportAddress"
                placeholder="Dirección del transporte"
                value={transportAddress}
                onChange={(e) => setTransportAddress(e.target.value)}
              />
            </div>
            <div className="space-y-2 col-span-2">
              <Label htmlFor="notes">Observaciones</Label>
              <Textarea
                id="notes"
                placeholder="Observaciones adicionales..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Link href={`/cotizaciones/${quoteId}/ver`}>
            <Button variant="outline" type="button">Cancelar</Button>
          </Link>
          <Button type="submit" disabled={submitting} className="bg-blue-600 hover:bg-blue-700">
            {submitting ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generando...</>
            ) : (
              <><Package className="h-4 w-4 mr-2" /> Generar Remito</>
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}
