/**
 * POST /api/facturacion/sync-colppy
 * Sincroniza facturas desde Colppy a la base de datos local.
 *
 * Body: { dateFrom?: string, dateTo?: string }
 * - Si no se proveen fechas, sincroniza desde 2026-01-01 hasta hoy.
 * - Pagina automáticamente TODOS los resultados de Colppy
 * - Importa TODOS los tipos de comprobante (FAV, NDV, NCV)
 * - Importa facturas nuevas (por colppyId/idFactura)
 * - Actualiza las que ya existen
 */

import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { execSync } from 'child_process'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const COLPPY_ENDPOINT = 'https://login.colppy.com/lib/frontera2/service.php'
const COLPPY_USER = process.env.COLPPY_USER || ''
const COLPPY_PASSWORD = process.env.COLPPY_PASSWORD || ''
const COLPPY_ID_EMPRESA = process.env.COLPPY_ID_EMPRESA || ''

const PAGE_SIZE = 500

function md5(text: string): string {
  return crypto.createHash('md5').update(text).digest('hex')
}

function callColppyRaw(payload: unknown): string {
  let tempFile: string | null = null
  try {
    tempFile = path.join(os.tmpdir(), `colppy-sync-${Date.now()}.json`)
    fs.writeFileSync(tempFile, JSON.stringify(payload), 'utf-8')
    const cmd = `curl -s -X POST "${COLPPY_ENDPOINT}" -H "Content-Type: application/json" -d @"${tempFile}" --max-time 120 -L`
    return execSync(cmd, {
      encoding: 'utf-8',
      timeout: 130000,
      maxBuffer: 50 * 1024 * 1024,
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    throw new Error(`Error ejecutando curl a Colppy: ${msg}`)
  } finally {
    if (tempFile && fs.existsSync(tempFile)) {
      try { fs.unlinkSync(tempFile) } catch { /* ignore */ }
    }
  }
}

function callColppy(payload: unknown): Record<string, unknown> {
  const raw = callColppyRaw(payload)

  // Verificar que la respuesta sea JSON antes de parsear
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    const preview = trimmed.substring(0, 500)
    console.error(`[Colppy] Respuesta NO-JSON recibida (${trimmed.length} bytes). Primeros 500 chars:\n${preview}`)
    throw new Error(`Colppy devolvió respuesta no-JSON (${trimmed.length} bytes). Posible error de sesión, rate limit, o mantenimiento. Preview: ${preview.substring(0, 200)}`)
  }

  try {
    return JSON.parse(trimmed)
  } catch {
    const preview = trimmed.substring(0, 500)
    console.error(`[Colppy] Error parseando JSON (${trimmed.length} bytes). Preview:\n${preview}`)
    throw new Error(`Error parseando respuesta Colppy como JSON. Preview: ${preview.substring(0, 200)}`)
  }
}

/**
 * Llama a Colppy con retry automático: si falla con respuesta no-JSON o error de sesión,
 * re-hace login y reintenta UNA vez.
 */
function callColppyWithRetry(
  payload: unknown,
  getNewSession: () => { claveSesion: string; passwordMD5: string },
  updatePayloadSession: (payload: unknown, claveSesion: string) => unknown
): Record<string, unknown> {
  try {
    return callColppy(payload)
  } catch (firstError: unknown) {
    const msg = firstError instanceof Error ? firstError.message : ''
    console.warn(`[Colppy] Primer intento falló: ${msg.substring(0, 200)}. Re-autenticando...`)

    // Re-login
    const { claveSesion } = getNewSession()
    const updatedPayload = updatePayloadSession(payload, claveSesion)

    // Esperar 2 segundos antes de reintentar (evitar rate limit)
    execSync('timeout /t 2 >nul 2>&1 || sleep 2', { timeout: 5000 }).toString()

    return callColppy(updatedPayload)
  }
}

function colppyLogin(): string {
  const passwordMD5 = md5(COLPPY_PASSWORD)
  const response = callColppy({
    auth: { usuario: COLPPY_USER, password: passwordMD5 },
    service: { provision: 'Usuario', operacion: 'iniciar_sesion' },
    parameters: { usuario: COLPPY_USER, password: passwordMD5 },
  }) as { result?: { estado?: number; mensaje?: string }; response?: { data?: { claveSesion?: string } } }

  if (response.result?.estado !== 0) {
    throw new Error(`Error login Colppy: ${response.result?.mensaje}`)
  }
  const key = response.response?.data?.claveSesion || ''
  console.log(`[Sync Colppy] Login OK, sesión: ${key.substring(0, 8)}...`)
  return key
}

// Mapeos de Colppy
const tipoFacturaMap: Record<string, string> = {
  '0': 'A', '1': 'B', '2': 'C', '3': 'E', '4': 'M', '5': 'T',
}

const monedaMap: Record<string, string> = {
  '0': 'USD', '1': 'ARS', '2': 'EUR',
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
// Verificado con datos reales: tipo 5 tiene totales NEGATIVOS = son NCV
const CREDIT_NOTE_TIPOS = new Set(['5', '11', '53'])

// Notas de Débito (NDV) → transactionType = DEBIT_NOTE, SUMAN al total
// Verificado con datos reales: tipo 8 tiene totales POSITIVOS = son NDV
const DEBIT_NOTE_TIPOS = new Set(['8', '12', '52'])

// Mapear tipo de comprobante Colppy a InvoiceType del schema
function mapInvoiceType(idTipoFactura: string): 'A' | 'B' | 'C' | 'E' {
  const letter = tipoFacturaMap[idTipoFactura] || 'A'
  if (['A', 'B', 'C', 'E'].includes(letter)) return letter as 'A' | 'B' | 'C' | 'E'
  return 'A'
}

// Mapear estado de Colppy a InvoiceStatus del schema
function mapInvoiceStatus(idEstadoFactura: string, saldo: number): string {
  if (idEstadoFactura === '5' || saldo <= 0) return 'PAID'
  return 'PENDING'
}

function mapPaymentStatus(idEstadoFactura: string, total: number, aplicado: number): string {
  if (idEstadoFactura === '5' || aplicado >= total) return 'PAID'
  if (aplicado > 0) return 'PARTIAL'
  return 'UNPAID'
}

// Mapeo de condición IVA Colppy a TaxCondition del schema
const condicionIvaMap: Record<string, string> = {
  '1': 'RESPONSABLE_INSCRIPTO', '2': 'MONOTRIBUTO', '4': 'EXENTO',
  '5': 'CONSUMIDOR_FINAL', '6': 'RESPONSABLE_NO_INSCRIPTO',
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

/**
 * Obtiene TODOS los clientes de Colppy para mapeo (con retry automático)
 */
function fetchAllColppyClients(claveSesion: string, passwordMD5: string): ColppyClient[] {
  try {
    const payload = {
      auth: { usuario: COLPPY_USER, password: passwordMD5 },
      service: { provision: 'Cliente', operacion: 'listar_cliente' },
      parameters: {
        sesion: { usuario: COLPPY_USER, claveSesion },
        idEmpresa: COLPPY_ID_EMPRESA,
        start: 0,
        limit: 6000,
        filter: [],
        order: [{ field: 'NombreFantasia', dir: 'asc' }],
      },
    }

    const response = callColppyWithRetry(
      payload,
      () => {
        const newSession = colppyLogin()
        return { claveSesion: newSession, passwordMD5 }
      },
      (p, newSession) => {
        const pl = p as typeof payload
        return { ...pl, parameters: { ...pl.parameters, sesion: { usuario: COLPPY_USER, claveSesion: newSession } } }
      }
    ) as { result?: { estado?: number }; response?: { success?: boolean; data?: Record<string, unknown>[] } }

    if (response.result?.estado !== 0 || !response.response?.success) {
      console.warn('[Sync Colppy] Respuesta de clientes no exitosa:', response.result)
      return []
    }

    return (response.response.data || []).map((c: Record<string, unknown>) => ({
      idCliente: String(c.idCliente || ''),
      cuit: String(c.CUIT || ''),
      name: String(c.NombreFantasia || c.RazonSocial || ''),
      businessName: String(c.RazonSocial || ''),
      taxCondition: condicionIvaMap[String(c.idCondicionIva || '1')] || 'RESPONSABLE_INSCRIPTO',
      email: String(c.Email || ''),
      phone: String(c.Telefono || ''),
      address: String(c.DirPostal || ''),
      city: String(c.DirPostalCiudad || ''),
      province: String(c.DirPostalProvincia || ''),
    }))
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown'
    console.error(`[Sync Colppy] Error cargando clientes: ${msg.substring(0, 300)}`)
    return []
  }
}

/**
 * Obtiene TODAS las facturas de Colppy paginando automáticamente.
 * Usa retry con re-login ante fallos y delay entre páginas para evitar rate limit.
 */
function fetchAllColppyFacturas(
  claveSesionInicial: string,
  passwordMD5: string,
  dateFromStr: string,
  dateToStr: string
): Record<string, unknown>[] {
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

    const response = callColppyWithRetry(
      payload,
      () => {
        currentSession = colppyLogin()
        return { claveSesion: currentSession, passwordMD5 }
      },
      (p, newSession) => {
        const pl = p as typeof payload
        currentSession = newSession
        return { ...pl, parameters: { ...pl.parameters, sesion: { usuario: COLPPY_USER, claveSesion: newSession } } }
      }
    ) as { result?: { estado?: number; mensaje?: string }; response?: { success?: boolean; data?: Record<string, unknown>[]; total?: number } }

    if (response.result?.estado !== 0 || !response.response?.success) {
      throw new Error(response.result?.mensaje || 'Error al obtener facturas de Colppy')
    }

    const pageData = response.response?.data || []
    allFacturas.push(...pageData)

    console.log(`[Sync Colppy] Página ${Math.floor(start / PAGE_SIZE) + 1}: ${pageData.length} facturas (total acumulado: ${allFacturas.length})`)

    // Si devolvió menos que el page size, no hay más páginas
    if (pageData.length < PAGE_SIZE) {
      hasMore = false
    } else {
      start += PAGE_SIZE
      // Delay entre páginas para evitar rate limit de Colppy
      try { execSync('timeout /t 1 >nul 2>&1 || sleep 1', { timeout: 3000 }).toString() } catch { /* ignore */ }
    }
  }

  return allFacturas
}

/**
 * Busca el tipo de cambio USD→ARS para una fecha dada en la tabla ExchangeRate.
 * Usa cache por fecha para evitar queries repetidos durante la sync.
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

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const dateFrom = body.dateFrom
      ? new Date(body.dateFrom)
      : new Date('2026-01-01') // Por defecto desde 1 de enero de 2026
    const dateTo = body.dateTo
      ? new Date(body.dateTo)
      : new Date()

    const dateFromStr = dateFrom.toISOString().split('T')[0]
    const dateToStr = dateTo.toISOString().split('T')[0]

    console.log(`[Sync Colppy] Sincronizando facturas desde ${dateFromStr} hasta ${dateToStr}...`)

    // 1. Login a Colppy
    const claveSesion = colppyLogin()
    const passwordMD5 = md5(COLPPY_PASSWORD)

    // 2. Fetch TODAS las facturas de Colppy con paginación
    const colppyFacturas = fetchAllColppyFacturas(claveSesion, passwordMD5, dateFromStr, dateToStr)
    console.log(`[Sync Colppy] Total: ${colppyFacturas.length} facturas obtenidas de Colppy`)

    // Log raw de la primera factura para debug de campos
    if (colppyFacturas.length > 0) {
      console.log('[Sync Colppy] RAW primera factura:', JSON.stringify(colppyFacturas[0], null, 2))
      // Log de una factura USD si existe
      const usdSample = colppyFacturas.find((f) => String(f.idMoneda) === '0')
      if (usdSample) {
        console.log('[Sync Colppy] RAW factura USD ejemplo:', JSON.stringify(usdSample, null, 2))
      }
    }

    // 3. Obtener mapeo de clientes Colppy -> local (múltiples estrategias)
    const customers = await prisma.customer.findMany({
      select: { id: true, colppyId: true, cuit: true, name: true },
    })
    // Mapeo por colppyId (directo)
    const customerByColppyId = new Map<string, string>()
    // Mapeo por CUIT (fallback)
    const customerByCuit = new Map<string, string>()
    for (const c of customers) {
      if (c.colppyId) customerByColppyId.set(c.colppyId, c.id)
      if (c.cuit) customerByCuit.set(c.cuit.replace(/\D/g, ''), c.id)
    }
    console.log(`[Sync Colppy] Clientes locales: ${customers.length} total, ${customerByColppyId.size} con colppyId, ${customerByCuit.size} con CUIT`)

    // Cargar clientes de Colppy para matching por CUIT y auto-creación
    const colppyClients = fetchAllColppyClients(claveSesion, passwordMD5)
    const colppyClientMap = new Map(colppyClients.map((c) => [c.idCliente, c]))
    console.log(`[Sync Colppy] Clientes Colppy cargados: ${colppyClients.length}`)

    // Obtener un usuario del sistema para asignar como fallback
    const systemUser = await prisma.user.findFirst({ select: { id: true } })
    if (!systemUser) {
      throw new Error('No hay usuarios en el sistema')
    }

    // Pre-cargar cotizaciones ACCEPTED/CONVERTED para vincular con facturas importadas
    // Busca por customerId + total similar (±5%)
    const quotesForMatching = await prisma.quote.findMany({
      where: {
        status: { in: ['ACCEPTED', 'CONVERTED'] },
        date: { gte: dateFrom },
      },
      select: {
        id: true,
        customerId: true,
        total: true,
        salesPersonId: true,
      },
      orderBy: { date: 'desc' },
    })

    // Agrupar cotizaciones por customerId para búsqueda rápida
    const quotesByCustomer = new Map<string, typeof quotesForMatching>()
    for (const q of quotesForMatching) {
      const existing = quotesByCustomer.get(q.customerId) || []
      existing.push(q)
      quotesByCustomer.set(q.customerId, existing)
    }

    // 4. Limpiar datos no válidos de syncs anteriores
    try {
      // Eliminar recibos (REC/REC-B) importados antes
      const deletedREC = await prisma.invoice.deleteMany({
        where: {
          colppyId: { not: null },
          notes: { startsWith: 'REC ' },
        },
      })
      if (deletedREC.count > 0) {
        console.log(`[Sync Colppy] Eliminados ${deletedREC.count} recibos (REC) de syncs anteriores`)
      }

      // Eliminar borradores: nroFactura con números muy altos (ej: 83957509)
      // La numeración real de VAL ARG es 0003-13xxx y 0003-00001xxx
      const deletedDrafts = await prisma.invoice.deleteMany({
        where: {
          colppyId: { not: null },
          status: 'PENDING',
          invoiceNumber: { not: { startsWith: '0003-0000' } },
        },
      })
      if (deletedDrafts.count > 0) {
        console.log(`[Sync Colppy] Eliminados ${deletedDrafts.count} borradores de syncs anteriores`)
      }
    } catch (err) {
      console.warn('[Sync Colppy] No se pudieron eliminar registros antiguos:', err instanceof Error ? err.message : err)
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
    console.log(`[Sync Colppy] TCs USD recolectados de ${usdRatesByDate.size} fechas distintas`)

    // Helper: buscar TC más cercano de facturas USD del mismo período
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
      // Ignorar borradores y otros estados no emitidos
      const idEstado = String(f.idEstadoFactura || '')
      if (idEstado !== '3' && idEstado !== '5') {
        skipReasons[`estado_${idEstado}`] = (skipReasons[`estado_${idEstado}`] || 0) + 1
        skipped++; continue
      }

      // Importar tipos de comprobante de venta de Colppy
      const tipoComp = String(f.idTipoComprobante || '4')
      // Tipos aceptados: FAV(4,10,51), NCV(5,11,53), NDV(8,12,52)
      // Ignorados: REC(9), REC-B(13)
      const tiposVenta = ['4', '5', '8', '10', '11', '12', '51', '52', '53']
      if (!tiposVenta.includes(tipoComp)) {
        skipReasons[`tipo_${tipoComp}`] = (skipReasons[`tipo_${tipoComp}`] || 0) + 1
        skipped++; continue
      }

      const idCliente = String(f.idCliente || '')

      // Estrategia de matching de cliente: 1) colppyId, 2) CUIT, 3) auto-crear
      let localCustomerId = customerByColppyId.get(idCliente)

      if (!localCustomerId) {
        // Intentar por CUIT
        const colppyClient = colppyClientMap.get(idCliente)
        if (colppyClient?.cuit) {
          const cuitClean = colppyClient.cuit.replace(/\D/g, '')
          const matchedByCuit = customerByCuit.get(cuitClean)
          if (matchedByCuit) {
            localCustomerId = matchedByCuit
            customersLinkedByCuit++
            // Actualizar colppyId en el cliente local para futuras syncs
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
                // Actualizar datos si están vacíos
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

      // Log de debug COMPLETO para NCV/NDV y facturas con total negativo
      const _totalDebug = parseFloat(String(f.totalFactura || '0'))
      const _labelDebug = tipoComprobanteLabel[tipoComp] || '?'
      const _rateDebug = String(f.rate || 'null')
      const _monedaDebug = String(f.idMoneda || 'null')
      if (_totalDebug < 0 || CREDIT_NOTE_TIPOS.has(tipoComp) || DEBIT_NOTE_TIPOS.has(tipoComp)) {
        console.log(`[Sync Debug] ${String(f.nroFactura)} idTipoComprobante:${tipoComp} (${_labelDebug}) totalFactura:${_totalDebug} idMoneda:${_monedaDebug} rate:${_rateDebug} → ${CREDIT_NOTE_TIPOS.has(tipoComp) ? 'CREDIT_NOTE' : DEBIT_NOTE_TIPOS.has(tipoComp) ? 'DEBIT_NOTE' : 'SALE'}`)
      }

      // ================================================================
      // REGLA DEFINITIVA de moneda:
      // rate > 1 → USD (el rate es el TC, ej: 1400, 1465)
      // rate = 0, 1, null → ARS
      // ================================================================
      const rawRate = parseFloat(String(f.rate || '0'))
      const esUSD = rawRate > 1

      // Colppy devuelve totalFactura SIEMPRE en ARS (moneda fiscal).
      const totalFacturaARS = parseFloat(String(f.totalFactura || '0'))
      const aplicadoARS = parseFloat(String(f.totalaplicado || '0'))
      const netoGravadoARS = parseFloat(String(f.netoGravado || '0'))
      const totalIVAARS = parseFloat(String(f.totalIVA || '0'))
      const fechaFactura = String(f.fechaFactura || new Date().toISOString().split('T')[0])

      let monedaCode: string
      let tipoCambio: number
      let total: number
      let aplicado: number
      let subtotalVal: number
      let taxAmountVal: number

      if (esUSD) {
        // FACTURA EN USD: rate > 1 (es el tipo de cambio, ej: 1465)
        monedaCode = 'USD'
        tipoCambio = rawRate
        // Convertir de ARS a USD usando el TC de Colppy
        total = Math.round((totalFacturaARS / tipoCambio) * 100) / 100
        aplicado = Math.round((aplicadoARS / tipoCambio) * 100) / 100
        subtotalVal = Math.round((netoGravadoARS / tipoCambio) * 100) / 100
        taxAmountVal = Math.round((totalIVAARS / tipoCambio) * 100) / 100
      } else {
        // FACTURA EN ARS: rate=0/1/null
        monedaCode = 'ARS'
        total = totalFacturaARS
        aplicado = aplicadoARS
        subtotalVal = netoGravadoARS
        taxAmountVal = totalIVAARS
        // Buscar TC del día: 1) ExchangeRate table, 2) TC cercano de factura USD, 3) default 1420
        const tcDelDia = await getExchangeRateForDate(fechaFactura)
        tipoCambio = tcDelDia > 0 ? tcDelDia : findClosestUsdRate(fechaFactura)
      }

      // ================================================================
      // Determinar transactionType según tipo de comprobante:
      // NCV (5, 11, 53) → CREDIT_NOTE (resta), Colppy envía totales NEGATIVOS
      // NDV (8, 12, 52) → DEBIT_NOTE (suma), Colppy envía totales POSITIVOS
      // FAV (4, 10, 51) → SALE
      // REC (9, 13) → IGNORAR (no se importan)
      // ================================================================
      const esNotaCredito = CREDIT_NOTE_TIPOS.has(tipoComp)
      const esNotaDebito = DEBIT_NOTE_TIPOS.has(tipoComp)

      // REGLA DE NEGOCIO: NDV (Notas de Débito) SIEMPRE son en ARS
      // Son por diferencia de cambio y nunca en USD, sin importar lo que diga rate/idMoneda
      if (esNotaDebito && monedaCode === 'USD') {
        console.log(`[Sync] NDV ${String(f.nroFactura)} forzada a ARS (era USD con rate=${rawRate}). Total ARS: ${totalFacturaARS}`)
        monedaCode = 'ARS'
        total = totalFacturaARS
        aplicado = aplicadoARS
        subtotalVal = netoGravadoARS
        taxAmountVal = totalIVAARS
        // Buscar TC del día para conversión en dashboard
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

      // Contar por tipo de comprobante
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
        issueDate: new Date(fechaFactura),
        dueDate: new Date(String(f.fechaPago || fechaFactura)),
        cae: String(f.cae || '') || null,
        afipStatus: f.cae ? 'APPROVED' as const : 'PENDING' as const,
        colppyId: idFactura,
        notes: `${compLabel} ${tipoLetra} - Importado desde Colppy${matchedQuoteId ? ' (vinculado a cotización)' : ''}`,
      }

      try {
        // Verificar si ya existe por colppyId
        const existing = await prisma.invoice.findFirst({
          where: { colppyId: idFactura },
        })

        if (existing) {
          // Actualizar (NO sobreescribir userId/quoteId para preservar asignación manual)
          await prisma.invoice.update({
            where: { id: existing.id },
            data: {
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
          // Crear nueva
          await prisma.invoice.create({ data: invoiceData })
          if (matchedQuoteId) linkedToQuote++
          created++
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        errors.push(`Factura ${idFactura}: ${msg}`)
      }
    }

    console.log(`[Sync Colppy] Resultado: ${created} creadas (${linkedToQuote} vinculadas a cotización), ${updated} actualizadas, ${skipped} omitidas, ${errors.length} errores`)
    console.log(`[Sync Colppy] Clientes: ${customersCreated} creados, ${customersLinkedByCuit} vinculados por CUIT`)
    if (Object.keys(skipReasons).length > 0) {
      console.log('[Sync Colppy] Razones de omisión:', JSON.stringify(skipReasons))
    }

    return NextResponse.json({
      success: true,
      resumen: {
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
        rangoFechas: {
          desde: dateFromStr,
          hasta: dateToStr,
        },
      },
    })
  } catch (error) {
    console.error('Error en sync Colppy:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error al sincronizar desde Colppy' },
      { status: 500 }
    )
  }
}
