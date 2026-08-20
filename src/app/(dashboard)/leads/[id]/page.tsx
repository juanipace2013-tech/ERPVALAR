'use client'

import { useEffect, useState, use } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ArrowLeft,
  Trash2,
  Save,
  UserPlus,
  FileText,
  ExternalLink,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'

interface LeadDetail {
  id: string
  leadId: string | null
  gclId: string | null
  campaignId: string | null
  fullName: string | null
  email: string | null
  phone: string | null
  companyName: string | null
  message: string | null
  rawPayload: unknown
  status: string
  internalNotes: string | null
  customerId: string | null
  customer: { id: string; name: string; cuit: string; email: string | null } | null
  createdAt: string
  processedAt: string | null
}

const STATUS_OPTIONS = [
  { value: 'NUEVO', label: 'Nuevo', color: 'bg-blue-100 text-blue-800' },
  { value: 'CONTACTADO', label: 'Contactado', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'COTIZADO', label: 'Cotizado', color: 'bg-purple-100 text-purple-800' },
  { value: 'CONVERTIDO', label: 'Convertido', color: 'bg-green-100 text-green-800' },
  { value: 'DESCARTADO', label: 'Descartado', color: 'bg-gray-200 text-gray-700' },
]

export default function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const [lead, setLead] = useState<LeadDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('NUEVO')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch(`/api/leads/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        if (data.error) {
          toast.error(data.error)
          return
        }
        setLead(data)
        setStatus(data.status)
        setNotes(data.internalNotes || '')
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [id])

  const handleSave = async () => {
    setSaving(true)
    try {
      const r = await fetch(`/api/leads/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, internalNotes: notes }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Error al guardar')
      setLead(data)
      toast.success('Lead actualizado')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('¿Eliminar este lead? Esta acción no se puede deshacer.')) return
    const r = await fetch(`/api/leads/${id}`, { method: 'DELETE' })
    if (r.ok) {
      toast.success('Lead eliminado')
      router.push('/leads')
    } else {
      toast.error('No se pudo eliminar')
    }
  }

  if (loading) {
    return <div className="container mx-auto px-6 py-8">Cargando…</div>
  }
  if (!lead) {
    return (
      <div className="container mx-auto px-6 py-8">
        <p>Lead no encontrado.</p>
        <Link href="/leads" className="text-blue-600 hover:underline">
          ← Volver al listado
        </Link>
      </div>
    )
  }

  // Pre-llenado para "Crear Cliente" / "Crear Cotización"
  const newCustomerHref = `/clientes/nuevo?${new URLSearchParams({
    ...(lead.fullName ? { name: lead.fullName } : {}),
    ...(lead.email ? { email: lead.email } : {}),
    ...(lead.phone ? { phone: lead.phone } : {}),
    ...(lead.companyName ? { businessName: lead.companyName } : {}),
  }).toString()}`

  const newQuoteHref = lead.customerId
    ? `/cotizaciones/nueva?customerId=${lead.customerId}`
    : '/cotizaciones/nueva'

  const statusOption = STATUS_OPTIONS.find((s) => s.value === lead.status)

  return (
    <div className="container mx-auto px-6 py-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link
            href="/leads"
            className="text-sm text-gray-600 hover:text-blue-600 flex items-center gap-1 mb-2"
          >
            <ArrowLeft className="h-4 w-4" /> Volver a Leads
          </Link>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-blue-600" />
            {lead.fullName || 'Lead sin nombre'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Recibido el{' '}
            {new Date(lead.createdAt).toLocaleString('es-AR')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={statusOption?.color}>{statusOption?.label}</Badge>
          <Button variant="destructive" size="sm" onClick={handleDelete}>
            <Trash2 className="h-4 w-4 mr-1" /> Eliminar
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Datos del lead */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Datos del lead</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Field label="Nombre" value={lead.fullName} />
            <Field label="Email" value={lead.email} mono />
            <Field label="Teléfono" value={lead.phone} mono />
            <Field label="Empresa" value={lead.companyName} />
            <Field label="Mensaje" value={lead.message} multiline />
            <hr className="my-3" />
            <Field label="Campaign ID" value={lead.campaignId} mono />
            <Field label="GCL ID" value={lead.gclId} mono />
            <Field label="Lead ID (Google)" value={lead.leadId} mono />
          </CardContent>
        </Card>

        {/* Acciones / gestión */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Estado y seguimiento</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="text-xs text-gray-600">Estado</label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-gray-600">Notas internas</label>
                <Textarea
                  rows={5}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Registrar llamadas, mails, próximos pasos…"
                />
              </div>
              <Button
                className="w-full"
                onClick={handleSave}
                disabled={saving}
              >
                <Save className="h-4 w-4 mr-2" />
                {saving ? 'Guardando…' : 'Guardar'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Acciones</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {lead.customer ? (
                <Link
                  href={`/clientes/${lead.customer.id}`}
                  className="flex items-center justify-between p-2 rounded border hover:bg-blue-50 text-sm"
                >
                  <span>
                    Cliente vinculado: <strong>{lead.customer.name}</strong>
                  </span>
                  <ExternalLink className="h-4 w-4" />
                </Link>
              ) : (
                <Link href={newCustomerHref}>
                  <Button variant="outline" className="w-full justify-start">
                    <UserPlus className="h-4 w-4 mr-2" />
                    Crear Cliente desde este lead
                  </Button>
                </Link>
              )}
              <Link href={newQuoteHref}>
                <Button variant="outline" className="w-full justify-start">
                  <FileText className="h-4 w-4 mr-2" />
                  Crear Cotización
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Payload original (Google Ads)</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="text-xs bg-gray-50 dark:bg-gray-800 p-3 rounded overflow-x-auto">
            {JSON.stringify(lead.rawPayload, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </div>
  )
}

function Field({
  label,
  value,
  mono,
  multiline,
}: {
  label: string
  value: string | null | undefined
  mono?: boolean
  multiline?: boolean
}) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div
        className={[
          'text-sm break-all',
          mono ? 'font-mono' : '',
          multiline ? 'whitespace-pre-wrap' : '',
        ].join(' ')}
      >
        {value || <span className="text-gray-400">—</span>}
      </div>
    </div>
  )
}
