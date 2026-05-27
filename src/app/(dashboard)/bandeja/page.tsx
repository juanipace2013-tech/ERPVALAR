'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  Inbox,
  Mail,
  MessageCircle,
  RefreshCw,
  Search,
  User as UserIcon,
  AlertCircle,
  Sparkles,
  Copy,
  Check,
} from 'lucide-react'
import { toast } from 'sonner'
import { Textarea } from '@/components/ui/textarea'

// ─── Tipos ───────────────────────────────────────────────────────────────────

type ChannelType = 'WHATSAPP' | 'EMAIL'
type ConversationStatus = 'OPEN' | 'PENDING' | 'CLOSED'
type MessageDirection = 'INBOUND' | 'OUTBOUND'
type MessageCategory = 'COTIZACION' | 'CONSULTA' | 'QUEJA' | 'PAGO' | 'OTRO'

interface ConversationListItem {
  id: string
  contactName: string | null
  contactIdentifier: string
  subject: string | null
  status: ConversationStatus
  unreadCount: number
  lastMessageAt: string | null
  channelAccount: { type: ChannelType; name: string }
  customer: { id: string; name: string } | null
  contact: { id: string; firstName: string; lastName: string } | null
  assignedTo: { id: string; name: string } | null
  _count: { messages: number }
  aiCategory: MessageCategory | null
}

interface MessageItem {
  id: string
  direction: MessageDirection
  body: string
  bodyHtml: string | null
  fromName: string | null
  fromAddress: string
  sentAt: string | null
  createdAt: string
}

interface ConversationDetail extends ConversationListItem {
  channelAccount: { type: ChannelType; name: string; identifier: string }
  customer: { id: string; name: string; businessName: string | null } | null
  contact: {
    id: string
    firstName: string
    lastName: string
    email: string | null
    phone: string | null
  } | null
  messages: MessageItem[]
  // Campos IA — Fase 2
  aiCategory: MessageCategory | null
  aiCategoryConfidence: number | null
  aiSummary: string | null
  aiDraftReply: string | null
  aiClassifierModel: string | null
  aiDrafterModel: string | null
  aiCostUsd: string | number | null // Prisma Decimal vuelve como string
  aiAnalyzedAt: string | null
  aiAnalyzedMessageId: string | null
}

// ─── Categorías → estilo de badge ──────────────────────────────────────────

const CATEGORY_STYLE: Record<MessageCategory, { label: string; className: string }> = {
  COTIZACION: {
    label: 'Cotización',
    className: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  },
  CONSULTA: {
    label: 'Consulta',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  },
  QUEJA: {
    label: 'Queja',
    className: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  },
  PAGO: {
    label: 'Pago',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  },
  OTRO: {
    label: 'Otro',
    className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  },
}

// ─── Utils ───────────────────────────────────────────────────────────────────

function formatRelative(dateStr: string | null): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const diff = Date.now() - d.getTime()
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min}m`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h}h`
  const days = Math.floor(h / 24)
  if (days < 7) return `hace ${days}d`
  return d.toLocaleDateString('es-AR')
}

function channelIcon(type: ChannelType) {
  return type === 'WHATSAPP' ? MessageCircle : Mail
}

// ─── Página ──────────────────────────────────────────────────────────────────

