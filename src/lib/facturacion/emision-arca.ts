/**
 * Emisión de facturas de venta desde el ERP (ARCA WSFE, PV 7) en lugar de
 * dejar que Colppy las emita. Colppy sigue siendo el libro de CC, stock y
 * contabilidad: la factura ya emitida se le carga como Aprobada no-electrónica.
 *
 * Flag: FACTURACION_EMISOR = 'arca' | 'colppy' (default 'colppy').
 *   - colppy: flujo histórico (borrador en Colppy, Colppy emite, el sync trae el CAE).
 *   - arca:   el ERP pide el CAE y registra la factura en Colppy ya emitida.
 *
 * Este módulo provee:
 *   - getEmisorFacturacion()
 *   - crearHookEmisionArca(): hook para SendToColppyOptions.emisionExterna
 *   - reintentarAltaColppy(invoiceId): reenvía a Colppy una factura emitida
 *     cuyo alta falló (colppySyncStatus PENDIENTE/ERROR).
 */
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import {
  EmisionExternaError,
  colppyCreateInvoice,
  getCachedColppySession,
  invalidateColppySessionCache,
  ColppySessionExpiredError,
  type ColppyInvoicePayload,
  type EmisionExternaDatos,
  type EmisionExternaResultado,
} from '@/lib/colppy'
import { isArcaConfigured, getArcaConfig } from '@/lib/arca/config'
import {
  EmisionInciertaError,
  EmisionNoSolicitadaError,
  cbteTipoFor,
  emitirComprobante,
  mensajeEmisionIncierta,
  receptorDesdeCondicion,
  type EmisionAutorizada,
  type EmisionResult,
} from '@/lib/arca/emitir'
import { DOC_TIPO, buildQrUrl } from '@/lib/arca/wsfe'

export type EmisorFacturacion = 'arca' | 'colppy'

export function getEmisorFacturacion(): EmisorFacturacion {
  const v = (process.env.FACTURACION_EMISOR || 'colppy').toLowerCase()
  if (v === 'arca') {
    if (!isArcaConfigured()) {
      logger.error('[Emisión] FACTURACION_EMISOR=arca pero falta configuración ARCA_*; se usa colppy')
      return 'colppy'
    }
    return 'arca'
  }
  return 'colppy'
}

export interface ClienteFiscal {
  name: string
  cuit: string | null
  taxCondition: string | null
  /** Cliente en el padrón ARCA de empresas grandes: factura A ≥ umbral sale como FCE */
  fceObligado?: boolean
  /**
   * Documento del receptor de una Factura B cuando no corresponde mandar el
   * CUIT (ventas ML a consumidores finales): CUIL (86), CDI (87) o DNI (96).
   * Solo se usa si la letra es B; los demás circuitos no lo pasan y el receptor
   * sale de receptorDesdeCondicion como siempre.
   */
  documentoReceptorB?: { docTipo: number; docNro: string }
}

/** Documentos aceptados para identificar al receptor de una Factura B */
const DOC_TIPOS_RECEPTOR_B: number[] = [DOC_TIPO.CUIT, DOC_TIPO.CUIL, DOC_TIPO.CDI, DOC_TIPO.DNI]

/**
 * Qué pasó con el pedido del CAE (null en getIntentoEmision = el hook nunca
 * llegó a llamar a ARCA: falló antes, p. ej. la letra o el documento).
 */
export interface IntentoEmisionArca {
  cbteTipo: number
  puntoVenta: number
  /** Número pedido a ARCA (null si no se llegó a saber) */
  numero: number | null
  /**
   * - 'en-curso': se llamó a ARCA y todavía no volvió (o se cortó sin aviso)
   * - 'autorizada': CAE otorgado
   * - 'rechazada': rechazo definitivo de ARCA (resultado.ok === false)
   * - 'no-solicitada': falló antes de pedir el CAE (WSAA, último número, detalle)
   * - 'incierta': se pidió el CAE y no se sabe si ARCA lo autorizó
   */
  estado: 'en-curso' | 'autorizada' | 'rechazada' | 'no-solicitada' | 'incierta'
  error?: string
}

