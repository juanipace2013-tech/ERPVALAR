/**
 * Sincronización de facturas desde Colppy a la base local (tabla Invoice).
 * Lógica compartida entre POST /api/facturacion/sync-colppy (botón de la UI)
 * y scripts/sync-colppy-diario.ts (cron de las 9:00 en el VPS).
 *
 * - Pagina automáticamente TODOS los resultados de Colppy
 * - Importa FAV/NDV/NCV emitidas (ignora borradores y recibos)
 * - Crea facturas nuevas (por colppyId) y actualiza las existentes
 * - Auto-crea/vincula clientes por colppyId o CUIT
 */

import { prisma } from '@/lib/prisma'
import { getLocalDateString } from '@/lib/utils'
import {
  colppyLogin as colppyLoginCentral,
  getColppyConfig,
  md5Hash,
  callColppyAPI,
  fetchAllColppyPages,
  ColppyRateLimitError,
} from '@/lib/colppy'
import { mapColppyTaxCondition } from '@/lib/colppy-tax-map'
import { logger } from '@/lib/logger'

const PAGE_SIZE = 500

const { user: COLPPY_USER, password: COLPPY_PASSWORD, idEmpresa: COLPPY_ID_EMPRESA } = getColppyConfig()
const COLPPY_PASSWORD_MD5 = md5Hash(COLPPY_PASSWORD)

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function callColppyWithRetry(
  payload: unknown,
  getNewSession: () => Promise<{ claveSesion: string; passwordMD5: string }>,
  updatePayloadSession: (payload: unknown, claveSesion: string) => unknown
): Promise<Record<string, unknown>> {
  try {
    return await callColppyAPI<Record<string, unknown>>(payload, 120000)
  } catch (firstError: unknown) {
    // Rate limit agotado (el wrapper ya esperó y reintentó 3 veces):
    // re-loguearse no ayuda, propagar directo.
    if (firstError instanceof ColppyRateLimitError) throw firstError

    const msg = firstError instanceof Error ? firstError.message : ''
    logger.warn(`[Colppy] Primer intento falló: ${msg.substring(0, 200)}. Re-autenticando...`)

    const { claveSesion } = await getNewSession()
    const updatedPayload = updatePayloadSession(payload, claveSesion)
    await sleep(2000)
    return await callColppyAPI<Record<string, unknown>>(updatedPayload, 120000)
  }
}

async function localColppyLogin(): Promise<string> {
  const session = await colppyLoginCentral()
  logger.info(`[Sync Colppy] Login OK, sesión: ${session.claveSesion.substring(0, 8)}...`)
  return session.claveSesion
}

// Mapeos de Colppy
const tipoFacturaMap: Record<string, string> = {
  '0': 'A', '1': 'B', '2': 'C', '3': 'E', '4': 'M', '5': 'T',
}

// Mapeo CORRECTO de idTipoComprobante de Colppy:
// La letra (A/B/C/E) viene de idTipoFactura, NO del idTipoComprobante
// 4=FAV, 5=NDV, 8=NCV, 9=REC, 51=FAV MiPyme, 52=NDV MiPyme, 53=NCV MiPyme
const tipoComprobanteLabel: Record<string, string> = {
  '4': 'FAV',   // Factura de Venta A
  '5': 'NCV',   // Nota de Crédito Venta A (totales NEGATIVOS en Colppy)
  '8': 'NDV',   // Nota de Débito Venta A (totales POSITIVOS en Colppy)
  '9': 'REC',   // Recibo A (se ignora)
  '10': 'FAV',  // Factura de Venta B
  '11': 'NCV',  // Nota de Crédito Venta B
  '12': 'NDV',  // Nota de Débito Venta B
  '13': 'REC',  // Recibo B (se ignora)
  '51': 'FAV',  // Factura MiPyme
  '52': 'NDV',  // ND MiPyme
  '53': 'NCV',  // NC MiPyme
}

