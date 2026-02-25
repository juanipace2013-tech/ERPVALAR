'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ArrowLeft, Save, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'

interface User {
  id: string
  name: string
  email: string
}

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

export default function NewSupplierPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [users, setUsers] = useState<User[]>([])
  const [brandInput, setBrandInput] = useState('')

  const [formData, setFormData] = useState({
    name: '',
    legalName: '',
    taxId: '',
    email: '',
    phone: '',
    mobile: '',
    website: '',
    address: '',
    city: '',
    province: '',
    postalCode: '',
    discount: '',
    paymentDays: '30',
    category: '',
    brands: [] as string[],
    status: 'ACTIVE',
    isPreferred: false,
    paymentTerms: '',
    accountNumber: '',
    notes: '',
    internalNotes: '',
    buyerUserId: 'NONE',
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
        legalName: formData.legalName || undefined,
        taxId: formData.taxId || undefined,
        email: formData.email || undefined,
        phone: formData.phone || undefined,
        mobile: formData.mobile || undefined,
        website: formData.website || undefined,
        address: formData.address || undefined,
        city: formData.city || undefined,
        province: formData.province || undefined,
        postalCode: formData.postalCode || undefined,
        discount: formData.discount ? parseFloat(formData.discount) : 0,
        paymentDays: parseInt(formData.paymentDays),
        category: formData.category || undefined,
        brands: formData.brands,
        status: formData.status,
        isPreferred: formData.isPreferred,
        paymentTerms: formData.paymentTerms || undefined,
        accountNumber: formData.accountNumber || undefined,
        notes: formData.notes || undefined,
        internalNotes: formData.internalNotes || undefined,
        buyerUserId: formData.buyerUserId && formData.buyerUserId !== 'NONE' ? formData.buyerUserId : undefined,
      }

      const response = await fetch('/api/proveedores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Error al crear proveedor')
      }

      const supplier = await response.json()
      toast.success('Proveedor creado exitosamente')
      router.push(`/proveedores/${supplier.id}`)
    } catch (error) {
      console.error('Error:', error)
      toast.error(error instanceof Error ? error.message : 'Error al crear proveedor')
    } finally {
      setLoading(false)
    }
  }

  const handleInputChange = (field: string, value: string | number | boolean) => {
    setFormData({ ...formData, [field]: value })
  }

  const addBrand = () => {
    if (brandInput.trim() && !formData.brands.includes(brandInput.trim())) {
      setFormData({
        ...formData,
        brands: [...formData.brands, brandInput.trim()],
      })
      setBrandInput('')
    }
  }

  const removeBrand = (brand: string) => {
    setFormData({
      ...formData,
      brands: formData.brands.filter((b) => b !== brand),
    })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push('/proveedores')}
            className="text-blue-600 hover:text-blue-700"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-blue-900">
              Nuevo Proveedor
            </h1>
            <p className="text-muted-foreground">
              Complete la información del proveedor
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
                    placeholder="Ej: GENEBRE ARGENTINA"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="legalName">Razón social</Label>
                  <Input
                    id="legalName"
                    value={formData.legalName}
                    onChange={(e) => handleInputChange('legalName', e.target.value)}
                    placeholder="Ej: Genebre Argentina S.A."
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="taxId">CUIT</Label>
                  <Input
                    id="taxId"
                    value={formData.taxId}
                    onChange={(e) => handleInputChange('taxId', e.target.value)}
                    placeholder="30-12345678-9"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="category">Categoría</Label>
                  <Input
                    id="category"
                    value={formData.category}
                    onChange={(e) => handleInputChange('category', e.target.value)}
                    placeholder="Ej: Válvulas, Instrumentos, etc."
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="brands">Marcas</Label>
                  <div className="flex gap-2">
                    <Input
                      id="brands"
                      value={brandInput}
                      onChange={(e) => setBrandInput(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          addBrand()
                        }
                      }}
                      placeholder="Agregar marca (presiona Enter)"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={addBrand}
                    >
                      Agregar
                    </Button>
                  </div>
                  {formData.brands.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {formData.brands.map((brand, idx) => (
                        <div
                          key={idx}
                          className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-blue-100 text-blue-800 text-sm"
                        >
                          {brand}
                          <button
                            type="button"
                            onClick={() => removeBrand(brand)}
                            className="ml-1 hover:text-blue-900"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
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
                    placeholder="ventas@proveedor.com"
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
                    placeholder="https://www.proveedor.com"
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
                    placeholder="Av. Industrial 1234"
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
                    placeholder="B1640"
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
                  <Label htmlFor="discount">
                    Descuento que nos otorgan (%) <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="discount"
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={formData.discount}
                    onChange={(e) => handleInputChange('discount', e.target.value)}
                    placeholder="15.00"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="paymentDays">
                    Plazo de pago (días) <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="paymentDays"
                    type="number"
                    value={formData.paymentDays}
                    onChange={(e) => handleInputChange('paymentDays', e.target.value)}
                    placeholder="30"
                    required
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="paymentTerms">Condiciones de pago</Label>
                  <Input
                    id="paymentTerms"
                    value={formData.paymentTerms}
                    onChange={(e) => handleInputChange('paymentTerms', e.target.value)}
                    placeholder="Ej: 30 días fecha de factura"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="accountNumber">Número de cuenta bancaria</Label>
                  <Input
                    id="accountNumber"
                    value={formData.accountNumber}
                    onChange={(e) => handleInputChange('accountNumber', e.target.value)}
                    placeholder="1234567890"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="buyerUserId">Comprador asignado</Label>
                  <Select
                    value={formData.buyerUserId}
                    onValueChange={(value) => handleInputChange('buyerUserId', value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Sin asignar" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">Sin asignar</SelectItem>
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
                      <SelectItem value="BLOCKED">Bloqueado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2 md:col-span-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="isPreferred"
                      checked={formData.isPreferred}
                      onCheckedChange={(checked) =>
                        handleInputChange('isPreferred', checked === true)
                      }
                    />
                    <Label
                      htmlFor="isPreferred"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      Proveedor preferido
                    </Label>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Notas */}
          <Card className="border-blue-200">
            <CardHeader>
              <CardTitle className="text-blue-900">Notas y observaciones</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="notes">Notas públicas</Label>
                <Textarea
                  id="notes"
                  rows={3}
                  value={formData.notes}
                  onChange={(e) => handleInputChange('notes', e.target.value)}
                  placeholder="Información general sobre el proveedor..."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="internalNotes">Notas internas (privadas)</Label>
                <Textarea
                  id="internalNotes"
                  rows={3}
                  value={formData.internalNotes}
                  onChange={(e) => handleInputChange('internalNotes', e.target.value)}
                  placeholder="Observaciones privadas, evaluaciones, etc..."
                />
              </div>
            </CardContent>
          </Card>

          {/* Botones */}
          <div className="flex justify-end gap-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push('/proveedores')}
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
                  Crear Proveedor
                </>
              )}
            </Button>
          </div>
        </div>
      </form>
    </div>
  )
}
