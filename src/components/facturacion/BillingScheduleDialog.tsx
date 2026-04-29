'use client'

import { useEffect, useState } from 'react'
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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'

const NOTE_MAX = 500

export interface BillingScheduleInitial {
  billingTargetDate: string | null
  billingNote: string | null
  billingNoteUpdatedAt: string | null
  billingNoteUpdatedByName: string | null
}

interface Props {
  open: boolean
  quoteId: string | null
  quoteNumber: string | null
  initial: BillingScheduleInitial | null
  onClose: () => void
  onSaved: () => void // refetch del board
}

function isoToInputDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  // YYYY-MM-DD para <input type="date"> usando UTC, porque billingTargetDate
  // se guarda como fecha civil (12:00 UTC) y queremos mostrar el día civil.
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Para billingNoteUpdatedAt: ese SÍ es un instante real (cuándo se editó),
// se formatea con la timezone local del navegador.
function formatHumanDateTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function BillingScheduleDialog({
  open,
  quoteId,
  quoteNumber,
  initial,
  onClose,
  onSaved,
}: Props) {
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setDate(isoToInputDate(initial?.billingTargetDate ?? null))
      setNote(initial?.billingNote ?? '')
    }
  }, [open, initial])

  if (!quoteId) return null

  const handleSave = async () => {
    if (note.length > NOTE_MAX) {
      toast.error(`La nota no puede superar ${NOTE_MAX} caracteres`)
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/quotes/${quoteId}/billing-schedule`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          billingTargetDate: date || null,
          billingNote: note.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'No se pudo guardar')
      toast.success('Programación de facturación actualizada')
      onSaved()
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al guardar'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  const handleClear = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/quotes/${quoteId}/billing-schedule`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billingTargetDate: null, billingNote: null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'No se pudo limpiar')
      toast.success('Programación limpiada')
      onSaved()
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al limpiar'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  const hadInitial = !!(initial?.billingTargetDate || initial?.billingNote)

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !saving) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Programar facturación</DialogTitle>
          <DialogDescription>
            {quoteNumber ? <span className="font-mono">{quoteNumber}</span> : null}
            {' '}— informativo, no bloquea la facturación manual.
          </DialogDescription>
        </DialogHeader>

        {initial?.billingNoteUpdatedAt && initial?.billingNoteUpdatedByName && (
          <p className="text-xs text-muted-foreground">
            Última edición: {initial.billingNoteUpdatedByName} el {formatHumanDateTime(initial.billingNoteUpdatedAt)}
          </p>
        )}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="billingTargetDate">Fecha objetivo de facturación</Label>
            <Input
              id="billingTargetDate"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={saving}
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="billingNote">Nota</Label>
              <span className={`text-xs ${note.length > NOTE_MAX ? 'text-red-600' : 'text-muted-foreground'}`}>
                {note.length} / {NOTE_MAX}
              </span>
            </div>
            <Textarea
              id="billingNote"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={NOTE_MAX}
              rows={4}
              placeholder="Ej.: cliente pidió demorar facturación por cierre fiscal"
              disabled={saving}
            />
          </div>
        </div>

        <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={handleClear}
            disabled={saving || !hadInitial}
            className="text-red-600 hover:text-red-700"
          >
            Limpiar
          </Button>
          <div className="flex gap-2 sm:justify-end">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Guardar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
