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

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Parsea un string de emails separados por , o ; y devuelve el array limpio */
function parseEmails(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((e) => e.trim())
    .filter(Boolean)
}

export function SendQuoteDialog({
  quote,
  open,
  onOpenChange,
  onSent
}: SendQuoteDialogProps) {
  const [emails, setEmails] = useState(quote.customer.email || '')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)

  const formatCurrency = (amount: number) => {
    const symbol = quote.currency === 'USD' ? 'USD' : 'ARS'
    return `${symbol} ${amount.toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`
  }

  function validateEmails(): string[] | null {
    const parsed = parseEmails(emails)

    if (parsed.length === 0) {
      toast.error('Debe ingresar al menos un email')
      return null
    }

    const invalid = parsed.filter((e) => !EMAIL_REGEX.test(e))
    if (invalid.length > 0) {
      toast.error(`Email(s) inválido(s): ${invalid.join(', ')}`)
      return null
    }

    return parsed
  }

  async function handleSend() {
    const validEmails = validateEmails()
    if (!validEmails) return

    setSending(true)

    try {
      const response = await fetch(`/api/quotes/${quote.id}/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: validEmails.join(', '),
          message: message.trim() || undefined
        })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error al enviar email')
      }

      const result = await response.json()

      const count = validEmails.length
      toast.success(
        count === 1
          ? 'Email enviado exitosamente'
          : `Email enviado a ${count} destinatarios`
      )
      console.log('Email enviado:', result)

      onOpenChange(false)
      onSent?.()
      setMessage('')
    } catch (error) {
      console.error('Error enviando email:', error)
      toast.error(error instanceof Error ? error.message : 'Error al enviar email')
    } finally {
      setSending(false)
    }
  }

  const parsedCount = parseEmails(emails).length

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

          {/* Emails */}
          <div>
            <Label htmlFor="email">Email(s) del Cliente *</Label>
            <Input
              id="email"
              type="text"
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              placeholder="email1@ejemplo.com, email2@ejemplo.com"
              className="mt-1"
              required
            />
            <p className="text-xs text-gray-500 mt-1">
              Separá múltiples emails con coma.{' '}
              {parsedCount > 1 && (
                <span className="text-blue-600 font-medium">
                  {parsedCount} destinatarios
                </span>
              )}
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
              <strong>El email incluirá:</strong>
            </p>
            <ul className="text-xs text-gray-600 mt-2 space-y-1 ml-4 list-disc">
              <li>Detalles completos de la cotización</li>
              <li>PDF de la cotización adjunto</li>
              <li>Botones para aceptar o rechazar</li>
              <li>Link para ver la cotización online</li>
              {parsedCount > 1 && (
                <li>
                  El primer email será el destinatario principal, los demás irán en CC
                </li>
              )}
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
            disabled={!emails.trim() || sending}
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
