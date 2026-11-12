'use client'

/**
 * Formulario de cobro a un cliente, con la forma de la pantalla "Agregar
 * cobro" de Colppy: cabecera (fecha, recibo, descripción), grilla con TODAS
 * las facturas adeudadas donde se tilda "Pagar" o se escribe "Este cobro",
 * grilla de medios de cobro y la columna de totales.
 *
 * Alcance: comprobantes en pesos o en dólares (se cobran en pesos, al T/C de
 * la factura o al que se indique: la diferencia de cambio sale sola) y
 * transferencias a cuentas en pesos, sin retenciones. Se da de alta con
 * Cliente/alta_cobro (docs/DISENO-COBROS-COLPPY.md).
 *
 * Idempotencia: la clave se genera para el contenido del formulario; cualquier
 * cambio la descarta. Un error de red se reintenta con LA MISMA clave (el
 * servidor no da de alta dos veces). INCIERTO no se reintenta: se verifica
 * desde el listado.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import type { PreparacionCobro, ResultadoCobro } from '@/lib/cobros-colppy/registrar'

const MAX_MEDIOS = 10
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const usd = (n: number) => `USD ${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const tcTexto = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })

/** Hoy en Argentina (UTC-3), YYYY-MM-DD */
function hoyAr(): string {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)
}

/** DD-MM-YYYY (Colppy) → DD/MM/YYYY */
function fechaCorta(s: string): string {
  const m = /^(\d{2})[-/](\d{2})[-/](\d{4})/.exec(s)
  return m ? `${m[1]}/${m[2]}/${m[3]}` : s || '—'
}

/**
 * Texto de un input → número (NaN si está vacío o no es número). Formato
 * argentino: punto de miles y coma decimal ("1.233.741,60"). Sin coma, un punto
 * seguido de exactamente 3 dígitos es de miles ("1.560"); si no, es decimal
 * ("1560.5"), para que también sirva pegar un número con punto.
 */
function aNumero(s: string): number {
  let t = s.replace(/[\s$]/g, '')
  if (t === '') return NaN
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '')
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN
}

/** Importe como se escribe acá: 1.233.741,60 */
const imp = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** Al salir del campo, lo escrito se acomoda al formato argentino */
const acomodar = (texto: string, fmt: (n: number) => string = imp) => (Number.isFinite(aNumero(texto)) ? fmt(aNumero(texto)) : texto)

function mensajesDeError(d: unknown, status: number): string[] {
  const b = (d ?? {}) as { error?: unknown; errores?: unknown }
  if (Array.isArray(b.errores) && b.errores.length) return b.errores.map(String)
  if (typeof b.error === 'string' && b.error) return [b.error]
  return [`Error HTTP ${status}`]
}

interface Medio {
  uid: string
  medio: 'Transferencia' | 'Echeqs'
  /** Solo e-cheq */
  banco: string
  numero: string
  fechaPago: string
  cuenta: string
  importe: string
  /** El importe sigue al total mientras el usuario no lo toque */
  auto: boolean
}

const nuevoUid = () => Math.random().toString(36).slice(2, 10)
const MEDIO_VACIO: Omit<Medio, 'uid'> = { medio: 'Transferencia', banco: '', numero: '', fechaPago: '', cuenta: '', importe: '', auto: false }

export interface NuevoCobroFormProps {
  clienteId: string
  /** Comprobantes (id de Colppy) que arrancan tildados */
  facturasIniciales?: string[]
  onRegistrado: (r: ResultadoCobro) => void
  onCerrar: () => void
  /** true mientras se está mandando a Colppy (para no dejar cerrar el panel) */
  onOcupadoChange?: (ocupado: boolean) => void
}

