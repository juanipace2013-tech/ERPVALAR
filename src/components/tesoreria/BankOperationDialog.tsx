'use client'

import { useState, useEffect } from 'react'
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

interface BankOperationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bankAccountId: string
  onSuccess: () => void
}

interface BankAccount {
  id: string
  name: string
  type: string
  balance: number
}

const OPERATION_TYPES = [
  { value: 'DEPOSIT', label: '💰 Depósito' },
  { value: 'WITHDRAWAL', label: '💸 Extracción' },
  { value: 'TRANSFER', label: '🔄 Transferencia entre cuentas' },
  { value: 'CHECK_CLEARING', label: '✅ Cobro de Cheque' },
]

export function BankOperationDialog({ open, onOpenChange, bankAccountId, onSuccess }: BankOperationDialogProps) {
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(false)

  const [formData, setFormData] = useState({
    operationType: 'DEPOSIT',
    amount: 0,
    description: '',
    checkNumber: '',
    destinationAccountId: '',
    date: new Date().toISOString().split('T')[0],
  })

  useEffect(() => {
    if (open) {
      loadAccounts()
      // Reset form
      setFormData({
        operationType: 'DEPOSIT',
        amount: 0,
        description: '',
        checkNumber: '',
        destinationAccountId: '',
        date: new Date().toISOString().split('T')[0],
      })
    }
  }, [open])

  const loadAccounts = async () => {
    try {
      setLoadingAccounts(true)
      const response = await fetch('/api/tesoreria/cuentas')
      if (response.ok) {
        const data = await response.json()
        // Filtrar la cuenta actual si es transferencia
        setAccounts(data.accounts || data)
      }
    } catch (error) {
      console.error('Error loading accounts:', error)
    } finally {
      setLoadingAccounts(false)
    }
  }

  const handleChange = (field: string, value: string | number | Date) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleSave = async () => {
    // Validaciones
    if (formData.amount <= 0) {
      toast({
        title: 'Error',
        description: 'El monto debe ser mayor a 0',
        variant: 'destructive',
      })
      return
    }

    if (formData.operationType === 'TRANSFER' && !formData.destinationAccountId) {
      toast({
        title: 'Error',
        description: 'Debe seleccionar una cuenta destino',
        variant: 'destructive',
      })
      return
    }

    if (formData.operationType === 'TRANSFER' && formData.destinationAccountId === bankAccountId) {
      toast({
        title: 'Error',
        description: 'La cuenta destino debe ser diferente a la cuenta origen',
        variant: 'destructive',
      })
      return
    }

    if (formData.operationType === 'CHECK_CLEARING' && !formData.checkNumber) {
      toast({
        title: 'Error',
        description: 'Debe ingresar el número de cheque',
        variant: 'destructive',
      })
      return
    }

    try {
      setSaving(true)

      const response = await fetch('/api/tesoreria/operaciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          bankAccountId,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error al registrar operación')
      }

      const operationLabels = {
        DEPOSIT: 'Depósito',
        WITHDRAWAL: 'Extracción',
        TRANSFER: 'Transferencia',
        CHECK_CLEARING: 'Cobro de cheque',
      }

      toast({
        title: 'Operación registrada',
        description: `${operationLabels[formData.operationType as keyof typeof operationLabels]} de $${formData.amount.toLocaleString('es-AR')} registrada correctamente`,
      })

      onSuccess()
      onOpenChange(false)
    } catch (error) {
      toast({
        title: 'Error',
        description: error.message || 'No se pudo registrar la operación',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const availableAccounts = accounts.filter(acc => acc.id !== bankAccountId)
  const selectedDestAccount = availableAccounts.find(a => a.id === formData.destinationAccountId)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>💳 Registrar Operación Bancaria</DialogTitle>
          <DialogDescription>
            Complete los datos de la operación
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Tipo de operación */}
          <div className="space-y-2">
            <Label htmlFor="operationType">Tipo de operación *</Label>
            <Select
              value={formData.operationType}
              onValueChange={(value) => handleChange('operationType', value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPERATION_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Fecha */}
            <div className="space-y-2">
              <Label htmlFor="date">Fecha *</Label>
              <Input
                id="date"
                type="date"
                value={formData.date}
                onChange={(e) => handleChange('date', e.target.value)}
              />
            </div>

            {/* Monto */}
            <div className="space-y-2">
              <Label htmlFor="amount">Monto *</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                value={formData.amount || ''}
                onChange={(e) => handleChange('amount', parseFloat(e.target.value) || 0)}
                placeholder="0.00"
              />
            </div>
          </div>

          {/* Cuenta destino (solo para transferencias) */}
          {formData.operationType === 'TRANSFER' && (
            <div className="space-y-2">
              <Label htmlFor="destinationAccount">Cuenta destino *</Label>
              <Select
                value={formData.destinationAccountId}
                onValueChange={(value) => handleChange('destinationAccountId', value)}
                disabled={loadingAccounts}
              >
                <SelectTrigger>
                  <SelectValue placeholder={loadingAccounts ? 'Cargando...' : 'Seleccionar cuenta'} />
                </SelectTrigger>
                <SelectContent>
                  {availableAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name}
                      <span className="text-xs text-gray-500 ml-2">
                        (Saldo: ${account.balance.toLocaleString('es-AR')})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Número de cheque (solo para cobro de cheques) */}
          {formData.operationType === 'CHECK_CLEARING' && (
            <div className="space-y-2">
              <Label htmlFor="checkNumber">Número de cheque *</Label>
              <Input
                id="checkNumber"
                value={formData.checkNumber}
                onChange={(e) => handleChange('checkNumber', e.target.value)}
                placeholder="12345678"
              />
            </div>
          )}

          {/* Descripción */}
          <div className="space-y-2">
            <Label htmlFor="description">Descripción / Concepto</Label>
            <Input
              id="description"
              value={formData.description}
              onChange={(e) => handleChange('description', e.target.value)}
              placeholder="Ej: Depósito en efectivo"
            />
          </div>

          {/* Resumen */}
          {formData.amount > 0 && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
              <h4 className="font-semibold text-purple-900 mb-2">Resumen de la operación</h4>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Tipo:</span>
                  <span className="font-semibold">
                    {OPERATION_TYPES.find(t => t.value === formData.operationType)?.label}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Monto:</span>
                  <span className="font-semibold text-lg text-purple-900">
                    ${formData.amount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                {formData.operationType === 'TRANSFER' && selectedDestAccount && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Cuenta destino:</span>
                    <span className="font-semibold">{selectedDestAccount.name}</span>
                  </div>
                )}
                {formData.operationType === 'CHECK_CLEARING' && formData.checkNumber && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Nro. Cheque:</span>
                    <span className="font-semibold">{formData.checkNumber}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Registrando...
              </>
            ) : (
              <>Registrar Operación</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
