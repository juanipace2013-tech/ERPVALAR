'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ArrowLeft, Loader2, Plus, Trash2, Save } from 'lucide-react'
import { toast } from 'sonner'

interface Supplier {
  id: string
  name: string
  taxId: string | null
}

interface Product {
  id: string
  sku: string
  name: string
  costPrice: number | null
}

interface InvoiceItem {
  id: string
  productId: string | null
  supplierProductCode: string
  description: string
  unit: string
  quantity: number
  listPrice: number
  taxRate: number
}

export default function NewPurchaseInvoicePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<Product[]>([])

  // Datos de la factura
  const [supplierId, setSupplierId] = useState('')
  const [voucherType, setVoucherType] = useState('A')
  const [invoiceType, setInvoiceType] = useState('FA')
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0])
  const [dueDate, setDueDate] = useState(
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  )
  const [pointOfSale, setPointOfSale] = useState('')
  const [invoiceNumberSuffix, setInvoiceNumberSuffix] = useState('')
  const [paymentTerms, setPaymentTerms] = useState('a 30 Días')
  const [generalDiscount, setGeneralDiscount] = useState(0)
  const [description, setDescription] = useState('')
  const [internalNotes, setInternalNotes] = useState('')
  const [currency, setCurrency] = useState('ARS')
  const [exchangeRate, setExchangeRate] = useState(1)

  // Items
  const [items, setItems] = useState<InvoiceItem[]>([
    {
      id: '1',
      productId: null,
      supplierProductCode: '',
      description: '',
      unit: 'UN',
      quantity: 0,
      listPrice: 0,
      taxRate: 21,
    },
  ])

  // Percepciones IIBB
  const [perceptions, setPerceptions] = useState<any[]>([])

  useEffect(() => {
    fetchSuppliers()
    fetchProducts()
  }, [])

  useEffect(() => {
    if (currency === 'USD') {
      fetchExchangeRate()
    } else {
      setExchangeRate(1)
    }
  }, [currency])

  const fetchSuppliers = async () => {
    try {
      const response = await fetch('/api/proveedores?limit=1000')
      if (response.ok) {
        const data = await response.json()
        setSuppliers(data.suppliers || [])
      }
    } catch (error) {
      console.error('Error:', error)
      setSuppliers([])
    }
  }

  const fetchProducts = async () => {
    try {
      const response = await fetch('/api/productos?limit=1000')
      if (response.ok) {
        const data = await response.json()
        setProducts(Array.isArray(data) ? data : (data.products || data.data || []))
      }
    } catch (error) {
      console.error('Error:', error)
      setProducts([])
    }
  }

  const fetchExchangeRate = async () => {
    try {
      const response = await fetch('/api/tipo-cambio?currency=USD')
      if (response.ok) {
        const data = await response.json()
        if (data.length > 0) {
          setExchangeRate(Number(data[0].sellRate))
        }
      }
    } catch (error) {
      console.error('Error fetching exchange rate:', error)
    }
  }

  const addItem = () => {
    setItems([
      ...items,
      {
        id: Date.now().toString(),
        productId: null,
        supplierProductCode: '',
        description: '',
        unit: 'UN',
        quantity: 0,
        listPrice: 0,
        taxRate: 21,
      },
    ])
  }

  const removeItem = (id: string) => {
    setItems(items.filter((item) => item.id !== id))
  }

  const updateItem = (id: string, field: string, value: any) => {
    setItems(
      items.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      )
    )
  }

  const handleProductSelect = (itemId: string, productId: string) => {
    const product = products.find((p) => p.id === productId)
    if (product) {
      setItems(
        items.map((item) =>
          item.id === itemId
            ? {
                ...item,
                productId: product.id,
                description: product.name,
                listPrice: Number(product.costPrice) || 0,
              }
            : item
        )
      )
    }
  }

  const calculateItemSubtotal = (item: InvoiceItem) => {
    const subtotal = item.quantity * item.listPrice
    const discounted = subtotal * (1 - generalDiscount / 100)
    return discounted
  }

  const calculateItemTax = (item: InvoiceItem) => {
    const subtotal = calculateItemSubtotal(item)
    return subtotal * (item.taxRate / 100)
  }

  const calculateItemTotal = (item: InvoiceItem) => {
    return calculateItemSubtotal(item) + calculateItemTax(item)
  }

  const calculateSubtotal = () => {
    return items.reduce((sum, item) => sum + item.quantity * item.listPrice, 0)
  }

  const calculateDiscount = () => {
    return calculateSubtotal() * (generalDiscount / 100)
  }

  const calculateNetAmount = () => {
    return calculateSubtotal() - calculateDiscount()
  }

  const calculateTaxAmount = () => {
    return items.reduce((sum, item) => sum + calculateItemTax(item), 0)
  }

  const calculatePerceptionsAmount = () => {
    return perceptions.reduce((sum, p) => sum + Number(p.amount || 0), 0)
  }

  const calculateTotal = () => {
    return calculateNetAmount() + calculateTaxAmount() + calculatePerceptionsAmount()
  }

  const handleSubmit = async () => {
    if (!supplierId) {
      toast.error('Debe seleccionar un proveedor')
      return
    }

    if (!pointOfSale || !invoiceNumberSuffix) {
      toast.error('Debe ingresar el número de factura completo')
      return
    }

    if (items.length === 0 || items.every(item => item.quantity === 0)) {
      toast.error('Debe agregar al menos un item')
      return
    }

    try {
      setLoading(true)

      const response = await fetch('/api/purchase-invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierId,
          voucherType,
          invoiceType,
          invoiceDate,
          dueDate,
          pointOfSale: pointOfSale.padStart(5, '0'),
          invoiceNumberSuffix: invoiceNumberSuffix.padStart(8, '0'),
          paymentTerms,
          generalDiscount,
          currency,
          exchangeRate,
          description,
          internalNotes,
          items: items.filter(item => item.quantity > 0).map(item => ({
            productId: item.productId,
            supplierProductCode: item.supplierProductCode,
            description: item.description,
            unit: item.unit,
            quantity: item.quantity,
            listPrice: item.listPrice,
            taxRate: item.taxRate,
          })),
          perceptions: perceptions.length > 0 ? perceptions : undefined,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error al crear factura')
      }

      const invoice = await response.json()
      toast.success('Factura de compra creada correctamente')
      router.push(`/proveedores/facturas-compra/${invoice.id}`)
    } catch (error) {
      console.error('Error:', error)
      toast.error(error instanceof Error ? error.message : 'Error al crear factura')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/proveedores/facturas-compra">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Nueva Factura de Compra</h1>
            <p className="text-sm text-gray-600 mt-1">
              Registrar factura de proveedor
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.back()}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            <Save className="h-4 w-4 mr-2" />
            Guardar
          </Button>
        </div>
      </div>

      <Tabs defaultValue="info" className="space-y-6">
        <TabsList>
          <TabsTrigger value="info">Información factura</TabsTrigger>
          <TabsTrigger value="additional">Información adicional</TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="space-y-6">
          {/* Proveedor */}
          <Card>
            <CardHeader>
              <CardTitle>Proveedor</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <Label htmlFor="supplier">Proveedor *</Label>
                  <Select value={supplierId} onValueChange={setSupplierId}>
                    <SelectTrigger id="supplier">
                      <SelectValue placeholder="Seleccionar proveedor" />
                    </SelectTrigger>
                    <SelectContent>
                      {suppliers.map((supplier) => (
                        <SelectItem key={supplier.id} value={supplier.id}>
                          {supplier.name} {supplier.taxId && `- ${supplier.taxId}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Datos de la Factura */}
          <Card>
            <CardHeader>
              <CardTitle>Datos de la Factura</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <Label htmlFor="invoiceDate">Fecha contable *</Label>
                  <Input
                    id="invoiceDate"
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="dueDate">Fecha vencimiento *</Label>
                  <Input
                    id="dueDate"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="invoiceType">Tipo comprob.</Label>
                  <Select value={invoiceType} onValueChange={setInvoiceType}>
                    <SelectTrigger id="invoiceType">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FA">Fa - Factura</SelectItem>
                      <SelectItem value="NC">NC - Nota Crédito</SelectItem>
                      <SelectItem value="ND">ND - Nota Débito</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="voucherType">Tipo factura *</Label>
                  <Select value={voucherType} onValueChange={setVoucherType}>
                    <SelectTrigger id="voucherType">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="A">A</SelectItem>
                      <SelectItem value="B">B</SelectItem>
                      <SelectItem value="C">C</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label>Nro. factura *</Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="00031"
                      value={pointOfSale}
                      onChange={(e) => setPointOfSale(e.target.value.replace(/\D/g, ''))}
                      maxLength={5}
                      className="w-32"
                    />
                    <span className="flex items-center">-</span>
                    <Input
                      placeholder="00293139"
                      value={invoiceNumberSuffix}
                      onChange={(e) => setInvoiceNumberSuffix(e.target.value.replace(/\D/g, ''))}
                      maxLength={8}
                      className="flex-1"
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="paymentTerms">Condición Pago</Label>
                  <Input
                    id="paymentTerms"
                    value={paymentTerms}
                    onChange={(e) => setPaymentTerms(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="generalDiscount">Descuento General %</Label>
                  <Input
                    id="generalDiscount"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={generalDiscount}
                    onChange={(e) => setGeneralDiscount(Number(e.target.value))}
                  />
                </div>
                <div>
                  <Label htmlFor="currency">Moneda *</Label>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger id="currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ARS">ARS - Pesos</SelectItem>
                      <SelectItem value="USD">USD - Dólares</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="exchangeRate">Tipo de Cambio</Label>
                  <Input
                    id="exchangeRate"
                    type="number"
                    min="0"
                    step="0.01"
                    value={exchangeRate}
                    onChange={(e) => setExchangeRate(Number(e.target.value))}
                    disabled={currency === 'ARS'}
                    placeholder={currency === 'ARS' ? '1.00' : 'Tipo de cambio'}
                  />
                </div>
                <div className="col-span-4">
                  <Label htmlFor="description">Descripción</Label>
                  <Input
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Descripción de la factura"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Items */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Items Factura</CardTitle>
              <Button onClick={addItem} size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Agregar Item
              </Button>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50">
                      <TableHead className="w-48">Producto</TableHead>
                      <TableHead className="w-32">Código Prov.</TableHead>
                      <TableHead>Descripción</TableHead>
                      <TableHead className="w-24">Un.Med</TableHead>
                      <TableHead className="w-24">Cant</TableHead>
                      <TableHead className="w-32">P.Unit ARS</TableHead>
                      <TableHead className="w-24">IVA %</TableHead>
                      <TableHead className="w-32 text-right">Subtotal</TableHead>
                      <TableHead className="w-16"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <Select
                            value={item.productId || ''}
                            onValueChange={(value) => handleProductSelect(item.id, value)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Seleccionar producto" />
                            </SelectTrigger>
                            <SelectContent>
                              {products.map((product) => (
                                <SelectItem key={product.id} value={product.id}>
                                  {product.name} {product.sku && `(${product.sku})`}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            value={item.supplierProductCode}
                            onChange={(e) =>
                              updateItem(item.id, 'supplierProductCode', e.target.value)
                            }
                            placeholder="Código"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={item.description}
                            onChange={(e) =>
                              updateItem(item.id, 'description', e.target.value)
                            }
                            placeholder="Descripción del producto"
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={item.unit}
                            onValueChange={(value) => updateItem(item.id, 'unit', value)}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="UN">UN</SelectItem>
                              <SelectItem value="KG">KG</SelectItem>
                              <SelectItem value="M">M</SelectItem>
                              <SelectItem value="M2">M2</SelectItem>
                              <SelectItem value="M3">M3</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.quantity}
                            onChange={(e) =>
                              updateItem(item.id, 'quantity', Number(e.target.value))
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.listPrice}
                            onChange={(e) =>
                              updateItem(item.id, 'listPrice', Number(e.target.value))
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={item.taxRate.toString()}
                            onValueChange={(value) =>
                              updateItem(item.id, 'taxRate', Number(value))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">0%</SelectItem>
                              <SelectItem value="10.5">10.5%</SelectItem>
                              <SelectItem value="21">21%</SelectItem>
                              <SelectItem value="27">27%</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          ${calculateItemTotal(item).toLocaleString('es-AR', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeItem(item.id)}
                          >
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Totales */}
              <div className="mt-6 space-y-2 max-w-md ml-auto">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Subtotal ARS:</span>
                  <span className="font-mono font-semibold">
                    ${calculateSubtotal().toLocaleString('es-AR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
                {generalDiscount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">
                      Descuento {generalDiscount}%:
                    </span>
                    <span className="font-mono text-red-600">
                      -${calculateDiscount().toLocaleString('es-AR', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Neto gravado ARS:</span>
                  <span className="font-mono font-semibold">
                    ${calculateNetAmount().toLocaleString('es-AR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Total IVA:</span>
                  <span className="font-mono font-semibold">
                    ${calculateTaxAmount().toLocaleString('es-AR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
                <div className="flex justify-between text-lg pt-2 border-t">
                  <span className="font-bold">Total factura ARS:</span>
                  <span className="font-mono font-bold text-blue-600">
                    ${calculateTotal().toLocaleString('es-AR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="additional">
          <Card>
            <CardHeader>
              <CardTitle>Notas Internas</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                placeholder="Notas internas privadas (no visibles en reportes)"
                rows={6}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
