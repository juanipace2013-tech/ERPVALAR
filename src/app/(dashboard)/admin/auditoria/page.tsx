'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
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
import {
  Shield,
  Search,
  Download,
  ChevronLeft,
  ChevronRight,
  Loader2,
  FileText,
  Truck,
  Receipt,
  Users,
  Activity,
} from 'lucide-react'

interface AuditLog {
  id: string
  userId: string
  userName: string
  userEmail: string
  action: string
  entity: string
  entityId: string | null
  entityRef: string | null
  description: string
  ip: string | null
  createdAt: string
}

interface AuditUser {
  userId: string
  userName: string
}

const ENTITY_OPTIONS = [
  { value: 'ALL', label: 'Todas' },
  { value: 'QUOTE', label: 'Cotizaciones' },
  { value: 'DELIVERY_NOTE', label: 'Remitos' },
  { value: 'INVOICE', label: 'Facturas' },
  { value: 'CLIENT', label: 'Clientes' },
]

const ACTION_COLORS: Record<string, string> = {
  CREATE: 'bg-green-100 text-green-800',
  UPDATE: 'bg-blue-100 text-blue-800',
  DELETE: 'bg-red-100 text-red-800',
  SEND: 'bg-purple-100 text-purple-800',
  SYNC: 'bg-amber-100 text-amber-800',
  STATUS_CHANGE: 'bg-cyan-100 text-cyan-800',
  UPLOAD: 'bg-indigo-100 text-indigo-800',
  APPROVE: 'bg-emerald-100 text-emerald-800',
}

const ENTITY_ICONS: Record<string, React.ReactNode> = {
  QUOTE: <FileText className="h-4 w-4" />,
  DELIVERY_NOTE: <Truck className="h-4 w-4" />,
  INVOICE: <Receipt className="h-4 w-4" />,
  CLIENT: <Users className="h-4 w-4" />,
}

const ENTITY_LABELS: Record<string, string> = {
  QUOTE: 'Cotización',
  DELIVERY_NOTE: 'Remito',
  INVOICE: 'Factura',
  CLIENT: 'Cliente',
}

const ACTION_LABELS: Record<string, string> = {
  CREATE: 'Crear',
  UPDATE: 'Editar',
  DELETE: 'Eliminar',
  SEND: 'Enviar',
  SYNC: 'Sincronizar',
  STATUS_CHANGE: 'Cambio estado',
  UPLOAD: 'Subir archivo',
  APPROVE: 'Aprobar',
}

const ALLOWED_EMAILS = ['stejedor@val-ar.com.ar', 'jpace@val-ar.com.ar']

