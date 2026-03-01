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

function callColppy(payload: unknown): Record<string, unknown> {
  let tempFile: string | null = null
  try {
    tempFile = path.join(os.tmpdir(), `colppy-sync-${Date.now()}.json`)
    fs.writeFileSync(tempFile, JSON.stringify(payload), 'utf-8')
    const cmd = `curl -s -X POST "${COLPPY_ENDPOINT}" -H "Content-Type: application/json" -d @"${tempFile}" --max-time 120 -L`
    const result = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 130000,
      maxBuffer: 50 * 1024 * 1024,
    })
    return JSON.parse(result)
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    throw new Error(`Error llamando a Colppy: ${msg}`)
  } finally {
    if (tempFile && fs.existsSync(tempFile)) {
      try { fs.unlinkSync(tempFile) } catch { /* ignore */ }
    }
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
  return response.response?.data?.claveSesion || ''
}

// Mapeos de Colppy
const tipoFacturaMap: Record<string, string> = {
  '0': 'A', '1': 'B', '2': 'C', '3': 'E', '4': 'M', '5': 'T',
}

const monedaMap: Record<string, string> = {
  '0': 'USD', '1': 'ARS', '2': 'EUR',
}

const tipoComprobanteLabel: Record<string, string> = {
  '4': 'FAV', '5': 'NDV', '6': 'NCV', '7': 'REC', '8': 'NCV', '9': 'NDV',
  '10': 'FAV', '11': 'NDV', '12': 'NCV', '13': 'NCV',
}

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
 * Obtiene TODOS los clientes de Colppy para mapeo
 */
