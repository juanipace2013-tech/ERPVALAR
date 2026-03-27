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

interface SendRemitoDialogProps {
  deliveryNote: {
    id: string
    deliveryNumber: string
    customer: {
      name: string
      businessName: string | null
      email: string | null
    }
    itemCount: number
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

export function SendRemitoDialog({
  deliveryNote,
  open,
  onOpenChange,
  onSent,
}: SendRemitoDialogProps) {
  const [emails, setEmails] = useState(deliveryNote.customer.email || '')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)

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
      const response = await fetch(
        `/api/delivery-notes/${deliveryNote.id}/send-email`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: validEmails.join(', '),
            message: message.trim() || undefined,
          }),
        }
      )

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error al enviar email')
      }

      const count = validEmails.length
      toast.success(
        count === 1
          ? 'Remito enviado por email exitosamente'
          : `Remito enviado a ${count} destinatarios`
      )

      onOpenChange(false)
      onSent?.()
      setMessage('')
    } catch (error) {
      console.error('Error enviando email:', error)
      toast.error(
        error instanceof Error ? error.message : 'Error al enviar email'
      )
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
            Enviar Remito por Email
          </DialogTitle>
          <DialogDescription>
            El remito {deliveryNote.deliveryNumber} se enviará con el PDF
            adjunto.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Resumen */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-800">
              <strong>Cliente:</strong>{' '}
              {deliveryNote.customer.businessName || deliveryNote.customer.name}
            </p>
            <p className="text-sm text-blue-800">
              <strong>Remito:</strong> {deliveryNote.deliveryNumber}
            </p>
            <p className="text-sm text-blue-800">
              <strong>Items:</strong> {deliveryNote.itemCount}
            </p>
          </div>

          {/* Emails */}
          <div>
            <Label htmlFor="remito-email">Email(s) del Cliente *</Label>
            <Input
              id="remito-email"
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
            <Label htmlFor="remito-message">Mensaje (opcional)</Label>
            <Textarea
              id="remito-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Ej: Le adjuntamos el remito de la entrega realizada hoy..."
              rows={3}
              className="mt-1"
            />
          </div>

          {/* Info */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
            <p className="text-xs text-gray-700">
              <strong>El email incluirá:</strong>
            </p>
            <ul className="text-xs text-gray-600 mt-2 space-y-1 ml-4 list-disc">
              <li>Datos del remito y entrega</li>
              <li>PDF del remito adjunto</li>
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
