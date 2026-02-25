'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Loader2, Send, Mail } from 'lucide-react'
import { toast } from 'sonner'

interface SendQuoteDialogProps {
  quote: {
    id: string
    quoteNumber: string
    customer: {
      name: string
      email: string | null
    }
    total: number
    currency: string
  }
  open: boolean
  onOpenChange: (open: boolean) => void
  onSent?: () => void
}

export function SendQuoteDialog({
  quote,
  open,
  onOpenChange,
  onSent
}: SendQuoteDialogProps) {
  const [email, setEmail] = useState(quote.customer.email || '')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)

  const formatCurrency = (amount: number) => {
    const symbol = quote.currency === 'USD' ? 'USD' : 'ARS'
    return `${symbol} ${amount.toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`
  }

  async function handleSend() {
    // Validar email
    if (!email || !email.trim()) {
      toast.error('Debe ingresar un email')
      return
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      toast.error('Email inválido')
      return
    }

    setSending(true)

    try {
      // Enviar email
      const response = await fetch(`/api/quotes/${quote.id}/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          message: message.trim() || undefined
        })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error al enviar email')
      }

      const result = await response.json()

      toast.success('Email enviado exitosamente')
      console.log('Email enviado:', result)

      // Cerrar diálogo y notificar
      onOpenChange(false)
      onSent?.()

      // Limpiar campos
      setMessage('')
    } catch (error) {
      console.error('Error enviando email:', error)
      toast.error(error instanceof Error ? error.message : 'Error al enviar email')
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-blue-600" />
            Enviar Cotización por Email
          </DialogTitle>
          <DialogDescription>
            La cotización {quote.quoteNumber} será enviada al cliente con un link para ver y responder.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Resumen de cotización */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-800">
              <strong>Cliente:</strong> {quote.customer.name}
            </p>
            <p className="text-sm text-blue-800">
              <strong>Cotización:</strong> {quote.quoteNumber}
            </p>
            <p className="text-sm text-blue-800">
              <strong>Total:</strong> {formatCurrency(quote.total)}
            </p>
          </div>

          {/* Email */}
          <div>
            <Label htmlFor="email">Email del Cliente *</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="cliente@empresa.com"
              className="mt-1"
              required
            />
            <p className="text-xs text-gray-500 mt-1">
              El cliente recibirá un email con la cotización y botones para aceptar/rechazar
            </p>
          </div>

          {/* Mensaje opcional */}
          <div>
            <Label htmlFor="message">Mensaje Personalizado (opcional)</Label>
            <Textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Ej: Hola Juan, te envío la cotización que solicitaste. Cualquier duda estoy a tu disposición..."
              rows={4}
              className="mt-1"
            />
            <p className="text-xs text-gray-500 mt-1">
              Este mensaje aparecerá destacado en el email
            </p>
          </div>

          {/* Info */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
            <p className="text-xs text-gray-700">
              <strong>📧 El email incluirá:</strong>
            </p>
            <ul className="text-xs text-gray-600 mt-2 space-y-1 ml-4 list-disc">
              <li>Detalles completos de la cotización</li>
              <li>Botones para aceptar o rechazar</li>
              <li>Link para ver la cotización online</li>
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={sending}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSend}
            disabled={!email || sending}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Enviando...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Enviar Email
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
