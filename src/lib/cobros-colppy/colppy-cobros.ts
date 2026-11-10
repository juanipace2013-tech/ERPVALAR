// Las respuestas de Colppy son JSON sin tipar: se leen campo por campo con valores por defecto.
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Llamadas a Colppy para los recibos de cobro a clientes. Son las mismas que
 * hace la pantalla "Agregar cobro" de Colppy (capturadas el 10/11/2026, ver
 * docs/DISENO-COBROS-COLPPY.md). Todas son de lectura salvo `colppyAltaCobro`.
 */
import {
  callColppyAPI,
  getCachedColppySession,
  invalidateColppySessionCache,
  ColppySessionExpiredError,
  type ColppySession,
} from '@/lib/colppy'
import { ColppyPagoError, cuentasArs, leer, mensaje, payload, respuestaOk, type BancoColppy } from '@/lib/pagos-proveedores/colppy-pagos'
import type { ImpagaCobroColppy } from './alta-cobro'

/** Comprobantes impagos del cliente, como los lista la pantalla de cobros */
export async function colppyImpagasCliente(idCliente: string): Promise<ImpagaCobroColppy[]> {
  const out: ImpagaCobroColppy[] = []
  const limit = 200
  for (let start = 0; start < 5000; start += limit) {
    const r = await leer('FacturaVenta', 'leer_facturas_a_cobrar', { idCobro: '', valorCambio: '0', idCliente, start, limit })
    const filas: any[] = Array.isArray(r?.data) ? r.data : []
    out.push(...filas.map((f) => ({ ...f, idFactura: String(f.idFactura) })))
    const total = Number(r?.total)
    if (filas.length < limit || (Number.isFinite(total) && out.length >= total)) break
  }
  return out
}

/** Cuentas en pesos donde puede entrar una transferencia (bancos, MercadoPago) */
export async function colppyCuentasCobroArs(): Promise<BancoColppy[]> {
  return cuentasArs('Transferencia')
}

export const PREFIJO_RECIBO = '0001'

export async function colppyProximoNumeroRecibo(prefijo = PREFIJO_RECIBO): Promise<{ nroRecibo1: string; nroRecibo2: string }> {
  const r = await leer('Empresa', 'leer_numero_recibo', { prefijo })
  const n = String(r?.data?.proximoNum ?? '')
  if (!/^\d{1,8}$/.test(n)) throw new ColppyPagoError(`Colppy devolvió un número de recibo raro: "${n}"`, 'Empresa/leer_numero_recibo')
  return { nroRecibo1: prefijo, nroRecibo2: n.padStart(8, '0') }
}

export type ResultadoAltaCobro =
  | { estado: 'OK'; idCobro: string; respuesta: unknown }
  /** Colppy contestó que no: no se creó nada */
  | { estado: 'RECHAZADO'; error: string; respuesta: unknown }
  /** Sin respuesta clara (timeout, red, HTML): puede haberse creado */
  | { estado: 'INCIERTO'; error: string }

/** Usuario de Colppy de la sesión: el front lo manda en `idUsuario` del alta */
export async function colppyUsuarioSesion(): Promise<string> {
  return (await getCachedColppySession()).usuario
}

/**
 * Cliente/alta_cobro. SIN reintentos: un reintento a ciegas puede duplicar el
 * recibo. Conviene llamarlo justo después de una lectura (p. ej.
 * colppyProximoNumeroRecibo) para que la sesión cacheada esté recién usada.
 */
export async function colppyAltaCobro(parameters: Record<string, unknown>): Promise<ResultadoAltaCobro> {
  let session: ColppySession
  try {
    session = await getCachedColppySession()
  } catch (e) {
    return { estado: 'RECHAZADO', error: `No se pudo abrir sesión en Colppy (no se mandó el cobro): ${(e as Error).message}`, respuesta: null }
  }
  let r: any
  try {
    r = await callColppyAPI<any>(payload(session, 'Cliente', 'alta_cobro', parameters), 90000, { throwOnEstadoError: false })
  } catch (e) {
    if (e instanceof ColppySessionExpiredError) invalidateColppySessionCache()
    return { estado: 'INCIERTO', error: (e as Error).message }
  }
  const idCobro = r?.response?.idCobro ?? r?.response?.data?.idCobro
  if (respuestaOk(r) && idCobro) return { estado: 'OK', idCobro: String(idCobro), respuesta: r }
  if (r?.result && r.result.estado !== 0) return { estado: 'RECHAZADO', error: mensaje(r), respuesta: r }
  if (r?.response?.success === false) return { estado: 'RECHAZADO', error: mensaje(r), respuesta: r }
  // Dijo que sí pero sin idCobro: no sabemos qué quedó
  return { estado: 'INCIERTO', error: `Colppy respondió sin idCobro: ${JSON.stringify(r).slice(0, 300)}` }
}
