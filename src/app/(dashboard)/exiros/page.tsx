'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Search,
  RefreshCw,
  Loader2,
  Gavel,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  CheckCircle2,
  EyeOff,
  XCircle,
  Undo2,
  AlertTriangle,
  Clock,
  Globe,
  Upload,
  FileSpreadsheet,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  deepLinkExiros,
  EXIROS_PORTAL_URL,
  PLATAFORMA_FILTRO_OPCIONES,
} from '@/lib/exiros/constants'

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface ExirosItem {
  id: string
  nro: number
  descCorta: string
  descLarga: string | null
  cantidad: number | null
  unidad: string | null
  cliente: string | null
  fechaRequerida: string | null
  quePide: string | null
  match: string | null
}

interface Licitacion {
  id: string
  numero: string
  plataforma: string
  idInterno: number | null
  linkPortal: string | null
  titulo: string
  empresa: string | null
  comprador: string | null
  clienteFinal: string | null
  cierre: string | null
  veredicto: string
  confianza: number | null
  razon: string | null
  estado: string
  estadoEfectivo: string
  origen: string | null
  declineMsg: string | null
  items: ExirosItem[]
}

const EMPRESAS = ['EXIROS', 'TENARIS', 'TERNIUM', 'TECHINT', 'TECPETROL', 'PAMPA ENERGIA']

const ESTADOS_FILTRO = [
  { value: 'NUEVA', label: 'Nueva' },
  { value: 'EN_PROCESO', label: 'En proceso' },
  { value: 'COTIZADA', label: 'Cotizada' },
  { value: 'DECLINAR_PENDIENTE', label: 'En cola para declinar' },
  { value: 'DECLINADA', label: 'Declinada' },
  { value: 'DECLINE_ERROR', label: 'Error al declinar' },
  { value: 'IGNORADA', label: 'Ignorada' },
  { value: 'VENCIDA', label: 'Vencida' },
]

// ─── Badges ──────────────────────────────────────────────────────────────────

function VeredictoBadge({ veredicto }: { veredicto: string }) {
  const styles: Record<string, string> = {
    COTIZAR: 'bg-green-100 text-green-800 border-green-300',
    REVISAR: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    DECLINAR: 'bg-red-100 text-red-800 border-red-300',
  }
  return (
    <Badge variant="outline" className={styles[veredicto] || 'bg-gray-100 text-gray-700'}>
      {veredicto}
    </Badge>
  )
}

function EstadoBadge({ estado }: { estado: string }) {
  const config: Record<string, { label: string; className: string }> = {
    NUEVA: { label: 'Nueva', className: 'bg-blue-100 text-blue-800 border-blue-300' },
    EN_PROCESO: { label: 'En proceso', className: 'bg-indigo-100 text-indigo-800 border-indigo-300' },
    COTIZADA: { label: 'Cotizada', className: 'bg-green-100 text-green-800 border-green-300' },
    DECLINAR_PENDIENTE: { label: 'En cola para declinar…', className: 'bg-orange-100 text-orange-800 border-orange-300' },
    DECLINADA: { label: 'Declinada', className: 'bg-gray-200 text-gray-700 border-gray-300' },
    DECLINE_ERROR: { label: 'Error al declinar', className: 'bg-red-100 text-red-800 border-red-300' },
    IGNORADA: { label: 'Ignorada', className: 'bg-gray-100 text-gray-500 border-gray-200' },
    VENCIDA: { label: 'Vencida', className: 'bg-gray-100 text-gray-500 border-gray-200' },
  }
  const c = config[estado] || { label: estado, className: 'bg-gray-100 text-gray-700' }
  return (
    <Badge variant="outline" className={c.className}>
      {c.label}
    </Badge>
  )
}

// Countdown al cierre: "2d 6h" — rojo si falta < 24h, naranja si < 48h.
// `now` viene del reloj de la página (estado, no Date.now() en render).
function CierreCountdown({ cierre, now }: { cierre: string | null; now: number | null }) {
  if (!cierre) return <span className="text-gray-400">—</span>

  const fecha = new Date(cierre).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

  // Antes del primer tick del reloj (SSR/hidratación) mostramos solo la fecha.
  if (now === null) {
    return <div className="text-xs text-gray-400">{fecha}</div>
  }

  const ms = new Date(cierre).getTime() - now

  if (ms <= 0) {
    return (
      <div className="text-gray-400">
        <div className="text-xs">{fecha}</div>
        <span className="text-xs font-medium">Vencida</span>
      </div>
    )
  }

  const horasTotales = Math.floor(ms / 3_600_000)
  const dias = Math.floor(horasTotales / 24)
  const horas = horasTotales % 24
  const countdown = dias > 0 ? `${dias}d ${horas}h` : `${horas}h`

  const color =
    horasTotales < 24 ? 'text-red-600' : horasTotales < 48 ? 'text-orange-500' : 'text-gray-700'

  return (
    <div>
      <div className="text-xs text-gray-400">{fecha}</div>
      <span className={`text-sm font-semibold inline-flex items-center gap-1 ${color}`}>
        <Clock className="h-3 w-3" />
        {countdown}
      </span>
    </div>
  )
}