export default function NuevoCobroForm({ clienteId, facturasIniciales, onRegistrado, onCerrar, onOcupadoChange }: NuevoCobroFormProps) {
  const [prep, setPrep] = useState<PreparacionCobro | null>(null)
  const [cargando, setCargando] = useState(true)
  const [errorPrep, setErrorPrep] = useState<string | null>(null)

  const [fecha, setFecha] = useState(hoyAr())
  /** idFactura → "este cobro" (texto) de los comprobantes que se cobran */
  const [elegidas, setElegidas] = useState<Record<string, string>>({})
  /** idFactura → T/C del cobro (texto) de las facturas en dólares */
  const [tcs, setTcs] = useState<Record<string, string>>({})
  const [medios, setMedios] = useState<Medio[]>([{ ...MEDIO_VACIO, uid: nuevoUid(), auto: true }])
  const [descripcion, setDescripcion] = useState('')

  const [confirmando, setConfirmando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [errores, setErrores] = useState<string[]>([])
  const [incierto, setIncierto] = useState<ResultadoCobro | null>(null)
  const clave = useRef<{ firma: string; uuid: string } | null>(null)
  const iniciales = useRef(facturasIniciales ?? [])

  useEffect(() => {
    onOcupadoChange?.(enviando)
  }, [enviando, onOcupadoChange])

  const traer = useCallback(async () => {
    setCargando(true)
    setErrorPrep(null)
    setErrores([])
    try {
      const r = await fetch(`/api/cobros/preparar?customerId=${encodeURIComponent(clienteId)}`)
      const d = await r.json().catch(() => null)
      if (!r.ok) {
        setPrep(null)
        setErrorPrep(mensajesDeError(d, r.status).join(' · '))
        return
      }
      const p = d as PreparacionCobro
      setPrep(p)
      // T/C del cobro: arranca en el de la factura; se conserva lo que ya se escribió
      setTcs((t) => Object.fromEntries(p.impagas.filter((f) => f.cobrable && f.tcFactura).map((f) => [f.idFactura, t[f.idFactura] ?? tcTexto(Number(f.tcFactura))])))
      // Se conserva lo tildado que sigue impago; la primera vez, lo que venía tildado del panel
      setElegidas((e) => {
        const base = Object.keys(e).length ? e : Object.fromEntries(iniciales.current.map((id) => [id, '']))
        const n: Record<string, string> = {}
        for (const f of p.impagas) {
          if (!f.cobrable || !(f.idFactura in base)) continue
          n[f.idFactura] = base[f.idFactura] || imp(f.saldo)
        }
        return n
      })
    } catch {
      setPrep(null)
      setErrorPrep('No se pudo conectar con el servidor')
    } finally {
      setCargando(false)
    }
  }, [clienteId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial: lee Colppy al abrir el formulario
    void traer()
  }, [traer])

  // ── Totales ──
  const totalAplicado = useMemo(
    () => r2(Object.values(elegidas).reduce((a, v) => a + (Number.isFinite(aNumero(v)) ? aNumero(v) : 0), 0)),
    [elegidas]
  )
  const totalMedios = useMemo(
    () => r2(medios.reduce((a, m) => a + (Number.isFinite(aNumero(m.importe)) ? aNumero(m.importe) : 0), 0)),
    [medios]
  )
  /** Lo que se cobra de más (o de menos) por cobrar a un T/C distinto al de la factura */
  const diferenciaCambio = useMemo(() => {
    if (!prep) return 0
    let d = 0
    for (const [id, v] of Object.entries(elegidas)) {
      const f = prep.impagas.find((x) => x.idFactura === id)
      const este = aNumero(v)
      const tc = aNumero(tcs[id] ?? '')
      if (!f?.tcFactura || !Number.isFinite(este) || !Number.isFinite(tc) || tc <= 0) continue
      d += (este / f.tcFactura) * tc - este
    }
    return r2(d)
  }, [prep, elegidas, tcs])
  const totalACobrar = r2(totalAplicado + diferenciaCambio)
  const diferencia = r2(totalMedios - totalACobrar)

  // Con un solo medio sin tocar, su importe sigue al total a cobrar
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- el importe del medio único acompaña al total hasta que se lo toca
    setMedios((ms) => (ms.length === 1 && ms[0].auto ? [{ ...ms[0], importe: totalACobrar > 0 ? imp(totalACobrar) : '' }] : ms))
  }, [totalACobrar])

  const problemas = useMemo(() => {
    const p: string[] = []
    if (!prep) return p
    if (!Object.keys(elegidas).length) p.push('Tildá al menos una factura')
    for (const [id, v] of Object.entries(elegidas)) {
      const f = prep.impagas.find((x) => x.idFactura === id)
      const n = aNumero(v)
      if (!f) continue
      if (!Number.isFinite(n) || n <= 0) p.push(`${f.nroFactura}: importe inválido`)
      else if (n > f.saldo + 0.005) p.push(`${f.nroFactura}: el importe supera el saldo`)
      if (f.tcFactura) {
        const tc = aNumero(tcs[id] ?? '')
        if (!Number.isFinite(tc) || tc <= 0) p.push(`${f.nroFactura}: falta el tipo de cambio del cobro`)
        else if (tc < f.tcFactura * 0.5 || tc > f.tcFactura * 2) p.push(`${f.nroFactura}: el tipo de cambio del cobro está muy lejos del de la factura`)
      }
    }
    for (const m of medios) {
      if (m.medio === 'Echeqs') {
        if (!m.banco.trim()) p.push('Falta el banco del e-cheq')
        if (!/^\d{1,15}$/.test(m.numero.trim())) p.push('Falta el número del e-cheq (solo dígitos)')
        if (!m.fechaPago) p.push('Falta la fecha de pago del e-cheq')
      } else if (!m.cuenta) p.push('Elegí la cuenta de cada medio de cobro')
      const n = aNumero(m.importe)
      if (!Number.isFinite(n) || n <= 0) p.push('Importe inválido en un medio de cobro')
    }
    if (totalAplicado > 0 && Math.abs(diferencia) > 0.005) {
      p.push(`Los medios suman ${formatCurrency(totalMedios)} y el total a cobrar es ${formatCurrency(totalACobrar)}`)
    }
    return [...new Set(p)]
  }, [prep, elegidas, tcs, medios, totalAplicado, totalACobrar, totalMedios, diferencia])

  const pedido = useMemo(
    () => ({
      customerId: clienteId,
      fecha,
      cobros: Object.fromEntries(Object.entries(elegidas).map(([k, v]) => [k, r2(aNumero(v))])),
      tcCobro: Object.fromEntries(
        Object.keys(elegidas)
          .filter((k) => k in tcs)
          .map((k) => [k, aNumero(tcs[k])])
      ),
      medios: medios.map((m) =>
        m.medio === 'Echeqs'
          ? { medio: m.medio, cuenta: '', banco: m.banco.trim(), numero: m.numero.trim(), fechaPago: m.fechaPago, importe: r2(aNumero(m.importe)) }
          : { medio: m.medio, cuenta: m.cuenta, importe: r2(aNumero(m.importe)) }
      ),
      descripcion,
    }),
    [clienteId, fecha, elegidas, tcs, medios, descripcion]
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
        onRegistrado(res)
      } else if (res.estado === 'INCIERTO') {
        setIncierto(res)
      } else {
        clave.current = null
        setErrores([res.error || 'Colppy no registró el cobro'])
        void traer()
      }
    } catch {
      setConfirmando(false)
      setErrores(['No hubo respuesta del servidor. Volvé a guardar: no se registra dos veces.'])
    } finally {
      setEnviando(false)
    }
  }

  if (cargando && !prep) {
    return (
      <div className="flex items-center justify-center p-12 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Leyendo Colppy…
      </div>
    )
  }
  if (!prep) {
    return (
      <div className="space-y-3 p-6 text-center text-sm text-red-700">
        <p>{errorPrep ?? 'No se pudo leer Colppy'}</p>
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => traer()}>
            Reintentar
          </Button>
          <Button variant="ghost" size="sm" onClick={onCerrar}>
            Cerrar
          </Button>
        </div>
      </div>
    )
  }

  const cobrables = prep.impagas.filter((f) => f.cobrable)
  const todasTildadas = cobrables.length > 0 && cobrables.every((f) => f.idFactura in elegidas)
  const enDolares = cobrables.filter((f) => f.tcFactura)
  const hayDolares = enDolares.length > 0

  return (
    <div className="space-y-5">
      {/* Cabecera, como en Colppy */}
      <div className="grid gap-4 sm:grid-cols-[170px_190px_1fr]">
        <div className="space-y-1">
          <Label htmlFor="cobro-fecha">Fecha de cobro</Label>
          <Input id="cobro-fecha" type="date" value={fecha} max={hoyAr()} onChange={(e) => setFecha(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cobro-recibo">Recibo N°</Label>
          <Input id="cobro-recibo" value={prep.proximoNumero} readOnly tabIndex={-1} className="bg-muted" title="Lo asigna Colppy al guardar" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cobro-descripcion">Descripción</Label>
          <Input id="cobro-descripcion" maxLength={200} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
        </div>
      </div>

      {/* Facturas a cobrar */}
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-blue-900">Facturas a cobrar</h3>
          {hayDolares && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Cobrar las facturas en dólares al tipo de cambio:</span>
              <Button variant="outline" size="sm" onClick={() => setTcs(Object.fromEntries(enDolares.map((f) => [f.idFactura, tcTexto(Number(f.tcFactura))])))}>
                De la factura
              </Button>
              {prep.tcDia && (
                <Button variant="outline" size="sm" onClick={() => setTcs(Object.fromEntries(enDolares.map((f) => [f.idFactura, tcTexto(Number(prep.tcDia))])))}>
                  Del día ({tcTexto(prep.tcDia)})
                </Button>
              )}
            </div>
          )}
        </div>
        {prep.impagas.length === 0 ? (
          <p className="rounded-md border p-4 text-sm text-muted-foreground">Este cliente no tiene comprobantes impagos en Colppy.</p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow className="bg-blue-50">
                  <TableHead className="w-14 text-center">
                    <Checkbox
                      aria-label="Pagar todas"
                      checked={todasTildadas}
                      onCheckedChange={(v) => setElegidas(v ? Object.fromEntries(cobrables.map((f) => [f.idFactura, imp(f.saldo)])) : {})}
                    />
                  </TableHead>
                  <TableHead>Comprobante</TableHead>
                  <TableHead>Vencimiento</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Cobrado</TableHead>
                  <TableHead className="text-right">Saldo anterior</TableHead>
                  {hayDolares && <TableHead className="text-right">T/C factura</TableHead>}
                  {hayDolares && <TableHead className="w-32 text-right">T/C cobro</TableHead>}
                  <TableHead className="w-40 text-right">Este cobro</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {prep.impagas.map((f) => {
                  const tildada = f.idFactura in elegidas
                  const este = tildada && Number.isFinite(aNumero(elegidas[f.idFactura])) ? aNumero(elegidas[f.idFactura]) : 0
                  const tc = aNumero(tcs[f.idFactura] ?? '')
                  /** Pesos que entran por esta factura al T/C del cobro */
                  const enPesos = f.tcFactura && este > 0 && Number.isFinite(tc) && tc > 0 ? r2((este / f.tcFactura) * tc) : null
                  return (
                    <TableRow key={f.idFactura} className={f.cobrable ? (tildada ? 'bg-green-50/60' : '') : 'text-muted-foreground'}>
                      <TableCell className="text-center">
                        <Checkbox
                          aria-label={`Pagar ${f.nroFactura}`}
                          disabled={!f.cobrable}
                          checked={tildada}
                          onCheckedChange={(v) =>
                            setElegidas((e) => {
                              const n = { ...e }
                              if (v) n[f.idFactura] = imp(f.saldo)
                              else delete n[f.idFactura]
                              return n
                            })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">
                          {f.tipoComprobante} {f.nroFactura}
                          {f.saldoUsd !== null && <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-800">{usd(f.saldoUsd)}</span>}
                        </div>
                        {(f.motivoNoCobrable || f.descripcion) && (
                          <div className="max-w-xs truncate text-xs text-muted-foreground" title={f.motivoNoCobrable ?? f.descripcion}>
                            {f.motivoNoCobrable ?? f.descripcion}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>{fechaCorta(f.vencimiento)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(f.totalFactura)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(r2(f.totalFactura - f.saldo))}</TableCell>
                      <TableCell className="text-right">{formatCurrency(f.saldo)}</TableCell>
                      {hayDolares && <TableCell className="text-right">{f.tcFactura ? tcTexto(f.tcFactura) : '—'}</TableCell>}
                      {hayDolares && (
                        <TableCell className="text-right">
                          {f.cobrable && f.tcFactura ? (
                            <Input
                              className="h-8 text-right"
                              inputMode="decimal"
                              aria-label={`Tipo de cambio del cobro de ${f.nroFactura}`}
                              value={tcs[f.idFactura] ?? ''}
                              onChange={(e) => setTcs((t) => ({ ...t, [f.idFactura]: e.target.value }))}
                              onBlur={() => setTcs((t) => ({ ...t, [f.idFactura]: acomodar(t[f.idFactura] ?? '', tcTexto) }))}
                            />
                          ) : (
                            '—'
                          )}
                        </TableCell>
                      )}
                      <TableCell className="text-right">
                        {enPesos !== null && Math.abs(enPesos - este) > 0.005 && <div className="mb-1 text-xs text-muted-foreground">entran {formatCurrency(enPesos)}</div>}
                        {f.cobrable && (
                          <Input
                            className="h-8 text-right"
                            inputMode="decimal"
                            placeholder="0,00"
                            aria-label={`Este cobro de ${f.nroFactura}`}
                            value={elegidas[f.idFactura] ?? ''}
                            onBlur={() => setElegidas((x) => (f.idFactura in x ? { ...x, [f.idFactura]: acomodar(x[f.idFactura]) } : x))}
                            onChange={(e) =>
                              setElegidas((x) => {
                                const n = { ...x }
                                // Escribir un importe tilda la factura; borrarlo la destilda (como en Colppy)
                                if (e.target.value.trim() === '') delete n[f.idFactura]
                                else n[f.idFactura] = e.target.value
                                return n
                              })
                            }
                          />
                        )}
                      </TableCell>
                      <TableCell className="text-right">{formatCurrency(r2(f.saldo - este))}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Medios de cobro + totales */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div>
          <h3 className="mb-2 text-sm font-semibold text-blue-900">Medios de cobro</h3>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow className="bg-blue-50">
                  <TableHead className="w-36">Medio</TableHead>
                  <TableHead>Cuenta / datos del e-cheq</TableHead>
                  <TableHead className="w-40 text-right">Importe</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {medios.map((m) => (
                  <TableRow key={m.uid}>
                    <TableCell>
                      <Select value={m.medio} onValueChange={(v) => setMedios((ms) => ms.map((x) => (x.uid === m.uid ? { ...x, medio: v as Medio['medio'] } : x)))}>
                        <SelectTrigger className="h-8" aria-label="Medio de cobro">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Transferencia">Transferencia</SelectItem>
                          <SelectItem value="Echeqs">E-cheq</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {m.medio === 'Echeqs' ? (
                        <div className="flex gap-2">
                          <Input
                            className="h-8 flex-1"
                            placeholder="Banco emisor"
                            aria-label="Banco del e-cheq"
                            maxLength={60}
                            value={m.banco}
                            onChange={(e) => setMedios((ms) => ms.map((x) => (x.uid === m.uid ? { ...x, banco: e.target.value } : x)))}
                          />
                          <Input
                            className="h-8 w-28"
                            placeholder="Número"
                            aria-label="Número del e-cheq"
                            inputMode="numeric"
                            value={m.numero}
                            onChange={(e) => setMedios((ms) => ms.map((x) => (x.uid === m.uid ? { ...x, numero: e.target.value.replace(/\D/g, '') } : x)))}
                          />
                          <Input
                            className="h-8 w-40"
                            type="date"
                            aria-label="Fecha de pago del e-cheq"
                            title="Fecha de pago del e-cheq"
                            value={m.fechaPago}
                            onChange={(e) => setMedios((ms) => ms.map((x) => (x.uid === m.uid ? { ...x, fechaPago: e.target.value } : x)))}
                          />
                        </div>
                      ) : (
                      <Select value={m.cuenta} onValueChange={(v) => setMedios((ms) => ms.map((x) => (x.uid === m.uid ? { ...x, cuenta: v } : x)))}>
                        <SelectTrigger className="h-8" aria-label="Cuenta">
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
                      )}
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-8 text-right"
                        inputMode="decimal"
                        placeholder="0,00"
                        aria-label="Importe del medio de cobro"
                        value={m.importe}
                        onChange={(e) => setMedios((ms) => ms.map((x) => (x.uid === m.uid ? { ...x, importe: e.target.value, auto: false } : x)))}
                        onBlur={() => setMedios((ms) => ms.map((x) => (x.uid === m.uid ? { ...x, importe: acomodar(x.importe) } : x)))}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label="Quitar medio"
                        disabled={medios.length === 1}
                        onClick={() => setMedios((ms) => ms.filter((x) => x.uid !== m.uid))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {medios.length < MAX_MEDIOS && (
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => setMedios((ms) => [...ms, { ...MEDIO_VACIO, uid: nuevoUid(), importe: diferencia < 0 ? imp(Math.abs(diferencia)) : '' }])}
            >
              <Plus className="mr-1 h-4 w-4" />
              Agregar medio
            </Button>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Transferencias a cuentas en pesos y e-cheqs recibidos (entran a Valores a Depositar). Retenciones y anticipos se siguen cargando en Colppy.
          </p>
        </div>

        <div className="space-y-1 self-start rounded-md border bg-muted/40 p-4 text-sm">
          <Total label="Total este cobro" valor={totalAplicado} />
          <Total label="Retenciones" valor={0} />
          {hayDolares && <Total label="Diferencia de cambio" valor={diferenciaCambio} />}
          <Total label="Total a cobrar" valor={totalACobrar} fuerte />
          <Total label="Total cobrado" valor={totalMedios} fuerte />
          <div className={`flex justify-between border-t pt-2 ${Math.abs(diferencia) > 0.005 ? 'font-semibold text-red-700' : 'text-muted-foreground'}`}>
            <span>Diferencia</span>
            <span>{formatCurrency(diferencia)}</span>
          </div>
        </div>
      </div>

      {!prep.altasHabilitadas && <p className="text-sm text-amber-700">El registro de cobros en Colppy está apagado: por ahora esta pantalla solo muestra cómo quedaría.</p>}
      {[...errores, ...problemas].length > 0 && (
        <ul className="space-y-1 text-sm text-red-700">
          {[...errores, ...problemas].map((e) => (
            <li key={e} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {e}
            </li>
          ))}
        </ul>
      )}

      <div className="flex justify-end gap-2 border-t pt-4">
        <Button variant="outline" disabled={enviando} onClick={onCerrar}>
          Cancelar
        </Button>
        <Button className="bg-blue-600 hover:bg-blue-700" disabled={problemas.length > 0 || enviando || !prep.altasHabilitadas} onClick={() => setConfirmando(true)}>
          Guardar
        </Button>
      </div>

      <AlertDialog open={confirmando} onOpenChange={(v) => !enviando && setConfirmando(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Registrar el cobro en Colppy?</AlertDialogTitle>
            <AlertDialogDescription>
              {prep.cliente.nombre}: {formatCurrency(totalMedios)} aplicados a {Object.keys(elegidas).length}{' '}
              {Object.keys(elegidas).length === 1 ? 'comprobante' : 'comprobantes'}
              {Math.abs(diferenciaCambio) > 0.005 ? ` (incluye ${formatCurrency(diferenciaCambio)} de diferencia de cambio)` : ''}. El recibo queda aprobado en Colppy y no se puede deshacer desde el ERP.
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
              Colppy no contestó con claridad para el recibo {incierto?.numero}. No lo vuelvas a cargar: verificalo desde la lista de recibos en unos minutos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button onClick={() => incierto && onRegistrado(incierto)}>Entendido</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function Total({ label, valor, fuerte }: { label: string; valor: number; fuerte?: boolean }) {
  return (
    <div className={`flex justify-between ${fuerte ? 'font-semibold' : ''}`}>
      <span>{label}</span>
      <span>{formatCurrency(valor)}</span>
    </div>
  )
}
