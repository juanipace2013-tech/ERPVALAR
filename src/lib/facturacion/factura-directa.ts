/**
 * Factura directa ("Nueva factura"): Factura A, B o FCE A (ARCA WSFE, PV 7)
 * sin cotización, para no depender de Colppy para facturar (pedido de
 * Santiago, 5/10/2026). Pantalla: /facturas/nueva. Rutas:
 * /api/facturas/directa (+ /preview, /venta-ml/[id], /pendientes).
 *
 * ARCA PRIMERO, reusando lo que ya funciona en prod:
 *  1. Totales con totalesFacturaA/B (factura-directa-form.ts): los mismos
 *     cálculos y argumentos que sendQuoteToColppy.
 *  2. CAE con crearHookEmisionArca(...).hook(datos), llamado directamente: la
 *     misma función que corre dentro de sendQuoteToColppy (letra, FCE,
 *     documento de la B, estado del intento y QR), sin cambios.
 *  3. Invoice del ERP (+ vínculo con la venta de ML si hay), PDF a SharePoint
 *     y a ML.
 *  4. Colppy al final y best-effort (FACTURACION_REGISTRAR_COLPPY, default
 *     true): sendQuoteToColppy con una emisión externa "ya realizada"
 *     (emisionYaRealizada) que no llama a ARCA y devuelve el CAE guardado si
 *     los importes coinciden. Si falla, la factura queda PENDIENTE/ERROR y se
 *     reintenta con "Reintentar registro en Colppy".
 *
 * Idempotencia (diario FacturaDirecta, mismo patrón que FacturaExportacion):
 * la clave la genera el navegador; la fila se crea EMITIENDO dentro de una
 * transacción con advisory lock por cliente ANTES de pedir el CAE y pasa a
 * AUTORIZADA con el CAE fuera de la transacción de la Invoice (el CAE nunca se
 * pierde). Incierta o huérfana: scripts/factura-directa-reconciliar.ts.
 */
import { Prisma, type FacturaDirecta } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { getArcaConfig, isArcaConfigured } from '@/lib/arca/config'
import { consultarPersona, PadronError } from '@/lib/arca/padron'
import { formatNroComprobante } from '@/lib/arca/wsfe'
import { describeCbteTipo, mensajeEmisionIncierta, receptorDesdeCondicion, type ReceptorInput } from '@/lib/arca/emitir'
import {
  ColppySessionExpiredError,
  EmisionExternaError,
  colppyCreateInvoice,
  getCachedColppySession,
  invalidateColppySessionCache,
  sendQuoteToColppy,
  type ColppyInvoicePayload,
  type EmisionExternaDatos,
  type EmisionExternaResultado,
} from '@/lib/colppy'
import { syncStockForSkusFireAndForget } from '@/lib/colppy-inventory'
import { esCuitValido, normalizeCuit } from '@/lib/cuit-utils'
import { archivarFacturaEnSharePointBg } from '@/lib/sharepoint/facturas-emitidas'
import { subirFacturaAMl } from '@/lib/mercadolibre/facturacion'
import { MlApiError } from '@/lib/mercadolibre/client'
import {
  VentaMlError,
  compararTitularVentaMl,
  inspeccionarVentaMl,
  liberarCandadoVentaMl,
  mensajeVentaMlNoPagada,
  tomarCandadoVentaMl,
  totalDistintoDeMl,
  verificarVentaMlFacturable,
  vincularFacturaAVentaMl,
  type InspeccionVentaMl,
  type TitularVentaMl,
} from '@/lib/mercadolibre/venta-ml-vinculo'
import {
  NOTA_PENDIENTE_COLPPY,
  crearHookEmisionArca,
  emisionDescartada,
  getEmisorFacturacion,
  notaRegistroColppy,
  type HookEmisionArca,
  type IntentoEmisionArca,
} from './emision-arca'
import { condicionPagoDesdeDias, fechaVtoDesde } from './condicion-pago'
import { cuitParaCandadoMl } from './factura-directa-reconciliacion'
import { letraFacturaColppy } from './letra-factura'
import {
  MAX_OBSERVACIONES_FACTURA_DIRECTA,
  bloqueoClienteFacturaDirecta,
  calcularFacturaDirecta,
  confirmacionesFaltantes,
  crearConfirmacion,
  datosEmisionFacturaDirecta,
  fechaComprobanteDirecta,
  fechaDesdeYmd,
  fechaYmdAr,
  fechaYmdLocal,
  tipoCambioAlejado,
  type CalculoFacturaDirecta,
  type CodigoConfirmacion,
  type ConfirmacionRequerida,
  type DocumentoReceptorB,
  type LetraFacturaDirecta,
  type MonedaFacturaDirecta,
  type PedidoFacturaDirecta,
  type ProblemaFacturaDirecta,
  type TotalesFacturaDirecta,
} from './factura-directa-form'

// ---------------------------------------------------------------------------
// Constantes, errores y tipos
// ---------------------------------------------------------------------------

export const ESTADO_DIRECTA = {
  EMITIENDO: 'EMITIENDO',
  AUTORIZADA: 'AUTORIZADA',
  RECHAZADA: 'RECHAZADA',
  NO_SOLICITADA: 'NO_SOLICITADA',
  INCIERTA: 'INCIERTA',
  DESCARTADA: 'DESCARTADA',
} as const

/** Estados con los que una clave se puede volver a usar: ARCA seguro no emitió */
const ESTADOS_REUSABLES: string[] = [ESTADO_DIRECTA.RECHAZADA, ESTADO_DIRECTA.NO_SOLICITADA, ESTADO_DIRECTA.DESCARTADA]

/** Una fila EMITIENDO más vieja que esto quedó trabada (el proceso se cortó): se trata como incierta */
export const EMITIENDO_TRABADA_MS = 10 * 60 * 1000
/** Un REGISTRANDO (alta en Colppy) más viejo que esto se puede volver a tomar */
export const REGISTRANDO_VENCE_MS = 15 * 60 * 1000

const DIA_MS = 24 * 3600 * 1000
const VENTANA_DUPLICADO_CLIENTE_MS = 7 * DIA_MS
const VENTANA_DIRECTA_RECIENTE_MS = 10 * 60 * 1000
const VENTANA_DUPLICADO_ML_MS = 5 * DIA_MS

/** Error de la factura directa con status HTTP; el cuerpo de error es { error, codigo, ...extra } */
export class FacturaDirectaError extends Error {
  constructor(
    readonly codigo: string,
    readonly status: number,
    mensaje: string,
    readonly extra: Record<string, unknown> = {}
  ) {
    super(mensaje)
    this.name = 'FacturaDirectaError'
  }
}

/** Error de validación con el status HTTP que corresponde al emitir */
export interface ErrorFacturaDirecta extends ProblemaFacturaDirecta {
  status: number
}

/** Línea guardada en el diario (con el SKU del producto del ERP) */
export interface LineaFacturaDirectaGuardada {
  productId: string | null
  sku: string | null
  descripcion: string
  cantidad: number
  precioUnitario: number
  comentario: string | null
}

/** FacturaDirecta.pedido: todo lo necesario para registrar la Invoice y el alta en Colppy sin volver a calcular */
export interface PedidoFacturaDirectaGuardado {
  version: 1
  customerId: string
  /** Cliente al momento de emitir (la letra y el receptor salieron de acá) */
  cliente: { name: string; cuit: string; taxCondition: string; fceObligado: boolean }
  moneda: MonedaFacturaDirecta
  tipoCambio: number | null
  condicionPago: string
  /** Efectivo: en la B siempre true */
  preciosConIva: boolean
  documentoReceptorB: DocumentoReceptorB | null
  observaciones: string | null
  confirmaciones: string[]
  letra: LetraFacturaDirecta
  esFce: boolean
  receptor: { docTipo: number; docNro: string; condicionIvaId: number }
  totales: TotalesFacturaDirecta
  /** YYYY-MM-DD (= CbteFch) */
  fechaFactura: string
  /** YYYY-MM-DD */
  fechaVto: string
  ml: { packId: string; orderIds: string[]; buyerNickname: string | null; totalMl: number } | null
  lineas: LineaFacturaDirectaGuardada[]
}

export interface ResumenPadronDirecta {
  estado: 'encontrado' | 'no-existe' | 'error'
  razonSocial: string | null
  condicionIva: string | null
  activo: boolean | null
  observaciones: string[]
  mensaje: string | null
}

export type ResumenMlDirecta = InspeccionVentaMl & { titular: TitularVentaMl }

export interface PreviewFacturaDirecta {
  ok: boolean
  letra: LetraFacturaDirecta | null
  cbteTipoPrevisto: number | null
  esFce: boolean
  receptor: { docTipo: number; docNro: string; condicionIvaId: number } | null
  totales: TotalesFacturaDirecta | null
  /** Efectivo (en la B siempre true) */
  preciosConIva: boolean
  condicionPago: string
  /** YYYY-MM-DD */
  fechaFactura: string
  fechaVto: string
  errores: ProblemaFacturaDirecta[]
  avisos: ProblemaFacturaDirecta[]
  confirmacionesRequeridas: ConfirmacionRequerida[]
  padron: ResumenPadronDirecta | null
  ml: ResumenMlDirecta | null
  cliente: {
    id: string
    name: string
    cuit: string
    taxCondition: string
    fceObligado: boolean
    /** Condición de pago por defecto según Customer.paymentTerms */
    condicionPagoSugerida: string
  } | null
  /** Último dólar cargado (BNA billete) para comparar el TC */
  tipoCambioReferencia: { rate: number; fecha: string } | null
}

export interface ResultadoFacturaDirecta {
  invoiceId: string
  invoiceNumber: string
  cae: string
  /** ISO */
  caeVencimiento: string
  total: number
  currency: string
  pdfUrl: string
  /** estado: 'OK' | 'BORRADOR_FCE' | 'ERROR' | 'NO_APLICA' (y en una repetida también 'PENDIENTE' | 'REGISTRANDO') */
  colppy: { estado: string; error?: string }
  ml: { packId: string; uploadOk: boolean; error?: string } | null
  /** true = la clave ya había emitido: no se volvió a emitir (HTTP 200) */
  repetida: boolean
}

