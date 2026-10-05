import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Nota de crédito (emitirNotaCredito y POST /api/facturas/[id]/nota-credito)
 * cuando ARCA no confirma el CAE pedido (EmisionInciertaError: 504, Fault,
 * corte): mensaje bloqueante "NO reintentes" con el número y log
 * [ARCA_INCIERTO]; nunca "ARCA rechazó" (que invita a reintentar). Los demás
 * errores siguen como antes. Prisma y ARCA falsos: nada sale a la red.
 */

const db = vi.hoisted(() => ({ invoice: { findUnique: vi.fn() } }))
const arca = vi.hoisted(() => ({ emitirComprobante: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/arca/config', () => ({
  isArcaConfigured: () => true,
  getArcaConfig: () => ({ cuit: '30711111118', env: 'homo', puntoVenta: 7, fceMontoMinimo: 1e12, cbu: null }),
}))
vi.mock('@/lib/arca/emitir', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/arca/emitir')>()),
  emitirComprobante: arca.emitirComprobante,
}))
vi.mock('@/lib/sharepoint/facturas-emitidas', () => ({ archivarFacturaEnSharePointBg: vi.fn() }))
vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'U1', name: 'Test', email: 'test@example.com', role: 'ADMIN' } })) }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))

import { NextRequest } from 'next/server'
import { EmisionInciertaError, EmisionNoSolicitadaError } from '@/lib/arca/emitir'
import { NotaCreditoError, emitirNotaCredito } from '@/lib/facturacion/nota-credito-arca'
import { logger } from '@/lib/logger'
import { POST } from '@/app/api/facturas/[id]/nota-credito/route'

/** Factura B 0007-00000012 emitida por el ERP (datos inventados) */
const facturaB = {
  id: 'INV1',
  invoiceNumber: 'B-0007-00000012',
  invoiceType: 'B',
  transactionType: 'SALE',
  status: 'AUTHORIZED',
  emitidaPor: 'ARCA',
  cae: '76000000000012',
  pointOfSale: 7,
  cbteTipo: 6,
  cbteNumero: 12,
  issueDate: new Date('2026-10-05T13:00:00Z'),
  currency: 'ARS',
  exchangeRate: null,
  subtotal: 82.64,
  taxAmount: 17.36,
  total: 100,
  docTipo: 86,
  docNro: '20123456786',
  colppyPayload: null,
  customer: { id: 'C1', name: 'PEREZ JUAN', cuit: '20-12345678-6', taxCondition: 'CONSUMIDOR_FINAL' },
  items: [],
  relatedInvoices: [],
  cotizacionFactura: null,
  quote: null,
}

const MENSAJE = 'ARCA no confirmó el comprobante (Nota de Crédito B N° 0007-00000005): NO reintentes; revisalo en ARCA antes de volver a emitir'

beforeEach(() => {
  vi.clearAllMocks()
  db.invoice.findUnique.mockResolvedValue(facturaB)
})

const postNc = () =>
  POST(
    new NextRequest('http://localhost/api/facturas/INV1/nota-credito', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modo: 'TOTAL' }),
    }),
    { params: Promise.resolve({ id: 'INV1' }) }
  )

describe('NC: ARCA no confirmó el CAE', () => {
  it('EmisionInciertaError (504 después de pedir el CAE): NotaCreditoError 502 bloqueante con el número + log [ARCA_INCIERTO]', async () => {
    arca.emitirComprobante.mockRejectedValue(new EmisionInciertaError(new Error('WSFE FECAESolicitar: respuesta inesperada (HTTP 504)'), 8, 7, 5))
    const e = await emitirNotaCredito('INV1', { userId: 'U1', modo: 'TOTAL' }).catch((x) => x)
    expect(e).toBeInstanceOf(NotaCreditoError)
    expect(e).toMatchObject({ status: 502, message: MENSAJE, codigo: 'ARCA_INCIERTO' })
    expect(e.message).not.toMatch(/rechazó|reintentá/)
    expect(logger.error).toHaveBeenCalledWith(
      `[ARCA_INCIERTO] ${MENSAJE}`,
      expect.objectContaining({ invoiceId: 'INV1', factura: 'B-0007-00000012', cbteTipo: 8, puntoVenta: 7, numero: 5, total: 100 })
    )
    // Se pidió la NC B asociada a la factura
    expect(arca.emitirComprobante.mock.calls[0][0]).toMatchObject({ clase: 'NOTA_CREDITO', letra: 'B', importes: { total: 100 } })
  })

  it('por la ruta: 502 con el mensaje bloqueante', async () => {
    arca.emitirComprobante.mockRejectedValue(new EmisionInciertaError(new Error('socket hang up'), 8, 7, 5))
    const res = await postNc()
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: MENSAJE, codigo: 'ARCA_INCIERTO' })
  })

  it('rechazo de ARCA con códigos: igual que antes (422 "ARCA rechazó")', async () => {
    arca.emitirComprobante.mockResolvedValue({ ok: false, cbteTipo: 8, puntoVenta: 7, numero: 5, errores: [{ Code: 10015, Msg: 'doc' }], mensaje: '[10015] doc' })
    const res = await postNc()
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'ARCA rechazó la nota de crédito: [10015] doc' })
    expect(logger.error).not.toHaveBeenCalledWith(expect.stringContaining('[ARCA_INCIERTO]'), expect.anything())
  })

  it('falla antes de pedir el CAE (EmisionNoSolicitadaError): igual que antes (500 con el mensaje)', async () => {
    arca.emitirComprobante.mockRejectedValue(new EmisionNoSolicitadaError(new Error('WSAA caído'), 8, 7))
    const res = await postNc()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'WSAA caído' })
  })
})
