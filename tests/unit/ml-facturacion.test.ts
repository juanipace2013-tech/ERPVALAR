import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Facturación de ventas de Mercado Libre: pestañas A (RI / Monotributo) y B
 * (consumidores finales / exentos). Prisma en memoria, ML, padrón y ARCA
 * (emitirComprobante) falsos; el alta en Colppy es un sendQuoteToColppy falso
 * que usa la letra real (letraFacturaColppy) y llama al hook real de ARCA.
 * Nunca sale a la red.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- filas falsas de Prisma, sin tipar a propósito
type Fila = Record<string, any>

const db = vi.hoisted(() => ({
  mlOrderInvoice: { findMany: vi.fn(), create: vi.fn(), delete: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
  mlItemLink: { findMany: vi.fn() },
  customer: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  product: { findMany: vi.fn() },
  invoice: { findMany: vi.fn(), create: vi.fn() },
  $transaction: vi.fn(),
}))

const ml = vi.hoisted(() => ({
  getPack: vi.fn(),
  getSaleOrder: vi.fn(),
  getBuyerFiscal: vi.fn(),
  getPackFiscalDocuments: vi.fn(),
  searchPaidOrdersSince: vi.fn(),
  uploadPackFiscalDocument: vi.fn(),
}))

const ext = vi.hoisted(() => ({
  consultarPersona: vi.fn(),
  emitirComprobante: vi.fn(),
  sendQuoteToColppy: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/arca/config', () => ({
  isArcaConfigured: () => true,
  getArcaConfig: () => ({ cuit: '30711111111', env: 'homo', fceMontoMinimo: 1e12, cbu: null }),
}))
vi.mock('@/lib/arca/padron', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/arca/padron')>()),
  consultarPersona: ext.consultarPersona,
}))
vi.mock('@/lib/arca/emitir', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/arca/emitir')>()),
  emitirComprobante: ext.emitirComprobante,
}))
vi.mock('@/lib/colppy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/colppy')>()),
  sendQuoteToColppy: ext.sendQuoteToColppy,
}))
vi.mock('@/lib/colppy-inventory', () => ({ syncStockForSkusFireAndForget: vi.fn() }))
vi.mock('@/lib/mercadolibre/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mercadolibre/client')>()),
  ...ml,
}))
vi.mock('@/lib/facturacion/factura-pdf-data', () => ({ buildFacturaPdfData: vi.fn(async () => ({ pdf: true })) }))
vi.mock('@/lib/pdf/factura-generator', () => ({
  generateFacturaPDF: vi.fn(async () => Buffer.from('%PDF')),
  facturaPdfFilename: () => 'factura.pdf',
}))
vi.mock('@/lib/sharepoint/facturas-emitidas', () => ({ archivarFacturaEnSharePointBg: vi.fn() }))
// Ruta POST real (la que llama el borrador): sesión y auditoría falsas
vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'U1', name: 'Test', email: 'test@example.com' } })) }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))

import { Prisma } from '@prisma/client'
import { PadronError, type PersonaPadron } from '@/lib/arca/padron'
import { letraFacturaColppy, type EmisionExternaDatos, type SendToColppyOptions } from '@/lib/colppy'
import { EmisionInciertaError, EmisionNoSolicitadaError } from '@/lib/arca/emitir'
import { totalesFacturaB } from '@/lib/facturacion/totales-factura'
import { logger } from '@/lib/logger'
import { MlApiError, type MlBuyerFiscal, type MlSaleOrder } from '@/lib/mercadolibre/client'
import {
  AVISO_LISTADO_INCOMPLETO,
  FacturacionMlError,
  claseSegunMl,
  decidirFacturaMl,
  documentoDeFiscal,
  elegirCuilPorNombre,
  facturarVentaMl,
  limpiarCachesFacturacionMl,
  listarVentasMl,
  nombreCoincideConMl,
  resolverCompradorMl,
  PESTANA_FACTURA_ML as PESTANA_FACTURA_ML_SERVIDOR,
  type ClaseFacturaMl,
  type CompradorMl,
} from '@/lib/mercadolibre/facturacion'
import {
  PESTANA_FACTURA_ML,
  avisoOtraClase,
  cuerpoFacturaMl,
  lineasDesdeVenta,
  motivoNoEmitir,
  opcionesCuilComprador,
  textoCondicionArca,
} from '@/lib/mercadolibre/facturacion-form'
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/mercadolibre/facturacion/route'

// ---------------------------------------------------------------------------
// Datos de prueba (CUIT/CUIL con dígito verificador válido, personas inventadas)
// ---------------------------------------------------------------------------

const PACK = '2000009000000001'
const CUIL_CF = '20-12345678-6'
const CUIT_RI = '30-71111111-1'
const CUIT_MONO = '20-35123456-4'
const CUIT_EXENTO = '30-70000000-8'

function orden(over: Partial<MlSaleOrder> = {}): MlSaleOrder {
  return {
    id: 4000000001,
    status: 'paid',
    date_created: '2026-10-03T10:00:00.000-03:00',
    date_closed: '2026-10-03T10:05:00.000-03:00',
    pack_id: Number(PACK),
    total_amount: 24200,
    buyer: { id: 1, nickname: 'COMPRADORML', billing_info: { id: 'BI-1' } },
    order_items: [{ item: { id: 'MLA1', title: 'Válvula esférica 1"' }, quantity: 2, unit_price: 12100 }],
    ...over,
  }
}

const fiscalCF: MlBuyerFiscal = {
  docType: 'CUIL',
  docNumber: '20123456786',
  name: 'Juan Perez',
  taxpayerType: 'Consumidor Final',
  address: { calle: 'Av. Siempreviva', numero: '742', ciudad: 'Rosario', provincia: 'Santa Fe', cp: '2000' },
}
const fiscalRI: MlBuyerFiscal = { docType: 'CUIT', docNumber: '30711111111', name: 'EMPRESA SA', taxpayerType: 'IVA Responsable Inscripto' }

function persona(over: Partial<PersonaPadron> = {}): PersonaPadron {
  return {
    cuit: '30711111111',
    razonSocial: 'EMPRESA SA',
    tipoPersona: 'JURIDICA',
    activo: true,
    tipoClave: 'CUIT',
    condicionIva: 'RESPONSABLE_INSCRIPTO',
    domicilio: { direccion: 'CALLE FALSA 123', localidad: 'ROSARIO', provincia: 'Santa Fe', codigoPostal: '2000' },
    actividadPrincipal: null,
    observaciones: [],
    ...over,
  }
}

// Texto exacto de ARCA para una clave inexistente (verificado en prod 5/10/2026)
const noExiste = () => new PadronError('No existe persona con ese Id', 404, { noExiste: true })
/** CUIL puro: ARCA devuelve datosGenerales con tipoClave CUIL, sin impuestos (no es un error) */
const personaCuil = (over: Partial<PersonaPadron> = {}) =>
  persona({ cuit: '20123456786', razonSocial: 'PEREZ JUAN', tipoPersona: 'FISICA', tipoClave: 'CUIL', condicionIva: null, ...over })

/** Padrón falso: CUIT (con o sin guiones) → persona o error */
function padron(tabla: Record<string, PersonaPadron | Error>) {
  ext.consultarPersona.mockImplementation(async (cuit: string) => {
    const d = cuit.replace(/\D/g, '')
    const k = Object.keys(tabla).find((x) => x.replace(/\D/g, '') === d)
    const v = k ? tabla[k] : noExiste()
    if (v instanceof Error) throw v
    return v
  })
}

let emisiones: Fila[] = []
/** Tabla ml_order_invoices en memoria (candado por packId) */
const candados = new Map<string, Fila>()
const dup = () => new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5.22.0' })

beforeEach(() => {
  vi.clearAllMocks()
  limpiarCachesFacturacionMl()
  process.env.FACTURACION_EMISOR = 'arca'
  delete process.env.ML_FACTURACION_DESDE
  delete process.env.ML_FACTURACION_CF_DESDE
  emisiones = []
  candados.clear()

  db.mlOrderInvoice.findMany.mockResolvedValue([])
  db.mlOrderInvoice.create.mockImplementation(async ({ data }: Fila) => {
    if (candados.has(data.packId)) throw dup()
    const fila = { status: 'EMITIENDO', invoiceId: null, ...data }
    candados.set(data.packId, fila)
    return fila
  })
  db.mlOrderInvoice.delete.mockImplementation(async ({ where }: Fila) => {
    const fila = candados.get(where.packId)
    candados.delete(where.packId)
    return fila
  })
  db.mlOrderInvoice.update.mockImplementation(async ({ where, data }: Fila) => {
    const fila = { ...candados.get(where.packId), ...data }
    candados.set(where.packId, fila)
    return fila
  })
  db.mlOrderInvoice.findUnique.mockImplementation(async ({ where }: Fila) => candados.get(where.packId) ?? null)
  db.mlItemLink.findMany.mockResolvedValue([])
  db.customer.findFirst.mockResolvedValue(null)
  db.customer.create.mockImplementation(async ({ data }: Fila) => ({ id: 'CUS1', fceObligado: false, colppyId: null, phone: null, email: null, ...data }))
  db.customer.update.mockImplementation(async ({ data }: Fila) => ({ id: 'CUS0', name: 'EXISTENTE', fceObligado: false, colppyId: null, ...data }))
  db.product.findMany.mockResolvedValue([])
  db.invoice.findMany.mockResolvedValue([])
  db.invoice.create.mockResolvedValue({ id: 'INV1' })
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db))

  ml.getPack.mockResolvedValue({ id: Number(PACK), orders: [{ id: 4000000001 }] })
  ml.getSaleOrder.mockResolvedValue(orden())
  ml.getBuyerFiscal.mockResolvedValue(fiscalCF)
  ml.getPackFiscalDocuments.mockRejectedValue(new MlApiError('404', 404, null))
  ml.uploadPackFiscalDocument.mockResolvedValue({ id: 'DOC1' })

  ext.emitirComprobante.mockImplementation(async (c: Fila) => {
    emisiones.push(c)
    return {
      ok: true,
      cbteTipo: c.letra === 'A' ? 1 : 6,
      puntoVenta: 7,
      numero: 12,
      numeroFormateado: '0007-00000012',
      cae: '76000000000012',
      caeVencimiento: new Date('2026-10-15'),
      fecha: new Date('2026-10-05T12:00:00Z'),
      observaciones: [],
    }
  })

  // Colppy falso: misma letra que el real, totales de precio final (la B con la
  // regla real, totalesFacturaB), llama al hook de ARCA
  ext.sendQuoteToColppy.mockImplementation(async (options: SendToColppyOptions, quote: Fila) => {
    const tipoFactura = letraFacturaColppy(quote.customer.taxCondition)
    const bruto = quote.items.reduce((s: number, i: Fila) => s + i.unitPrice * i.quantity, 0)
    const b = totalesFacturaB(quote.items.map((i: Fila) => ({ cantidad: i.quantity, precioFinal: i.unitPrice })))
    const netoA = Math.round((bruto / 1.21) * 100) / 100
    const ivaA = Math.round(netoA * 0.21 * 100) / 100
    const neto = tipoFactura === 'B' ? b.neto : netoA
    const iva = tipoFactura === 'B' ? b.iva : ivaA
    const total = tipoFactura === 'B' ? b.total : Math.round((netoA + ivaA) * 100) / 100
    const datos: EmisionExternaDatos = {
      tipoFactura,
      netoGravado: neto,
      totalIVA: iva,
      totalFactura: total,
      currency: 'ARS',
      exchangeRate: null,
      fechaFactura: new Date(),
      fechaVto: new Date(),
      idCondicionPago: 'Contado',
      descripcion: options.descripcion ?? '',
    }
    try {
      const emision = await options.emisionExterna!(datos)
      return {
        success: true,
        facturaId: 'COLPPY-F1',
        emision,
        colppyInvoicePayload: { idCliente: 'C77', tipoFactura, netoGravado: neto, totalIVA: iva, totalFactura: total, items: [] },
      }
    } catch (e) {
      return { success: false, error: (e as Error).message, errorStage: 'arca' }
    }
  })
})