export interface ResultadoRegistroColppy {
  ok: boolean
  estado: 'OK' | 'BORRADOR_FCE' | 'ERROR' | 'NO_APLICA' | 'EN_CURSO'
  colppyId?: string
  error?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** FACTURACION_REGISTRAR_COLPPY (default true): registrar la factura directa en Colppy después de emitirla */
export function colppyHabilitado(): boolean {
  return (process.env.FACTURACION_REGISTRAR_COLPPY ?? 'true').trim().toLowerCase() !== 'false'
}

/**
 * La fecha local del proceso (la que usa toCbteFch para CbteFch) no es la de
 * Buenos Aires: se emitiría con otro día. Seguro por si el VPS queda en UTC.
 */
export function fueraDeHorario(ahora: Date): boolean {
  return fechaYmdLocal(ahora) !== fechaYmdAr(ahora)
}

const soloDigitos = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '')
const round2 = (n: number) => Math.round(n * 100) / 100
const fmt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const horaAr = (d: Date) => d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' })

/** JSON plano para columnas Json de Prisma */
function aJson(v: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(v ?? null)) as Prisma.InputJsonValue
}


export function pedidoGuardado(fila: Pick<FacturaDirecta, 'pedido'>): PedidoFacturaDirectaGuardado {
  return fila.pedido as unknown as PedidoFacturaDirectaGuardado
}

/** Número interno de la Invoice: A-0007-00000012, B-..., FCEA-... */
export function numeroInvoiceDirecta(letra: string, cbteTipo: number, puntoVenta: number, numero: number): string {
  return `${cbteTipo >= 201 ? 'FCE' : ''}${letra}-${formatNroComprobante(puntoVenta, numero)}`
}

const ETIQUETA_CONDICION: Record<string, string> = {
  RESPONSABLE_INSCRIPTO: 'Responsable Inscripto',
  MONOTRIBUTO: 'Monotributista',
  EXENTO: 'Exento',
  CONSUMIDOR_FINAL: 'Consumidor Final',
}
const etiquetaCondicion = (c: string | null | undefined) => ETIQUETA_CONDICION[c ?? ''] ?? String(c ?? 'sin condición')

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

/** 503: emisor que no es ARCA, ARCA sin configurar o fecha del servidor distinta de la de Argentina */
export function erroresConfiguracionFacturaDirecta(ahora: Date): ErrorFacturaDirecta[] {
  if ((process.env.FACTURACION_EMISOR || '').toLowerCase() === 'arca' && !isArcaConfigured()) {
    return [{ codigo: 'ARCA_NO_CONFIGURADO', status: 503, mensaje: 'FACTURACION_EMISOR=arca pero falta la configuración de ARCA (ARCA_*) en el servidor' }]
  }
  if (getEmisorFacturacion() !== 'arca') {
    return [{ codigo: 'EMISOR_NO_ARCA', status: 503, mensaje: 'La emisión propia (ARCA PV 7) no está activa en el servidor' }]
  }
  if (fueraDeHorario(ahora)) {
    return [
      {
        codigo: 'FUERA_DE_HORARIO',
        status: 503,
        mensaje: 'La fecha del servidor no coincide con la de Argentina: no se puede emitir ahora (revisar la zona horaria del servidor)',
      },
    ]
  }
  return []
}

// ---------------------------------------------------------------------------
// Evaluación (validaciones de la sección 6 del diseño, en orden)
// ---------------------------------------------------------------------------

const SELECT_CLIENTE = {
  id: true,
  name: true,
  businessName: true,
  cuit: true,
  taxCondition: true,
  status: true,
  country: true,
  fceObligado: true,
  paymentTerms: true,
} satisfies Prisma.CustomerSelect

type ClienteDirecta = Prisma.CustomerGetPayload<{ select: typeof SELECT_CLIENTE }>

interface EvaluacionFacturaDirecta {
  ahora: Date
  cliente: ClienteDirecta
  calculo: CalculoFacturaDirecta | null
  receptor: ReceptorInput | null
  documentoReceptorB: DocumentoReceptorB | null
  lineas: LineaFacturaDirectaGuardada[]
  errores: ErrorFacturaDirecta[]
  avisos: ProblemaFacturaDirecta[]
  confirmaciones: ConfirmacionRequerida[]
  padron: ResumenPadronDirecta | null
  ml: ResumenMlDirecta | null
  tipoCambioReferencia: { rate: number; fecha: string } | null
  fechaVto: Date
}

function confirmacion(codigo: CodigoConfirmacion, mensaje?: string): ConfirmacionRequerida {
  return crearConfirmacion(codigo, mensaje)
}

/**
 * Agrega una confirmación. Cada motivo tiene su propio código; si igual se
 * repite un código se juntan los mensajes y se recalcula la firma (el tilde
 * queda atado al texto completo que se mostró).
 */
function sumarConfirmacion(lista: ConfirmacionRequerida[], c: ConfirmacionRequerida): void {
  const i = lista.findIndex((x) => x.codigo === c.codigo)
  if (i >= 0) lista[i] = crearConfirmacion(c.codigo, `${lista[i].mensaje} ${c.mensaje}`)
  else lista.push(c)
}

/** Padrón de ARCA del CUIT del cliente: activo y misma condición que en el ERP */
async function evaluarPadron(
  cliente: ClienteDirecta,
  receptor: ReceptorInput,
  letra: LetraFacturaDirecta,
  errores: ErrorFacturaDirecta[],
  avisos: ProblemaFacturaDirecta[],
  confirmaciones: ConfirmacionRequerida[]
): Promise<ResumenPadronDirecta | null> {
  const cuit = soloDigitos(cliente.cuit)
  if (cuit.length !== 11 || !esCuitValido(cuit)) return null
  // ¿El CUIT del cliente es el documento que va a ARCA? (en la B puede ir un DNI)
  const usaCuit = soloDigitos(receptor.docNro) === cuit
  const cuitTxt = normalizeCuit(cuit)
  try {
    const p = await consultarPersona(cuit)
    const resumen: ResumenPadronDirecta = {
      estado: 'encontrado',
      razonSocial: p.razonSocial || null,
      condicionIva: p.condicionIva,
      activo: p.activo,
      observaciones: (p.observaciones ?? []).map(String).filter((o) => o.trim()),
      mensaje: null,
    }
    if (!p.activo) {
      const mensaje = `El CUIT ${cuitTxt} figura inactivo en ARCA`
      if (usaCuit) errores.push({ codigo: 'CUIT_INACTIVO', status: 422, mensaje })
      else avisos.push({ codigo: 'CUIT_INACTIVO', mensaje })
    }
    // Condición según ARCA. Sin condición IVA: consumidor final, salvo que
    // ARCA deje observaciones sobre un CUIT (la constancia pudo venir trabada:
    // podría ser RI). Un CUIL o un CDI nunca es RI ni monotributista.
    const clave = (p.tipoClave ?? 'CUIT').trim().toUpperCase()
    const incierta = p.condicionIva === null && resumen.observaciones.length > 0 && clave !== 'CUIL' && clave !== 'CDI'
    if (incierta) {
      const texto = `ARCA no puede confirmar la condición frente al IVA de ${cliente.name} (${cuitTxt}): ${resumen.observaciones.join(' · ')}.`
      if (cliente.taxCondition === 'RESPONSABLE_INSCRIPTO' || cliente.taxCondition === 'MONOTRIBUTO') {
        // Como en las cotizaciones: se factura con la condición del ERP, pero
        // confirmándolo a sabiendas (la constancia vino con observaciones)
        sumarConfirmacion(
          confirmaciones,
          confirmacion('CONDICION_IVA_SIN_CONFIRMAR', `${texto} Se factura como ${etiquetaCondicion(cliente.taxCondition)}, según el ERP: verificá la constancia.`)
        )
      } else {
        errores.push({ codigo: 'CONDICION_IVA_INCIERTA', status: 422, mensaje: `${texto} Verificá la constancia antes de facturar.` })
      }
    } else {
      const segunArca = p.condicionIva ?? 'CONSUMIDOR_FINAL'
      if (segunArca !== cliente.taxCondition) {
        errores.push({
          codigo: 'CONDICION_DISTINTA_ARCA',
          status: 422,
          mensaje: `El ERP tiene a ${cliente.name} (${cuitTxt}) como ${etiquetaCondicion(cliente.taxCondition)} y ARCA lo informa como ${etiquetaCondicion(segunArca)}: corregí el cliente (/clientes/${cliente.id}) antes de facturar.`,
        })
      }
    }
    return resumen
  } catch (e) {
    if (e instanceof PadronError && e.noExiste) {
      const mensaje = `ARCA no tiene registrado el CUIT ${cuitTxt}${letra === 'B' ? ': indicá el DNI del comprador o corregí el CUIT del cliente' : ''}`
      if (usaCuit) errores.push({ codigo: 'CUIT_NO_EXISTE_ARCA', status: 422, mensaje })
      else avisos.push({ codigo: 'CUIT_NO_EXISTE_ARCA', mensaje })
      return { estado: 'no-existe', razonSocial: null, condicionIva: null, activo: null, observaciones: [], mensaje: e.message }
    }
    // Padrón caído: solo aviso (los circuitos de cotización tampoco lo consultan)
    const mensaje = (e as Error).message
    avisos.push({ codigo: 'PADRON_NO_DISPONIBLE', mensaje: `No se pudo consultar el padrón de ARCA (${mensaje}): verificá la condición del cliente` })
    return { estado: 'error', razonSocial: null, condicionIva: null, activo: null, observaciones: [], mensaje }
  }
}