// Notas de Crédito (NCV) → transactionType = CREDIT_NOTE, RESTAN del total
const CREDIT_NOTE_TIPOS = new Set(['5', '11', '53'])

// Notas de Débito (NDV) → transactionType = DEBIT_NOTE, SUMAN al total
const DEBIT_NOTE_TIPOS = new Set(['8', '12', '52'])

function mapInvoiceType(idTipoFactura: string): 'A' | 'B' | 'C' | 'E' {
  const letter = tipoFacturaMap[idTipoFactura] || 'A'
  if (['A', 'B', 'C', 'E'].includes(letter)) return letter as 'A' | 'B' | 'C' | 'E'
  return 'A'
}

function mapInvoiceStatus(idEstadoFactura: string, saldo: number): string {
  if (idEstadoFactura === '5' || saldo <= 0) return 'PAID'
  return 'PENDING'
}

function mapPaymentStatus(idEstadoFactura: string, total: number, aplicado: number): string {
  if (idEstadoFactura === '5' || aplicado >= total) return 'PAID'
  if (aplicado > 0) return 'PARTIAL'
  return 'UNPAID'
}

interface ColppyClient {
  idCliente: string
  cuit: string
  name: string
  businessName: string
  taxCondition: string
  email: string
  phone: string
  address: string
  city: string
  province: string
}

async function fetchAllColppyClients(claveSesion: string, passwordMD5: string): Promise<ColppyClient[]> {
  try {
    // Paginado: un limit fijo corta silenciosamente el listado de clientes.
    const data = await fetchAllColppyPages<Record<string, unknown>>(async (start, limit) => {
      const payload = {
        auth: { usuario: COLPPY_USER, password: passwordMD5 },
        service: { provision: 'Cliente', operacion: 'listar_cliente' },
        parameters: {
          sesion: { usuario: COLPPY_USER, claveSesion },
          idEmpresa: COLPPY_ID_EMPRESA,
          start,
          limit,
          filter: [],
          order: [{ field: 'NombreFantasia', dir: 'asc' }],
        },
      }

      const response = await callColppyWithRetry(
        payload,
        async () => {
          const newSession = await localColppyLogin()
          return { claveSesion: newSession, passwordMD5 }
        },
        (p, newSession) => {
          const pl = p as typeof payload
          return { ...pl, parameters: { ...pl.parameters, sesion: { usuario: COLPPY_USER, claveSesion: newSession } } }
        }
      ) as { result?: { estado?: number }; response?: { success?: boolean; data?: Record<string, unknown>[] } }

      if (response.result?.estado !== 0 || !response.response?.success) {
        logger.warn('[Sync Colppy] Respuesta de clientes no exitosa:', response.result)
        throw new Error('Respuesta de clientes no exitosa')
      }

      return response.response.data || []
    })

    return data.map((c: Record<string, unknown>) => ({
      idCliente: String(c.idCliente || ''),
      cuit: String(c.CUIT || ''),
      name: String(c.NombreFantasia || c.RazonSocial || ''),
      businessName: String(c.RazonSocial || ''),
      taxCondition: mapColppyTaxCondition(c.idCondicionIva, `CUIT ${c.CUIT}`).taxCondition,
      email: String(c.Email || ''),
      phone: String(c.Telefono || ''),
      address: String(c.DirPostal || ''),
      city: String(c.DirPostalCiudad || ''),
      province: String(c.DirPostalProvincia || ''),
    }))
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown'
    logger.error(`[Sync Colppy] Error cargando clientes: ${msg.substring(0, 300)}`)
    return []
  }
}

/**
 * Obtiene TODAS las facturas de Colppy paginando automáticamente.
 * Si una página falla después del retry, devuelve las facturas obtenidas hasta
 * ese punto en vez de fallar completamente (degradación graceful).
 */
