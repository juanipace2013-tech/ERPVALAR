'use client'

/**
 * Nuevo cobro a cliente (fase 1): comprobantes en pesos y transferencias a
 * cuentas en pesos, sin retenciones. Se da de alta en Colppy con
 * Cliente/alta_cobro. Ver docs/DISENO-COBROS-COLPPY.md.
 *
 * Flujo: cliente → se traen sus impagas de Colppy → tildar comprobantes e
 * importes → medios de cobro que cuadren al centavo → confirmar.
 *
 * Idempotencia: la clave se genera para el contenido del formulario; cualquier
 * cambio la descarta. Un error de red se reintenta con LA MISMA clave (el
 * servidor no da de alta dos veces). INCIERTO no se reintenta: se verifica
 * desde el listado.
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { AlertTriangle, ArrowLeft, Loader2, Plus, Search, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { formatCurrency } from '@/lib/utils'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import type { PreparacionCobro, ResultadoCobro } from '@/lib/cobros-colppy/registrar'

const MAX_MEDIOS = 10
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** Hoy en Argentina (UTC-3), YYYY-MM-DD */
function hoyAr(): string {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)
}

/** DD-MM-YYYY (Colppy) → DD/MM/YYYY */
function fechaCorta(s: string): string {
  const m = /^(\d{2})[-/](\d{2})[-/](\d{4})/.exec(s)
  return m ? `${m[1]}/${m[2]}/${m[3]}` : s || '—'
}

/** Texto de un input numérico → número (NaN si está vacío o no es número) */
function aNumero(s: string): number {
  const t = s.trim().replace(',', '.')
  return t === '' ? NaN : Number(t)
}

function mensajesDeError(d: unknown, status: number): string[] {
  const b = (d ?? {}) as { error?: unknown; errores?: unknown }
  if (Array.isArray(b.errores) && b.errores.length) return b.errores.map(String)
  if (typeof b.error === 'string' && b.error) return [b.error]
  return [`Error HTTP ${status}`]
}

interface ClienteBusqueda {
  id: string
  name: string
  businessName: string | null
  cuit: string
  colppyId: string | null
}

interface Medio {
  uid: string
  cuenta: string
  importe: string
  /** El importe sigue al total mientras el usuario no lo toque */
  auto: boolean
}

const nuevoUid = () => Math.random().toString(36).slice(2, 10)

