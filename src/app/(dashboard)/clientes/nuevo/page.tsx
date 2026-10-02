'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
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
import { ArrowLeft, Save, Loader2, Search } from 'lucide-react'
import { toast } from 'sonner'
import { PAISES_CLIENTE, esArgentina, etiquetaIdFiscal, paisCliente } from '@/lib/cliente-exterior'

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
  { value: 'CLIENTE_EXTERIOR', label: 'Cliente del Exterior' },
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
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(false)
  const [loadingAFIP, setLoadingAFIP] = useState(false)
  const [users, setUsers] = useState<User[]>([])
  // País fuera de la lista ("Otro"): se escribe a mano
  const [paisOtro, setPaisOtro] = useState(false)

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
    salesPersonId: 'NONE',
    notes: '',
  })

  // Cliente del exterior: país distinto de Argentina (RUT/RUC opcional, sin AFIP,
  // región libre, condición "Cliente del Exterior", no se sube a Colppy)
  const exterior = paisOtro || !esArgentina(formData.country)
  const pais = paisCliente(formData.country)

  const cambiarPais = (valor: string) => {
    if (!valor) return // autocompletado del navegador sobre el <select> oculto
    if (valor === '__OTRO__') {
      setPaisOtro(true)
      setFormData((prev) => ({ ...prev, country: '', taxCondition: 'CLIENTE_EXTERIOR', province: '' }))
      return
    }
    const eraExterior = paisOtro || !esArgentina(formData.country)
    setPaisOtro(false)
    const esAr = esArgentina(valor)
    setFormData((prev) => ({
      ...prev,
      country: valor,
      taxCondition: esAr ? (prev.taxCondition === 'CLIENTE_EXTERIOR' ? 'RESPONSABLE_INSCRIPTO' : prev.taxCondition) : 'CLIENTE_EXTERIOR',
      // la lista de provincias es argentina: al cambiar de país se vacía
      province: esAr === !eraExterior ? prev.province : '',
    }))
  }

  useEffect(() => {
    fetchUsers()
  }, [])

  // Pre-llenar desde query params (p. ej. al venir desde un Lead de Google Ads)
  useEffect(() => {
    const name = searchParams.get('name')
    const email = searchParams.get('email')
    const phone = searchParams.get('phone')
    const businessName = searchParams.get('businessName')
    if (name || email || phone || businessName) {
      setFormData((prev) => ({
        ...prev,
        name: name || prev.name,
        email: email || prev.email,
        phone: phone || prev.phone,
        businessName: businessName || prev.businessName,
      }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchUsers = async () => {
    try {
      const response = await fetch('/api/users?vendedores=true')
      if (response.ok) {
        const data = await response.json()
        setUsers(data.users || [])
      }
    } catch (error) {
      console.error('Error fetching users:', error)
    }
  }

  const fetchAFIPData = async () => {
    const cuit = formData.cuit.replace(/[-\s]/g, '')

    if (!cuit || cuit.length !== 11) {
      toast.error('Por favor ingresa un CUIT válido (11 dígitos)')
      return
    }

    try {
      setLoadingAFIP(true)
      toast.info('Consultando AFIP...')

      const response = await fetch(`/api/afip/cuit/${cuit}`)

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || 'Error al consultar AFIP')
      }

      const result = await response.json()

      if (result.success && result.data) {
        // Autocompletar formulario con datos de AFIP
        setFormData({
          ...formData,
          name: result.data.name || formData.name,
          businessName: result.data.businessName || formData.businessName,
          type: result.data.type || formData.type,
          taxCondition: result.data.taxCondition || formData.taxCondition,
          address: result.data.address || formData.address,
          city: result.data.city || formData.city,
          province: result.data.province || formData.province,
          postalCode: result.data.postalCode || formData.postalCode,
          country: result.data.country || formData.country,
          status: result.data.status || formData.status,
          notes: result.data.notes || formData.notes,
          email: result.data.email || formData.email,
          phone: result.data.phone || formData.phone,
        })

        toast.success('✓ Datos cargados desde AFIP')
      } else {
        throw new Error('No se pudieron obtener los datos')
      }
    } catch (error) {
      console.error('Error fetching AFIP data:', error)
      const errorMessage = error instanceof Error ? error.message : 'Error al consultar AFIP'

      toast.error(errorMessage, {
        duration: 5000,
        description: 'Podés cargar los datos manualmente.',
      })
    } finally {
      setLoadingAFIP(false)
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
        taxCondition: exterior ? 'CLIENTE_EXTERIOR' : formData.taxCondition,
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
        salesPersonId: formData.salesPersonId && formData.salesPersonId !== 'NONE' ? formData.salesPersonId : undefined,
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
          const errors = errorData.details.map((err: { message: string }) => err.message).join(', ')
          throw new Error(errors)
        }
        throw new Error(errorData.error || 'Error al crear cliente')
      }

      const customer = await response.json()
      if (customer.colppy?.omitido === 'exterior') {
        toast.success('Cliente del exterior creado (queda solo en el ERP, no se sube a Colppy)')
      } else if (customer.colppy?.ok) {
        toast.success(customer.colppy.creado ? 'Cliente creado en el ERP y dado de alta en Colppy' : 'Cliente creado y vinculado al que ya existía en Colppy')
      } else {
        toast.success('Cliente creado exitosamente')
        toast.warning(`No se pudo dar de alta en Colppy: ${customer.colppy?.error ?? 'error desconocido'}. Se va a crear con la primera factura.`, { duration: 10000 })
      }
      router.push(`/clientes/${customer.id}`)
    } catch (error) {
      console.error('Error:', error)
      toast.error(error instanceof Error ? error.message : 'Error al crear cliente')
    } finally {
      setLoading(false)
    }
  }

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }
  // Para los Select: el autocompletado del navegador puede mandar "" por el
  // <select> oculto de Radix y dejar el campo en un valor inválido
  const handleSelectChange = (field: string) => (value: string) => {
    if (value) handleInputChange(field, value)
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
                    onValueChange={handleSelectChange('type')}
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
                  <Label htmlFor="country">
                    País <span className="text-red-500">*</span>
                  </Label>
                  <Select value={paisOtro ? '__OTRO__' : pais?.nombre ?? formData.country} onValueChange={cambiarPais}>
                    <SelectTrigger id="country">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAISES_CLIENTE.map((p) => (
                        <SelectItem key={p.iso} value={p.nombre}>
                          {p.nombre}
                        </SelectItem>
                      ))}
                      <SelectItem value="__OTRO__">Otro…</SelectItem>
                    </SelectContent>
                  </Select>
                  {paisOtro && (
                    <Input
                      value={formData.country}
                      onChange={(e) => handleInputChange('country', e.target.value)}
                      placeholder="Nombre del país"
                      required
                    />
                  )}
                  {exterior && (
                    <p className="text-xs text-amber-700">
                      Cliente del exterior: queda solo en el ERP (no se sube a Colppy). Se le factura con Factura E de exportación: cargá dirección, ciudad, país y su ID fiscal.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cuit">
                    {exterior ? `${pais?.idFiscal ?? (formData.country ? etiquetaIdFiscal(formData.country) : 'ID fiscal')} (opcional)` : 'CUIT'}{' '}
                    {!exterior && <span className="text-red-500">*</span>}
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="cuit"
                      value={formData.cuit}
                      onChange={(e) => handleInputChange('cuit', e.target.value)}
                      placeholder={exterior ? pais?.placeholder ?? 'ID fiscal' : '20-12345678-9'}
                      required={!exterior}
                      className="flex-1"
                    />
                    {!exterior && <Button
                      type="button"
                      variant="outline"
                      onClick={fetchAFIPData}
                      disabled={loadingAFIP || !formData.cuit}
                      className="whitespace-nowrap"
                    >
                      {loadingAFIP ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Consultando...
                        </>
                      ) : (
                        <>
                          <Search className="h-4 w-4 mr-2" />
                          Buscar en AFIP
                        </>
                      )}
                    </Button>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {exterior
                      ? 'Identificación fiscal del país del cliente, tal como figura en sus documentos.'
                      : <>Formato: XX-XXXXXXXX-X • Haz clic en &quot;Buscar en AFIP&quot; para autocompletar</>}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="taxCondition">
                    Condición fiscal <span className="text-red-500">*</span>
                  </Label>
                  <Select
                    value={formData.taxCondition}
                    onValueChange={handleSelectChange('taxCondition')}
                    disabled={exterior}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TAX_CONDITIONS.filter((tc) => exterior === (tc.value === 'CLIENTE_EXTERIOR')).map((tc) => (
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
                  <Label htmlFor="province">{exterior ? 'Provincia / Región / Departamento' : 'Provincia'}</Label>
                  {exterior ? (
                    <Input
                      id="province"
                      value={formData.province}
                      onChange={(e) => handleInputChange('province', e.target.value)}
                      placeholder="Ej: Región Metropolitana, Central"
                    />
                  ) : (
                  <Select
                    value={formData.province}
                    onValueChange={handleSelectChange('province')}
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
                  )}
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
                      onValueChange={handleSelectChange('creditCurrency')}
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
                    onValueChange={handleSelectChange('salesPersonId')}
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
                    onValueChange={handleSelectChange('status')}
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