async function fetchAllColppyFacturas(
  claveSesionInicial: string,
  passwordMD5: string,
  dateFromStr: string,
  dateToStr: string
): Promise<{ facturas: Record<string, unknown>[]; partial: boolean; error?: string }> {
  const allFacturas: Record<string, unknown>[] = []
  let start = 0
  let hasMore = true
  let currentSession = claveSesionInicial

  while (hasMore) {
    const payload = {
      auth: { usuario: COLPPY_USER, password: passwordMD5 },
      service: { provision: 'FacturaVenta', operacion: 'listar_facturasventa' },
      parameters: {
        sesion: { usuario: COLPPY_USER, claveSesion: currentSession },
        idEmpresa: COLPPY_ID_EMPRESA,
        start,
        limit: PAGE_SIZE,
        filter: [
          { field: 'fechaFactura', op: '>=', value: dateFromStr },
          { field: 'fechaFactura', op: '<=', value: dateToStr },
        ],
        order: { field: ['idFactura'], order: 'desc' },
      },
    }

    try {
      const response = await callColppyWithRetry(
        payload,
        async () => {
          currentSession = await localColppyLogin()
          return { claveSesion: currentSession, passwordMD5 }
        },
        (p, newSession) => {
          const pl = p as typeof payload
          currentSession = newSession
          return { ...pl, parameters: { ...pl.parameters, sesion: { usuario: COLPPY_USER, claveSesion: newSession } } }
        }
      ) as { result?: { estado?: number; mensaje?: string }; response?: { success?: boolean; data?: Record<string, unknown>[]; total?: number } }

      if (response.result?.estado !== 0 || !response.response?.success) {
        const errorMsg = response.result?.mensaje || 'Error al obtener facturas de Colppy'
        if (allFacturas.length > 0) {
          logger.warn(`[Sync Colppy] Error en página ${Math.floor(start / PAGE_SIZE) + 1}: ${errorMsg}. Devolviendo ${allFacturas.length} facturas parciales.`)
          return { facturas: allFacturas, partial: true, error: errorMsg }
        }
        throw new Error(errorMsg)
      }

      const pageData = response.response?.data || []
      allFacturas.push(...pageData)

      logger.info(`[Sync Colppy] Página ${Math.floor(start / PAGE_SIZE) + 1}: ${pageData.length} facturas (total acumulado: ${allFacturas.length})`)

      if (pageData.length < PAGE_SIZE) {
        hasMore = false
      } else {
        start += PAGE_SIZE
        // Delay entre páginas para evitar rate limit de Colppy
        await sleep(1000)
      }
    } catch (pageError: unknown) {
      const msg = pageError instanceof Error ? pageError.message : 'Error desconocido'
      if (allFacturas.length > 0) {
        logger.warn(`[Sync Colppy] Error en página ${Math.floor(start / PAGE_SIZE) + 1}: ${msg}. Devolviendo ${allFacturas.length} facturas parciales.`)
        return { facturas: allFacturas, partial: true, error: msg }
      }
      throw pageError
    }
  }

  return { facturas: allFacturas, partial: false }
}

/**
 * Busca el tipo de cambio USD→ARS para una fecha dada en la tabla ExchangeRate.
 * Cache por fecha para evitar queries repetidos durante la sync.
 */
const exchangeRateCache = new Map<string, number>()

async function getExchangeRateForDate(dateStr: string): Promise<number> {
  if (exchangeRateCache.has(dateStr)) return exchangeRateCache.get(dateStr)!

  const d = new Date(dateStr)
  const rate = await prisma.exchangeRate.findFirst({
    where: {
      fromCurrency: 'USD',
      toCurrency: 'ARS',
      validFrom: { lte: d },
      OR: [
        { validUntil: null },
        { validUntil: { gte: d } },
      ],
    },
    orderBy: { validFrom: 'desc' },
  })

  const value = rate ? Number(rate.rate) : 0
  exchangeRateCache.set(dateStr, value)
  return value
}

const DEFAULT_EXCHANGE_RATE = 1420