/** Venta de ML vinculada: controles, confirmaciones y avisos (sección 6, punto 10) */
async function evaluarVentaMl(
  pedido: PedidoFacturaDirecta,
  calculo: CalculoFacturaDirecta,
  receptor: ReceptorInput,
  opts: { emision: boolean },
  out: Pick<EvaluacionFacturaDirecta, 'errores' | 'avisos' | 'confirmaciones'>
): Promise<ResumenMlDirecta | null> {
  const id = pedido.mlVenta!
  let v: InspeccionVentaMl
  try {
    v = opts.emision ? await verificarVentaMlFacturable(id) : await inspeccionarVentaMl(id)
  } catch (e) {
    if (e instanceof VentaMlError) {
      out.errores.push({ codigo: e.codigo, status: e.status, mensaje: e.message })
    } else if (e instanceof MlApiError && e.status === 404) {
      out.errores.push({ codigo: 'ML_VENTA_NO_EXISTE', status: 404, mensaje: `La venta ${id} no existe en Mercado Libre` })
    } else {
      out.errores.push({ codigo: 'ML_NO_DISPONIBLE', status: 502, mensaje: `No se pudo consultar la venta en Mercado Libre: ${(e as Error).message}` })
    }
    return null
  }
  const titular = compararTitularVentaMl(receptor.docNro, v.documentoMl)
  const r: ResumenMlDirecta = { ...v, titular }

  if (v.yaFacturada) {
    out.errores.push({
      codigo: 'YA_FACTURADA',
      status: 409,
      mensaje: v.yaFacturada.invoiceNumber
        ? `La venta ${v.packId} ya fue facturada desde el ERP (${v.yaFacturada.invoiceNumber})`
        : `La venta ${v.packId} se está facturando o quedó con la emisión sin terminar (para revisar)`,
    })
    return r
  }
  if (!v.pagada) out.errores.push({ codigo: 'ML_NO_PAGADA', status: 422, mensaje: mensajeVentaMlNoPagada(v.noPagas) })

  if (v.facturaEnMl === true) {
    sumarConfirmacion(
      out.confirmaciones,
      confirmacion(
        'ML_FACTURA_ADJUNTA',
        v.anteriorAlCorte
          ? 'La venta ya tiene una factura adjunta en Mercado Libre: probablemente Colppy ya emitió una B. Anulala con una NC B en Colppy para que no quede facturada dos veces.'
          : 'La venta ya tiene una factura adjunta en Mercado Libre: confirmá que corresponde facturarla igual desde el ERP.'
      )
    )
  } else if (v.facturaEnMl === null) {
    sumarConfirmacion(out.confirmaciones, confirmacion('ML_FACTURA_SIN_VERIFICAR'))
  }
  if (v.anteriorAlCorte) {
    out.avisos.push({
      codigo: 'ML_ANTERIOR_AL_CORTE',
      mensaje: 'La venta es anterior al corte de la facturación de ML desde el ERP: probablemente Colppy ya emitió una Factura B. Si es así, anulala con NC B en Colppy.',
    })
  }

  const total = calculo.totales.total
  if (Number.isFinite(total) && total > 0 && totalDistintoDeMl(total, v.totalMl)) {
    sumarConfirmacion(
      out.confirmaciones,
      confirmacion('ML_TOTAL_DISTINTO', `El total de la factura ($ ${fmt(total)}) es distinto del cobrado en Mercado Libre ($ ${fmt(v.totalMl)}).`)
    )
  }

  const docMl = v.documentoMl ? `${v.documentoMl.tipo} ${v.documentoMl.numero}` : null
  if (titular === 'otro') {
    sumarConfirmacion(
      out.confirmaciones,
      confirmacion('ML_OTRO_TITULAR', `Mercado Libre informa como comprador a ${v.nombreMl ?? v.buyerNickname ?? 'otra persona'} (${docMl}) y la factura sale a ${receptor.docNro}: confirmá que corresponde facturar a otro titular.`)
    )
  } else if (titular === 'empresa') {
    out.avisos.push({ codigo: 'ML_TITULAR_EMPRESA', mensaje: `Se factura a una empresa; Mercado Libre informa como comprador a ${v.nombreMl ?? v.buyerNickname ?? '-'} (${docMl}).` })
  } else if (titular === 'sin-dato') {
    out.avisos.push({ codigo: 'ML_SIN_DOCUMENTO', mensaje: `Mercado Libre no informó el documento del comprador${v.fiscalError ? ` (${v.fiscalError})` : ''}: verificá que sea el cliente.` })
  }

  // Factura del ERP (de cualquier cliente) por el total de ML cerca de la fecha de la venta
  const fecha = new Date(v.fecha)
  if (Number.isFinite(fecha.getTime())) {
    const dup = await prisma.invoice.findFirst({
      where: {
        transactionType: 'SALE',
        currency: 'ARS',
        status: { notIn: ['CANCELLED', 'DRAFT'] },
        mlOrderInvoice: { is: null },
        total: { gte: v.totalMl - 1, lte: v.totalMl + 1 },
        issueDate: { gte: new Date(fecha.getTime() - VENTANA_DUPLICADO_ML_MS), lte: new Date(fecha.getTime() + VENTANA_DUPLICADO_ML_MS) },
      },
      orderBy: { issueDate: 'desc' },
      select: { invoiceNumber: true, issueDate: true, total: true, customer: { select: { name: true } } },
    })
    if (dup) {
      sumarConfirmacion(
        out.confirmaciones,
        confirmacion(
          'POSIBLE_DUPLICADO_ML',
          `Ya hay una factura del ERP por el total de la venta de ML: ${dup.invoiceNumber} a ${dup.customer.name} del ${dup.issueDate.toLocaleDateString('es-AR')} ($ ${fmt(Number(dup.total))}).`
        )
      )
    }
  }
  return r
}

/**
 * Todas las validaciones de la sección 6 del diseño, en orden. No lanza
 * (salvo cliente inexistente: 404): devuelve errores (con su status),
 * avisos y confirmaciones. `emision`: al emitir la venta de ML se verifica
 * sin caché (verificarVentaMlFacturable).
 */