// ─── Página ──────────────────────────────────────────────────────────────────

export default function ExirosPage() {
  const [licitaciones, setLicitaciones] = useState<Licitacion[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filtroVeredicto, setFiltroVeredicto] = useState('todos')
  const [filtroEstado, setFiltroEstado] = useState('activas') // default: oculta IGNORADA y VENCIDA
  const [filtroEmpresa, setFiltroEmpresa] = useState('todas')
  const [filtroPlataforma, setFiltroPlataforma] = useState('todas')
  const [expanded, setExpanded] = useState<string[]>([])
  const [declineTarget, setDeclineTarget] = useState<Licitacion | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null) // numero en vuelo
  const [importTarget, setImportTarget] = useState<Licitacion | null>(null)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [now, setNow] = useState<number | null>(null)

  // Reloj para los countdowns de cierre (refresca cada minuto)
  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 300)
    return () => clearTimeout(t)
  }, [searchQuery])

  const fetchLicitaciones = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filtroVeredicto !== 'todos') params.set('veredicto', filtroVeredicto)
      if (filtroEmpresa !== 'todas') params.set('empresa', filtroEmpresa)
      if (filtroPlataforma !== 'todas') params.set('plataforma', filtroPlataforma)
      if (debouncedSearch) params.set('search', debouncedSearch)
      const res = await fetch(`/api/exiros/licitaciones?${params}`)
      if (!res.ok) throw new Error('Error al cargar licitaciones')
      const data = await res.json()
      setLicitaciones(data.licitaciones || [])
    } catch {
      toast.error('Error al cargar las licitaciones')
    } finally {
      setLoading(false)
    }
  }, [filtroVeredicto, filtroEmpresa, filtroPlataforma, debouncedSearch])

  useEffect(() => {
    fetchLicitaciones()
  }, [fetchLicitaciones])

  // Filtro por estado client-side (sobre estadoEfectivo, que ya computa VENCIDA)
  const display = useMemo(() => {
    if (filtroEstado === 'activas') {
      return licitaciones.filter(
        (l) => l.estadoEfectivo !== 'IGNORADA' && l.estadoEfectivo !== 'VENCIDA'
      )
    }
    if (filtroEstado === 'todas') return licitaciones
    return licitaciones.filter((l) => l.estadoEfectivo === filtroEstado)
  }, [licitaciones, filtroEstado])

  const toggleExpand = (numero: string) => {
    setExpanded((prev) =>
      prev.includes(numero) ? prev.filter((n) => n !== numero) : [...prev, numero]
    )
  }

  const cambiarEstado = async (numero: string, estado: string, mensajeOk: string) => {
    setActionLoading(numero)
    try {
      const res = await fetch(`/api/exiros/licitaciones/${encodeURIComponent(numero)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al actualizar')
      toast.success(mensajeOk)
      fetchLicitaciones()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al actualizar')
    } finally {
      setActionLoading(null)
    }
  }

  const confirmarDecline = async () => {
    if (!declineTarget) return
    const numero = declineTarget.numero
    setDeclineTarget(null)
    await cambiarEstado(numero, 'DECLINAR_PENDIENTE', `Licitación ${numero} encolada para declinar`)
  }

  const confirmarImport = async () => {
    if (!importTarget || !importFile) return
    setImporting(true)
    try {
      const formData = new FormData()
      formData.append('file', importFile)
      const res = await fetch(
        `/api/exiros/licitaciones/${encodeURIComponent(importTarget.numero)}/importar-excel`,
        { method: 'POST', body: formData }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al importar')

      const partes = [`${data.itemsImportados} ítem(s) importados`]
      if (data.veredicto) partes.push(`veredicto ${data.veredicto} ${data.confianza}%`)
      toast.success(partes.join(', '))
      if (data.iaError) {
        toast.warning('Los ítems se importaron pero la re-clasificación IA falló', {
          description: data.iaError,
        })
      }
      setImportTarget(null)
      setImportFile(null)
      fetchLicitaciones()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al importar')
    } finally {
      setImporting(false)
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Gavel className="h-8 w-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-blue-900">Licitaciones</h1>
            <p className="text-gray-500 text-sm">
              Exiros y Ariba (Pampa), clasificadas con IA
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={fetchLicitaciones} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refrescar
        </Button>
      </div>

      {/* Filtros */}
      <Card className="border-blue-200">
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[250px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Buscar por número o título..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <div className="min-w-[150px]">
              <label className="text-xs text-gray-500 mb-1 block">Veredicto IA</label>
              <Select value={filtroVeredicto} onValueChange={setFiltroVeredicto}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="COTIZAR">Cotizar</SelectItem>
                  <SelectItem value="REVISAR">Revisar</SelectItem>
                  <SelectItem value="DECLINAR">Declinar</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="min-w-[180px]">
              <label className="text-xs text-gray-500 mb-1 block">Estado</label>
              <Select value={filtroEstado} onValueChange={setFiltroEstado}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="activas">Activas (sin ignoradas/vencidas)</SelectItem>
                  <SelectItem value="todas">Todas</SelectItem>
                  {ESTADOS_FILTRO.map((e) => (
                    <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="min-w-[150px]">
              <label className="text-xs text-gray-500 mb-1 block">Empresa</label>
              <Select value={filtroEmpresa} onValueChange={setFiltroEmpresa}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {EMPRESAS.map((e) => (
                    <SelectItem key={e} value={e}>{e}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="min-w-[150px]">
              <label className="text-xs text-gray-500 mb-1 block">Plataforma</label>
              <Select value={filtroPlataforma} onValueChange={setFiltroPlataforma}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {PLATAFORMA_FILTRO_OPCIONES.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <span className="text-xs text-gray-500 pb-1 ml-auto whitespace-nowrap">
              {display.length} licitaciones
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Tabla */}
      <Card className="border-blue-200">
        <CardContent className="p-0">
          {loading && display.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 className="h-10 w-10 animate-spin text-blue-600 mb-3" />
              <p className="text-gray-500">Cargando licitaciones...</p>
            </div>
          ) : display.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <Gavel className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <p>No hay licitaciones con los filtros aplicados</p>
            </div>
          ) : (
            <div className={`overflow-x-auto ${loading ? 'opacity-50 pointer-events-none' : ''}`}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Número</TableHead>
                    <TableHead>Título</TableHead>
                    <TableHead>Empresa</TableHead>
                    <TableHead>Cliente final</TableHead>
                    <TableHead>Comprador</TableHead>
                    <TableHead>Cierre</TableHead>
                    <TableHead>Veredicto</TableHead>
                    <TableHead className="text-center">Conf.</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {display.map((lic) => {
                    const isExpanded = expanded.includes(lic.numero)
                    // Sin link en vencidas o estados terminales (no hay nada que
                    // hacer en el portal). Ariba trae linkPortal en el mail;
                    // Exiros lo construye con el idInterno del Bidding Point.
                    const sinLink = ['VENCIDA', 'COTIZADA', 'IGNORADA', 'DECLINADA', 'DECLINE_ERROR'].includes(
                      lic.estadoEfectivo
                    )
                    const link = sinLink ? null : lic.linkPortal || deepLinkExiros(lic.idInterno)
                    const busy = actionLoading === lic.numero
                    const accionable =
                      lic.estadoEfectivo === 'NUEVA' || lic.estadoEfectivo === 'EN_PROCESO'
                    return (
                      <ExirosRow
                        key={lic.id}
                        lic={lic}
                        link={link}
                        now={now}
                        isExpanded={isExpanded}
                        busy={busy}
                        accionable={accionable}
                        onToggle={() => toggleExpand(lic.numero)}
                        onCotizada={() =>
                          cambiarEstado(lic.numero, 'COTIZADA', `${lic.numero} marcada como cotizada`)
                        }
                        onIgnorar={() =>
                          cambiarEstado(lic.numero, 'IGNORADA', `${lic.numero} ignorada`)
                        }
                        onDeclinar={() => setDeclineTarget(lic)}
                        onCancelarDecline={() =>
                          cambiarEstado(lic.numero, 'NUEVA', `Decline de ${lic.numero} cancelado`)
                        }
                        onDeshacer={() =>
                          cambiarEstado(lic.numero, 'NUEVA', `${lic.numero} vuelve a Nueva`)
                        }
                        onImportar={() => {
                          setImportFile(null)
                          setImportTarget(lic)
                        }}
                      />
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog de confirmación de decline */}
      <Dialog open={declineTarget !== null} onOpenChange={(open) => !open && setDeclineTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              Declinar invitación
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 pt-2">
                <div>
                  <span className="font-semibold text-gray-900">
                    #{declineTarget?.numero}
                  </span>{' '}
                  — {declineTarget?.titulo}
                </div>
                {declineTarget?.razon && (
                  <div className="text-sm bg-gray-50 border rounded-md p-3">
                    <span className="font-medium text-gray-700">Análisis de la IA:</span>{' '}
                    {declineTarget.razon}
                  </div>
                )}
                <div className="flex items-start gap-2 text-red-600 text-sm font-medium">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  Esta acción se ejecutará en el portal de Exiros y es irreversible.
                </div>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeclineTarget(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={confirmarDecline}>
              <XCircle className="h-4 w-4 mr-2" />
              Declinar invitación
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog de importación de Excel de Ariba */}
      <Dialog
        open={importTarget !== null}
        onOpenChange={(open) => {
          if (!open && !importing) {
            setImportTarget(null)
            setImportFile(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-green-700" />
              Importar Excel del evento
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 pt-2">
                <div>
                  <span className="font-semibold text-gray-900">#{importTarget?.numero}</span>{' '}
                  — {importTarget?.titulo}
                </div>
                <p className="text-sm text-gray-600">
                  En Ariba: <span className="font-medium">Descargar contenido → Excel</span>.
                  Se cargan los ítems del evento, los requisitos de papeleo, y se
                  re-clasifica con IA usando el detalle completo.
                </p>
                <input
                  type="file"
                  accept=".xls,.xlsx"
                  disabled={importing}
                  onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100"
                />
                {importTarget && importTarget.items.length > 0 && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                    Esta licitación ya tiene {importTarget.items.length} ítem(s): se
                    reemplazan por los del archivo.
                  </p>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setImportTarget(null)
                setImportFile(null)
              }}
              disabled={importing}
            >
              Cancelar
            </Button>
            <Button onClick={confirmarImport} disabled={!importFile || importing}>
              {importing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-2" />
              )}
              {importing ? 'Importando...' : 'Importar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Fila (con expansión) ────────────────────────────────────────────────────

function ExirosRow({
  lic,
  link,
  now,
  isExpanded,
  busy,
  accionable,
  onToggle,
  onCotizada,
  onIgnorar,
  onDeclinar,
  onCancelarDecline,
  onDeshacer,
  onImportar,
}: {
  lic: Licitacion
  link: string | null
  now: number | null
  isExpanded: boolean
  busy: boolean
  accionable: boolean
  onToggle: () => void
  onCotizada: () => void
  onIgnorar: () => void
  onDeclinar: () => void
  onCancelarDecline: () => void
  onDeshacer: () => void
  onImportar: () => void
}) {
  const esAriba = lic.plataforma.startsWith('ARIBA')
  return (
    <>
      <TableRow className="cursor-pointer hover:bg-blue-50/50" onClick={onToggle}>
        <TableCell className="pr-0">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-400" />
          )}
        </TableCell>
        <TableCell className="font-medium whitespace-nowrap">
          {link ? (
            <span className="inline-flex items-center gap-1.5">
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline inline-flex items-center gap-1"
                onClick={(e) => e.stopPropagation()}
                title={
                  lic.plataforma === 'EXIROS'
                    ? 'Requiere sesión activa en el Bidding Point — si da error, entrá primero por Portal'
                    : undefined
                }
              >
                {lic.numero}
                <ExternalLink className="h-3 w-3" />
              </a>
              {lic.plataforma === 'EXIROS' && (
                <a
                  href={EXIROS_PORTAL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 hover:text-blue-600"
                  onClick={(e) => e.stopPropagation()}
                  title="Abrir el portal de proveedores de Exiros (iniciar sesión)"
                >
                  <Globe className="h-3.5 w-3.5" />
                </a>
              )}
            </span>
          ) : (
            lic.numero
          )}
        </TableCell>
        <TableCell className="max-w-[280px]">
          <span className="block truncate" title={lic.titulo}>{lic.titulo}</span>
        </TableCell>
        <TableCell className="whitespace-nowrap">{lic.empresa || '—'}</TableCell>
        <TableCell className="max-w-[160px]">
          <span className="block truncate" title={lic.clienteFinal || ''}>
            {lic.clienteFinal || '—'}
          </span>
        </TableCell>
        <TableCell className="max-w-[140px]">
          <span className="block truncate" title={lic.comprador || ''}>
            {lic.comprador || '—'}
          </span>
        </TableCell>
        <TableCell className="whitespace-nowrap">
          <CierreCountdown cierre={lic.cierre} now={now} />
        </TableCell>
        <TableCell>
          <VeredictoBadge veredicto={lic.veredicto} />
        </TableCell>
        <TableCell className="text-center text-sm text-gray-600">
          {lic.confianza !== null ? `${lic.confianza}%` : '—'}
        </TableCell>
        <TableCell>
          <EstadoBadge estado={lic.estadoEfectivo} />
        </TableCell>
        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-end gap-1 whitespace-nowrap">
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            ) : accionable ? (
              <>
                {esAriba && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs text-green-700 border-green-200 hover:bg-green-50"
                    onClick={onImportar}
                    title="Importar el Excel de contenido del evento descargado de Ariba"
                  >
                    <Upload className="h-3 w-3 mr-1" />
                    Importar Excel
                  </Button>
                )}
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onCotizada}>
                  <CheckCircle2 className="h-3 w-3 mr-1 text-green-600" />
                  Cotizada
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onIgnorar}>
                  <EyeOff className="h-3 w-3 mr-1 text-gray-500" />
                  Ignorar
                </Button>
                {/* El decline automático solo existe para Exiros: el worker
                    no sabe declinar en Ariba. */}
                {lic.plataforma === 'EXIROS' && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs text-red-600 border-red-200 hover:bg-red-50"
                    onClick={onDeclinar}
                  >
                    <XCircle className="h-3 w-3 mr-1" />
                    Declinar
                  </Button>
                )}
              </>
            ) : lic.estadoEfectivo === 'DECLINAR_PENDIENTE' ? (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onCancelarDecline}>
                <Undo2 className="h-3 w-3 mr-1" />
                Cancelar
              </Button>
            ) : lic.estadoEfectivo === 'COTIZADA' || lic.estadoEfectivo === 'IGNORADA' ? (
              <Button size="sm" variant="ghost" className="h-7 text-xs text-gray-500" onClick={onDeshacer}>
                <Undo2 className="h-3 w-3 mr-1" />
                Deshacer
              </Button>
            ) : null}
          </div>
        </TableCell>
      </TableRow>

      {isExpanded && (
        <TableRow className="bg-gray-50/70 hover:bg-gray-50/70">
          <TableCell colSpan={11} className="py-4">
            <div className="space-y-3 px-2">
              {(lic.estadoEfectivo === 'DECLINADA' || lic.estadoEfectivo === 'DECLINE_ERROR') &&
                lic.declineMsg && (
                  <div
                    className={`text-sm rounded-md border p-3 ${
                      lic.estadoEfectivo === 'DECLINE_ERROR'
                        ? 'bg-red-50 border-red-200 text-red-800'
                        : 'bg-gray-100 border-gray-200 text-gray-700'
                    }`}
                  >
                    <span className="font-medium">Resultado del decline:</span> {lic.declineMsg}
                  </div>
                )}

              {lic.razon && (
                <div className="text-sm bg-blue-50/60 border border-blue-100 rounded-md p-3 text-gray-700">
                  <span className="font-medium text-blue-900">Análisis de la IA:</span> {lic.razon}
                </div>
              )}

              {lic.items.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>Descripción</TableHead>
                      <TableHead className="whitespace-nowrap">Cantidad</TableHead>
                      <TableHead>Qué pide</TableHead>
                      <TableHead>Match</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lic.items.map((it) => (
                      <TableRow key={it.id}>
                        <TableCell className="text-gray-500">{it.nro}</TableCell>
                        <TableCell className="max-w-[340px]">
                          <span title={it.descLarga || undefined}>{it.descCorta}</span>
                          {it.descLarga && (
                            <details className="mt-1">
                              <summary className="text-xs text-gray-400 cursor-pointer select-none">
                                Ver descripción completa
                              </summary>
                              <p className="text-xs text-gray-500 whitespace-pre-wrap mt-1">
                                {it.descLarga}
                              </p>
                            </details>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {it.cantidad !== null ? `${it.cantidad} ${it.unidad || ''}`.trim() : '—'}
                        </TableCell>
                        <TableCell className="max-w-[260px] text-sm text-gray-600">
                          {it.quePide || '—'}
                        </TableCell>
                        <TableCell className="max-w-[200px] text-sm">
                          {it.match ? (
                            <span
                              className={
                                /fuera de rubro/i.test(it.match)
                                  ? 'text-gray-400'
                                  : 'text-green-700 font-medium'
                              }
                            >
                              {it.match}
                            </span>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : esAriba ? (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 inline-flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 shrink-0" />
                  Sin ítems: descargá el contenido del evento en Ariba (Descargar
                  contenido → Excel) e importalo acá con el botón &quot;Importar Excel&quot;.
                </p>
              ) : (
                <p className="text-sm text-gray-400">Sin ítems cargados</p>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}
