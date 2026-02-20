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

interface ReceiptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bankAccountId: string
  onSuccess: () => void
}

interface Customer {
  id: string
  name: string
  balance: number
}

const COLLECTION_METHODS = [
  { value: 'CASH', label: 'Efectivo' },
  { value: 'TRANSFER', label: 'Transferencia' },
  { value: 'CHECK', label: 'Cheque' },
  { value: 'CARD', label: 'Tarjeta' },
  { value: 'OTHER', label: 'Otro' },
]

export function ReceiptDialog({ open, onOpenChange, bankAccountId, onSuccess }: ReceiptDialogProps) {
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loadingCustomers, setLoadingCustomers] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  const [formData, setFormData] = useState({
    customerId: '',
    collectionMethod: 'TRANSFER',
    amount: 0,
    description: '',
    checkNumber: '',
    date: new Date().toISOString().split('T')[0],
  })

  useEffect(() => {
    if (open) {
      loadCustomers()
      // Reset form
      setFormData({
        customerId: '',
        collectionMethod: 'TRANSFER',
        amount: 0,
        description: '',
        checkNumber: '',
        date: new Date().toISOString().split('T')[0],
      })
    }
  }, [open])

  const loadCustomers = async () => {
    try {
      setLoadingCustomers(true)
      const response = await fetch('/api/clientes?status=ACTIVE')
      if (response.ok) {
        const data = await response.json()
        setCustomers(data.customers || data)
      }
    } catch (error) {
      console.error('Error loading customers:', error)
    } finally {
      setLoadingCustomers(false)
    }
  }

  const handleChange = (field: string, value: string | number | Date) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleSave = async () => {
    // Validaciones
    if (!formData.customerId) {
      toast({
        title: 'Error',
        description: 'Debe seleccionar un cliente',
        variant: 'destructive',
      })
      return
    }

    if (formData.amount <= 0) {
      toast({
        title: 'Error',
        description: 'El monto debe ser mayor a 0',
        variant: 'destructive',
      })
      return
    }

    if (formData.collectionMethod === 'CHECK' && !formData.checkNumber) {
      toast({
        title: 'Error',
        description: 'Debe ingresar el número de cheque',
        variant: 'destructive',
      })
      return
    }

    try {
      setSaving(true)

      const response = await fetch('/api/tesoreria/cobranzas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          bankAccountId,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error al registrar cobranza')
      }

      const selectedCustomer = customers.find(c => c.id === formData.customerId)

      toast({
        title: 'Cobranza registrada',
        description: `Cobranza de $${formData.amount.toLocaleString('es-AR')} de ${selectedCustomer?.name} registrada correctamente`,
      })

      onSuccess()
      onOpenChange(false)
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'No se pudo registrar la cobranza',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const filteredCustomers = customers.filter(customer =>
    customer.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const selectedCustomer = customers.find(c => c.id === formData.customerId)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>💵 Registrar Cobranza de Cliente</DialogTitle>
          <DialogDescription>
            Complete los datos de la cobranza recibida
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Cliente */}
          <div className="space-y-2">
            <Label htmlFor="customer">Cliente *</Label>
            <div className="flex gap-2">
              <div className="flex-1">
                <Select
                  value={formData.customerId}
                  onValueChange={(value) => handleChange('customerId', value)}
                  disabled={loadingCustomers}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={loadingCustomers ? 'Cargando...' : 'Seleccionar cliente'} />
                  </SelectTrigger>
                  <SelectContent>
                    <div className="p-2">
                      <Input
                        placeholder="Buscar cliente..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="mb-2"
                      />
                    </div>
                    {filteredCustomers.map((customer) => (
                      <SelectItem key={customer.id} value={customer.id}>
                        {customer.name}
                        {customer.balance > 0 && (
                          <span className="text-xs text-gray-500 ml-2">
                            (Saldo: ${customer.balance.toLocaleString('es-AR')})
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {selectedCustomer && selectedCustomer.balance > 0 && (
              <p className="text-sm text-gray-600">
                Saldo a favor del cliente: <span className="font-semibold">${selectedCustomer.balance.toLocaleString('es-AR')}</span>
              </p>
            )}
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

            {/* Método de cobro */}
            <div className="space-y-2">
              <Label htmlFor="collectionMethod">Método de cobro *</Label>
              <Select
                value={formData.collectionMethod}
                onValueChange={(value) => handleChange('collectionMethod', value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COLLECTION_METHODS.map((method) => (
                    <SelectItem key={method.value} value={method.value}>
                      {method.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Monto */}
            <div className="space-y-2">
              <Label htmlFor="amount">Monto cobrado *</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                value={formData.amount || ''}
                onChange={(e) => handleChange('amount', parseFloat(e.target.value) || 0)}
                placeholder="0.00"
              />
            </div>

            {/* Número de cheque (si aplica) */}
            {formData.collectionMethod === 'CHECK' && (
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
          </div>

          {/* Descripción */}
          <div className="space-y-2">
            <Label htmlFor="description">Descripción / Concepto</Label>
            <Input
              id="description"
              value={formData.description}
              onChange={(e) => handleChange('description', e.target.value)}
              placeholder="Ej: Cobro de factura 0001-00000563"
            />
          </div>

          {/* Resumen */}
          {formData.amount > 0 && selectedCustomer && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <h4 className="font-semibold text-green-900 mb-2">Resumen de la cobranza</h4>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Cliente:</span>
                  <span className="font-semibold">{selectedCustomer.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Monto:</span>
                  <span className="font-semibold text-lg text-green-900">
                    ${formData.amount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Método:</span>
                  <span className="font-semibold">
                    {COLLECTION_METHODS.find(m => m.value === formData.collectionMethod)?.label}
                  </span>
                </div>
                {selectedCustomer.balance > 0 && (
                  <div className="flex justify-between pt-2 border-t border-green-300">
                    <span className="text-gray-600">Nuevo saldo:</span>
                    <span className="font-semibold">
                      ${(selectedCustomer.balance - formData.amount).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
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
              <>Registrar Cobranza</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