async function evaluarFacturaDirecta(pedido: PedidoFacturaDirecta, opts: { ahora: Date; emision: boolean }): Promise<EvaluacionFacturaDirecta> {
  const { ahora } = opts
  const errores: ErrorFacturaDirecta[] = erroresConfiguracionFacturaDirecta(ahora)
  const avisos: ProblemaFacturaDirecta[] = []
  const confirmaciones: ConfirmacionRequerida[] = []

  // 2. Cliente
  const cliente = await prisma.customer.findUnique({ where: { id: pedido.customerId }, select: SELECT_CLIENTE })
  if (!cliente) throw new FacturaDirectaError('CLIENTE_NO_EXISTE', 404, 'El cliente no existe')
  const ev: EvaluacionFacturaDirecta = {
    ahora,
    cliente,
    calculo: null,
    receptor: null,
    documentoReceptorB: null,
    lineas: [],
    errores,
    avisos,
    confirmaciones,
    padron: null,
    ml: null,
    tipoCambioReferencia: null,
    fechaVto: fechaVtoDesde(ahora, pedido.condicionPago),
  }
  if (cliente.status !== 'ACTIVE') {
    errores.push({ codigo: 'CLIENTE_INACTIVO', status: 422, mensaje: `El cliente ${cliente.name} está inactivo` })
  }
  const bloqueo = bloqueoClienteFacturaDirecta(cliente)
  if (bloqueo) {
    errores.push({ ...bloqueo, status: 422 })
    return ev
  }

  // 3. Letra: la de Colppy y la de ARCA tienen que coincidir (nunca se elige a mano)
  let receptor: ReceptorInput
  let letra: LetraFacturaDirecta
  try {
    const r = receptorDesdeCondicion(cliente.taxCondition, cliente.cuit)
    letra = letraFacturaColppy(cliente.taxCondition)
    if (r.letra !== letra) {
      errores.push({
        codigo: 'LETRA_INCOHERENTE',
        status: 422,
        mensaje: `La letra de la factura no coincide entre ARCA (${r.letra}) y Colppy (${letra}) para la condición "${cliente.taxCondition}"`,
      })
      return ev
    }
    receptor = r.receptor
  } catch (e) {
    errores.push({ codigo: 'CLIENTE_EXTERIOR', status: 422, mensaje: (e as Error).message })
    return ev
  }
  // Factura B: documento del comprador sin CUIT (DNI/CUIL), igual que lo hace el hook
  const documentoReceptorB = letra === 'B' ? pedido.documentoReceptorB : null
  if (documentoReceptorB) receptor = { ...receptor, docTipo: documentoReceptorB.docTipo, docNro: soloDigitos(documentoReceptorB.docNro) }
  ev.receptor = receptor
  ev.documentoReceptorB = documentoReceptorB

  // 4. CUIT
  const cuit = soloDigitos(cliente.cuit)
  if (letra === 'A') {
    if (cuit.length !== 11 || !esCuitValido(cuit)) {
      errores.push({ codigo: 'CUIT_INVALIDO', status: 422, mensaje: `La Factura A requiere un CUIT válido del cliente (${cliente.name}: "${cliente.cuit}")` })
    } else if (isArcaConfigured() && cuit === getArcaConfig().cuit) {
      errores.push({ codigo: 'CUIT_EMISOR', status: 422, mensaje: 'El cliente tiene el CUIT de Val Arg (emisor): no se puede facturar a uno mismo' })
    }
  } else if (receptor.docTipo === 80 && !esCuitValido(receptor.docNro)) {
    errores.push({
      codigo: 'CUIT_INVALIDO',
      status: 422,
      mensaje: `El CUIT del cliente (${cliente.cuit}) no es válido: corregilo o indicá el DNI del comprador`,
    })
  }

  // 5. Padrón de ARCA
  ev.padron = await evaluarPadron(cliente, receptor, letra, errores, avisos, confirmaciones)

  // 6. Líneas y productos
  const ids = Array.from(new Set(pedido.lineas.map((l) => l.productId).filter((x): x is string => !!x)))
  const productos = ids.length
    ? await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, sku: true, name: true, status: true, taxRate: true } })
    : []
  const porId = new Map(productos.map((p) => [p.id, p]))
  pedido.lineas.forEach((l, i) => {
    if (!l.productId) return
    const p = porId.get(l.productId)
    const linea = i + 1
    if (!p) errores.push({ codigo: 'PRODUCTO_NO_EXISTE', status: 404, mensaje: `Línea ${linea}: el producto elegido no existe`, linea })
    else if (p.status !== 'ACTIVE') errores.push({ codigo: 'PRODUCTO_INACTIVO', status: 422, mensaje: `Línea ${linea}: el producto ${p.sku} no está activo`, linea })
    else if (Number(p.taxRate ?? 21) !== 21) {
      errores.push({
        codigo: 'IVA_NO_SOPORTADO',
        status: 422,
        mensaje: `Línea ${linea}: el producto ${p.sku} tiene IVA ${Number(p.taxRate)}%: por ahora la factura directa solo emite con IVA 21%`,
        linea,
      })
    }
  })
  ev.lineas = pedido.lineas.map((l) => ({
    productId: l.productId,
    sku: (l.productId && porId.get(l.productId)?.sku) || null,
    descripcion: l.descripcion,
    cantidad: l.cantidad,
    precioUnitario: l.precioUnitario,
    comentario: l.comentario,
  }))
  if ((pedido.observaciones ?? '').length > MAX_OBSERVACIONES_FACTURA_DIRECTA) {
    errores.push({ codigo: 'OBSERVACIONES_LARGAS', status: 422, mensaje: `Las observaciones superan ${MAX_OBSERVACIONES_FACTURA_DIRECTA} caracteres` })
  }

  // 4-7 (moneda, totales, B a CF, FCE): cálculo puro, el mismo que la pantalla
  const cfg = isArcaConfigured() ? getArcaConfig() : null
  const calculo = calcularFacturaDirecta({
    taxCondition: cliente.taxCondition,
    cuit: cliente.cuit,
    country: cliente.country,
    fceObligado: cliente.fceObligado,
    lineas: pedido.lineas,
    moneda: pedido.moneda,
    tipoCambio: pedido.tipoCambio,
    preciosConIva: pedido.preciosConIva,
    fceMontoMinimo: cfg?.fceMontoMinimo ?? 5_549_862,
    documentoReceptorB,
    docTipoReceptor: receptor.docTipo,
    cbuConfigurado: cfg ? !!cfg.cbu : undefined,
  })
  ev.calculo = calculo
  errores.push(...calculo.errores.map((e) => ({ ...e, status: 422 })))
  avisos.push(...calculo.avisos)

  // Tipo de cambio alejado del último BNA billete cargado
  if (pedido.moneda === 'USD') {
    const ref = await prisma.exchangeRate.findFirst({
      where: { fromCurrency: 'USD', toCurrency: 'ARS', validFrom: { lte: ahora } },
      orderBy: [{ validFrom: 'desc' }, { createdAt: 'desc' }],
      select: { rate: true, validFrom: true },
    })
    if (ref) {
      ev.tipoCambioReferencia = { rate: Number(ref.rate), fecha: ref.validFrom.toISOString().slice(0, 10) }
      if (tipoCambioAlejado(Number(pedido.tipoCambio), Number(ref.rate))) {
        sumarConfirmacion(
          confirmaciones,
          confirmacion(
            'TIPO_CAMBIO_ALEJADO',
            `El tipo de cambio ${pedido.tipoCambio} se aleja más de 3% del último dólar BNA cargado (${Number(ref.rate)} del ${ev.tipoCambioReferencia.fecha}).`
          )
        )
      }
    } else {
      avisos.push({ codigo: 'TC_SIN_REFERENCIA', mensaje: 'No hay un dólar BNA cargado para comparar el tipo de cambio' })
    }
    if (pedido.mlVenta) errores.push({ codigo: 'ML_SOLO_ARS', status: 422, mensaje: 'Una venta de Mercado Libre solo se vincula a una factura en pesos' })
  }

  // 8. Posible duplicado: factura del mismo cliente por el mismo total (7 días)
  // o una factura directa reciente. Un código por motivo y el texto dice cuál
  // factura es (la firma lo ata): un duplicado que aparece después de la
  // vista previa vuelve a pedir confirmación aunque ya se hubiera tildado otro.
  const total = calculo.totales.total
  if (Number.isFinite(total) && total > 0) {
    const dup = await prisma.invoice.findFirst({
      where: {
        customerId: cliente.id,
        transactionType: 'SALE',
        status: { notIn: ['CANCELLED', 'DRAFT'] },
        currency: pedido.moneda,
        total: { gte: total - 1, lte: total + 1 },
        issueDate: { gte: new Date(ahora.getTime() - VENTANA_DUPLICADO_CLIENTE_MS) },
      },
      orderBy: { issueDate: 'desc' },
      select: { invoiceNumber: true, issueDate: true, total: true },
    })
    const reciente = await prisma.facturaDirecta.findFirst({
      where: {
        customerId: cliente.id,
        createdAt: { gte: new Date(ahora.getTime() - VENTANA_DIRECTA_RECIENTE_MS) },
        estado: { notIn: ESTADOS_REUSABLES },
        ...(pedido.idempotencyKey ? { idempotencyKey: { not: pedido.idempotencyKey } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: { estado: true, total: true, currency: true, createdAt: true, puntoVenta: true, cbteNumero: true },
    })
    if (dup) {
      sumarConfirmacion(
        confirmaciones,
        confirmacion(
          'POSIBLE_DUPLICADO',
          `Posible factura duplicada: ya hay una factura del cliente por el mismo total: ${dup.invoiceNumber} del ${dup.issueDate.toLocaleDateString('es-AR')} (${pedido.moneda} ${fmt(Number(dup.total))}).`
        )
      )
    }
    if (reciente) {
      sumarConfirmacion(
        confirmaciones,
        confirmacion(
          'DIRECTA_RECIENTE',
          `Posible factura duplicada: hace menos de 10 minutos (a las ${horaAr(reciente.createdAt)}) se emitió otra factura directa a este cliente${
            reciente.puntoVenta && reciente.cbteNumero ? ` (${formatNroComprobante(reciente.puntoVenta, reciente.cbteNumero)})` : ''
          } por ${reciente.currency} ${fmt(Number(reciente.total))} (${reciente.estado}).`
        )
      )
    }
  }

  // 9. Emisión pendiente del cliente (incierta, huérfana o en curso): bloqueo duro
  const pendiente = await buscarEmisionPendiente(cliente.id, pedido.idempotencyKey)
  if (pendiente) errores.push(errorEmisionPendiente(pendiente))

  // 10. Venta de Mercado Libre (solo en pesos)
  if (pedido.mlVenta && pedido.moneda === 'ARS') {
    ev.ml = await evaluarVentaMl(pedido, calculo, receptor, opts, ev)
  }

  // 11. Toda emisión se confirma
  sumarConfirmacion(
    confirmaciones,
    confirmacion(
      'EMISION_IRREVERSIBLE',
      `Se emite en ARCA la ${calculo.esFce ? 'FCE MiPyME A' : `Factura ${letra}`} a ${cliente.name} por ${pedido.moneda} ${fmt(round2(total))}: no se puede borrar, solo anular con una nota de crédito.`
    )
  )
  return ev
}

type FilaPendiente = Pick<FacturaDirecta, 'id' | 'estado' | 'cbteTipo' | 'puntoVenta' | 'cbteNumero' | 'cae' | 'invoiceId' | 'updatedAt'>

/** Factura directa del cliente con otra clave en EMITIENDO, INCIERTA o huérfana (AUTORIZADA sin Invoice) */
async function buscarEmisionPendiente(customerId: string, idempotencyKey: string | null, db: Prisma.TransactionClient = prisma): Promise<FilaPendiente | null> {
  return db.facturaDirecta.findFirst({
    where: {
      customerId,
      ...(idempotencyKey ? { idempotencyKey: { not: idempotencyKey } } : {}),
      OR: [{ estado: { in: [ESTADO_DIRECTA.EMITIENDO, ESTADO_DIRECTA.INCIERTA] } }, { estado: ESTADO_DIRECTA.AUTORIZADA, invoiceId: null }],
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, estado: true, cbteTipo: true, puntoVenta: true, cbteNumero: true, cae: true, invoiceId: true, updatedAt: true },
  })
}

function errorEmisionPendiente(f: FilaPendiente): ErrorFacturaDirecta {
  const cbte = f.cbteTipo && f.puntoVenta ? `${describeCbteTipo(f.cbteTipo)} ${f.cbteNumero ? formatNroComprobante(f.puntoVenta, f.cbteNumero) : ''}`.trim() : 'factura'
  const situacion =
    f.estado === ESTADO_DIRECTA.INCIERTA
      ? `quedó sin confirmar en ARCA (${cbte})`
      : f.estado === ESTADO_DIRECTA.AUTORIZADA
        ? `se emitió en ARCA (${cbte}, CAE ${f.cae}) pero no quedó registrada en el ERP`
        : 'se está emitiendo en este momento'
  return {
    codigo: 'EMISION_PENDIENTE',
    status: 409,
    mensaje: `Hay otra factura directa de este cliente que ${situacion}: resolvela antes de emitir otra (scripts/factura-directa-reconciliar.ts)`,
  }
}

// ---------------------------------------------------------------------------
// Vista previa
// ---------------------------------------------------------------------------

/** POST /api/facturas/directa/preview: sin efectos (lee la DB, el padrón y ML). */
export async function previsualizarFacturaDirecta(pedido: PedidoFacturaDirecta): Promise<PreviewFacturaDirecta> {
  const ahora = new Date()
  const ev = await evaluarFacturaDirecta(pedido, { ahora, emision: false })
  const c = ev.calculo
  return {
    ok: ev.errores.length === 0,
    letra: c?.letra ?? null,
    cbteTipoPrevisto: c?.cbteTipoPrevisto ?? null,
    esFce: !!c?.esFce,
    receptor: ev.receptor ? { docTipo: ev.receptor.docTipo, docNro: ev.receptor.docNro, condicionIvaId: ev.receptor.condicionIvaId } : null,
    totales: c?.totales ?? null,
    preciosConIva: c?.preciosConIva ?? pedido.preciosConIva,
    condicionPago: pedido.condicionPago,
    fechaFactura: fechaYmdAr(ahora),
    fechaVto: fechaYmdLocal(ev.fechaVto),
    errores: ev.errores.map(({ codigo, mensaje, linea }) => (linea ? { codigo, mensaje, linea } : { codigo, mensaje })),
    avisos: ev.avisos,
    confirmacionesRequeridas: ev.confirmaciones,
    padron: ev.padron,
    ml: ev.ml,
    cliente: {
      id: ev.cliente.id,
      name: ev.cliente.name,
      cuit: ev.cliente.cuit,
      taxCondition: ev.cliente.taxCondition,
      fceObligado: ev.cliente.fceObligado,
      condicionPagoSugerida: condicionPagoDesdeDias(ev.cliente.paymentTerms),
    },
    tipoCambioReferencia: ev.tipoCambioReferencia,
  }
}

// ---------------------------------------------------------------------------
// Emisión
// ---------------------------------------------------------------------------

/** Respuesta para una clave que ya se usó (no se vuelve a emitir) */
async function respuestaClaveUsada(fila: FacturaDirecta): Promise<ResultadoFacturaDirecta> {
  const numero = fila.puntoVenta && fila.cbteNumero ? formatNroComprobante(fila.puntoVenta, fila.cbteNumero) : null
  if (fila.estado === ESTADO_DIRECTA.AUTORIZADA && fila.invoiceId) {
    const inv = await prisma.invoice.findUnique({
      where: { id: fila.invoiceId },
      select: { id: true, invoiceNumber: true, cae: true, caeExpiration: true, total: true, currency: true, colppySyncStatus: true, colppySyncError: true },
    })
    if (inv) {
      const candado = fila.mlPackId ? await prisma.mlOrderInvoice.findUnique({ where: { packId: fila.mlPackId } }) : null
      return {
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        cae: inv.cae ?? fila.cae ?? '',
        caeVencimiento: (inv.caeExpiration ?? fila.caeVencimiento ?? new Date(NaN)).toISOString(),
        total: Number(inv.total),
        currency: inv.currency,
        pdfUrl: `/api/facturas/${inv.id}/pdf`,
        colppy: { estado: inv.colppySyncStatus ?? 'NO_APLICA', ...(inv.colppySyncError ? { error: inv.colppySyncError } : {}) },
        ml: fila.mlPackId
          ? { packId: fila.mlPackId, uploadOk: candado?.mlUploadStatus === 'OK', ...(candado?.mlUploadError ? { error: candado.mlUploadError } : {}) }
          : null,
        repetida: true,
      }
    }
  }
  if (fila.estado === ESTADO_DIRECTA.AUTORIZADA) {
    throw new FacturaDirectaError(
      'ERP_HUERFANA',
      409,
      `La factura ${numero ?? ''} ya se emitió en ARCA (CAE ${fila.cae}) pero no quedó registrada en el ERP. NO reintentes: se registra con scripts/factura-directa-reconciliar.ts`,
      { cae: fila.cae, numero, facturaDirectaId: fila.id }
    )
  }
  if (fila.estado === ESTADO_DIRECTA.INCIERTA) {
    const intento = fila.intento as unknown as IntentoEmisionArca | null
    throw new FacturaDirectaError(
      'ARCA_INCIERTO',
      409,
      mensajeEmisionIncierta({ cbteTipo: intento?.cbteTipo ?? fila.cbteTipo ?? 0, puntoVenta: intento?.puntoVenta ?? fila.puntoVenta ?? 0, numero: intento?.numero ?? null }),
      { facturaDirectaId: fila.id }
    )
  }
  throw new FacturaDirectaError(
    'EN_CURSO',
    409,
    'Esta factura se está emitiendo (o la emisión se cortó): esperá un momento y revisá el listado de facturas antes de reintentar',
    { facturaDirectaId: fila.id }
  )
}

/** Datos de la fila del diario (crear o reusar una clave rechazada) */
function datosFila(ev: EvaluacionFacturaDirecta, pedido: PedidoFacturaDirecta, user: { id: string }) {
  const c = ev.calculo!
  const receptor = ev.receptor!
  const guardado: PedidoFacturaDirectaGuardado = {
    version: 1,
    customerId: ev.cliente.id,
    cliente: { name: ev.cliente.name, cuit: ev.cliente.cuit, taxCondition: ev.cliente.taxCondition, fceObligado: ev.cliente.fceObligado },
    moneda: pedido.moneda,
    tipoCambio: pedido.moneda === 'USD' ? Number(pedido.tipoCambio) : null,
    condicionPago: pedido.condicionPago,
    preciosConIva: c.preciosConIva,
    documentoReceptorB: ev.documentoReceptorB,
    observaciones: pedido.observaciones,
    confirmaciones: pedido.confirmaciones,
    letra: c.letra,
    esFce: c.esFce,
    receptor: { docTipo: receptor.docTipo, docNro: receptor.docNro, condicionIvaId: receptor.condicionIvaId },
    totales: c.totales,
    fechaFactura: fechaYmdLocal(ev.ahora),
    fechaVto: fechaYmdLocal(ev.fechaVto),
    ml: ev.ml ? { packId: ev.ml.packId, orderIds: ev.ml.orderIds, buyerNickname: ev.ml.buyerNickname, totalMl: ev.ml.totalMl } : null,
    lineas: ev.lineas,
  }
  return {
    customerId: ev.cliente.id,
    createdById: user.id,
    letra: c.letra,
    puntoVenta: isArcaConfigured() ? getArcaConfig().puntoVenta : null,
    cbteTipo: c.cbteTipoPrevisto,
    cbteNumero: null,
    cae: null,
    caeVencimiento: null,
    docTipo: receptor.docTipo,
    docNro: receptor.docNro,
    qrUrl: null,
    fceVtoPago: null,
    observacionesArca: null,
    currency: pedido.moneda,
    exchangeRate: guardado.tipoCambio,
    total: c.totales.total,
    mlPackId: guardado.ml?.packId ?? null,
    pedido: aJson(guardado),
    intento: Prisma.JsonNull,
    error: null,
  }
}

type Reserva = { tipo: 'reservada'; fila: FacturaDirecta } | { tipo: 'existente'; fila: FacturaDirecta } | { tipo: 'pendiente'; fila: FilaPendiente }

/**
 * Reserva la clave dentro de una transacción con advisory lock por cliente:
 * emisión pendiente de otra clave → 'pendiente'; clave RECHAZADA /
 * NO_SOLICITADA / DESCARTADA → se reusa (EMITIENDO); clave en otro estado →
 * 'existente'; clave nueva → se crea EMITIENDO.
 */
async function reservarClave(key: string, data: ReturnType<typeof datosFila>): Promise<Reserva> {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'factura-directa:' + data.customerId}))`
      const pendiente = await buscarEmisionPendiente(data.customerId, key, tx)
      if (pendiente) return { tipo: 'pendiente', fila: pendiente } as const
      const reusada = await tx.facturaDirecta.updateMany({
        where: { idempotencyKey: key, estado: { in: ESTADOS_REUSABLES } },
        data: { ...data, estado: ESTADO_DIRECTA.EMITIENDO, invoiceId: null },
      })
      const existente = await tx.facturaDirecta.findUnique({ where: { idempotencyKey: key } })
      if (reusada.count === 1 && existente) return { tipo: 'reservada', fila: existente } as const
      if (existente) return { tipo: 'existente', fila: existente } as const
      const fila = await tx.facturaDirecta.create({ data: { ...data, idempotencyKey: key, estado: ESTADO_DIRECTA.EMITIENDO } })
      return { tipo: 'reservada', fila } as const
    })
  } catch (e) {
    // La misma clave con otro cliente en paralelo (otro advisory lock): ganó la otra
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const fila = await prisma.facturaDirecta.findUnique({ where: { idempotencyKey: key } })
      if (fila) return { tipo: 'existente', fila }
    }
    throw e
  }
}

/** Actualiza la fila del diario sin lanzar (un error de la DB no tapa el error original) */
async function marcarFila(id: string, data: Prisma.FacturaDirectaUpdateInput): Promise<void> {
  try {
    await prisma.facturaDirecta.update({ where: { id }, data })
  } catch (e) {
    logger.error(`[Factura directa] No se pudo actualizar la fila ${id} del diario: ${(e as Error).message}`, { data })
  }
}

/** Errores de ARCA de un rechazo (EmisionExternaError.detalles) */
function erroresArca(e: unknown): Array<{ Code: number; Msg: string }> {
  const d = e instanceof EmisionExternaError ? e.detalles : null
  return Array.isArray(d) ? (d as Array<{ Code: number; Msg: string }>) : []
}

/** El hook lanzó: según el intento, la fila queda RECHAZADA / NO_SOLICITADA (y se libera ML) o INCIERTA. Siempre lanza. */
async function falloEmision(e: unknown, fila: FacturaDirecta, hook: HookEmisionArca, packId: string | null): Promise<never> {
  const intento = hook.getIntentoEmision()
  const msg = e instanceof Error ? e.message : String(e)
  if (emisionDescartada(intento)) {
    const estado = intento?.estado === 'rechazada' ? ESTADO_DIRECTA.RECHAZADA : ESTADO_DIRECTA.NO_SOLICITADA
    await marcarFila(fila.id, {
      estado,
      error: msg.slice(0, 4000),
      intento: intento ? aJson(intento) : Prisma.JsonNull,
      ...(intento ? { cbteTipo: intento.cbteTipo, puntoVenta: intento.puntoVenta } : {}),
    })
    if (packId) await liberarCandadoVentaMl(packId, hook)
    if (intento?.estado === 'rechazada') {
      const errores = erroresArca(e)
      const fce = errores.some((x) => Number(x.Code) === 10192) || /\b10192\b/.test(msg)
      throw new FacturaDirectaError(
        'ARCA_RECHAZO',
        422,
        fce ? 'ARCA indica que el cliente está obligado a FCE MiPyME: marcalo y volvé a emitir' : msg,
        { errores, ...(fce ? { detalle: msg } : {}) }
      )
    }
    if (intento?.estado === 'no-solicitada') {
      throw new FacturaDirectaError('ARCA_NO_SOLICITADA', 502, `No se pudo pedir el CAE a ARCA (no se emitió nada; se puede reintentar): ${msg}`)
    }
    // El hook falló antes de llamar a ARCA (letra, documento, CBU): validación
    throw new FacturaDirectaError('VALIDACION_EMISION', 422, msg)
  }
  // Se pidió el CAE y ARCA no lo confirmó: pudo haberlo autorizado
  await marcarFila(fila.id, {
    estado: ESTADO_DIRECTA.INCIERTA,
    error: msg.slice(0, 4000),
    intento: aJson(intento),
    cbteTipo: intento!.cbteTipo,
    puntoVenta: intento!.puntoVenta,
    cbteNumero: intento!.numero,
  })
  const mensaje = mensajeEmisionIncierta(intento!)
  logger.error(`[DIRECTA_ARCA_INCIERTO] ${mensaje}. Revisar con: npx tsx scripts/factura-directa-reconciliar.ts --id ${fila.id}`, {
    facturaDirectaId: fila.id,
    customerId: fila.customerId,
    cbteTipo: intento!.cbteTipo,
    puntoVenta: intento!.puntoVenta,
    numero: intento!.numero,
    estado: intento!.estado,
    total: Number(fila.total),
    mlPackId: packId,
    error: msg,
  })
  throw new FacturaDirectaError('ARCA_INCIERTO', 502, mensaje, {
    cbteTipo: intento!.cbteTipo,
    puntoVenta: intento!.puntoVenta,
    numero: intento!.numero,
    facturaDirectaId: fila.id,
  })
}

/**
 * POST /api/facturas/directa: valida (sección 6), reserva la clave, toma el
 * candado de ML, pide el CAE, guarda el CAE en el diario, registra la Invoice,
 * archiva el PDF, lo sube a ML y registra en Colppy (si está habilitado).
 * Lanza FacturaDirectaError con el status HTTP.
 */
export async function emitirFacturaDirecta(pedido: PedidoFacturaDirecta, user: { id: string }): Promise<ResultadoFacturaDirecta> {
  const key = pedido.idempotencyKey
  if (!key) throw new FacturaDirectaError('PEDIDO_INVALIDO', 400, 'Falta la clave de idempotencia (idempotencyKey)')

  // 0. Clave ya usada (repetición del mismo pedido): nunca se vuelve a emitir
  const previa = await prisma.facturaDirecta.findUnique({ where: { idempotencyKey: key } })
  if (previa && !ESTADOS_REUSABLES.includes(previa.estado)) return respuestaClaveUsada(previa)

  // 1-11. Validaciones (configuración primero: no tiene sentido consultar nada más)
  const ahora = new Date()
  const conf = erroresConfiguracionFacturaDirecta(ahora)
  if (conf.length) throw new FacturaDirectaError(conf[0].codigo, conf[0].status, conf[0].mensaje)
  const ev = await evaluarFacturaDirecta(pedido, { ahora, emision: true })
  if (ev.errores.length) {
    const [e] = ev.errores
    throw new FacturaDirectaError(e.codigo, e.status, e.mensaje, {
      errores: ev.errores.map(({ codigo, mensaje, linea }) => (linea ? { codigo, mensaje, linea } : { codigo, mensaje })),
    })
  }
  const faltan = confirmacionesFaltantes(ev.confirmaciones, pedido.confirmaciones)
  if (faltan.length) {
    throw new FacturaDirectaError('CONFIRMACION_REQUERIDA', 409, `Falta confirmar: ${faltan.map((f) => f.mensaje).join(' · ')}`, {
      confirmacionesRequeridas: ev.confirmaciones,
      faltantes: faltan.map((f) => f.codigo),
    })
  }
  const calculo = ev.calculo!
  const receptor = ev.receptor!
  const cliente = ev.cliente

  // Reserva de la clave (advisory lock por cliente)
  const reserva = await reservarClave(key, datosFila(ev, pedido, user))
  if (reserva.tipo === 'pendiente') {
    const e = errorEmisionPendiente(reserva.fila)
    throw new FacturaDirectaError(e.codigo, e.status, e.mensaje)
  }
  if (reserva.tipo === 'existente') return respuestaClaveUsada(reserva.fila)
  let fila = reserva.fila

  // Candado de la venta de ML: después de todas las validaciones, antes de ARCA
  const packId = ev.ml?.packId ?? null
  if (packId) {
    try {
      await tomarCandadoVentaMl({
        packId,
        orderIds: ev.ml!.orderIds,
        buyerNickname: ev.ml!.buyerNickname,
        cuitReceptor: cuitParaCandadoMl(receptor),
        totalFactura: calculo.totales.total,
        userId: user.id,
      })
    } catch (e) {
      await marcarFila(fila.id, { estado: ESTADO_DIRECTA.NO_SOLICITADA, error: (e as Error).message.slice(0, 4000) })
      if (e instanceof VentaMlError) throw new FacturaDirectaError(e.codigo, e.status, e.message)
      throw e
    }
  }

  // CAE: el mismo hook que corre dentro de sendQuoteToColppy, llamado directamente
  const referencia = packId ? `Venta Mercado Libre #${packId}` : `Factura directa ${cliente.name}`.slice(0, 80)
  const hook = crearHookEmisionArca({
    name: cliente.name,
    cuit: cliente.cuit,
    taxCondition: cliente.taxCondition,
    fceObligado: cliente.fceObligado,
    ...(ev.documentoReceptorB ? { documentoReceptorB: { docTipo: ev.documentoReceptorB.docTipo, docNro: ev.documentoReceptorB.docNro } } : {}),
  })
  // Fecha del comprobante a las 12:00 locales del día de hoy (no la hora
  // real): toCbteFch (CbteFch), FchVtoPago de la FCE y el QR (buildQrUrl usa
  // toISOString, en UTC) dan el mismo día. Con la hora real, de 21 a 24 h de
  // Argentina el QR salía con el día siguiente. La Invoice usa `ahora`.
  const datos = datosEmisionFacturaDirecta(calculo, {
    moneda: pedido.moneda,
    tipoCambio: pedido.tipoCambio,
    condicionPago: pedido.condicionPago,
    fecha: fechaComprobanteDirecta(ahora),
    descripcion: referencia,
  })
  let emision: EmisionExternaResultado
  try {
    emision = await hook.hook(datos)
  } catch (e) {
    return falloEmision(e, fila, hook, packId)
  }

  // El CAE se guarda en el diario ANTES y FUERA de la transacción de la Invoice
  const autorizada = hook.getEmision()
  const receptorUsado = hook.getReceptor() ?? receptor
  const numero = emision.numeroFormateado
  try {
    fila = await prisma.facturaDirecta.update({
      where: { id: fila.id },
      data: {
        estado: ESTADO_DIRECTA.AUTORIZADA,
        puntoVenta: emision.puntoVenta,
        cbteTipo: emision.cbteTipo,
        cbteNumero: emision.numero,
        cae: emision.cae,
        caeVencimiento: emision.caeVencimiento,
        docTipo: receptorUsado.docTipo,
        docNro: receptorUsado.docNro,
        qrUrl: hook.getQrUrl(),
        fceVtoPago: hook.getFceVtoPago(),
        observacionesArca: autorizada?.observaciones.length ? autorizada.observaciones.map((o) => `[${o.Code}] ${o.Msg}`).join(' · ') : null,
        intento: aJson(hook.getIntentoEmision()),
        error: null,
      },
    })
  } catch (e) {
    logger.error('[DIRECTA_ORPHAN] Factura directa emitida en ARCA pero no se pudo guardar el CAE en el diario', {
      facturaDirectaId: fila.id,
      numero,
      cbteTipo: emision.cbteTipo,
      cae: emision.cae,
      caeVencimiento: emision.caeVencimiento,
      docTipo: receptorUsado.docTipo,
      docNro: receptorUsado.docNro,
      total: calculo.totales.total,
      error: (e as Error).message,
    })
    throw huerfana(emision, fila.id)
  }

  // Invoice del ERP (+ candado de ML en EMITIDA) en una transacción
  const conColppy = colppyHabilitado()
  let invoice: { invoiceId: string; invoiceNumber: string; avisoMl?: string }
  try {
    invoice = await prisma.$transaction((tx) => crearInvoiceDirecta(tx, fila, { ahora, colppy: conColppy }), { maxWait: 10000, timeout: 30000 })
  } catch (e) {
    logger.error('[DIRECTA_ORPHAN] Factura directa emitida en ARCA pero el ERP no pudo registrar la Invoice', {
      facturaDirectaId: fila.id,
      numero,
      cbteTipo: emision.cbteTipo,
      cae: emision.cae,
      error: (e as Error).message,
    })
    throw huerfana(emision, fila.id)
  }

  archivarFacturaEnSharePointBg(invoice.invoiceId)
  // Sin el candado de la venta (o con otra factura en él) no se sube nada: se subiría el PDF equivocado
  const ml = packId ? (invoice.avisoMl ? { ok: false, error: invoice.avisoMl } : await subirFacturaAMl(packId)) : null
  const colppy: ResultadoRegistroColppy = conColppy
    ? await registrarFacturaDirectaEnColppy(invoice.invoiceId)
    : { ok: false, estado: 'NO_APLICA' }
  logger.info(
    `[Factura directa] ${invoice.invoiceNumber} CAE ${emision.cae} a ${cliente.name} (${pedido.moneda} ${calculo.totales.total}; Colppy ${colppy.estado}${packId ? `; ML ${ml?.ok ? 'OK' : 'ERROR'}` : ''})`
  )

  return {
    invoiceId: invoice.invoiceId,
    invoiceNumber: invoice.invoiceNumber,
    cae: emision.cae,
    caeVencimiento: emision.caeVencimiento.toISOString(),
    total: calculo.totales.total,
    currency: pedido.moneda,
    pdfUrl: `/api/facturas/${invoice.invoiceId}/pdf`,
    colppy: { estado: colppy.estado, ...(colppy.error ? { error: colppy.error } : {}) },
    ml: packId ? { packId, uploadOk: !!ml?.ok, ...(ml?.error ? { error: ml.error } : {}) } : null,
    repetida: false,
  }
}

