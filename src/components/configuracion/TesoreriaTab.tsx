'use client'

import { useState, useEffect } from 'react'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Loader2, Save, Plus, Building2, Trash2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

interface Chequera {
  id: string
  bankName: string
  accountNumber: string
  checkFrom: number
  checkTo: number
  currentCheck: number
  checks: Check[]
}

interface Check {
  id: string
  checkNumber: string
  paymentDate: string
  type: string
  amount: number
  status: string
}

const BANCOS_ARGENTINA = [
  'Banco Nación',
  'Banco Provincia',
  'Banco Ciudad',
  'Banco Galicia',
  'Banco Santander',
  'Banco BBVA',
  'Banco Macro',
  'Banco Patagonia',
  'Banco Supervielle',
  'ICBC',
  'HSBC',
  'Banco Credicoop',
  'Otro',
]

interface TesoreriaTabProps {
  settings: Record<string, unknown>
  onUpdate: () => void
}

export function TesoreriaTab({ settings, onUpdate }: TesoreriaTabProps) {
  const { toast } = useToast()
  const [chequeras, setChequeras] = useState<Chequera[]>([])
  const [selectedChequera, setSelectedChequera] = useState<Chequera | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)

  const [configData, setConfigData] = useState({
    valuesToDepositAccount: settings.valuesToDepositAccount || '',
    deferredChecksAccount: settings.deferredChecksAccount || '',
  })

  const [newChequera, setNewChequera] = useState({
    bankName: '',
    accountNumber: '',
    checkFrom: 1,
    checkTo: 100,
    currentCheck: 1,
  })

  useEffect(() => {
    loadChequeras()
  }, [])

  const loadChequeras = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/configuracion/chequeras')
      if (response.ok) {
        const data = await response.json()
        setChequeras(data)
        if (data.length > 0 && !selectedChequera) {
          setSelectedChequera(data[0])
        }
      }
    } catch (_error) {
      console.error('Error loading chequeras:', error)
      toast({
        title: 'Error',
        description: 'No se pudieron cargar las chequeras',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const handleSaveConfig = async () => {
    try {
      setSaving(true)

      const response = await fetch('/api/configuracion', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configData),
      })

      if (!response.ok) {
        throw new Error('Error al guardar')
      }

      toast({
        title: 'Configuración guardada',
        description: 'La configuración de tesorería se guardó correctamente',
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

  const handleAddChequera = async () => {
    try {
      const response = await fetch('/api/configuracion/chequeras', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newChequera),
      })

      if (!response.ok) {
        throw new Error('Error al crear chequera')
      }

      toast({
        title: 'Chequera agregada',
        description: `La chequera de ${newChequera.bankName} se agregó correctamente`,
      })

      setDialogOpen(false)
      setNewChequera({
        bankName: '',
        accountNumber: '',
        checkFrom: 1,
        checkTo: 100,
        currentCheck: 1,
      })
      await loadChequeras()
    } catch (_error) {
      toast({
        title: 'Error',
        description: 'No se pudo agregar la chequera',
        variant: 'destructive',
      })
    }
  }

  const handleDeleteChequera = async (id: string) => {
    if (!confirm('¿Está seguro de eliminar esta chequera?')) return

    try {
      const response = await fetch(`/api/configuracion/chequeras/${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Error al eliminar')
      }

      toast({
        title: 'Chequera eliminada',
        description: 'La chequera se eliminó correctamente',
      })

      await loadChequeras()
      setSelectedChequera(null)
    } catch (_error) {
      toast({
        title: 'Error',
        description: 'No se pudo eliminar la chequera',
        variant: 'destructive',
      })
    }
  }

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
    }).format(amount)
  }

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('es-AR')
  }

  const getCheckTypeLabel = (type: string) => {
    const types: Record<string, string> = {
      COMMON: 'Común',
      DEFERRED: 'Diferido',
      THIRD_PARTY: 'Terceros',
    }
    return types[type] || type
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
      {/* Configuración General */}
      <Card>
        <CardHeader>
          <CardTitle>Configuración</CardTitle>
          <CardDescription>
            Cuentas contables para operaciones de tesorería
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="valuesToDepositAccount">Valores A Depositar</Label>
              <Input
                id="valuesToDepositAccount"
                value={configData.valuesToDepositAccount}
                onChange={(e) => setConfigData(prev => ({
                  ...prev,
                  valuesToDepositAccount: e.target.value
                }))}
                placeholder="Cuenta"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="deferredChecksAccount">Cheques Emitidos Diferidos</Label>
              <Input
                id="deferredChecksAccount"
                value={configData.deferredChecksAccount}
                onChange={(e) => setConfigData(prev => ({
                  ...prev,
                  deferredChecksAccount: e.target.value
                }))}
                placeholder="Cheques Diferidos no debitados"
              />
            </div>
          </div>

          <Button onClick={handleSaveConfig} disabled={saving}>
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
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Columna Izquierda: Chequeras */}
        <Card>
          <CardHeader>
            <CardTitle>Chequeras</CardTitle>
            <CardDescription>
              {chequeras.length} chequera{chequeras.length !== 1 ? 's' : ''} configurada{chequeras.length !== 1 ? 's' : ''}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {chequeras.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No hay chequeras configuradas
              </div>
            ) : (
              <div className="space-y-2">
                {chequeras.map((chequera) => (
                  <div
                    key={chequera.id}
                    className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                      selectedChequera?.id === chequera.id
                        ? 'bg-blue-50 border-blue-300'
                        : 'hover:bg-gray-50'
                    }`}
                    onClick={() => setSelectedChequera(chequera)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3 flex-1">
                        <Building2 className="h-5 w-5 text-blue-600 mt-1" />
                        <div className="flex-1">
                          <div className="font-semibold">{chequera.bankName}</div>
                          <div className="text-sm text-gray-600">
                            Cuenta: {chequera.accountNumber}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            Cheques {chequera.checkFrom} - {chequera.checkTo}
                            {' '}(Actual: {chequera.currentCheck})
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteChequera(chequera.id)
                        }}
                        className="p-2 hover:bg-red-100 rounded"
                      >
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button className="w-full" variant="outline">
                  <Building2 className="mr-2 h-4 w-4" />
                  Agregar chequera
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Nueva Chequera</DialogTitle>
                  <DialogDescription>
                    Configure los datos de la nueva chequera
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="bankName">Banco</Label>
                    <Select
                      value={newChequera.bankName}
                      onValueChange={(value) => setNewChequera(prev => ({
                        ...prev,
                        bankName: value
                      }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccionar banco" />
                      </SelectTrigger>
                      <SelectContent>
                        {BANCOS_ARGENTINA.map((banco) => (
                          <SelectItem key={banco} value={banco}>
                            {banco}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="accountNumber">Número de Cuenta</Label>
                    <Input
                      id="accountNumber"
                      value={newChequera.accountNumber}
                      onChange={(e) => setNewChequera(prev => ({
                        ...prev,
                        accountNumber: e.target.value
                      }))}
                      placeholder="0000000000000000000000"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="checkFrom">Cheque Desde</Label>
                      <Input
                        id="checkFrom"
                        type="number"
                        value={newChequera.checkFrom}
                        onChange={(e) => setNewChequera(prev => ({
                          ...prev,
                          checkFrom: parseInt(e.target.value)
                        }))}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="checkTo">Cheque Hasta</Label>
                      <Input
                        id="checkTo"
                        type="number"
                        value={newChequera.checkTo}
                        onChange={(e) => setNewChequera(prev => ({
                          ...prev,
                          checkTo: parseInt(e.target.value)
                        }))}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="currentCheck">Actual</Label>
                      <Input
                        id="currentCheck"
                        type="number"
                        value={newChequera.currentCheck}
                        onChange={(e) => setNewChequera(prev => ({
                          ...prev,
                          currentCheck: parseInt(e.target.value)
                        }))}
                      />
                    </div>
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setDialogOpen(false)}>
                    Cancelar
                  </Button>
                  <Button onClick={handleAddChequera}>
                    <Plus className="mr-2 h-4 w-4" />
                    Agregar
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>

        {/* Columna Derecha: Cheques */}
        <Card>
          <CardHeader>
            <CardTitle>Cheques</CardTitle>
            <CardDescription>
              {selectedChequera
                ? `Cheques de ${selectedChequera.bankName}`
                : 'Seleccione una chequera para ver sus cheques'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {selectedChequera ? (
              <>
                {selectedChequera.checks && selectedChequera.checks.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">A</TableHead>
                        <TableHead>Nro. Cheque</TableHead>
                        <TableHead>Fecha pago</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead className="text-right">Importe</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedChequera.checks.map((check) => (
                        <TableRow key={check.id}>
                          <TableCell>
                            <input
                              type="checkbox"
                              checked={check.status === 'CLEARED'}
                              readOnly
                              className="cursor-pointer"
                            />
                          </TableCell>
                          <TableCell>{check.checkNumber}</TableCell>
                          <TableCell>{formatDate(check.paymentDate)}</TableCell>
                          <TableCell>{getCheckTypeLabel(check.type)}</TableCell>
                          <TableCell className="text-right">{formatAmount(check.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    No hay cheques emitidos con esta chequera
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-8 text-gray-500">
                Seleccione una chequera de la lista
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
