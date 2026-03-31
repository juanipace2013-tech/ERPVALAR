'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
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
import { getLocalDateString } from '@/lib/utils'
import {
  ArrowLeft,
  Loader2,
  Save,
  Plus,
  Trash2,
  Search,
  Truck,
} from 'lucide-react'
import { toast } from 'sonner'
import DeliveryAddressSelector from '@/components/remitos/DeliveryAddressSelector'

// ── Interfaces ──────────────────────────────────────────────────────────────

interface DeliveryNoteItem {
  id?: string
  productId: string | null
  sku: string
  description: string
  quantity: number
  unit: string
}

interface DeliveryNote {
  id: string
  deliveryNumber: string
  date: string
  status: string
  carrier: string | null
  transportAddress: string | null
  purchaseOrder: string | null
  customerInvoiceNumber: string | null
  totalAmountARS: string | number | null
  bultos: string | null
  notes: string | null
  internalNotes: string | null
  deliveryAddress: string | null
  deliveryCity: string | null
  deliveryProvince: string | null
  deliveryPostalCode: string | null
  deliveryContactName: string | null
  deliveryContactPhone: string | null
  customer: {
    id: string
    name: string
    businessName: string | null
    cuit: string
    address: string | null
    city: string | null
    province: string | null
    postalCode: string | null
    defaultTransportName: string | null
    defaultTransportAddress: string | null
    defaultTransportSchedule: string | null
  }
  items: Array<{
    id: string
    productId: string | null
    sku: string | null
    description: string
    quantity: number | string
    unit: string
    product: { id: string; sku: string; name: string; unit: string } | null
  }>
}

// ── Component ───────────────────────────────────────────────────────────────

