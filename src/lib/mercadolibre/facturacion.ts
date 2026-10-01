/**
 * Facturación de ventas de Mercado Libre desde el ERP.
 *
 * Circuito (mismo que las facturas de cotizaciones con FACTURACION_EMISOR=arca):
 *   orden ML → CAE en ARCA (PV 7) → alta en Colppy como Aprobada (CC, stock,
 *   asiento) → Invoice en el ERP → PDF subido al pack de ML.
 *
 * Alcance actual (pedido de Santiago, 2026-09-30): SOLO compradores Responsables
 * Inscriptos (Factura A). Los consumidores finales siguen por Colppy.
 *
 * Datos fiscales del comprador: los da ML (billing-info) si la app tiene el
 * permiso "Facturación"; si no, se carga el CUIT a mano. En ambos casos la
 * condición frente al IVA se valida contra el padrón de ARCA antes de emitir.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { sendQuoteToColppy } from '@/lib/colppy'
import { syncStockForSkusFireAndForget } from '@/lib/colppy-inventory'
import { normalizeCuit, buildCuitWhereClause } from '@/lib/cuit-utils'
import { consultarPersona } from '@/lib/arca/padron'
import { crearHookEmisionArca, getEmisorFacturacion, type HookEmisionArca } from '@/lib/facturacion/emision-arca'
import { buildFacturaPdfData } from '@/lib/facturacion/factura-pdf-data'
import { generateFacturaPDF, facturaPdfFilename } from '@/lib/pdf/factura-generator'
import {
  MlApiError,
  getBuyerFiscal,
  getPack,
  getPackFiscalDocuments,
  getSaleOrder,
  searchPaidOrdersSince,
  uploadPackFiscalDocument,
  type MlBuyerFiscal,
  type MlSaleOrder,
} from './client'

/** Ventas anteriores a esta fecha ya se facturaron por Colppy (corte del PV 7). */
export function facturacionMlDesde(): Date {
  return new Date(process.env.ML_FACTURACION_DESDE || '2026-10-01T00:00:00-03:00')
}

export class FacturacionMlError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message)
  }
}

const esRI = (taxpayerType: string | null) => !!taxpayerType && /responsable\s+inscripto/i.test(taxpayerType)

const packKeyDe = (o: MlSaleOrder) => String(o.pack_id ?? o.id)

function cuitDeFiscal(f: MlBuyerFiscal | null): string | null {
  if (!f?.docNumber) return null
  if (f.docType && !/CUIT|CUIL/i.test(f.docType)) return null
  return normalizeCuit(f.docNumber)
}

/** Mapea concurrencia acotada (las llamadas a ML son de a una por venta). */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++
        out[idx] = await fn(items[idx])
      }
    })
  )
  return out
}

// ---------------------------------------------------------------------------
// Listado
// ---------------------------------------------------------------------------

export interface VentaMlItem {
  mlItemId: string
  title: string
  quantity: number
  unitPrice: number // final, con IVA
  sku: string | null // SKU del ERP si la publicación está vinculada
  productName: string | null
}

export interface VentaMl {
  packId: string
  orderIds: string[]
  fecha: string
  buyerNickname: string | null
  total: number
  items: VentaMlItem[]
  /** null = ML no entregó los datos fiscales (falta el permiso o error) */
  fiscal: MlBuyerFiscal | null
  fiscalError: string | null
  cuit: string | null
  /** Ya tiene una factura adjunta en ML (p. ej. emitida por Colppy) */
  facturaEnMl: boolean
  /** Facturada desde el ERP */
  facturada: null | {
    invoiceId: string | null
    invoiceNumber: string | null
    status: string
    mlUploadStatus: string | null
    mlUploadError: string | null
    colppySyncStatus: string | null
  }
}

export interface ListadoVentasMl {
  desde: string
  ventas: VentaMl[]
  /** true si ML respondió 403 a billing-info: hay que habilitar el permiso */
  sinPermisoFiscal: boolean
  excluidasNoRI: number
}

