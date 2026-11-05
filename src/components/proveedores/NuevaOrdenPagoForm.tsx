'use client'

/**
 * Nueva orden de pago a proveedor (fase 1): facturas en pesos, transferencias y tarjeta de crédito
 * desde bancos en pesos y retención de Ganancias régimen 78. Se da de alta en
 * Colppy con Pago/alta_pago. Ver docs/DISENO-PAGOS-PROVEEDORES-COLPPY.md.
 *
 * Flujo: proveedor + fecha → "Traer facturas impagas" (preparar) → tildar
 * facturas e importes → vista previa automática (debounce, se descartan las
 * respuestas viejas) → medios de pago que cuadren al centavo → confirmar.
 *
 * Idempotencia: la clave se genera al abrir el diálogo de confirmación para ese
 * contenido; cualquier cambio del formulario la descarta. Un error de red se
 * reintenta con LA MISMA clave (el servidor no da de alta dos veces).
 * INCIERTO abre un diálogo bloqueante: NO se reintenta, se verifica en el detalle.
 *
 * Se usa como página (/proveedores/pagos/nueva) y embebido en el panel del
 * proveedor (Proveedores → Gestión, dentro de un Sheet). Embebido: sin header
 * de página y con el pie al final del panel en vez de pegado a la ventana.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AlertTriangle, ArrowLeft, Download, Loader2, Plus, Search, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
import type { CalculoOrdenPago, PreparacionPago, ResultadoOrdenPago } from '@/lib/pagos-proveedores/registrar'

// ── Utilidades ──────────────────────────────────────────────────────────────

const MAX_MEDIOS = 10
const MAX_DESCRIPCION = 200
const DEBOUNCE_PREVIEW_MS = 700

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** Hoy en Argentina (UTC-3), YYYY-MM-DD */
function hoyAr(): string {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)
}

function sumarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/** YYYY-MM-DD o DD-MM-YYYY (Colppy) → DD/MM/YYYY */
function fechaCorta(s: string | null | undefined): string {
  if (!s) return '—'
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`
  const ar = /^(\d{2})[-/](\d{2})[-/](\d{4})/.exec(s)
  if (ar) return `${ar[1]}/${ar[2]}/${ar[3]}`
  return s
}

/** Texto de un input numérico → número (NaN si está vacío o no es número) */
function aNumero(s: string): number {
  const t = s.trim().replace(',', '.')
  return t === '' ? NaN : Number(t)
}

function nuevoUid(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** Mensajes de una respuesta de error de la API ({ error, errores[] }) */
function mensajesDeError(d: unknown, status: number): string[] {
  const b = (d ?? {}) as { error?: unknown; errores?: unknown }
  if (Array.isArray(b.errores) && b.errores.length) return b.errores.map(String)
  if (typeof b.error === 'string' && b.error) return [b.error]
  return [`Error HTTP ${status}`]
}

// ── Tipos de la pantalla ────────────────────────────────────────────────────

interface ProveedorBusqueda {
  id: string
  name: string
  legalName: string | null
  taxId: string | null
  /** undefined = no se sabe (proveedor inicial sin ese dato): no se avisa */
  colppyId?: string | null
}

export interface ProveedorInicialPago {
  id: string
  nombre: string
  cuit?: string | null
  colppyId?: string | null
}

export interface NuevaOrdenPagoFormProps {
  /** Proveedor ya elegido: se preselecciona y se traen sus impagas solo (una vez) */
  proveedorInicial?: ProveedorInicialPago
  /** Ids de factura de Colppy a tildar cuando lleguen las impagas */
  facturasIniciales?: string[]
  /** Dentro de un Sheet/panel: sin header de página ni pie pegado a la ventana */
  embebido?: boolean
  /** Si viene, se llama en vez de navegar al detalle cuando quedó REGISTRADA */
  onRegistrada?: (r: { id: string; numero: string | null }) => void
  onCerrar?: () => void
  /** Avisa si hay un envío en curso o un resultado sin confirmar (para no cerrar el panel) */
  onOcupadoChange?: (ocupado: boolean) => void
}

interface Medio {
  uid: string
  cuenta: string
  importe: string
  /** El importe sigue al total a pagar mientras el usuario no lo toque */
  auto: boolean
  /** E-cheq propio desde el banco (en vez de transferencia) */
  echeq: boolean
  nroCheque: string
  /** Fecha de pago del e-cheq, YYYY-MM-DD */
  fechaCheque: string
}

/** Plazo máximo de un e-cheq (mismo límite que el servidor) */
const ECHEQ_MAX_DIAS = 360
const NRO_CHEQUE_RE = /^\d{1,8}$/

type Vista = { firma: string; ok: true; data: CalculoOrdenPago } | { firma: string; ok: false; mensajes: string[] }

interface ErrorEnvio {
  titulo: string
  mensajes: string[]
  ordenId?: string
}

// ── Formulario ──────────────────────────────────────────────────────────────

export default function NuevaOrdenPagoForm({
  proveedorInicial,
  facturasIniciales,
  embebido = false,
  onRegistrada,
  onCerrar,
  onOcupadoChange,
}: NuevaOrdenPagoFormProps = {}) {
  const router = useRouter()
  const hoy = useMemo(() => hoyAr(), [])

  // Proveedor
  const [busqueda, setBusqueda] = useState('')
  const busquedaDebounced = useDebouncedValue(busqueda, 300)
  const [resultados, setResultados] = useState<ProveedorBusqueda[]>([])
  const [buscando, setBuscando] = useState(false)
  const [proveedor, setProveedor] = useState<ProveedorBusqueda | null>(() =>
    proveedorInicial
      ? {
          id: proveedorInicial.id,
          name: proveedorInicial.nombre,
          legalName: null,
          taxId: proveedorInicial.cuit ?? null,
          colppyId: proveedorInicial.colppyId,
        }
      : null
  )
  const [fecha, setFecha] = useState(hoy)
  /** Facturas a tildar la primera vez que lleguen las impagas (se consumen una sola vez) */
  const tildarAlTraer = useRef<string[] | null>(facturasIniciales?.length ? [...facturasIniciales] : null)
  const autoTraido = useRef(false)

  // Preparación (Colppy)
  const [prep, setPrep] = useState<PreparacionPago | null>(null)
  const [prepFecha, setPrepFecha] = useState<string | null>(null)
  const [cargandoPrep, setCargandoPrep] = useState(false)
  const [errorPrep, setErrorPrep] = useState<string[] | null>(null)
  const prepReq = useRef(0)

  // Formulario
  const [seleccion, setSeleccion] = useState<Record<string, string>>({})
  const [retencionManual, setRetencionManual] = useState('')
  const [sinRetencion, setSinRetencion] = useState(false)
  const [medios, setMedios] = useState<Medio[]>([])
  const [descripcion, setDescripcion] = useState('')

  // Vista previa
  const [vista, setVista] = useState<Vista | null>(null)
  const previewReq = useRef(0)

  // Registro
  const [clave, setClave] = useState<{ firma: string; uuid: string } | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const enVuelo = useRef(false)
  const [errorEnvio, setErrorEnvio] = useState<ErrorEnvio | null>(null)
  const [incierto, setIncierto] = useState<ResultadoOrdenPago | null>(null)
  /**
   * El último envío terminó sin saber si se registró (red cortada, 5xx sin
   * respuesta clara): el formulario queda congelado y solo se puede reintentar
   * con LA MISMA clave, para que el servidor no lo duplique.
   */
  const [bloqueado, setBloqueado] = useState(false)

  /** Cualquier cambio del formulario descarta la clave del pedido */
  const tocar = useCallback(() => {
    setClave(null)
    setErrorEnvio(null)
  }, [])

  // ── Búsqueda de proveedor ───────────────────────────────────────────────

  useEffect(() => {
    const q = busquedaDebounced.trim()
    if (proveedor || q.length < 2) return
    let vigente = true
    const t = setTimeout(async () => {
      setBuscando(true)
      try {
        const r = await fetch(`/api/proveedores?search=${encodeURIComponent(q)}&limit=20`)
        const d = await r.json().catch(() => null)
        if (vigente) setResultados(r.ok && Array.isArray(d?.suppliers) ? d.suppliers : [])
      } catch {
        if (vigente) setResultados([])
      } finally {
        if (vigente) setBuscando(false)
      }
    }, 0)
    return () => {
      vigente = false
      clearTimeout(t)
    }
  }, [busquedaDebounced, proveedor])

  const resetearOrden = () => {
    prepReq.current++
    setPrep(null)
    setPrepFecha(null)
    setErrorPrep(null)
    setCargandoPrep(false)
    setSeleccion({})
    setRetencionManual('')
    setSinRetencion(false)
    setMedios([])
    setVista(null)
    tocar()
  }

  const elegirProveedor = (p: ProveedorBusqueda) => {
    resetearOrden()
    setProveedor(p)
    setResultados([])
  }

  const cambiarProveedor = () => {
    tildarAlTraer.current = null
    resetearOrden()
    setProveedor(null)
    setBusqueda('')
    setResultados([])
  }

  // ── Preparar ─────────────────────────────────────────────────────────────

  const traerFacturas = async () => {
    if (!proveedor || !fecha) return
    const mio = ++prepReq.current
    setCargandoPrep(true)
    setErrorPrep(null)
    try {
      const r = await fetch(`/api/pagos-proveedores/preparar?supplierId=${encodeURIComponent(proveedor.id)}&fecha=${encodeURIComponent(fecha)}`)
      const d = await r.json().catch(() => null)
      if (mio !== prepReq.current) return
      if (!r.ok || !d) {
        setErrorPrep(mensajesDeError(d, r.status))
        return
      }
      const p = d as PreparacionPago
      setPrep(p)
      setPrepFecha(fecha)
      // Las que venían tildadas desde afuera (panel del proveedor), solo la primera vez
      const iniciales = tildarAlTraer.current
      tildarAlTraer.current = null
      // Se conservan las facturas tildadas que siguen impagas y pagables (sin pasar el saldo)
      setSeleccion((s) => {
        const nueva: Record<string, string> = {}
        for (const f of p.impagas) {
          if (!f.pagable) continue
          if (!(f.idFactura in s)) {
            if (iniciales?.includes(f.idFactura) && f.saldo > 0) nueva[f.idFactura] = f.saldo.toFixed(2)
            continue
          }
          const imp = aNumero(s[f.idFactura])
          nueva[f.idFactura] = Number.isFinite(imp) && imp <= f.saldo ? s[f.idFactura] : f.saldo.toFixed(2)
        }
        return nueva
      })
      if (p.proveedor.regimen.tipo !== '78') {
        setRetencionManual('')
        setSinRetencion(false)
      }
      setMedios((m) => {
        const nombres = new Set(p.bancos.map((b) => b.nombre))
        const validos = m.filter((x) => nombres.has(x.cuenta))
        if (validos.length) return validos
        const galicia = p.bancos.find((b) => b.nombre.trim().toLowerCase() === 'cta cte galicia') ?? p.bancos[0]
        return galicia ? [{ uid: nuevoUid(), cuenta: galicia.nombre, importe: '', auto: true, echeq: false, nroCheque: '', fechaCheque: '' }] : []
      })
      tocar()
    } catch (e) {
      if (mio === prepReq.current) setErrorPrep([`No se pudo leer Colppy: ${(e as Error).message}`])
    } finally {
      if (mio === prepReq.current) setCargandoPrep(false)
    }
  }

  // Con proveedor inicial, las impagas se traen solas (una vez)
  useEffect(() => {
    if (!proveedorInicial || autoTraido.current) return
    autoTraido.current = true
    void traerFacturas()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Selección de facturas ───────────────────────────────────────────────

  const tildar = (idFactura: string, si: boolean) => {
    const f = prep?.impagas.find((x) => x.idFactura === idFactura)
    if (!f) return
    setSeleccion((s) => {
      const n = { ...s }
      if (si) n[idFactura] = f.saldo.toFixed(2)
      else delete n[idFactura]
      return n
    })
    tocar()
  }

  const tildarTodas = () => {
    if (!prep) return
    setSeleccion((s) => {
      const n = { ...s }
      for (const f of prep.impagas) if (f.pagable && f.saldo > 0 && !(f.idFactura in n)) n[f.idFactura] = f.saldo.toFixed(2)
      return n
    })
    tocar()
  }

  const destildarTodas = () => {
    setSeleccion({})
    tocar()
  }

  const setImporte = (idFactura: string, v: string) => {
    setSeleccion((s) => (idFactura in s ? { ...s, [idFactura]: v } : s))
    tocar()
  }

  // ── Derivados ───────────────────────────────────────────────────────────

  const regimen = prep?.proveedor.regimen ?? null
  const es78 = regimen?.tipo === '78'

  const erroresLocales = useMemo(() => {
    const errs: string[] = []
    if (!prep) return errs
    for (const [id, txt] of Object.entries(seleccion)) {
      const f = prep.impagas.find((x) => x.idFactura === id)
      if (!f) continue
      const n = aNumero(txt)
      if (!Number.isFinite(n) || n <= 0) errs.push(`${f.nroFactura}: el importe tiene que ser mayor a cero`)
      else if (r2(n) > f.saldo + 0.005) errs.push(`${f.nroFactura}: el importe (${formatCurrency(n)}) supera el saldo (${formatCurrency(f.saldo)})`)
    }
    if (es78 && !sinRetencion && retencionManual.trim() !== '') {
      const n = aNumero(retencionManual)
      if (!Number.isFinite(n) || n < 0) errs.push('La retención corregida no es un número válido')
    }
    return errs
  }, [prep, seleccion, es78, sinRetencion, retencionManual])

  const pedidoPreview = useMemo(() => {
    if (!prep || !proveedor || erroresLocales.length) return null
    const pagos: Record<string, number> = {}
    for (const [id, txt] of Object.entries(seleccion)) pagos[id] = r2(aNumero(txt))
    if (!Object.keys(pagos).length) return null
    const manual = es78 && !sinRetencion && retencionManual.trim() !== '' ? r2(aNumero(retencionManual)) : null
    return {
      supplierId: proveedor.id,
      fecha,
      pagos,
      retencionManual: manual,
      sinRetencion: es78 && sinRetencion,
    }
  }, [prep, proveedor, erroresLocales, seleccion, es78, sinRetencion, retencionManual, fecha])

  const firmaPreview = useMemo(() => (pedidoPreview ? JSON.stringify(pedidoPreview) : ''), [pedidoPreview])

  // Vista previa con debounce; una respuesta vieja se descarta
  useEffect(() => {
    const mio = ++previewReq.current
    if (!pedidoPreview) return
    const firma = firmaPreview
    const t = setTimeout(async () => {
      try {
        const r = await fetch('/api/pagos-proveedores/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: firma,
        })
        const d = await r.json().catch(() => null)
        if (mio !== previewReq.current) return
        if (!r.ok || !d) setVista({ firma, ok: false, mensajes: mensajesDeError(d, r.status) })
        else setVista({ firma, ok: true, data: d as CalculoOrdenPago })
      } catch (e) {
        if (mio === previewReq.current) setVista({ firma, ok: false, mensajes: [`No se pudo armar la vista previa: ${(e as Error).message}`] })
      }
    }, DEBOUNCE_PREVIEW_MS)
    return () => clearTimeout(t)
  }, [pedidoPreview, firmaPreview])

  const vigente = !!pedidoPreview && vista?.firma === firmaPreview
  const cargandoPreview = !!pedidoPreview && !vigente
  const calc = vigente && vista?.ok ? vista.data : null
  // Último cálculo bueno (aunque esté desactualizado) para el importe automático del medio
  const ultimoCalc = vista?.ok ? vista.data : null
  const totalAPagar = calc?.totalAPagar ?? null
  // Mientras llega la vista previa nueva se muestra la anterior, atenuada
  const calcMostrado = calc ?? (cargandoPreview ? ultimoCalc : null)

  const importeMedio = useCallback(
    (m: Medio): number => (m.auto ? (ultimoCalc?.totalAPagar ?? NaN) : r2(aNumero(m.importe))),
    [ultimoCalc]
  )
  const sumaMedios = r2(medios.reduce((a, m) => a + (Number.isFinite(importeMedio(m)) ? importeMedio(m) : 0), 0))
  const diferencia = totalAPagar !== null ? r2(totalAPagar - sumaMedios) : null
  const chequeCompleto = (m: Medio) =>
    !m.echeq ||
    (NRO_CHEQUE_RE.test(m.nroCheque.trim()) && !/^0+$/.test(m.nroCheque.trim()) && !!m.fechaCheque && m.fechaCheque >= fecha && m.fechaCheque <= sumarDias(fecha, ECHEQ_MAX_DIAS))
  const mediosCompletos =
    medios.length > 0 && medios.every((m) => !!m.cuenta && Number.isFinite(importeMedio(m)) && importeMedio(m) > 0 && chequeCompleto(m))
  const mediosCuadran = mediosCompletos && diferencia !== null && Math.abs(diferencia) < 0.005

  const cuerpoRegistro = useMemo(() => {
    if (!pedidoPreview) return null
    return {
      ...pedidoPreview,
      medios: medios.map((m) => ({
        cuenta: m.cuenta,
        importe: importeMedio(m),
        ...(m.echeq ? { cheque: { numero: m.nroCheque.trim(), fecha: m.fechaCheque } } : {}),
      })),
      descripcion: descripcion.trim(),
    }
  }, [pedidoPreview, medios, importeMedio, descripcion])
  const firmaRegistro = useMemo(() => (cuerpoRegistro ? JSON.stringify(cuerpoRegistro) : ''), [cuerpoRegistro])

  const altasHabilitadas = !!prep?.altasHabilitadas
  const noSoportado = regimen?.tipo === 'NO_SOPORTADO'
  const motivoNoRegistrar = !prep
    ? 'Traé las facturas impagas'
    : !altasHabilitadas
      ? 'El registro en Colppy está apagado'
      : noSoportado
        ? 'Régimen de retención no soportado'
        : !pedidoPreview
          ? 'Elegí al menos una factura'
          : cargandoPreview
            ? 'Esperando la vista previa'
            : !calc
              ? 'La vista previa tiene errores'
              : !mediosCompletos
                ? medios.some((m) => !chequeCompleto(m))
                  ? 'Completá el número y la fecha de pago del e-cheq'
                  : 'Completá los medios de pago'
                : !mediosCuadran
                  ? 'Los medios no suman el total a pagar'
                  : null
  const puedeRegistrar = motivoNoRegistrar === null && !enviando

  /** Medio de Colppy de la cuenta elegida: "Transferencia" (banco) o "Tarjeta de Crédito" */
  const medioDeCuenta = (cuenta: string) => prep?.bancos.find((b) => b.nombre === cuenta)?.medio ?? 'Transferencia'
  const esBanco = (cuenta: string) => medioDeCuenta(cuenta) === 'Transferencia'
  /** Cómo se muestra el medio: e-cheq, transferencia o tarjeta */
  const nombreMedio = (m: Medio) => (m.echeq && esBanco(m.cuenta) ? 'E-cheq' : medioDeCuenta(m.cuenta))

  const fechaMin = sumarDias(hoy, -45)
  const fechaDistinta = !!prepFecha && prepFecha !== fecha

  // No cerrar la pestaña mientras se registra
  useEffect(() => {
    if (!enviando) return
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [enviando])

  // El panel que lo contiene no se tiene que cerrar mientras se registra o si no se sabe cómo terminó
  const ocupado = enviando || bloqueado || !!incierto
  useEffect(() => {
    onOcupadoChange?.(ocupado)
  }, [ocupado, onOcupadoChange])

  // ── Medios ──────────────────────────────────────────────────────────────

  const setMedio = (uid: string, cambios: Partial<Medio>) => {
    setMedios((ms) => ms.map((m) => (m.uid === uid ? { ...m, ...cambios } : m)))
    tocar()
  }

  const editarImporteMedio = (m: Medio, v: string) => setMedio(m.uid, { importe: v, auto: false })

  const agregarMedio = () => {
    if (!prep || medios.length >= MAX_MEDIOS) return
    setMedios((ms) => {
      // El automático queda fijo con lo que mostraba, para que el nuevo reparta la diferencia
      const fijos = ms.map((m) => (m.auto ? { ...m, auto: false, importe: Number.isFinite(importeMedio(m)) ? importeMedio(m).toFixed(2) : '' } : m))
      const suma = r2(fijos.reduce((a, m) => a + (Number.isFinite(aNumero(m.importe)) ? aNumero(m.importe) : 0), 0))
      const resto = totalAPagar !== null ? r2(totalAPagar - suma) : 0
      const banco = prep.bancos[0]?.nombre ?? ''
      return [...fijos, { uid: nuevoUid(), cuenta: banco, importe: resto > 0 ? resto.toFixed(2) : '', auto: false, echeq: false, nroCheque: '', fechaCheque: '' }]
    })
    tocar()
  }

  const quitarMedio = (uid: string) => {
    setMedios((ms) => ms.filter((m) => m.uid !== uid))
    tocar()
  }

  // ── Registro ────────────────────────────────────────────────────────────

  const abrirConfirmacion = () => {
    if (!puedeRegistrar || !firmaRegistro) return
    // Misma clave mientras el contenido no cambie (p. ej. reintento tras un error de red)
    if (!clave || clave.firma !== firmaRegistro) setClave({ firma: firmaRegistro, uuid: crypto.randomUUID() })
    setConfirmando(true)
  }

  const confirmar = async () => {
    if (enVuelo.current || !cuerpoRegistro || !clave || clave.firma !== firmaRegistro) return
    enVuelo.current = true
    setEnviando(true)
    setErrorEnvio(null)
    const ordenUrl = (id: string) => `/proveedores/pagos/${id}`
    try {
      let r: Response
      try {
        r = await fetch('/api/pagos-proveedores', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idempotencyKey: clave.uuid, ...cuerpoRegistro }),
        })
      } catch (e) {
        // Sin respuesta: no sabemos si llegó. La clave queda y el formulario se congela: reintentar no duplica.
        setBloqueado(true)
        setErrorEnvio({
          titulo: 'Se cortó la conexión con el servidor: puede haberse registrado',
          mensajes: [
            `${(e as Error).message}.`,
            'Volvé a tocar «Registrar en Colppy» sin cambiar nada: se manda con la misma clave y el servidor no lo duplica.',
            'Si preferís, revisá el listado de pagos antes de volver a intentar.',
          ],
        })
        setConfirmando(false)
        return
      }
      const d = await r.json().catch(() => null)
      if (r.ok && d && typeof d.estado === 'string') {
        const res = d as ResultadoOrdenPago
        setBloqueado(false)
        setConfirmando(false)
        if (res.estado === 'REGISTRADA') {
          toast.success(`Orden de pago ${res.numero ?? ''} registrada en Colppy`, {
            description: res.repetida ? 'Ya se había registrado con este pedido: no se volvió a mandar.' : `Total pagado ${formatCurrency(res.totalPagado)}`,
            duration: 10000,
          })
          if (onRegistrada) onRegistrada({ id: res.id, numero: res.numero ?? null })
          else router.push(ordenUrl(res.id))
          return
        }
        if (res.estado === 'INCIERTO') {
          setIncierto(res)
          return
        }
        if (res.estado === 'ERROR') {
          setErrorEnvio({ titulo: 'Colppy no registró el pago', mensajes: [res.error ?? 'Error sin detalle'], ordenId: res.id })
          return
        }
        // REGISTRANDO: otra pestaña lo está mandando
        toast.warning('La orden se está registrando: revisala en el detalle')
        router.push(ordenUrl(res.id))
        return
      }
      setConfirmando(false)
      const codigo = String(d?.codigo ?? '')
      const ordenId = typeof d?.id === 'string' ? d.id : undefined
      const mensajes = mensajesDeError(d, r.status)
      // Respuestas que no dicen si el alta salió: congelar y reintentar solo con la misma clave
      const desconocido = !d || (r.status >= 500 && !(r.status === 503 && codigo === 'APAGADO') && !(r.status === 502 && codigo === 'COLPPY_LECTURA'))
      setBloqueado(desconocido)
      if (desconocido) {
        setErrorEnvio({
          titulo: 'No sabemos si se registró',
          mensajes: [...mensajes, 'Volvé a tocar «Registrar en Colppy» sin cambiar nada (misma clave: no se duplica), o abrí la orden y verificala.'],
          ordenId,
        })
      } else if (r.status === 409 && (codigo === 'EN_CURSO' || codigo === 'HAY_PENDIENTE')) {
        setErrorEnvio({ titulo: 'Esta orden ya se está registrando', mensajes: [...mensajes, 'No la vuelvas a cargar: abrí la orden y verificala.'], ordenId })
      } else if (r.status === 409 && codigo === 'CLAVE_USADA') {
        setClave(null)
        setErrorEnvio({ titulo: 'La clave del pedido ya se usó', mensajes: [...mensajes, 'Volvé a tocar «Registrar en Colppy» para generar otra.'] })
      } else if (r.status === 503 || codigo === 'APAGADO') {
        setErrorEnvio({ titulo: 'El registro en Colppy está apagado', mensajes })
      } else if (r.status === 422 || r.status === 400) {
        setErrorEnvio({ titulo: 'Hay que corregir el pedido', mensajes, ordenId })
      } else if (r.status === 502) {
        setErrorEnvio({ titulo: 'No se pudo leer Colppy: no se mandó el pago', mensajes, ordenId })
      } else if (r.status === 401 || r.status === 403) {
        setErrorEnvio({ titulo: 'Sin permisos para registrar pagos a proveedores', mensajes })
      } else {
        setErrorEnvio({ titulo: 'No se pudo registrar el pago', mensajes, ordenId })
      }
    } finally {
      enVuelo.current = false
      setEnviando(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  const impagas = prep?.impagas ?? []
  const tildadas = Object.keys(seleccion).length
  const hayPagables = impagas.some((f) => f.pagable && f.saldo > 0)

  return (
    <div className={embebido ? 'space-y-4' : 'space-y-6 pb-32'}>
      {!embebido && (
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/proveedores/pagos" aria-label="Volver a Pagos">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Nueva orden de pago</h1>
            <p className="text-muted-foreground">Se arma acá y se da de alta en Colppy. Fase 1: facturas en pesos, transferencias y tarjeta de crédito.</p>
          </div>
        </div>
      )}

      <fieldset disabled={enviando || bloqueado} className={`min-w-0 ${embebido ? 'space-y-4' : 'space-y-6'}`}>
        {/* Proveedor y fecha */}
        <Card>
          <CardHeader>
            <CardTitle>Proveedor y fecha</CardTitle>
            <CardDescription>Las facturas, la retención y los bancos se leen de Colppy.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-[1fr_auto]">
              <div className="space-y-1">
                <Label>Proveedor</Label>
                {proveedor ? (
                  <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{proveedor.legalName || proveedor.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {proveedor.taxId ? `CUIT ${proveedor.taxId}` : 'Sin CUIT'}
                        {proveedor.colppyId === null && <span className="ml-2 text-red-700">· No está vinculado a Colppy</span>}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={cambiarProveedor}>
                      <X className="mr-1 h-4 w-4" />
                      Cambiar
                    </Button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <Input className="pl-9" placeholder="Buscar por nombre, razón social o CUIT" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} autoFocus />
                    {buscando && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-400" />}
                    {busqueda.trim().length >= 2 && resultados.length > 0 && (
                      <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-white shadow-lg dark:bg-gray-900">
                        {resultados.map((p) => (
                          <li key={p.id}>
                            <button type="button" className="w-full px-3 py-2 text-left hover:bg-blue-50 dark:hover:bg-gray-800" onClick={() => elegirProveedor(p)}>
                              <p className="font-medium">{p.legalName || p.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {p.taxId ? `CUIT ${p.taxId}` : 'Sin CUIT'}
                                {p.legalName && p.legalName !== p.name ? ` · ${p.name}` : ''}
                                {!p.colppyId && ' · sin Colppy'}
                              </p>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {busquedaDebounced.trim().length >= 2 && !buscando && resultados.length === 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">Sin resultados.</p>
                    )}
                  </div>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="fecha">Fecha del pago</Label>
                <Input
                  id="fecha"
                  type="date"
                  value={fecha}
                  min={fechaMin}
                  max={hoy}
                  onChange={(e) => {
                    setFecha(e.target.value)
                    tocar()
                  }}
                  className="w-full md:w-44"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={traerFacturas} disabled={!proveedor || !fecha || cargandoPrep}>
                {cargandoPrep ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                {prep ? 'Volver a traer facturas impagas' : 'Traer facturas impagas'}
              </Button>
              {cargandoPrep && <span className="text-sm text-muted-foreground">Leyendo Colppy…</span>}
            </div>
            {errorPrep && (
              <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                <p className="font-semibold">No se pudieron traer las facturas</p>
                <ul className="list-disc pl-5">
                  {errorPrep.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        {prep && (
          <>
            {!prep.altasHabilitadas && (
              <div className="flex items-center gap-2 rounded-lg border-2 border-amber-400 bg-amber-50 p-3 text-sm font-medium text-amber-900">
                <AlertTriangle className="h-5 w-5 shrink-0" />
                El registro en Colppy está apagado: por ahora solo vista previa.
              </div>
            )}

            {/* Datos del proveedor en Colppy */}
            <Card>
              <CardHeader>
                <CardTitle>{prep.proveedor.nombre}</CardTitle>
                <CardDescription>CUIT {prep.proveedor.cuit || '—'}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex flex-wrap gap-x-8 gap-y-2">
                  <div>
                    <span className="text-muted-foreground">Retención de Ganancias: </span>
                    {regimen?.tipo === '78' ? (
                      <span className="font-medium">régimen 78 (RG 830)</span>
                    ) : regimen?.tipo === 'NINGUNO' ? (
                      <span className="font-medium">no retiene</span>
                    ) : (
                      <span className="font-medium text-red-700">régimen {regimen?.tipo === 'NO_SOPORTADO' ? regimen.codigo : ''} (no soportado)</span>
                    )}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Próximo número de OP: </span>
                    <span className="font-mono font-medium">{prep.proximoNumero}</span>
                    <span className="text-xs text-muted-foreground"> (el número final se asigna al confirmar)</span>
                  </div>
                </div>
                {noSoportado && (
                  <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-red-800">
                    Este régimen de retención todavía no se puede desde el ERP: cargá este pago en Colppy.
                  </div>
                )}
                {fechaDistinta && (
                  <p className="text-amber-800">
                    Cambiaste la fecha: los datos de arriba son del {fechaCorta(prepFecha)}. La vista previa ya usa la fecha nueva; tocá «Volver a traer facturas impagas» para actualizar esta lista.
                  </p>
                )}
                {prep.pagosDelMes.length > 0 && (
                  <div>
                    <p className="mb-1 font-medium">Pagos ya hechos este mes</p>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Número</TableHead>
                            <TableHead>Fecha</TableHead>
                            <TableHead className="text-right">Base de cálculo</TableHead>
                            <TableHead className="text-right">Retenido</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {prep.pagosDelMes.map((p) => (
                            <TableRow key={p.idPago}>
                              <TableCell className="font-mono">{p.nroPago}</TableCell>
                              <TableCell>{fechaCorta(p.fecha)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right">{formatCurrency(p.baseCalculo1)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right">{formatCurrency(p.retGanancias1)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Facturas impagas */}
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle>Facturas impagas</CardTitle>
                    <CardDescription>
                      {impagas.length === 0 ? 'El proveedor no tiene facturas impagas en Colppy.' : `${impagas.length} en Colppy · ${tildadas} tildada${tildadas === 1 ? '' : 's'}`}
                    </CardDescription>
                  </div>
                  {impagas.length > 0 && (
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={tildarTodas} disabled={!hayPagables}>
                        Tildar todas las pagables
                      </Button>
                      <Button variant="ghost" size="sm" onClick={destildarTodas} disabled={tildadas === 0}>
                        Destildar
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              {impagas.length > 0 && (
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10" />
                          <TableHead>Número</TableHead>
                          <TableHead>Vencimiento</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                          <TableHead className="text-right">Saldo</TableHead>
                          <TableHead className="text-right">Importe a pagar</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {impagas.map((f) => {
                          const tildada = f.idFactura in seleccion
                          const txt = seleccion[f.idFactura] ?? ''
                          const n = aNumero(txt)
                          const malo = tildada && (!Number.isFinite(n) || n <= 0 || r2(n) > f.saldo + 0.005)
                          return (
                            <TableRow key={f.idFactura} className={!f.pagable ? 'bg-gray-50 text-muted-foreground' : tildada ? 'bg-blue-50/50' : ''}>
                              <TableCell>
                                <Checkbox
                                  checked={tildada}
                                  disabled={!f.pagable || enviando}
                                  onCheckedChange={(v) => tildar(f.idFactura, v === true)}
                                  aria-label={`Pagar ${f.nroFactura}`}
                                />
                              </TableCell>
                              <TableCell>
                                <span className="whitespace-nowrap font-mono">
                                  {f.tipoComprobante && f.tipoComprobante !== 'FAC' ? `${f.tipoComprobante} ` : ''}
                                  {f.nroFactura}
                                </span>
                                {!f.pagable && f.motivoNoPagable && <p className="text-xs text-amber-800">{f.motivoNoPagable}</p>}
                                {f.descripcion && <p className="max-w-xs truncate text-xs text-muted-foreground" title={f.descripcion}>{f.descripcion}</p>}
                              </TableCell>
                              <TableCell className="whitespace-nowrap">{fechaCorta(f.vencimiento)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right">{formatCurrency(f.totalFactura)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right font-semibold">{formatCurrency(f.saldo)}</TableCell>
                              <TableCell className="text-right">
                                <Input
                                  type="number"
                                  inputMode="decimal"
                                  step="0.01"
                                  min="0"
                                  max={f.saldo}
                                  value={txt}
                                  disabled={!tildada}
                                  onChange={(e) => setImporte(f.idFactura, e.target.value)}
                                  className={`ml-auto w-36 text-right font-mono ${malo ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                                  aria-label={`Importe a pagar de ${f.nroFactura}`}
                                />
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              )}
            </Card>

            {/* Vista previa */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Vista previa
                  {cargandoPreview && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
                </CardTitle>
                <CardDescription>Mismo cálculo que el registro, con los pagos del mes en Colppy. No registra nada.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                {erroresLocales.length > 0 && (
                  <ul className="list-disc space-y-1 rounded-lg border border-red-300 bg-red-50 p-3 pl-8 text-red-800">
                    {erroresLocales.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                )}
                {!pedidoPreview && erroresLocales.length === 0 && <p className="text-muted-foreground">Tildá al menos una factura.</p>}
                {pedidoPreview && vigente && vista && !vista.ok && (
                  <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-red-800">
                    <p className="font-semibold">La vista previa no pasó</p>
                    <ul className="list-disc pl-5">
                      {vista.mensajes.map((m, i) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {pedidoPreview && cargandoPreview && !calc && <p className="text-muted-foreground">Calculando…</p>}
                {calcMostrado && <ResumenCalculo calc={calcMostrado} desactualizado={!calc} />}

                {es78 && (
                  <div className="flex flex-wrap items-end gap-6 border-t pt-4">
                    <div className="space-y-1">
                      <Label htmlFor="retencion">Corregir retención</Label>
                      <Input
                        id="retencion"
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        placeholder={calc?.retencion ? `Calculada: ${calc.retencion.retencion.toFixed(2)}` : 'Vacío = la calculada'}
                        value={retencionManual}
                        disabled={sinRetencion}
                        onChange={(e) => {
                          setRetencionManual(e.target.value)
                          tocar()
                        }}
                        className="w-52 text-right font-mono"
                      />
                    </div>
                    <label className="flex items-center gap-2 pb-2">
                      <Checkbox
                        checked={sinRetencion}
                        onCheckedChange={(v) => {
                          setSinRetencion(v === true)
                          tocar()
                        }}
                      />
                      No retener
                    </label>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Medios de pago */}
            <Card>
              <CardHeader>
                <CardTitle>Medios de pago</CardTitle>
                <CardDescription>Transferencia o e-cheq propio desde un banco, o tarjeta de crédito, en pesos (cuentas de Colppy). Tienen que sumar el total a pagar al centavo.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {prep.bancos.length === 0 ? (
                  <p className="text-sm text-red-700">Colppy no devolvió bancos ni tarjetas en pesos.</p>
                ) : (
                  <>
                    {medios.map((m) => (
                      <div key={m.uid} className="flex flex-wrap items-center gap-2">
                        {esBanco(m.cuenta) ? (
                          <Select
                            value={m.echeq ? 'echeq' : 'transferencia'}
                            onValueChange={(v) => setMedio(m.uid, { echeq: v === 'echeq' })}
                            disabled={enviando}
                          >
                            <SelectTrigger className="w-36" aria-label="Tipo de pago desde el banco">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="transferencia">Transferencia</SelectItem>
                              <SelectItem value="echeq">E-cheq</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="w-36 text-sm text-muted-foreground">{medioDeCuenta(m.cuenta)}</span>
                        )}
                        <Select
                          value={m.cuenta}
                          onValueChange={(v) => setMedio(m.uid, esBanco(v) ? { cuenta: v } : { cuenta: v, echeq: false })}
                          disabled={enviando}
                        >
                          <SelectTrigger className="w-64">
                            <SelectValue placeholder="Cuenta" />
                          </SelectTrigger>
                          <SelectContent>
                            {prep.bancos.map((b) => (
                              <SelectItem key={`${b.medio}-${b.nombre}`} value={b.nombre}>
                                {b.nombre}
                                {b.medio === 'Tarjeta de Crédito' ? ' (tarjeta)' : ''}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          min="0"
                          value={m.auto ? (Number.isFinite(importeMedio(m)) ? importeMedio(m).toFixed(2) : '') : m.importe}
                          placeholder={m.auto ? 'Total a pagar' : 'Importe'}
                          onChange={(e) => editarImporteMedio(m, e.target.value)}
                          className="w-40 text-right font-mono"
                          aria-label="Importe del medio de pago"
                        />
                        {m.auto && <span className="text-xs text-muted-foreground">sigue al total</span>}
                        {m.echeq && esBanco(m.cuenta) && (
                          <>
                            <Input
                              inputMode="numeric"
                              maxLength={8}
                              value={m.nroCheque}
                              placeholder="Nº e-cheq"
                              onChange={(e) => setMedio(m.uid, { nroCheque: e.target.value.replace(/\D/g, '') })}
                              className="w-28 font-mono"
                              aria-label="Número de e-cheq"
                              disabled={enviando}
                            />
                            <Label className="text-xs text-muted-foreground" htmlFor={`fecha-cheque-${m.uid}`}>
                              Paga el
                            </Label>
                            <Input
                              id={`fecha-cheque-${m.uid}`}
                              type="date"
                              min={fecha}
                              max={sumarDias(fecha, ECHEQ_MAX_DIAS)}
                              value={m.fechaCheque}
                              onChange={(e) => setMedio(m.uid, { fechaCheque: e.target.value })}
                              className="w-40"
                              disabled={enviando}
                            />
                          </>
                        )}
                        {medios.length > 1 && (
                          <Button variant="ghost" size="icon" onClick={() => quitarMedio(m.uid)} aria-label="Quitar medio">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-sm">
                      <Button variant="outline" size="sm" onClick={agregarMedio} disabled={medios.length >= MAX_MEDIOS}>
                        <Plus className="mr-1 h-4 w-4" />
                        Agregar medio
                      </Button>
                      <div className="flex flex-wrap gap-6 text-right">
                        <div>
                          <p className="text-xs text-muted-foreground">Suma de medios</p>
                          <p className="font-mono">{formatCurrency(sumaMedios)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Diferencia con el total</p>
                          <p className={`font-mono ${diferencia === null ? '' : Math.abs(diferencia) < 0.005 ? 'text-green-700' : 'font-semibold text-red-700'}`}>
                            {diferencia === null ? '—' : formatCurrency(diferencia)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Descripción */}
            <Card>
              <CardHeader>
                <CardTitle>Descripción</CardTitle>
                <CardDescription>Opcional. Va a Colppy con el pago.</CardDescription>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={descripcion}
                  onChange={(e) => {
                    setDescripcion(e.target.value.slice(0, MAX_DESCRIPCION))
                    tocar()
                  }}
                  maxLength={MAX_DESCRIPCION}
                  rows={2}
                />
                <p className="mt-1 text-right text-[11px] text-muted-foreground">
                  {descripcion.length}/{MAX_DESCRIPCION}
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </fieldset>

      {errorEnvio && (
        <div className="rounded-lg border-2 border-red-400 bg-red-50 p-4 text-sm text-red-900">
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-5 w-5" />
            {errorEnvio.titulo}
          </p>
          <ul className="mt-1 list-disc pl-8">
            {errorEnvio.mensajes.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
          {errorEnvio.ordenId && (
            <Link href={`/proveedores/pagos/${errorEnvio.ordenId}`} className="mt-2 inline-block text-blue-700 underline">
              Abrir la orden
            </Link>
          )}
        </div>
      )}

      {/* Pie fijo */}
      {prep && (
        <div
          className={
            embebido
              ? 'sticky bottom-0 z-10 rounded-lg border bg-white/95 px-4 py-3 shadow-[0_-2px_8px_rgba(0,0,0,0.06)] backdrop-blur dark:bg-gray-900/95'
              : 'sticky bottom-0 z-10 -mx-6 border-t bg-white/95 px-6 py-3 shadow-[0_-2px_8px_rgba(0,0,0,0.06)] backdrop-blur dark:bg-gray-900/95'
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap gap-6 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Facturas</p>
                <p className="font-mono">{tildadas}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Retención</p>
                <p className="font-mono">{calc ? formatCurrency(calc.retencion?.importe ?? 0) : '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total a pagar</p>
                <p className="font-mono text-xl font-bold">{calc ? formatCurrency(calc.totalAPagar) : '—'}</p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="flex gap-2">
                {embebido && onCerrar && (
                  <Button variant="outline" onClick={onCerrar} disabled={ocupado}>
                    Cancelar
                  </Button>
                )}
                <Button onClick={abrirConfirmacion} disabled={!puedeRegistrar}>
                  {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Registrar en Colppy
                </Button>
              </div>
              {motivoNoRegistrar && <p className="text-xs text-muted-foreground">{motivoNoRegistrar}</p>}
            </div>
          </div>
        </div>
      )}

      {/* Confirmación */}
      <AlertDialog open={confirmando} onOpenChange={(o) => !enviando && setConfirmando(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Registrar el pago en Colppy?</AlertDialogTitle>
            <AlertDialogDescription>Crea la orden de pago en Colppy. No se puede deshacer desde el ERP.</AlertDialogDescription>
          </AlertDialogHeader>
          {calc && prep && (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Proveedor</span>
                <span className="text-right font-medium">{prep.proveedor.nombre}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Fecha</span>
                <span>{fechaCorta(fecha)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Facturas</span>
                <span>
                  {calc.aplicaciones.length} · {formatCurrency(calc.totalFacturas)}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Retención Ganancias</span>
                <span>{formatCurrency(calc.retencion?.importe ?? 0)}</span>
              </div>
              <div className="flex justify-between gap-4 border-t pt-2 text-base font-semibold">
                <span>Total a pagar</span>
                <span className="font-mono">{formatCurrency(calc.totalAPagar)}</span>
              </div>
              <div className="border-t pt-2">
                <p className="mb-1 text-muted-foreground">Medios</p>
                {medios.map((m) => (
                  <div key={m.uid} className="flex justify-between gap-4">
                    <span>
                      {nombreMedio(m)} · {m.cuenta}
                      {m.echeq && esBanco(m.cuenta) && ` · Nº ${m.nroCheque.trim().padStart(8, '0')} · paga el ${m.fechaCheque.split('-').reverse().join('/')}`}
                    </span>
                    <span className="font-mono">{formatCurrency(importeMedio(m))}</span>
                  </div>
                ))}
              </div>
              {calc.avisos.length > 0 && (
                <ul className="list-disc rounded border border-amber-300 bg-amber-50 p-2 pl-6 text-amber-900">
                  {calc.avisos.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setConfirmando(false)} disabled={enviando}>
              Cancelar
            </Button>
            <Button onClick={confirmar} disabled={enviando}>
              {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {enviando ? 'Registrando…' : 'Sí, registrar en Colppy'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Incierto: bloqueante */}
      <AlertDialog open={!!incierto}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-amber-800">
              <AlertTriangle className="h-5 w-5" />
              No sabemos si Colppy lo creó
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p className="font-semibold text-gray-900">NO lo vuelvas a cargar.</p>
                <p>Abrí la orden {incierto?.numero ?? ''} y tocá «Verificar en Colppy»: busca el número en los pagos del proveedor.</p>
                {incierto?.error && <p className="text-xs">{incierto.error}</p>}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button onClick={() => incierto && router.push(`/proveedores/pagos/${incierto.id}`)}>Abrir la orden</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Registrando: no cerrar */}
      {enviando && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-white/70 backdrop-blur-sm dark:bg-gray-950/70" role="status" aria-live="assertive">
          <div className="flex flex-col items-center gap-3 rounded-lg border bg-white p-6 shadow-lg dark:bg-gray-900">
            <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
            <p className="text-lg font-semibold">Registrando en Colppy…</p>
            <p className="text-sm text-muted-foreground">No cierres esta ventana ni recargues la página.</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Resumen de la vista previa ──────────────────────────────────────────────

function Fila({ label, valor, fuerte }: { label: string; valor: number; fuerte?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${fuerte ? 'border-t pt-2 text-base font-semibold' : ''}`}>
      <span className={fuerte ? '' : 'text-muted-foreground'}>{label}</span>
      <span className="font-mono">{formatCurrency(valor)}</span>
    </div>
  )
}

function ResumenCalculo({ calc, desactualizado }: { calc: CalculoOrdenPago; desactualizado: boolean }) {
  const ret = calc.retencion
  return (
    <div className={`space-y-3 ${desactualizado ? 'opacity-50' : ''}`}>
      <div className="max-w-md space-y-1">
        <Fila label={`Total facturas (${calc.aplicaciones.length})`} valor={calc.totalFacturas} />
        {ret && (
          <>
            <Fila label="Base de este pago (neto sin IVA)" valor={ret.baseEstePago} />
            <Fila label="Base previa del mes" valor={ret.basePrevia} />
            <Fila label="Base acumulada" valor={ret.baseAcumulada} />
            <Fila label="Retenido antes en el mes" valor={ret.retenidoPrevio} />
            <Fila label="Retención calculada" valor={ret.retencion} />
            {ret.corregida && <Fila label="Retención corregida a mano" valor={ret.importe} />}
          </>
        )}
        <Fila label="Total a pagar" valor={calc.totalAPagar} fuerte />
      </div>
      {calc.avisos.length > 0 && (
        <ul className="list-disc space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 pl-8 text-amber-900">
          {calc.avisos.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