function huerfana(emision: EmisionExternaResultado, facturaDirectaId: string): FacturaDirectaError {
  return new FacturaDirectaError(
    'ERP_HUERFANA',
    500,
    `La factura ${emision.numeroFormateado} se emitió en ARCA (CAE ${emision.cae}) pero el ERP no pudo registrarla. NO reintentes: avisá a soporte con ese número (se registra con scripts/factura-directa-reconciliar.ts).`,
    { cae: emision.cae, numero: emision.numeroFormateado, cbteTipo: emision.cbteTipo, facturaDirectaId }
  )
}

// ---------------------------------------------------------------------------
// Invoice del ERP
// ---------------------------------------------------------------------------

/**
 * Registra la Invoice de una fila AUTORIZADA (la usan la ruta y el script de
 * reconciliación). Idempotente: si la fila ya tiene Invoice no hace nada; si
 * ya hay una Invoice de ese comprobante (PV + tipo + número) la vincula, pero
 * SOLO si es esta misma factura (sin cotización, del mismo cliente, misma
 * moneda y total, sin otra factura directa ni otra venta de ML): si no, lanza
 * y no vincula nada (el comprobante es de otro flujo).
 * Si la fila tiene venta de ML, el candado pasa a EMITIDA en la misma
 * transacción; si el candado no está o ya es de otra factura, la Invoice se
 * registra igual (el comprobante existe en ARCA) y se devuelve `avisoMl`
 * (también va al log como [DIRECTA_ML_CANDADO]).
 */