export async function listarVentasMl(): Promise<ListadoVentasMl> {
  const desde = facturacionMlDesde()
  const orders = await searchPaidOrdersSince(desde)

  // Agrupar por pack (un carrito con varios productos = varias órdenes, una factura)
  const grupos = new Map<string, MlSaleOrder[]>()
  for (const o of orders) {
    const k = packKeyDe(o)
    grupos.set(k, [...(grupos.get(k) ?? []), o])
  }
  const keys = Array.from(grupos.keys())

  const itemIds = Array.from(new Set(orders.flatMap((o) => o.order_items.map((i) => i.item.id))))
  const [registros, links] = await Promise.all([
    prisma.mlOrderInvoice.findMany({
      where: { packId: { in: keys } },
      include: { invoice: { select: { id: true, invoiceNumber: true, colppySyncStatus: true } } },
    }),
    prisma.mlItemLink.findMany({
      where: { mlItemId: { in: itemIds }, status: 'LINKED', productId: { not: null } },
      select: { mlItemId: true, product: { select: { sku: true, name: true } } },
    }),
  ])
  const regPorPack = new Map(registros.map((r) => [r.packId, r]))
  const linkPorItem = new Map(links.map((l) => [l.mlItemId, l.product]))

  let sinPermisoFiscal = false
  let excluidasNoRI = 0

  const ventas = await mapLimit(keys, 4, async (packId): Promise<VentaMl | null> => {
    const ords = grupos.get(packId)!
    const reg = regPorPack.get(packId)
    const first = ords[0]

    let fiscal: MlBuyerFiscal | null = null
    let fiscalError: string | null = null
    let facturaEnMl = false
    if (!reg) {
      try {
        fiscal = await getBuyerFiscal(first)
      } catch (e) {
        if (e instanceof MlApiError && e.status === 403) {
          sinPermisoFiscal = true
          fiscalError = 'ML no habilitó los datos fiscales (permiso "Facturación")'
        } else {
          fiscalError = (e as Error).message
        }
      }
      // Solo Responsables Inscriptos (si ML informa la condición)
      if (fiscal && !esRI(fiscal.taxpayerType)) {
        excluidasNoRI++
        return null
      }
      try {
        facturaEnMl = (await getPackFiscalDocuments(packId)).length > 0
      } catch {
        // sin permiso o pack sin documentos: no bloquea
      }
    }

    return {
      packId,
      orderIds: ords.map((o) => String(o.id)),
      fecha: first.date_closed ?? first.date_created ?? '',
      buyerNickname: first.buyer?.nickname ?? null,
      total: Math.round(ords.reduce((s, o) => s + Number(o.total_amount ?? 0), 0) * 100) / 100,
      items: ords.flatMap((o) =>
        o.order_items.map((it) => {
          const p = linkPorItem.get(it.item.id)
          return {
            mlItemId: it.item.id,
            title: it.item.title ?? it.item.id,
            quantity: it.quantity,
            unitPrice: Number(it.unit_price),
            sku: p?.sku ?? null,
            productName: p?.name ?? null,
          }
        })
      ),
      fiscal,
      fiscalError,
      cuit: reg?.cuit ?? cuitDeFiscal(fiscal),
      facturaEnMl,
      facturada: reg
        ? {
            invoiceId: reg.invoice?.id ?? null,
            invoiceNumber: reg.invoice?.invoiceNumber ?? null,
            status: reg.status,
            mlUploadStatus: reg.mlUploadStatus,
            mlUploadError: reg.mlUploadError,
            colppySyncStatus: reg.invoice?.colppySyncStatus ?? null,
          }
        : null,
    }
  })

  return {
    desde: desde.toISOString(),
    ventas: ventas.filter((v): v is VentaMl => v !== null),
    sinPermisoFiscal,
    excluidasNoRI,
  }
}

// ---------------------------------------------------------------------------
// Emisión
// ---------------------------------------------------------------------------

export interface ResultadoFacturaMl {
  invoiceId: string
  invoiceNumber: string
  cae: string
  colppyPendiente: boolean
  mlUpload: { ok: boolean; error?: string }
}

async function ordenesDelPack(packId: string): Promise<MlSaleOrder[]> {
  try {
    const pack = await getPack(packId)
    return Promise.all(pack.orders.map((o) => getSaleOrder(o.id)))
  } catch (e) {
    // Venta sin pack: la clave es el id de la orden
    if (e instanceof MlApiError && (e.status === 404 || e.status === 400)) return [await getSaleOrder(packId)]
    throw e
  }
}