export default function EditarRemitoPage() {
  const router = useRouter()
  const { id } = useParams<{ id: string }>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deliveryNote, setDeliveryNote] = useState<DeliveryNote | null>(null)

  // Formulario
  const [date, setDate] = useState('')
  const [carrier, setCarrier] = useState('')
  const [transportAddress, setTransportAddress] = useState('')
  const [purchaseOrder, setPurchaseOrder] = useState('')
  const [customerInvoiceNumber, setCustomerInvoiceNumber] = useState('')
  const [bultos, setBultos] = useState('')
  const [totalAmountARS, setTotalAmountARS] = useState('')
  const [notes, setNotes] = useState('')
  const [internalNotes, setInternalNotes] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [deliveryCity, setDeliveryCity] = useState('')
  const [deliveryProvince, setDeliveryProvince] = useState('')
  const [deliveryPostalCode, setDeliveryPostalCode] = useState('')
  const [deliveryContactName, setDeliveryContactName] = useState('')
  const [deliveryContactPhone, setDeliveryContactPhone] = useState('')
  const [items, setItems] = useState<DeliveryNoteItem[]>([])

  // Búsqueda de productos
  const [productSearch, setProductSearch] = useState('')
  const [productResults, setProductResults] = useState<any[]>([])
  const [searchLoading, setSearchLoading] = useState(false)

  useEffect(() => {
    fetchDeliveryNote()
  }, [id])

  const fetchDeliveryNote = async () => {
    try {
      setLoading(true)
      const res = await fetch(`/api/delivery-notes/${id}`)
      if (!res.ok) throw new Error('Error al cargar remito')
      const data: DeliveryNote = await res.json()

      if (data.status !== 'PENDING') {
        toast.error('Solo se pueden editar remitos en estado Pendiente')
        router.push(`/remitos/${id}`)
        return
      }

      setDeliveryNote(data)

      // Rellenar formulario
      setDate(data.date ? getLocalDateString(new Date(data.date)) : '')
      setCarrier(data.carrier || '')
      setTransportAddress(data.transportAddress || '')
      setPurchaseOrder(data.purchaseOrder || '')
      setCustomerInvoiceNumber(data.customerInvoiceNumber || '')
      setBultos(data.bultos != null ? String(data.bultos) : '')
      setTotalAmountARS(
        data.totalAmountARS != null ? String(Number(data.totalAmountARS)) : ''
      )
      setNotes(data.notes || '')
      setInternalNotes(data.internalNotes || '')
      setDeliveryAddress(data.deliveryAddress || '')
      setDeliveryCity(data.deliveryCity || '')
      setDeliveryProvince(data.deliveryProvince || '')
      setDeliveryPostalCode(data.deliveryPostalCode || '')
      setDeliveryContactName(data.deliveryContactName || '')
      setDeliveryContactPhone(data.deliveryContactPhone || '')
      setItems(
        data.items.map((item) => ({
          id: item.id,
          productId: item.productId,
          sku: item.sku || item.product?.sku || '',
          description: item.description || item.product?.name || '',
          quantity: Number(item.quantity),
          unit: item.unit || item.product?.unit || 'UN',
        }))
      )
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar el remito')
      router.push('/remitos')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (items.length === 0) {
      toast.error('Debe haber al menos un item')
      return
    }

    try {
      setSaving(true)
      const res = await fetch(`/api/delivery-notes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          carrier: carrier || null,
          transportAddress: transportAddress || null,
          purchaseOrder: purchaseOrder || null,
          customerInvoiceNumber: customerInvoiceNumber || null,
          bultos: bultos || null,
          totalAmountARS: totalAmountARS ? Number(totalAmountARS) : null,
          notes: notes || null,
          internalNotes: internalNotes || null,
          deliveryAddress: deliveryAddress || null,
          deliveryCity: deliveryCity || null,
          deliveryProvince: deliveryProvince || null,
          deliveryPostalCode: deliveryPostalCode || null,
          deliveryContactName: deliveryContactName || null,
          deliveryContactPhone: deliveryContactPhone || null,
          items: items.map((item) => ({
            productId: item.productId,
            sku: item.sku,
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
          })),
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Error al guardar')
      }

      toast.success('Remito actualizado correctamente')
      router.push(`/remitos/${id}`)
    } catch (error) {
      console.error('Error saving:', error)
      toast.error(
        error instanceof Error ? error.message : 'Error al guardar el remito'
      )
    } finally {
      setSaving(false)
    }
  }

  // ── Items ─────────────────────────────────────────────────────────────

  const addManualItem = () => {
    setItems([
      ...items,
      { productId: null, sku: '', description: '', quantity: 1, unit: 'UN' },
    ])
  }

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index))
  }

  const updateItem = (index: number, field: keyof DeliveryNoteItem, value: any) => {
    const updated = [...items]
    ;(updated[index] as any)[field] = value
    setItems(updated)
  }

  const searchProducts = async (query: string) => {
    if (query.length < 2) {
      setProductResults([])
      return
    }
    try {
      setSearchLoading(true)
      const res = await fetch(`/api/products?search=${encodeURIComponent(query)}&limit=10`)
      if (res.ok) {
        const data = await res.json()
        setProductResults(Array.isArray(data) ? data : data.products || [])
      }
    } catch {
      // ignore
    } finally {
      setSearchLoading(false)
    }
  }

  const addProduct = (product: any) => {
    setItems([
      ...items,
      {
        productId: product.id,
        sku: product.sku || '',
        description: product.name || '',
        quantity: 1,
        unit: product.unit || 'UN',
      },
    ])
    setProductSearch('')
    setProductResults([])
  }

  // ── Render ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

  if (!deliveryNote) return null

  return (
    <div className="container mx-auto px-6 py-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/remitos/${id}`}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              Editar Remito {deliveryNote.deliveryNumber}
            </h1>
            <p className="text-sm text-gray-600 mt-1">
              {deliveryNote.supplier ? 'Proveedor' : 'Cliente'}: {deliveryNote.supplier?.legalName || deliveryNote.supplier?.name || deliveryNote.customer?.businessName || deliveryNote.customer?.name}{' '}
              ({deliveryNote.supplier?.taxId || deliveryNote.customer?.cuit})
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="bg-orange-100 text-orange-800">Pendiente</Badge>
        </div>
      </div>

      {/* Datos de entrega */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Datos de Entrega</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <Label>Fecha</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div>
              <Label>Transportista</Label>
              <Input
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
                placeholder="Nombre del transporte"
              />
              {!carrier && deliveryNote?.customer?.defaultTransportName && (
                <button
                  type="button"
                  className="flex items-center gap-1 mt-1 text-xs text-blue-600 hover:text-blue-800"
                  onClick={() => {
                    setCarrier(deliveryNote.customer.defaultTransportName || '')
                    setTransportAddress(deliveryNote.customer.defaultTransportAddress || '')
                  }}
                >
                  <Truck className="h-3 w-3" />
                  Usar transporte habitual: {deliveryNote.customer.defaultTransportName}
                </button>
              )}
            </div>
            <div>
              <Label>Dirección del Transporte</Label>
              <Input
                value={transportAddress}
                onChange={(e) => setTransportAddress(e.target.value)}
                placeholder="Dirección del transporte"
              />
              {deliveryNote?.customer?.defaultTransportSchedule && carrier && (
                <p className="text-xs text-gray-500 mt-1">
                  Horario: {deliveryNote.customer.defaultTransportSchedule}
                </p>
              )}
            </div>
            <div>
              <Label>OC del Cliente</Label>
              <Input
                value={purchaseOrder}
                onChange={(e) => setPurchaseOrder(e.target.value)}
                placeholder="Número de orden de compra"
              />
            </div>
            <div>
              <Label>Factura del Cliente</Label>
              <Input
                value={customerInvoiceNumber}
                onChange={(e) => setCustomerInvoiceNumber(e.target.value)}
                placeholder="Número de factura"
              />
            </div>
            <div>
              <Label>Bultos</Label>
              <Input
                type="text"
                value={bultos}
                onChange={(e) => setBultos(e.target.value)}
                placeholder="Ej: 1 pallet, 3 cajas"
              />
            </div>
            <div>
              <Label>Valor Declarado (ARS)</Label>
              <Input
                type="number"
                step="0.01"
                value={totalAmountARS}
                onChange={(e) => setTotalAmountARS(e.target.value)}
                placeholder="Monto en $"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Dirección de entrega */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Dirección de Entrega</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {deliveryNote?.customer?.id && (
            <DeliveryAddressSelector
              customerId={deliveryNote.customer?.id || deliveryNote.supplier?.id || ''}
              fiscalAddress={{
                address: deliveryNote.customer?.address || deliveryNote.supplier?.address || null,
                city: deliveryNote.customer?.city || deliveryNote.supplier?.city || null,
                province: deliveryNote.customer?.province || deliveryNote.supplier?.province || null,
                postalCode: deliveryNote.customer?.postalCode || null,
              }}
              onSelect={(addr) => {
                setDeliveryAddress(addr.deliveryAddress || '')
                setDeliveryCity(addr.deliveryCity || '')
                setDeliveryProvince(addr.deliveryProvince || '')
                setDeliveryPostalCode(addr.deliveryPostalCode || '')
                setDeliveryContactName(addr.deliveryContactName || '')
                setDeliveryContactPhone(addr.deliveryContactPhone || '')
              }}
            />
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <Label>Dirección</Label>
              <Input
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
                placeholder="Dirección de entrega"
              />
            </div>
            <div>
              <Label>Ciudad</Label>
              <Input
                value={deliveryCity}
                onChange={(e) => setDeliveryCity(e.target.value)}
                placeholder="Ciudad"
              />
            </div>
            <div>
              <Label>Provincia</Label>
              <Input
                value={deliveryProvince}
                onChange={(e) => setDeliveryProvince(e.target.value)}
                placeholder="Provincia"
              />
            </div>
            <div>
              <Label>Código Postal</Label>
              <Input
                value={deliveryPostalCode}
                onChange={(e) => setDeliveryPostalCode(e.target.value)}
                placeholder="Código postal"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Items */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Items ({items.length})</CardTitle>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Buscar producto..."
                  value={productSearch}
                  onChange={(e) => {
                    setProductSearch(e.target.value)
                    searchProducts(e.target.value)
                  }}
                  className="pl-10 w-64"
                />
                {productResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-white border rounded-md shadow-lg max-h-48 overflow-y-auto">
                    {productResults.map((p: any) => (
                      <button
                        key={p.id}
                        onClick={() => addProduct(p)}
                        className="w-full text-left px-3 py-2 hover:bg-gray-100 text-sm"
                      >
                        <span className="font-mono text-xs text-gray-500">{p.sku}</span>{' '}
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Button variant="outline" onClick={addManualItem}>
                <Plus className="h-4 w-4 mr-2" />
                Item Manual
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              No hay items. Agregá productos buscándolos o de forma manual.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">SKU</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead className="w-[100px]">Cantidad</TableHead>
                  <TableHead className="w-[80px]">Unidad</TableHead>
                  <TableHead className="w-[50px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <Input
                        value={item.sku}
                        onChange={(e) => updateItem(index, 'sku', e.target.value)}
                        className="font-mono text-xs"
                        placeholder="SKU"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={item.description}
                        onChange={(e) =>
                          updateItem(index, 'description', e.target.value)
                        }
                        placeholder="Descripción del producto"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        value={item.quantity}
                        onChange={(e) =>
                          updateItem(index, 'quantity', Number(e.target.value))
                        }
                        className="text-right"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={item.unit}
                        onChange={(e) => updateItem(index, 'unit', e.target.value)}
                        className="text-center"
                        placeholder="UN"
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeItem(index)}
                        className="text-red-500 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Notas */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Notas</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Notas (visibles en remito)</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Notas para el remito..."
              />
            </div>
            <div>
              <Label>Notas Internas</Label>
              <Textarea
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                rows={3}
                placeholder="Notas internas (no se imprimen)..."
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Botones */}
      <div className="flex items-center justify-between">
        <Button variant="outline" asChild>
          <Link href={`/remitos/${id}`}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Cancelar
          </Link>
        </Button>
        <Button
          onClick={handleSave}
          disabled={saving || items.length === 0}
          className="bg-blue-600 hover:bg-blue-700"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Guardar Cambios
        </Button>
      </div>
    </div>
  )
}