export async function crearInvoiceDirecta(
  tx: Prisma.TransactionClient,
  fila: FacturaDirecta,
  opts: { ahora?: Date; colppy?: boolean } = {}
): Promise<{ invoiceId: string; invoiceNumber: string; creada: boolean; avisoMl?: string }> {
  if (fila.estado !== ESTADO_DIRECTA.AUTORIZADA || !fila.cae || !fila.cbteTipo || !fila.cbteNumero || !fila.puntoVenta) {
    throw new Error(`La factura directa ${fila.id} no está AUTORIZADA con CAE (estado ${fila.estado})`)
  }
  const p = pedidoGuardado(fila)
  const invoiceNumber = numeroInvoiceDirecta(p.letra, fila.cbteTipo, fila.puntoVenta, fila.cbteNumero)

  const vincular = async (invoiceId: string): Promise<string | undefined> => {
    await tx.facturaDirecta.update({ where: { id: fila.id }, data: { invoiceId } })
    if (!fila.mlPackId) return undefined
    const candado = await tx.mlOrderInvoice.findUnique({ where: { packId: fila.mlPackId } })
    if (candado && (!candado.invoiceId || candado.invoiceId === invoiceId)) {
      if (!candado.invoiceId) await vincularFacturaAVentaMl(tx, fila.mlPackId, invoiceId)
      return undefined
    }
    const aviso = candado
      ? `La venta de ML #${fila.mlPackId} ya está vinculada a otra factura (${candado.invoiceId}): ${invoiceNumber} puede ser una segunda factura de la misma venta (revisar y anular la que sobre con una NC)`
      : `La venta de ML #${fila.mlPackId} no tiene el candado de la factura directa (se liberó): ${invoiceNumber} quedó sin vincular a la venta y la venta se podría volver a facturar (revisar en /mercadolibre/facturacion)`
    logger.error(`[DIRECTA_ML_CANDADO] ${aviso}`, { facturaDirectaId: fila.id, invoiceId, mlPackId: fila.mlPackId, candadoInvoiceId: candado?.invoiceId ?? null })
    return aviso
  }
  if (fila.invoiceId) return { invoiceId: fila.invoiceId, invoiceNumber, creada: false }
  const previa = await tx.invoice.findFirst({
    where: { pointOfSale: fila.puntoVenta, cbteTipo: fila.cbteTipo, cbteNumero: fila.cbteNumero },
    select: {
      id: true,
      invoiceNumber: true,
      quoteId: true,
      customerId: true,
      currency: true,
      total: true,
      facturaDirecta: { select: { id: true } },
      mlOrderInvoice: { select: { packId: true } },
    },
  })
  if (previa) {
    const motivo = motivoInvoiceAjena(previa, fila)
    if (motivo) {
      throw new Error(
        `El comprobante ${invoiceNumber} ya está registrado en el ERP como ${previa.invoiceNumber} (${previa.id}) y no es esta factura directa (${motivo}): no se vincula. Revisar a mano`
      )
    }
    const avisoMl = await vincular(previa.id)
    return { invoiceId: previa.id, invoiceNumber: previa.invoiceNumber, creada: false, ...(avisoMl ? { avisoMl } : {}) }
  }

  const issueDate = opts.ahora ?? fechaDesdeYmd(p.fechaFactura)
  const colppy = opts.colppy ?? colppyHabilitado()
  const notas = [
    'Factura directa.',
    ...(p.ml ? [`Venta Mercado Libre #${p.ml.packId}.`] : []),
    `Emitida por el ERP (ARCA) el ${issueDate.toLocaleString('es-AR')}. CAE ${fila.cae}.`,
    ...(colppy ? [NOTA_PENDIENTE_COLPPY] : []),
  ].join(' ')
  const inv = await tx.invoice.create({
    data: {
      invoiceNumber,
      invoiceType: p.letra,
      transactionType: 'SALE',
      customerId: fila.customerId,
      quoteId: null,
      userId: fila.createdById,
      status: 'AUTHORIZED',
      currency: p.moneda,
      exchangeRate: p.moneda === 'USD' ? p.tipoCambio : null,
      colppyId: null,
      subtotal: p.totales.neto,
      taxAmount: p.totales.iva,
      discount: 0,
      total: p.totales.total,
      balance: p.totales.total,
      issueDate,
      dueDate: fechaVtoDesde(issueDate, p.condicionPago),
      notes: p.observaciones ? `${notas}\n${p.observaciones}` : notas,
      afipStatus: 'APPROVED',
      paymentStatus: 'UNPAID',
      emitidaPor: 'ARCA',
      pointOfSale: fila.puntoVenta,
      cbteTipo: fila.cbteTipo,
      cbteNumero: fila.cbteNumero,
      cae: fila.cae,
      caeExpiration: fila.caeVencimiento,
      docTipo: fila.docTipo,
      docNro: fila.docNro,
      qrUrl: fila.qrUrl,
      fceVtoPago: fila.fceVtoPago,
      arcaObservaciones: fila.observacionesArca,
      colppySyncStatus: colppy ? 'PENDIENTE' : 'NO_APLICA',
      colppySyncError: null,
      colppyPayload: Prisma.JsonNull,
      items: {
        create: p.lineas.map((l) => ({
          productId: l.productId,
          sku: l.sku,
          description: l.descripcion,
          quantity: l.cantidad,
          unitPrice: l.precioUnitario,
          discount: 0,
          taxRate: 21,
          subtotal: round2(l.precioUnitario * l.cantidad),
          comment: l.comentario,
        })),
      },
    },
    select: { id: true },
  })
  const avisoMl = await vincular(inv.id)
  return { invoiceId: inv.id, invoiceNumber, creada: true, ...(avisoMl ? { avisoMl } : {}) }
}

