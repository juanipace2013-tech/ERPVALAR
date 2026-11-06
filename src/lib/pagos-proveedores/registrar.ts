/**
 * Órdenes de pago a proveedores: se arman en el ERP y se dan de alta en Colppy
 * (Pago/alta_pago) igual que con la pantalla "Agregar pago" de Colppy.
 * Fase 1: facturas en pesos, transferencias desde bancos en pesos, retención
 * de Ganancias régimen 78. Ver docs/DISENO-PAGOS-PROVEEDORES-COLPPY.md.
 *
 * Seguridad del alta (no se puede deshacer por API):
 * - Idempotencia por clave: el mismo pedido nunca da de alta dos pagos.
 * - Un alta a la vez en el proceso (candado): el número de OP lo pide el ERP a
 *   Colppy justo antes y dos altas simultáneas tomarían el mismo número.
 * - Todo se vuelve a leer de Colppy al registrar (impagas, netos, pagos del mes,
 *   bancos): lo que mandó la pantalla solo elige facturas, importes y medios.
 * - Sin respuesta clara de Colppy → INCIERTO: no se reintenta, se verifica
 *   (`verificarOrdenDePago`) buscando el número en Colppy.
 * - El pedido completo se guarda ANTES del alta: si el proceso se corta en el
 *   medio, la orden queda con su número y se puede verificar.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { armarAltaPago, AltaPagoError, esPagableFase1, normalizarNroCheque, saldoImpaga, type ImpagaColppy, type MedioPago } from './alta-pago'
import { calcularRetencion78, netoDeFactura, REGIMEN_78, type CalculoRetencion, type PagoPrevioMes } from './retencion'
import {
  colppyAltaPago,
  colppyBancosArs,
  colppyBuscarPagoPorNumero,
  colppyDetalleProveedor,
  colppyImpagasProveedor,
  colppyNetosFacturas,
  colppyPagosDelMes,
  colppyProximoNumeroOp,
  colppySaldoProveedor,
  type BancoColppy,
  type ProveedorColppy,
} from './colppy-pagos'

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** Las altas se habilitan con PAGOS_PROVEEDORES_COLPPY=1 (sin eso, la pantalla solo previsualiza) */
export function altasHabilitadas(): boolean {
  return process.env.PAGOS_PROVEEDORES_COLPPY === '1'
}

export class OrdenPagoError extends Error {
  constructor(message: string, public codigo: string, public status: number, public extra: Record<string, unknown> = {}) {
    super(message)
    this.name = 'OrdenPagoError'
  }
}

/** Un REGISTRANDO más viejo que esto sin pedido guardado se puede volver a tomar */
export const REGISTRANDO_VENCE_MS = 15 * 60 * 1000

// ── Fechas ──────────────────────────────────────────────────────────────────

const FECHA_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Hoy en Argentina (UTC-3), YYYY-MM-DD */
export function hoyAr(now = new Date()): string {
  return new Date(now.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10)
}

