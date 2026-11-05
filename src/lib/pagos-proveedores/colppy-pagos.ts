// Las respuestas de Colppy son JSON sin tipar: se leen campo por campo con valores por defecto.
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Llamadas a Colppy para las órdenes de pago a proveedores. Son las mismas que
 * hace la pantalla "Agregar pago" de Colppy (capturadas el 5/11/2026, ver
 * docs/DISENO-PAGOS-PROVEEDORES-COLPPY.md). Todas son de lectura salvo
 * `colppyAltaPago`.
 */
import {
  callColppyAPI,
  getCachedColppySession,
  getColppyConfig,
  invalidateColppySessionCache,
  md5Hash,
  ColppySessionExpiredError,
  type ColppySession,
} from '@/lib/colppy'
import type { ImpagaColppy } from './alta-pago'
import type { PagoPrevioMes } from './retencion'

export class ColppyPagoError extends Error {
  constructor(message: string, public operacion: string) {
    super(message)
    this.name = 'ColppyPagoError'
  }
}

function payload(session: ColppySession, provision: string, operacion: string, extra: Record<string, unknown>) {
  const config = getColppyConfig()
  return {
    auth: { usuario: config.user, password: md5Hash(config.password) },
    service: { provision, operacion },
    parameters: {
      sesion: { usuario: session.usuario, claveSesion: session.claveSesion },
      idEmpresa: session.idEmpresa,
      ...extra,
    },
  }
}

/** Respuesta "ok" de Colppy: result.estado 0 y response.success distinto de false */
function respuestaOk(r: any): boolean {
  return r?.result?.estado === 0 && r?.response?.success !== false
}

function mensaje(r: any): string {
  return String(r?.response?.message || r?.result?.mensaje || 'Error desconocido de Colppy')
}

/**
 * Llamada de LECTURA con la sesión cacheada; si Colppy la invalidó, renueva y
 * reintenta una vez (leer no tiene efectos, reintentar es seguro).
 */
async function leer(provision: string, operacion: string, extra: Record<string, unknown>, timeoutMs = 60000): Promise<any> {
  if (!/^(leer|listar|buscar|detalle|facturas_impagas)_/.test(operacion)) {
    throw new Error(`leer() es solo para lecturas: ${provision}/${operacion}`)
  }
  let session = await getCachedColppySession()
  let r: any
  try {
    r = await callColppyAPI<any>(payload(session, provision, operacion, extra), timeoutMs, { throwOnEstadoError: false })
  } catch (e) {
    if (!(e instanceof ColppySessionExpiredError)) throw e
    invalidateColppySessionCache()
    session = await getCachedColppySession()
    r = await callColppyAPI<any>(payload(session, provision, operacion, extra), timeoutMs, { throwOnEstadoError: false })
  }
  if (!respuestaOk(r)) throw new ColppyPagoError(`Colppy (${provision}/${operacion}): ${mensaje(r)}`, `${provision}/${operacion}`)
  return r.response
}

// ── Proveedor ───────────────────────────────────────────────────────────────

export interface ProveedorColppy {
  idProveedor: string
  razonSocial: string
  cuit: string
  /** Régimen de retención de Ganancias del proveedor ("78", "0"/"" = no retiene) */
  idRetGanancias: string
  cbu: string
}

export async function colppyDetalleProveedor(idProveedor: string): Promise<ProveedorColppy> {
  const r = await leer('Proveedor', 'detalle_proveedor', { idProveedor, calcularpercagip: '0' })
  const d = Array.isArray(r?.data) ? r.data[0] : r?.data
  if (!d?.idProveedor) throw new ColppyPagoError(`Colppy no devolvió el proveedor ${idProveedor}`, 'Proveedor/detalle_proveedor')
  return {
    idProveedor: String(d.idProveedor),
    razonSocial: String(d.RazonSocial ?? ''),
    cuit: String(d.CUIT ?? ''),
    idRetGanancias: String(d.idRetGanancias ?? ''),
    cbu: String(d.CBU ?? ''),
  }
}

/** Todas las facturas/NC impagas del proveedor, como las lista la pantalla de pagos */
export async function colppyImpagasProveedor(idProveedor: string): Promise<ImpagaColppy[]> {
  const out: ImpagaColppy[] = []
  const limit = 200
  for (let start = 0; start < 5000; start += limit) {
    const r = await leer('Proveedor', 'facturas_impagas_proveedor', { idProveedor, idPago: '', valorCambio: 0, start, limit })
    const filas: any[] = r?.data?.resultados ?? []
    out.push(...filas.map((f) => ({ ...f, idFactura: String(f.idFactura) })))
    // Se sigue mientras la página venga llena; totalCount solo si llega numérico
    const tc = Number(r?.data?.totalCount ?? r?.totalCount)
    if (filas.length < limit || (Number.isFinite(tc) && out.length >= tc)) break
  }
  return out
}