afterEach(() => {
  delete process.env.FACTURACION_EMISOR
})

const user = { id: 'U1' }

async function error(p: Promise<unknown>): Promise<FacturacionMlError> {
  try {
    await p
  } catch (e) {
    return e as FacturacionMlError
  }
  throw new Error('se esperaba un error')
}

// ---------------------------------------------------------------------------
// Helpers puros
// ---------------------------------------------------------------------------

describe('clasificación según ML (listado)', () => {
  it('RI y Monotributo → A; CF, Exento y otros → B; sin dato → null', () => {
    expect(claseSegunMl('IVA Responsable Inscripto')).toBe('A')
    expect(claseSegunMl('Monotributo')).toBe('A')
    expect(claseSegunMl('Responsable Monotributo')).toBe('A')
    expect(claseSegunMl('Consumidor Final')).toBe('B')
    expect(claseSegunMl('IVA Exento')).toBe('B')
    expect(claseSegunMl('IVA Responsable No Inscripto')).toBe('B')
    expect(claseSegunMl(null)).toBeNull()
    expect(claseSegunMl('')).toBeNull()
    expect(claseSegunMl('01')).toBeNull() // id del billing-info viejo, no la descripción
  })

  it('documento: CUIT/CUIL normalizado, DNI de 7-8 dígitos, basura → null', () => {
    expect(documentoDeFiscal({ docType: 'CUIL', docNumber: '20123456786' })).toEqual({ tipo: 'CUIT', numero: CUIL_CF })
    expect(documentoDeFiscal({ docType: 'DNI', docNumber: '12.345.678' })).toEqual({ tipo: 'DNI', numero: '12345678' })
    expect(documentoDeFiscal({ docType: 'DNI', docNumber: '20123456786' })).toEqual({ tipo: 'CUIT', numero: CUIL_CF })
    expect(documentoDeFiscal({ docType: 'DNI', docNumber: '20123456789' })).toBeNull()
    expect(documentoDeFiscal({ docType: 'DNI', docNumber: '123456789' })).toBeNull()
    expect(documentoDeFiscal(null)).toBeNull()
  })
})

describe('decisión fiscal (manda ARCA)', () => {
  it('RI → A cond. RI con CUIT; Monotributo → A cond. MONOTRIBUTO', () => {
    expect(decidirFacturaMl(CUIT_RI, { estado: 'encontrado', persona: persona() })).toEqual({ clase: 'A', taxCondition: 'RESPONSABLE_INSCRIPTO', docTipo: 80, docNro: '30711111111' })
    expect(decidirFacturaMl(CUIT_MONO, { estado: 'encontrado', persona: persona({ condicionIva: 'MONOTRIBUTO' }) })).toMatchObject({ clase: 'A', taxCondition: 'MONOTRIBUTO', docTipo: 80 })
  })

  it('Exento → B con CUIT; sin IVA → B consumidor final con CUIT (o CUIL si ARCA dice CUIL)', () => {
    expect(decidirFacturaMl(CUIT_EXENTO, { estado: 'encontrado', persona: persona({ condicionIva: 'EXENTO' }) })).toEqual({ clase: 'B', taxCondition: 'EXENTO', docTipo: 80, docNro: '30700000008' })
    expect(decidirFacturaMl(CUIL_CF, { estado: 'encontrado', persona: persona({ condicionIva: null, tipoPersona: 'FISICA' }) })).toMatchObject({ clase: 'B', taxCondition: 'CONSUMIDOR_FINAL', docTipo: 80 })
    expect(decidirFacturaMl(CUIL_CF, { estado: 'encontrado', persona: persona({ condicionIva: null, tipoClave: 'CUIL' }) })).toMatchObject({ docTipo: 86 })
  })

  it('CUIL puro (tipoClave CUIL, sin IVA) → CUIL (86); no existe → DNI (96); nunca 99', () => {
    expect(decidirFacturaMl(CUIL_CF, { estado: 'encontrado', persona: personaCuil() })).toEqual({ clase: 'B', taxCondition: 'CONSUMIDOR_FINAL', docTipo: 86, docNro: '20123456786' })
    expect(decidirFacturaMl(CUIL_CF, { estado: 'no-existe', mensaje: '' })).toEqual({ clase: 'B', taxCondition: 'CONSUMIDOR_FINAL', docTipo: 96, docNro: '12345678' })
    expect(decidirFacturaMl('20-05123456-2', { estado: 'no-existe', mensaje: '' })).toMatchObject({ docTipo: 96, docNro: '5123456' })
  })

  it('sin IVA y sin observaciones: consumidor final también si es persona jurídica (consorcio, unión vecinal)', () => {
    const consorcio = persona({ cuit: '30700000008', razonSocial: 'CONSORCIO AV SIEMPREVIVA 742', tipoPersona: 'JURIDICA', condicionIva: null, observaciones: [] })
    expect(decidirFacturaMl(CUIT_EXENTO, { estado: 'encontrado', persona: consorcio })).toEqual({ clase: 'B', taxCondition: 'CONSUMIDOR_FINAL', docTipo: 80, docNro: '30700000008' })
  })

  it('sin IVA CON observaciones de ARCA (errorConstancia) → 422: no se adivina la condición', () => {
    const p = persona({ condicionIva: null, observaciones: ['El contribuyente registra inconsistencias en su domicilio fiscal'] })
    let e: FacturacionMlError | null = null
    try {
      decidirFacturaMl(CUIT_RI, { estado: 'encontrado', persona: p })
    } catch (x) {
      e = x as FacturacionMlError
    }
    expect(e).toMatchObject({ status: 422, codigo: 'CONDICION_IVA_INCIERTA' })
    expect(e!.message).toBe(
      'ARCA no puede confirmar la condición frente al IVA: El contribuyente registra inconsistencias en su domicilio fiscal (30-71111111-1). Verificá la constancia antes de facturar.'
    )
    // Con la condición informada las observaciones no frenan (manda la condición)
    expect(decidirFacturaMl(CUIT_RI, { estado: 'encontrado', persona: persona({ observaciones: ['x'] }) })).toMatchObject({ clase: 'A' })
  })

  it('persona con la clave inactiva → B con el DNI; sociedad inexistente o inactiva → error', () => {
    expect(decidirFacturaMl(CUIL_CF, { estado: 'encontrado', persona: persona({ condicionIva: null, tipoPersona: 'FISICA', activo: false }) })).toMatchObject({ clase: 'B', docTipo: 96, docNro: '12345678' })
    expect(() => decidirFacturaMl(CUIT_EXENTO, { estado: 'no-existe', mensaje: '' })).toThrow(/no tiene registrado/)
    expect(() => decidirFacturaMl(CUIT_RI, { estado: 'encontrado', persona: persona({ activo: false }) })).toThrow(/inactivo/)
  })
})

// ---------------------------------------------------------------------------
// Listado
// ---------------------------------------------------------------------------

