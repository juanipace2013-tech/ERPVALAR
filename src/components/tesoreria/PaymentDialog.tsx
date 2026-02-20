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

interface PaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bankAccountId: string
  onSuccess: () => void
}

interface Supplier {
  id: string
  name: string
  balance: number
}

const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Efectivo' },
  { value: 'TRANSFER', label: 'Transferencia' },
  { value: 'CHECK', label: 'Cheque' },
  { value: 'CARD', label: 'Tarjeta' },
  { value: 'OTHER', label: 'Otro' },
]

export function PaymentDialog({ open, onOpenChange, bankAccountId, onSuccess }: PaymentDialogProps) {
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loadingSuppliers, setLoadingSuppliers] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  const [formData, setFormData] = useState({
    supplierId: '',
    paymentMethod: 'TRANSFER',
    amount: 0,
    description: '',
    checkNumber: '',
    date: new Date().toISOString().split('T')[0],
  })

  useEffect(() => {
    if (open) {
      loadSuppliers()
      // Reset form
      setFormData({
        supplierId: '',
        paymentMethod: 'TRANSFER',
        amount: 0,
        description: '',
        checkNumber: '',
        date: new Date().toISOString().split('T')[0],
      })
    }
  }, [open])

  const loadSuppliers = async () => {
    try {
      setLoadingSuppliers(true)
      const response = await fetch('/api/proveedores?status=ACTIVE')
      if (response.ok) {
        const data = await response.json()
        setSuppliers(data.suppliers || data)
      }
    } catch (error) {
      console.error('Error loading suppliers:', error)
    } finally {
      setLoadingSuppliers(false)
    }
  }

  const handleChange = (field: string, value: string | number | Date) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleSave = async () => {
    // Validaciones
    if (!formData.supplierId) {
      toast({
        title: 'Error',
        description: 'Debe seleccionar un proveedor',
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

    if (formData.paymentMethod === 'CHECK' && !formData.checkNumber) {
      toast({
        title: 'Error',
        description: 'Debe ingresar el número de cheque',
        variant: 'destructive',
      })
      return
    }

    try {
      setSaving(true)

      const response = await fetch('/api/tesoreria/pagos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          bankAccountId,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error al registrar pago')
      }

      const selectedSupplier = suppliers.find(s => s.id === formData.supplierId)

      toast({
        title: 'Pago registrado',
        description: `Pago de $${formData.amount.toLocaleString('es-AR')} a ${selectedSupplier?.name} registrado correctamente`,
      })

      onSuccess()
      onOpenChange(false)
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'No se pudo registrar el pago',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const filteredSuppliers = suppliers.filter(supplier =>
    supplier.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const selectedSupplier = suppliers.find(s => s.id === formData.supplierId)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>💰 Registrar Pago a Proveedor</DialogTitle>
          <DialogDescription>
            Complete los datos del pago a realizar
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Proveedor */}
          <div className="space-y-2">
            <Label htmlFor="supplier">Proveedor *</Label>
            <div className="flex gap-2">
              <div className="flex-1">
                <Select
                  value={formData.supplierId}
                  onValueChange={(value) => handleChange('supplierId', value)}
                  disabled={loadingSuppliers}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={loadingSuppliers ? 'Cargando...' : 'Seleccionar proveedor'} />
                  </SelectTrigger>
                  <SelectContent>
                    <div className="p-2">
                      <Input
                        placeholder="Buscar proveedor..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="mb-2"
                      />
                    </div>
                    {filteredSuppliers.map((supplier) => (
                      <SelectItem key={supplier.id} value={supplier.id}>
                        {supplier.name}
                        {supplier.balance > 0 && (
                          <span className="text-xs text-gray-500 ml-2">
                            (Saldo: ${supplier.balance.toLocaleString('es-AR')})
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {selectedSupplier && selectedSupplier.balance > 0 && (
              <p className="text-sm text-gray-600">
                Saldo pendiente: <span className="font-semibold">${selectedSupplier.balance.toLocaleString('es-AR')}</span>
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

            {/* Método de pago */}
            <div className="space-y-2">
              <Label htmlFor="paymentMethod">Método de pago *</Label>
              <Select
                value={formData.paymentMethod}
                onValueChange={(value) => handleChange('paymentMethod', value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((method) => (
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
              <Label htmlFor="amount">Monto a pagar *</Label>
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
            {formData.paymentMethod === 'CHECK' && (
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
              placeholder="Ej: Pago de factura 0001-00001234"
            />
          </div>

          {/* Resumen */}
          {formData.amount > 0 && selectedSupplier && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="font-semibold text-blue-900 mb-2">Resumen del pago</h4>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Proveedor:</span>
                  <span className="font-semibold">{selectedSupplier.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Monto:</span>
                  <span className="font-semibold text-lg text-blue-900">
                    ${formData.amount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Método:</span>
                  <span className="font-semibold">
                    {PAYMENT_METHODS.find(m => m.value === formData.paymentMethod)?.label}
                  </span>
                </div>
                {selectedSupplier.balance > 0 && (
                  <div className="flex justify-between pt-2 border-t border-blue-300">
                    <span className="text-gray-600">Nuevo saldo:</span>
                    <span className="font-semibold">
                      ${(selectedSupplier.balance - formData.amount).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
              <>Registrar Pago</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