/**
 * ¿La Invoice que ya existe para el comprobante es de otro flujo? Devuelve el
 * motivo (o null si es esta misma factura directa: se puede vincular).
 */
export function motivoInvoiceAjena(
  previa: {
    quoteId: string | null
    customerId: string
    currency: string
    total: unknown
    facturaDirecta: { id: string } | null
    mlOrderInvoice: { packId: string } | null
  },
  fila: Pick<FacturaDirecta, 'id' | 'customerId' | 'currency' | 'total' | 'mlPackId'>
): string | null {
  if (previa.quoteId) return 'es la factura de una cotización'
  if (previa.facturaDirecta && previa.facturaDirecta.id !== fila.id) return `ya es de otra factura directa (${previa.facturaDirecta.id})`
  if (previa.mlOrderInvoice && previa.mlOrderInvoice.packId !== fila.mlPackId) return `es la factura de la venta de ML #${previa.mlOrderInvoice.packId}`
  if (previa.customerId !== fila.customerId) return 'es de otro cliente'
  if (previa.currency !== fila.currency) return `está en ${previa.currency}`
  if (!(Math.abs(Number(previa.total) - Number(fila.total)) <= 0.01)) return `tiene otro total (${Number(previa.total)})`
  return null
}

// ---------------------------------------------------------------------------
// Colppy (después de ARCA, best-effort)
// ---------------------------------------------------------------------------

/**
 * Emisión externa "ya realizada" para sendQuoteToColppy: NO llama a ARCA.
 * Compara la letra, la moneda y los importes que calculó Colppy con la
 * factura emitida (tolerancia 0,005) y devuelve el número y el CAE guardados;
 * si difieren lanza EmisionExternaError y Colppy no se toca.
 */
export function emisionYaRealizada(inv: {
  invoiceNumber: string
  invoiceType: string
  currency: string
  subtotal: unknown
  taxAmount: unknown
  total: unknown
  pointOfSale: number | null
  cbteTipo: number | null
  cbteNumero: number | null
  cae: string | null
  caeExpiration: Date | null
}): (datos: EmisionExternaDatos) => Promise<EmisionExternaResultado> {
  return async (datos) => {
    const difiere = (a: unknown, b: unknown) => !(Math.abs(Number(a) - Number(b)) <= 0.005)
    if (
      datos.tipoFactura !== inv.invoiceType ||
      datos.currency !== inv.currency ||
      difiere(datos.netoGravado, inv.subtotal) ||
      difiere(datos.totalIVA, inv.taxAmount) ||
      difiere(datos.totalFactura, inv.total)
    ) {
      throw new EmisionExternaError(
        `Colppy calculó Factura ${datos.tipoFactura} ${datos.currency} neto ${datos.netoGravado} IVA ${datos.totalIVA} total ${datos.totalFactura} y ` +
          `${inv.invoiceNumber} es ${inv.invoiceType} ${inv.currency} neto ${Number(inv.subtotal)} IVA ${Number(inv.taxAmount)} total ${Number(inv.total)}: no se registró en Colppy`
      )
    }
    if (!inv.pointOfSale || !inv.cbteTipo || !inv.cbteNumero || !inv.cae || !inv.caeExpiration) {
      throw new EmisionExternaError(`${inv.invoiceNumber} no tiene número o CAE de ARCA guardado: no se registró en Colppy`)
    }
    return {
      puntoVenta: inv.pointOfSale,
      numero: inv.cbteNumero,
      numeroFormateado: formatNroComprobante(inv.pointOfSale, inv.cbteNumero),
      cbteTipo: inv.cbteTipo,
      cae: inv.cae,
      caeVencimiento: inv.caeExpiration,
    }
  }
}

type CotizacionColppy = Parameters<typeof sendQuoteToColppy>[1]

/** Referencia de la factura directa en Colppy (descripción y comentario de las líneas sin comentario) */
export function referenciaColppyDirecta(invoiceNumber: string, mlPackId: string | null): string {
  return mlPackId ? `Venta Mercado Libre #${mlPackId}` : `Factura directa ${invoiceNumber}`
}

/**
 * Cotización sintética para sendQuoteToColppy con lo emitido: mismas líneas y
 * precios, bonificación 0 y pricesIncludeTax = B o "precios con IVA". La
 * condición IVA es la del momento de emitir (la letra salió de ahí).
 */
export function cotizacionSinteticaParaColppy(
  inv: {
    invoiceNumber: string
    currency: string
    exchangeRate: unknown
    customer: {
      name: string
      cuit: string
      taxCondition: string
      address?: string | null
      city?: string | null
      postalCode?: string | null
      province?: string | null
      phone?: string | null
      email?: string | null
    }
  },
  lineas: LineaFacturaDirectaGuardada[],
  fila: { id: string; mlPackId: string | null; pedido: PedidoFacturaDirectaGuardado }
): CotizacionColppy {
  const p = fila.pedido
  const referencia = referenciaColppyDirecta(inv.invoiceNumber, fila.mlPackId)
  return {
    id: `directa-${fila.id}`,
    quoteNumber: inv.invoiceNumber,
    currency: inv.currency,
    exchangeRate: inv.currency === 'USD' ? Number(inv.exchangeRate ?? p.tipoCambio) : null,
    bonification: 0,
    pricesIncludeTax: p.letra === 'B' || p.preciosConIva,
    customer: {
      name: inv.customer.name,
      cuit: inv.customer.cuit,
      taxCondition: p.cliente?.taxCondition ?? inv.customer.taxCondition,
      address: inv.customer.address ?? undefined,
      city: inv.customer.city ?? undefined,
      postalCode: inv.customer.postalCode ?? undefined,
      province: inv.customer.province ?? undefined,
      phone: inv.customer.phone ?? undefined,
      email: inv.customer.email ?? undefined,
    },
    items: lineas.map((l) => ({
      productName: l.descripcion,
      productSku: l.sku ?? '',
      quantity: l.cantidad,
      unitPrice: l.precioUnitario,
      comentario: l.comentario || referencia,
    })),
  }
}