function fetchAllColppyClients(claveSesion: string, passwordMD5: string): ColppyClient[] {
  const response = callColppy({
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
  }) as { result?: { estado?: number }; response?: { success?: boolean; data?: Record<string, unknown>[] } }

  if (response.result?.estado !== 0 || !response.response?.success) {
    console.warn('[Sync Colppy] No se pudieron cargar clientes de Colppy')
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
}

/**
 * Obtiene TODAS las facturas de Colppy paginando automáticamente
 */
function fetchAllColppyFacturas(
  claveSesion: string,
  passwordMD5: string,
  dateFromStr: string,
  dateToStr: string
): Record<string, unknown>[] {
  const allFacturas: Record<string, unknown>[] = []
  let start = 0
  let hasMore = true

  while (hasMore) {
    const response = callColppy({
      auth: { usuario: COLPPY_USER, password: passwordMD5 },
      service: { provision: 'FacturaVenta', operacion: 'listar_facturasventa' },
      parameters: {
        sesion: { usuario: COLPPY_USER, claveSesion },
        idEmpresa: COLPPY_ID_EMPRESA,
        start,
        limit: PAGE_SIZE,
        filter: [
          { field: 'fechaFactura', op: '>=', value: dateFromStr },
          { field: 'fechaFactura', op: '<=', value: dateToStr },
        ],
        order: { field: ['idFactura'], order: 'desc' },
      },
    }) as { result?: { estado?: number; mensaje?: string }; response?: { success?: boolean; data?: Record<string, unknown>[]; total?: number } }

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
    }
  }

  return allFacturas
}

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

    // 4. Procesar cada factura
    let created = 0
    let updated = 0
    let skipped = 0
    let linkedToQuote = 0
    let customersCreated = 0
    let customersLinkedByCuit = 0
    const errors: string[] = []
    const porTipoComprobante: Record<string, number> = {}
    const skipReasons: Record<string, number> = {}

    for (const f of colppyFacturas) {
      const idFactura = String(f.idFactura || '')
      if (!idFactura) {
        skipReasons['sin_idFactura'] = (skipReasons['sin_idFactura'] || 0) + 1
        skipped++; continue
      }

      // Importar TODOS los tipos de comprobante de venta:
      // 4=FAV A, 5=NDV A, 6=NCV A, 10=FAV B, 11=NDV B, 12=NCV B, 13=NCV C/E
      const tipoComp = String(f.idTipoComprobante || '4')
      const tiposVenta = ['4', '5', '6', '8', '9', '10', '11', '12', '13']
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
            const newCustomer = await prisma.customer.create({
              data: {
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
            localCustomerId = newCustomer.id
            customerByColppyId.set(idCliente, newCustomer.id)
            customerByCuit.set(colppyClient.cuit.replace(/\D/g, ''), newCustomer.id)
            customersCreated++
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Unknown error'
            // Si es error de CUIT duplicado, intentar buscar por CUIT
            if (msg.includes('Unique constraint') && colppyClient.cuit) {
              const existing = await prisma.customer.findUnique({
                where: { cuit: colppyClient.cuit },
                select: { id: true },
              })
              if (existing) {
                localCustomerId = existing.id
                await prisma.customer.update({
                  where: { id: existing.id },
                  data: { colppyId: idCliente },
                })
                customerByColppyId.set(idCliente, existing.id)
                customersLinkedByCuit++
              }
            }
            if (!localCustomerId) {
              skipReasons['cliente_crear_error'] = (skipReasons['cliente_crear_error'] || 0) + 1
              errors.push(`Factura ${idFactura}: Error creando cliente ${colppyClient.name}: ${msg}`)
            }
          }
        } else {
          skipReasons['sin_cliente_colppy'] = (skipReasons['sin_cliente_colppy'] || 0) + 1
        }
      }

      if (!localCustomerId) {
        skipped++
        continue
      }

      const monedaCode = monedaMap[String(f.idMoneda || '1')] || 'ARS'
      const tipoCambio = parseFloat(String(f.rate || f.valorCambio || f.cotizacion || '1'))

      // Colppy devuelve totalFactura SIEMPRE en ARS (moneda fiscal).
      // Para facturas en USD/EUR, necesitamos el monto en la moneda original.
      const totalFacturaARS = parseFloat(String(f.totalFactura || '0'))
      const aplicadoARS = parseFloat(String(f.totalaplicado || '0'))
      const netoGravadoARS = parseFloat(String(f.netoGravado || '0'))
      const totalIVAARS = parseFloat(String(f.totalIVA || '0'))

      let total: number
      let aplicado: number
      let subtotalVal: number
      let taxAmountVal: number

      if (monedaCode !== 'ARS' && tipoCambio > 1) {
        // Factura en moneda extranjera: convertir de ARS a moneda original
        total = Math.round((totalFacturaARS / tipoCambio) * 100) / 100
        aplicado = Math.round((aplicadoARS / tipoCambio) * 100) / 100
        subtotalVal = Math.round((netoGravadoARS / tipoCambio) * 100) / 100
        taxAmountVal = Math.round((totalIVAARS / tipoCambio) * 100) / 100
        console.log(`[Sync Colppy] Factura ${idFactura} ${monedaCode}: totalARS=${totalFacturaARS} / TC=${tipoCambio} = ${monedaCode} ${total}`)
      } else {
        // Factura en ARS: montos directos
        total = totalFacturaARS
        aplicado = aplicadoARS
        subtotalVal = netoGravadoARS
        taxAmountVal = totalIVAARS
      }

      const saldo = Math.max(0, total - aplicado)
      const tipoLetra = tipoFacturaMap[String(f.idTipoFactura || '0')] || 'A'
      const compLabel = tipoComprobanteLabel[tipoComp] || 'FAV'

      // Contar por tipo de comprobante
      const tipoKey = `${compLabel} ${tipoLetra}`
      porTipoComprobante[tipoKey] = (porTipoComprobante[tipoKey] || 0) + 1

      // Intentar vincular con cotización existente por customerId + total similar (±5%)
      let matchedQuoteId: string | null = null
      let matchedSalesPersonId: string | null = null
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

      const invoiceData = {
        invoiceNumber: String(f.nroFactura || `COLPPY-${idFactura}`),
        invoiceType: mapInvoiceType(String(f.idTipoFactura || '0')),
        transactionType: 'SALE' as const,
        customerId: localCustomerId,
        quoteId: matchedQuoteId,
        // Si se vinculó con cotización, usar su vendedor; si no, fallback a usuario del sistema
        userId: matchedSalesPersonId || systemUser.id,
        status: mapInvoiceStatus(String(f.idEstadoFactura || '3'), saldo) as 'PENDING' | 'PAID',
        currency: monedaCode as 'ARS' | 'USD' | 'EUR',
        exchangeRate: monedaCode !== 'ARS' ? tipoCambio : null,
        subtotal: subtotalVal,
        taxAmount: taxAmountVal,
        discount: 0,
        total,
        balance: saldo,
        paymentStatus: mapPaymentStatus(String(f.idEstadoFactura || '3'), total, aplicado) as 'UNPAID' | 'PARTIAL' | 'PAID',
        issueDate: new Date(String(f.fechaFactura || new Date().toISOString())),
        dueDate: new Date(String(f.fechaPago || f.fechaFactura || new Date().toISOString())),
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