describe('listarVentasMl', () => {
  const ordenesListado = () => [
    orden({ id: 1, pack_id: 11, buyer: { nickname: 'RI', billing_info: { id: 'B-RI' } } }),
    orden({ id: 2, pack_id: 22, buyer: { nickname: 'CF', billing_info: { id: 'B-CF' } } }),
    orden({ id: 3, pack_id: 33, buyer: { nickname: 'SIN', billing_info: { id: 'B-SIN' } } }),
    orden({ id: 4, pack_id: 44, buyer: { nickname: 'FACT', billing_info: { id: 'B-FACT' } } }),
    orden({ id: 5, pack_id: 55, buyer: { nickname: 'LOCK', billing_info: { id: 'B-LOCK' } } }),
  ]

  beforeEach(() => {
    ml.searchPaidOrdersSince.mockImplementation(async (_d: Date, _max: number, info?: { total?: number }) => {
      if (info) info.total = 5
      return ordenesListado()
    })
    ml.getBuyerFiscal.mockImplementation(async (o: MlSaleOrder) => {
      if (o.id === 1) return fiscalRI
      if (o.id === 2) return fiscalCF
      throw new MlApiError('403', 403, null)
    })
    db.mlOrderInvoice.findMany.mockResolvedValue([
      { packId: '44', cuit: CUIL_CF, status: 'EMITIDA', mlUploadStatus: 'OK', mlUploadError: null, invoice: { id: 'I4', invoiceNumber: 'B-0007-00000001', invoiceType: 'B', colppySyncStatus: 'OK' } },
      { packId: '55', cuit: CUIT_RI, status: 'EMITIENDO', mlUploadStatus: null, mlUploadError: null, invoice: null },
    ])
  })

  it('clasifica cada venta en su pestaña y cuenta pendientes', async () => {
    const r = await listarVentasMl()
    const por = Object.fromEntries(r.ventas.map((v) => [v.packId, v]))
    expect(por['11']).toMatchObject({ clase: 'A', claseOrigen: 'ml', cuit: '30-71111111-1' })
    expect(por['22']).toMatchObject({ clase: 'B', claseOrigen: 'ml', cuit: CUIL_CF, documentoMl: { tipo: 'CUIT', numero: CUIL_CF } })
    expect(por['33']).toMatchObject({ clase: 'B', claseOrigen: 'sin-dato', fiscal: null })
    expect(por['44']).toMatchObject({ clase: 'B', claseOrigen: 'factura', facturada: { invoiceNumber: 'B-0007-00000001' } })
    expect(por['55']).toMatchObject({ clase: null, claseOrigen: 'candado' })
    expect(r.sinPermisoFiscal).toBe(true)
    expect(r.conteos).toEqual({ A: { total: 1, pendientes: 1 }, B: { total: 3, pendientes: 2 }, revisar: 1 })
    expect(r.truncado).toBe(false)
    expect(r).not.toHaveProperty('excluidasNoRI')
  })

  it('llamadas a ML acotadas: una por venta pendiente y nada para las facturadas; la segunda vez sale del caché', async () => {
    await listarVentasMl()
    expect(ml.getBuyerFiscal).toHaveBeenCalledTimes(3)
    expect(ml.getPackFiscalDocuments).toHaveBeenCalledTimes(3)
    expect(ml.getBuyerFiscal.mock.calls.map((c) => (c[0] as MlSaleOrder).id).sort()).toEqual([1, 2, 3])

    await listarVentasMl()
    // Los datos fiscales se cachean (los 403 no) y "sin factura en ML" vale 3 minutos
    expect(ml.getBuyerFiscal).toHaveBeenCalledTimes(4)
    expect(ml.getPackFiscalDocuments).toHaveBeenCalledTimes(3)
  })

  it('tope de órdenes por defecto 3000 (ML_FACTURACION_MAX_ORDENES lo cambia)', async () => {
    await listarVentasMl()
    expect(ml.searchPaidOrdersSince.mock.calls[0][1]).toBe(3000)
    process.env.ML_FACTURACION_MAX_ORDENES = '500'
    try {
      await listarVentasMl()
      expect(ml.searchPaidOrdersSince.mock.calls[1][1]).toBe(500)
    } finally {
      delete process.env.ML_FACTURACION_MAX_ORDENES
    }
  })

  it('con muchas ventas ya facturadas: ninguna llamada fiscal a ML por ellas (ni billing-info ni fiscal_documents)', async () => {
    const muchas = Array.from({ length: 260 }, (_, i) => orden({ id: 1000 + i, pack_id: 9000 + i, buyer: { nickname: `B${i}`, billing_info: { id: `BI-${i}` } } }))
    ml.searchPaidOrdersSince.mockImplementation(async (_d: Date, _max: number, info?: { total?: number }) => {
      if (info) info.total = muchas.length
      return muchas
    })
    // Todas facturadas desde el ERP salvo las 3 más viejas
    db.mlOrderInvoice.findMany.mockResolvedValue(
      muchas.slice(0, 257).map((o) => ({ packId: String(o.pack_id), cuit: CUIL_CF, status: 'EMITIDA', mlUploadStatus: 'OK', mlUploadError: null, invoice: { id: `I${o.id}`, invoiceNumber: `B-0007-${o.id}`, invoiceType: 'B', colppySyncStatus: 'OK' } }))
    )
    ml.getBuyerFiscal.mockResolvedValue(fiscalCF)
    const r = await listarVentasMl()
    expect(r.ventas).toHaveLength(260)
    expect(r.truncado).toBe(false)
    // Solo las 3 pendientes (las más viejas, más allá de las primeras 200) consultan a ML
    expect(ml.getBuyerFiscal).toHaveBeenCalledTimes(3)
    expect(ml.getPackFiscalDocuments).toHaveBeenCalledTimes(3)
    expect(ml.getPackFiscalDocuments.mock.calls.map((c) => c[0]).sort()).toEqual(['9257', '9258', '9259'])
    expect(r.conteos.B).toEqual({ total: 260, pendientes: 3 })
  })

  it('ML no pudo confirmar si tiene factura (error ≠ 404): facturaEnMl null y sigue pendiente', async () => {
    ml.getPackFiscalDocuments.mockImplementation(async (p: string) => {
      if (p === '22') throw new MlApiError('500', 500, null)
      throw new MlApiError('404', 404, null)
    })
    const r = await listarVentasMl()
    expect(r.ventas.find((v) => v.packId === '22')!.facturaEnMl).toBeNull()
    expect(r.ventas.find((v) => v.packId === '33')!.facturaEnMl).toBe(false)
    expect(r.conteos.B.pendientes).toBe(2)
  })

  it('factura ya adjunta en ML: no cuenta como pendiente', async () => {
    ml.getPackFiscalDocuments.mockImplementation(async (p: string) => (p === '22' ? [{ id: 'X' }] : []))
    const r = await listarVentasMl()
    expect(r.ventas.find((v) => v.packId === '22')!.facturaEnMl).toBe(true)
    expect(r.conteos.B.pendientes).toBe(1)
  })

  it('corte propio de la pestaña B (ML_FACTURACION_CF_DESDE)', async () => {
    process.env.ML_FACTURACION_DESDE = '2026-10-01T00:00:00-03:00'
    process.env.ML_FACTURACION_CF_DESDE = '2026-10-04T00:00:00-03:00'
    const r = await listarVentasMl()
    // Ventas del 3/10: la A entra, las B (CF y sin dato) quedan afuera
    expect(r.ventas.map((v) => v.packId).sort()).toEqual(['11', '44', '55'])
    expect(r.desdeB).toBe(new Date('2026-10-04T03:00:00Z').toISOString())
    expect(ml.searchPaidOrdersSince.mock.calls[0][0]).toEqual(new Date('2026-10-01T03:00:00Z'))
  })

  it('avisa si ML tiene más ventas que el tope', async () => {
    ml.searchPaidOrdersSince.mockImplementation(async (_d: Date, _m: number, info?: { total?: number }) => {
      if (info) info.total = 340
      return ordenesListado()
    })
    expect((await listarVentasMl()).truncado).toBe(true)
  })

  it('posible duplicado: factura del ERP al mismo CUIT por el mismo total cerca de la fecha', async () => {
    db.invoice.findMany.mockResolvedValue([
      { id: 'IX', invoiceNumber: 'B-0003-00012345', issueDate: new Date('2026-10-04T15:00:00Z'), total: new Prisma.Decimal(24199.5), customer: { cuit: '20123456786' } },
      { id: 'IY', invoiceNumber: 'B-0003-00012346', issueDate: new Date('2026-10-04T15:00:00Z'), total: new Prisma.Decimal(30000), customer: { cuit: '20123456786' } },
    ])
    const r = await listarVentasMl()
    expect(r.ventas.find((v) => v.packId === '22')!.posibleDuplicado).toMatchObject({ invoiceId: 'IX', invoiceNumber: 'B-0003-00012345', total: 24199.5 })
    expect(r.ventas.find((v) => v.packId === '11')!.posibleDuplicado).toBeNull()
    const where = db.invoice.findMany.mock.calls[0][0].where
    expect(where).toMatchObject({ transactionType: 'SALE', mlOrderInvoice: { is: null }, status: { not: 'CANCELLED' } })
    expect(where.customer.cuit.in).toEqual(expect.arrayContaining([CUIL_CF, '20123456786', CUIT_RI, '30711111111']))
  })
})

// ---------------------------------------------------------------------------
// Emisión: pestaña B
// ---------------------------------------------------------------------------

