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

interface BankAccount {
  id?: string
  name: string
  type: string
  bank: string | null
  accountNumber: string | null
  cbu: string | null
  alias: string | null
  currency: string
  balance: number
  currencyBalance: number | null
}

interface BankAccountDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  account?: BankAccount | null
  onSuccess: () => void
}

const ACCOUNT_TYPES = [
  { value: 'CASH', label: 'Caja' },
  { value: 'CHECKING_ACCOUNT', label: 'Cuenta Corriente' },
  { value: 'SAVINGS_ACCOUNT', label: 'Caja de Ahorro' },
  { value: 'CREDIT_CARD', label: 'Tarjeta de Crédito' },
  { value: 'FOREIGN_CURRENCY', label: 'Moneda Extranjera' },
]

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
  'Banco Hipotecario',
  'Banco Frances',
  'Banco Itau',
  'Otro',
]

const CURRENCIES = [
  { value: 'ARS', label: 'Pesos Argentinos (ARS)' },
  { value: 'USD', label: 'Dólares (USD)' },
  { value: 'EUR', label: 'Euros (EUR)' },
]

export function BankAccountDialog({ open, onOpenChange, account, onSuccess }: BankAccountDialogProps) {
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    type: 'CHECKING_ACCOUNT',
    bank: '',
    accountNumber: '',
    cbu: '',
    alias: '',
    currency: 'ARS',
    balance: 0,
    currencyBalance: null as number | null,
  })

  useEffect(() => {
    if (account) {
      setFormData({
        name: account.name || '',
        type: account.type || 'CHECKING_ACCOUNT',
        bank: account.bank || '',
        accountNumber: account.accountNumber || '',
        cbu: account.cbu || '',
        alias: account.alias || '',
        currency: account.currency || 'ARS',
        balance: account.balance || 0,
        currencyBalance: account.currencyBalance || null,
      })
    } else {
      setFormData({
        name: '',
        type: 'CHECKING_ACCOUNT',
        bank: '',
        accountNumber: '',
        cbu: '',
        alias: '',
        currency: 'ARS',
        balance: 0,
        currencyBalance: null,
      })
    }
  }, [account, open])

  const handleChange = (field: string, value: string | number | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleSave = async () => {
    // Validaciones
    if (!formData.name) {
      toast({
        title: 'Error',
        description: 'El nombre de la cuenta es obligatorio',
        variant: 'destructive',
      })
      return
    }

    if (formData.type !== 'CASH' && !formData.bank) {
      toast({
        title: 'Error',
        description: 'El banco es obligatorio',
        variant: 'destructive',
      })
      return
    }

    try {
      setSaving(true)

      const url = account?.id
        ? `/api/tesoreria/cuentas/${account.id}`
        : '/api/tesoreria/cuentas'

      const response = await fetch(url, {
        method: account?.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      if (!response.ok) {
        throw new Error('Error al guardar')
      }

      toast({
        title: account?.id ? 'Cuenta actualizada' : 'Cuenta creada',
        description: `La cuenta "${formData.name}" se ${account?.id ? 'actualizó' : 'creó'} correctamente`,
      })

      onSuccess()
      onOpenChange(false)
    } catch (_error) {
      toast({
        title: 'Error',
        description: 'No se pudo guardar la cuenta',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {account?.id ? 'Editar Cuenta Bancaria' : 'Nueva Cuenta Bancaria'}
          </DialogTitle>
          <DialogDescription>
            {account?.id
              ? 'Modifica los datos de la cuenta bancaria'
              : 'Completa los datos de la nueva cuenta bancaria'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Nombre */}
          <div className="space-y-2">
            <Label htmlFor="name">Nombre de la cuenta *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => handleChange('name', e.target.value)}
              placeholder="Ej: Cta Cte Galicia"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Tipo de cuenta */}
            <div className="space-y-2">
              <Label htmlFor="type">Tipo de cuenta *</Label>
              <Select
                value={formData.type}
                onValueChange={(value) => handleChange('type', value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACCOUNT_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Moneda */}
            <div className="space-y-2">
              <Label htmlFor="currency">Moneda *</Label>
              <Select
                value={formData.currency}
                onValueChange={(value) => handleChange('currency', value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((curr) => (
                    <SelectItem key={curr.value} value={curr.value}>
                      {curr.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Banco (no para Caja) */}
          {formData.type !== 'CASH' && (
            <div className="space-y-2">
              <Label htmlFor="bank">Banco *</Label>
              <Select
                value={formData.bank}
                onValueChange={(value) => handleChange('bank', value)}
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
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Número de cuenta */}
            <div className="space-y-2">
              <Label htmlFor="accountNumber">Número de cuenta</Label>
              <Input
                id="accountNumber"
                value={formData.accountNumber}
                onChange={(e) => handleChange('accountNumber', e.target.value)}
                placeholder="0000-0000-0000000000"
              />
            </div>

            {/* CBU */}
            <div className="space-y-2">
              <Label htmlFor="cbu">CBU</Label>
              <Input
                id="cbu"
                value={formData.cbu}
                onChange={(e) => handleChange('cbu', e.target.value)}
                placeholder="0000000000000000000000"
                maxLength={22}
              />
            </div>
          </div>

          {/* Alias */}
          <div className="space-y-2">
            <Label htmlFor="alias">Alias</Label>
            <Input
              id="alias"
              value={formData.alias}
              onChange={(e) => handleChange('alias', e.target.value)}
              placeholder="VALARG.GALICIA.CTACTE"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Saldo inicial */}
            <div className="space-y-2">
              <Label htmlFor="balance">Saldo inicial (ARS)</Label>
              <Input
                id="balance"
                type="number"
                step="0.01"
                value={formData.balance}
                onChange={(e) => handleChange('balance', parseFloat(e.target.value) || 0)}
              />
            </div>

            {/* Saldo en moneda extranjera */}
            {formData.currency !== 'ARS' && (
              <div className="space-y-2">
                <Label htmlFor="currencyBalance">
                  Saldo en {formData.currency}
                </Label>
                <Input
                  id="currencyBalance"
                  type="number"
                  step="0.01"
                  value={formData.currencyBalance || ''}
                  onChange={(e) =>
                    handleChange('currencyBalance', parseFloat(e.target.value) || null)
                  }
                />
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Guardando...
              </>
            ) : (
              <>Guardar</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
