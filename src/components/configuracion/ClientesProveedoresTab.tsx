'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Loader2, Save, Info } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

interface ClientesProveedoresTabProps {
  settings: Record<string, unknown>
  onUpdate: () => void
}

export function ClientesProveedoresTab({ settings, onUpdate }: ClientesProveedoresTabProps) {
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [formData, setFormData] = useState({
    // Clientes
    customerDefaultAccount: (settings.customerDefaultAccount as string) || '',
    customerAdvanceAccount: (settings.customerAdvanceAccount as string) || '',
    customerInterestAccount: (settings.customerInterestAccount as string) || '',
    customerDiscountAccount: (settings.customerDiscountAccount as string) || '',
    customerExchangeAccount: (settings.customerExchangeAccount as string) || '',

    // Proveedores
    supplierDefaultAccount: (settings.supplierDefaultAccount as string) || '',
    supplierAdvanceAccount: (settings.supplierAdvanceAccount as string) || '',
    supplierInterestAccount: (settings.supplierInterestAccount as string) || '',
    supplierDiscountAccount: (settings.supplierDiscountAccount as string) || '',
    supplierExchangeAccount: (settings.supplierExchangeAccount as string) || '',

    // Avisos de vencimiento
    invoiceReminder1Enabled: (settings.invoiceReminder1Enabled as boolean) ?? true,
    invoiceReminder1Days: (settings.invoiceReminder1Days as number) || 1,
    invoiceReminder1Before: (settings.invoiceReminder1Before as boolean) || false,

    invoiceReminder2Enabled: (settings.invoiceReminder2Enabled as boolean) ?? true,
    invoiceReminder2Days: (settings.invoiceReminder2Days as number) || 7,
    invoiceReminder2Before: (settings.invoiceReminder2Before as boolean) || false,

    invoiceReminder3Enabled: (settings.invoiceReminder3Enabled as boolean) ?? true,
    invoiceReminder3Days: (settings.invoiceReminder3Days as number) || 10,
    invoiceReminder3Before: (settings.invoiceReminder3Before as boolean) || false,

    // Envío automático
    autoSendReceipts: (settings.autoSendReceipts as boolean) ?? true,
    autoSendPaymentOrders: (settings.autoSendPaymentOrders as boolean) ?? false,
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
        description: 'La configuración de clientes y proveedores se guardó correctamente',
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Columna Izquierda: Clientes y Proveedores */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Clientes</CardTitle>
              <CardDescription>
                Cuentas contables para operaciones con clientes
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="customerDefaultAccount">Cuenta Crédito por Defecto</Label>
                <Input
                  id="customerDefaultAccount"
                  value={formData.customerDefaultAccount}
                  onChange={(e) => handleChange('customerDefaultAccount', e.target.value)}
                  placeholder="113100 - Deudores Por Ventas"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="customerAdvanceAccount">Anticipos de clientes</Label>
                <Input
                  id="customerAdvanceAccount"
                  value={formData.customerAdvanceAccount}
                  onChange={(e) => handleChange('customerAdvanceAccount', e.target.value)}
                  placeholder="Seleccionar cuenta"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="customerInterestAccount">Intereses por mora a Clientes</Label>
                <Input
                  id="customerInterestAccount"
                  value={formData.customerInterestAccount}
                  onChange={(e) => handleChange('customerInterestAccount', e.target.value)}
                  placeholder="541001 - Intereses"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="customerDiscountAccount">Descuentos a Clientes</Label>
                <Input
                  id="customerDiscountAccount"
                  value={formData.customerDiscountAccount}
                  onChange={(e) => handleChange('customerDiscountAccount', e.target.value)}
                  placeholder="541002 - Descuentos"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="customerExchangeAccount">Diferencias de Cambio</Label>
                <Input
                  id="customerExchangeAccount"
                  value={formData.customerExchangeAccount}
                  onChange={(e) => handleChange('customerExchangeAccount', e.target.value)}
                  placeholder="541004 - Diferencia de Cambio"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Proveedores</CardTitle>
              <CardDescription>
                Cuentas contables para operaciones con proveedores
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="supplierDefaultAccount">Cuenta proveedores por Defecto</Label>
                <Input
                  id="supplierDefaultAccount"
                  value={formData.supplierDefaultAccount}
                  onChange={(e) => handleChange('supplierDefaultAccount', e.target.value)}
                  placeholder="211100 - Proveedores en Cta Cte"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="supplierAdvanceAccount">Anticipo a Proveedores</Label>
                <Input
                  id="supplierAdvanceAccount"
                  value={formData.supplierAdvanceAccount}
                  onChange={(e) => handleChange('supplierAdvanceAccount', e.target.value)}
                  placeholder="115200 - Anticipos a Proveedores"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="supplierInterestAccount">Intereses a Proveedores</Label>
                <Input
                  id="supplierInterestAccount"
                  value={formData.supplierInterestAccount}
                  onChange={(e) => handleChange('supplierInterestAccount', e.target.value)}
                  placeholder="541001 - Intereses"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="supplierDiscountAccount">Descuentos Recibidos</Label>
                <Input
                  id="supplierDiscountAccount"
                  value={formData.supplierDiscountAccount}
                  onChange={(e) => handleChange('supplierDiscountAccount', e.target.value)}
                  placeholder="541002 - Descuentos"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="supplierExchangeAccount">Diferencia de Cambio Proveedores</Label>
                <Input
                  id="supplierExchangeAccount"
                  value={formData.supplierExchangeAccount}
                  onChange={(e) => handleChange('supplierExchangeAccount', e.target.value)}
                  placeholder="541004 - Diferencia de Cambio"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Columna Derecha: Avisos por email */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Avisos por email
                <Info className="h-4 w-4 text-gray-400" />
              </CardTitle>
              <CardDescription>
                Configuración de recordatorios automáticos
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <Label className="text-base font-semibold mb-4 block">
                  Aviso de vencimiento para Facturas de Venta
                </Label>

                {/* 1er Aviso */}
                <div className="space-y-3 p-4 border rounded-lg bg-gray-50">
                  <div className="flex items-center space-x-3">
                    <Checkbox
                      id="reminder1"
                      checked={formData.invoiceReminder1Enabled}
                      onCheckedChange={(checked) => handleChange('invoiceReminder1Enabled', checked)}
                    />
                    <Label htmlFor="reminder1" className="font-medium cursor-pointer">
                      1er. Aviso
                    </Label>
                  </div>
                  {formData.invoiceReminder1Enabled && (
                    <div className="flex items-center gap-3 ml-7">
                      <Input
                        type="number"
                        value={formData.invoiceReminder1Days}
                        onChange={(e) => handleChange('invoiceReminder1Days', parseInt(e.target.value))}
                        className="w-20"
                        min="1"
                      />
                      <span className="text-sm">Días</span>
                      <RadioGroup
                        value={formData.invoiceReminder1Before ? 'before' : 'after'}
                        onValueChange={(value) => handleChange('invoiceReminder1Before', value === 'before')}
                        className="flex items-center gap-4"
                      >
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="before" id="r1-before" />
                          <Label htmlFor="r1-before" className="cursor-pointer">Antes</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="after" id="r1-after" />
                          <Label htmlFor="r1-after" className="cursor-pointer">Después</Label>
                        </div>
                      </RadioGroup>
                      <span className="text-sm">del Vencimiento</span>
                    </div>
                  )}
                </div>

                {/* 2do Aviso */}
                <div className="space-y-3 p-4 border rounded-lg bg-gray-50 mt-3">
                  <div className="flex items-center space-x-3">
                    <Checkbox
                      id="reminder2"
                      checked={formData.invoiceReminder2Enabled}
                      onCheckedChange={(checked) => handleChange('invoiceReminder2Enabled', checked)}
                    />
                    <Label htmlFor="reminder2" className="font-medium cursor-pointer">
                      2do. Aviso
                    </Label>
                  </div>
                  {formData.invoiceReminder2Enabled && (
                    <div className="flex items-center gap-3 ml-7">
                      <Input
                        type="number"
                        value={formData.invoiceReminder2Days}
                        onChange={(e) => handleChange('invoiceReminder2Days', parseInt(e.target.value))}
                        className="w-20"
                        min="1"
                      />
                      <span className="text-sm">Días</span>
                      <RadioGroup
                        value={formData.invoiceReminder2Before ? 'before' : 'after'}
                        onValueChange={(value) => handleChange('invoiceReminder2Before', value === 'before')}
                        className="flex items-center gap-4"
                      >
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="before" id="r2-before" />
                          <Label htmlFor="r2-before" className="cursor-pointer">Antes</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="after" id="r2-after" />
                          <Label htmlFor="r2-after" className="cursor-pointer">Después</Label>
                        </div>
                      </RadioGroup>
                      <span className="text-sm">del Vencimiento</span>
                    </div>
                  )}
                </div>

                {/* 3er Aviso */}
                <div className="space-y-3 p-4 border rounded-lg bg-gray-50 mt-3">
                  <div className="flex items-center space-x-3">
                    <Checkbox
                      id="reminder3"
                      checked={formData.invoiceReminder3Enabled}
                      onCheckedChange={(checked) => handleChange('invoiceReminder3Enabled', checked)}
                    />
                    <Label htmlFor="reminder3" className="font-medium cursor-pointer">
                      3er. Aviso
                    </Label>
                  </div>
                  {formData.invoiceReminder3Enabled && (
                    <div className="flex items-center gap-3 ml-7">
                      <Input
                        type="number"
                        value={formData.invoiceReminder3Days}
                        onChange={(e) => handleChange('invoiceReminder3Days', parseInt(e.target.value))}
                        className="w-20"
                        min="1"
                      />
                      <span className="text-sm">Días</span>
                      <RadioGroup
                        value={formData.invoiceReminder3Before ? 'before' : 'after'}
                        onValueChange={(value) => handleChange('invoiceReminder3Before', value === 'before')}
                        className="flex items-center gap-4"
                      >
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="before" id="r3-before" />
                          <Label htmlFor="r3-before" className="cursor-pointer">Antes</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="after" id="r3-after" />
                          <Label htmlFor="r3-after" className="cursor-pointer">Después</Label>
                        </div>
                      </RadioGroup>
                      <span className="text-sm">del Vencimiento</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="border-t pt-6">
                <Label className="text-base font-semibold mb-4 block flex items-center gap-2">
                  Envío automático de recibos y pagos por email
                  <Info className="h-4 w-4 text-gray-400" />
                </Label>

                <div className="space-y-3">
                  <div className="flex items-center space-x-3">
                    <Checkbox
                      id="autoSendReceipts"
                      checked={formData.autoSendReceipts}
                      onCheckedChange={(checked) => handleChange('autoSendReceipts', checked)}
                    />
                    <Label htmlFor="autoSendReceipts" className="cursor-pointer">
                      Enviar recibos a mis clientes
                    </Label>
                  </div>

                  <div className="flex items-center space-x-3">
                    <Checkbox
                      id="autoSendPaymentOrders"
                      checked={formData.autoSendPaymentOrders}
                      onCheckedChange={(checked) => handleChange('autoSendPaymentOrders', checked)}
                    />
                    <Label htmlFor="autoSendPaymentOrders" className="cursor-pointer">
                      Enviar órdenes de pago a mis proveedores
                    </Label>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
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
