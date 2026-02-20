'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import {
  ArrowLeft,
  Save,
  Loader2,
  Pencil,
  X,
  FileText,
  DollarSign,
  Info,
  StickyNote,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react'
import { toast } from 'sonner'

interface Customer {
  id: string
  name: string
  businessName: string | null
  type: string
  cuit: string
  taxCondition: string
  email: string | null
  phone: string | null
  mobile: string | null
  website: string | null
  address: string | null
  city: string | null
  province: string | null
  postalCode: string | null
  country: string
  status: string
  creditLimit: number | null
  creditCurrency: string | null
  paymentTerms: number | null
  discount: number | null
  priceMultiplier: number
  balance: number
  notes: string | null
  salesPerson: {
    id: string
    name: string
    email: string
  } | null
  _count: {
    invoices: number
    quotes: number
    opportunities: number
  }
  createdAt: string
  updatedAt: string
}

interface Invoice {
  id: string
  invoiceNumber: string
  type: string
  issueDate: string
  dueDate: string | null
  description: string | null
  currency: string
  subtotal: number
  total: number
  paidAmount: number
  status: string
}

interface AccountMovement {
  id: string
  type: 'INVOICE'
  date: string
  reference: string
  invoiceType: string
  description: string
  status: string
  currency: string
  debit: number
  credit: number
  balance: number
  dueDate: string
  paidDate: string | null
  items: Array<{
    product: string
    quantity: number
    unitPrice: number
    subtotal: number
  }>
  user: string
}

interface AccountStats {
  totalInvoices: number
  pendingInvoices: number
  paidInvoices: number
  overdueInvoices: number
  totalDebt: number
  totalInvoiced: number
  totalPaid: number
}

const TAX_CONDITIONS = [
  { value: 'RESPONSABLE_INSCRIPTO', label: 'Responsable Inscripto' },
  { value: 'MONOTRIBUTO', label: 'Monotributista' },
  { value: 'EXENTO', label: 'Exento' },
  { value: 'CONSUMIDOR_FINAL', label: 'Consumidor Final' },
]

const PROVINCIAS = [
  'Buenos Aires',
  'CABA',
  'Catamarca',
  'Chaco',
  'Chubut',
  'Córdoba',
  'Corrientes',
  'Entre Ríos',
  'Formosa',
  'Jujuy',
  'La Pampa',
  'La Rioja',
  'Mendoza',
  'Misiones',
  'Neuquén',
  'Río Negro',
  'Salta',
  'San Juan',
  'San Luis',
  'Santa Cruz',
  'Santa Fe',
  'Santiago del Estero',
  'Tierra del Fuego',
  'Tucumán',
]

