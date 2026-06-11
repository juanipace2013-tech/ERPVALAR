'use client'

import { useState, useEffect } from 'react'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Loader2, Save, Plus, X, Info } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

interface Talonario {
  id: string
  description: string
  prefix: string
  numberFrom: number
  numberTo: number
  currentNumber: number
  isDefault: boolean
  numberingMethod: string
  isSaleInvoice: boolean
  isDebitNote: boolean
  isCreditNote: boolean
  isPaymentOrder: boolean
  isReceipt: boolean
  isRemittance: boolean
  isElectronic: boolean
  voucherType: string | null
}

export function TalonariosTab() {
  const { toast } = useToast()
  const [talonarios, setTalonarios] = useState<Talonario[]>([])
  const [selectedTalonario, setSelectedTalonario] = useState<Talonario | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [isNew, setIsNew] = useState(false)

  useEffect(() => {
    loadTalonarios()
  }, [])

  const loadTalonarios = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/configuracion/talonarios')
      if (response.ok) {
        const data = await response.json()
        setTalonarios(data)
        if (data.length > 0 && !selectedTalonario) {
          setSelectedTalonario(data[0])
        }
      }
    } catch (error) {
      console.error('Error loading talonarios:', error)
      toast({
        title: 'Error',
        description: 'No se pudieron cargar los talonarios',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!selectedTalonario) return

    try {
      setSaving(true)

      const url = isNew
        ? '/api/configuracion/talonarios'
        : `/api/configuracion/talonarios/${selectedTalonario.id}`

      const response = await fetch(url, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selectedTalonario),
      })

      if (!response.ok) {
        throw new Error('Error al guardar')
      }

      toast({
        title: 'Talonario guardado',
        description: `El talonario "${selectedTalonario.description}" se guardó correctamente`,
      })

      setIsNew(false)
      await loadTalonarios()
    } catch (_error) {
      toast({
        title: 'Error',
        description: 'No se pudo guardar el talonario',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('¿Está seguro de eliminar este talonario?')) return

    try {
      const response = await fetch(`/api/configuracion/talonarios/${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Error al eliminar')
      }

      toast({
        title: 'Talonario eliminado',
        description: 'El talonario se eliminó correctamente',
      })

      await loadTalonarios()
      setSelectedTalonario(null)
    } catch (_error) {
      toast({
        title: 'Error',
        description: 'No se pudo eliminar el talonario',
        variant: 'destructive',
      })
    }
  }

  const handleNewTalonario = () => {
    const newTalonario: Talonario = {
      id: '',
      description: '',
      prefix: '0001',
      numberFrom: 1,
      numberTo: 99999999,
      currentNumber: 1,
      isDefault: false,
      numberingMethod: 'AUTOMATIC',
      isSaleInvoice: false,
      isDebitNote: false,
      isCreditNote: false,
      isPaymentOrder: false,
      isReceipt: false,
      isRemittance: false,
      isElectronic: false,
      voucherType: null,
    }
    setSelectedTalonario(newTalonario)
    setIsNew(true)
  }

  const handleFieldChange = (field: keyof Talonario, value: string | number | boolean) => {
    if (!selectedTalonario) return
    setSelectedTalonario({
      ...selectedTalonario,
      [field]: value,
    })
  }

  const formatNumber = (num: number) => {
    return num.toString().padStart(8, '0')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Columna Izquierda: Lista de Talonarios */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Lista de Talonarios</CardTitle>
            <CardDescription>
              {talonarios.length} talonario{talonarios.length !== 1 ? 's' : ''} configurado{talonarios.length !== 1 ? 's' : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {talonarios.map((talonario) => (
                <div
                  key={talonario.id}
                  className={`flex items-center justify-between p-3 border rounded-lg cursor-pointer transition-colors ${
                    selectedTalonario?.id === talonario.id
                      ? 'bg-blue-50 border-blue-300'
                      : 'hover:bg-gray-50'
                  }`}
                  onClick={() => {
                    setSelectedTalonario(talonario)
                    setIsNew(false)
                  }}
                >
                  <div className="flex-1">
                    <div className="font-medium text-sm">{talonario.description}</div>
                    <div className="text-xs text-gray-500">
                      {talonario.prefix} - {formatNumber(talonario.currentNumber)}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(talonario.id)
                    }}
                    className="p-1 hover:bg-red-100 rounded"
                  >
                    <X className="h-4 w-4 text-red-600" />
                  </button>
                </div>
              ))}
            </div>

            <Button
              onClick={handleNewTalonario}
              className="w-full mt-4"
              variant="outline"
            >
              <Plus className="mr-2 h-4 w-4" />
              Nuevo talonario
            </Button>
          </CardContent>
        </Card>

        {/* Columna Derecha: Formulario de Edición */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>
              {isNew ? 'Nuevo Talonario' : 'Editar Talonario'}
            </CardTitle>
            <CardDescription>
              {selectedTalonario ? 'Configure los datos del talonario' : 'Seleccione un talonario para editar'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {selectedTalonario ? (
              <Tabs defaultValue="datos" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="datos">Datos talonario</TabsTrigger>
                  <TabsTrigger value="punto-venta" disabled>
                    Asociar a punto de venta
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="datos" className="space-y-4 mt-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="description">Descripción Talonario</Label>
                      <Input
                        id="description"
                        value={selectedTalonario.description}
                        onChange={(e) => handleFieldChange('description', e.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="prefix">Prefijo (4 dígitos)</Label>
                      <Input
                        id="prefix"
                        value={selectedTalonario.prefix}
                        onChange={(e) => handleFieldChange('prefix', e.target.value)}
                        maxLength={4}
                        placeholder="0001"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="numberingMethod">Método de Numeración</Label>
                      <Select
                        value={selectedTalonario.numberingMethod}
                        onValueChange={(value) => handleFieldChange('numberingMethod', value)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="AUTOMATIC">Automático</SelectItem>
                          <SelectItem value="MANUAL">Manual</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="numberFrom">Número Desde</Label>
                      <Input
                        id="numberFrom"
                        type="number"
                        value={selectedTalonario.numberFrom}
                        onChange={(e) => handleFieldChange('numberFrom', parseInt(e.target.value))}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="numberTo">Número Hasta</Label>
                      <Input
                        id="numberTo"
                        type="number"
                        value={selectedTalonario.numberTo}
                        onChange={(e) => handleFieldChange('numberTo', parseInt(e.target.value))}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="currentNumber">Próximo Número</Label>
                      <Input
                        id="currentNumber"
                        type="number"
                        value={selectedTalonario.currentNumber}
                        onChange={(e) => handleFieldChange('currentNumber', parseInt(e.target.value))}
                      />
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 pt-2">
                    <Checkbox
                      id="isDefault"
                      checked={selectedTalonario.isDefault}
                      onCheckedChange={(checked) => handleFieldChange('isDefault', checked)}
                    />
                    <Label htmlFor="isDefault" className="cursor-pointer flex items-center gap-1">
                      Talonario por defecto
                      <Info className="h-3 w-3 text-gray-400" />
                    </Label>
                  </div>

                  <div className="border-t pt-4 mt-4">
                    <Label className="text-base font-semibold mb-3 block">
                      Tipos de comprobante
                    </Label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="isSaleInvoice"
                          checked={selectedTalonario.isSaleInvoice}
                          onCheckedChange={(checked) => handleFieldChange('isSaleInvoice', checked)}
                        />
                        <Label htmlFor="isSaleInvoice" className="cursor-pointer">
                          Factura de Venta
                        </Label>
                      </div>

                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="isDebitNote"
                          checked={selectedTalonario.isDebitNote}
                          onCheckedChange={(checked) => handleFieldChange('isDebitNote', checked)}
                        />
                        <Label htmlFor="isDebitNote" className="cursor-pointer">
                          Nota de Débito
                        </Label>
                      </div>

                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="isCreditNote"
                          checked={selectedTalonario.isCreditNote}
                          onCheckedChange={(checked) => handleFieldChange('isCreditNote', checked)}
                        />
                        <Label htmlFor="isCreditNote" className="cursor-pointer">
                          Nota de Crédito
                        </Label>
                      </div>

                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="isPaymentOrder"
                          checked={selectedTalonario.isPaymentOrder}
                          onCheckedChange={(checked) => handleFieldChange('isPaymentOrder', checked)}
                        />
                        <Label htmlFor="isPaymentOrder" className="cursor-pointer">
                          Orden de Pago
                        </Label>
                      </div>

                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="isReceipt"
                          checked={selectedTalonario.isReceipt}
                          onCheckedChange={(checked) => handleFieldChange('isReceipt', checked)}
                        />
                        <Label htmlFor="isReceipt" className="cursor-pointer">
                          Recibo
                        </Label>
                      </div>

                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="isRemittance"
                          checked={selectedTalonario.isRemittance}
                          onCheckedChange={(checked) => handleFieldChange('isRemittance', checked)}
                        />
                        <Label htmlFor="isRemittance" className="cursor-pointer">
                          Remito
                        </Label>
                      </div>

                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="isElectronic"
                          checked={selectedTalonario.isElectronic}
                          onCheckedChange={(checked) => handleFieldChange('isElectronic', checked)}
                        />
                        <Label htmlFor="isElectronic" className="cursor-pointer">
                          Factura Electrónica
                        </Label>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-4">
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
                    <Button variant="outline" disabled>
                      Datos Adicionales
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="punto-venta">
                  <div className="text-center py-8 text-gray-500">
                    Funcionalidad disponible próximamente
                  </div>
                </TabsContent>
              </Tabs>
            ) : (
              <div className="text-center py-12 text-gray-500">
                Seleccione un talonario de la lista o cree uno nuevo
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tabla de Documentos del Talonario */}
      <Card>
        <CardHeader>
          <CardTitle>Documentos del Talonario</CardTitle>
          <CardDescription>
            Documentos emitidos con este talonario
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Número</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell colSpan={5} className="text-center text-gray-500 py-8">
                  No hay documentos para mostrar
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <div className="flex items-center justify-between mt-4 text-sm text-gray-600">
            <div>Mostrando 1 - {talonarios.length} de {talonarios.length}</div>
            <div>Página 1 de 1</div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
