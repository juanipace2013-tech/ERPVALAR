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
import { ArrowLeft, Save, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

interface User {
  id: string
  name: string
  email: string
}

const TAX_CONDITIONS = [
  { value: 'RESPONSABLE_INSCRIPTO', label: 'Responsable Inscripto' },
  { value: 'MONOTRIBUTO', label: 'Monotributista' },
  { value: 'EXENTO', label: 'Exento' },
  { value: 'CONSUMIDOR_FINAL', label: 'Consumidor Final' },
  { value: 'NO_RESPONSABLE', label: 'No Responsable' },
  { value: 'RESPONSABLE_NO_INSCRIPTO', label: 'Responsable No Inscripto' },
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

export default function NewCustomerPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [users, setUsers] = useState<User[]>([])

  const [formData, setFormData] = useState({
    name: '',
    businessName: '',
    type: 'BUSINESS',
    cuit: '',
    taxCondition: 'RESPONSABLE_INSCRIPTO',
    email: '',
    phone: '',
    mobile: '',
    website: '',
    address: '',
    city: '',
    province: '',
    postalCode: '',
    country: 'Argentina',
    status: 'ACTIVE',
    creditLimit: '',
    creditCurrency: 'ARS',
    paymentTerms: '',
    discount: '',
    priceMultiplier: '1.0',
    salesPersonId: '',
    notes: '',
  })

  useEffect(() => {
    fetchUsers()
  }, [])

  const fetchUsers = async () => {
    try {
      const response = await fetch('/api/users')
      if (response.ok) {
        const data = await response.json()
        setUsers(data.users || [])
      }
    } catch (error) {
      console.error('Error fetching users:', error)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      setLoading(true)

      // Preparar datos
      const payload = {
        name: formData.name,
        businessName: formData.businessName || undefined,
        type: formData.type,
        cuit: formData.cuit,
        taxCondition: formData.taxCondition,
        email: formData.email || undefined,
        phone: formData.phone || undefined,
        mobile: formData.mobile || undefined,
        website: formData.website || undefined,
        address: formData.address || undefined,
        city: formData.city || undefined,
        province: formData.province || undefined,
        postalCode: formData.postalCode || undefined,
        country: formData.country,
        status: formData.status,
        creditLimit: formData.creditLimit ? parseFloat(formData.creditLimit) : undefined,
        creditCurrency: formData.creditLimit ? formData.creditCurrency : undefined,
        paymentTerms: formData.paymentTerms ? parseInt(formData.paymentTerms) : undefined,
        discount: formData.discount ? parseFloat(formData.discount) : undefined,
        priceMultiplier: parseFloat(formData.priceMultiplier),
        salesPersonId: formData.salesPersonId || undefined,
        notes: formData.notes || undefined,
      }

      const response = await fetch('/api/clientes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errorData = await response.json()
        if (errorData.details) {
          const errors = errorData.details.map((err: any) => err.message).join(', ')
          throw new Error(errors)
        }
        throw new Error(errorData.error || 'Error al crear cliente')
      }

      const customer = await response.json()
      toast.success('Cliente creado exitosamente')
      router.push(`/clientes/${customer.id}`)
    } catch (error) {
      console.error('Error:', error)
      toast.error(error instanceof Error ? error.message : 'Error al crear cliente')
    } finally {
      setLoading(false)
    }
  }

  const handleInputChange = (field: string, value: any) => {
    setFormData({ ...formData, [field]: value })
  }

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
              Nuevo Cliente
            </h1>
            <p className="text-muted-foreground">
              Complete la información del cliente
            </p>
          </div>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit}>
        <div className="space-y-6">
          {/* Datos Básicos */}
          <Card className="border-blue-200">
            <CardHeader>
              <CardTitle className="text-blue-900">Datos básicos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">
                    Nombre comercial <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => handleInputChange('name', e.target.value)}
                    placeholder="Ej: ACME Corp"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="businessName">Razón social</Label>
                  <Input
                    id="businessName"
                    value={formData.businessName}
                    onChange={(e) => handleInputChange('businessName', e.target.value)}
                    placeholder="Ej: ACME Corporation S.A."
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="type">
                    Tipo <span className="text-red-500">*</span>
                  </Label>
                  <Select
                    value={formData.type}
                    onValueChange={(value) => handleInputChange('type', value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BUSINESS">Empresa</SelectItem>
                      <SelectItem value="INDIVIDUAL">Persona Física</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cuit">
                    CUIT <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="cuit"
                    value={formData.cuit}
                    onChange={(e) => handleInputChange('cuit', e.target.value)}
                    placeholder="20-12345678-9"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Formato: XX-XXXXXXXX-X
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="taxCondition">
                    Condición fiscal <span className="text-red-500">*</span>
                  </Label>
                  <Select
                    value={formData.taxCondition}
                    onValueChange={(value) => handleInputChange('taxCondition', value)}
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
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Contacto */}
          <Card className="border-blue-200">
            <CardHeader>
              <CardTitle className="text-blue-900">Información de contacto</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => handleInputChange('email', e.target.value)}
                    placeholder="contacto@empresa.com"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone">Teléfono</Label>
                  <Input
                    id="phone"
                    value={formData.phone}
                    onChange={(e) => handleInputChange('phone', e.target.value)}
                    placeholder="011-4567-8900"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="mobile">Celular</Label>
                  <Input
                    id="mobile"
                    value={formData.mobile}
                    onChange={(e) => handleInputChange('mobile', e.target.value)}
                    placeholder="11-5678-9012"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="website">Sitio web</Label>
                  <Input
                    id="website"
                    type="url"
                    value={formData.website}
                    onChange={(e) => handleInputChange('website', e.target.value)}
                    placeholder="https://www.empresa.com"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Dirección */}
          <Card className="border-blue-200">
            <CardHeader>
              <CardTitle className="text-blue-900">Dirección</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="address">Calle y número</Label>
                  <Input
                    id="address"
                    value={formData.address}
                    onChange={(e) => handleInputChange('address', e.target.value)}
                    placeholder="Av. Corrientes 1234"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="city">Ciudad</Label>
                  <Input
                    id="city"
                    value={formData.city}
                    onChange={(e) => handleInputChange('city', e.target.value)}
                    placeholder="Buenos Aires"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="province">Provincia</Label>
                  <Select
                    value={formData.province}
                    onValueChange={(value) => handleInputChange('province', value)}
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
                </div>

                <div className="space-y-2">
                  <Label htmlFor="postalCode">Código postal</Label>
                  <Input
                    id="postalCode"
                    value={formData.postalCode}
                    onChange={(e) => handleInputChange('postalCode', e.target.value)}
                    placeholder="C1043"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="country">País</Label>
                  <Input
                    id="country"
                    value={formData.country}
                    onChange={(e) => handleInputChange('country', e.target.value)}
                    disabled
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Información Comercial */}
          <Card className="border-blue-200">
            <CardHeader>
              <CardTitle className="text-blue-900">Información comercial</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="creditLimit">Límite de crédito</Label>
                  <div className="flex gap-2">
                    <Input
                      id="creditLimit"
                      type="number"
                      step="0.01"
                      value={formData.creditLimit}
                      onChange={(e) => handleInputChange('creditLimit', e.target.value)}
                      placeholder="0.00"
                    />
                    <Select
                      value={formData.creditCurrency}
                      onValueChange={(value) => handleInputChange('creditCurrency', value)}
                    >
                      <SelectTrigger className="w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ARS">ARS</SelectItem>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="EUR">EUR</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="paymentTerms">Plazo de pago (días)</Label>
                  <Input
                    id="paymentTerms"
                    type="number"
                    value={formData.paymentTerms}
                    onChange={(e) => handleInputChange('paymentTerms', e.target.value)}
                    placeholder="30"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="discount">Descuento (%)</Label>
                  <Input
                    id="discount"
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={formData.discount}
                    onChange={(e) => handleInputChange('discount', e.target.value)}
                    placeholder="0.00"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="priceMultiplier">
                    Multiplicador de precio <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="priceMultiplier"
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.priceMultiplier}
                    onChange={(e) => handleInputChange('priceMultiplier', e.target.value)}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    1.0 = precio base, 1.2 = +20%, 0.8 = -20%
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="salesPersonId">Vendedor asignado</Label>
                  <Select
                    value={formData.salesPersonId}
                    onValueChange={(value) => handleInputChange('salesPersonId', value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Sin asignar" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Sin asignar</SelectItem>
                      {users.map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="status">Estado</Label>
                  <Select
                    value={formData.status}
                    onValueChange={(value) => handleInputChange('status', value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ACTIVE">Activo</SelectItem>
                      <SelectItem value="INACTIVE">Inactivo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Notas */}
          <Card className="border-blue-200">
            <CardHeader>
              <CardTitle className="text-blue-900">Notas y observaciones</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label htmlFor="notes">Notas internas</Label>
                <Textarea
                  id="notes"
                  rows={6}
                  value={formData.notes}
                  onChange={(e) => handleInputChange('notes', e.target.value)}
                  placeholder="Información adicional sobre el cliente..."
                />
              </div>
            </CardContent>
          </Card>

          {/* Botones */}
          <div className="flex justify-end gap-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push('/clientes')}
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
                  Crear Cliente
                </>
              )}
            </Button>
          </div>
        </div>
      </form>
    </div>
  )
}
