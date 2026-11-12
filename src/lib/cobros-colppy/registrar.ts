/**
 * Recibos de cobro a clientes: se arman en el ERP y se dan de alta en Colppy
 * (Cliente/alta_cobro) igual que con la pantalla "Agregar cobro" de Colppy.
 * Fase 1: comprobantes en pesos y transferencias a cuentas en pesos, sin
 * retenciones. Ver docs/DISENO-COBROS-COLPPY.md.
 *
 * Mismas protecciones que las órdenes de pago (src/lib/pagos-proveedores/registrar.ts):
 * - Idempotencia por clave: el mismo pedido nunca da de alta dos recibos.
 * - Un alta a la vez en el proceso: el número de recibo se pide a Colppy justo antes.
 * - Las impagas y las cuentas se vuelven a leer de Colppy al registrar.
 * - Sin respuesta clara de Colppy → INCIERTO: no se reintenta, se verifica.
 * - El pedido completo se guarda ANTES del alta.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import type { BancoColppy } from '@/lib/pagos-proveedores/colppy-pagos'
import { getExchangeRate } from '@/lib/currency'
import { armarAltaCobro, AltaCobroError, esCobrableFase1, monedaImpaga, saldoImpagaCobro, tcFacturaImpaga, type ImpagaCobroColppy, type MedioCobro } from './alta-cobro'
import { colppyAltaCobro, colppyCuentasCobroArs, colppyImpagasCliente, colppyProximoNumeroRecibo, colppyUsuarioSesion } from './colppy-cobros'

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** Las altas se habilitan con COBROS_COLPPY=1 (sin eso, la pantalla solo previsualiza) */
export function altasCobroHabilitadas(): boolean {
  return process.env.COBROS_COLPPY === '1'
}

export class CobroError extends Error {
  constructor(message: string, public codigo: string, public status: number, public extra: Record<string, unknown> = {}) {
    super(message)
    this.name = 'CobroError'
  }
}

/** Un REGISTRANDO más viejo que esto sin pedido guardado se puede volver a tomar */
export const REGISTRANDO_VENCE_MS = 15 * 60 * 1000
/** Un cobro incierto recién mandado puede tardar en verse: antes de esto no se lo da por no creado */
export const VERIFICAR_ESPERA_MS = 5 * 60 * 1000

// ── Fechas ──────────────────────────────────────────────────────────────────

/** Hoy en Argentina (UTC-3), YYYY-MM-DD */
export function hoyAr(now = new Date()): string {
  return new Date(now.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10)
}