describe('facturarVentaMl — Factura B (consumidor final)', () => {
  it('CUIL que ARCA tiene sin IVA: alta del cliente con su CUIL y emite B cond. 5 con CUIT', async () => {
    padron({ [CUIL_CF]: persona({ cuit: '20123456786', razonSocial: 'PEREZ JUAN', tipoPersona: 'FISICA', condicionIva: null, domicilio: { direccion: 'SAN MARTIN 100', localidad: 'ROSARIO', provincia: 'Santa Fe', codigoPostal: '2000' } }) })
    const r = await facturarVentaMl({ packId: PACK, clase: 'B', user })

    expect(r).toMatchObject({ clase: 'B', invoiceNumber: 'B-0007-00000012', cae: '76000000000012', colppyPendiente: false, mlUpload: { ok: true } })
    expect(db.customer.create.mock.calls[0][0].data).toMatchObject({
      name: 'PEREZ JUAN',
      businessName: 'PEREZ JUAN',
      type: 'INDIVIDUAL',
      cuit: CUIL_CF,
      taxCondition: 'CONSUMIDOR_FINAL',
      address: 'SAN MARTIN 100',
      notes: `Alta automática desde venta de Mercado Libre #${PACK}`,
    })
    // Colppy: el cliente por su CUIL (nunca uno genérico), precios finales
    const [opts, quote] = ext.sendQuoteToColppy.mock.calls[0]
    expect(opts).toMatchObject({ action: 'factura-contado', descripcion: `Venta Mercado Libre #${PACK}` })
    expect(quote).toMatchObject({ currency: 'ARS', pricesIncludeTax: true, customer: { name: 'PEREZ JUAN', cuit: CUIL_CF, taxCondition: 'CONSUMIDOR_FINAL', city: 'ROSARIO', province: 'Santa Fe' } })
    expect(emisiones[0]).toMatchObject({ letra: 'B', receptor: { condicionIvaId: 5, docTipo: 80, docNro: '20123456786' }, importes: { total: 24200 } })
    const inv = db.invoice.create.mock.calls[0][0].data
    expect(inv).toMatchObject({ invoiceType: 'B', cbteTipo: 6, docTipo: 80, docNro: '20123456786', total: 24200, customerId: 'CUS1' })
    expect(inv.notes).toMatch(/^Venta Mercado Libre #2000009000000001\./)
    expect(db.mlOrderInvoice.create.mock.calls[0][0].data).toMatchObject({ packId: PACK, cuit: CUIL_CF, total: 24200 })
    expect(db.mlOrderInvoice.update).toHaveBeenCalledWith({ where: { packId: PACK }, data: { invoiceId: 'INV1', status: 'EMITIDA' } })
    expect(ml.uploadPackFiscalDocument).toHaveBeenCalledWith(PACK, expect.any(Buffer), 'factura.pdf')
    // Id de Colppy guardado en el cliente nuevo
    expect(db.customer.update).toHaveBeenCalledWith({ where: { id: 'CUS1' }, data: { colppyId: 'C77' } })
  })

  it('CUIL que ARCA no tiene: consumidor final con nombre y domicilio de ML, identificado con el DNI (96)', async () => {
    padron({})
    const r = await facturarVentaMl({ packId: PACK, clase: 'B', user })
    expect(r.clase).toBe('B')
    expect(db.customer.create.mock.calls[0][0].data).toMatchObject({
      name: 'JUAN PEREZ',
      type: 'INDIVIDUAL',
      cuit: CUIL_CF,
      taxCondition: 'CONSUMIDOR_FINAL',
      address: 'Av. Siempreviva 742',
      city: 'Rosario',
      province: 'Santa Fe',
      postalCode: '2000',
    })
    expect(emisiones[0].receptor).toEqual({ condicionIvaId: 5, docTipo: 96, docNro: '12345678' })
    expect(db.invoice.create.mock.calls[0][0].data).toMatchObject({ docTipo: 96, docNro: '12345678' })
    expect(ext.sendQuoteToColppy.mock.calls[0][1].customer).toMatchObject({ cuit: CUIL_CF, name: 'JUAN PEREZ', address: 'Av. Siempreviva 742', city: 'Rosario' })
  })

  it('CUIL puro en ARCA (tipoClave CUIL, no es un error): consumidor final con DocTipo 86', async () => {
    padron({ [CUIL_CF]: personaCuil() })
    await facturarVentaMl({ packId: PACK, clase: 'B', user })
    expect(emisiones[0].receptor).toEqual({ condicionIvaId: 5, docTipo: 86, docNro: '20123456786' })
    expect(db.customer.create.mock.calls[0][0].data).toMatchObject({ name: 'PEREZ JUAN', taxCondition: 'CONSUMIDOR_FINAL', type: 'INDIVIDUAL' })
  })

  it('consorcio (persona jurídica sin IVA ni observaciones): Factura B consumidor final con su CUIT', async () => {
    ml.getBuyerFiscal.mockResolvedValue({ docType: 'CUIT', docNumber: '30700000008', name: 'CONSORCIO', taxpayerType: 'Consumidor Final' })
    padron({ [CUIT_EXENTO]: persona({ cuit: '30700000008', razonSocial: 'CONSORCIO AV SIEMPREVIVA 742', condicionIva: null }) })
    const r = await facturarVentaMl({ packId: PACK, clase: 'B', user })
    expect(r.clase).toBe('B')
    expect(emisiones[0].receptor).toEqual({ condicionIvaId: 5, docTipo: 80, docNro: '30700000008' })
    expect(db.customer.create.mock.calls[0][0].data).toMatchObject({ taxCondition: 'CONSUMIDOR_FINAL', type: 'BUSINESS' })
  })

  it('ARCA sin condición IVA pero con observaciones → 422 con las observaciones, sin candado ni emisión', async () => {
    padron({ [CUIL_CF]: personaCuil({ tipoClave: 'CUIT', observaciones: ['La CUIT se encuentra con inconsistencias'] }) })
    const e = await error(facturarVentaMl({ packId: PACK, clase: 'B', user }))
    expect(e).toMatchObject({ status: 422, codigo: 'CONDICION_IVA_INCIERTA' })
    expect(e.message).toMatch(/^ARCA no puede confirmar la condición frente al IVA: La CUIT se encuentra con inconsistencias/)
    expect(e.message).toMatch(/Verificá la constancia antes de facturar/)
    expect(db.mlOrderInvoice.create).not.toHaveBeenCalled()
    expect(ext.emitirComprobante).not.toHaveBeenCalled()
    // El borrador lo muestra como motivo y no habilita ninguna letra
    const c = await resolverCompradorMl(PACK)
    expect(c).toMatchObject({ clase: null, padron: 'encontrado', receptor: null })
    expect(c.motivo).toMatch(/ARCA no puede confirmar la condición frente al IVA/)
  })

  it('nombre y domicilio del borrador si ARCA no tiene al comprador', async () => {
    padron({})
    await facturarVentaMl({
      packId: PACK,
      clase: 'B',
      nombre: '  maria   gomez ',
      domicilio: { direccion: 'Belgrano 55', localidad: 'Palermo', provincia: 'Capital Federal', codigoPostal: '1425' },
      user,
    })
    expect(db.customer.create.mock.calls[0][0].data).toMatchObject({ name: 'MARIA GOMEZ', address: 'Belgrano 55', city: 'Palermo', province: 'CABA', postalCode: '1425' })
  })

  it('Exento en ARCA: Factura B condición 4 y cliente EXENTO', async () => {
    ml.getBuyerFiscal.mockResolvedValue({ docType: 'CUIT', docNumber: '30700000008', name: 'FUNDACION', taxpayerType: 'IVA Exento' })
    padron({ [CUIT_EXENTO]: persona({ cuit: '30700000008', razonSocial: 'FUNDACION X', condicionIva: 'EXENTO' }) })
    const r = await facturarVentaMl({ packId: PACK, clase: 'B', user })
    expect(r.clase).toBe('B')
    expect(emisiones[0].receptor).toEqual({ condicionIvaId: 4, docTipo: 80, docNro: '30700000008' })
    expect(db.customer.create.mock.calls[0][0].data).toMatchObject({ taxCondition: 'EXENTO', type: 'BUSINESS', name: 'FUNDACION X' })
    expect(ext.sendQuoteToColppy.mock.calls[0][1].customer.taxCondition).toBe('EXENTO')
  })

  it.each([
    ['RESPONSABLE_INSCRIPTO', /Responsable Inscripto: va por Factura A/],
    ['MONOTRIBUTO', /Monotributista: va por Factura A/],
  ] as const)('ARCA dice %s en la pestaña B → 409, no emite ni toma el candado', async (condicionIva, msg) => {
    padron({ [CUIL_CF]: persona({ condicionIva }) })
    const e = await error(facturarVentaMl({ packId: PACK, clase: 'B', user }))
    expect(e).toBeInstanceOf(FacturacionMlError)
    expect(e).toMatchObject({ status: 409, codigo: 'CLASE_INCORRECTA', claseCorrecta: 'A' })
    expect(e.message).toMatch(msg)
    expect(db.mlOrderInvoice.create).not.toHaveBeenCalled()
    expect(ext.emitirComprobante).not.toHaveBeenCalled()
  })

  const clienteExistente = (taxCondition: string) => ({ id: 'CUS0', name: 'PEREZ', cuit: '20123456786', taxCondition, fceObligado: false, colppyId: '41', address: null, city: null, province: null, postalCode: null, phone: null, email: null })

  it('cliente existente con otra condición permitida (Exento → CF): se actualiza a la de ARCA y no se crea otro', async () => {
    padron({ [CUIL_CF]: persona({ condicionIva: null, tipoPersona: 'FISICA' }) })
    const existente = clienteExistente('EXENTO')
    db.customer.findFirst.mockResolvedValue(existente)
    db.customer.update.mockImplementation(async ({ data }: Fila) => ({ ...existente, ...data }))
    await facturarVentaMl({ packId: PACK, clase: 'B', user })
    expect(db.customer.findFirst.mock.calls[0][0]).toEqual({ where: { OR: [{ cuit: CUIL_CF }, { cuit: '20123456786' }] } })
    expect(db.customer.create).not.toHaveBeenCalled()
    expect(db.customer.update).toHaveBeenCalledWith({ where: { id: 'CUS0' }, data: { taxCondition: 'CONSUMIDOR_FINAL' } })
    expect(db.customer.update).toHaveBeenCalledTimes(1) // ya tenía id de Colppy
  })

  it.each(['RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO'])(
    'cliente del ERP %s y ARCA dice consumidor final → 422, el cliente queda como estaba, sin candado ni ARCA',
    async (taxCondition) => {
      padron({ [CUIL_CF]: persona({ condicionIva: null, tipoPersona: 'FISICA', razonSocial: 'PEREZ' }) })
      db.customer.findFirst.mockResolvedValue(clienteExistente(taxCondition))
      const e = await error(facturarVentaMl({ packId: PACK, clase: 'B', user }))
      expect(e).toMatchObject({ status: 422, codigo: 'CONDICION_DISTINTA_ERP' })
      expect(e.message).toMatch(/^El ERP tiene a PEREZ \(20-12345678-6\) como (Responsable Inscripto|Monotributista) y ARCA lo informa como Consumidor Final/)
      expect(db.customer.update).not.toHaveBeenCalled()
      expect(db.customer.create).not.toHaveBeenCalled()
      expect(db.mlOrderInvoice.create).not.toHaveBeenCalled()
      expect(ext.sendQuoteToColppy).not.toHaveBeenCalled()
      expect(ext.emitirComprobante).not.toHaveBeenCalled()
      // El borrador avisa lo mismo y no habilita la B
      const c = await resolverCompradorMl(PACK)
      expect(c.clase).toBeNull()
      expect(c.motivo).toMatch(/El ERP tiene a PEREZ/)
    }
  )

  it('cliente del ERP RI y ARCA dice Exento → 422 (tampoco se baja a Exento)', async () => {
    padron({ [CUIL_CF]: persona({ condicionIva: 'EXENTO', tipoPersona: 'FISICA', razonSocial: 'PEREZ' }) })
    db.customer.findFirst.mockResolvedValue(clienteExistente('RESPONSABLE_INSCRIPTO'))
    const e = await error(facturarVentaMl({ packId: PACK, clase: 'B', user }))
    expect(e).toMatchObject({ status: 422, codigo: 'CONDICION_DISTINTA_ERP' })
    expect(db.customer.update).not.toHaveBeenCalled()
  })

  it('CUIT/CUIL del borrador con dígito verificador inválido → 400', async () => {
    const e = await error(facturarVentaMl({ packId: PACK, clase: 'B', cuitManual: '20-12345678-9', user }))
    expect(e).toMatchObject({ status: 400, codigo: 'CUIT_INVALIDO' })
  })

  it('el CUIT/CUIL del borrador pisa al de ML', async () => {
    padron({ '27-12345678-0': persona({ condicionIva: null, tipoPersona: 'FISICA', razonSocial: 'PEREZ ANA' }) })
    await facturarVentaMl({ packId: PACK, clase: 'B', cuitManual: '27123456780', user })
    expect(db.customer.create.mock.calls[0][0].data).toMatchObject({ cuit: '27-12345678-0', name: 'PEREZ ANA' })
  })
})

describe('facturarVentaMl — ML solo informa el DNI', () => {
  beforeEach(() => {
    ml.getBuyerFiscal.mockResolvedValue({ docType: 'DNI', docNumber: '12345678', name: 'Ana Perez', taxpayerType: 'Consumidor Final' })
  })

  it('consulta TODOS los CUIL posibles (en orden) y, si ARCA conoce uno solo, usa ese', async () => {
    padron({ '27-12345678-0': persona({ condicionIva: null, tipoPersona: 'FISICA', razonSocial: 'PEREZ ANA' }) })
    await facturarVentaMl({ packId: PACK, clase: 'B', user })
    expect(ext.consultarPersona.mock.calls.map((c) => c[0])).toEqual(['20-12345678-6', '27-12345678-0', '23-12345678-5', '24-12345678-1'])
    expect(db.customer.create.mock.calls[0][0].data).toMatchObject({ cuit: '27-12345678-0', name: 'PEREZ ANA' })
    expect(emisiones[0].receptor).toEqual({ condicionIvaId: 5, docTipo: 80, docNro: '27123456780' })
  })

  it('ARCA no reconoce ninguno: hay que ingresar el CUIT/CUIL (422), sin emitir', async () => {
    padron({})
    const e = await error(facturarVentaMl({ packId: PACK, clase: 'B', user }))
    expect(e).toMatchObject({ status: 422, codigo: 'CUIT_REQUERIDO' })
    expect(ext.consultarPersona).toHaveBeenCalledTimes(4)
    expect(db.mlOrderInvoice.create).not.toHaveBeenCalled()
  })

  it('ARCA caído: corta en el primer error (502), sin emitir', async () => {
    padron({ '20-12345678-6': new PadronError('Error de ARCA', 502) })
    const e = await error(facturarVentaMl({ packId: PACK, clase: 'B', user }))
    expect(e).toMatchObject({ status: 502 })
    expect(ext.consultarPersona).toHaveBeenCalledTimes(1)
  })

  it('resolverCompradorMl: devuelve el CUIL derivado, los candidatos y lo que se emitiría', async () => {
    padron({ '27-12345678-0': persona({ condicionIva: null, tipoPersona: 'FISICA', razonSocial: 'PEREZ ANA' }) })
    const r = await resolverCompradorMl(PACK)
    expect(r).toMatchObject({
      cuit: '27-12345678-0',
      origen: 'padron',
      documentoMl: { tipo: 'DNI', numero: '12345678' },
      padron: 'encontrado',
      razonSocial: 'PEREZ ANA',
      clase: 'B',
      condicionIva: 'CONSUMIDOR_FINAL',
      receptor: { docTipo: 80, docNro: '27123456780' },
      nombreSugerido: 'PEREZ ANA',
      facturaEnMl: false,
      motivo: null,
    })
    expect(r.candidatos).toEqual([
      { cuit: '20-12345678-6', resultado: 'no-existe' },
      { cuit: '27-12345678-0', resultado: 'encontrado', nombreArca: 'PEREZ ANA' },
      { cuit: '23-12345678-5', resultado: 'no-existe' },
      { cuit: '24-12345678-1', resultado: 'no-existe' },
    ])
  })

  it('resolverCompradorMl: sin CUIL en ARCA → manual-requerido con el motivo', async () => {
    padron({})
    const r = await resolverCompradorMl(PACK)
    expect(r).toMatchObject({ cuit: null, origen: 'manual-requerido', clase: null, nombreSugerido: 'Ana Perez' })
    expect(r.motivo).toMatch(/Ingresá el CUIT\/CUIL/)
  })

  it('resolverCompradorMl: ?cuit= inválido → 400; válido → origen manual', async () => {
    await expect(resolverCompradorMl(PACK, '20-12345678-9')).rejects.toMatchObject({ status: 400, codigo: 'CUIT_INVALIDO' })
    padron({ '20-12345678-6': personaCuil() })
    expect(await resolverCompradorMl(PACK, '20123456786')).toMatchObject({ cuit: CUIL_CF, origen: 'manual', padron: 'encontrado', receptor: { docTipo: 86 } })
  })

  it('un error de ARCA que no es "no existe" corta la búsqueda del CUIL y se informa (no se saltea)', async () => {
    // errorConstancia sin datos generales: 404 pero NO "No existe persona"
    padron({ '20-12345678-6': new PadronError('La clave se encuentra con errores de constancia', 404) })
    const c = await resolverCompradorMl(PACK)
    expect(ext.consultarPersona).toHaveBeenCalledTimes(1)
    expect(c).toMatchObject({ cuit: null, clase: null, origen: 'manual-requerido' })
    expect(c.candidatos[0]).toMatchObject({ cuit: '20-12345678-6', resultado: 'error' })
    expect(c.candidatos[0].detalle).toMatch(/La clave se encuentra con errores de constancia/)
    expect(c.motivo).toMatch(/no se pudo consultar ARCA/)

    ext.consultarPersona.mockClear()
    const e = await error(facturarVentaMl({ packId: PACK, clase: 'B', user }))
    expect(e).toMatchObject({ status: 502 })
    expect(e.message).toMatch(/La clave se encuentra con errores de constancia/)
    expect(ext.consultarPersona).toHaveBeenCalledTimes(1)
    expect(db.mlOrderInvoice.create).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Padrón: solo "No existe persona con ese Id" es "no existe"
// ---------------------------------------------------------------------------

describe('padrón — errores que no son "no existe"', () => {
  it.each([
    ['clave inválida (otro 404)', new PadronError('La CUIT 20123456786 es inválida', 404)],
    ['errorConstancia sin datos generales (otro 404)', new PadronError('Error en la constancia de inscripción', 404)],
    ['ARCA caído', new PadronError('Error de ARCA', 502)],
  ])('%s: el POST responde 502 con el mensaje de ARCA y no emite', async (_caso, err) => {
    padron({ [CUIL_CF]: err })
    const res = await POST(
      new NextRequest('http://localhost/api/mercadolibre/facturacion', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ packId: PACK, clase: 'B', cuit: CUIL_CF }),
      })
    )
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe(`ARCA (padrón): ${err.message}`)
    expect(db.mlOrderInvoice.create).not.toHaveBeenCalled()
    expect(ext.sendQuoteToColppy).not.toHaveBeenCalled()
    expect(ext.emitirComprobante).not.toHaveBeenCalled()
  })

  it('/comprador: el error va como motivo y sin letra (el borrador no emite)', async () => {
    padron({ [CUIL_CF]: new PadronError('La CUIT 20123456786 es inválida', 404) })
    const c = await resolverCompradorMl(PACK)
    expect(c).toMatchObject({ cuit: CUIL_CF, padron: null, clase: null, receptor: null })
    expect(c.motivo).toBe('ARCA (padrón): La CUIT 20123456786 es inválida')
    expect(motivoNoEmitir({ clase: 'B', comprador: c, cuitIngresado: CUIL_CF, nombre: 'X', lineas: lineasDesdeVenta([{ title: 'V', quantity: 1, unitPrice: 100, productId: null, sku: null, productName: null }]), facturaEnMl: false, confirmaFacturaEnMl: false })).toBe(c.motivo)
  })

  it('"No existe persona con ese Id" (noExiste): consumidor final con el DNI', async () => {
    padron({ [CUIL_CF]: noExiste() })
    const c = await resolverCompradorMl(PACK)
    expect(c).toMatchObject({ padron: 'no-existe', clase: 'B', receptor: { docTipo: 96, docNro: '12345678' } })
  })
})

// ---------------------------------------------------------------------------
// Emisión: guardas
// ---------------------------------------------------------------------------

describe('facturarVentaMl — guardas', () => {
  it('clase inválida → 400', async () => {
    const e = await error(facturarVentaMl({ packId: PACK, clase: 'C' as never, user }))
    expect(e).toMatchObject({ status: 400, codigo: 'CLASE_INVALIDA' })
    expect(ml.getPack).not.toHaveBeenCalled()
  })

  it('factura ya adjunta en ML: sin confirmar → 409; confirmando → emite', async () => {
    padron({ [CUIL_CF]: noExiste() })
    ml.getPackFiscalDocuments.mockResolvedValue([{ id: 'COLPPY-PDF' }])
    const e = await error(facturarVentaMl({ packId: PACK, clase: 'B', user }))
    expect(e).toMatchObject({ status: 409, codigo: 'FACTURA_EN_ML' })
    expect(db.mlOrderInvoice.create).not.toHaveBeenCalled()

    const r = await facturarVentaMl({ packId: PACK, clase: 'B', confirmarFacturaEnMl: true, estadoFacturaEnMlConfirmado: true, user })
    expect(r.invoiceNumber).toBe('B-0007-00000012')
  })

  it('candado: venta ya facturada (P2002) → 409 YA_FACTURADA, sin emitir', async () => {
    padron({})
    db.mlOrderInvoice.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5.22.0' }))
    const e = await error(facturarVentaMl({ packId: PACK, clase: 'B', user }))
    expect(e).toMatchObject({ status: 409, codigo: 'YA_FACTURADA' })
    expect(ext.emitirComprobante).not.toHaveBeenCalled()
  })

  it('ARCA rechaza en forma definitiva: se libera el candado para reintentar', async () => {
    padron({})
    ext.emitirComprobante.mockResolvedValue({ ok: false, cbteTipo: 6, puntoVenta: 7, numero: 13, mensaje: '10015: documento no válido', errores: [] })
    const e = await error(facturarVentaMl({ packId: PACK, clase: 'B', user }))
    expect(e.message).toMatch(/ARCA rechazó la factura/)
    expect(db.mlOrderInvoice.delete).toHaveBeenCalledWith({ where: { packId: PACK } })
    expect(candados.has(PACK)).toBe(false)
  })

  it('corte de red DESPUÉS de pedir el CAE: el candado queda en EMITIENDO, 502 "NO reintentes" y log [ML_ARCA_INCIERTO]', async () => {
    padron({})
    ext.emitirComprobante.mockRejectedValue(new EmisionInciertaError(new Error('socket hang up'), 6, 7, 13))
    const e = await error(facturarVentaMl({ packId: PACK, clase: 'B', user }))
    expect(e).toMatchObject({ status: 502, codigo: 'ARCA_INCIERTO' })
    expect(e.message).toMatch(/^ARCA no confirmó la factura: NO reintentes; queda para revisar/)
    expect(e.message).toContain('(Factura B PV 0007 N° 13: socket hang up)')
    expect(db.mlOrderInvoice.delete).not.toHaveBeenCalled()
    expect(candados.get(PACK)).toMatchObject({ status: 'EMITIENDO', invoiceId: null })
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringMatching(/^\[ML_ARCA_INCIERTO\].*scripts\/ml-reconciliar-emitiendo\.ts --pack 2000009000000001/),
      expect.objectContaining({ packId: PACK, cbteTipo: 6, puntoVenta: 7, numeroEsperado: 13 })
    )
    expect(db.invoice.create).not.toHaveBeenCalled()

    // El reintento choca con el candado (no sale otro CAE) y la venta queda para revisar
    ext.emitirComprobante.mockClear()
    const otra = await error(facturarVentaMl({ packId: PACK, clase: 'B', user }))
    expect(otra).toMatchObject({ status: 409, codigo: 'YA_FACTURADA' })
    expect(ext.emitirComprobante).not.toHaveBeenCalled()
  })

  it('cualquier error al llamar a ARCA (resultado desconocido): el candado también queda', async () => {
    padron({})
    ext.emitirComprobante.mockRejectedValue(new Error('ECONNRESET'))
    const e = await error(facturarVentaMl({ packId: PACK, clase: 'B', user }))
    expect(e).toMatchObject({ status: 502, codigo: 'ARCA_INCIERTO' })
    expect(e.message).toContain('N° desconocido')
    expect(candados.has(PACK)).toBe(true)
  })

  it('ARCA falló ANTES de pedir el CAE (WSAA / último número): se libera el candado', async () => {
    padron({})
    ext.emitirComprobante.mockRejectedValue(new EmisionNoSolicitadaError(new Error('WSAA caído'), 6, 7))
    const e = await error(facturarVentaMl({ packId: PACK, clase: 'B', user }))
    expect(e.codigo).toBeUndefined()
    expect(e).toMatchObject({ status: 502, message: 'No se pudo pedir el CAE a ARCA (no se emitió nada; se puede reintentar): WSAA caído' })
    expect(db.mlOrderInvoice.delete).toHaveBeenCalledWith({ where: { packId: PACK } })
    expect(candados.has(PACK)).toBe(false)
  })

  it('falla antes de llamar a ARCA (cliente en Colppy): se libera el candado', async () => {
    padron({})
    ext.sendQuoteToColppy.mockResolvedValue({ success: false, error: 'Error al crear cliente en Colppy: timeout', errorStage: 'colppy' })
    const e = await error(facturarVentaMl({ packId: PACK, clase: 'B', user }))
    expect(e.message).toMatch(/Error al registrar en Colppy/)
    expect(ext.emitirComprobante).not.toHaveBeenCalled()
    expect(db.mlOrderInvoice.delete).toHaveBeenCalledWith({ where: { packId: PACK } })
    expect(candados.has(PACK)).toBe(false)
  })

  it('venta ya registrada en el ERP: 409 YA_FACTURADA antes del aviso de "factura en ML" y sin llamar a ML', async () => {
    candados.set(PACK, { packId: PACK, status: 'EMITIDA', invoiceId: 'INV9' })
    ml.getPackFiscalDocuments.mockResolvedValue([{ id: 'PDF-DEL-ERP' }])
    const e = await error(facturarVentaMl({ packId: PACK, clase: 'B', user }))
    expect(e).toMatchObject({ status: 409, codigo: 'YA_FACTURADA', message: 'Esta venta ya fue facturada (o se está facturando en este momento)' })
    expect(db.mlOrderInvoice.findUnique).toHaveBeenCalledWith({ where: { packId: PACK } })
    expect(ml.getPackFiscalDocuments).not.toHaveBeenCalled()
    expect(ml.getPack).not.toHaveBeenCalled()
    // ni con "Emitir igual"
    const conf = await error(facturarVentaMl({ packId: PACK, clase: 'B', confirmarFacturaEnMl: true, user }))
    expect(conf.codigo).toBe('YA_FACTURADA')
  })

  it('ML no pudo verificar si tiene factura (error ≠ 404): 409 FACTURA_EN_ML sin confirmar; confirmado, emite', async () => {
    padron({})
    ml.getPackFiscalDocuments.mockRejectedValue(new MlApiError('500', 500, null))
    const res = await POST(
      new NextRequest('http://localhost/api/mercadolibre/facturacion', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ packId: PACK, clase: 'B', cuit: CUIL_CF }),
      })
    )
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'No se pudo verificar en Mercado Libre si la venta ya tiene factura; confirmalo en el borrador',
      codigo: 'FACTURA_EN_ML',
      facturaEnMl: null,
    })
    expect(db.mlOrderInvoice.create).not.toHaveBeenCalled()
    expect(ext.consultarPersona).not.toHaveBeenCalled()

    const r = await facturarVentaMl({ packId: PACK, clase: 'B', confirmarFacturaEnMl: true, user })
    expect(r.invoiceNumber).toBe('B-0007-00000012')
  })

  it('venta anterior al corte de su letra (decidida por ARCA): 409 ANTERIOR_AL_CORTE, sin candado', async () => {
    process.env.ML_FACTURACION_DESDE = '2026-10-01T00:00:00-03:00'
    process.env.ML_FACTURACION_CF_DESDE = '2026-10-04T00:00:00-03:00'
    padron({}) // consumidor final → B, cuyo corte es el 4/10; la venta es del 3/10
    const e = await error(facturarVentaMl({ packId: PACK, clase: 'B', user }))
    expect(e).toMatchObject({ status: 409, codigo: 'ANTERIOR_AL_CORTE', message: 'Las ventas anteriores al 4/10/2026 se facturan por Colppy' })
    expect(db.mlOrderInvoice.create).not.toHaveBeenCalled()
    // Desde la pestaña A tampoco ofrece "pasar a la B": va por Colppy
    const desdeA = await error(facturarVentaMl({ packId: PACK, clase: 'A', user }))
    expect(desdeA).toMatchObject({ status: 409, codigo: 'ANTERIOR_AL_CORTE' })
    expect(desdeA.claseCorrecta).toBeUndefined()
    // El borrador lo muestra como motivo, sin letra (no hay botón "Pasar a Factura B")
    const c = await resolverCompradorMl(PACK)
    expect(c).toMatchObject({ clase: null, condicionIva: 'CONSUMIDOR_FINAL' })
    expect(c.motivo).toBe('Las ventas anteriores al 4/10/2026 se facturan por Colppy')
    expect(avisoOtraClase(c, 'A')).toBeNull()
    // Después del corte, sí
    process.env.ML_FACTURACION_CF_DESDE = '2026-10-02T00:00:00-03:00'
    expect((await facturarVentaMl({ packId: PACK, clase: 'B', user })).clase).toBe('B')
  })

  it('el corte usa la orden más vieja del pack', async () => {
    process.env.ML_FACTURACION_CF_DESDE = '2026-10-03T00:00:00-03:00'
    ml.getPack.mockResolvedValue({ id: Number(PACK), orders: [{ id: 1 }, { id: 2 }] })
    ml.getSaleOrder.mockImplementation(async (id: number) =>
      orden({ id, date_created: id === 1 ? '2026-10-02T23:00:00.000-03:00' : '2026-10-03T10:00:00.000-03:00' })
    )
    padron({})
    const e = await error(facturarVentaMl({ packId: PACK, clase: 'B', user }))
    expect(e.codigo).toBe('ANTERIOR_AL_CORTE')
  })

  it('emitida en ARCA pero falla el ERP: el candado queda (nunca re-emitir)', async () => {
    padron({})
    db.$transaction.mockRejectedValue(new Error('db caída'))
    const e = await error(facturarVentaMl({ packId: PACK, clase: 'B', user }))
    expect(e.message).toMatch(/NO REINTENTES/)
    expect(db.mlOrderInvoice.delete).not.toHaveBeenCalled()
  })

  it('órdenes no pagas → error, sin tocar ARCA', async () => {
    ml.getSaleOrder.mockResolvedValue(orden({ status: 'cancelled' }))
    const e = await error(facturarVentaMl({ packId: PACK, clase: 'B', user }))
    expect(e.message).toMatch(/no están pagas/)
    expect(ext.consultarPersona).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Emisión: pestaña A
// ---------------------------------------------------------------------------

describe('facturarVentaMl — Factura A', () => {
  beforeEach(() => {
    ml.getBuyerFiscal.mockResolvedValue(fiscalRI)
  })

  it('RI: mismo circuito que antes (cliente del padrón, A cond. 1, Colppy como RI)', async () => {
    padron({ [CUIT_RI]: persona() })
    const r = await facturarVentaMl({ packId: PACK, clase: 'A', user })
    expect(r).toMatchObject({ clase: 'A', invoiceNumber: 'A-0007-00000012' })
    expect(db.customer.create.mock.calls[0][0].data).toMatchObject({
      name: 'EMPRESA SA',
      businessName: 'EMPRESA SA',
      type: 'BUSINESS',
      cuit: CUIT_RI,
      taxCondition: 'RESPONSABLE_INSCRIPTO',
      address: 'CALLE FALSA 123',
      city: 'ROSARIO',
      province: 'Santa Fe',
      postalCode: '2000',
    })
    expect(ext.sendQuoteToColppy.mock.calls[0][1]).toMatchObject({ pricesIncludeTax: true, customer: { cuit: CUIT_RI, taxCondition: 'RESPONSABLE_INSCRIPTO', name: 'EMPRESA SA' } })
    expect(emisiones[0]).toMatchObject({ letra: 'A', receptor: { condicionIvaId: 1, docTipo: 80, docNro: '30711111111' } })
    expect(db.invoice.create.mock.calls[0][0].data).toMatchObject({ invoiceType: 'A', cbteTipo: 1, docTipo: 80 })
  })

  it('RI: el CUIT del borrador no se valida con el dígito (igual que antes) y no pide datos fiscales a ML', async () => {
    padron({ [CUIT_RI]: persona() })
    await facturarVentaMl({ packId: PACK, clase: 'A', cuitManual: '30711111111', user })
    expect(ml.getBuyerFiscal).not.toHaveBeenCalled()
  })

  it('RI: si el CUIT del borrador no tiene 11 dígitos se usa el de ML (igual que antes)', async () => {
    padron({ [CUIT_RI]: persona() })
    await facturarVentaMl({ packId: PACK, clase: 'A', cuitManual: '123', user })
    expect(ml.getBuyerFiscal).toHaveBeenCalledTimes(1)
    expect(db.mlOrderInvoice.create.mock.calls[0][0].data.cuit).toBe(CUIT_RI)
  })

  it('Monotributo: Factura A condición 6, letra A también en Colppy, cliente MONOTRIBUTO', async () => {
    ml.getBuyerFiscal.mockResolvedValue({ docType: 'CUIT', docNumber: '20351234564', name: 'GARCIA LUIS', taxpayerType: 'Monotributo' })
    padron({ [CUIT_MONO]: persona({ cuit: '20351234564', razonSocial: 'GARCIA LUIS', tipoPersona: 'FISICA', condicionIva: 'MONOTRIBUTO' }) })
    const r = await facturarVentaMl({ packId: PACK, clase: 'A', user })
    expect(r).toMatchObject({ clase: 'A', invoiceNumber: 'A-0007-00000012' })
    expect(emisiones[0]).toMatchObject({ letra: 'A', receptor: { condicionIvaId: 6, docTipo: 80, docNro: '20351234564' } })
    expect(db.customer.create.mock.calls[0][0].data).toMatchObject({ taxCondition: 'MONOTRIBUTO', type: 'INDIVIDUAL' })
    const [, quote] = ext.sendQuoteToColppy.mock.calls[0]
    expect(quote.customer.taxCondition).toBe('MONOTRIBUTO')
    expect(letraFacturaColppy(quote.customer.taxCondition)).toBe('A')
  })

  it('consumidor final en la pestaña A → 409 "va por Factura B"', async () => {
    padron({ [CUIT_RI]: persona({ condicionIva: null }) })
    const e = await error(facturarVentaMl({ packId: PACK, clase: 'A', user }))
    expect(e).toMatchObject({ status: 409, codigo: 'CLASE_INCORRECTA', claseCorrecta: 'B' })
    expect(e.message).toMatch(/va por Factura B/)
  })

  it('CUIT que ARCA no tiene en la pestaña A → 409 a la B (si es persona)', async () => {
    ml.getBuyerFiscal.mockResolvedValue({ docType: 'CUIT', docNumber: '20123456786', name: 'X', taxpayerType: 'IVA Responsable Inscripto' })
    padron({})
    const e = await error(facturarVentaMl({ packId: PACK, clase: 'A', user }))
    expect(e).toMatchObject({ status: 409, claseCorrecta: 'B' })
  })

  it('RI con CUIT inactivo → 422', async () => {
    padron({ [CUIT_RI]: persona({ activo: false }) })
    const e = await error(facturarVentaMl({ packId: PACK, clase: 'A', user }))
    expect(e).toMatchObject({ status: 422 })
    expect(e.message).toMatch(/inactivo/)
  })

  it('sin CUIT → 422 CUIT_REQUERIDO (en la A no se deriva del DNI)', async () => {
    ml.getBuyerFiscal.mockResolvedValue({ docType: 'DNI', docNumber: '12345678', name: 'X', taxpayerType: null })
    const e = await error(facturarVentaMl({ packId: PACK, clase: 'A', user }))
    expect(e).toMatchObject({ status: 422, codigo: 'CUIT_REQUERIDO' })
    expect(ext.consultarPersona).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Borrador de la pantalla (facturacion-form) ↔ servidor: con el comprador que
// devuelve /comprador, lo que habilita el botón y el POST que arma el borrador
// pasan por la ruta real (sesión falsa)
// ---------------------------------------------------------------------------

describe('borrador de la pantalla alineado con el servidor', () => {
  const lineas = lineasDesdeVenta(orden().order_items.map((it) => ({
    title: it.item.title ?? it.item.id,
    quantity: it.quantity,
    unitPrice: Number(it.unit_price),
    productId: null,
    sku: null,
    productName: null,
  })))

  const estado = (c: CompradorMl, clase: ClaseFacturaMl, extra: { confirmaFacturaEnMl?: boolean } = {}) => ({
    clase,
    comprador: c,
    cuitIngresado: c.cuit ?? '',
    nombre: c.nombreSugerido ?? '',
    lineas,
    facturaEnMl: c.facturaEnMl === true,
    confirmaFacturaEnMl: extra.confirmaFacturaEnMl ?? false,
  })

  const cuerpo = (c: CompradorMl, clase: ClaseFacturaMl, extra: { confirmaFacturaEnMl?: boolean; nombre?: string } = {}) =>
    cuerpoFacturaMl({
      packId: PACK,
      clase,
      cuit: c.cuit!,
      lineas,
      facturaEnMl: c.facturaEnMl === true,
      confirmaFacturaEnMl: extra.confirmaFacturaEnMl ?? false,
      padron: c.padron,
      nombre: extra.nombre ?? c.nombreSugerido ?? '',
      domicilio: c.domicilioSugerido ?? { direccion: null, localidad: null, provincia: null, codigoPostal: null },
    })

  const post = (body: unknown) =>
    POST(
      new NextRequest('http://localhost/api/mercadolibre/facturacion', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    )

  it('las pestañas de la pantalla son las del servidor', () => {
    expect(PESTANA_FACTURA_ML_SERVIDOR).toBe(PESTANA_FACTURA_ML)
  })

  it('CF con CUIL que ARCA tiene: habilita solo la B y el POST emite B con DocTipo 86 y los datos de ARCA', async () => {
    padron({ [CUIL_CF]: personaCuil() })
    const c = await resolverCompradorMl(PACK)
    expect(c).toMatchObject({ padron: 'encontrado', clase: 'B', condicionIva: 'CONSUMIDOR_FINAL', receptor: { docTipo: 86 } })
    expect(textoCondicionArca(c)).toBe('ARCA no informa inscripción en IVA: consumidor final.')
    expect(motivoNoEmitir(estado(c, 'B'))).toBeNull()
    const res = await post(cuerpo(c, 'B'))
    expect(res.status).toBe(200)
    expect(db.customer.create.mock.calls[0][0].data).toMatchObject({ name: 'PEREZ JUAN', cuit: CUIL_CF, taxCondition: 'CONSUMIDOR_FINAL' })
    expect(emisiones[0].receptor).toEqual({ condicionIvaId: 5, docTipo: 86, docNro: '20123456786' })
  })

  it('CF que ARCA no tiene: habilita solo la B y el POST emite B con el nombre y domicilio del borrador', async () => {
    padron({})
    const c = await resolverCompradorMl(PACK)
    expect(textoCondicionArca(c)).toBe('Sin inscripción impositiva en ARCA: va como Consumidor Final.')
    expect(motivoNoEmitir(estado(c, 'B'))).toBeNull()
    expect(motivoNoEmitir(estado(c, 'A'))).toBe('Según ARCA va por Factura B')
    expect(avisoOtraClase(c, 'A')).toContain(PESTANA_FACTURA_ML.B)

    const res = await post(cuerpo(c, 'B', { nombre: 'Juan Pérez García' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, clase: 'B', invoiceNumber: 'B-0007-00000012' })
    expect(db.customer.create.mock.calls[0][0].data).toMatchObject({
      name: 'JUAN PÉREZ GARCÍA',
      cuit: CUIL_CF,
      taxCondition: 'CONSUMIDOR_FINAL',
      address: 'Av. Siempreviva 742',
      city: 'Rosario',
      province: 'Santa Fe',
      postalCode: '2000',
    })
    expect(emisiones[0].receptor).toEqual({ condicionIvaId: 5, docTipo: 96, docNro: '12345678' })
  })

  it('RI desde la B: el aviso y el 409 nombran la pestaña A; pasando a la A se emite', async () => {
    ml.getBuyerFiscal.mockResolvedValue(fiscalRI)
    padron({ [CUIT_RI]: persona() })
    const c = await resolverCompradorMl(PACK)
    expect(avisoOtraClase(c, 'B')).toContain(PESTANA_FACTURA_ML.A)

    const mal = await post(cuerpo(c, 'B'))
    expect(mal.status).toBe(409)
    const json = await mal.json()
    expect(json).toMatchObject({ codigo: 'CLASE_INCORRECTA', claseCorrecta: 'A' })
    expect(json.error).toContain(PESTANA_FACTURA_ML.A)
    expect(ext.emitirComprobante).not.toHaveBeenCalled()

    expect(motivoNoEmitir(estado(c, 'A'))).toBeNull()
    const bien = await post(cuerpo(c, 'A'))
    expect(bien.status).toBe(200)
    expect(await bien.json()).toMatchObject({ clase: 'A', invoiceNumber: 'A-0007-00000012' })
  })

  it('ML ya tiene factura: sin tildar "Emitir igual" no habilita ni emite (409); tildado, emite', async () => {
    ml.getPackFiscalDocuments.mockResolvedValue([{ id: 'F-COLPPY' }])
    padron({ [CUIL_CF]: personaCuil() })
    const c = await resolverCompradorMl(PACK)
    expect(c.facturaEnMl).toBe(true)
    expect(motivoNoEmitir(estado(c, 'B'))).toMatch(/Emitir igual/)

    const sin = await post(cuerpo(c, 'B'))
    expect(sin.status).toBe(409)
    expect(await sin.json()).toMatchObject({ codigo: 'FACTURA_EN_ML' })
    expect(db.mlOrderInvoice.create).not.toHaveBeenCalled()

    expect(motivoNoEmitir(estado(c, 'B', { confirmaFacturaEnMl: true }))).toBeNull()
    const con = await post(cuerpo(c, 'B', { confirmaFacturaEnMl: true }))
    expect(con.status).toBe(200)
  })

  it('clase que no es A ni B → 400 CLASE_INVALIDA', async () => {
    const res = await post({ packId: PACK, clase: 'C', cuit: CUIL_CF })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ codigo: 'CLASE_INVALIDA' })
  })
})

// ---------------------------------------------------------------------------
// CUIL / CDI puros: nunca se rechazan por observaciones (no pueden ser RI)
// ---------------------------------------------------------------------------

describe('decisión fiscal — CUIL y CDI', () => {
  const obs = ['El contribuyente registra inconsistencias en su domicilio fiscal']

  it('CUIL puro CON observaciones de ARCA: consumidor final con DocTipo 86 (un CUIL no puede ser RI ni monotributista)', () => {
    expect(decidirFacturaMl(CUIL_CF, { estado: 'encontrado', persona: personaCuil({ observaciones: obs }) })).toEqual({
      clase: 'B',
      taxCondition: 'CONSUMIDOR_FINAL',
      docTipo: 86,
      docNro: '20123456786',
    })
  })

  it('la clave CUIT con observaciones sigue sin adivinarse (CONDICION_IVA_INCIERTA); sin tipoClave también', () => {
    expect(() => decidirFacturaMl(CUIL_CF, { estado: 'encontrado', persona: personaCuil({ tipoClave: 'CUIT', observaciones: obs }) })).toThrow(
      expect.objectContaining({ codigo: 'CONDICION_IVA_INCIERTA' })
    )
    expect(() => decidirFacturaMl(CUIL_CF, { estado: 'encontrado', persona: personaCuil({ tipoClave: null, observaciones: obs }) })).toThrow(
      expect.objectContaining({ codigo: 'CONDICION_IVA_INCIERTA' })
    )
  })

  it('CDI → DocTipo 87 (con o sin observaciones)', () => {
    const cdi = (over: Partial<PersonaPadron> = {}) => personaCuil({ tipoClave: 'CDI', ...over })
    expect(decidirFacturaMl(CUIL_CF, { estado: 'encontrado', persona: cdi() })).toEqual({ clase: 'B', taxCondition: 'CONSUMIDOR_FINAL', docTipo: 87, docNro: '20123456786' })
    expect(decidirFacturaMl(CUIL_CF, { estado: 'encontrado', persona: cdi({ observaciones: obs }) })).toMatchObject({ docTipo: 87 })
  })

  it('emisión B a un CUIL con observaciones: sale con DocTipo 86 (antes: 422)', async () => {
    padron({ [CUIL_CF]: personaCuil({ observaciones: obs }) })
    const r = await facturarVentaMl({ packId: PACK, clase: 'B', user })
    expect(r.clase).toBe('B')
    expect(emisiones[0].receptor).toEqual({ condicionIvaId: 5, docTipo: 86, docNro: '20123456786' })
  })

  it('emisión B a un CDI: el hook acepta el 87 y la Invoice lo guarda', async () => {
    padron({ [CUIL_CF]: personaCuil({ tipoClave: 'CDI' }) })
    await facturarVentaMl({ packId: PACK, clase: 'B', user })
    expect(emisiones[0].receptor).toEqual({ condicionIvaId: 5, docTipo: 87, docNro: '20123456786' })
    expect(db.invoice.create.mock.calls[0][0].data).toMatchObject({ docTipo: 87, docNro: '20123456786' })
    candados.clear()
    const c = await resolverCompradorMl(PACK)
    expect(c.receptor).toEqual({ docTipo: 87, docNro: '20123456786' })
  })
})

// ---------------------------------------------------------------------------
// DNI → CUIL: varios CUIL del mismo DNI en ARCA
// ---------------------------------------------------------------------------

describe('DNI con más de un CUIL en ARCA', () => {
  const gomez = persona({ cuit: '20123456786', razonSocial: 'GOMEZ CARLOS', apellido: 'GOMEZ', tipoPersona: 'FISICA', tipoClave: 'CUIL', condicionIva: null })
  const perez = persona({ cuit: '27123456780', razonSocial: 'PEREZ ANA', apellido: 'PEREZ', tipoPersona: 'FISICA', tipoClave: 'CUIL', condicionIva: null })
  const dni = (name: string | null) => ml.getBuyerFiscal.mockResolvedValue({ docType: 'DNI', docNumber: '12345678', name, taxpayerType: 'Consumidor Final' })

  beforeEach(() => padron({ '20-12345678-6': gomez, '27-12345678-0': perez }))

  it('dos en ARCA y el nombre de ML coincide con uno: usa ese (acentos y mayúsculas no importan)', async () => {
    dni('Ana Pérez')
    const c = await resolverCompradorMl(PACK)
    expect(c).toMatchObject({ cuit: '27-12345678-0', origen: 'padron', clase: 'B', receptor: { docTipo: 86, docNro: '27123456780' } })
    expect(ext.consultarPersona).toHaveBeenCalledTimes(4)
    expect(c.candidatos.filter((x) => x.resultado === 'encontrado').map((x) => [x.cuit, x.nombreArca])).toEqual([
      ['20-12345678-6', 'GOMEZ CARLOS'],
      ['27-12345678-0', 'PEREZ ANA'],
    ])
    expect(opcionesCuilComprador(c)).toEqual([])

    ext.consultarPersona.mockClear()
    await facturarVentaMl({ packId: PACK, clase: 'B', user })
    expect(db.customer.create.mock.calls[0][0].data).toMatchObject({ cuit: '27-12345678-0', name: 'PEREZ ANA' })
  })

  it('dos en ARCA y el nombre no coincide con ninguno: manual-requerido con las opciones y sus nombres; nunca se elige solo', async () => {
    dni('Maria Lopez')
    const c = await resolverCompradorMl(PACK)
    expect(c).toMatchObject({ cuit: null, origen: 'manual-requerido', clase: null, receptor: null })
    expect(c.motivo).toBe(
      'ML solo informó el DNI 12345678 y ARCA tiene más de un CUIL con ese número: 20-12345678-6 (GOMEZ CARLOS), 27-12345678-0 (PEREZ ANA) (el nombre de ML, "Maria Lopez", no permite elegir). Elegí el del comprador.'
    )
    expect(opcionesCuilComprador(c)).toEqual([
      { cuit: '20-12345678-6', nombre: 'GOMEZ CARLOS' },
      { cuit: '27-12345678-0', nombre: 'PEREZ ANA' },
    ])
    // El POST sin CUIT tampoco elige: 422 con las opciones, sin candado
    const e = await error(facturarVentaMl({ packId: PACK, clase: 'B', user }))
    expect(e).toMatchObject({ status: 422, codigo: 'CUIT_REQUERIDO' })
    expect(e.message).toContain('El DNI 12345678 tiene más de un CUIL en ARCA (20-12345678-6 (GOMEZ CARLOS), 27-12345678-0 (PEREZ ANA))')
    expect(db.mlOrderInvoice.create).not.toHaveBeenCalled()
    // Elegido en el borrador (?cuit=): se verifica ese
    expect(await resolverCompradorMl(PACK, '20-12345678-6')).toMatchObject({ cuit: '20-12345678-6', origen: 'manual', clase: 'B', razonSocial: 'GOMEZ CARLOS' })
  })

  it('los dos coinciden con el nombre (mismo apellido) o ML no dio nombre: ambiguo', async () => {
    padron({ '20-12345678-6': { ...gomez, razonSocial: 'PEREZ JUAN', apellido: 'PEREZ' }, '27-12345678-0': perez })
    dni('Ana Perez')
    expect(await resolverCompradorMl(PACK)).toMatchObject({ cuit: null, origen: 'manual-requerido' })
    limpiarCachesFacturacionMl()
    dni(null)
    padron({ '20-12345678-6': gomez, '27-12345678-0': perez })
    const c = await resolverCompradorMl(PACK)
    expect(c).toMatchObject({ cuit: null, origen: 'manual-requerido' })
    expect(opcionesCuilComprador(c)).toHaveLength(2)
  })

  it('uno solo en ARCA: se usa aunque el nombre de ML no coincida', async () => {
    padron({ '27-12345678-0': perez })
    dni('Otro Nombre')
    expect(await resolverCompradorMl(PACK)).toMatchObject({ cuit: '27-12345678-0', origen: 'padron', clase: 'B' })
  })

  it('un error de ARCA después de encontrar uno corta la búsqueda (no se usa el encontrado)', async () => {
    padron({ '20-12345678-6': gomez, '27-12345678-0': new PadronError('Error de ARCA', 502) })
    dni('Carlos Gomez')
    const c = await resolverCompradorMl(PACK)
    expect(c).toMatchObject({ cuit: null, origen: 'manual-requerido' })
    expect(c.motivo).toMatch(/no se pudo consultar ARCA/)
    expect(ext.consultarPersona).toHaveBeenCalledTimes(2)
  })

  it('nombreCoincideConMl / elegirCuilPorNombre', () => {
    expect(nombreCoincideConMl('Ana Pérez', { razonSocial: 'PEREZ ANA' })).toBe(true) // apellido = primera palabra
    expect(nombreCoincideConMl('ana perez', { razonSocial: 'PEREZ ANA', apellido: 'PEREZ' })).toBe(true)
    expect(nombreCoincideConMl('María de la Fuente', { razonSocial: 'DE LA FUENTE MARIA', apellido: 'DE LA FUENTE' })).toBe(true)
    expect(nombreCoincideConMl('Ana Lopez', { razonSocial: 'PEREZ ANA', apellido: 'PEREZ' })).toBe(false) // solo el nombre de pila
    expect(nombreCoincideConMl('Juan Carlos R.', { razonSocial: 'RODRIGUEZ JUAN CARLOS', apellido: 'RODRIGUEZ' })).toBe(true) // 2 palabras
    expect(nombreCoincideConMl('Ñandú Muñoz', { razonSocial: 'MUNOZ NANDU', apellido: 'MUÑOZ' })).toBe(true)
    expect(nombreCoincideConMl(null, { razonSocial: 'PEREZ ANA' })).toBe(false)
    expect(nombreCoincideConMl('', { razonSocial: 'PEREZ ANA' })).toBe(false)
    const a = { id: 'a', persona: { razonSocial: 'GOMEZ CARLOS', apellido: 'GOMEZ' } }
    const b = { id: 'b', persona: { razonSocial: 'PEREZ ANA', apellido: 'PEREZ' } }
    expect(elegirCuilPorNombre('Ana Perez', [a, b])).toBe(b)
    expect(elegirCuilPorNombre('Maria Lopez', [a, b])).toBeNull()
    expect(elegirCuilPorNombre('Carlos Perez', [a, b])).toBe(b) // con GOMEZ CARLOS solo comparte el nombre de pila
    expect(elegirCuilPorNombre('Carlos Gomez Perez', [a, b])).toBeNull() // los dos coinciden por apellido
  })
})

// ---------------------------------------------------------------------------
// Factura en ML: la confirmación vale para el estado que vio el usuario
// ---------------------------------------------------------------------------

describe('confirmación de "factura en ML" para el estado visto', () => {
  const post = (body: unknown) =>
    POST(
      new NextRequest('http://localhost/api/mercadolibre/facturacion', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    )
  const lineas = lineasDesdeVenta([{ title: 'V', quantity: 2, unitPrice: 12100, productId: null, sku: null, productName: null }])
  const cuerpo = (facturaEnMl: boolean | null) =>
    cuerpoFacturaMl({
      packId: PACK,
      clase: 'B',
      cuit: CUIL_CF,
      lineas,
      facturaEnMl,
      confirmaFacturaEnMl: true,
      padron: 'encontrado',
      nombre: '',
      domicilio: { direccion: null, localidad: null, provincia: null, codigoPostal: null },
    })

  beforeEach(() => padron({ [CUIL_CF]: personaCuil() }))

  it('confirmó "ML no pudo verificarlo" pero ahora ML dice que TIENE factura: 409 con facturaEnMl true y el aviso de "ya tiene factura"', async () => {
    ml.getPackFiscalDocuments.mockResolvedValue([{ id: 'F-COLPPY' }])
    const res = await post(cuerpo(null))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'Esta venta ya tiene una factura adjunta en Mercado Libre (p. ej. hecha en Colppy). Si igual corresponde facturarla desde el ERP, confirmalo en el borrador.',
      codigo: 'FACTURA_EN_ML',
      facturaEnMl: true,
    })
    expect(db.mlOrderInvoice.create).not.toHaveBeenCalled()
    expect(ext.emitirComprobante).not.toHaveBeenCalled()

    // Confirmado sabiendo que tiene factura: emite
    const ok = await post(cuerpo(true))
    expect(ok.status).toBe(200)
  })

  it('confirmación sin el estado (cliente viejo) y ML tiene factura: 409', async () => {
    ml.getPackFiscalDocuments.mockResolvedValue([{ id: 'F-COLPPY' }])
    const e = await error(facturarVentaMl({ packId: PACK, clase: 'B', cuitManual: CUIL_CF, confirmarFacturaEnMl: true, user }))
    expect(e).toMatchObject({ status: 409, codigo: 'FACTURA_EN_ML', facturaEnMl: true })
  })

  it('confirmó "tiene factura" y ahora ML no lo puede verificar: alcanza (confirmó lo más fuerte)', async () => {
    ml.getPackFiscalDocuments.mockRejectedValue(new MlApiError('500', 500, null))
    expect((await post(cuerpo(true))).status).toBe(200)
  })

  it('el cuerpo del POST lleva el estado que se confirmó', () => {
    expect(cuerpo(null)).toMatchObject({ confirmarFacturaEnMl: true, estadoFacturaEnMlConfirmado: null })
    expect(cuerpo(true)).toMatchObject({ confirmarFacturaEnMl: true, estadoFacturaEnMlConfirmado: true })
  })
})

describe('/comprador de una venta con el candado del ERP (YA_FACTURADA)', () => {
  it('ya facturada: lo informa, no consulta ML ni ARCA y el borrador no ofrece emitir (ni "Emitir igual")', async () => {
    candados.set(PACK, { packId: PACK, status: 'EMITIDA', invoiceId: 'INV9', cuit: CUIL_CF, total: 24200, buyerNickname: 'X', invoice: { id: 'INV9', invoiceNumber: 'B-0007-00000009' } })
    const c = await resolverCompradorMl(PACK)
    expect(c).toMatchObject({ yaFacturada: { invoiceId: 'INV9', invoiceNumber: 'B-0007-00000009', status: 'EMITIDA' }, clase: null, cuit: null })
    expect(c.motivo).toBe('Esta venta ya fue facturada desde el ERP (B-0007-00000009).')
    expect(ml.getPack).not.toHaveBeenCalled()
    expect(ml.getPackFiscalDocuments).not.toHaveBeenCalled()
    expect(ext.consultarPersona).not.toHaveBeenCalled()
    const lineas = lineasDesdeVenta([{ title: 'V', quantity: 1, unitPrice: 100, productId: null, sku: null, productName: null }])
    expect(motivoNoEmitir({ clase: 'B', comprador: c, cuitIngresado: CUIL_CF, nombre: 'X', lineas, facturaEnMl: true, confirmaFacturaEnMl: true })).toBe(c.motivo)
  })

  it('candado sin factura (emisión sin terminar): "para revisar"', async () => {
    candados.set(PACK, { packId: PACK, status: 'EMITIENDO', invoiceId: null, cuit: CUIL_CF, total: 24200 })
    const c = await resolverCompradorMl(PACK)
    expect(c.yaFacturada).toEqual({ invoiceId: null, invoiceNumber: null, status: 'EMITIENDO' })
    expect(c.motivo).toMatch(/quedó con la emisión sin terminar \(para revisar\)/)
  })

  it('sin candado: yaFacturada null', async () => {
    padron({ [CUIL_CF]: personaCuil() })
    expect((await resolverCompradorMl(PACK)).yaFacturada).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Consistencia del servidor
// ---------------------------------------------------------------------------

describe('facturarVentaMl — consistencia con /comprador y altas simultáneas', () => {
  const ri = { id: 'CUS0', name: 'EMPRESA SA', cuit: CUIT_RI, taxCondition: 'RESPONSABLE_INSCRIPTO', fceObligado: false, colppyId: '41', address: null, city: null, province: null, postalCode: null, phone: null, email: null }

  it('cliente RI en el ERP que ARCA da como CF, desde la pestaña A: CONDICION_DISTINTA_ERP (no "Pasar a Factura B"), igual que /comprador', async () => {
    ml.getBuyerFiscal.mockResolvedValue(fiscalRI)
    padron({ [CUIT_RI]: persona({ condicionIva: null }) })
    db.customer.findFirst.mockResolvedValue(ri)
    const e = await error(facturarVentaMl({ packId: PACK, clase: 'A', user }))
    expect(e).toMatchObject({ status: 422, codigo: 'CONDICION_DISTINTA_ERP' })
    expect(e.claseCorrecta).toBeUndefined()
    expect(db.mlOrderInvoice.create).not.toHaveBeenCalled()
    const c = await resolverCompradorMl(PACK)
    expect(c.clase).toBeNull()
    expect(c.motivo).toBe(e.message)
    expect(avisoOtraClase(c, 'A')).toBeNull()
  })

  it('alta del cliente choca con Customer.cuit (P2002: otra venta lo creó recién): lo relee por CUIT y sigue', async () => {
    padron({ [CUIL_CF]: personaCuil() })
    const recien = { id: 'CUS7', name: 'PEREZ JUAN', cuit: CUIL_CF, taxCondition: 'CONSUMIDOR_FINAL', fceObligado: false, colppyId: null, address: null, city: null, province: null, postalCode: null, phone: null, email: null }
    db.customer.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(recien)
    db.customer.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`cuit`)', { code: 'P2002', clientVersion: '5.22.0' }))
    const r = await facturarVentaMl({ packId: PACK, clase: 'B', user })
    expect(r.invoiceNumber).toBe('B-0007-00000012')
    expect(db.customer.findFirst).toHaveBeenCalledTimes(2)
    expect(db.invoice.create.mock.calls[0][0].data.customerId).toBe('CUS7')
  })

  it('P2002 y el cliente releído es RI (ARCA dice CF): CONDICION_DISTINTA_ERP y se libera el candado', async () => {
    padron({ [CUIL_CF]: personaCuil() })
    db.customer.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...ri, cuit: CUIL_CF })
    db.customer.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5.22.0' }))
    const e = await error(facturarVentaMl({ packId: PACK, clase: 'B', user }))
    expect(e).toMatchObject({ codigo: 'CONDICION_DISTINTA_ERP' })
    expect(candados.has(PACK)).toBe(false)
    expect(ext.emitirComprobante).not.toHaveBeenCalled()
  })

  it('otro error al crear el cliente: se propaga (y se libera el candado)', async () => {
    padron({ [CUIL_CF]: personaCuil() })
    db.customer.create.mockRejectedValue(new Error('db caída'))
    await expect(facturarVentaMl({ packId: PACK, clase: 'B', user })).rejects.toThrow('db caída')
    expect(candados.has(PACK)).toBe(false)
  })

  it('error del padrón que termina en 502: warn con el pack y el mensaje', async () => {
    padron({ [CUIL_CF]: new PadronError('Error de ARCA', 502) })
    const e = await error(facturarVentaMl({ packId: PACK, clase: 'B', user }))
    expect(e.status).toBe(502)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(`(pack ${PACK}): ARCA (padrón): Error de ARCA`))
  })
})

// ---------------------------------------------------------------------------
// Listado incompleto (falló una página de ML)
// ---------------------------------------------------------------------------

describe('listado: ML no devolvió todas las páginas', () => {
  it('sigue con lo que llegó: truncado + avisoListado (también por GET)', async () => {
    ml.searchPaidOrdersSince.mockImplementation(async (_d: Date, _m: number, info?: { total?: number; error?: string }) => {
      if (info) {
        info.total = 120
        info.error = '[ML] GET /orders/search -> HTTP 429'
      }
      return [orden({ id: 1, pack_id: 11 })]
    })
    const r = await listarVentasMl()
    expect(r).toMatchObject({ truncado: true, avisoListado: AVISO_LISTADO_INCOMPLETO })
    expect(r.ventas).toHaveLength(1)
    expect(AVISO_LISTADO_INCOMPLETO).toBe('Mercado Libre no devolvió todas las ventas (reintentá en un rato)')

    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ truncado: true, avisoListado: AVISO_LISTADO_INCOMPLETO })
  })

  it('todo bien: avisoListado null', async () => {
    ml.searchPaidOrdersSince.mockResolvedValue([orden({ id: 1, pack_id: 11 })])
    expect(await listarVentasMl()).toMatchObject({ truncado: false, avisoListado: null })
  })

  it('falla la primera página: el GET responde 500 (no hay nada para mostrar)', async () => {
    ml.searchPaidOrdersSince.mockRejectedValue(new MlApiError('[ML] GET /orders/search -> HTTP 503', 503, null))
    const res = await GET()
    expect(res.status).toBe(500)
  })
})
