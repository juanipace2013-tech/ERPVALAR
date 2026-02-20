'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2, Save } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

interface DatosImpositivosTabProps {
  settings: Record<string, unknown>
  onUpdate: () => void
}

const TAX_CONDITIONS = [
  { value: 'RESPONSABLE_INSCRIPTO', label: 'Responsable Inscripto' },
  { value: 'MONOTRIBUTO', label: 'Monotributista' },
  { value: 'EXENTO', label: 'Exento' },
  { value: 'CONSUMIDOR_FINAL', label: 'Consumidor Final' },
]

export function DatosImpositivosTab({ settings, onUpdate }: DatosImpositivosTabProps) {
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [formData, setFormData] = useState({
    taxCondition: settings.taxCondition || 'RESPONSABLE_INSCRIPTO',
    fiscalDebitAccount: settings.fiscalDebitAccount || '',
    fiscalCreditAccount: settings.fiscalCreditAccount || '',

    isWithholdingAgent: settings.isWithholdingAgent || false,
    withholdingGananciasAccount: settings.withholdingGananciasAccount || '',
    withholdingIVA: settings.withholdingIVA || false,
    withholdingIVAAccount: settings.withholdingIVAAccount || '',
    withholdingIIBB: settings.withholdingIIBB || false,
    withholdingIIBBAccount: settings.withholdingIIBBAccount || '',
    withholdingARBA: settings.withholdingARBA || false,
    autoCalculateAGIP: settings.autoCalculateAGIP || false,

    retentionGananciasAccount: settings.retentionGananciasAccount || '',
    retentionIVAAccount: settings.retentionIVAAccount || '',
    retentionSUSSAccount: settings.retentionSUSSAccount || '',

    perceptionIVAAccount: settings.perceptionIVAAccount || '',
  })

  const handleChange = (field: string, value: string | number | boolean) => {
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
        description: 'Los datos impositivos se guardaron correctamente',
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
          <CardTitle>Configuración Fiscal</CardTitle>
          <CardDescription>
            Condición frente al IVA y cuentas fiscales
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="taxCondition">Condición IVA</Label>
            <Select
              value={formData.taxCondition}
              onValueChange={(value) => handleChange('taxCondition', value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TAX_CONDITIONS.map((condition) => (
                  <SelectItem key={condition.value} value={condition.value}>
                    {condition.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cuentas Fiscales</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="fiscalDebitAccount">Cuenta Débito Fiscal IVA</Label>
              <Input
                id="fiscalDebitAccount"
                value={formData.fiscalDebitAccount}
                onChange={(e) => handleChange('fiscalDebitAccount', e.target.value)}
                placeholder="214101 - IVA Débito Fiscal"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="fiscalCreditAccount">Cuenta Crédito Fiscal IVA</Label>
              <Input
                id="fiscalCreditAccount"
                value={formData.fiscalCreditAccount}
                onChange={(e) => handleChange('fiscalCreditAccount', e.target.value)}
                placeholder="114102 - IVA Crédito Fiscal"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Agente de Retención</CardTitle>
          <CardDescription>
            Configuración para empresas que actúan como agentes de retención
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-start space-x-3">
              <Checkbox
                id="isWithholdingAgent"
                checked={formData.isWithholdingAgent}
                onCheckedChange={(checked) => handleChange('isWithholdingAgent', checked)}
              />
              <div className="flex-1 space-y-2">
                <Label htmlFor="isWithholdingAgent" className="cursor-pointer">
                  Imp. a las Ganancias
                </Label>
                {formData.isWithholdingAgent && (
                  <div className="space-y-2">
                    <Input
                      value={formData.withholdingGananciasAccount}
                      onChange={(e) => handleChange('withholdingGananciasAccount', e.target.value)}
                      placeholder="Cuenta"
                    />
                    <Button variant="outline" size="sm">
                      Configurar Jurisdicciones
                    </Button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-start space-x-3">
              <Checkbox
                id="withholdingIVA"
                checked={formData.withholdingIVA}
                onCheckedChange={(checked) => handleChange('withholdingIVA', checked)}
              />
              <div className="flex-1 space-y-2">
                <Label htmlFor="withholdingIVA" className="cursor-pointer">
                  IVA
                </Label>
                {formData.withholdingIVA && (
                  <Input
                    value={formData.withholdingIVAAccount}
                    onChange={(e) => handleChange('withholdingIVAAccount', e.target.value)}
                    placeholder="Seleccionar cuenta"
                  />
                )}
              </div>
            </div>

            <div className="flex items-start space-x-3">
              <Checkbox
                id="withholdingIIBB"
                checked={formData.withholdingIIBB}
                onCheckedChange={(checked) => handleChange('withholdingIIBB', checked)}
              />
              <div className="flex-1 space-y-2">
                <Label htmlFor="withholdingIIBB" className="cursor-pointer">
                  IIBB
                </Label>
                {formData.withholdingIIBB && (
                  <Input
                    value={formData.withholdingIIBBAccount}
                    onChange={(e) => handleChange('withholdingIIBBAccount', e.target.value)}
                    placeholder="Seleccionar cuenta"
                  />
                )}
              </div>
            </div>

            <div className="flex items-center space-x-3">
              <Checkbox
                id="withholdingARBA"
                checked={formData.withholdingARBA}
                onCheckedChange={(checked) => handleChange('withholdingARBA', checked)}
              />
              <Label htmlFor="withholdingARBA" className="cursor-pointer">
                ARBA
              </Label>
            </div>

            <div className="flex items-center space-x-3">
              <Checkbox
                id="autoCalculateAGIP"
                checked={formData.autoCalculateAGIP}
                onCheckedChange={(checked) => handleChange('autoCalculateAGIP', checked)}
              />
              <Label htmlFor="autoCalculateAGIP" className="cursor-pointer">
                Calcular Automáticamente retenciones/percepciones AGIP
              </Label>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Retenciones Sufridas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="retentionGananciasAccount">Imp. a las Ganancias</Label>
              <Input
                id="retentionGananciasAccount"
                value={formData.retentionGananciasAccount}
                onChange={(e) => handleChange('retentionGananciasAccount', e.target.value)}
                placeholder="114101 - Ret Sufridas Imp Ganancias"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="retentionIVAAccount">IVA</Label>
              <Input
                id="retentionIVAAccount"
                value={formData.retentionIVAAccount}
                onChange={(e) => handleChange('retentionIVAAccount', e.target.value)}
                placeholder="114105 - IVA Retenciones"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="retentionSUSSAccount">SUSS</Label>
              <Input
                id="retentionSUSSAccount"
                value={formData.retentionSUSSAccount}
                onChange={(e) => handleChange('retentionSUSSAccount', e.target.value)}
                placeholder="213201 - Retenciones Sufridas SUSS"
              />
            </div>

            <Button variant="outline" size="sm">
              Configurar Jurisdicciones IIBB
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Percepciones Sufridas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="perceptionIVAAccount">IVA</Label>
              <Input
                id="perceptionIVAAccount"
                value={formData.perceptionIVAAccount}
                onChange={(e) => handleChange('perceptionIVAAccount', e.target.value)}
                placeholder="114106 - IVA Percepciones"
              />
            </div>

            <Button variant="outline" size="sm">
              Configurar Jurisdicciones IIBB
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-start">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Guardando...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Guardar
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
