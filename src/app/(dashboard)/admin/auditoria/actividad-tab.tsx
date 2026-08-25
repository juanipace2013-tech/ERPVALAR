'use client'

/**
 * Pestaña "Actividad" de /admin/auditoria: quién está en línea ahora (y en qué
 * pantalla), resumen del día por usuario y el historial de navegación con
 * filtros. Los datos vienen de /api/admin/activity y se refrescan solos cada
 * 60 s (solo la parte de presencia importa el refresco; el resto acompaña).
 */

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Loader2, Radio } from 'lucide-react'

interface OnlineUser {
  id: string
  name: string
  lastSeenAt: string
  lastPath: string | null
}

interface ActivityRow {
  id: string
  userId: string
  userName: string
  path: string
  createdAt: string
}

interface SummaryRow {
  userId: string
  userName: string
  views: number
  first: string
  last: string
  topPages: { path: string; count: number }[]
}

interface ActivityUser {
  userId: string
  userName: string
}

const SECTION_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  cotizaciones: 'Cotizaciones',
  remitos: 'Remitos',
  facturacion: 'Facturación',
  facturas: 'Facturas',
  clientes: 'Clientes',
  productos: 'Productos',
  comisiones: 'Comisiones',
  proveedores: 'Proveedores',
  compras: 'Compras',
  inbox: 'Inbox',
  herramientas: 'Herramientas',
  mercadolibre: 'Mercado Libre',
  viandas: 'Viandas',
  admin: 'Admin',
  contabilidad: 'Contabilidad',
}

/** "/cotizaciones/cmt123abc" -> "Cotizaciones › detalle" */
function friendlyPath(path: string): string {
  const segs = path.split('/').filter(Boolean)
  if (segs.length === 0) return 'Inicio'
  const label = SECTION_LABELS[segs[0]] || segs[0]
  const rest = segs.slice(1).map((s) => {
    if (/^[a-z0-9]{20,}$/i.test(s) || /^\d+$/.test(s)) return 'detalle'
    return SECTION_LABELS[s] || s.replace(/-/g, ' ')
  })
  return [label, ...rest].join(' › ')
}

function timeAgo(dateStr: string): string {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
  if (mins < 1) return 'ahora'
  if (mins === 1) return 'hace 1 min'
  return `hace ${mins} min`
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function ActividadTab() {
  const [loading, setLoading] = useState(true)
  const [online, setOnline] = useState<OnlineUser[]>([])
  const [feed, setFeed] = useState<ActivityRow[]>([])
  const [summary, setSummary] = useState<SummaryRow[]>([])
  const [summaryDate, setSummaryDate] = useState('')
  const [users, setUsers] = useState<ActivityUser[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [userId, setUserId] = useState('ALL')
  const [date, setDate] = useState('')

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      try {
        const params = new URLSearchParams({ page: page.toString() })
        if (userId !== 'ALL') params.set('userId', userId)
        if (date) params.set('date', date)
        const res = await fetch(`/api/admin/activity?${params}`)
        if (!res.ok) throw new Error()
        const data = await res.json()
        setOnline(data.online)
        setFeed(data.feed)
        setSummary(data.summary)
        setSummaryDate(data.summaryDate)
        setUsers(data.users)
        setTotalPages(data.pagination.totalPages)
        setTotal(data.pagination.total)
      } catch {
        if (!silent) toast.error('Error al cargar actividad')
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [page, userId, date]
  )

  useEffect(() => {
    load()
  }, [load])

  // Refresco silencioso de presencia cada 60 s.
  useEffect(() => {
    const id = setInterval(() => load(true), 60_000)
    return () => clearInterval(id)
  }, [load])

  return (
    <div className="space-y-6">
      {/* En línea ahora */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Radio className="h-4 w-4 text-green-600" />
            En línea ahora
            <span className="text-sm font-normal text-gray-400">
              (activos en los últimos 5 minutos)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {online.length === 0 ? (
            <p className="text-sm text-gray-400">Nadie activo en este momento</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {online.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center gap-2.5 rounded-lg border bg-green-50/50 px-3 py-2"
                >
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
                  </span>
                  <div>
                    <p className="text-sm font-medium leading-tight">{u.name}</p>
                    <p className="text-xs text-gray-500 leading-tight">
                      {u.lastPath ? friendlyPath(u.lastPath) : '—'} · {timeAgo(u.lastSeenAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Filtros */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4">
            <Select value={userId} onValueChange={(v) => { setUserId(v); setPage(1) }}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Usuario" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos los usuarios</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.userId} value={u.userId}>
                    {u.userName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={date}
              onChange={(e) => { setDate(e.target.value); setPage(1) }}
              className="w-[180px] text-sm"
            />
            {(userId !== 'ALL' || date) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setUserId('ALL'); setDate(''); setPage(1) }}
              >
                Limpiar filtros
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      ) : (
        <>
          {/* Resumen del día */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Resumen del {summaryDate.split('-').reverse().join('/')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {summary.length === 0 ? (
                <p className="text-sm text-gray-400">Sin actividad registrada ese día</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {summary.map((s) => (
                    <div key={s.userId} className="rounded-lg border p-4">
                      <div className="flex items-center justify-between mb-2">
                        <p className="font-medium text-sm">{s.userName}</p>
                        <Badge variant="secondary" className="text-xs">
                          {s.views} vistas
                        </Badge>
                      </div>
                      <p className="text-xs text-gray-500 mb-2">
                        {formatTime(s.first)} — {formatTime(s.last)} hs
                      </p>
                      <div className="space-y-1">
                        {s.topPages.map((p) => (
                          <div key={p.path} className="flex justify-between text-xs">
                            <span className="text-gray-600 truncate mr-2">
                              {friendlyPath(p.path)}
                            </span>
                            <span className="text-gray-400 shrink-0">{p.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Historial */}
          <Card>
            <CardContent className="p-0">
              {feed.length === 0 ? (
                <div className="py-16 text-center text-sm text-gray-400">
                  No hay navegación registrada con esos filtros
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50">
                      <TableHead className="w-[140px]">Fecha / hora</TableHead>
                      <TableHead className="w-[180px]">Usuario</TableHead>
                      <TableHead>Página</TableHead>
                      <TableHead className="w-[260px]">Ruta</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {feed.map((row) => (
                      <TableRow key={row.id} className="hover:bg-gray-50/50">
                        <TableCell className="text-sm text-gray-600 whitespace-nowrap">
                          {formatDateTime(row.createdAt)}
                        </TableCell>
                        <TableCell className="text-sm font-medium">{row.userName}</TableCell>
                        <TableCell className="text-sm text-gray-700">
                          {friendlyPath(row.path)}
                        </TableCell>
                        <TableCell>
                          <code className="text-xs bg-gray-100 px-2 py-0.5 rounded font-mono">
                            {row.path}
                          </code>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-4 border-t">
                <p className="text-sm text-gray-500">
                  Página {page} de {totalPages} ({total} registros)
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage(page + 1)}
                  >
                    Siguiente
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