async function crearEnColppy(payload: ColppyInvoicePayload) {
  let session = await getCachedColppySession()
  try {
    return await colppyCreateInvoice(session, payload)
  } catch (e) {
    if (!(e instanceof ColppySessionExpiredError)) throw e
    invalidateColppySessionCache()
    session = await getCachedColppySession()
    return colppyCreateInvoice(session, payload)
  }
}

async function estadoRegistroColppy(invoiceId: string): Promise<ResultadoRegistroColppy> {
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { colppyId: true, colppySyncStatus: true, colppySyncError: true } })
  if (!inv) return { ok: false, estado: 'ERROR', error: 'Factura no encontrada' }
  if (inv.colppyId) return { ok: true, estado: inv.colppySyncStatus === 'BORRADOR_FCE' ? 'BORRADOR_FCE' : 'OK', colppyId: inv.colppyId }
  if (inv.colppySyncStatus === 'REGISTRANDO') return { ok: false, estado: 'EN_CURSO', error: 'La factura se está registrando en Colppy en este momento' }
  if (inv.colppySyncStatus === 'NO_APLICA') {
    return { ok: false, estado: 'NO_APLICA', error: 'Esta factura no se registra en Colppy (FACTURACION_REGISTRAR_COLPPY=false al emitirla)' }
  }
  return { ok: false, estado: 'ERROR', error: inv.colppySyncError ?? `La factura no se puede registrar en Colppy (estado ${inv.colppySyncStatus ?? '-'})` }
}

/**
 * Registra en Colppy una factura directa ya emitida (Aprobada no electrónica,
 * con su número real; FCE como borrador). Nunca lanza.
 *  1. Toma el registro (PENDIENTE/ERROR, o REGISTRANDO de hace más de 15
 *     minutos → REGISTRANDO) para que dos pedidos no la den de alta dos veces.
 *  2. Con payload guardado (un intento anterior llegó a armarlo), lo reenvía.
 *  3. Si no, sendQuoteToColppy con la emisión "ya realizada" (no llama a ARCA)
 *     y la fecha del CAE.
 */
export async function registrarFacturaDirectaEnColppy(invoiceId: string): Promise<ResultadoRegistroColppy> {
  try {
    const tomada = await prisma.invoice.updateMany({
      where: {
        id: invoiceId,
        colppyId: null,
        OR: [
          { colppySyncStatus: { in: ['PENDIENTE', 'ERROR'] } },
          { colppySyncStatus: 'REGISTRANDO', updatedAt: { lt: new Date(Date.now() - REGISTRANDO_VENCE_MS) } },
        ],
      },
      data: { colppySyncStatus: 'REGISTRANDO', colppySyncError: null },
    })
    if (tomada.count !== 1) return estadoRegistroColppy(invoiceId)

    const inv = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        customer: {
          select: { id: true, name: true, cuit: true, taxCondition: true, address: true, city: true, postalCode: true, province: true, phone: true, email: true, colppyId: true },
        },
        facturaDirecta: true,
      },
    })
    if (!inv) return { ok: false, estado: 'ERROR', error: 'Factura no encontrada' }

    const fallo = async (error: string, payload?: ColppyInvoicePayload | null): Promise<ResultadoRegistroColppy> => {
      await prisma.invoice.update({
        where: { id: inv.id },
        data: {
          colppySyncStatus: 'ERROR',
          colppySyncError: error.slice(0, 2000),
          // Con el payload guardado, "Reintentar" lo reenvía tal cual
          ...(payload ? { colppyPayload: aJson(payload) } : {}),
        },
      })
      logger.error(`[Factura directa] No se pudo registrar ${inv.invoiceNumber} en Colppy: ${error}`)
      return { ok: false, estado: 'ERROR', error }
    }

    let payload = (inv.colppyPayload ?? null) as ColppyInvoicePayload | null
    let res: { idFactura: string; borradorFce?: boolean }
    const skus = inv.facturaDirecta ? pedidoGuardado(inv.facturaDirecta).lineas.map((l) => l.sku ?? '').filter(Boolean) : []
    try {
      if (payload) {
        // FCE MiPyME: el payload la lleva como borrador (ver colppyCreateInvoice)
        if ((inv.cbteTipo ?? 0) >= 201) payload.mipyme = true
        res = await crearEnColppy(payload)
      } else {
        if (!inv.facturaDirecta) return fallo('La factura no tiene payload de Colppy ni es una factura directa')
        const fila = inv.facturaDirecta
        const p = pedidoGuardado(fila)
        const r = await sendQuoteToColppy(
          {
            action: p.condicionPago === 'Contado' ? 'factura-contado' : 'factura-cuenta-corriente',
            condicionPago: p.condicionPago,
            descripcion: referenciaColppyDirecta(inv.invoiceNumber, fila.mlPackId),
            fechaFactura: inv.issueDate,
            emisionExterna: emisionYaRealizada(inv),
          },
          cotizacionSinteticaParaColppy(inv, p.lineas, { id: fila.id, mlPackId: fila.mlPackId, pedido: p })
        )
        if (!r.success || !r.facturaId) return fallo(r.error || 'error desconocido', r.colppyInvoicePayload)
        payload = r.colppyInvoicePayload ?? null
        res = { idFactura: r.facturaId, borradorFce: r.colppyBorradorFce }
      }
    } catch (e) {
      return fallo((e as Error).message, payload)
    }

    const estado = res.borradorFce ? 'BORRADOR_FCE' : 'OK'
    await prisma.invoice.update({
      where: { id: inv.id },
      data: {
        colppyId: res.idFactura,
        colppySyncStatus: estado,
        colppySyncError: null,
        notes: notaRegistroColppy(inv.notes, res),
        ...(payload ? { colppyPayload: aJson(payload) } : {}),
      },
    })
    // Id del cliente en Colppy ("Cliente Nro" del PDF), si el ERP no lo tenía
    if (payload?.idCliente && !inv.customer.colppyId) {
      await prisma.customer
        .update({ where: { id: inv.customer.id }, data: { colppyId: String(payload.idCliente) } })
        .catch((e) => logger.warn(`[Factura directa] No se pudo guardar el id de Colppy de ${inv.customer.name}: ${(e as Error).message}`))
    }
    if (skus.length) syncStockForSkusFireAndForget(skus, { quoteNumber: inv.invoiceNumber, action: 'factura-directa' })
    logger.info(`[Factura directa] ${inv.invoiceNumber} registrada en Colppy (${res.idFactura}${res.borradorFce ? ', borrador FCE' : ''})`)
    return { ok: true, estado, colppyId: res.idFactura }
  } catch (e) {
    logger.error(`[Factura directa] Error registrando la factura ${invoiceId} en Colppy: ${(e as Error).message}`)
    return { ok: false, estado: 'ERROR', error: (e as Error).message }
  }
}

// ---------------------------------------------------------------------------
// Reconciliación (scripts/factura-directa-reconciliar.ts)
// ---------------------------------------------------------------------------

// Las decisiones (qué número consultar, cuándo descartar, el candado de ML)
// están en factura-directa-reconciliacion.ts (puro, probado sin red).
export { compararConFacturaDirecta, tiposAReconciliar } from './factura-directa-reconciliacion'

// ---------------------------------------------------------------------------
// Pendientes (banner de la pantalla)
// ---------------------------------------------------------------------------

export interface PendienteFacturaDirecta {
  id: string
  /** INCIERTA (ARCA no confirmó), HUERFANA (CAE sin Invoice) o TRABADA (EMITIENDO que se cortó) */
  tipo: 'INCIERTA' | 'HUERFANA' | 'TRABADA'
  estado: string
  customerId: string
  cliente: string
  letra: string
  cbteTipo: number | null
  numero: string | null
  cae: string | null
  total: number
  currency: string
  mlPackId: string | null
  error: string | null
  createdAt: string
  mensaje: string
}

/** GET /api/facturas/directa/pendientes: las que hay que resolver con scripts/factura-directa-reconciliar.ts */
export async function listarPendientesFacturaDirecta(ahora = new Date()): Promise<PendienteFacturaDirecta[]> {
  const filas = await prisma.facturaDirecta.findMany({
    where: {
      OR: [
        { estado: ESTADO_DIRECTA.INCIERTA },
        { estado: ESTADO_DIRECTA.AUTORIZADA, invoiceId: null },
        { estado: ESTADO_DIRECTA.EMITIENDO, updatedAt: { lt: new Date(ahora.getTime() - EMITIENDO_TRABADA_MS) } },
      ],
    },
    include: { customer: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  })
  return filas.map((f) => {
    const tipo = f.estado === ESTADO_DIRECTA.INCIERTA ? 'INCIERTA' : f.estado === ESTADO_DIRECTA.AUTORIZADA ? 'HUERFANA' : 'TRABADA'
    const numero = f.puntoVenta && f.cbteNumero ? formatNroComprobante(f.puntoVenta, f.cbteNumero) : null
    const cbte = `${f.cbteTipo ? describeCbteTipo(f.cbteTipo) : `Factura ${f.letra}`}${numero ? ` ${numero}` : ''}`
    return {
      id: f.id,
      tipo,
      estado: f.estado,
      customerId: f.customerId,
      cliente: f.customer.name,
      letra: f.letra,
      cbteTipo: f.cbteTipo,
      numero,
      cae: f.cae,
      total: Number(f.total),
      currency: f.currency,
      mlPackId: f.mlPackId,
      error: f.error,
      createdAt: f.createdAt.toISOString(),
      mensaje:
        tipo === 'INCIERTA'
          ? `${cbte} a ${f.customer.name}: ARCA no confirmó la emisión. NO reintentes: revisalo con scripts/factura-directa-reconciliar.ts`
          : tipo === 'HUERFANA'
            ? `${cbte} a ${f.customer.name}: emitida en ARCA (CAE ${f.cae}) pero sin registrar en el ERP. NO reintentes: se registra con scripts/factura-directa-reconciliar.ts --apply`
            : `${cbte} a ${f.customer.name}: la emisión se cortó sin resultado. NO reintentes: revisala con scripts/factura-directa-reconciliar.ts`,
    }
  })
}
