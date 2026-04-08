'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Phone,
  Mail,
  MessageCircle,
  Users,
  MoreHorizontal,
  Plus,
  Trash2,
  Loader2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { toast } from 'sonner'
import { getLocalDateString } from '@/lib/utils'

interface Seguimiento {
  id: string
  quoteId: string
  fecha: string
  usuario: string
  tipo: string
  nota: string
  createdAt: string
}

interface QuoteSeguimientosProps {
  quoteId: string
}

const tipoConfig: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  llamada: { label: 'Llamada', icon: <Phone className="h-3 w-3" />, color: 'bg-blue-100 text-blue-700 border-blue-200' },
  email: { label: 'Email', icon: <Mail className="h-3 w-3" />, color: 'bg-green-100 text-green-700 border-green-200' },
  whatsapp: { label: 'WhatsApp', icon: <MessageCircle className="h-3 w-3" />, color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  reunión: { label: 'Reunión', icon: <Users className="h-3 w-3" />, color: 'bg-purple-100 text-purple-700 border-purple-200' },
  otro: { label: 'Otro', icon: <MoreHorizontal className="h-3 w-3" />, color: 'bg-gray-100 text-gray-700 border-gray-200' },
}

const usuarios = ['Santiago', 'Germán', 'Paula', 'Juan']

export function QuoteSeguimientos({ quoteId }: QuoteSeguimientosProps) {
  const [seguimientos, setSeguimientos] = useState<Seguimiento[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Form state
  const [fecha, setFecha] = useState(getLocalDateString())
  const [usuario, setUsuario] = useState('')
  const [tipo, setTipo] = useState('')
  const [nota, setNota] = useState('')

  const fetchSeguimientos = useCallback(async () => {
    try {
      const res = await fetch(`/api/quotes/${quoteId}/seguimientos`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setSeguimientos(data)
    } catch {
      toast.error('Error al cargar seguimientos')
    } finally {
      setLoading(false)
    }
  }, [quoteId])

  useEffect(() => {
    fetchSeguimientos()
  }, [fetchSeguimientos])

  const resetForm = () => {
    setFecha(getLocalDateString())
    setUsuario('')
    setTipo('')
    setNota('')
  }

  const handleSubmit = async () => {
    if (!usuario || !tipo || !nota.trim()) {
      toast.error('Completar todos los campos')
      return
    }

    try {
      setSubmitting(true)
      const res = await fetch(`/api/quotes/${quoteId}/seguimientos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario, tipo, nota: nota.trim(), fecha }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Error al crear seguimiento')
      }

      toast.success('Seguimiento registrado')
      resetForm()
      setShowForm(false)
      fetchSeguimientos()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al crear seguimiento')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (seguimientoId: string) => {
    if (!confirm('¿Eliminar este seguimiento?')) return

    try {
      setDeletingId(seguimientoId)
      const res = await fetch(`/api/quotes/${quoteId}/seguimientos/${seguimientoId}`, {
        method: 'DELETE',
      })

      if (!res.ok) throw new Error()

      toast.success('Seguimiento eliminado')
      fetchSeguimientos()
    } catch {
      toast.error('Error al eliminar seguimiento')
    } finally {
      setDeletingId(null)
    }
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  }

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <Card className="border-blue-200">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-blue-900 flex items-center gap-2">
            <Phone className="h-5 w-5" />
            Seguimientos
            {seguimientos.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {seguimientos.length}
              </Badge>
            )}
          </CardTitle>
          <Button
            variant={showForm ? 'outline' : 'default'}
            size="sm"
            onClick={() => {
              setShowForm(!showForm)
              if (!showForm) resetForm()
            }}
            className={showForm ? '' : 'bg-blue-600 hover:bg-blue-700'}
          >
            {showForm ? (
              <>
                <ChevronUp className="mr-1 h-4 w-4" />
                Cancelar
              </>
            ) : (
              <>
                <Plus className="mr-1 h-4 w-4" />
                Agregar seguimiento
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Form */}
        {showForm && (
          <div className="p-4 rounded-lg border border-blue-200 bg-blue-50/50 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="seg-fecha">Fecha</Label>
                <Input
                  id="seg-fecha"
                  type="date"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="seg-usuario">Usuario</Label>
                <Select value={usuario} onValueChange={setUsuario}>
                  <SelectTrigger id="seg-usuario">
                    <SelectValue placeholder="Seleccionar..." />
                  </SelectTrigger>
                  <SelectContent>
                    {usuarios.map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="seg-tipo">Tipo de contacto</Label>
                <Select value={tipo} onValueChange={setTipo}>
                  <SelectTrigger id="seg-tipo">
                    <SelectValue placeholder="Seleccionar..." />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(tipoConfig).map(([key, cfg]) => (
                      <SelectItem key={key} value={key}>
                        <span className="flex items-center gap-2">
                          {cfg.icon} {cfg.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="seg-nota">Nota</Label>
              <Textarea
                id="seg-nota"
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                placeholder="Detalle del contacto, respuesta del cliente, próximos pasos..."
                rows={3}
              />
            </div>
            <div className="flex justify-end">
              <Button
                onClick={handleSubmit}
                disabled={submitting}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {submitting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                Guardar seguimiento
              </Button>
            </div>
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
          </div>
        ) : seguimientos.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No hay seguimientos registrados
          </p>
        ) : (
          <div className="space-y-3">
            {seguimientos.map((seg) => {
              const cfg = tipoConfig[seg.tipo] || tipoConfig.otro
              return (
                <div
                  key={seg.id}
                  className="p-3 rounded-lg border border-gray-200 hover:border-blue-200 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-sm font-medium text-gray-900">
                          {formatDate(seg.fecha)}
                        </span>
                        <Badge variant="outline" className={`text-xs ${cfg.color}`}>
                          <span className="flex items-center gap-1">
                            {cfg.icon} {cfg.label}
                          </span>
                        </Badge>
                        <span className="text-xs text-gray-500">
                          por {seg.usuario}
                        </span>
                      </div>
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">
                        {seg.nota}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-gray-400 hover:text-red-600 flex-shrink-0"
                      onClick={() => handleDelete(seg.id)}
                      disabled={deletingId === seg.id}
                      title="Eliminar seguimiento"
                    >
                      {deletingId === seg.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
