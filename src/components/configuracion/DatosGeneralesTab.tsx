'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2, Save, Upload } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

const PROVINCIAS_ARGENTINAS = [
  'CABA',
  'Buenos Aires',
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

interface DatosGeneralesTabProps {
  settings: Record<string, unknown>
  onUpdate: () => void
}

export function DatosGeneralesTab({ settings, onUpdate }: DatosGeneralesTabProps) {
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const s = settings as Record<string, string>
  const [formData, setFormData] = useState({
    name: s.name || '',
    legalName: s.legalName || '',
    address: s.address || '',
    city: s.city || '',
    province: s.province || 'CABA',
    postalCode: s.postalCode || '',
    country: s.country || 'Argentina',
    phone: s.phone || '',
    email: s.email || '',
    cbu: s.cbu || '',
    taxId: s.taxId || '',
    iibbNumber: s.iibbNumber || '',
    logoWidth: s.logoWidth || '',
    logoHeight: s.logoHeight || '',
  })

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleSave = async () => {
    try {
      setSaving(true)

      const response = await fetch('/api/configuracion', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      if (!response.ok) {
        throw new Error('Error al guardar')
      }

      toast({
        title: 'Configuración guardada',
        description: 'Los datos generales se guardaron correctamente',
      })

      onUpdate()
    } catch (_error) {
      toast({
        title: 'Error',
        description: 'No se pudieron guardar los cambios',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Datos generales</CardTitle>
          <CardDescription>
            Información básica de la empresa
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => handleChange('name', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="legalName">Razón social</Label>
              <Input
                id="legalName"
                value={formData.legalName}
                onChange={(e) => handleChange('legalName', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="address">Domicilio</Label>
              <Input
                id="address"
                value={formData.address}
                onChange={(e) => handleChange('address', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="city">Localidad</Label>
              <Input
                id="city"
                value={formData.city}
                onChange={(e) => handleChange('city', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="postalCode">Código Postal</Label>
              <Input
                id="postalCode"
                value={formData.postalCode}
                onChange={(e) => handleChange('postalCode', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="province">Provincia</Label>
              <Select
                value={formData.province}
                onValueChange={(value) => handleChange('province', value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVINCIAS_ARGENTINAS.map((provincia) => (
                    <SelectItem key={provincia} value={provincia}>
                      {provincia}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="country">País</Label>
              <Input
                id="country"
                value={formData.country}
                onChange={(e) => handleChange('country', e.target.value)}
                disabled
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Teléfono</Label>
              <Input
                id="phone"
                value={formData.phone}
                onChange={(e) => handleChange('phone', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => handleChange('email', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cbu">CBU</Label>
              <Input
                id="cbu"
                value={formData.cbu}
                onChange={(e) => handleChange('cbu', e.target.value)}
                placeholder="Opcional"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="taxId">CUIT</Label>
              <Input
                id="taxId"
                value={formData.taxId}
                onChange={(e) => handleChange('taxId', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="iibbNumber">Número IIBB</Label>
              <Input
                id="iibbNumber"
                value={formData.iibbNumber}
                onChange={(e) => handleChange('iibbNumber', e.target.value)}
                placeholder="Opcional"
              />
            </div>
          </div>

          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Guardando...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Guardar datos
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Logo</CardTitle>
          <CardDescription>
            Logo de la empresa para documentos y reportes
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            {(settings.logoUrl as string) && (
              <div className="border rounded p-4 bg-gray-50">
                <img
                  src={settings.logoUrl as string}
                  alt="Logo actual"
                  className="max-h-24 object-contain"
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="logoWidth">Ancho (en milímetros)</Label>
              <Input
                id="logoWidth"
                type="number"
                value={formData.logoWidth}
                onChange={(e) => handleChange('logoWidth', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="logoHeight">Altura (en milímetros)</Label>
              <Input
                id="logoHeight"
                type="number"
                value={formData.logoHeight}
                onChange={(e) => handleChange('logoHeight', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="logoFile">Archivo del Logo</Label>
              <Input
                id="logoFile"
                type="file"
                accept="image/*"
                disabled
              />
            </div>
          </div>

          <Button disabled>
            <Upload className="mr-2 h-4 w-4" />
            Guardar logo (Próximamente)
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