export function validarFechaCobro(fecha: unknown, now = new Date()): string {
  const s = String(fecha ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new CobroError('Fecha inválida (YYYY-MM-DD)', 'PEDIDO_INVALIDO', 400)
  const d = new Date(`${s}T12:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new CobroError('Fecha inválida', 'PEDIDO_INVALIDO', 400)
  const hoy = new Date(`${hoyAr(now)}T12:00:00Z`)
  const dias = Math.round((d.getTime() - hoy.getTime()) / 86400000)
  if (dias > 0) throw new CobroError('La fecha del cobro no puede ser futura', 'PEDIDO_INVALIDO', 400)
  if (dias < -45) throw new CobroError('La fecha del cobro es de hace más de 45 días: cargalo en Colppy', 'PEDIDO_INVALIDO', 400)
  return s
}

// ── Cliente ─────────────────────────────────────────────────────────────────

async function clienteErp(customerId: string) {
  const c = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true, businessName: true, cuit: true, colppyId: true } })
  if (!c) throw new CobroError('Cliente no encontrado', 'NO_ENCONTRADO', 404)
  if (!c.colppyId || !/^\d+$/.test(c.colppyId)) {
    throw new CobroError('El cliente no está vinculado a Colppy (sincronizá clientes desde Colppy)', 'SIN_COLPPY', 422)
  }
  return { ...c, colppyId: c.colppyId }
}

// ── Preparar (datos para la pantalla) ───────────────────────────────────────

export interface ImpagaCobroPantalla {
  idFactura: string
  nroFactura: string
  tipoComprobante: string
  vencimiento: string
  totalFactura: number
  /** En pesos; en facturas en dólares, al T/C de la factura (así lo lleva Colppy) */
  saldo: number
  moneda: 'ARS' | 'USD'
  /** Solo en dólares: T/C de la factura y saldo en dólares */
  tcFactura: number | null
  saldoUsd: number | null
  cobrable: boolean
  motivoNoCobrable: string | null
  descripcion: string
}

export interface PreparacionCobro {
  cliente: { id: string; nombre: string; cuit: string; colppyId: string }
  impagas: ImpagaCobroPantalla[]
  cuentas: BancoColppy[]
  /** Dólar del día cargado en el ERP (BNA billete venta), si hay */
  tcDia: number | null
  proximoNumero: string
  altasHabilitadas: boolean
}

function paraPantalla(f: ImpagaCobroColppy): ImpagaCobroPantalla {
  const c = esCobrableFase1(f)
  const enDolares = monedaImpaga(f) === 'USD' && tcFacturaImpaga(f) > 0
  return {
    idFactura: String(f.idFactura),
    nroFactura: String(f.nroFactura),
    tipoComprobante: String(f.tipoComprobante),
    vencimiento: String(f.fechaPago ?? ''),
    totalFactura: r2(Number(f.totalFactura)),
    saldo: saldoImpagaCobro(f),
    moneda: enDolares ? 'USD' : 'ARS',
    tcFactura: enDolares ? tcFacturaImpaga(f) : null,
    saldoUsd: enDolares ? r2(saldoImpagaCobro(f) / tcFacturaImpaga(f)) : null,
    cobrable: c.ok,
    motivoNoCobrable: c.ok ? null : c.motivo,
    descripcion: String(f.descripcion ?? ''),
  }
}

export async function prepararCobro(customerId: string): Promise<PreparacionCobro> {
  const c = await clienteErp(customerId)
  const impagas = await colppyImpagasCliente(c.colppyId)
  const cuentas = await colppyCuentasCobroArs()
  const n = await colppyProximoNumeroRecibo()
  const tcDia = await getExchangeRate('USD', 'ARS').catch(() => null)
  return {
    cliente: { id: c.id, nombre: c.businessName || c.name, cuit: c.cuit, colppyId: c.colppyId },
    impagas: impagas.map(paraPantalla),
    cuentas,
    tcDia: tcDia && tcDia > 0 ? tcDia : null,
    proximoNumero: `${n.nroRecibo1}-${n.nroRecibo2}`,
    altasHabilitadas: altasCobroHabilitadas(),
  }
}

// ── Validación del pedido ───────────────────────────────────────────────────

export interface PedidoCobro {
  idempotencyKey: string
  customerId: string
  fecha: string
  /** idFactura (Colppy) → importe a cobrar */
  cobros: Record<string, number>
  /** idFactura (Colppy) → T/C del cobro, para las facturas en dólares */
  tcCobro: Record<string, number>
  medios: Array<{ medio: 'Transferencia' | 'Echeqs'; cuenta: string; importe: number; banco?: string; numero?: string; fechaPago?: string }>
  descripcion: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function validarPedidoCobro(body: unknown): PedidoCobro {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- body JSON sin tipar, se valida campo por campo
  const b = (body ?? {}) as Record<string, any>
  const errores: string[] = []
  if (!UUID_RE.test(String(b.idempotencyKey ?? ''))) errores.push('Falta la clave del pedido')
  if (!b.customerId || typeof b.customerId !== 'string') errores.push('Falta el cliente')
  const cobros: Record<string, number> = {}
  if (!b.cobros || typeof b.cobros !== 'object' || Array.isArray(b.cobros)) errores.push('Faltan los comprobantes')
  else {
    for (const [k, v] of Object.entries(b.cobros)) {
      const n = Number(v)
      if (!/^\d+$/.test(k) || !Number.isFinite(n) || n < 0) errores.push(`Importe inválido para el comprobante ${k}`)
      else if (n > 0) cobros[k] = r2(n)
    }
    if (!Object.keys(cobros).length) errores.push('Elegí al menos un comprobante')
  }
  const tcCobro: Record<string, number> = {}
  if (b.tcCobro !== undefined && b.tcCobro !== null) {
    if (typeof b.tcCobro !== 'object' || Array.isArray(b.tcCobro)) errores.push('Tipos de cambio inválidos')
    else
      for (const [k, v] of Object.entries(b.tcCobro)) {
        const n = Number(v)
        if (!/^\d+$/.test(k) || !Number.isFinite(n) || n <= 0) errores.push(`Tipo de cambio inválido para el comprobante ${k}`)
        else if (k in cobros) tcCobro[k] = Math.round(n * 10000) / 10000
      }
  }
  const medios: PedidoCobro['medios'] = []
  if (!Array.isArray(b.medios) || !b.medios.length) errores.push('Falta el medio de cobro')
  else if (b.medios.length > 10) errores.push('Demasiados medios de cobro')
  else
    for (const m of b.medios) {
      const importe = Number(m?.importe)
      const cuenta = String(m?.cuenta ?? '').trim()
      if (m?.medio === 'Echeqs') {
        const banco = String(m?.banco ?? '').trim().slice(0, 60)
        const numero = String(m?.numero ?? '').trim()
        const fechaPago = String(m?.fechaPago ?? '')
        if (!banco || !/^\d{1,15}$/.test(numero) || !/^\d{4}-\d{2}-\d{2}$/.test(fechaPago) || !Number.isFinite(importe) || importe <= 0) errores.push('E-cheq incompleto (banco, número, fecha de pago e importe)')
        else medios.push({ medio: 'Echeqs', cuenta: '', importe: r2(importe), banco, numero, fechaPago })
      } else if (!cuenta || !Number.isFinite(importe) || importe <= 0) errores.push('Medio de cobro incompleto')
      else medios.push({ medio: 'Transferencia', cuenta, importe: r2(importe) })
    }
  if (errores.length) throw new CobroError(errores.join(' · '), 'PEDIDO_INVALIDO', 400, { errores })
  return {
    idempotencyKey: String(b.idempotencyKey),
    customerId: b.customerId,
    fecha: String(b.fecha ?? ''),
    cobros,
    tcCobro,
    medios,
    descripcion: String(b.descripcion ?? '').slice(0, 200),
  }
}

// ── Registro ────────────────────────────────────────────────────────────────

/** Un alta a la vez: el número de recibo se pide justo antes y no se puede compartir */
let cola: Promise<unknown> = Promise.resolve()
function enExclusiva<T>(fn: () => Promise<T>): Promise<T> {
  const r = cola.then(fn, fn)
  cola = r.catch(() => undefined)
  return r
}

export interface ResultadoCobro {
  id: string
  estado: 'REGISTRADA' | 'ERROR' | 'INCIERTO' | 'REGISTRANDO'
  numero: string | null
  colppyCobroId: string | null
  totalCobrado: number
  error: string | null
  repetida: boolean
}

type FilaCobro = { id: string; status: string; receiptNumber: string | null; colppyCobroId: string | null; totalCollected: Prisma.Decimal | number; lastError: string | null }

function resultado(o: FilaCobro, repetida: boolean): ResultadoCobro {
  return {
    id: o.id,
    estado: o.status as ResultadoCobro['estado'],
    numero: o.receiptNumber,
    colppyCobroId: o.colppyCobroId,
    totalCobrado: Number(o.totalCollected),
    error: o.lastError,
    repetida,
  }
}

/** Toma el cobro de esta clave para registrarlo, o devuelve el que ya existe */
async function tomarCobro(p: PedidoCobro, userId: string, colppyCustomerId: string, fecha: string): Promise<{ id: string } | ResultadoCobro> {
  const existente = await prisma.customerCollection.findUnique({ where: { idempotencyKey: p.idempotencyKey } })
  if (existente) {
    if (existente.customerId !== p.customerId) throw new CobroError('La clave del pedido ya se usó para otro cliente', 'CLAVE_USADA', 409)
    if (existente.status === 'REGISTRADA' || existente.status === 'INCIERTO') return resultado(existente, true)
    // ERROR, o REGISTRANDO trabado ANTES de mandar el alta (sin pedido guardado): se puede volver a tomar
    const tomada = await prisma.customerCollection.updateMany({
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
        receiptNumber: null,
        collectionDate: new Date(`${fecha}T00:00:00Z`),
        colppyCustomerId,
        description: p.descripcion || null,
      },
    })
    if (tomada.count !== 1) {
      const actual = await prisma.customerCollection.findUniqueOrThrow({ where: { id: existente.id } })
      if (actual.status === 'REGISTRANDO') {
        throw new CobroError('Este cobro se está registrando en Colppy o quedó a medio registrar: verificalo', 'EN_CURSO', 409, { id: actual.id })
      }
      return resultado(actual, true)
    }
    await prisma.$transaction([
      prisma.customerCollectionApplication.deleteMany({ where: { collectionId: existente.id } }),
      prisma.customerCollectionMedium.deleteMany({ where: { collectionId: existente.id } }),
    ])
    return { id: existente.id }
  }
  try {
    return await prisma.customerCollection.create({
      data: {
        idempotencyKey: p.idempotencyKey,
        customerId: p.customerId,
        colppyCustomerId,
        collectionDate: new Date(`${fecha}T00:00:00Z`),
        status: 'REGISTRANDO',
        appliedTotal: 0,
        totalCollected: 0,
        description: p.descripcion || null,
        createdById: userId,
      },
      select: { id: true },
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new CobroError('Este pedido ya se está registrando', 'EN_CURSO', 409)
    }
    throw e
  }
}

export async function registrarCobro(p: PedidoCobro, user: { id: string }): Promise<ResultadoCobro> {
  if (!altasCobroHabilitadas()) {
    throw new CobroError('El registro de cobros en Colppy está apagado (COBROS_COLPPY)', 'APAGADO', 503)
  }
  const c = await clienteErp(p.customerId)
  const fecha = validarFechaCobro(p.fecha)

  return enExclusiva(async () => {
    // Con otro cobro del cliente sin confirmar no se arma otro: podría cobrar dos veces lo mismo
    const pendiente = await prisma.customerCollection.findFirst({
      where: {
        customerId: p.customerId,
        idempotencyKey: { not: p.idempotencyKey },
        OR: [
          { status: 'INCIERTO' },
          { status: 'REGISTRANDO', colppyRequest: { not: Prisma.DbNull } },
          { status: 'REGISTRANDO', updatedAt: { gte: new Date(Date.now() - REGISTRANDO_VENCE_MS) } },
        ],
      },
      select: { id: true, receiptNumber: true },
    })
    if (pendiente) {
      throw new CobroError(
        `Hay un cobro de este cliente${pendiente.receiptNumber ? ` (${pendiente.receiptNumber})` : ''} sin confirmar en Colppy: verificalo antes de armar otro`,
        'HAY_PENDIENTE',
        409,
        { id: pendiente.id }
      )
    }
    const tomada = await tomarCobro(p, user.id, c.colppyId, fecha)
    if ('estado' in tomada) return tomada
    const id = tomada.id

    let parameters: Record<string, unknown>
    try {
      // Todo fresco de Colppy
      const impagas = await colppyImpagasCliente(c.colppyId)
      const cuentas = await colppyCuentasCobroArs()
      const medios: Array<MedioCobro & { codigo: string }> = p.medios.map((m) => {
        if (m.medio === 'Echeqs') {
          // Entra a cartera (Valores a Depositar, 113200); el detalle queda en el nombre para el listado y el recibo
          const [a, me, d] = String(m.fechaPago).split('-')
          return { medio: 'Echeqs' as const, cuenta: `E-cheq ${m.banco} N° ${m.numero} (pago ${d}/${me}/${a})`, importe: r2(m.importe), banco: m.banco, numero: m.numero, fechaPago: m.fechaPago, codigo: '113200' }
        }
        const mismas = cuentas.filter((x) => x.nombre === m.cuenta)
        if (!mismas.length) throw new CobroError(`La cuenta "${m.cuenta}" no es una cuenta en pesos de Colppy`, 'VALIDACION', 422)
        if (mismas.length > 1) throw new CobroError(`En Colppy hay más de una cuenta llamada "${m.cuenta}": cargá este cobro en Colppy`, 'VALIDACION', 422)
        return { medio: 'Transferencia' as const, cuenta: mismas[0].nombre, importe: r2(m.importe), codigo: mismas[0].cuentaContable }
      })
      const idUsuario = await colppyUsuarioSesion()
      // Número justo antes del alta (además deja la sesión recién usada)
      const n = await colppyProximoNumeroRecibo()
      const armado = armarAltaCobro({
        idCliente: c.colppyId,
        idUsuario,
        fecha,
        nroRecibo1: n.nroRecibo1,
        nroRecibo2: n.nroRecibo2,
        impagas,
        cobros: p.cobros,
        tcCobro: p.tcCobro,
        medios: medios.map((m) => ({ medio: m.medio, cuenta: m.cuenta, importe: m.importe, banco: m.banco, numero: m.numero, fechaPago: m.fechaPago })),
        descripcion: p.descripcion,
      })
      parameters = armado.parameters
      const porId = new Map(impagas.map((f) => [String(f.idFactura), f]))

      // Se guarda todo ANTES del alta
      await prisma.$transaction([
        prisma.customerCollection.update({
          where: { id },
          data: {
            appliedTotal: armado.totalAplicado,
            totalCollected: armado.totalCobrado,
            description: p.descripcion || null,
            receiptNumber: `${n.nroRecibo1}-${n.nroRecibo2}`,
            colppyRequest: parameters as Prisma.InputJsonValue,
          },
        }),
        prisma.customerCollectionApplication.createMany({
          data: Object.entries(p.cobros).map(([idFactura, importe]) => {
            const f = porId.get(idFactura)!
            return {
              collectionId: id,
              colppyInvoiceId: idFactura,
              invoiceNumber: String(f.nroFactura),
              invoiceTotal: r2(Number(f.totalFactura)),
              previousBalance: saldoImpagaCobro(f),
              amount: r2(importe),
            }
          }),
        }),
        prisma.customerCollectionMedium.createMany({
          data: medios.map((m) => ({ collectionId: id, method: m.medio, accountName: m.cuenta, accountCode: m.codigo || null, amount: m.importe })),
        }),
      ])
    } catch (e) {
      // Nada se mandó a Colppy todavía: queda ERROR y se puede reintentar
      const msg = e instanceof AltaCobroError ? e.errores.join(' · ') : (e as Error).message
      await prisma.customerCollection.update({ where: { id }, data: { status: 'ERROR', lastError: msg.slice(0, 4000) } })
      if (e instanceof CobroError) throw new CobroError(e.message, e.codigo, e.status, { ...e.extra, id })
      if (e instanceof AltaCobroError) throw new CobroError(msg, 'VALIDACION', 422, { errores: e.errores, id })
      throw new CobroError(`No se pudo preparar el cobro: ${msg}`, 'COLPPY_LECTURA', 502, { id })
    }

    const r = await colppyAltaCobro(parameters)
    if (r.estado === 'OK') {
      const o = await prisma.customerCollection.update({
        where: { id },
        data: { status: 'REGISTRADA', colppyCobroId: r.idCobro, colppyResponse: r.respuesta as Prisma.InputJsonValue, registeredAt: new Date(), lastError: null },
      })
      logger.info(`[Cobros] Recibo ${o.receiptNumber} registrado en Colppy (idCobro ${r.idCobro})`)
      // El saldo del cliente en el ERP baja ya (el sync diario con Colppy lo vuelve a pisar)
      await prisma.customer
        .update({ where: { id: p.customerId }, data: { balance: { decrement: o.appliedTotal } } })
        .catch((e) => logger.warn(`[Cobros] No se pudo bajar el saldo del cliente ${p.customerId}: ${(e as Error).message}`))
      return resultado(o, false)
    }
    if (r.estado === 'RECHAZADO') {
      const o = await prisma.customerCollection.update({
        where: { id },
        data: { status: 'ERROR', lastError: `Colppy rechazó el cobro: ${r.error}`.slice(0, 4000), colppyResponse: r.respuesta as Prisma.InputJsonValue },
      })
      return resultado(o, false)
    }
    const o = await prisma.customerCollection.update({
      where: { id },
      data: { status: 'INCIERTO', lastError: `Sin respuesta clara de Colppy (puede haberse creado): ${r.error}`.slice(0, 4000) },
    })
    logger.error(`[Cobros] Alta INCIERTA del recibo ${o.receiptNumber}: ${r.error}`)
    return resultado(o, false)
  })
}

/**
 * Qué pasó con los comprobantes de un cobro incierto, mirando sus saldos
 * actuales en Colppy (un comprobante que ya no figura impago tiene saldo 0):
 * - APLICADO: todos bajaron exactamente lo que cobraba el recibo.
 * - SIN_APLICAR: todos siguen con el saldo de antes.
 * - DUDOSO: cualquier otra cosa (se revisa a mano).
 */
export function estadoAplicaciones(
  apps: Array<{ colppyInvoiceId: string; previousBalance: number; amount: number }>,
  saldosActuales: Map<string, number>
): 'APLICADO' | 'SIN_APLICAR' | 'DUDOSO' {
  if (!apps.length) return 'DUDOSO'
  const cerca = (a: number, b: number) => Math.abs(a - b) < 0.01
  const actual = (a: { colppyInvoiceId: string }) => saldosActuales.get(a.colppyInvoiceId) ?? 0
  if (apps.every((a) => cerca(actual(a), r2(a.previousBalance - a.amount)))) return 'APLICADO'
  if (apps.every((a) => cerca(actual(a), a.previousBalance))) return 'SIN_APLICAR'
  return 'DUDOSO'
}

/**
 * Para un cobro INCIERTO (o REGISTRANDO trabado). Colppy no tiene una lectura
 * de recibos por número en la API, así que se mira el efecto: los saldos de los
 * comprobantes del cliente.
 * - Bajaron lo que cobraba el recibo → REGISTRADA (sin idCobro).
 * - Siguen igual y ya pasó VERIFICAR_ESPERA_MS → ERROR (se puede volver a armar).
 * - Otra cosa → queda INCIERTO para revisar a mano en Colppy.
 */
export async function verificarCobro(id: string, now = new Date()): Promise<ResultadoCobro> {
  return enExclusiva(async () => {
    const o = await prisma.customerCollection.findUnique({ where: { id }, include: { applications: true } })
    if (!o) throw new CobroError('Cobro no encontrado', 'NO_ENCONTRADO', 404)
    const vieja = o.updatedAt.getTime() < now.getTime() - REGISTRANDO_VENCE_MS

    /** Cambia el estado solo si nadie lo cambió desde que se leyó */
    const cambiar = async (data: Prisma.CustomerCollectionUpdateManyMutationInput) => {
      await prisma.customerCollection.updateMany({ where: { id, status: o.status, updatedAt: o.updatedAt }, data })
      return prisma.customerCollection.findUniqueOrThrow({ where: { id } })
    }

    if (o.status === 'REGISTRANDO' && o.colppyRequest === null) {
      if (!vieja) return resultado(o, true)
      return resultado(await cambiar({ status: 'ERROR', lastError: 'Se cortó antes de mandar el alta a Colppy: no se creó nada, se puede volver a armar' }), false)
    }
    if (o.status !== 'INCIERTO' && !(o.status === 'REGISTRANDO' && vieja)) return resultado(o, true)

    const impagas = await colppyImpagasCliente(o.colppyCustomerId)
    const saldos = new Map(impagas.map((f) => [String(f.idFactura), saldoImpagaCobro(f)]))
    const estado = estadoAplicaciones(
      o.applications.map((a) => ({ colppyInvoiceId: a.colppyInvoiceId, previousBalance: Number(a.previousBalance), amount: Number(a.amount) })),
      saldos
    )
    if (estado === 'APLICADO') {
      return resultado(await cambiar({ status: 'REGISTRADA', registeredAt: now, lastError: null }), false)
    }
    if (estado === 'SIN_APLICAR') {
      if (o.updatedAt.getTime() > now.getTime() - VERIFICAR_ESPERA_MS) {
        return { ...resultado(o, true), error: 'Todavía no aparece en Colppy. Volvé a verificar en unos minutos.' }
      }
      return resultado(
        await cambiar({ status: 'ERROR', lastError: `Verificado: los comprobantes siguen con el mismo saldo en Colppy. El recibo ${o.receiptNumber ?? ''} no se creó; se puede volver a intentar.` }),
        false
      )
    }
    return resultado(
      await cambiar({ lastError: `Los saldos de los comprobantes en Colppy no coinciden ni con el cobro hecho ni con el cobro sin hacer. Revisá el recibo ${o.receiptNumber ?? ''} a mano en Colppy.` }),
      false
    )
  })
}