export default function CustomerDetailPage() {
  const router = useRouter()
  const params = useParams()
  const customerId = params.id as string

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [invoicesPagination, setInvoicesPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  })
  const [accountMovements, setAccountMovements] = useState<AccountMovement[]>([])
  const [accountStats, setAccountStats] = useState<AccountStats | null>(null)
  const [loadingMovements, setLoadingMovements] = useState(false)

  const [formData, setFormData] = useState<Partial<Customer>>({})

  useEffect(() => {
    fetchCustomer()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId])

  useEffect(() => {
    if (customer) {
      fetchInvoices()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer, invoicesPagination.page])

  const fetchCustomer = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/clientes/${customerId}`)
      if (!response.ok) {
        throw new Error('Cliente no encontrado')
      }
      const data = await response.json()
      setCustomer(data)
      setFormData(data)
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar cliente')
      router.push('/clientes')
    } finally {
      setLoading(false)
    }
  }

  const fetchInvoices = async () => {
    try {
      const params = new URLSearchParams({
        customerId: customerId,
        page: invoicesPagination.page.toString(),
        limit: invoicesPagination.limit.toString(),
        status: 'PENDING,OVERDUE', // Solo facturas pendientes
      })

      const response = await fetch(`/api/facturas?${params}`)
      if (response.ok) {
        const data = await response.json()
        setInvoices(data.invoices || [])
        setInvoicesPagination(data.pagination || invoicesPagination)
      }
    } catch (error) {
      console.error('Error fetching invoices:', error)
    }
  }

  const fetchAccountMovements = async () => {
    try {
      setLoadingMovements(true)
      const response = await fetch(`/api/clientes/${customerId}/movimientos`)
      if (response.ok) {
        const data = await response.json()
        setAccountMovements(data.movements || [])
        setAccountStats(data.stats || null)
      } else {
        toast.error('Error al cargar movimientos de cuenta')
      }
    } catch (error) {
      console.error('Error fetching account movements:', error)
      toast.error('Error al cargar movimientos de cuenta')
    } finally {
      setLoadingMovements(false)
    }
  }

  const handleSave = async () => {
    try {
      setSaving(true)

      // Solo enviar los campos que son parte del schema de validación
      const updateData = {
        name: formData.name,
        businessName: formData.businessName,
        type: formData.type,
        cuit: formData.cuit,
        taxCondition: formData.taxCondition,
        email: formData.email,
        phone: formData.phone,
        mobile: formData.mobile,
        website: formData.website,
        address: formData.address,
        city: formData.city,
        province: formData.province,
        postalCode: formData.postalCode,
        country: formData.country,
        status: formData.status,
        creditLimit: formData.creditLimit,
        creditCurrency: formData.creditCurrency,
        paymentTerms: formData.paymentTerms,
        discount: formData.discount,
        priceMultiplier: formData.priceMultiplier,
        salesPersonId: formData.salesPerson?.id,
        notes: formData.notes,
      }

      const response = await fetch(`/api/clientes/${customerId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Error al actualizar cliente')
      }

      const updatedCustomer = await response.json()
      setCustomer(updatedCustomer)
      setEditing(false)
      toast.success('Cliente actualizado exitosamente')
    } catch (error) {
      console.error('Error:', error)
      toast.error(error instanceof Error ? error.message : 'Error al actualizar cliente')
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setFormData(customer || {})
    setEditing(false)
  }

  const formatCurrency = (amount: number, _currency: string = 'ARS') => {
    return new Intl.NumberFormat('es-AR', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  }

  const getInvoiceTypeLabel = (type: string) => {
    const types: Record<string, string> = {
      A: 'FAC A',
      B: 'FAC B',
      C: 'FAC C',
      CREDIT_NOTE_A: 'NC A',
      CREDIT_NOTE_B: 'NC B',
      CREDIT_NOTE_C: 'NC C',
      DEBIT_NOTE_A: 'ND A',
      DEBIT_NOTE_B: 'ND B',
      DEBIT_NOTE_C: 'ND C',
    }
    return types[type] || type
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

  if (!customer) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Cliente no encontrado</p>
      </div>
    )
  }

  const pendingInvoices = invoices.filter(
    (inv) => inv.status === 'PENDING' || inv.status === 'OVERDUE'
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push('/clientes')}
            className="text-blue-600 hover:text-blue-700"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-blue-900">
              {customer.name}
            </h1>
            <p className="text-muted-foreground">
              {customer.businessName || 'Sin razón social'}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {editing ? (
            <>
              <Button variant="outline" onClick={handleCancel} disabled={saving}>
                <X className="h-4 w-4 mr-2" />
                Cancelar
              </Button>
              <Button
                className="bg-blue-600 hover:bg-blue-700"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Guardando...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Guardar
                  </>
                )}
              </Button>
            </>
          ) : (
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-4 w-4 mr-2" />
              Editar
            </Button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-blue-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Saldo Actual
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-900">
              $ {formatCurrency(Number(customer.balance))}
            </div>
          </CardContent>
        </Card>
        <Card className="border-blue-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Facturas Pendientes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              {customer._count.invoices}
            </div>
          </CardContent>
        </Card>
        <Card className="border-blue-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Cotizaciones
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">
              {customer._count.quotes}
            </div>
          </CardContent>
        </Card>
        <Card className="border-blue-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Oportunidades
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {customer._count.opportunities}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Card className="border-blue-200">
        <CardContent className="p-6">
          <Tabs defaultValue="invoices" className="w-full">
            <TabsList className="bg-blue-50">
              <TabsTrigger
                value="invoices"
                className="data-[state=active]:bg-blue-600 data-[state=active]:text-white"
              >
                <FileText className="h-4 w-4 mr-2" />
                Facturas adeudadas
              </TabsTrigger>
              <TabsTrigger
                value="info"
                className="data-[state=active]:bg-blue-600 data-[state=active]:text-white"
              >
                <Info className="h-4 w-4 mr-2" />
                Información general
              </TabsTrigger>
              <TabsTrigger
                value="account"
                className="data-[state=active]:bg-blue-600 data-[state=active]:text-white"
                onClick={() => {
                  if (accountMovements.length === 0 && !loadingMovements) {
                    fetchAccountMovements()
                  }
                }}
              >
                <DollarSign className="h-4 w-4 mr-2" />
                Cuenta cliente
              </TabsTrigger>
              <TabsTrigger
                value="notes"
                className="data-[state=active]:bg-blue-600 data-[state=active]:text-white"
              >
                <StickyNote className="h-4 w-4 mr-2" />
                Otra información
              </TabsTrigger>
            </TabsList>

            {/* Tab: Facturas adeudadas */}
            <TabsContent value="invoices" className="mt-6">
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-blue-900">
                  Facturas adeudadas por el cliente
                </h3>

                {pendingInvoices.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <p>No hay facturas pendientes</p>
                  </div>
                ) : (
                  <>
                    <div className="border rounded-lg overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-blue-50">
                            <TableHead className="font-semibold text-blue-900">
                              Nro Comprobante
                            </TableHead>
                            <TableHead className="font-semibold text-blue-900">
                              Tipo
                            </TableHead>
                            <TableHead className="font-semibold text-blue-900">
                              Fecha emisión
                            </TableHead>
                            <TableHead className="font-semibold text-blue-900">
                              Fecha vencimiento
                            </TableHead>
                            <TableHead className="font-semibold text-blue-900">
                              Descripción
                            </TableHead>
                            <TableHead className="text-right font-semibold text-blue-900">
                              Total
                            </TableHead>
                            <TableHead className="text-right font-semibold text-blue-900">
                              Cobrado
                            </TableHead>
                            <TableHead className="text-right font-semibold text-blue-900">
                              Saldo
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {pendingInvoices.map((invoice) => {
                            const balance = Number(invoice.total) - Number(invoice.paidAmount)
                            return (
                              <TableRow
                                key={invoice.id}
                                className="cursor-pointer hover:bg-blue-50"
                                onDoubleClick={() =>
                                  router.push(`/facturas/${invoice.id}`)
                                }
                              >
                                <TableCell className="font-medium">
                                  {invoice.invoiceNumber}
                                </TableCell>
                                <TableCell>
                                  <span className="px-2 py-1 text-xs font-semibold rounded bg-blue-100 text-blue-700">
                                    {getInvoiceTypeLabel(invoice.type)}
                                  </span>
                                </TableCell>
                                <TableCell>{formatDate(invoice.issueDate)}</TableCell>
                                <TableCell>
                                  {invoice.dueDate
                                    ? formatDate(invoice.dueDate)
                                    : '-'}
                                </TableCell>
                                <TableCell className="max-w-xs truncate">
                                  {invoice.description || 'Factura de venta'}
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                  {invoice.currency} {formatCurrency(Number(invoice.total))}
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                  {formatCurrency(Number(invoice.paidAmount))}
                                </TableCell>
                                <TableCell className="text-right font-mono font-semibold">
                                  {formatCurrency(balance)}
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    </div>

                    {/* Pagination */}
                    {invoicesPagination.totalPages > 1 && (
                      <div className="flex items-center justify-between mt-4">
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() =>
                              setInvoicesPagination({ ...invoicesPagination, page: 1 })
                            }
                            disabled={invoicesPagination.page === 1}
                          >
                            <ChevronsLeft className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() =>
                              setInvoicesPagination({
                                ...invoicesPagination,
                                page: invoicesPagination.page - 1,
                              })
                            }
                            disabled={invoicesPagination.page === 1}
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </Button>

                          <span className="text-sm text-muted-foreground px-4">
                            Página {invoicesPagination.page} de{' '}
                            {invoicesPagination.totalPages}
                          </span>

                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() =>
                              setInvoicesPagination({
                                ...invoicesPagination,
                                page: invoicesPagination.page + 1,
                              })
                            }
                            disabled={
                              invoicesPagination.page === invoicesPagination.totalPages
                            }
                          >
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() =>
                              setInvoicesPagination({
                                ...invoicesPagination,
                                page: invoicesPagination.totalPages,
                              })
                            }
                            disabled={
                              invoicesPagination.page === invoicesPagination.totalPages
                            }
                          >
                            <ChevronsRight className="h-4 w-4" />
                          </Button>
                        </div>

                        <span className="text-sm text-muted-foreground">
                          Mostrando {(invoicesPagination.page - 1) * invoicesPagination.limit + 1} -{' '}
                          {Math.min(
                            invoicesPagination.page * invoicesPagination.limit,
                            invoicesPagination.total
                          )}{' '}
                          de {invoicesPagination.total}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </TabsContent>

            {/* Tab: Información general */}
            <TabsContent value="info" className="mt-6">
              <div className="space-y-6">
                <h3 className="text-lg font-semibold text-blue-900">
                  Información del cliente
                </h3>

                <div className="grid gap-6 md:grid-cols-2">
                  {/* Datos básicos */}
                  <div className="space-y-4">
                    <h4 className="font-medium text-blue-900">Datos básicos</h4>

                    <div className="space-y-2">
                      <Label>Nombre comercial</Label>
                      {editing ? (
                        <Input
                          value={formData.name || ''}
                          onChange={(e) =>
                            setFormData({ ...formData, name: e.target.value })
                          }
                        />
                      ) : (
                        <p className="text-sm">{customer.name}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>Razón social</Label>
                      {editing ? (
                        <Input
                          value={formData.businessName || ''}
                          onChange={(e) =>
                            setFormData({ ...formData, businessName: e.target.value })
                          }
                        />
                      ) : (
                        <p className="text-sm">{customer.businessName || '-'}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>CUIT</Label>
                      {editing ? (
                        <Input
                          value={formData.cuit || ''}
                          onChange={(e) =>
                            setFormData({ ...formData, cuit: e.target.value })
                          }
                        />
                      ) : (
                        <p className="text-sm font-mono">{customer.cuit}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>Condición fiscal</Label>
                      {editing ? (
                        <Select
                          value={formData.taxCondition}
                          onValueChange={(value) =>
                            setFormData({ ...formData, taxCondition: value })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {TAX_CONDITIONS.map((tc) => (
                              <SelectItem key={tc.value} value={tc.value}>
                                {tc.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <p className="text-sm">
                          {TAX_CONDITIONS.find((tc) => tc.value === customer.taxCondition)
                            ?.label || customer.taxCondition}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Contacto */}
                  <div className="space-y-4">
                    <h4 className="font-medium text-blue-900">Contacto</h4>

                    <div className="space-y-2">
                      <Label>Email</Label>
                      {editing ? (
                        <Input
                          type="email"
                          value={formData.email || ''}
                          onChange={(e) =>
                            setFormData({ ...formData, email: e.target.value })
                          }
                        />
                      ) : (
                        <p className="text-sm">{customer.email || '-'}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>Teléfono</Label>
                      {editing ? (
                        <Input
                          value={formData.phone || ''}
                          onChange={(e) =>
                            setFormData({ ...formData, phone: e.target.value })
                          }
                        />
                      ) : (
                        <p className="text-sm">{customer.phone || '-'}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>Celular</Label>
                      {editing ? (
                        <Input
                          value={formData.mobile || ''}
                          onChange={(e) =>
                            setFormData({ ...formData, mobile: e.target.value })
                          }
                        />
                      ) : (
                        <p className="text-sm">{customer.mobile || '-'}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>Sitio web</Label>
                      {editing ? (
                        <Input
                          value={formData.website || ''}
                          onChange={(e) =>
                            setFormData({ ...formData, website: e.target.value })
                          }
                        />
                      ) : (
                        <p className="text-sm">{customer.website || '-'}</p>
                      )}
                    </div>
                  </div>

                  {/* Dirección */}
                  <div className="space-y-4">
                    <h4 className="font-medium text-blue-900">Dirección</h4>

                    <div className="space-y-2">
                      <Label>Calle y número</Label>
                      {editing ? (
                        <Input
                          value={formData.address || ''}
                          onChange={(e) =>
                            setFormData({ ...formData, address: e.target.value })
                          }
                        />
                      ) : (
                        <p className="text-sm">{customer.address || '-'}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>Ciudad</Label>
                      {editing ? (
                        <Input
                          value={formData.city || ''}
                          onChange={(e) =>
                            setFormData({ ...formData, city: e.target.value })
                          }
                        />
                      ) : (
                        <p className="text-sm">{customer.city || '-'}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>Provincia</Label>
                      {editing ? (
                        <Select
                          value={formData.province || ''}
                          onValueChange={(value) =>
                            setFormData({ ...formData, province: value })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar..." />
                          </SelectTrigger>
                          <SelectContent>
                            {PROVINCIAS.map((prov) => (
                              <SelectItem key={prov} value={prov}>
                                {prov}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <p className="text-sm">{customer.province || '-'}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>Código postal</Label>
                      {editing ? (
                        <Input
                          value={formData.postalCode || ''}
                          onChange={(e) =>
                            setFormData({ ...formData, postalCode: e.target.value })
                          }
                        />
                      ) : (
                        <p className="text-sm">{customer.postalCode || '-'}</p>
                      )}
                    </div>
                  </div>

                  {/* Comercial */}
                  <div className="space-y-4">
                    <h4 className="font-medium text-blue-900">Información comercial</h4>

                    <div className="space-y-2">
                      <Label>Límite de crédito</Label>
                      {editing ? (
                        <Input
                          type="number"
                          step="0.01"
                          value={formData.creditLimit || ''}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              creditLimit: parseFloat(e.target.value) || null,
                            })
                          }
                        />
                      ) : (
                        <p className="text-sm">
                          {customer.creditLimit
                            ? `$ ${formatCurrency(Number(customer.creditLimit))}`
                            : '-'}
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>Plazo de pago (días)</Label>
                      {editing ? (
                        <Input
                          type="number"
                          value={formData.paymentTerms || ''}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              paymentTerms: parseInt(e.target.value) || null,
                            })
                          }
                        />
                      ) : (
                        <p className="text-sm">
                          {customer.paymentTerms ? `${customer.paymentTerms} días` : '-'}
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>Multiplicador de precio</Label>
                      {editing ? (
                        <Input
                          type="number"
                          step="0.01"
                          value={formData.priceMultiplier || 1}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              priceMultiplier: parseFloat(e.target.value) || 1,
                            })
                          }
                        />
                      ) : (
                        <p className="text-sm">{customer.priceMultiplier}x</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>Vendedor asignado</Label>
                      <p className="text-sm">
                        {customer.salesPerson?.name || 'Sin asignar'}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>Estado</Label>
                      {editing ? (
                        <Select
                          value={formData.status}
                          onValueChange={(value) =>
                            setFormData({ ...formData, status: value })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ACTIVE">Activo</SelectItem>
                            <SelectItem value="INACTIVE">Inactivo</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <p className="text-sm">
                          {customer.status === 'ACTIVE' ? 'Activo' : 'Inactivo'}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Tab: Cuenta cliente */}
            <TabsContent value="account" className="mt-6">
              <div className="space-y-6">
                <h3 className="text-lg font-semibold text-blue-900">
                  Movimientos de cuenta
                </h3>

                {/* Estadísticas */}
                {accountStats && (
                  <div className="grid gap-4 md:grid-cols-4">
                    <Card className="border-blue-200">
                      <CardContent className="p-4">
                        <div className="text-sm text-muted-foreground">Total Facturado</div>
                        <div className="text-2xl font-bold text-blue-900">
                          $ {formatCurrency(accountStats.totalInvoiced)}
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="border-green-200">
                      <CardContent className="p-4">
                        <div className="text-sm text-muted-foreground">Pagado</div>
                        <div className="text-2xl font-bold text-green-600">
                          $ {formatCurrency(accountStats.totalPaid)}
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="border-orange-200">
                      <CardContent className="p-4">
                        <div className="text-sm text-muted-foreground">Deuda Actual</div>
                        <div className="text-2xl font-bold text-orange-600">
                          $ {formatCurrency(accountStats.totalDebt)}
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="border-red-200">
                      <CardContent className="p-4">
                        <div className="text-sm text-muted-foreground">Facturas Vencidas</div>
                        <div className="text-2xl font-bold text-red-600">
                          {accountStats.overdueInvoices}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )}

                {/* Lista de movimientos */}
                {loadingMovements ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                  </div>
                ) : accountMovements.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <p>No hay movimientos registrados</p>
                  </div>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-blue-50">
                          <TableHead className="font-semibold text-blue-900">Fecha</TableHead>
                          <TableHead className="font-semibold text-blue-900">Comprobante</TableHead>
                          <TableHead className="font-semibold text-blue-900">Descripción</TableHead>
                          <TableHead className="font-semibold text-blue-900">Estado</TableHead>
                          <TableHead className="text-right font-semibold text-blue-900">Debe</TableHead>
                          <TableHead className="text-right font-semibold text-blue-900">Haber</TableHead>
                          <TableHead className="text-right font-semibold text-blue-900">Saldo</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {accountMovements.map((movement) => (
                          <TableRow key={movement.id} className="hover:bg-blue-50">
                            <TableCell className="font-medium">
                              {formatDate(movement.date)}
                            </TableCell>
                            <TableCell>
                              <span className="font-mono text-sm">
                                {movement.reference}
                              </span>
                            </TableCell>
                            <TableCell>
                              <div>
                                <div className="font-medium">{movement.description}</div>
                                {movement.items && movement.items.length > 0 && (
                                  <div className="text-xs text-muted-foreground mt-1">
                                    {movement.items.slice(0, 2).map((item, idx) => (
                                      <div key={idx}>
                                        {item.quantity}x {item.product}
                                      </div>
                                    ))}
                                    {movement.items.length > 2 && (
                                      <div>+{movement.items.length - 2} más</div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <span
                                className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                                  movement.status === 'PAID'
                                    ? 'bg-green-100 text-green-700'
                                    : movement.status === 'AUTHORIZED' || movement.status === 'SENT'
                                    ? 'bg-orange-100 text-orange-700'
                                    : movement.status === 'PENDING'
                                    ? 'bg-yellow-100 text-yellow-700'
                                    : 'bg-gray-100 text-gray-700'
                                }`}
                              >
                                {movement.status === 'PAID'
                                  ? 'Pagada'
                                  : movement.status === 'AUTHORIZED'
                                  ? 'Autorizada'
                                  : movement.status === 'SENT'
                                  ? 'Enviada'
                                  : movement.status === 'PENDING'
                                  ? 'Pendiente'
                                  : movement.status}
                              </span>
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {movement.debit > 0 ? `$ ${formatCurrency(movement.debit)}` : '-'}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {movement.credit > 0 ? `$ ${formatCurrency(movement.credit)}` : '-'}
                            </TableCell>
                            <TableCell className="text-right font-mono font-semibold">
                              $ {formatCurrency(movement.balance)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Tab: Otra información */}
            <TabsContent value="notes" className="mt-6">
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-blue-900">
                  Notas y observaciones
                </h3>

                <div className="space-y-2">
                  <Label>Notas internas</Label>
                  {editing ? (
                    <Textarea
                      rows={10}
                      value={formData.notes || ''}
                      onChange={(e) =>
                        setFormData({ ...formData, notes: e.target.value })
                      }
                      placeholder="Agregar notas sobre el cliente..."
                    />
                  ) : (
                    <div className="min-h-[200px] p-4 border rounded-md bg-gray-50">
                      <p className="text-sm whitespace-pre-wrap">
                        {customer.notes || 'Sin notas'}
                      </p>
                    </div>
                  )}
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-muted-foreground">Fecha de creación</Label>
                    <p className="text-sm">{formatDate(customer.createdAt)}</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-muted-foreground">
                      Última actualización
                    </Label>
                    <p className="text-sm">{formatDate(customer.updatedAt)}</p>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