/**
 * true si es seguro volver a intentar la emisión (liberar un candado): ARCA
 * nunca recibió el pedido o lo rechazó en forma definitiva. Con 'en-curso',
 * 'incierta' o 'autorizada' NO: podría salir un segundo comprobante.
 */
export function emisionDescartada(intento: IntentoEmisionArca | null): boolean {
  return !intento || intento.estado === 'rechazada' || intento.estado === 'no-solicitada'
}

/**
 * El pedido del CAE quedó sin confirmar ('incierta', o 'en-curso' si se cortó
 * sin aviso): ARCA pudo haberlo autorizado y reintentar puede sacar un segundo
 * comprobante.
 */
export function emisionIncierta(intento: IntentoEmisionArca | null): intento is IntentoEmisionArca {
  return !!intento && (intento.estado === 'incierta' || intento.estado === 'en-curso')
}

/**
 * Para los circuitos de cotizaciones (send-to-colppy, generate-invoice): si el
 * hook pidió el CAE y ARCA no lo confirmó, loguea [ARCA_INCIERTO] con el
 * número y devuelve el mensaje bloqueante para el usuario ("NO reintentes").
 * null si no aplica (emitida, rechazada, no solicitada o sin hook): quien llama
 * sigue con su manejo de siempre.
 */
export function avisoEmisionIncierta(hook: HookEmisionArca | null | undefined, contexto: Record<string, unknown> = {}): string | null {
  if (!hook || hook.getEmision()) return null
  const intento = hook.getIntentoEmision()
  if (!emisionIncierta(intento)) return null
  const mensaje = mensajeEmisionIncierta(intento)
  logger.error(`[ARCA_INCIERTO] ${mensaje}`, {
    ...contexto,
    cbteTipo: intento.cbteTipo,
    puntoVenta: intento.puntoVenta,
    numero: intento.numero,
    estado: intento.estado,
    error: intento.error ?? null,
  })
  return mensaje
}

export interface HookEmisionArca {
  hook: (datos: EmisionExternaDatos) => Promise<EmisionExternaResultado>
  /** Resultado completo de ARCA (null si todavía no se emitió o fue rechazada) */
  getEmision: () => EmisionAutorizada | null
  /** Pedido del CAE: null si el hook no llegó a llamar a ARCA (ver emisionDescartada) */
  getIntentoEmision: () => IntentoEmisionArca | null
  getQrUrl: () => string | null
  getReceptor: () => { docTipo: number; docNro: string } | null
  /** Vencimiento de pago informado a ARCA si el comprobante salió como FCE */
  getFceVtoPago: () => Date | null
}

/**
 * Crea el hook que sendQuoteToColppy invoca con los totales ya calculados.
 * Emite en ARCA; si es rechazada lanza EmisionExternaError (no se toca Colppy).
 */