export async function facturarVentaMl(params: {
  packId: string
  cuitManual?: string | null
  user: { id: string }
}): Promise<ResultadoFacturaMl> {
  const { packId, user } = params

  if (getEmisorFacturacion() !== 'arca') {
    throw new FacturacionMlError('La emisión propia (ARCA PV 7) no está activa en el servidor', 503)
  }

  const orders = await ordenesDelPack(packId)
  const noPagas = orders.filter((o) => o.status !== 'paid')
  if (noPagas.length) {
    throw new FacturacionMlError(`La venta tiene órdenes que no están pagas (${noPagas.map((o) => `${o.id}: ${o.status}`).join(', ')})`)
  }

  // CUIT: el que informa ML; si ML no lo da, el cargado a mano
  let fiscal: MlBuyerFiscal | null = null
  try {
    fiscal = await getBuyerFiscal(orders[0])
  } catch (e) {
    logger.warn(`[ML Facturación] Sin datos fiscales de ML para ${packId}: ${(e as Error).message}`)
  }
  const cuit = cuitDeFiscal(fiscal) ?? normalizeCuit(params.cuitManual)
  if (!cuit) throw new FacturacionMlError('Falta el CUIT del comprador (ML no lo informó): cargalo a mano')
  if (fiscal && !esRI(fiscal.taxpayerType)) {
    throw new FacturacionMlError(`ML informa al comprador como "${fiscal.taxpayerType}": por ahora solo se facturan Responsables Inscriptos`)
  }

  // La condición fiscal manda ARCA, no ML
  const persona = await consultarPersona(cuit)
  if (persona.condicionIva !== 'RESPONSABLE_INSCRIPTO') {
    throw new FacturacionMlError(`${persona.razonSocial} (${cuit}) no figura como Responsable Inscripto en ARCA (${persona.condicionIva ?? 'sin IVA'}): no se factura desde el ERP`)
  }
  if (!persona.activo) throw new FacturacionMlError(`El CUIT ${cuit} figura inactivo en ARCA`)

  // Candado contra doble facturación (packId unique)
  const total = Math.round(orders.reduce((s, o) => s + Number(o.total_amount ?? 0), 0) * 100) / 100
  try {
    await prisma.mlOrderInvoice.create({
      data: {
        packId,
        orderIds: orders.map((o) => String(o.id)),
        buyerNickname: orders[0].buyer?.nickname ?? null,
        cuit,
        total,
        createdById: user.id,
      },
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new FacturacionMlError('Esta venta ya fue facturada (o se está facturando en este momento)', 409)
    }
    throw e
  }

  const liberarCandado = () => prisma.mlOrderInvoice.delete({ where: { packId } }).catch(() => undefined)
  let hookArca: HookEmisionArca | null = null

  try {
    // Cliente: el del ERP o alta con los datos del padrón
    let customer = await prisma.customer.findFirst({ where: buildCuitWhereClause(cuit) })
    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          name: persona.razonSocial,
          businessName: persona.razonSocial,
          type: persona.tipoPersona === 'JURIDICA' ? 'BUSINESS' : 'INDIVIDUAL',
          cuit,
          taxCondition: 'RESPONSABLE_INSCRIPTO',
          address: persona.domicilio.direccion || null,
          city: persona.domicilio.localidad || null,
          province: persona.domicilio.provincia || null,
          postalCode: persona.domicilio.codigoPostal || null,
          notes: `Alta automática desde venta de Mercado Libre #${packId}`,
        },
      })
      logger.info(`[ML Facturación] Cliente creado desde ARCA: ${customer.name} (${cuit})`)
    } else if (customer.taxCondition !== 'RESPONSABLE_INSCRIPTO') {
      customer = await prisma.customer.update({ where: { id: customer.id }, data: { taxCondition: 'RESPONSABLE_INSCRIPTO' } })
    }

    // Productos: SKU del ERP si la publicación está vinculada
    const itemIds = Array.from(new Set(orders.flatMap((o) => o.order_items.map((i) => i.item.id))))
    const links = await prisma.mlItemLink.findMany({
      where: { mlItemId: { in: itemIds }, status: 'LINKED', productId: { not: null } },
      select: { mlItemId: true, product: { select: { id: true, sku: true, name: true } } },
    })
    const linkPorItem = new Map(links.map((l) => [l.mlItemId, l.product!]))
    const lineas = orders.flatMap((o) =>
      o.order_items.map((it) => {
        const p = linkPorItem.get(it.item.id)
        return {
          productId: p?.id ?? null,
          productName: p?.name ?? it.item.title ?? it.item.id,
          productSku: p?.sku ?? '',
          quantity: it.quantity,
          unitPrice: Number(it.unit_price), // final con IVA (pricesIncludeTax)
        }
      })
    )

    const referencia = `Venta Mercado Libre #${packId}`
    hookArca = crearHookEmisionArca({
      name: customer.name,
      cuit,
      taxCondition: 'RESPONSABLE_INSCRIPTO',
      fceObligado: customer.fceObligado,
    })

    const colppyResult = await sendQuoteToColppy(
      {
        action: 'factura-contado',
        condicionPago: 'Contado',
        descripcion: referencia,
        emisionExterna: hookArca.hook,
      },
      {
        id: `ml-${packId}`,
        quoteNumber: `ML ${packId}`,
        currency: 'ARS',
        exchangeRate: null,
        bonification: 0,
        pricesIncludeTax: true,
        customer: {
          name: customer.name,
          cuit,
          taxCondition: 'RESPONSABLE_INSCRIPTO',
          address: customer.address ?? undefined,
          phone: customer.phone ?? undefined,
          email: customer.email ?? undefined,
        },
        items: lineas.map((l) => ({
          productName: l.productName,
          productSku: l.productSku,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          comentario: referencia,
        })),
      }
    )

    const emision = hookArca.getEmision()
    if (!colppyResult.success && !emision) {
      const prefix = colppyResult.errorStage === 'arca' ? 'ARCA rechazó la factura' : 'Error al registrar en Colppy'
      throw new FacturacionMlError(`${prefix}: ${colppyResult.error}`, colppyResult.errorStage === 'arca' ? 422 : 500)
    }
    const emitida = emision!
    const colppyPendiente = !colppyResult.success
    if (colppyPendiente) {
      logger.error('[ARCA_SIN_COLPPY] Venta ML emitida en ARCA pero el alta en Colppy falló', {
        packId,
        numero: emitida.numeroFormateado,
        cae: emitida.cae,
        error: colppyResult.error,
      })
    }

    const payload = colppyResult.colppyInvoicePayload
    const invoiceType = [1, 201].includes(emitida.cbteTipo) ? 'A' : 'B'
    const invoiceNumber = `${emitida.cbteTipo >= 201 ? 'FCE' : ''}${invoiceType}-${emitida.numeroFormateado}`
    const now = new Date()

    let invoiceId: string
    try {
      invoiceId = await prisma.$transaction(async (tx) => {
        const inv = await tx.invoice.create({
          data: {
            invoiceNumber,
            invoiceType,
            transactionType: 'SALE',
            customerId: customer!.id,
            userId: user.id,
            status: 'AUTHORIZED',
            currency: 'ARS',
            colppyId: colppyResult.facturaId || null,
            subtotal: payload ? Number(payload.netoGravado) : total / 1.21,
            taxAmount: payload ? Number(payload.totalIVA) : total - total / 1.21,
            discount: 0,
            total: payload ? Number(payload.totalFactura) : total,
            balance: payload ? Number(payload.totalFactura) : total,
            issueDate: now,
            dueDate: now,
            notes: `${referencia}. Emitida por el ERP (ARCA) el ${now.toLocaleString('es-AR')}. CAE ${emitida.cae}. ${colppyPendiente ? 'PENDIENTE de registrar en Colppy.' : `Registrada en Colppy (${colppyResult.facturaId}).`}`,
            afipStatus: 'APPROVED',
            paymentStatus: 'UNPAID',
            emitidaPor: 'ARCA',
            pointOfSale: emitida.puntoVenta,
            cbteTipo: emitida.cbteTipo,
            cbteNumero: emitida.numero,
            cae: emitida.cae,
            caeExpiration: emitida.caeVencimiento,
            docTipo: hookArca!.getReceptor()?.docTipo ?? null,
            docNro: hookArca!.getReceptor()?.docNro ?? null,
            qrUrl: hookArca!.getQrUrl(),
            fceVtoPago: hookArca!.getFceVtoPago(),
            arcaObservaciones: emitida.observaciones.length
              ? emitida.observaciones.map((o) => `[${o.Code}] ${o.Msg}`).join(' · ')
              : null,
            colppySyncStatus: colppyPendiente ? 'PENDIENTE' : 'OK',
            colppySyncError: colppyPendiente ? (colppyResult.error || 'error desconocido').slice(0, 2000) : null,
            colppyPayload: payload ? (JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue) : Prisma.JsonNull,
            items: {
              create: lineas.map((l) => ({
                productId: l.productId,
                sku: l.productSku || null,
                description: l.productName,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                discount: 0,
                taxRate: 21,
                subtotal: Math.round(l.unitPrice * l.quantity * 100) / 100,
              })),
            },
          },
        })
        await tx.mlOrderInvoice.update({
          where: { packId },
          data: { invoiceId: inv.id, status: 'EMITIDA' },
        })
        return inv.id
      })
    } catch (txError) {
      // La factura EXISTE en ARCA: el candado queda puesto (EMITIENDO) para no
      // re-emitir, y el log tiene todo para reconciliar a mano.
      logger.error('[ML_ORPHAN] Venta ML emitida en ARCA pero el ERP no pudo registrarla', {
        packId,
        numero: emitida.numeroFormateado,
        cae: emitida.cae,
        colppyId: colppyResult.facturaId,
        error: (txError as Error).message,
      })
      throw new FacturacionMlError(
        `La factura ${emitida.numeroFormateado} se emitió en ARCA (CAE ${emitida.cae}) pero el ERP no pudo registrarla. NO REINTENTES: avisá a soporte con ese número.`,
        500
      )
    }

    const skus = lineas.map((l) => l.productSku).filter(Boolean)
    if (skus.length) syncStockForSkusFireAndForget(skus, { quoteNumber: `ML ${packId}`, action: 'factura-ml' })

    const mlUpload = await subirFacturaAMl(packId)
    logger.info(`[ML Facturación] ${referencia} → ${invoiceNumber} CAE ${emitida.cae} (Colppy ${colppyPendiente ? 'PENDIENTE' : 'OK'}, ML ${mlUpload.ok ? 'OK' : 'ERROR'})`)

    return { invoiceId, invoiceNumber, cae: emitida.cae, colppyPendiente, mlUpload }
  } catch (e) {
    // Si ARCA no llegó a emitir, se libera el candado para poder reintentar.
    // Si emitió (p. ej. falló la persistencia), el candado queda: nunca re-emitir.
    if (!hookArca?.getEmision()) await liberarCandado()
    throw e
  }
}