function NuevoCobro() {
  const router = useRouter()
  const sp = useSearchParams()
  const clienteInicial = sp.get('cliente') || ''

  const [busqueda, setBusqueda] = useState('')
  const busquedaLenta = useDebouncedValue(busqueda, 300)
  const [resultados, setResultados] = useState<ClienteBusqueda[]>([])
  const [buscando, setBuscando] = useState(false)

  const [clienteId, setClienteId] = useState(clienteInicial)
  const [prep, setPrep] = useState<PreparacionCobro | null>(null)
  const [cargando, setCargando] = useState(false)
  const [errorPrep, setErrorPrep] = useState<string | null>(null)

  const [fecha, setFecha] = useState(hoyAr())
  /** idFactura → importe (texto) de los comprobantes tildados */
  const [elegidas, setElegidas] = useState<Record<string, string>>({})
  const [medios, setMedios] = useState<Medio[]>([{ uid: nuevoUid(), cuenta: '', importe: '', auto: true }])
  const [descripcion, setDescripcion] = useState('')

  const [confirmando, setConfirmando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [errores, setErrores] = useState<string[]>([])
  const [incierto, setIncierto] = useState<ResultadoCobro | null>(null)
  const clave = useRef<{ firma: string; uuid: string } | null>(null)

  // ── Búsqueda de cliente ──
  useEffect(() => {
    const q = busquedaLenta.trim()
    if (q.length < 2) {
      setResultados([])
      return
    }
    let vigente = true
    setBuscando(true)
    fetch(`/api/clientes?search=${encodeURIComponent(q)}&limit=8`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((d) => {
        if (vigente) setResultados(Array.isArray(d?.customers) ? d.customers : [])
      })
      .finally(() => vigente && setBuscando(false))
    return () => {
      vigente = false
    }
  }, [busquedaLenta])

  // ── Impagas del cliente ──
  const traer = useCallback(async (id: string) => {
    setCargando(true)
    setErrorPrep(null)
    setPrep(null)
    setElegidas({})
    setErrores([])
    try {
      const r = await fetch(`/api/cobros/preparar?customerId=${encodeURIComponent(id)}`)
      const d = await r.json().catch(() => null)
      if (!r.ok) {
        setErrorPrep(mensajesDeError(d, r.status).join(' · '))
        return
      }
      setPrep(d as PreparacionCobro)
    } catch {
      setErrorPrep('No se pudo conectar con el servidor')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    if (clienteId) void traer(clienteId)
  }, [clienteId, traer])

  // ── Totales ──
  const totalAplicado = useMemo(
    () => r2(Object.values(elegidas).reduce((a, v) => a + (Number.isFinite(aNumero(v)) ? aNumero(v) : 0), 0)),
    [elegidas]
  )
  const totalMedios = useMemo(
    () => r2(medios.reduce((a, m) => a + (Number.isFinite(aNumero(m.importe)) ? aNumero(m.importe) : 0), 0)),
    [medios]
  )
  const diferencia = r2(totalMedios - totalAplicado)

  // Con un solo medio sin tocar, su importe sigue al total aplicado
  useEffect(() => {
    setMedios((ms) => (ms.length === 1 && ms[0].auto ? [{ ...ms[0], importe: totalAplicado > 0 ? totalAplicado.toFixed(2) : '' }] : ms))
  }, [totalAplicado])

  const problemas = useMemo(() => {
    const p: string[] = []
    if (!prep) return p
    if (!Object.keys(elegidas).length) p.push('Tildá al menos un comprobante')
    for (const [id, v] of Object.entries(elegidas)) {
      const f = prep.impagas.find((x) => x.idFactura === id)
      const n = aNumero(v)
      if (!f) continue
      if (!Number.isFinite(n) || n <= 0) p.push(`${f.nroFactura}: importe inválido`)
      else if (n > f.saldo + 0.005) p.push(`${f.nroFactura}: el importe supera el saldo`)
    }
    for (const m of medios) {
      if (!m.cuenta) p.push('Elegí la cuenta de cada medio de cobro')
      const n = aNumero(m.importe)
      if (!Number.isFinite(n) || n <= 0) p.push('Importe inválido en un medio de cobro')
    }
    if (totalAplicado > 0 && Math.abs(diferencia) > 0.005) {
      p.push(`Los medios suman ${formatCurrency(totalMedios)} y lo aplicado es ${formatCurrency(totalAplicado)}`)
    }
    return [...new Set(p)]
  }, [prep, elegidas, medios, totalAplicado, totalMedios, diferencia])

  const pedido = useMemo(
    () => ({
      customerId: clienteId,
      fecha,
      cobros: Object.fromEntries(Object.entries(elegidas).map(([k, v]) => [k, r2(aNumero(v))])),
      medios: medios.map((m) => ({ cuenta: m.cuenta, importe: r2(aNumero(m.importe)) })),
      descripcion,
    }),
    [clienteId, fecha, elegidas, medios, descripcion]
  )

  async function registrar() {
    const firma = JSON.stringify(pedido)
    if (clave.current?.firma !== firma) clave.current = { firma, uuid: crypto.randomUUID() }
    setEnviando(true)
    setErrores([])
    try {
      const r = await fetch('/api/cobros', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...pedido, idempotencyKey: clave.current.uuid }),
      })
      const d = await r.json().catch(() => null)
      setConfirmando(false)
      if (!r.ok) {
        setErrores(mensajesDeError(d, r.status))
        return
      }
      const res = d as ResultadoCobro
      if (res.estado === 'REGISTRADA') {
        toast.success(`Recibo ${res.numero ?? ''} registrado en Colppy`)
        router.push('/cobros')
      } else if (res.estado === 'INCIERTO') {
        setIncierto(res)
      } else {
        clave.current = null
        setErrores([res.error || 'Colppy no registró el cobro'])
        void traer(clienteId)
      }
    } catch {
      setConfirmando(false)
      setErrores(['No hubo respuesta del servidor. Volvé a confirmar: no se registra dos veces.'])
    } finally {
      setEnviando(false)
    }
  }

  const cobrables = prep?.impagas.filter((f) => f.cobrable) ?? []
  const todasTildadas = cobrables.length > 0 && cobrables.every((f) => f.idFactura in elegidas)

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/cobros">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Nuevo cobro</h1>
          <p className="text-sm text-muted-foreground">El recibo se registra en Colppy</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cliente y fecha</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[1fr_200px]">
          <div className="space-y-2">
            <Label>Cliente</Label>
            {prep || clienteId ? (
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <div>
                  <div className="font-medium">{prep?.cliente.nombre ?? 'Cargando…'}</div>
                  {prep && <div className="text-xs text-muted-foreground">CUIT {prep.cliente.cuit}</div>}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Cambiar cliente"
                  onClick={() => {
                    setClienteId('')
                    setPrep(null)
                    setErrorPrep(null)
                    setElegidas({})
                    setBusqueda('')
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Nombre o CUIT" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} autoFocus />
                {buscando && <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
                {resultados.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md">
                    {resultados.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                        onClick={() => setClienteId(c.id)}
                      >
                        <span>{c.businessName || c.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {c.cuit}
                          {!c.colppyId && ' · sin Colppy'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="fecha">Fecha del cobro</Label>
            <Input id="fecha" type="date" value={fecha} max={hoyAr()} onChange={(e) => setFecha(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {cargando && (
        <div className="flex items-center justify-center p-8 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Leyendo Colppy…
        </div>
      )}
      {errorPrep && (
        <Card className="border-red-300">
          <CardContent className="flex items-center justify-between p-4 text-sm text-red-700">
            <span>{errorPrep}</span>
            {clienteId && (
              <Button variant="outline" size="sm" onClick={() => traer(clienteId)}>
                Reintentar
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {prep && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Comprobantes impagos</CardTitle>
              <CardDescription>Próximo recibo: {prep.proximoNumero}</CardDescription>
            </CardHeader>
            <CardContent>
              {prep.impagas.length === 0 ? (
                <p className="text-sm text-muted-foreground">Este cliente no tiene comprobantes impagos en Colppy.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          aria-label="Tildar todos"
                          checked={todasTildadas}
                          onCheckedChange={(v) => setElegidas(v ? Object.fromEntries(cobrables.map((f) => [f.idFactura, f.saldo.toFixed(2)])) : {})}
                        />
                      </TableHead>
                      <TableHead>Comprobante</TableHead>
                      <TableHead>Vencimiento</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                      <TableHead className="w-44 text-right">Este cobro</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {prep.impagas.map((f) => {
                      const tildada = f.idFactura in elegidas
                      return (
                        <TableRow key={f.idFactura} className={f.cobrable ? '' : 'text-muted-foreground'}>
                          <TableCell>
                            <Checkbox
                              aria-label={`Cobrar ${f.nroFactura}`}
                              disabled={!f.cobrable}
                              checked={tildada}
                              onCheckedChange={(v) =>
                                setElegidas((e) => {
                                  const n = { ...e }
                                  if (v) n[f.idFactura] = f.saldo.toFixed(2)
                                  else delete n[f.idFactura]
                                  return n
                                })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">
                              {f.tipoComprobante} {f.nroFactura}
                            </div>
                            <div className="max-w-md truncate text-xs text-muted-foreground">{f.motivoNoCobrable ?? f.descripcion}</div>
                          </TableCell>
                          <TableCell>{fechaCorta(f.vencimiento)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(f.totalFactura)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(f.saldo)}</TableCell>
                          <TableCell className="text-right">
                            {tildada && (
                              <Input
                                className="h-8 text-right"
                                inputMode="decimal"
                                aria-label={`Importe a cobrar de ${f.nroFactura}`}
                                value={elegidas[f.idFactura]}
                                onChange={(e) => setElegidas((x) => ({ ...x, [f.idFactura]: e.target.value }))}
                              />
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Medios de cobro</CardTitle>
              <CardDescription>Transferencias a cuentas en pesos</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {medios.map((m) => (
                <div key={m.uid} className="flex items-center gap-2">
                  <Select value={m.cuenta} onValueChange={(v) => setMedios((ms) => ms.map((x) => (x.uid === m.uid ? { ...x, cuenta: v } : x)))}>
                    <SelectTrigger className="flex-1" aria-label="Cuenta">
                      <SelectValue placeholder="Cuenta donde entró" />
                    </SelectTrigger>
                    <SelectContent>
                      {prep.cuentas.map((c) => (
                        <SelectItem key={c.nombre} value={c.nombre}>
                          {c.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    className="w-44 text-right"
                    inputMode="decimal"
                    placeholder="Importe"
                    aria-label="Importe del medio de cobro"
                    value={m.importe}
                    onChange={(e) => setMedios((ms) => ms.map((x) => (x.uid === m.uid ? { ...x, importe: e.target.value, auto: false } : x)))}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Quitar medio"
                    disabled={medios.length === 1}
                    onClick={() => setMedios((ms) => ms.filter((x) => x.uid !== m.uid))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {medios.length < MAX_MEDIOS && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setMedios((ms) => [...ms, { uid: nuevoUid(), cuenta: '', importe: diferencia < 0 ? Math.abs(diferencia).toFixed(2) : '', auto: false }])
                  }
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Agregar medio
                </Button>
              )}
              <div className="space-y-2 pt-2">
                <Label htmlFor="descripcion">Descripción (opcional)</Label>
                <Input id="descripcion" maxLength={200} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex gap-8 text-sm">
                  <div>
                    <div className="text-muted-foreground">Total aplicado</div>
                    <div className="text-lg font-semibold">{formatCurrency(totalAplicado)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Total cobrado</div>
                    <div className="text-lg font-semibold">{formatCurrency(totalMedios)}</div>
                  </div>
                </div>
                <Button disabled={problemas.length > 0 || enviando || !prep.altasHabilitadas} onClick={() => setConfirmando(true)}>
                  Registrar en Colppy
                </Button>
              </div>
              {!prep.altasHabilitadas && (
                <p className="text-sm text-amber-700">El registro de cobros en Colppy está apagado: por ahora esta pantalla solo muestra cómo quedaría.</p>
              )}
              {[...problemas, ...errores].length > 0 && (
                <ul className="space-y-1 text-sm text-red-700">
                  {[...errores, ...problemas].map((e) => (
                    <li key={e} className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      {e}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <AlertDialog open={confirmando} onOpenChange={(v) => !enviando && setConfirmando(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Registrar el cobro en Colppy?</AlertDialogTitle>
            <AlertDialogDescription>
              {prep?.cliente.nombre}: {formatCurrency(totalMedios)} aplicados a {Object.keys(elegidas).length}{' '}
              {Object.keys(elegidas).length === 1 ? 'comprobante' : 'comprobantes'}. El recibo queda aprobado en Colppy y no se puede deshacer desde el ERP.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" disabled={enviando} onClick={() => setConfirmando(false)}>
              Cancelar
            </Button>
            <Button disabled={enviando} onClick={registrar}>
              {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Registrar
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!incierto}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>No se sabe si Colppy registró el cobro</AlertDialogTitle>
            <AlertDialogDescription>
              Colppy no contestó con claridad para el recibo {incierto?.numero}. No lo vuelvas a cargar: verificalo desde el listado de cobros en unos minutos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button onClick={() => router.push('/cobros')}>Ir al listado</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default function NuevoCobroPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center p-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Cargando…
        </div>
      }
    >
      <NuevoCobro />
    </Suspense>
  )
}