export function validarFecha(fecha: unknown, now = new Date()): string {
  const s = String(fecha ?? '')
  const m = FECHA_RE.exec(s)
  if (!m) throw new OrdenPagoError('Fecha inválida (YYYY-MM-DD)', 'PEDIDO_INVALIDO', 400)
  const d = new Date(`${s}T12:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new OrdenPagoError('Fecha inválida', 'PEDIDO_INVALIDO', 400)
  const hoy = new Date(`${hoyAr(now)}T12:00:00Z`)
  const dias = Math.round((d.getTime() - hoy.getTime()) / 86400000)
  if (dias > 0) throw new OrdenPagoError('La fecha del pago no puede ser futura', 'PEDIDO_INVALIDO', 400)
  if (dias < -45) throw new OrdenPagoError('La fecha del pago es de hace más de 45 días: cargala en Colppy', 'PEDIDO_INVALIDO', 400)
  return s
}

// ── Proveedor ───────────────────────────────────────────────────────────────

async function proveedorErp(supplierId: string) {
  const s = await prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true, name: true, legalName: true, taxId: true, colppyId: true } })
  if (!s) throw new OrdenPagoError('Proveedor no encontrado', 'NO_ENCONTRADO', 404)
  if (!s.colppyId || !/^\d+$/.test(s.colppyId)) {
    throw new OrdenPagoError('El proveedor no está vinculado a Colppy (sincronizá proveedores desde Colppy)', 'SIN_COLPPY', 422)
  }
  return { ...s, colppyId: s.colppyId }
}

export type RegimenProveedor = { tipo: '78' } | { tipo: 'NINGUNO' } | { tipo: 'NO_SOPORTADO'; codigo: string }

export function regimenDe(p: ProveedorColppy): RegimenProveedor {
  const c = p.idRetGanancias.trim()
  if (!c || c === '0') return { tipo: 'NINGUNO' }
  if (c === REGIMEN_78.codigo) return { tipo: '78' }
  return { tipo: 'NO_SOPORTADO', codigo: c }
}

// ── Preparar (datos para la pantalla) ───────────────────────────────────────

export interface ImpagaParaPantalla {
  idFactura: string
  nroFactura: string
  tipoComprobante: string
  vencimiento: string
  totalFactura: number
  saldo: number
  pagable: boolean
  motivoNoPagable: string | null
  descripcion: string
}

export interface PreparacionPago {
  proveedor: { id: string; nombre: string; cuit: string; colppyId: string; regimen: RegimenProveedor }
  impagas: ImpagaParaPantalla[]
  bancos: BancoColppy[]
  pagosDelMes: PagoPrevioMes[]
  proximoNumero: string
  altasHabilitadas: boolean
}

function paraPantalla(f: ImpagaColppy): ImpagaParaPantalla {
  const p = esPagableFase1(f)
  return {
    idFactura: String(f.idFactura),
    nroFactura: String(f.nroFactura),
    tipoComprobante: String(f.tipoComprobante),
    vencimiento: String(f.fechaPago ?? ''),
    totalFactura: r2(Number(f.totalFactura)),
    saldo: saldoImpaga(f),
    pagable: p.ok,
    motivoNoPagable: p.ok ? null : p.motivo,
    descripcion: String(f.descripcion ?? ''),
  }
}

/**
 * Facturas adeudadas al proveedor, en vivo de Colppy (como la pestaña
 * "Facturas adeudadas" de Colppy). Liviana: una sola lectura paginada.
 */
/**
 * Copia a Supplier.balance el saldo actual del proveedor en Colppy, para que el
 * listado no espere al sync. Best-effort: si falla, queda el saldo anterior.
 */
export async function actualizarSaldoProveedor(supplierId: string): Promise<void> {
  try {
    const s = await prisma.supplier.findUnique({ where: { id: supplierId }, select: { colppyId: true, balance: true } })
    if (!s?.colppyId || !/^\d+$/.test(s.colppyId)) return
    const saldo = await colppySaldoProveedor(s.colppyId)
    if (saldo === null || Math.abs(Number(s.balance) - saldo) < 0.005) return
    await prisma.supplier.update({ where: { id: supplierId }, data: { balance: saldo } })
  } catch (e) {
    logger.warn(`[Proveedores] No se pudo actualizar el saldo de ${supplierId}: ${(e as Error).message}`)
  }
}

export async function facturasAdeudadas(supplierId: string): Promise<{ colppyId: string; impagas: ImpagaParaPantalla[]; saldo: number }> {
  const s = await proveedorErp(supplierId)
  const impagas = (await colppyImpagasProveedor(s.colppyId)).map(paraPantalla)
  return { colppyId: s.colppyId, impagas, saldo: r2(impagas.reduce((a, f) => a + f.saldo, 0)) }
}

export async function prepararOrdenDePago(supplierId: string, fecha: string): Promise<PreparacionPago> {
  const s = await proveedorErp(supplierId)
  const fechaOk = validarFecha(fecha)
  const pc = await colppyDetalleProveedor(s.colppyId)
  const regimen = regimenDe(pc)
  const impagas = await colppyImpagasProveedor(s.colppyId)
  const bancos = await colppyBancosArs()
  const pagosDelMes = regimen.tipo === '78' ? await colppyPagosDelMes(s.colppyId, fechaOk) : []
  const n = await colppyProximoNumeroOp()
  return {
    proveedor: { id: s.id, nombre: pc.razonSocial || s.legalName || s.name, cuit: pc.cuit || s.taxId || '', colppyId: s.colppyId, regimen },
    impagas: impagas.map(paraPantalla),
    bancos,
    pagosDelMes,
    proximoNumero: `${n.nroPago1}-${n.nroPago2}`,
    altasHabilitadas: altasHabilitadas(),
  }
}

// ── Cálculo (vista previa y registro usan el mismo) ─────────────────────────

export interface PedidoOrdenPago {
  idempotencyKey: string
  supplierId: string
  fecha: string
  /** idFactura (Colppy) → importe a pagar */
  pagos: Record<string, number>
  /** Retención corregida a mano (null = la calculada) */
  retencionManual: number | null
  /** El usuario decidió no retener aunque el proveedor tenga régimen */
  sinRetencion: boolean
  /** `cheque` = e-cheq propio desde ese banco (número y fecha de pago YYYY-MM-DD) */
  medios: Array<{ cuenta: string; importe: number; cheque?: { numero: string; fecha: string } }>
  descripcion: string
}

export interface CalculoOrdenPago {
  aplicaciones: Array<{ idFactura: string; nroFactura: string; totalFactura: number; saldo: number; importe: number; neto: number }>
  totalFacturas: number
  retencion: (CalculoRetencion & { importe: number; corregida: boolean }) | null
  totalAPagar: number
  avisos: string[]
}

async function calcular(
  s: { colppyId: string },
  fecha: string,
  pagos: Record<string, number>,
  impagas: ImpagaColppy[],
  regimen: RegimenProveedor,
  opciones: { retencionManual: number | null; sinRetencion: boolean; fresco?: boolean }
): Promise<CalculoOrdenPago> {
  const avisos: string[] = []
  const porId = new Map(impagas.map((f) => [String(f.idFactura), f]))
  const elegidas = Object.entries(pagos).filter(([, v]) => r2(v) > 0)
  if (!elegidas.length) throw new OrdenPagoError('Elegí al menos una factura', 'PEDIDO_INVALIDO', 422)
  const errores: string[] = []
  for (const [id, imp] of elegidas) {
    const f = porId.get(id)
    if (!f) {
      errores.push(`La factura ${id} ya no figura impaga en Colppy`)
      continue
    }
    const p = esPagableFase1(f)
    if (!p.ok) errores.push(`${f.nroFactura}: ${p.motivo}`)
    if (r2(imp) > saldoImpaga(f) + 0.005) errores.push(`${f.nroFactura}: se paga ${r2(imp)} y el saldo es ${saldoImpaga(f)}`)
  }
  if (errores.length) throw new OrdenPagoError(errores.join(' · '), 'VALIDACION', 422, { errores })

  // Cada impaga trae su régimen (RG) y Colppy calcula por factura: en fase 1 solo
  // se calcula si todas las elegidas tienen el mismo régimen que la ficha del proveedor.
  const regimenFicha = regimen.tipo === '78' ? REGIMEN_78.codigo : regimen.tipo === 'NINGUNO' ? '' : regimen.codigo
  const distintas = elegidas
    .map(([id]) => porId.get(id)!)
    .filter((f) => {
      const rg = String(f.RG ?? '').trim()
      return (rg === '0' ? '' : rg) !== regimenFicha
    })
  if (distintas.length) {
    throw new OrdenPagoError(
      `${distintas.map((f) => `${f.nroFactura} (RG ${String(f.RG ?? '').trim() || 'ninguno'})`).join(', ')}: régimen de Ganancias distinto al del proveedor (${regimenFicha || 'ninguno'}). Cargá este pago en Colppy.`,
      'REGIMEN_MIXTO',
      422
    )
  }

  const netos = await colppyNetosFacturas(
    elegidas.map(([id]) => ({ id, totalFactura: r2(Number(porId.get(id)!.totalFactura)) })),
    { fresco: opciones.fresco }
  )
  const aplicaciones = elegidas.map(([id, imp]) => {
    const f = porId.get(id)!
    const n = netos.get(id)!
    const importe = r2(imp)
    return {
      idFactura: id,
      nroFactura: String(f.nroFactura),
      totalFactura: r2(Number(f.totalFactura)),
      saldo: saldoImpaga(f),
      importe,
      neto: r2(netoDeFactura({ estePago: importe, totalFactura: n.totalFactura, netoGravado: n.netoGravado, netoNoGravado: n.netoNoGravado })),
      _n: n,
    }
  })
  const totalFacturas = r2(aplicaciones.reduce((a, x) => a + x.importe, 0))

  let retencion: CalculoOrdenPago['retencion'] = null
  if (regimen.tipo === 'NO_SOPORTADO') {
    throw new OrdenPagoError(
      `El proveedor tiene el régimen de retención ${regimen.codigo}: todavía no se puede desde el ERP, cargá este pago en Colppy`,
      'REGIMEN_NO_SOPORTADO',
      422
    )
  }
  if (regimen.tipo === '78' && !opciones.sinRetencion) {
    const previos = await colppyPagosDelMes(s.colppyId, fecha)
    const calc = calcularRetencion78(
      aplicaciones.map((a) => ({ estePago: a.importe, totalFactura: a._n.totalFactura, netoGravado: a._n.netoGravado, netoNoGravado: a._n.netoNoGravado })),
      previos
    )
    const manual = opciones.retencionManual
    if (manual !== null && (!Number.isFinite(manual) || manual < 0)) throw new OrdenPagoError('Retención inválida', 'PEDIDO_INVALIDO', 422)
    const importe = manual !== null ? r2(manual) : calc.retencion
    if (importe > totalFacturas) throw new OrdenPagoError('La retención supera lo que se paga', 'VALIDACION', 422)
    retencion = { ...calc, importe, corregida: manual !== null && Math.abs(r2(manual) - calc.retencion) > 0.005 }
    avisos.push(...calc.avisos)
    if (retencion.corregida) avisos.push(`Retención corregida a mano: ${importe} (el cálculo daba ${calc.retencion})`)
  }
  if (regimen.tipo === '78' && opciones.sinRetencion) avisos.push('El proveedor tiene régimen 78 y se eligió no retener')
  const totalAPagar = r2(totalFacturas - (retencion?.importe ?? 0))
  return {
    aplicaciones: aplicaciones.map((a) => ({ idFactura: a.idFactura, nroFactura: a.nroFactura, totalFactura: a.totalFactura, saldo: a.saldo, importe: a.importe, neto: a.neto })),
    totalFacturas,
    retencion,
    totalAPagar,
    avisos,
  }
}

/** Vista previa: mismo cálculo que el registro, sin efectos */
export async function previsualizarOrdenDePago(p: Omit<PedidoOrdenPago, 'idempotencyKey' | 'medios' | 'descripcion'>): Promise<CalculoOrdenPago> {
  const s = await proveedorErp(p.supplierId)
  const fecha = validarFecha(p.fecha)
  const pc = await colppyDetalleProveedor(s.colppyId)
  const impagas = await colppyImpagasProveedor(s.colppyId)
  return calcular(s, fecha, p.pagos, impagas, regimenDe(pc), p)
}

// ── Validación del pedido ───────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function validarPedidoOrdenPago(body: unknown, opts: { requiereClave: boolean }): PedidoOrdenPago {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- body JSON sin tipar, se valida campo por campo
  const b = (body ?? {}) as Record<string, any>
  const errores: string[] = []
  if (opts.requiereClave && !UUID_RE.test(String(b.idempotencyKey ?? ''))) errores.push('Falta la clave del pedido')
  if (!b.supplierId || typeof b.supplierId !== 'string') errores.push('Falta el proveedor')
  const pagos: Record<string, number> = {}
  if (!b.pagos || typeof b.pagos !== 'object' || Array.isArray(b.pagos)) errores.push('Faltan las facturas')
  else {
    for (const [k, v] of Object.entries(b.pagos)) {
      const n = Number(v)
      if (!/^\d+$/.test(k) || !Number.isFinite(n) || n < 0) errores.push(`Importe inválido para la factura ${k}`)
      else if (n > 0) pagos[k] = n
    }
  }
  const medios: PedidoOrdenPago['medios'] = []
  if (opts.requiereClave) {
    if (!Array.isArray(b.medios) || !b.medios.length) errores.push('Falta el medio de pago')
    else if (b.medios.length > 10) errores.push('Demasiados medios de pago')
    else
      for (const m of b.medios) {
        const importe = Number(m?.importe)
        const cuenta = String(m?.cuenta ?? '').trim()
        if (!cuenta || !Number.isFinite(importe) || importe <= 0) errores.push('Medio de pago incompleto')
        else if (m?.cheque !== undefined && m?.cheque !== null) {
          const numero = String(m.cheque?.numero ?? '').trim()
          const fechaCheque = String(m.cheque?.fecha ?? '').trim()
          if (!numero || !fechaCheque) errores.push(`E-cheq de ${cuenta}: faltan el número o la fecha de pago`)
          else medios.push({ cuenta, importe, cheque: { numero, fecha: fechaCheque } })
        } else medios.push({ cuenta, importe })
      }
  }
  let retencionManual: number | null = null
  if (b.retencionManual !== null && b.retencionManual !== undefined && b.retencionManual !== '') {
    retencionManual = Number(b.retencionManual)
    if (!Number.isFinite(retencionManual) || retencionManual < 0) errores.push('Retención inválida')
  }
  if (errores.length) throw new OrdenPagoError(errores.join(' · '), 'PEDIDO_INVALIDO', 400, { errores })
  return {
    idempotencyKey: String(b.idempotencyKey ?? ''),
    supplierId: b.supplierId,
    fecha: String(b.fecha ?? ''),
    pagos,
    retencionManual,
    sinRetencion: b.sinRetencion === true,
    medios,
    descripcion: String(b.descripcion ?? '').slice(0, 200),
  }
}

// ── Registro ────────────────────────────────────────────────────────────────

/**
 * Un e-cheq propio no se puede usar dos veces: frena si el mismo número del
 * mismo banco ya está en otra orden del ERP que no terminó en error. (Colppy
 * valida el número con un PHP interno del front que la API no expone.)
 */
async function chequesNoUsados(medios: Array<MedioPago>, ordenId: string): Promise<void> {
  for (const m of medios) {
    if (m.medio !== 'Echeqs' || !m.cheque) continue
    const numero = normalizarNroCheque(m.cheque.numero)
    if (!numero) continue // lo rechaza armarAltaPago con el mensaje de número inválido
    const usado = await prisma.supplierPaymentMedium.findFirst({
      where: { accountName: m.cuenta, chequeNumber: numero, orderId: { not: ordenId }, order: { status: { not: 'ERROR' } } },
      select: { order: { select: { paymentNumber: true } } },
    })
    if (usado) {
      throw new OrdenPagoError(
        `El e-cheq ${numero} de ${m.cuenta} ya se usó${usado.order.paymentNumber ? ` en la orden ${usado.order.paymentNumber}` : ''}`,
        'VALIDACION',
        422
      )
    }
  }
}

/** Un alta a la vez: el número de OP se pide justo antes y no se puede compartir */
let cola: Promise<unknown> = Promise.resolve()
function enExclusiva<T>(fn: () => Promise<T>): Promise<T> {
  const r = cola.then(fn, fn)
  cola = r.catch(() => undefined)
  return r
}

export interface ResultadoOrdenPago {
  id: string
  estado: 'REGISTRADA' | 'ERROR' | 'INCIERTO' | 'REGISTRANDO'
  numero: string | null
  colppyPaymentId: string | null
  totalPagado: number
  error: string | null
  repetida: boolean
}

function resultado(o: { id: string; status: string; paymentNumber: string | null; colppyPaymentId: string | null; totalPaid: Prisma.Decimal | number; lastError: string | null }, repetida: boolean): ResultadoOrdenPago {
  return {
    id: o.id,
    estado: o.status as ResultadoOrdenPago['estado'],
    numero: o.paymentNumber,
    colppyPaymentId: o.colppyPaymentId,
    totalPagado: Number(o.totalPaid),
    error: o.lastError,
    repetida,
  }
}

/** Toma la orden de esta clave para registrarla, o devuelve la que ya existe */
async function tomarOrden(p: PedidoOrdenPago, userId: string, colppySupplierId: string, fecha: string): Promise<{ id: string } | ResultadoOrdenPago> {
  const existente = await prisma.supplierPaymentOrder.findUnique({ where: { idempotencyKey: p.idempotencyKey } })
  if (existente) {
    if (existente.supplierId !== p.supplierId) throw new OrdenPagoError('La clave del pedido ya se usó para otro proveedor', 'CLAVE_USADA', 409)
    if (existente.status === 'REGISTRADA' || existente.status === 'INCIERTO') return resultado(existente, true)
    // ERROR, o REGISTRANDO trabado ANTES de mandar el alta (sin pedido guardado): se puede volver a tomar
    const tomada = await prisma.supplierPaymentOrder.updateMany({
      where: {
        id: existente.id,
        OR: [
          { status: 'ERROR' },
          { status: 'REGISTRANDO', colppyRequest: { equals: Prisma.DbNull }, updatedAt: { lt: new Date(Date.now() - REGISTRANDO_VENCE_MS) } },
        ],
      },
      data: {
        status: 'REGISTRANDO',
        lastError: null,
        colppyRequest: Prisma.DbNull,
        colppyResponse: Prisma.DbNull,
        paymentNumber: null,
        // verificar busca con esta fecha y proveedor: tienen que ser los del nuevo intento
        paymentDate: new Date(`${fecha}T00:00:00Z`),
        colppySupplierId,
        description: p.descripcion || null,
      },
    })
    if (tomada.count !== 1) {
      const actual = await prisma.supplierPaymentOrder.findUniqueOrThrow({ where: { id: existente.id } })
      if (actual.status === 'REGISTRANDO' && actual.colppyRequest !== null) {
        // Se mandó el alta y el proceso no terminó de anotar la respuesta
        throw new OrdenPagoError('Esta orden se está registrando en Colppy o quedó a medio registrar: verificala', 'EN_CURSO', 409, { id: actual.id })
      }
      if (actual.status === 'REGISTRANDO') throw new OrdenPagoError('Esta orden se está registrando en Colppy en este momento', 'EN_CURSO', 409, { id: actual.id })
      return resultado(actual, true)
    }
    await prisma.$transaction([
      prisma.supplierPaymentApplication.deleteMany({ where: { orderId: existente.id } }),
      prisma.supplierPaymentMedium.deleteMany({ where: { orderId: existente.id } }),
    ])
    return { id: existente.id }
  }
  try {
    const o = await prisma.supplierPaymentOrder.create({
      data: {
        idempotencyKey: p.idempotencyKey,
        supplierId: p.supplierId,
        colppySupplierId,
        paymentDate: new Date(`${fecha}T00:00:00Z`),
        status: 'REGISTRANDO',
        invoicesTotal: 0,
        totalPaid: 0,
        description: p.descripcion || null,
        createdById: userId,
      },
      select: { id: true },
    })
    return o
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new OrdenPagoError('Este pedido ya se está registrando', 'EN_CURSO', 409)
    }
    throw e
  }
}

async function marcarError(id: string, error: string) {
  await prisma.supplierPaymentOrder.update({ where: { id }, data: { status: 'ERROR', lastError: error.slice(0, 4000) } })
}

/**
 * Baja el saldo de las facturas de compra del ERP vinculadas a las pagadas
 * (mismo proveedor y colppyInvoiceId). Idempotente: cada aplicación se marca
 * con su factura del ERP en la misma transacción que baja el saldo, y una ya
 * marcada no se vuelve a aplicar. Nunca lanza.
 */
async function aplicarEnFacturasErp(orderId: string) {
  try {
    const orden = await prisma.supplierPaymentOrder.findUnique({ where: { id: orderId }, select: { supplierId: true, status: true } })
    if (!orden || orden.status !== 'REGISTRADA') return
    const apps = await prisma.supplierPaymentApplication.findMany({ where: { orderId, purchaseInvoiceId: null } })
    for (const a of apps) {
      const candidatas = await prisma.purchaseInvoice.findMany({
        where: { colppyInvoiceId: a.colppyInvoiceId, supplierId: orden.supplierId, status: { not: 'CANCELLED' } },
        select: { id: true },
        take: 2,
      })
      if (candidatas.length !== 1) {
        if (candidatas.length > 1) logger.warn(`[Pagos proveedores] Factura Colppy ${a.colppyInvoiceId} vinculada a más de una factura de compra: no se tocó el saldo`)
        continue
      }
      const piId = candidatas[0].id
      await prisma.$transaction(async (tx) => {
        const marcada = await tx.supplierPaymentApplication.updateMany({ where: { id: a.id, purchaseInvoiceId: null }, data: { purchaseInvoiceId: piId } })
        if (marcada.count !== 1) return
        const pi = await tx.purchaseInvoice.findUniqueOrThrow({ where: { id: piId }, select: { balance: true } })
        const saldo = r2(Math.max(0, Number(pi.balance) - Number(a.amount)))
        await tx.purchaseInvoice.update({
          where: { id: piId },
          data: { balance: saldo, ...(saldo <= 0.01 ? { paymentStatus: 'COMPLETED', status: 'PAID' } : {}) },
        })
      })
    }
  } catch (e) {
    logger.error(`[Pagos proveedores] No se pudo actualizar el saldo de facturas del ERP (orden ${orderId}): ${(e as Error).message}`)
  }
}

export async function registrarOrdenDePago(p: PedidoOrdenPago, user: { id: string }): Promise<ResultadoOrdenPago> {
  if (!altasHabilitadas()) {
    throw new OrdenPagoError('El registro de pagos en Colppy está apagado (PAGOS_PROVEEDORES_COLPPY)', 'APAGADO', 503)
  }
  const s = await proveedorErp(p.supplierId)
  const fecha = validarFecha(p.fecha)

  return enExclusiva(async () => {
    // Con otra orden del proveedor sin confirmar (INCIERTA o a medio registrar),
    // no se arma otra: podría pagar dos veces las mismas facturas.
    const pendiente = await prisma.supplierPaymentOrder.findFirst({
      where: {
        supplierId: p.supplierId,
        idempotencyKey: { not: p.idempotencyKey },
        OR: [
          { status: 'INCIERTO' },
          { status: 'REGISTRANDO', colppyRequest: { not: Prisma.DbNull } },
          { status: 'REGISTRANDO', updatedAt: { gte: new Date(Date.now() - REGISTRANDO_VENCE_MS) } },
        ],
      },
      select: { id: true, paymentNumber: true },
    })
    if (pendiente) {
      throw new OrdenPagoError(
        `Hay una orden de este proveedor${pendiente.paymentNumber ? ` (${pendiente.paymentNumber})` : ''} sin confirmar en Colppy: verificala antes de armar otra`,
        'HAY_PENDIENTE',
        409,
        { id: pendiente.id }
      )
    }
    const tomada = await tomarOrden(p, user.id, s.colppyId, fecha)
    if ('estado' in tomada) return tomada
    const id = tomada.id

    let parameters: Record<string, unknown>
    let calc: CalculoOrdenPago
    let medios: Array<MedioPago & { codigo: string }>
    try {
      // Todo fresco de Colppy
      const pc = await colppyDetalleProveedor(s.colppyId)
      const impagas = await colppyImpagasProveedor(s.colppyId)
      calc = await calcular(s, fecha, p.pagos, impagas, regimenDe(pc), { ...p, fresco: true })
      const bancos = await colppyBancosArs()
      const porNombre = new Map(bancos.map((b) => [b.nombre, b]))
      medios = p.medios.map((m) => {
        const b = porNombre.get(m.cuenta)
        if (!b) throw new OrdenPagoError(`La cuenta "${m.cuenta}" no es un banco ni una tarjeta en pesos de Colppy`, 'VALIDACION', 422)
        if (bancos.filter((x) => x.nombre === m.cuenta).length > 1) {
          throw new OrdenPagoError(`En Colppy hay más de una cuenta (bancos o tarjetas) llamada "${m.cuenta}": cargá este pago en Colppy`, 'VALIDACION', 422)
        }
        if (m.cheque) {
          // E-cheq propio: sale de un banco (no de una tarjeta)
          if (b.medio !== 'Transferencia') throw new OrdenPagoError(`El e-cheq tiene que salir de un banco, no de "${m.cuenta}"`, 'VALIDACION', 422)
          return { medio: 'Echeqs' as const, cuenta: b.nombre, importe: r2(m.importe), codigo: b.cuentaContable, cheque: m.cheque }
        }
        return { medio: b.medio, cuenta: b.nombre, importe: r2(m.importe), codigo: b.cuentaContable }
      })
      await chequesNoUsados(medios, id)
      // Número justo antes del alta (además deja la sesión recién usada)
      const n = await colppyProximoNumeroOp()
      const armado = armarAltaPago({
        idProveedor: s.colppyId,
        fecha,
        nroPago1: n.nroPago1,
        nroPago2: n.nroPago2,
        impagas,
        pagos: Object.fromEntries(calc.aplicaciones.map((a) => [a.idFactura, a.importe])),
        retencion: calc.retencion ? { regimen: calc.retencion.regimen, baseAcumulada: calc.retencion.baseAcumulada, importe: calc.retencion.importe } : null,
        medios: medios.map((m) => ({ medio: m.medio, cuenta: m.cuenta, importe: m.importe, ...(m.cheque ? { cheque: m.cheque } : {}) })),
        descripcion: p.descripcion,
      })
      parameters = armado.parameters

      // Se guarda todo ANTES del alta
      await prisma.$transaction([
        prisma.supplierPaymentOrder.update({
          where: { id },
          data: {
            invoicesTotal: armado.totalFacturas,
            retentionRegime: calc.retencion?.regimen ?? null,
            retentionBase: calc.retencion?.baseAcumulada ?? 0,
            retentionAmount: armado.retencion,
            retentionCalc: calc.retencion?.retencion ?? 0,
            totalPaid: armado.totalPagado,
            description: p.descripcion || null,
            paymentNumber: `${n.nroPago1}-${n.nroPago2}`,
            colppyRequest: parameters as Prisma.InputJsonValue,
          },
        }),
        prisma.supplierPaymentApplication.createMany({
          data: calc.aplicaciones.map((a) => ({
            orderId: id,
            colppyInvoiceId: a.idFactura,
            invoiceNumber: a.nroFactura,
            invoiceTotal: a.totalFactura,
            previousBalance: a.saldo,
            amount: a.importe,
            netAmount: a.neto,
          })),
        }),
        prisma.supplierPaymentMedium.createMany({
          data: medios.map((m) => ({
            orderId: id,
            method: m.medio,
            accountName: m.cuenta,
            accountCode: m.codigo || null,
            amount: m.importe,
            chequeNumber: m.cheque ? normalizarNroCheque(m.cheque.numero) : null,
            chequeDate: m.cheque ? new Date(`${m.cheque.fecha}T00:00:00Z`) : null,
          })),
        }),
      ])
    } catch (e) {
      // Nada se mandó a Colppy todavía: queda ERROR y se puede reintentar
      const msg = e instanceof AltaPagoError ? e.errores.join(' · ') : (e as Error).message
      await marcarError(id, msg)
      if (e instanceof OrdenPagoError) throw new OrdenPagoError(e.message, e.codigo, e.status, { ...e.extra, id })
      if (e instanceof AltaPagoError) throw new OrdenPagoError(msg, 'VALIDACION', 422, { errores: e.errores, id })
      throw new OrdenPagoError(`No se pudo preparar el pago: ${msg}`, 'COLPPY_LECTURA', 502, { id })
    }

    const r = await colppyAltaPago(parameters)
    if (r.estado === 'OK') {
      const o = await prisma.supplierPaymentOrder.update({
        where: { id },
        data: { status: 'REGISTRADA', colppyPaymentId: r.idPago, colppyResponse: r.respuesta as Prisma.InputJsonValue, registeredAt: new Date(), lastError: null },
      })
      await aplicarEnFacturasErp(id)
      await actualizarSaldoProveedor(p.supplierId)
      logger.info(`[Pagos proveedores] OP ${o.paymentNumber} registrada en Colppy (idPago ${r.idPago})`)
      return resultado(o, false)
    }
    if (r.estado === 'RECHAZADO') {
      const o = await prisma.supplierPaymentOrder.update({
        where: { id },
        data: { status: 'ERROR', lastError: `Colppy rechazó el pago: ${r.error}`.slice(0, 4000), colppyResponse: r.respuesta as Prisma.InputJsonValue },
      })
      return resultado(o, false)
    }
    const o = await prisma.supplierPaymentOrder.update({
      where: { id },
      data: { status: 'INCIERTO', lastError: `Sin respuesta clara de Colppy (puede haberse creado): ${r.error}`.slice(0, 4000) },
    })
    logger.error(`[Pagos proveedores] Alta INCIERTA de la OP ${o.paymentNumber}: ${r.error}`)
    return resultado(o, false)
  })
}

/** Una orden incierta recién mandada puede tardar en aparecer: antes de esto no se la da por no creada */
export const VERIFICAR_ESPERA_MS = 5 * 60 * 1000

/**
 * Para una orden INCIERTA (o REGISTRANDO trabada): busca su número en los pagos
 * del proveedor en Colppy.
 * - Encontrada con el mismo total y sin otra orden con ese idPago → REGISTRADA.
 * - Encontrada pero con otro total, o un pago del mismo total con otro número →
 *   queda INCIERTA para revisar a mano (nunca se da por no creada).
 * - No encontrada → ERROR (se puede volver a intentar), solo si pasaron
 *   VERIFICAR_ESPERA_MS desde el envío.
 * Todos los cambios de estado son condicionales (otra verificación al mismo
 * tiempo no los pisa) y el saldo de las facturas del ERP se baja una sola vez.
 */
export async function verificarOrdenDePago(id: string, now = new Date()): Promise<ResultadoOrdenPago> {
  return enExclusiva(async () => {
    const o = await prisma.supplierPaymentOrder.findUnique({ where: { id } })
    if (!o) throw new OrdenPagoError('Orden no encontrada', 'NO_ENCONTRADO', 404)
    const vieja = o.updatedAt.getTime() < now.getTime() - REGISTRANDO_VENCE_MS

    /** Cambia el estado solo si nadie lo cambió desde que se leyó */
    const cambiar = async (data: Prisma.SupplierPaymentOrderUpdateManyMutationInput) => {
      const c = await prisma.supplierPaymentOrder.updateMany({ where: { id, status: o.status, updatedAt: o.updatedAt }, data })
      const actual = await prisma.supplierPaymentOrder.findUniqueOrThrow({ where: { id } })
      return { cambio: c.count === 1, actual }
    }

    // Se cortó antes de mandar el alta: no se creó nada
    if (o.status === 'REGISTRANDO' && o.colppyRequest === null) {
      if (!vieja) return resultado(o, true)
      const { actual } = await cambiar({ status: 'ERROR', lastError: 'Se cortó antes de mandar el alta a Colppy: no se creó nada, se puede volver a armar' })
      return resultado(actual, false)
    }
    const trabada = o.status === 'REGISTRANDO' && vieja
    if (o.status !== 'INCIERTO' && !trabada) return resultado(o, true)
    if (!o.paymentNumber) {
      const { actual } = await cambiar({ status: 'ERROR', lastError: 'No llegó a pedirse número a Colppy: no se creó nada' })
      return resultado(actual, false)
    }

    const fecha = o.paymentDate.toISOString().slice(0, 10)
    const total = Number(o.totalPaid)
    const { conNumero, mismoTotalOtroNumero } = await colppyBuscarPagoPorNumero(o.colppySupplierId, fecha, o.paymentNumber, total)

    if (conNumero) {
      const otra = await prisma.supplierPaymentOrder.findFirst({ where: { id: { not: id }, colppyPaymentId: conNumero.idPago }, select: { id: true } })
      if (otra) {
        const { actual } = await cambiar({
          status: 'ERROR',
          lastError: `El pago ${o.paymentNumber} de Colppy (idPago ${conNumero.idPago}) es de otra orden del ERP: esta no se creó, se puede volver a intentar.`,
        })
        return resultado(actual, false)
      }
      if (Math.abs(conNumero.totalPagado - total) >= 0.01) {
        const { actual } = await cambiar({
          lastError: `Colppy tiene el pago ${o.paymentNumber} pero con total ${conNumero.totalPagado} (esta orden: ${total}). Revisalo a mano en Colppy.`,
        })
        return resultado(actual, false)
      }
      const { cambio, actual } = await cambiar({ status: 'REGISTRADA', colppyPaymentId: conNumero.idPago, registeredAt: now, lastError: null })
      if (cambio) await aplicarEnFacturasErp(id)
      return resultado(actual, !cambio)
    }

    if (mismoTotalOtroNumero.length) {
      const { actual } = await cambiar({
        lastError: `Colppy no tiene el pago ${o.paymentNumber}, pero hay ${mismoTotalOtroNumero.length > 1 ? 'pagos' : 'un pago'} de este proveedor por el mismo total con otro número (${mismoTotalOtroNumero.map((p) => p.nroPago).join(', ')}). Revisalo a mano antes de volver a cargarlo.`,
      })
      return resultado(actual, false)
    }
    if (o.updatedAt.getTime() > now.getTime() - VERIFICAR_ESPERA_MS) {
      return { ...resultado(o, true), error: 'Todavía no aparece en Colppy. Volvé a verificar en unos minutos.' }
    }
    const { actual } = await cambiar({
      status: 'ERROR',
      lastError: `Verificado: Colppy no tiene el pago ${o.paymentNumber} de este proveedor. No se creó; se puede volver a intentar.`,
    })
    return resultado(actual, false)
  })
}