// ---------------------------------------------------------------------------
// PDF → ML
// ---------------------------------------------------------------------------

/** Sube (o re-sube) el PDF de la factura al pack de ML. No lanza. */
export async function subirFacturaAMl(packId: string): Promise<{ ok: boolean; error?: string }> {
  const reg = await prisma.mlOrderInvoice.findUnique({ where: { packId } })
  if (!reg?.invoiceId) return { ok: false, error: 'La venta no tiene factura emitida desde el ERP' }
  try {
    const data = await buildFacturaPdfData(reg.invoiceId)
    if (!data) throw new Error('No se pudo armar el PDF de la factura')
    const pdf = await generateFacturaPDF(data)
    const { id } = await uploadPackFiscalDocument(packId, pdf, facturaPdfFilename(data))
    await prisma.mlOrderInvoice.update({
      where: { packId },
      data: { mlUploadStatus: 'OK', mlUploadError: null, mlFiscalDocumentId: id },
    })
    return { ok: true }
  } catch (e) {
    const msg = e instanceof MlApiError ? `${e.message} ${JSON.stringify(e.body).slice(0, 500)}` : (e as Error).message
    logger.error(`[ML Facturación] No se pudo subir la factura al pack ${packId}: ${msg}`)
    await prisma.mlOrderInvoice.update({
      where: { packId },
      data: { mlUploadStatus: 'ERROR', mlUploadError: msg.slice(0, 2000) },
    })
    return { ok: false, error: msg }
  }
}