export default function AuditoriaPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [users, setUsers] = useState<AuditUser[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)

  // Filtros
  const [entity, setEntity] = useState('ALL')
  const [userId, setUserId] = useState('ALL')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')

  const loadLogs = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: '50',
      })
      if (entity !== 'ALL') params.set('entity', entity)
      if (userId !== 'ALL') params.set('userId', userId)
      if (dateFrom) params.set('dateFrom', dateFrom)
      if (dateTo) params.set('dateTo', dateTo)
      if (search) params.set('search', search)

      const res = await fetch(`/api/admin/audit?${params}`)
      if (res.status === 403) {
        router.push('/dashboard')
        return
      }
      if (!res.ok) throw new Error('Error al cargar logs')

      const data = await res.json()
      setLogs(data.logs)
      setTotalPages(data.pagination.totalPages)
      setTotal(data.pagination.total)
      if (data.users) setUsers(data.users)
    } catch (error) {
      toast.error('Error al cargar logs de auditoría')
    } finally {
      setLoading(false)
    }
  }, [page, entity, userId, dateFrom, dateTo, search, router])

  useEffect(() => {
    if (session && !ALLOWED_EMAILS.includes(session.user?.email || '')) {
      router.push('/dashboard')
      return
    }
    if (session) loadLogs()
  }, [session, loadLogs, router])

  const handleSearch = () => {
    setSearch(searchInput)
    setPage(1)
  }

  const handleExportCsv = async () => {
    try {
      const params = new URLSearchParams({ format: 'csv' })
      if (entity !== 'ALL') params.set('entity', entity)
      if (userId !== 'ALL') params.set('userId', userId)
      if (dateFrom) params.set('dateFrom', dateFrom)
      if (dateTo) params.set('dateTo', dateTo)
      if (search) params.set('search', search)

      const res = await fetch(`/api/admin/audit?${params}`)
      if (!res.ok) throw new Error('Error al exportar')

      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `auditoria_${new Date().toISOString().split('T')[0]}.csv`
      a.click()
      window.URL.revokeObjectURL(url)
      toast.success('CSV descargado')
    } catch {
      toast.error('Error al exportar CSV')
    }
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  if (!ALLOWED_EMAILS.includes(session?.user?.email || '')) {
    return null
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-100 rounded-full">
            <Shield className="h-6 w-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Auditoría de Acceso</h1>
            <p className="text-gray-600">
              Registro de acciones realizadas en el sistema
              {total > 0 && <span className="ml-2 text-sm text-gray-400">({total} registros)</span>}
            </p>
          </div>
        </div>
        <Button onClick={handleExportCsv} variant="outline" className="gap-2">
          <Download className="h-4 w-4" />
          Exportar CSV
        </Button>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Búsqueda */}
            <div className="lg:col-span-2">
              <div className="flex gap-2">
                <Input
                  placeholder="Buscar por descripción, referencia o usuario..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />
                <Button onClick={handleSearch} size="icon" variant="secondary">
                  <Search className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Entidad */}
            <Select value={entity} onValueChange={(v) => { setEntity(v); setPage(1) }}>
              <SelectTrigger>
                <SelectValue placeholder="Entidad" />
              </SelectTrigger>
              <SelectContent>
                {ENTITY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Usuario */}
            <Select value={userId} onValueChange={(v) => { setUserId(v); setPage(1) }}>
              <SelectTrigger>
                <SelectValue placeholder="Usuario" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.userId} value={u.userId}>
                    {u.userName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Fechas */}
            <div className="flex gap-2">
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
                className="text-sm"
              />
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
                className="text-sm"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabla */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <Activity className="h-12 w-12 mb-3" />
              <p className="text-lg font-medium">No hay registros de auditoría</p>
              <p className="text-sm">Los logs aparecerán cuando se realicen acciones en el sistema</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <TableHead className="w-[160px]">Fecha</TableHead>
                  <TableHead className="w-[150px]">Usuario</TableHead>
                  <TableHead className="w-[120px]">Acción</TableHead>
                  <TableHead className="w-[120px]">Entidad</TableHead>
                  <TableHead className="w-[140px]">Referencia</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead className="w-[110px]">IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id} className="hover:bg-gray-50/50">
                    <TableCell className="text-sm text-gray-600 whitespace-nowrap">
                      {formatDate(log.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium">{log.userName}</p>
                        <p className="text-xs text-gray-400">{log.userEmail}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={`text-xs ${ACTION_COLORS[log.action] || 'bg-gray-100 text-gray-800'}`}
                      >
                        {ACTION_LABELS[log.action] || log.action}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-sm text-gray-600">
                        {ENTITY_ICONS[log.entity] || null}
                        <span>{ENTITY_LABELS[log.entity] || log.entity}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {log.entityRef && (
                        <code className="text-xs bg-gray-100 px-2 py-0.5 rounded font-mono">
                          {log.entityRef}
                        </code>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-gray-700 max-w-[400px] truncate">
                      {log.description}
                    </TableCell>
                    <TableCell className="text-xs text-gray-400 font-mono">
                      {log.ip || '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>

        {/* Paginación */}
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
    </div>
  )
}