export function crearHookEmisionArca(cliente: ClienteFiscal): HookEmisionArca {
  let emision: EmisionAutorizada | null = null
  let intento: IntentoEmisionArca | null = null
  let qrUrl: string | null = null
  let receptorUsado: { docTipo: number; docNro: string } | null = null
  let fceVtoPago: Date | null = null

  const hook = async (datos: EmisionExternaDatos): Promise<EmisionExternaResultado> => {
    const desdeCondicion = receptorDesdeCondicion(cliente.taxCondition, cliente.cuit)
    const letra = desdeCondicion.letra
    let receptor = desdeCondicion.receptor

    // Coherencia con Colppy: la letra la define la condición del cliente en
    // ambos lados (letraFacturaColppy). Si difieren no se emite: Colppy
    // quedaría con la letra equivocada y el número chocaría con el de la otra.
    if (letra !== datos.tipoFactura) {
      logger.error(`[Emisión ARCA] Letra ARCA=${letra} ≠ Colppy=${datos.tipoFactura} para ${cliente.name} (${cliente.cuit}, ${cliente.taxCondition})`)
      throw new EmisionExternaError(
        `La letra de la factura no coincide entre ARCA (${letra}) y Colppy (${datos.tipoFactura}) para la condición "${cliente.taxCondition}": no se emitió`
      )
    }
    if (cliente.documentoReceptorB && letra === 'B') {
      const { docTipo } = cliente.documentoReceptorB
      const docNro = String(cliente.documentoReceptorB.docNro).replace(/\D/g, '')
      if (!DOC_TIPOS_RECEPTOR_B.includes(docTipo) || !docNro || /^0+$/.test(docNro)) {
        throw new EmisionExternaError(`Documento del receptor inválido para Factura B (${docTipo} ${docNro || '-'})`)
      }
      receptor = { ...receptor, docTipo, docNro }
    }
    if (letra === 'A' && receptor.docNro.length !== 11) {
      throw new EmisionExternaError(`Factura A requiere CUIT válido del cliente (${cliente.name}: "${cliente.cuit}")`)
    }
    receptorUsado = { docTipo: receptor.docTipo, docNro: receptor.docNro }

    const esUsd = datos.currency === 'USD'

    // FCE MiPyME (RG 4367): cliente obligado (padrón de empresas grandes) +
    // factura A + total en ARS ≥ umbral vigente → sale como FCE (201) con
    // vencimiento de pago y CBU del emisor. Sin ARCA_CBU no se puede emitir.
    const cfg = getArcaConfig()
    const totalArs = esUsd ? datos.totalFactura * Number(datos.exchangeRate || 0) : datos.totalFactura
    const esFce = !!cliente.fceObligado && letra === 'A' && totalArs >= cfg.fceMontoMinimo
    if (esFce && !cfg.cbu) {
      throw new EmisionExternaError(
        `${cliente.name} está marcado como obligado a FCE MiPyME y el total (ARS ${Math.round(totalArs)}) supera el umbral, pero falta configurar ARCA_CBU en el servidor`
      )
    }
    if (esFce) {
      fceVtoPago = datos.fechaVto
      logger.info(`[Emisión ARCA] Factura a ${cliente.name} sale como FCE MiPyME (total ARS ${Math.round(totalArs)} ≥ ${cfg.fceMontoMinimo}), vto pago ${datos.fechaVto.toISOString().slice(0, 10)}`)
    }

    // Desde acá ARCA puede llegar a recibir el pedido: se registra el intento
    // para que quien llama sepa si puede reintentar (ver emisionDescartada)
    const pedido = { cbteTipo: cbteTipoFor(letra, 'FACTURA', esFce), puntoVenta: cfg.puntoVenta, numero: null }
    intento = { ...pedido, estado: 'en-curso' }
    let resultado: EmisionResult
    try {
      resultado = await emitirComprobante({
        clase: 'FACTURA',
        letra, // ya validada contra Colppy: 'A' | 'B'
        fce: esFce ? { vtoPago: datos.fechaVto, cbu: cfg.cbu!, transmision: 'SCA' } : undefined,
        fecha: datos.fechaFactura,
        receptor,
        moneda: esUsd ? 'USD' : 'ARS',
        cotizacion: esUsd ? Number(datos.exchangeRate) : undefined,
        cancelaEnMonedaExtranjera: false,
        importes: {
          netoGravado: datos.netoGravado,
          netoNoGravado: 0,
          exento: 0,
          iva: [{ alicuota: '21', baseImponible: datos.netoGravado, importe: datos.totalIVA }],
          total: datos.totalFactura,
        },
      })
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      intento =
        e instanceof EmisionNoSolicitadaError
          ? { ...pedido, cbteTipo: e.cbteTipo, puntoVenta: e.puntoVenta, estado: 'no-solicitada', error }
          : e instanceof EmisionInciertaError
            ? { cbteTipo: e.cbteTipo, puntoVenta: e.puntoVenta, numero: e.numero, estado: 'incierta', error }
            : // Cualquier otro error después de llamar a ARCA: no se sabe qué pasó
              { ...pedido, estado: 'incierta', error }
      throw e
    }

    if (!resultado.ok) {
      intento = { cbteTipo: resultado.cbteTipo, puntoVenta: resultado.puntoVenta, numero: resultado.numero, estado: 'rechazada', error: resultado.mensaje }
      throw new EmisionExternaError(`ARCA rechazó el comprobante: ${resultado.mensaje}`, resultado.errores)
    }

    intento = { cbteTipo: resultado.cbteTipo, puntoVenta: resultado.puntoVenta, numero: resultado.numero, estado: 'autorizada' }
    emision = resultado
    qrUrl = buildQrUrl({
      fecha: resultado.fecha,
      cuit: getArcaConfig().cuit,
      ptoVta: resultado.puntoVenta,
      tipoCmp: resultado.cbteTipo,
      nroCmp: resultado.numero,
      importe: datos.totalFactura,
      moneda: esUsd ? 'DOL' : 'PES',
      ctz: esUsd ? Number(datos.exchangeRate) : 1,
      tipoDocRec: receptor.docTipo,
      nroDocRec: receptor.docNro,
      codAut: resultado.cae,
    })

    return {
      puntoVenta: resultado.puntoVenta,
      numero: resultado.numero,
      numeroFormateado: resultado.numeroFormateado,
      cbteTipo: resultado.cbteTipo,
      cae: resultado.cae,
      caeVencimiento: resultado.caeVencimiento,
    }
  }

  return {
    hook,
    getEmision: () => emision,
    getIntentoEmision: () => intento,
    getQrUrl: () => qrUrl,
    getReceptor: () => receptorUsado,
    getFceVtoPago: () => fceVtoPago,
  }
}