export interface SyncColppyResumen {
  totalColppy: number
  created: number
  updated: number
  skipped: number
  linkedToQuote: number
  customersCreated: number
  customersLinkedByCuit: number
  errors: number
  errorDetails: string[]
  skipReasons: Record<string, number>
  porTipoComprobante: Record<string, number>
  rangoFechas: { desde: string; hasta: string }
  partial?: boolean
  partialReason?: string
}

export async function syncColppyFacturas(dateFrom: Date, dateTo: Date): Promise<SyncColppyResumen> {
  const dateFromStr = getLocalDateString(dateFrom)
  const dateToStr = getLocalDateString(dateTo)

  logger.info(`[Sync Colppy] Sincronizando facturas desde ${dateFromStr} hasta ${dateToStr}...`)

  // 1. Login a Colppy
  const claveSesion = await localColppyLogin()
  const passwordMD5 = COLPPY_PASSWORD_MD5

  // 2. Fetch TODAS las facturas de Colppy con paginación (con degradación graceful)
  const fetchResult = await fetchAllColppyFacturas(claveSesion, passwordMD5, dateFromStr, dateToStr)
  const colppyFacturas = fetchResult.facturas
  const fetchPartial = fetchResult.partial
  logger.info(`[Sync Colppy] Total: ${colppyFacturas.length} facturas obtenidas de Colppy${fetchPartial ? ' (PARCIAL - sesión expirada)' : ''}`)

  // 3. Obtener mapeo de clientes Colppy -> local (múltiples estrategias)
  const customers = await prisma.customer.findMany({
    select: { id: true, colppyId: true, cuit: true, name: true },
  })
  const customerByColppyId = new Map<string, string>()
  const customerByCuit = new Map<string, string>()
  for (const c of customers) {
    if (c.colppyId) customerByColppyId.set(c.colppyId, c.id)
    if (c.cuit) customerByCuit.set(c.cuit.replace(/\D/g, ''), c.id)
  }
  logger.info(`[Sync Colppy] Clientes locales: ${customers.length} total, ${customerByColppyId.size} con colppyId, ${customerByCuit.size} con CUIT`)

  const colppyClients = await fetchAllColppyClients(claveSesion, passwordMD5)
  const colppyClientMap = new Map(colppyClients.map((c) => [c.idCliente, c]))
  logger.info(`[Sync Colppy] Clientes Colppy cargados: ${colppyClients.length}`)

  const systemUser = await prisma.user.findFirst({ select: { id: true } })
  if (!systemUser) {
    throw new Error('No hay usuarios en el sistema')
  }

  // Pre-cargar cotizaciones ACCEPTED/CONVERTED para vincular con facturas importadas
  const quotesForMatching = await prisma.quote.findMany({
    where: {
      status: { in: ['ACCEPTED', 'CONVERTED'] },
      date: { gte: dateFrom },
    },
    select: { id: true, customerId: true, total: true, salesPersonId: true },
    orderBy: { date: 'desc' },
  })
  const quotesByCustomer = new Map<string, typeof quotesForMatching>()
  for (const q of quotesForMatching) {
    const existing = quotesByCustomer.get(q.customerId) || []
    existing.push(q)
    quotesByCustomer.set(q.customerId, existing)
  }

  // 4. Limpiar datos no válidos de syncs anteriores
  try {
    const deletedREC = await prisma.invoice.deleteMany({
      where: { colppyId: { not: null }, notes: { startsWith: 'REC ' } },
    })
    if (deletedREC.count > 0) {
      logger.info(`[Sync Colppy] Eliminados ${deletedREC.count} recibos (REC) de syncs anteriores`)
    }

    // Eliminar borradores: nroFactura con números muy altos (ej: 83957509)
    // La numeración real de VAL ARG es 0003-13xxx y 0003-00001xxx
    const deletedDrafts = await prisma.invoice.deleteMany({
      where: {
        colppyId: { not: null },
        status: 'PENDING',
        AND: [
          { invoiceNumber: { not: { startsWith: '0003-0000' } } },
          // Nunca borrar los borradores creados por el ERP: al importarse la
          // factura emitida (mismo colppyId) pasan a PENDING y esta limpieza
          // los eliminaba, destruyendo los InvoiceItems que vinculan la
          // factura con los items de la cotización (caso VAL-2026-2331).
          { invoiceNumber: { not: { startsWith: 'BORRADOR-COLPPY-' } } },
        ],
      },
    })
    if (deletedDrafts.count > 0) {
      logger.info(`[Sync Colppy] Eliminados ${deletedDrafts.count} borradores de syncs anteriores`)
    }
  } catch (err) {
    logger.warn('[Sync Colppy] No se pudieron eliminar registros antiguos:', err instanceof Error ? err.message : err)
  }

  // 5. Procesar cada factura
  let created = 0
  let updated = 0
  let skipped = 0
  let linkedToQuote = 0
  let customersCreated = 0
  let customersLinkedByCuit = 0
  const errors: string[] = []
  const porTipoComprobante: Record<string, number> = {}
  const skipReasons: Record<string, number> = {}

  // Primera pasada: recolectar TCs de facturas USD para usar en facturas ARS
  const usdRatesByDate = new Map<string, number>()
  for (const f of colppyFacturas) {
    const rate = parseFloat(String(f.rate || '0'))
    if (rate > 1) {
      const fecha = String(f.fechaFactura || '').split(' ')[0]
      if (fecha) usdRatesByDate.set(fecha, rate)
    }
  }
  logger.info(`[Sync Colppy] TCs USD recolectados de ${usdRatesByDate.size} fechas distintas`)

  function findClosestUsdRate(dateStr: string): number {
    if (usdRatesByDate.has(dateStr)) return usdRatesByDate.get(dateStr)!
    const target = new Date(dateStr).getTime()
    let closestRate = 0
    let minDiff = Infinity
    for (const [d, r] of usdRatesByDate) {
      const diff = Math.abs(new Date(d).getTime() - target)
      if (diff < minDiff) {
        minDiff = diff
        closestRate = r
      }
    }
    return closestRate || DEFAULT_EXCHANGE_RATE
  }

  for (const f of colppyFacturas) {
    const idFactura = String(f.idFactura || '')
    if (!idFactura) {
      skipReasons['sin_idFactura'] = (skipReasons['sin_idFactura'] || 0) + 1
      skipped++; continue
    }

    // Solo importar facturas EMITIDAS (idEstadoFactura=3 o 5=pagada)
    const idEstado = String(f.idEstadoFactura || '')
    if (idEstado !== '3' && idEstado !== '5') {
      skipReasons[`estado_${idEstado}`] = (skipReasons[`estado_${idEstado}`] || 0) + 1
      skipped++; continue
    }

    // Tipos aceptados: FAV(4,10,51), NCV(5,11,53), NDV(8,12,52). Ignorados: REC(9,13)
    const tipoComp = String(f.idTipoComprobante || '4')
    const tiposVenta = ['4', '5', '8', '10', '11', '12', '51', '52', '53']
    if (!tiposVenta.includes(tipoComp)) {
      skipReasons[`tipo_${tipoComp}`] = (skipReasons[`tipo_${tipoComp}`] || 0) + 1
      skipped++; continue
    }

    const idCliente = String(f.idCliente || '')

    // Estrategia de matching de cliente: 1) colppyId, 2) CUIT, 3) auto-crear
    let localCustomerId = customerByColppyId.get(idCliente)

    if (!localCustomerId) {
      const colppyClient = colppyClientMap.get(idCliente)
      if (colppyClient?.cuit) {
        const cuitClean = colppyClient.cuit.replace(/\D/g, '')
        const matchedByCuit = customerByCuit.get(cuitClean)
        if (matchedByCuit) {
          localCustomerId = matchedByCuit
          customersLinkedByCuit++
          await prisma.customer.update({
            where: { id: matchedByCuit },
            data: { colppyId: idCliente },
          })
          customerByColppyId.set(idCliente, matchedByCuit)
        }
      }
    }

    if (!localCustomerId) {
      // Auto-crear cliente desde datos de Colppy
      const colppyClient = colppyClientMap.get(idCliente)
      if (colppyClient && colppyClient.cuit) {
        try {
          const upsertedCustomer = await prisma.customer.upsert({
            where: { cuit: colppyClient.cuit },
            update: {
              colppyId: idCliente,
              businessName: colppyClient.businessName || undefined,
              email: colppyClient.email || undefined,
              phone: colppyClient.phone || undefined,
              address: colppyClient.address || undefined,
              city: colppyClient.city || undefined,
              province: colppyClient.province || undefined,
            },
            create: {
              name: colppyClient.name || colppyClient.businessName || `Cliente Colppy ${idCliente}`,
              businessName: colppyClient.businessName || null,
              cuit: colppyClient.cuit,
              taxCondition: colppyClient.taxCondition as 'RESPONSABLE_INSCRIPTO' | 'MONOTRIBUTO' | 'EXENTO' | 'CONSUMIDOR_FINAL',
              email: colppyClient.email || null,
              phone: colppyClient.phone || null,
              address: colppyClient.address || null,
              city: colppyClient.city || null,
              province: colppyClient.province || null,
              colppyId: idCliente,
              notes: 'Auto-creado desde sync Colppy',
            },
          })
          localCustomerId = upsertedCustomer.id
          customerByColppyId.set(idCliente, upsertedCustomer.id)
          customerByCuit.set(colppyClient.cuit.replace(/\D/g, ''), upsertedCustomer.id)
          customersCreated++
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Unknown error'
          skipReasons['cliente_crear_error'] = (skipReasons['cliente_crear_error'] || 0) + 1
          errors.push(`Factura ${idFactura}: Error creando/actualizando cliente ${colppyClient.name}: ${msg}`)
        }
      } else {
        skipReasons['sin_cliente_colppy'] = (skipReasons['sin_cliente_colppy'] || 0) + 1
      }
    }

    if (!localCustomerId) {
      skipped++
      continue
    }

    // Log de debug para NCV/NDV y facturas con total negativo
    const _totalDebug = parseFloat(String(f.totalFactura || '0'))
    const _labelDebug = tipoComprobanteLabel[tipoComp] || '?'
    if (_totalDebug < 0 || CREDIT_NOTE_TIPOS.has(tipoComp) || DEBIT_NOTE_TIPOS.has(tipoComp)) {
      logger.info(`[Sync Debug] ${String(f.nroFactura)} idTipoComprobante:${tipoComp} (${_labelDebug}) totalFactura:${_totalDebug} idMoneda:${String(f.idMoneda || 'null')} rate:${String(f.rate || 'null')} → ${CREDIT_NOTE_TIPOS.has(tipoComp) ? 'CREDIT_NOTE' : DEBIT_NOTE_TIPOS.has(tipoComp) ? 'DEBIT_NOTE' : 'SALE'}`)
    }

    // REGLA DEFINITIVA de moneda: rate > 1 → USD (el rate es el TC); rate 0/1/null → ARS
    const rawRate = parseFloat(String(f.rate || '0'))
    const esUSD = rawRate > 1

    // Colppy devuelve totalFactura SIEMPRE en ARS (moneda fiscal).
    const totalFacturaARS = parseFloat(String(f.totalFactura || '0'))
    const aplicadoARS = parseFloat(String(f.totalaplicado || '0'))
    const netoGravadoARS = parseFloat(String(f.netoGravado || '0'))
    const totalIVAARS = parseFloat(String(f.totalIVA || '0'))
    const fechaFactura = String(f.fechaFactura || getLocalDateString()).split(' ')[0]

    let monedaCode: string
    let tipoCambio: number
    let total: number
    let aplicado: number
    let subtotalVal: number
    let taxAmountVal: number

    if (esUSD) {
      monedaCode = 'USD'
      tipoCambio = rawRate
      total = Math.round((totalFacturaARS / tipoCambio) * 100) / 100
      aplicado = Math.round((aplicadoARS / tipoCambio) * 100) / 100
      subtotalVal = Math.round((netoGravadoARS / tipoCambio) * 100) / 100
      taxAmountVal = Math.round((totalIVAARS / tipoCambio) * 100) / 100
    } else {
      monedaCode = 'ARS'
      total = totalFacturaARS
      aplicado = aplicadoARS
      subtotalVal = netoGravadoARS
      taxAmountVal = totalIVAARS
      const tcDelDia = await getExchangeRateForDate(fechaFactura)
      tipoCambio = tcDelDia > 0 ? tcDelDia : findClosestUsdRate(fechaFactura)
    }

    const esNotaCredito = CREDIT_NOTE_TIPOS.has(tipoComp)
    const esNotaDebito = DEBIT_NOTE_TIPOS.has(tipoComp)

    // REGLA DE NEGOCIO: NDV (Notas de Débito) SIEMPRE son en ARS
    // Son por diferencia de cambio y nunca en USD, sin importar rate/idMoneda
    if (esNotaDebito && monedaCode === 'USD') {
      logger.info(`[Sync] NDV ${String(f.nroFactura)} forzada a ARS (era USD con rate=${rawRate}). Total ARS: ${totalFacturaARS}`)
      monedaCode = 'ARS'
      total = totalFacturaARS
      aplicado = aplicadoARS
      subtotalVal = netoGravadoARS
      taxAmountVal = totalIVAARS
      const tcDelDia = await getExchangeRateForDate(fechaFactura)
      tipoCambio = tcDelDia > 0 ? tcDelDia : findClosestUsdRate(fechaFactura)
    }

    if (esNotaCredito) {
      // NCV: Colppy envía totalFactura NEGATIVO, guardamos positivo
      total = Math.abs(total)
      aplicado = Math.abs(aplicado)
      subtotalVal = Math.abs(subtotalVal)
      taxAmountVal = Math.abs(taxAmountVal)
    }

    const saldo = Math.max(0, total - aplicado)
    const tipoLetra = tipoFacturaMap[String(f.idTipoFactura || '0')] || 'A'
    const compLabel = tipoComprobanteLabel[tipoComp] || 'FAV'

    let transactionType: 'SALE' | 'CREDIT_NOTE' | 'DEBIT_NOTE'
    if (esNotaCredito) {
      transactionType = 'CREDIT_NOTE'
    } else if (esNotaDebito) {
      transactionType = 'DEBIT_NOTE'
    } else {
      transactionType = 'SALE'
    }

    const tipoKey = `${compLabel} ${tipoLetra}`
    porTipoComprobante[tipoKey] = (porTipoComprobante[tipoKey] || 0) + 1

    // Intentar vincular con cotización existente por customerId + total similar (±5%)
    // Solo para FAV/NDV, no para notas de crédito
    let matchedQuoteId: string | null = null
    let matchedSalesPersonId: string | null = null
    if (!esNotaCredito) {
      const customerQuotes = quotesByCustomer.get(localCustomerId)
      if (customerQuotes && total > 0) {
        const tolerance = 0.05 // 5%
        const match = customerQuotes.find((q) => {
          const quoteTotal = Number(q.total)
          if (quoteTotal === 0) return false
          const diff = Math.abs(quoteTotal - total) / quoteTotal
          return diff <= tolerance
        })
        if (match) {
          matchedQuoteId = match.id
          matchedSalesPersonId = match.salesPersonId
        }
      }
    }

    const invoiceData = {
      invoiceNumber: String(f.nroFactura || `COLPPY-${idFactura}`),
      invoiceType: mapInvoiceType(String(f.idTipoFactura || '0')),
      transactionType,
      customerId: localCustomerId,
      quoteId: matchedQuoteId,
      // Si se vinculó con cotización, usar su vendedor; si no, fallback a usuario del sistema
      userId: matchedSalesPersonId || systemUser.id,
      status: mapInvoiceStatus(String(f.idEstadoFactura || '3'), saldo) as 'PENDING' | 'PAID',
      currency: monedaCode as 'ARS' | 'USD' | 'EUR',
      exchangeRate: tipoCambio > 0 ? tipoCambio : null,
      subtotal: subtotalVal,
      taxAmount: taxAmountVal,
      discount: 0,
      total,
      balance: saldo,
      paymentStatus: mapPaymentStatus(String(f.idEstadoFactura || '3'), total, aplicado) as 'UNPAID' | 'PARTIAL' | 'PAID',
      issueDate: new Date(fechaFactura + 'T12:00:00'), // T12:00 evita desfase UTC→AR timezone
      dueDate: new Date(String(f.fechaPago || fechaFactura).split(' ')[0] + 'T12:00:00'),
      cae: String(f.cae || '') || null,
      afipStatus: f.cae ? 'APPROVED' as const : 'PENDING' as const,
      colppyId: idFactura,
      notes: `${compLabel} ${tipoLetra} - Importado desde Colppy${matchedQuoteId ? ' (vinculado a cotización)' : ''}`,
    }

    try {
      const existing = await prisma.invoice.findFirst({ where: { colppyId: idFactura } })

      if (existing) {
        // Actualizar (NO sobreescribir userId/quoteId para preservar asignación manual)
        await prisma.invoice.update({
          where: { id: existing.id },
          data: {
            // Graduar el borrador del ERP al número real del comprobante
            // cuando Colppy lo emite (mismo colppyId). Mantiene quoteId e
            // InvoiceItems del envío original.
            ...(existing.invoiceNumber.startsWith('BORRADOR-COLPPY-') && {
              invoiceNumber: invoiceData.invoiceNumber,
            }),
            transactionType: invoiceData.transactionType,
            status: invoiceData.status,
            paymentStatus: invoiceData.paymentStatus,
            balance: invoiceData.balance,
            total: invoiceData.total,
            subtotal: invoiceData.subtotal,
            taxAmount: invoiceData.taxAmount,
            currency: invoiceData.currency,
            exchangeRate: invoiceData.exchangeRate,
            cae: invoiceData.cae,
            afipStatus: invoiceData.afipStatus,
            notes: invoiceData.notes,
          },
        })
        updated++
      } else {
        await prisma.invoice.create({ data: invoiceData })
        if (matchedQuoteId) linkedToQuote++
        created++
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      errors.push(`Factura ${idFactura}: ${msg}`)
    }
  }

  logger.info(`[Sync Colppy] Resultado: ${created} creadas (${linkedToQuote} vinculadas a cotización), ${updated} actualizadas, ${skipped} omitidas, ${errors.length} errores`)
  logger.info(`[Sync Colppy] Clientes: ${customersCreated} creados, ${customersLinkedByCuit} vinculados por CUIT`)
  if (Object.keys(skipReasons).length > 0) {
    logger.info('[Sync Colppy] Razones de omisión:', JSON.stringify(skipReasons))
  }

  return {
    totalColppy: colppyFacturas.length,
    created,
    updated,
    skipped,
    linkedToQuote,
    customersCreated,
    customersLinkedByCuit,
    errors: errors.length,
    errorDetails: errors.slice(0, 20),
    skipReasons,
    porTipoComprobante,
    rangoFechas: { desde: dateFromStr, hasta: dateToStr },
    ...(fetchPartial ? {
      partial: true,
      partialReason: `Sesión de Colppy expiró durante la paginación. Se importaron ${colppyFacturas.length} facturas parciales. ${fetchResult.error || ''}`.trim(),
    } : {}),
  }
}