// ── Tesorería y numeración ──────────────────────────────────────────────────

export interface BancoColppy {
  /** Nombre que va en idPlanCuenta del medio de pago */
  nombre: string
  cuentaContable: string
  moneda: string
  idBanco: string
}

export async function colppyBancosArs(): Promise<BancoColppy[]> {
  const r = await leer('Tesoreria', 'leer_origen_fondos2', { idTipo: 'banco', monedas: ['ARS'] })
  const filas: any[] = r?.data?.data ?? []
  return filas
    .filter((b) => String(b.Moneda ?? 'ARS') === 'ARS' && b.Nombre)
    .map((b) => ({ nombre: String(b.Nombre), cuentaContable: String(b.idPlanCuenta ?? ''), moneda: 'ARS', idBanco: String(b.idBanco ?? '') }))
}

export const PREFIJO_OP = '0001'

export async function colppyProximoNumeroOp(prefijo = PREFIJO_OP): Promise<{ nroPago1: string; nroPago2: string }> {
  const r = await leer('Proveedor', 'buscar_numero_op', { prefijo })
  const n = String(r?.data?.proximoNum ?? '')
  if (!/^\d{1,8}$/.test(n)) throw new ColppyPagoError(`Colppy devolvió un número de OP raro: "${n}"`, 'Proveedor/buscar_numero_op')
  return { nroPago1: prefijo, nroPago2: n.padStart(8, '0') }
}

// ── Netos de facturas (base de la retención) ────────────────────────────────

export interface NetoColppy {
  idFactura: string
  totalFactura: number
  netoGravado: number
  netoNoGravado: number
  moneda: string
}

/**
 * Caché corto para la vista previa (se recalcula con cada cambio de la
 * pantalla). Una entrada vale solo si el total sigue igual al de la impaga
 * recién leída; el registro siempre lee de nuevo (`fresco`).
 */
const NETOS_TTL_MS = 10 * 60 * 1000
const netosCache = new Map<string, NetoColppy & { ts: number }>()

export async function colppyNetosFacturas(
  facturas: Array<{ id: string; totalFactura: number }>,
  opts: { fresco?: boolean } = {}
): Promise<Map<string, NetoColppy>> {
  const out = new Map<string, NetoColppy>()
  const vistos = new Set<string>()
  for (const { id: idFactura, totalFactura: totalImpaga } of facturas) {
    if (vistos.has(idFactura)) continue
    vistos.add(idFactura)
    const cached = netosCache.get(idFactura)
    if (!opts.fresco && cached && Date.now() - cached.ts < NETOS_TTL_MS && Math.abs(cached.totalFactura - totalImpaga) < 0.01) {
      out.set(idFactura, cached)
      continue
    }
    const r = await leer('FacturaCompra', 'leer_facturacompra', { idFactura })
    const i = r?.infofactura
    if (!i) throw new ColppyPagoError(`Colppy no devolvió la factura ${idFactura}`, 'FacturaCompra/leer_facturacompra')
    const n: NetoColppy = {
      idFactura,
      totalFactura: Number(i.totalFactura),
      netoGravado: Number(i.netoGravado) || 0,
      netoNoGravado: Number(i.netoNoGravado) || 0,
      moneda: String(i.currencyIso ?? ''),
    }
    if (!(n.totalFactura > 0)) throw new ColppyPagoError(`La factura ${idFactura} tiene total ${i.totalFactura} en Colppy`, 'FacturaCompra/leer_facturacompra')
    if (Math.abs(n.totalFactura - totalImpaga) >= 0.01) {
      throw new ColppyPagoError(
        `La factura ${idFactura} figura con total ${n.totalFactura} y en las impagas con ${totalImpaga}: revisala en Colppy`,
        'FacturaCompra/leer_facturacompra'
      )
    }
    netosCache.set(idFactura, { ...n, ts: Date.now() })
    out.set(idFactura, n)
  }
  return out
}

// ── Pagos del mes (acumulado de la retención) ───────────────────────────────

const ymd = (d: Date) => d.toISOString().slice(0, 10)

async function idsPagosProveedor(idProveedor: string, desde: string, hasta: string): Promise<string[]> {
  const ids = new Set<string>()
  for (let start = 0; start < 50000; start += 1000) {
    const r = await leer('Contabilidad', 'listar_movimientosdiario', { fromDate: desde, toDate: hasta, start, limit: 1000 }, 120000)
    const movs: any[] = r?.movimientos ?? []
    // idTabla 14 = pagos; idObjetoContacto = idProveedor
    for (const m of movs) if (String(m.idTabla) === '14' && String(m.idObjetoContacto) === idProveedor) ids.add(String(m.idElemento))
    if (movs.length < 1000) break
  }
  return [...ids]
}