/**
 * Reintenta el alta en Colppy de una factura ya emitida por el ERP cuyo
 * registro falló. Idempotente: si ya tiene colppyId no hace nada.
 */
export async function reintentarAltaColppy(invoiceId: string): Promise<{ ok: boolean; colppyId?: string; error?: string; borradorFce?: boolean }> {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, invoiceNumber: true, colppyId: true, colppyPayload: true, emitidaPor: true, colppySyncStatus: true, cbteTipo: true, notes: true },
  })
  if (!inv) return { ok: false, error: 'Factura no encontrada' }
  if (inv.emitidaPor !== 'ARCA') return { ok: false, error: 'La factura no fue emitida por el ERP' }
  if (inv.colppyId) return { ok: true, colppyId: inv.colppyId }
  // Factura E (exportación): se carga a mano en Colppy y se vincula pegando el id
  if (inv.colppySyncStatus === 'MANUAL') {
    return { ok: false, error: 'Esta factura se carga a mano en Colppy: cargala allá y pegá el id de Colppy en la factura' }
  }
  if (!inv.colppyPayload) return { ok: false, error: 'La factura no tiene payload de Colppy guardado' }

  const payload = inv.colppyPayload as unknown as ColppyInvoicePayload
  // FCE MiPyME: payloads guardados antes del fix no traen el flag
  if ((inv.cbteTipo ?? 0) >= 201) payload.mipyme = true
  try {
    let session = await getCachedColppySession()
    let res
    try {
      res = await colppyCreateInvoice(session, payload)
    } catch (e) {
      if (e instanceof ColppySessionExpiredError) {
        invalidateColppySessionCache()
        session = await getCachedColppySession()
        res = await colppyCreateInvoice(session, payload)
      } else {
        throw e
      }
    }
    await prisma.invoice.update({
      where: { id: inv.id },
      data: {
        colppyId: res.idFactura,
        colppySyncStatus: res.borradorFce ? 'BORRADOR_FCE' : 'OK',
        colppySyncError: null,
        // La nota de la emisión decía "PENDIENTE de registrar en Colppy."
        notes: (inv.notes ?? '').replace(
          'PENDIENTE de registrar en Colppy.',
          res.borradorFce
            ? `Borrador FCE en Colppy (${res.idFactura}): tildar FCE MiPyME y aprobar.`
            : `Registrada en Colppy (${res.idFactura}).`
        ),
      },
    })
    await prisma.cotizacionFactura.updateMany({
      where: { invoiceId: inv.id },
      data: { colppyInvoiceId: res.idFactura },
    })
    logger.info(`[Emisión ARCA] Reintento OK: ${inv.invoiceNumber} → Colppy ${res.idFactura}`)
    return { ok: true, colppyId: res.idFactura, borradorFce: !!res.borradorFce }
  } catch (e) {
    const msg = (e as Error).message
    await prisma.invoice.update({
      where: { id: inv.id },
      data: { colppySyncStatus: 'ERROR', colppySyncError: msg.slice(0, 2000) },
    })
    logger.error(`[Emisión ARCA] Reintento falló para ${inv.invoiceNumber}: ${msg}`)
    return { ok: false, error: msg }
  }
}
