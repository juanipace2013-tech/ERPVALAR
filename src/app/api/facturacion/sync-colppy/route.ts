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

    // 3. Obtener mapeo de clientes Colppy -> local
    const customers = await prisma.customer.findMany({
      where: { colppyId: { not: null } },
      select: { id: true, colppyId: true },
    })
    const customerMap = new Map(customers.map((c) => [c.colppyId!, c.id]))

    // Obtener un usuario del sistema para asignar como fallback (no se usa vendedor de Colppy)
    const systemUser = await prisma.user.findFirst({ select: { id: true } })
    if (!systemUser) {
      throw new Error('No hay usuarios en el sistema')
    }

    // 4. Procesar cada factura
    let created = 0
    let updated = 0
    let skipped = 0
    const errors: string[] = []
    const porTipoComprobante: Record<string, number> = {}

    for (const f of colppyFacturas) {
      const idFactura = String(f.idFactura || '')
      if (!idFactura) { skipped++; continue }

      // Importar TODOS los tipos de comprobante de venta:
      // 4=FAV A/B/C, 5=NDV A/B/C, 6=NCV A/B/C
      const tipoComp = String(f.idTipoComprobante || '4')
      if (!['4', '5', '6'].includes(tipoComp)) { skipped++; continue }

      const idCliente = String(f.idCliente || '')
      const localCustomerId = customerMap.get(idCliente)
      if (!localCustomerId) {
        skipped++
        continue
      }

      const total = parseFloat(String(f.totalFactura || '0'))
      const aplicado = parseFloat(String(f.totalaplicado || '0'))
      const saldo = Math.max(0, total - aplicado)
      const monedaCode = monedaMap[String(f.idMoneda || '1')] || 'ARS'
      const tipoCambio = parseFloat(String(f.rate || f.valorCambio || '1'))
      const tipoLetra = tipoFacturaMap[String(f.idTipoFactura || '0')] || 'A'
      const compLabel = tipoComprobanteLabel[tipoComp] || 'FAV'

      // Contar por tipo de comprobante
      const tipoKey = `${compLabel} ${tipoLetra}`
      porTipoComprobante[tipoKey] = (porTipoComprobante[tipoKey] || 0) + 1

      const invoiceData = {
        invoiceNumber: String(f.nroFactura || `COLPPY-${idFactura}`),
        invoiceType: mapInvoiceType(String(f.idTipoFactura || '0')),
        transactionType: 'SALE' as const,
        customerId: localCustomerId,
        // El vendedor NO viene de Colppy - se asigna el primer usuario del sistema como placeholder
        userId: systemUser.id,
        status: mapInvoiceStatus(String(f.idEstadoFactura || '3'), saldo) as 'PENDING' | 'PAID',
        currency: monedaCode as 'ARS' | 'USD' | 'EUR',
        exchangeRate: tipoCambio,
        subtotal: parseFloat(String(f.netoGravado || '0')),
        taxAmount: parseFloat(String(f.totalIVA || '0')),
        discount: 0,
        total,
        balance: saldo,
        paymentStatus: mapPaymentStatus(String(f.idEstadoFactura || '3'), total, aplicado) as 'UNPAID' | 'PARTIAL' | 'PAID',
        issueDate: new Date(String(f.fechaFactura || new Date().toISOString())),
        dueDate: new Date(String(f.fechaPago || f.fechaFactura || new Date().toISOString())),
        cae: String(f.cae || '') || null,
        afipStatus: f.cae ? 'APPROVED' as const : 'PENDING' as const,
        colppyId: idFactura,
        notes: `${compLabel} ${tipoLetra} - Importado desde Colppy`,
      }

      try {
        // Verificar si ya existe por colppyId
        const existing = await prisma.invoice.findFirst({
          where: { colppyId: idFactura },
        })

        if (existing) {
          // Actualizar (NO sobreescribir userId para preservar asignación manual de vendedor)
          await prisma.invoice.update({
            where: { id: existing.id },
            data: {
              status: invoiceData.status,
              paymentStatus: invoiceData.paymentStatus,
              balance: invoiceData.balance,
              total: invoiceData.total,
              subtotal: invoiceData.subtotal,
              taxAmount: invoiceData.taxAmount,
              cae: invoiceData.cae,
              afipStatus: invoiceData.afipStatus,
            },
          })
          updated++
        } else {
          // Crear nueva
          await prisma.invoice.create({ data: invoiceData })
          created++
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        errors.push(`Factura ${idFactura}: ${msg}`)
      }
    }

    console.log(`[Sync Colppy] Resultado: ${created} creadas, ${updated} actualizadas, ${skipped} omitidas, ${errors.length} errores`)

    return NextResponse.json({
      success: true,
      resumen: {
        totalColppy: colppyFacturas.length,
        created,
        updated,
        skipped,
        errors: errors.length,
        errorDetails: errors.slice(0, 20),
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