export async function colppyLeerPago(idPago: string): Promise<any> {
  const r = await leer('Pago', 'leer_pago', { idPago })
  return r?.data
}

export interface PagoColppyMes extends PagoPrevioMes {
  totalPagado: number
}

/**
 * Pagos registrados en Colppy al proveedor en el mes de `fechaIso`
 * (YYYY-MM-DD), del día 1 a fin de mes. Los anulados vienen marcados
 * (`anulado`): no cuentan, pero hacen falta para reconstruir la base acumulada.
 */
export async function colppyPagosDelMes(idProveedor: string, fechaIso: string): Promise<PagoColppyMes[]> {
  const [y, m] = fechaIso.split('-').map(Number)
  const desde = ymd(new Date(Date.UTC(y, m - 1, 1)))
  const hasta = ymd(new Date(Date.UTC(y, m, 0)))
  const out: PagoColppyMes[] = []
  for (const idPago of await idsPagosProveedor(idProveedor, desde, hasta)) {
    const d = await colppyLeerPago(idPago)
    if (!d || String(d.idProveedor) !== idProveedor) continue
    out.push({
      idPago: String(d.idPago ?? idPago),
      nroPago: String(d.nroPago ?? ''),
      fecha: String(d.fechaPago ?? ''),
      idRetGanancias1: String(d.idRetGanancias1 ?? '0'),
      baseCalculo1: Number(d.baseCalculo1) || 0,
      retGanancias1: Number(d.retGanancias1) || 0,
      anulado: /anulad/i.test(String(d.idEstadoPago ?? '')),
      totalPagado: Number(d.totalpagado) || 0,
    })
  }
  return out
}

/**
 * Para verificar un alta incierta: el pago del proveedor con ese número (si
 * está) y los vigentes del mes con el mismo total pero otro número.
 */
export async function colppyBuscarPagoPorNumero(
  idProveedor: string,
  fechaIso: string,
  nroPago: string,
  totalPagado: number
): Promise<{ conNumero: PagoColppyMes | null; mismoTotalOtroNumero: PagoColppyMes[] }> {
  const pagos = (await colppyPagosDelMes(idProveedor, fechaIso)).filter((p) => !p.anulado)
  return {
    conNumero: pagos.find((p) => p.nroPago === nroPago) ?? null,
    mismoTotalOtroNumero: pagos.filter((p) => p.nroPago !== nroPago && Math.abs(p.totalPagado - totalPagado) < 0.01),
  }
}

// ── Alta ────────────────────────────────────────────────────────────────────

export type ResultadoAltaPago =
  | { estado: 'OK'; idPago: string; respuesta: unknown }
  /** Colppy contestó que no: no se creó nada */
  | { estado: 'RECHAZADO'; error: string; respuesta: unknown }
  /** Sin respuesta clara (timeout, red, HTML): puede haberse creado */
  | { estado: 'INCIERTO'; error: string }

/**
 * Pago/alta_pago. SIN reintentos: un reintento a ciegas puede duplicar el pago.
 * Conviene llamarlo justo después de una lectura (p. ej. colppyProximoNumeroOp)
 * para que la sesión cacheada esté recién usada.
 */
export async function colppyAltaPago(parameters: Record<string, unknown>): Promise<ResultadoAltaPago> {
  let session: ColppySession
  try {
    session = await getCachedColppySession()
  } catch (e) {
    return { estado: 'RECHAZADO', error: `No se pudo abrir sesión en Colppy (no se mandó el pago): ${(e as Error).message}`, respuesta: null }
  }
  let r: any
  try {
    r = await callColppyAPI<any>(payload(session, 'Pago', 'alta_pago', parameters), 90000, { throwOnEstadoError: false })
  } catch (e) {
    if (e instanceof ColppySessionExpiredError) invalidateColppySessionCache()
    return { estado: 'INCIERTO', error: (e as Error).message }
  }
  const idPago = r?.response?.data?.idPago ?? r?.response?.idPago
  if (respuestaOk(r) && r?.response?.data?.success !== false && idPago) {
    return { estado: 'OK', idPago: String(idPago), respuesta: r }
  }
  if (r?.result && r.result.estado !== 0) return { estado: 'RECHAZADO', error: mensaje(r), respuesta: r }
  if (r?.response?.success === false || r?.response?.data?.success === false) {
    return { estado: 'RECHAZADO', error: String(r?.response?.data?.message || mensaje(r)), respuesta: r }
  }
  // Dijo que sí pero sin idPago: no sabemos qué quedó
  return { estado: 'INCIERTO', error: `Colppy respondió sin idPago: ${JSON.stringify(r).slice(0, 300)}` }
}
