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
import { emitirComprobante, receptorDesdeCondicion, type EmisionAutorizada } from '@/lib/arca/emitir'
import { buildQrUrl } from '@/lib/arca/wsfe'

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
}

export interface HookEmisionArca {
  hook: (datos: EmisionExternaDatos) => Promise<EmisionExternaResultado>
  /** Resultado completo de ARCA (null si todavía no se emitió o fue rechazada) */
  getEmision: () => EmisionAutorizada | null
  getQrUrl: () => string | null
  getReceptor: () => { docTipo: number; docNro: string } | null
}

/**
 * Crea el hook que sendQuoteToColppy invoca con los totales ya calculados.
 * Emite en ARCA; si es rechazada lanza EmisionExternaError (no se toca Colppy).
 */
export function crearHookEmisionArca(cliente: ClienteFiscal): HookEmisionArca {
  let emision: EmisionAutorizada | null = null
  let qrUrl: string | null = null
  let receptorUsado: { docTipo: number; docNro: string } | null = null

  const hook = async (datos: EmisionExternaDatos): Promise<EmisionExternaResultado> => {
    const { letra, receptor } = receptorDesdeCondicion(cliente.taxCondition, cliente.cuit)

    // Coherencia con Colppy: la letra la define la condición del cliente en
    // ambos lados; si difieren, manda la fiscal (ARCA) y lo registramos.
    if (letra !== datos.tipoFactura) {
      logger.warn(`[Emisión ARCA] Letra ARCA=${letra} ≠ Colppy=${datos.tipoFactura} para ${cliente.name} (${cliente.cuit}, ${cliente.taxCondition})`)
    }
    if (letra === 'A' && receptor.docNro.length !== 11) {
      throw new EmisionExternaError(`Factura A requiere CUIT válido del cliente (${cliente.name}: "${cliente.cuit}")`)
    }
    receptorUsado = { docTipo: receptor.docTipo, docNro: receptor.docNro }

    const esUsd = datos.currency === 'USD'
    const resultado = await emitirComprobante({
      clase: 'FACTURA',
      letra: letra === 'C' ? 'B' : letra,
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

    if (!resultado.ok) {
      throw new EmisionExternaError(`ARCA rechazó el comprobante: ${resultado.mensaje}`, resultado.errores)
    }

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
    getQrUrl: () => qrUrl,
    getReceptor: () => receptorUsado,
  }
}

/**
 * Reintenta el alta en Colppy de una factura ya emitida por el ERP cuyo
 * registro falló. Idempotente: si ya tiene colppyId no hace nada.
 */
export async function reintentarAltaColppy(invoiceId: string): Promise<{ ok: boolean; colppyId?: string; error?: string }> {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, invoiceNumber: true, colppyId: true, colppyPayload: true, emitidaPor: true, colppySyncStatus: true },
  })
  if (!inv) return { ok: false, error: 'Factura no encontrada' }
  if (inv.emitidaPor !== 'ARCA') return { ok: false, error: 'La factura no fue emitida por el ERP' }
  if (inv.colppyId) return { ok: true, colppyId: inv.colppyId }
  if (!inv.colppyPayload) return { ok: false, error: 'La factura no tiene payload de Colppy guardado' }

  const payload = inv.colppyPayload as unknown as ColppyInvoicePayload
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
      data: { colppyId: res.idFactura, colppySyncStatus: 'OK', colppySyncError: null },
    })
    await prisma.cotizacionFactura.updateMany({
      where: { invoiceId: inv.id },
      data: { colppyInvoiceId: res.idFactura },
    })
    logger.info(`[Emisión ARCA] Reintento OK: ${inv.invoiceNumber} → Colppy ${res.idFactura}`)
    return { ok: true, colppyId: res.idFactura }
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