export default function BandejaPage() {
  const [conversations, setConversations] = useState<ConversationListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ConversationDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // Filtros
  const [channel, setChannel] = useState<string>('all')
  const [status, setStatus] = useState<string>('OPEN')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [search, setSearch] = useState('')

  const fetchConversations = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (channel !== 'all') params.set('channel', channel)
      if (status !== 'all') params.set('status', status)
      if (unreadOnly) params.set('unread', '1')
      if (search.trim()) params.set('q', search.trim())

      const res = await fetch(`/api/inbox/conversations?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setConversations(data.conversations)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }, [channel, status, unreadOnly, search])

  const fetchDetail = useCallback(async (id: string) => {
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/inbox/conversations/${id}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setDetail(data.conversation)
      // Marcar como leída
      if (data.conversation.unreadCount > 0) {
        await fetch(`/api/inbox/conversations/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ markRead: true }),
        })
        setConversations((prev) =>
          prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c))
        )
      }
    } catch (e) {
      toast.error('No se pudo cargar la conversación', {
        description: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchConversations()
  }, [fetchConversations])

  useEffect(() => {
    if (selectedId) fetchDetail(selectedId)
    else setDetail(null)
  }, [selectedId, fetchDetail])

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Inbox className="h-6 w-6 text-blue-600" />
          <h1 className="text-2xl font-semibold">Bandeja</h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchConversations}
          disabled={loading}
        >
          <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
          Refrescar
        </Button>
      </header>

      <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden md:grid-cols-[420px_1fr]">
        {/* Panel izquierdo: lista */}
        <div className="flex min-h-0 flex-col rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="space-y-2 border-b border-gray-200 p-3 dark:border-gray-800">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Buscar"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los canales</SelectItem>
                  <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
                  <SelectItem value="EMAIL">Mail</SelectItem>
                </SelectContent>
              </Select>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="OPEN">Abiertas</SelectItem>
                  <SelectItem value="PENDING">Pendientes</SelectItem>
                  <SelectItem value="CLOSED">Cerradas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={(e) => setUnreadOnly(e.target.checked)}
                className="rounded"
              />
              Solo no leídas
            </label>
          </div>

          <div className="flex-1 overflow-y-auto">
            {error && (
              <div className="m-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            {loading && !conversations.length && (
              <div className="p-6 text-center text-sm text-gray-500">Cargando…</div>
            )}
            {!loading && !conversations.length && !error && (
              <div className="p-6 text-center text-sm text-gray-500">
                No hay conversaciones todavía.
              </div>
            )}
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {conversations.map((c) => {
                const Icon = channelIcon(c.channelAccount.type)
                const isSelected = c.id === selectedId
                const isUnread = c.unreadCount > 0
                return (
                  <li
                    key={c.id}
                    className={cn(
                      'cursor-pointer p-3 transition hover:bg-gray-50 dark:hover:bg-gray-800',
                      isSelected && 'bg-blue-50 dark:bg-blue-950/30'
                    )}
                    onClick={() => setSelectedId(c.id)}
                  >
                    <div className="flex items-start gap-3">
                      <Icon
                        className={cn(
                          'mt-0.5 h-4 w-4 shrink-0',
                          c.channelAccount.type === 'WHATSAPP'
                            ? 'text-green-600'
                            : 'text-blue-600'
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p
                            className={cn(
                              'truncate text-sm',
                              isUnread ? 'font-semibold' : 'font-medium'
                            )}
                          >
                            {c.contactName || c.contactIdentifier}
                          </p>
                          <span className="shrink-0 text-xs text-gray-500">
                            {formatRelative(c.lastMessageAt)}
                          </span>
                        </div>
                        {c.subject && (
                          <p className="truncate text-xs text-gray-600 dark:text-gray-400">
                            {c.subject}
                          </p>
                        )}
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          {c.aiCategory && (
                            <span
                              className={cn(
                                'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                                CATEGORY_STYLE[c.aiCategory].className
                              )}
                            >
                              {CATEGORY_STYLE[c.aiCategory].label}
                            </span>
                          )}
                          {c.customer && (
                            <Badge variant="secondary" className="text-xs">
                              {c.customer.name}
                            </Badge>
                          )}
                          {!c.customer && (
                            <span className="text-xs text-gray-400">
                              Sin cliente vinculado
                            </span>
                          )}
                          {isUnread && (
                            <Badge className="ml-auto bg-blue-600 hover:bg-blue-700">
                              {c.unreadCount}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>

        {/* Panel derecho: detalle */}
        <div className="flex min-h-0 flex-col rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          {!selectedId ? (
            <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
              Seleccioná una conversación
            </div>
          ) : detailLoading || !detail ? (
            <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
              Cargando…
            </div>
          ) : (
            <ConversationView
              detail={detail}
              onConversationUpdated={(updated) => {
                setDetail(updated)
                setConversations((prev) =>
                  prev.map((c) =>
                    c.id === updated.id ? { ...c, aiCategory: updated.aiCategory } : c
                  )
                )
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Vista de conversación ──────────────────────────────────────────────────

function ConversationView({
  detail,
  onConversationUpdated,
}: {
  detail: ConversationDetail
  onConversationUpdated: (c: ConversationDetail) => void
}) {
  const Icon = channelIcon(detail.channelAccount.type)
  return (
    <>
      <header className="border-b border-gray-200 p-4 dark:border-gray-800">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Icon
                className={cn(
                  'h-5 w-5 shrink-0',
                  detail.channelAccount.type === 'WHATSAPP'
                    ? 'text-green-600'
                    : 'text-blue-600'
                )}
              />
              <h2 className="truncate text-lg font-semibold">
                {detail.contactName || detail.contactIdentifier}
              </h2>
            </div>
            <p className="text-sm text-gray-500">
              {detail.contactIdentifier}
              {detail.subject && <span className="ml-2">• {detail.subject}</span>}
            </p>
            {detail.customer ? (
              <div className="mt-2 flex items-center gap-2 text-sm">
                <UserIcon className="h-3.5 w-3.5 text-gray-400" />
                <span className="text-gray-700 dark:text-gray-300">
                  Cliente: <strong>{detail.customer.name}</strong>
                </span>
                {detail.contact && (
                  <span className="text-gray-500">
                    ({detail.contact.firstName} {detail.contact.lastName})
                  </span>
                )}
              </div>
            ) : (
              <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">
                Sin cliente vinculado en el CRM
              </p>
            )}
          </div>
          <Badge variant={detail.status === 'OPEN' ? 'default' : 'secondary'}>
            {detail.status}
          </Badge>
        </div>
      </header>

      <AiPanel detail={detail} onConversationUpdated={onConversationUpdated} />

      <div className="flex-1 space-y-3 overflow-y-auto bg-gray-50 p-4 dark:bg-gray-950">
        {detail.messages.length === 0 && (
          <p className="text-center text-sm text-gray-500">Sin mensajes.</p>
        )}
        {detail.messages.map((m) => (
          <MessageBubble key={m.id} message={m} channelType={detail.channelAccount.type} />
        ))}
      </div>

      <footer className="border-t border-gray-200 p-3 text-center text-xs text-gray-500 dark:border-gray-800">
        Enviar desde la bandeja se habilita en una fase posterior. Por ahora copiá el borrador y
        respondé desde Outlook / WhatsApp como siempre.
      </footer>
    </>
  )
}

// ─── Panel IA: clasificación + borrador editable ───────────────────────────

function AiPanel({
  detail,
  onConversationUpdated,
}: {
  detail: ConversationDetail
  onConversationUpdated: (c: ConversationDetail) => void
}) {
  const [editedDraft, setEditedDraft] = useState(detail.aiDraftReply ?? '')
  const [analyzing, setAnalyzing] = useState(false)
  const [copied, setCopied] = useState(false)

  // Reset el textarea cuando llega una conversación distinta o un análisis nuevo
  useEffect(() => {
    setEditedDraft(detail.aiDraftReply ?? '')
    setCopied(false)
  }, [detail.id, detail.aiDraftReply])

  const runAnalysis = useCallback(
    async (force: boolean) => {
      setAnalyzing(true)
      try {
        const res = await fetch(`/api/inbox/conversations/${detail.id}/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(force ? { force: true } : {}),
        })
        if (res.status === 409) {
          // Re-intento automático con force=true si fue manual
          if (force) throw new Error('Conflicto al re-analizar')
          await runAnalysis(true)
          return
        }
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}))
          throw new Error(errBody.error || `HTTP ${res.status}`)
        }
        const data = await res.json()
        onConversationUpdated(data.conversation)
        toast.success('Análisis actualizado')
      } catch (e) {
        toast.error('No se pudo analizar', {
          description: e instanceof Error ? e.message : undefined,
        })
      } finally {
        setAnalyzing(false)
      }
    },
    [detail.id, onConversationUpdated]
  )

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(editedDraft)
      setCopied(true)
      toast.success('Borrador copiado al portapapeles')
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('No se pudo copiar')
    }
  }, [editedDraft])

  const hasAnalysis = !!detail.aiCategory
  const categoryStyle = detail.aiCategory ? CATEGORY_STYLE[detail.aiCategory] : null
  const cost =
    detail.aiCostUsd !== null && detail.aiCostUsd !== undefined ? Number(detail.aiCostUsd) : null

  return (
    <section className="border-b border-gray-200 bg-gradient-to-r from-blue-50/40 to-purple-50/40 p-3 dark:border-gray-800 dark:from-blue-950/20 dark:to-purple-950/20">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="h-4 w-4 text-blue-600" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Asistente IA</span>
          {categoryStyle && detail.aiCategory && (
            <span
              className={cn(
                'rounded px-2 py-0.5 text-xs font-medium uppercase tracking-wide',
                categoryStyle.className
              )}
            >
              {categoryStyle.label}
              {typeof detail.aiCategoryConfidence === 'number' && (
                <span className="ml-1 opacity-70">
                  {Math.round(detail.aiCategoryConfidence * 100)}%
                </span>
              )}
            </span>
          )}
          {detail.aiAnalyzedAt && (
            <span className="text-xs text-gray-500">
              · Analizado {formatRelative(detail.aiAnalyzedAt)}
            </span>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => runAnalysis(false)}
          disabled={analyzing}
        >
          <RefreshCw className={cn('mr-2 h-3.5 w-3.5', analyzing && 'animate-spin')} />
          {hasAnalysis ? 'Re-analizar' : 'Analizar con IA'}
        </Button>
      </div>

      {detail.aiSummary && (
        <p className="mb-2 text-xs italic text-gray-600 dark:text-gray-400">
          Resumen: {detail.aiSummary}
        </p>
      )}

      {hasAnalysis && (
        <>
          <Textarea
            value={editedDraft}
            onChange={(e) => setEditedDraft(e.target.value)}
            placeholder="Borrador de respuesta…"
            rows={6}
            className="bg-white dark:bg-gray-900"
          />
          <div className="mt-2 flex items-center justify-between gap-2 text-xs text-gray-500">
            <span>
              {detail.aiDrafterModel?.includes('sonnet') ? 'Sonnet' : detail.aiDrafterModel} ·{' '}
              {detail.aiClassifierModel?.includes('haiku') ? 'Haiku' : detail.aiClassifierModel}
              {cost !== null && <span> · ${cost.toFixed(4)}</span>}
            </span>
            <Button size="sm" variant="default" onClick={handleCopy} disabled={!editedDraft}>
              {copied ? (
                <>
                  <Check className="mr-1.5 h-3.5 w-3.5" />
                  Copiado
                </>
              ) : (
                <>
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                  Copiar
                </>
              )}
            </Button>
          </div>
        </>
      )}

      {!hasAnalysis && !analyzing && (
        <p className="text-xs text-gray-500">
          Esta conversación todavía no fue analizada. Hacé clic en &quot;Analizar con IA&quot; para
          obtener categoría y borrador de respuesta.
        </p>
      )}
    </section>
  )
}

function MessageBubble({
  message,
  channelType,
}: {
  message: MessageItem
  channelType: ChannelType
}) {
  const isInbound = message.direction === 'INBOUND'
  return (
    <div className={cn('flex', isInbound ? 'justify-start' : 'justify-end')}>
      <div
        className={cn(
          'max-w-[80%] rounded-lg px-3 py-2 text-sm shadow-sm',
          isInbound
            ? 'bg-white text-gray-900 dark:bg-gray-800 dark:text-gray-100'
            : channelType === 'WHATSAPP'
              ? 'bg-green-100 text-gray-900 dark:bg-green-900/40 dark:text-gray-100'
              : 'bg-blue-100 text-gray-900 dark:bg-blue-900/40 dark:text-gray-100'
        )}
      >
        {channelType === 'EMAIL' && message.bodyHtml ? (
          // eslint-disable-next-line react/no-danger
          <div
            className="prose prose-sm max-w-none dark:prose-invert"
            dangerouslySetInnerHTML={{ __html: message.bodyHtml }}
          />
        ) : (
          <p className="whitespace-pre-wrap break-words">{message.body}</p>
        )}
        <p className="mt-1 text-right text-[10px] text-gray-500">
          {message.sentAt
            ? new Date(message.sentAt).toLocaleString('es-AR', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })
            : ''}
        </p>
      </div>
    </div>
  )
}
