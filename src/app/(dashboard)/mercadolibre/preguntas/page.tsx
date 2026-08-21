'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
  X,
} from 'lucide-react'
import type { SerializedQuestion } from '@/lib/mercadolibre/serializeQuestion'

const STATUS_LABEL: Record<string, string> = {
  PENDING_REVIEW: 'Pendientes',
  ANSWERED: 'Respondidas',
  FAILED: 'Con error',
  DISMISSED: 'Descartadas',
  CLOSED: 'Cerradas',
  ALL: 'Todas',
}

const STATUS_COLOR: Record<string, string> = {
  PENDING_REVIEW: 'bg-yellow-100 text-yellow-800',
  ANSWERED: 'bg-green-100 text-green-800',
  FAILED: 'bg-red-100 text-red-800',
  DISMISSED: 'bg-gray-200 text-gray-700',
  CLOSED: 'bg-gray-200 text-gray-700',
}

const MAX_CHARS = 2000

function fmtDate(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
}

function QuestionCard({
  q,
  onChange,
}: {
  q: SerializedQuestion
  onChange: (updated: SerializedQuestion) => void
}) {
  const [text, setText] = useState(q.draftAnswer ?? '')
  const [busy, setBusy] = useState<null | 'send' | 'regen' | 'dismiss'>(null)

  useEffect(() => {
    setText(q.draftAnswer ?? '')
  }, [q.draftAnswer])

  const pending = q.status === 'PENDING_REVIEW' || q.status === 'FAILED'

  const call = async (action: 'responder' | 'regenerar' | 'descartar', body?: unknown) => {
    const res = await fetch(`/api/mercadolibre/preguntas/${q.id}/${action}`, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'Error')
    return data as SerializedQuestion
  }

  const send = async () => {
    if (!text.trim()) return toast.error('La respuesta está vacía')
    setBusy('send')
    try {
      const updated = await call('responder', { text })
      if (updated.status === 'ANSWERED') toast.success('Respuesta publicada en Mercado Libre')
      else toast.error(`No se pudo publicar: ${updated.errorDetail ?? updated.status}`)
      onChange(updated)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al responder')
    } finally {
      setBusy(null)
    }
  }

  const regen = async () => {
    setBusy('regen')
    try {
      const updated = await call('regenerar')
      toast.success('Borrador regenerado')
      onChange(updated)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al regenerar')
    } finally {
      setBusy(null)
    }
  }

  const dismiss = async () => {
    setBusy('dismiss')
    try {
      const updated = await call('descartar')
      onChange(updated)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al descartar')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className={q.needsReview && pending ? 'border-amber-300' : undefined}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base leading-snug break-words">
              {q.itemTitle ?? q.mlItemId}
            </CardTitle>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <a
                href={`https://articulo.mercadolibre.com.ar/${q.mlItemId.replace(/^MLA/, 'MLA-')}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:underline"
              >
                {q.mlItemId} <ExternalLink className="h-3 w-3" />
              </a>
              {q.itemSku && <span>SKU {q.itemSku}</span>}
              {q.productId ? (
                <Badge variant="outline" className="text-[10px]">
                  producto ERP vinculado
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] text-muted-foreground">
                  sin producto ERP
                </Badge>
              )}
              <span>· {fmtDate(q.askedAt ?? q.createdAt)}</span>
            </div>
          </div>
          <Badge className={STATUS_COLOR[q.status] ?? ''}>{STATUS_LABEL[q.status] ?? q.status}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md bg-muted/50 p-3 text-sm">
          <div className="mb-1 text-xs font-medium text-muted-foreground">Pregunta</div>
          <div className="whitespace-pre-wrap break-words">{q.questionText}</div>
        </div>

        {q.needsReview && pending && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              <b>La IA pide revisión:</b> {q.reviewReason ?? 'verificar antes de publicar'}
            </span>
          </div>
        )}

        {q.errorDetail && (
          <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800 break-words">
            {q.errorDetail}
          </div>
        )}

        {pending ? (
          <>
            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Sparkles className="h-3 w-3" /> Respuesta propuesta (editable)
                </span>
                <span className={text.length > MAX_CHARS ? 'text-red-600' : ''}>
                  {text.length}/{MAX_CHARS}
                </span>
              </div>
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                disabled={busy !== null}
                placeholder={
                  q.draftAnswer ? '' : 'No hay borrador. Regenerá o escribí la respuesta a mano.'
                }
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={send}
                disabled={busy !== null || !text.trim() || text.length > MAX_CHARS}
              >
                {busy === 'send' ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-1 h-4 w-4" />
                )}
                Publicar respuesta
              </Button>
              <Button size="sm" variant="outline" onClick={regen} disabled={busy !== null}>
                {busy === 'regen' ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1 h-4 w-4" />
                )}
                Regenerar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={dismiss}
                disabled={busy !== null}
                className="text-muted-foreground"
              >
                <X className="mr-1 h-4 w-4" /> Descartar
              </Button>
            </div>
          </>
        ) : (
          q.answerText && (
            <div className="rounded-md border p-3 text-sm">
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                Respuesta publicada {q.answeredAt ? `· ${fmtDate(q.answeredAt)}` : ''}
              </div>
              <div className="whitespace-pre-wrap break-words">{q.answerText}</div>
            </div>
          )
        )}
      </CardContent>
    </Card>
  )
}

export default function PreguntasMlPage() {
  const [items, setItems] = useState<SerializedQuestion[]>([])
  const [status, setStatus] = useState('PENDING_REVIEW')
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(1)
  const [total, setTotal] = useState(0)
  const [pendingCount, setPendingCount] = useState(0)
  const [mode, setMode] = useState('REVIEW')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/mercadolibre/preguntas?status=${status}&page=${page}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error')
      setItems(data.items)
      setPageCount(data.pageCount)
      setTotal(data.total)
      setPendingCount(data.pendingCount)
      setMode(data.mode)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al cargar')
    } finally {
      setLoading(false)
    }
  }, [status, page])

  useEffect(() => {
    load()
  }, [load])

  const sync = async () => {
    setSyncing(true)
    try {
      const res = await fetch('/api/mercadolibre/preguntas/sync', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error')
      toast.success(`${data.found} sin responder en ML · ${data.created} nuevas con borrador`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al sincronizar')
    } finally {
      setSyncing(false)
    }
  }

  const onChange = (updated: SerializedQuestion) => {
    setItems((prev) =>
      status === 'ALL' || updated.status === status
        ? prev.map((x) => (x.id === updated.id ? updated : x))
        : prev.filter((x) => x.id !== updated.id)
    )
    if (updated.status !== 'PENDING_REVIEW') setPendingCount((c) => Math.max(0, c - 1))
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Preguntas de Mercado Libre</h1>
          <p className="text-sm text-muted-foreground">
            La IA propone una respuesta por cada pregunta; revisá, editá y publicá.
            {' '}Modo: <b>{mode === 'AUTO' ? 'automático (publica sola salvo que pida revisión)' : 'revisión manual'}</b>
            {pendingCount > 0 && <> · <b>{pendingCount}</b> pendientes</>}
          </p>
        </div>
        <Button variant="outline" onClick={sync} disabled={syncing}>
          {syncing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Sincronizar con ML
        </Button>
      </div>

      <Tabs
        value={status}
        onValueChange={(v) => {
          setStatus(v)
          setPage(1)
        }}
      >
        <TabsList className="flex-wrap">
          {['PENDING_REVIEW', 'ANSWERED', 'FAILED', 'DISMISSED', 'ALL'].map((s) => (
            <TabsTrigger key={s} value={s}>
              {STATUS_LABEL[s]}
              {s === 'PENDING_REVIEW' && pendingCount > 0 && (
                <span className="ml-1 rounded-full bg-yellow-200 px-1.5 text-[10px] text-yellow-900">
                  {pendingCount}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="flex items-center gap-2 py-10 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            {status === 'PENDING_REVIEW'
              ? 'No hay preguntas pendientes. Usá "Sincronizar con ML" para traer las que haya sin responder.'
              : 'Sin resultados.'}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((q) => (
            <QuestionCard key={q.id} q={q} onChange={onChange} />
          ))}
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {total} preguntas · página {page} de {pageCount}
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pageCount}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
