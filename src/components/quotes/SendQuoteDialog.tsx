'use client'

import { useState, useEffect } from 'react'
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
import { Loader2, Send, Mail, Paperclip, X, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency as formatCurrencyAR } from '@/lib/utils'

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

interface FichaTecnica {
  productId: string
  sku: string
  productName: string
  filename: string
  size: number | null
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
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const [fichas, setFichas] = useState<FichaTecnica[]>([])
  const [selectedFichas, setSelectedFichas] = useState<Set<string>>(new Set())

  // Al abrir el diálogo, buscar fichas técnicas de los productos cotizados
  useEffect(() => {
    if (!open) return
    fetch(`/api/quotes/${quote.id}/fichas-tecnicas`)
      .then((res) => (res.ok ? res.json() : { fichas: [] }))
      .then((data: { fichas: FichaTecnica[] }) => {
        setFichas(data.fichas || [])
        // Todas tildadas por defecto
        setSelectedFichas(new Set((data.fichas || []).map((f) => f.productId)))
      })
      .catch(() => setFichas([]))
  }, [open, quote.id])

  function toggleFicha(productId: string) {
    setSelectedFichas((prev) => {
      const next = new Set(prev)
      if (next.has(productId)) {
        next.delete(productId)
      } else {
        next.add(productId)
      }
      return next
    })
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])

    const oversized = files.filter(f => f.size > 3 * 1024 * 1024)
    if (oversized.length > 0) {
      toast.error(`Archivos demasiado grandes (máx 3MB): ${oversized.map(f => f.name).join(', ')}`)
      return
    }

    const currentSize = attachedFiles.reduce((sum, f) => sum + f.size, 0)
    const newSize = files.reduce((sum, f) => sum + f.size, 0)
    if (currentSize + newSize > 10 * 1024 * 1024) {
      toast.error('El total de archivos adjuntos no puede superar 10MB')
      return
    }

    setAttachedFiles(prev => [...prev, ...files])
    e.target.value = ''
  }

  function removeFile(index: number) {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index))
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  // Los Decimal de Prisma llegan como string vía JSON; el helper los coerciona.
  const formatCurrency = (amount: number | string) =>
    formatCurrencyAR(amount, quote.currency === 'USD' ? 'USD' : 'ARS')

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
      // Convertir archivos a base64
      const fileAttachments = await Promise.all(
        attachedFiles.map(async (file) => {
          const buffer = await file.arrayBuffer()
          const base64 = btoa(
            new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
          )
          return {
            filename: file.name,
            contentBase64: base64,
            contentType: file.type || 'application/octet-stream',
          }
        })
      )

      const response = await fetch(`/api/quotes/${quote.id}/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: validEmails.join(', '),
          message: message.trim() || undefined,
          additionalAttachments: fileAttachments.length > 0 ? fileAttachments : undefined,
          fichaProductIds: selectedFichas.size > 0 ? Array.from(selectedFichas) : undefined,
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
      setAttachedFiles([])
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
      <DialogContent className="sm:max-w-md max-h-[80vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-blue-600" />
            Enviar Cotización por Email
          </DialogTitle>
          <DialogDescription>
            La cotización {quote.quoteNumber} será enviada al cliente con un link para ver y responder.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4 overflow-y-auto flex-1 min-h-0">
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

          {/* Fichas técnicas detectadas automáticamente */}
          {fichas.length > 0 && (
            <div>
              <Label>Fichas Técnicas de los Productos</Label>
              <div className="mt-1 space-y-1">
                {fichas.map((f) => (
                  <label
                    key={f.productId}
                    className="flex items-center gap-2 bg-green-50 border border-green-200 rounded px-3 py-2 text-sm cursor-pointer hover:bg-green-100 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedFichas.has(f.productId)}
                      onChange={() => toggleFicha(f.productId)}
                      className="rounded flex-shrink-0"
                    />
                    <FileText className="h-4 w-4 text-green-700 flex-shrink-0" />
                    <span className="truncate flex-1">
                      <span className="font-medium">{f.sku}</span> — {f.filename}
                      {f.size != null && (
                        <span className="text-gray-500"> ({formatFileSize(f.size)})</span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Detectadas automáticamente según los productos cotizados. Destildá las que no quieras enviar.
              </p>
            </div>
          )}

          {/* Archivos adjuntos */}
          <div>
            <Label>Otros Adjuntos (opcional)</Label>
            <div className="mt-1">
              <label
                htmlFor="file-upload"
                className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
              >
                <Paperclip className="h-4 w-4 text-gray-500" />
                <span className="text-sm text-gray-600">
                  Click para adjuntar archivos
                </span>
                <input
                  id="file-upload"
                  type="file"
                  multiple
                  accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </label>
            </div>

            {attachedFiles.length > 0 && (
              <div className="mt-2 space-y-1">
                {attachedFiles.map((file, index) => (
                  <div
                    key={`${file.name}-${index}`}
                    className="flex items-center justify-between bg-gray-50 rounded px-3 py-1.5 text-sm"
                  >
                    <span className="truncate flex-1 mr-2">
                      📎 {file.name} ({formatFileSize(file.size)})
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFile(index)}
                      className="text-red-500 hover:text-red-700 flex-shrink-0"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <p className="text-xs text-gray-500">
                  {attachedFiles.length} archivo(s) — Total:{' '}
                  {formatFileSize(attachedFiles.reduce((sum, f) => sum + f.size, 0))}
                </p>
              </div>
            )}
          </div>

          {/* Info */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
            <p className="text-xs text-gray-700">
              <strong>El email incluirá:</strong>
            </p>
            <ul className="text-xs text-gray-600 mt-2 space-y-1 ml-4 list-disc">
              <li>Detalles completos de la cotización</li>
              <li>PDF de la cotización adjunto</li>
              {selectedFichas.size > 0 && (
                <li>{selectedFichas.size} ficha(s) técnica(s) de producto</li>
              )}
              {attachedFiles.length > 0 && (
                <li>{attachedFiles.length} adjunto(s) manual(es)</li>
              )}
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

        <DialogFooter className="flex-shrink-0 border-t pt-4">
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
