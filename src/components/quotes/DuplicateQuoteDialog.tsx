'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { ColppyCustomerSearch, type ColppyCustomer } from '@/components/ColppyCustomerSearch'
import { Loader2, Copy, Users } from 'lucide-react'

interface DuplicateQuoteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  quoteId: string
  customerName: string
  onDuplicated: (newQuoteId: string) => void
}

export function DuplicateQuoteDialog({
  open,
  onOpenChange,
  quoteId,
  customerName,
  onDuplicated,
}: DuplicateQuoteDialogProps) {
  const [mode, setMode] = useState<'same' | 'other'>('same')
  const [selectedCustomer, setSelectedCustomer] = useState<ColppyCustomer | null>(null)
  const [loading, setLoading] = useState(false)

  const handleDuplicate = async () => {
    if (mode === 'other' && !selectedCustomer) return

    try {
      setLoading(true)

      const body: Record<string, unknown> = {}
      if (mode === 'other' && selectedCustomer) {
        body.colppyCustomer = selectedCustomer
      }

      const response = await fetch(`/api/quotes/${quoteId}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        throw new Error('Error al duplicar cotización')
      }

      const data = await response.json()
      onDuplicated(data.id)
    } catch (error) {
      console.error('Error:', error)
      throw error
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    if (!loading) {
      setMode('same')
      setSelectedCustomer(null)
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="h-5 w-5 text-blue-600" />
            Duplicar Cotización
          </DialogTitle>
          <DialogDescription>
            Se copiarán todos los items, adicionales y precios.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <RadioGroup
            value={mode}
            onValueChange={(v) => {
              setMode(v as 'same' | 'other')
              if (v === 'same') setSelectedCustomer(null)
            }}
            className="space-y-3"
          >
            <div
              className={`flex items-center space-x-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                mode === 'same' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
              }`}
              onClick={() => { setMode('same'); setSelectedCustomer(null) }}
            >
              <RadioGroupItem value="same" id="same" />
              <Label htmlFor="same" className="flex-1 cursor-pointer">
                <div className="font-medium">Mismo cliente</div>
                <div className="text-sm text-muted-foreground">{customerName}</div>
              </Label>
            </div>

            <div
              className={`flex items-start space-x-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                mode === 'other' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
              }`}
              onClick={() => setMode('other')}
            >
              <RadioGroupItem value="other" id="other" className="mt-1" />
              <Label htmlFor="other" className="flex-1 cursor-pointer">
                <div className="font-medium flex items-center gap-1.5">
                  <Users className="h-4 w-4" />
                  Otro cliente
                </div>
                <div className="text-sm text-muted-foreground">Buscar por nombre o CUIT</div>
              </Label>
            </div>
          </RadioGroup>

          {mode === 'other' && (
            <div className="pt-1">
              <ColppyCustomerSearch
                value={selectedCustomer}
                onChange={setSelectedCustomer}
                placeholder="Buscar cliente por nombre o CUIT..."
                disabled={loading}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            Cancelar
          </Button>
          <Button
            onClick={handleDuplicate}
            disabled={loading || (mode === 'other' && !selectedCustomer)}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Duplicando...
              </>
            ) : (
              <>
                <Copy className="mr-2 h-4 w-4" />
                Duplicar
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
