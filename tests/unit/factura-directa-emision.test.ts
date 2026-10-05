import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'

/**
 * Factura directa (POST /api/facturas/directa y la vista previa): idempotencia
 * por clave, emisión incierta y huérfana, venta de ML vinculada, Colppy al
 * final (flag) y validaciones. Prisma en memoria; ARCA (emitirComprobante y
 * padrón), Colppy (sendQuoteToColppy), ML y SharePoint falsos. El hook de
 * ARCA es el real (crearHookEmisionArca). Nunca sale a la red: fetch falla
 * siempre (importar @prisma/client carga el .env con credenciales reales).
 */

// La fecha del comprobante sale de la hora local: los tests corren en hora argentina
process.env.TZ = 'America/Argentina/Buenos_Aires'

beforeAll(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      throw new Error(`Red bloqueada en tests: ${String(url)}`)
    })
  )
})
afterAll(() => vi.unstubAllGlobals())

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- filas falsas de Prisma, sin tipar a propósito
type Fila = Record<string, any>

// ---------------------------------------------------------------------------
// Prisma en memoria (solo los filtros que usa la factura directa)
// ---------------------------------------------------------------------------

const mem = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type F = Record<string, any>
  const num = (v: unknown) => (v !== null && typeof v === 'object' && 'toNumber' in (v as object) ? Number(v) : v)
  const cmp = (v: unknown) => (v instanceof Date ? v.getTime() : Number(num(v)))
  function cumple(row: F, where: F | undefined): boolean {
    if (!where) return true
    return Object.entries(where).every(([k, cond]) => {
      if (k === 'OR') return (cond as F[]).some((w) => cumple(row, w))
      if (k === 'AND') return (cond as F[]).every((w) => cumple(row, w))
      const v = row[k]
      if (cond !== null && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
        const c = cond as F
        if ('is' in c) return c.is === null ? v == null : v != null
        if ('in' in c && !(c.in as unknown[]).includes(v)) return false
        if ('notIn' in c && (c.notIn as unknown[]).includes(v)) return false
        if ('not' in c && v === c.not) return false
        if ('gte' in c && !(cmp(v) >= cmp(c.gte))) return false
        if ('lte' in c && !(cmp(v) <= cmp(c.lte))) return false
        if ('lt' in c && !(cmp(v) < cmp(c.lt))) return false
        return true
      }
      return v === cond
    })
  }
  /** Como Prisma: Prisma.JsonNull / DbNull se guardan (y se leen) como null */
  function guardado(data: F): F {
    const out: F = {}
    for (const [k, v] of Object.entries(data)) {
      const nombre = v !== null && typeof v === 'object' ? (v as object).constructor?.name : ''
      out[k] = nombre === 'JsonNull' || nombre === 'DbNull' || nombre === 'AnyNull' ? null : v
    }
    return out
  }
  /** orderBy de Prisma con una sola clave ({ campo: 'asc' | 'desc' }, o una lista: se usa la primera) */
  function ordenar(rows: F[], orderBy: F | F[] | undefined): F[] {
    const ob = Array.isArray(orderBy) ? orderBy[0] : orderBy
    if (!ob) return rows
    const [k, dir] = Object.entries(ob)[0]
    return [...rows].sort((a, b) => (cmp(a[k]) - cmp(b[k])) * (dir === 'desc' ? -1 : 1))
  }
  let seq = 0
  const id = (p: string) => `${p}${++seq}`
  return { cumple, guardado, ordenar, id, reset: () => (seq = 0) }
})

const tablas = vi.hoisted(() => ({
  customers: new Map<string, Fila>(),
  products: new Map<string, Fila>(),
  facturas: new Map<string, Fila>(),
  invoices: new Map<string, Fila>(),
  candados: new Map<string, Fila>(),
}))

const db = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type F = Record<string, any>
  const filas = (m: Map<string, F>) => Array.from(m.values())
  const dup = async () => {
    const { Prisma } = await import('@prisma/client')
    return new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5.22.0' })
  }
  const d = {
    customer: {
      findUnique: vi.fn(async ({ where }: F) => tablas.customers.get(where.id) ?? null),
      update: vi.fn(async ({ where, data }: F) => Object.assign(tablas.customers.get(where.id)!, data)),
    },
    product: { findMany: vi.fn(async ({ where }: F) => filas(tablas.products).filter((p) => where.id.in.includes(p.id))) },
    exchangeRate: { findFirst: vi.fn(async () => ({ rate: 1450, validFrom: new Date('2026-10-02T00:00:00Z') })) },
    mlItemLink: { findMany: vi.fn(async () => []) },
    facturaDirecta: {
      findUnique: vi.fn(async ({ where }: F) => {
        if (where.idempotencyKey) return filas(tablas.facturas).find((f) => f.idempotencyKey === where.idempotencyKey) ?? null
        if (where.invoiceId) return filas(tablas.facturas).find((f) => f.invoiceId === where.invoiceId) ?? null
        return tablas.facturas.get(where.id) ?? null
      }),
      findFirst: vi.fn(async ({ where, orderBy }: F) => mem.ordenar(filas(tablas.facturas), orderBy).find((f) => mem.cumple(f, where)) ?? null),
      findMany: vi.fn(async ({ where }: F) => filas(tablas.facturas).filter((f) => mem.cumple(f, where)).map((f) => ({ ...f, customer: tablas.customers.get(f.customerId) }))),
      create: vi.fn(async ({ data }: F) => {
        if (filas(tablas.facturas).some((f) => f.idempotencyKey === data.idempotencyKey)) throw await dup()
        const f = { id: mem.id('FD'), invoiceId: null, createdAt: new Date(), updatedAt: new Date(), ...mem.guardado(data) }
        tablas.facturas.set(f.id, f)
        return { ...f }
      }),
      update: vi.fn(async ({ where, data }: F) => {
        const f = Object.assign(tablas.facturas.get(where.id)!, mem.guardado(data), { updatedAt: new Date() })
        return { ...f }
      }),
      updateMany: vi.fn(async ({ where, data }: F) => {
        const fs = filas(tablas.facturas).filter((f) => mem.cumple(f, where))
        for (const f of fs) Object.assign(f, mem.guardado(data), { updatedAt: new Date() })
        return { count: fs.length }
      }),
    },
    invoice: {
      findFirst: vi.fn(async ({ where, orderBy }: F) => {
        const conMl = (i: F): F => ({
          ...i,
          mlOrderInvoice: filas(tablas.candados).find((c) => c.invoiceId === i.id) ?? null,
          facturaDirecta: filas(tablas.facturas).find((f) => f.invoiceId === i.id) ?? null,
        })
        const i = mem.ordenar(filas(tablas.invoices), orderBy).map(conMl).find((x) => mem.cumple(x, where))
        return i ? { ...i, customer: tablas.customers.get(i.customerId) } : null
      }),
      findUnique: vi.fn(async ({ where }: F) => {
        const i = tablas.invoices.get(where.id)
        if (!i) return null
        return {
          ...i,
          customer: tablas.customers.get(i.customerId),
          facturaDirecta: filas(tablas.facturas).find((f) => f.invoiceId === i.id) ?? null,
        }
      }),
      create: vi.fn(async ({ data }: F) => {
        if (filas(tablas.invoices).some((i) => i.invoiceNumber === data.invoiceNumber)) throw await dup()
        const { items, ...resto } = data
        const i = { id: mem.id('INV'), updatedAt: new Date(), ...mem.guardado(resto), items: items.create }
        tablas.invoices.set(i.id, i)
        return { id: i.id }
      }),
      update: vi.fn(async ({ where, data }: F) => Object.assign(tablas.invoices.get(where.id)!, mem.guardado(data), { updatedAt: new Date() })),
      updateMany: vi.fn(async ({ where, data }: F) => {
        const is = filas(tablas.invoices).filter((i) => mem.cumple(i, where))
        for (const i of is) Object.assign(i, mem.guardado(data), { updatedAt: new Date() })
        return { count: is.length }
      }),
    },
    mlOrderInvoice: {
      create: vi.fn(async ({ data }: F) => {
        if (tablas.candados.has(data.packId)) throw await dup()
        tablas.candados.set(data.packId, { status: 'EMITIENDO', invoiceId: null, mlUploadStatus: null, mlUploadError: null, ...data })
        return tablas.candados.get(data.packId)
      }),
      delete: vi.fn(async ({ where }: F) => {
        const c = tablas.candados.get(where.packId)
        tablas.candados.delete(where.packId)
        return c
      }),
      update: vi.fn(async ({ where, data }: F) => Object.assign(tablas.candados.get(where.packId)!, data)),
      findUnique: vi.fn(async ({ where }: F) => {
        const c = tablas.candados.get(where.packId)
        return c ? { ...c, invoice: c.invoiceId ? { id: c.invoiceId, invoiceNumber: tablas.invoices.get(c.invoiceId)?.invoiceNumber } : null } : null
      }),
    },
    $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(),
  }
  return d
})

const ext = vi.hoisted(() => ({
  consultarPersona: vi.fn(),
  emitirComprobante: vi.fn(),
  sendQuoteToColppy: vi.fn(),
  getPack: vi.fn(),
  getSaleOrder: vi.fn(),
  getBuyerFiscal: vi.fn(),
  getPackFiscalDocuments: vi.fn(),
  uploadPackFiscalDocument: vi.fn(),
  session: { user: { id: 'U1', name: 'Santiago', email: 'santi@example.com', role: 'ADMIN' } } as Fila,
}))

vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/arca/config', () => ({
  isArcaConfigured: () => true,
  getArcaConfig: () => ({ cuit: '30715373579', env: 'homo', puntoVenta: 7, fceMontoMinimo: 5_549_862, cbu: '0070363320000001263286' }),
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
  getPack: ext.getPack,
  getSaleOrder: ext.getSaleOrder,
  getBuyerFiscal: ext.getBuyerFiscal,
  getPackFiscalDocuments: ext.getPackFiscalDocuments,
  uploadPackFiscalDocument: ext.uploadPackFiscalDocument,
}))
vi.mock('@/lib/facturacion/factura-pdf-data', () => ({ buildFacturaPdfData: vi.fn(async () => ({ pdf: true })) }))
vi.mock('@/lib/pdf/factura-generator', () => ({
  generateFacturaPDF: vi.fn(async () => Buffer.from('%PDF')),
  facturaPdfFilename: () => 'factura.pdf',
}))
vi.mock('@/lib/sharepoint/facturas-emitidas', () => ({ archivarFacturaEnSharePointBg: vi.fn() }))
vi.mock('@/auth', () => ({ auth: vi.fn(async () => ext.session) }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))

import { NextRequest } from 'next/server'
import { PadronError, type PersonaPadron } from '@/lib/arca/padron'
import { EmisionInciertaError, EmisionNoSolicitadaError } from '@/lib/arca/emitir'
import { letraFacturaColppy, type EmisionExternaDatos, type SendToColppyOptions } from '@/lib/colppy'
import { totalesFacturaA, totalesFacturaB } from '@/lib/facturacion/totales-factura'
import { logger } from '@/lib/logger'
import { archivarFacturaEnSharePointBg } from '@/lib/sharepoint/facturas-emitidas'
import { MlApiError, type MlSaleOrder } from '@/lib/mercadolibre/client'
import { limpiarCachesFacturacionMl } from '@/lib/mercadolibre/facturacion'
import { crearInvoiceDirecta, fueraDeHorario, listarPendientesFacturaDirecta } from '@/lib/facturacion/factura-directa'
import { fechaYmdLocal } from '@/lib/facturacion/factura-directa-form'
import { POST } from '@/app/api/facturas/directa/route'
import { POST as PREVIEW } from '@/app/api/facturas/directa/preview/route'
import { GET as PENDIENTES } from '@/app/api/facturas/directa/pendientes/route'

// ---------------------------------------------------------------------------
// Datos de prueba (CUIT con dígito verificador válido, empresas inventadas)
// ---------------------------------------------------------------------------

const CLAVE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1'
const CLAVE2 = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee2'
const PACK = '2000009000000001'

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

function orden(over: Partial<MlSaleOrder> = {}): MlSaleOrder {
  return {
    id: 4000000001,
    status: 'paid',
    date_created: '2026-09-25T10:00:00.000-03:00',
    pack_id: Number(PACK),
    total_amount: 1210,
    buyer: { id: 1, nickname: 'COMPRADORML', billing_info: { id: 'BI-1' } },
    order_items: [{ item: { id: 'MLA1', title: 'Válvula' }, quantity: 1, unit_price: 1210 }],
    ...over,
  }
}

const CONFIRMA = ['EMISION_IRREVERSIBLE']

function body(over: Fila = {}): Fila {
  return {
    idempotencyKey: CLAVE,
    customerId: 'CUS1',
    moneda: 'ARS',
    condicionPago: 'a 30 Dias',
    preciosConIva: false,
    lineas: [{ productId: 'P1', descripcion: 'Válvula esférica 1"', cantidad: 2, precioUnitario: 500 }],
    confirmaciones: CONFIRMA,
    ...over,
  }
}

/** POST tal cual (las confirmaciones van como estén en el body) */
const postCrudo = (b: Fila) =>
  POST(new NextRequest('http://localhost/api/facturas/directa', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }))
const preview = (b: Fila) =>
  PREVIEW(new NextRequest('http://localhost/api/facturas/directa/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }))

/**
 * Como la pantalla: pide la vista previa del mismo pedido y tilda las
 * confirmaciones cuyos CÓDIGOS lista el body (manda sus firmas). Un código que
 * la vista previa no pide queda tal cual (y no confirma nada).
 */
async function tildar(b: Fila): Promise<Fila> {
  const codigos = b.confirmaciones
  if (!Array.isArray(codigos) || !codigos.length) return b
  const p = await (await preview(b)).json()
  const firmas = new Map<string, string>((p.confirmacionesRequeridas ?? []).map((c: Fila) => [c.codigo, c.firma]))
  return { ...b, confirmaciones: codigos.map((c: string) => firmas.get(c) ?? c) }
}
const post = async (b: Fila) => postCrudo(await tildar(b))

let numero = 12

beforeEach(() => {
  vi.clearAllMocks()
  limpiarCachesFacturacionMl()
  mem.reset()
  for (const t of Object.values(tablas)) t.clear()
  numero = 12
  process.env.FACTURACION_EMISOR = 'arca'
  delete process.env.FACTURACION_REGISTRAR_COLPPY
  ext.session = { user: { id: 'U1', name: 'Santiago', email: 'santi@example.com', role: 'ADMIN' } }

  tablas.customers.set('CUS1', {
    id: 'CUS1',
    name: 'EMPRESA SA',
    businessName: 'EMPRESA SA',
    cuit: '30-71111111-1',
    taxCondition: 'RESPONSABLE_INSCRIPTO',
    status: 'ACTIVE',
    country: 'Argentina',
    fceObligado: false,
    paymentTerms: 30,
    colppyId: null,
  })
  tablas.customers.set('CUS2', {
    id: 'CUS2',
    name: 'CONSUMIDOR FINAL',
    businessName: null,
    cuit: '0',
    taxCondition: 'CONSUMIDOR_FINAL',
    status: 'ACTIVE',
    country: 'Argentina',
    fceObligado: false,
    paymentTerms: null,
    colppyId: null,
  })
  tablas.products.set('P1', { id: 'P1', sku: 'VAL-1', name: 'Válvula', status: 'ACTIVE', taxRate: 21 })
  tablas.products.set('P2', { id: 'P2', sku: 'LIB-1', name: 'Libro', status: 'ACTIVE', taxRate: 10.5 })

  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db))
  ext.consultarPersona.mockResolvedValue(persona())
  ext.emitirComprobante.mockImplementation(async (c: Fila) => {
    const n = numero++
    return {
      ok: true,
      cbteTipo: c.fce ? 201 : c.letra === 'A' ? 1 : 6,
      puntoVenta: 7,
      numero: n,
      numeroFormateado: `0007-${String(n).padStart(8, '0')}`,
      cae: `760000000000${n}`,
      caeVencimiento: new Date('2026-10-15T00:00:00-03:00'),
      fecha: c.fecha,
      observaciones: [],
    }
  })
  // Colppy falso: los mismos totales que el real (letra, totalesFacturaA/B) y llama a la emisión externa
  ext.sendQuoteToColppy.mockImplementation(async (options: SendToColppyOptions, quote: Fila) => {
    const tipoFactura = letraFacturaColppy(quote.customer.taxCondition)
    const t =
      tipoFactura === 'B'
        ? totalesFacturaB(quote.items.map((i: Fila) => ({ cantidad: i.quantity, precioFinal: i.unitPrice })), quote.bonification)
        : totalesFacturaA(quote.items.map((i: Fila) => ({ cantidad: i.quantity, precioUnitario: i.unitPrice })), quote.bonification, quote.pricesIncludeTax)
    const datos: EmisionExternaDatos = {
      tipoFactura,
      netoGravado: t.neto,
      totalIVA: t.iva,
      totalFactura: t.total,
      currency: quote.currency,
      exchangeRate: quote.exchangeRate,
      fechaFactura: options.fechaFactura ?? new Date(),
      fechaVto: new Date(),
      idCondicionPago: options.condicionPago!,
      descripcion: options.descripcion!,
    }
    try {
      const emision = await options.emisionExterna!(datos)
      return { success: true, facturaId: 'COLPPY-9', emision, colppyInvoicePayload: { idCliente: 'C77', tipoFactura, netoGravado: t.neto, totalIVA: t.iva, totalFactura: t.total, items: [] } }
    } catch (e) {
      return { success: false, error: (e as Error).message, errorStage: 'arca' }
    }
  })
  ext.getPack.mockResolvedValue({ id: Number(PACK), orders: [{ id: 4000000001 }] })
  ext.getSaleOrder.mockResolvedValue(orden())
  ext.getBuyerFiscal.mockResolvedValue({ docType: 'CUIT', docNumber: '30711111111', name: 'EMPRESA SA', taxpayerType: 'IVA Responsable Inscripto' })
  ext.getPackFiscalDocuments.mockRejectedValue(new MlApiError('404', 404, null))
  ext.uploadPackFiscalDocument.mockResolvedValue({ id: 'DOC1' })
})

afterEach(() => {
  delete process.env.FACTURACION_EMISOR
  delete process.env.FACTURACION_REGISTRAR_COLPPY
  // Ningún test sale a la red (Colppy, ARCA, ML, Microsoft)
  expect(globalThis.fetch).not.toHaveBeenCalled()
})

const filasDiario = () => Array.from(tablas.facturas.values())
const invoices = () => Array.from(tablas.invoices.values())

// ---------------------------------------------------------------------------
// Emisión
// ---------------------------------------------------------------------------

describe('emisión: ARCA primero, Invoice, PDF y Colppy', () => {
  it('Factura A: CAE con el hook real, diario AUTORIZADA, Invoice sin cotización y registro en Colppy con el CAE guardado', async () => {
    const res = await post(body())
    expect(res.status).toBe(201)
    const r = await res.json()
    expect(r).toMatchObject({
      invoiceNumber: 'A-0007-00000012',
      cae: '76000000000012',
      total: 1210,
      currency: 'ARS',
      colppy: { estado: 'OK' },
      ml: null,
      repetida: false,
    })
    expect(r.pdfUrl).toBe(`/api/facturas/${r.invoiceId}/pdf`)

    // ARCA recibió exactamente los totales de la factura directa
    expect(ext.emitirComprobante).toHaveBeenCalledTimes(1)
    expect(ext.emitirComprobante.mock.calls[0][0]).toMatchObject({
      clase: 'FACTURA',
      letra: 'A',
      receptor: { condicionIvaId: 1, docTipo: 80, docNro: '30711111111' },
      moneda: 'ARS',
      importes: { netoGravado: 1000, iva: [{ alicuota: '21', baseImponible: 1000, importe: 210 }], total: 1210 },
    })

    const [fila] = filasDiario()
    expect(fila).toMatchObject({ estado: 'AUTORIZADA', idempotencyKey: CLAVE, cae: '76000000000012', cbteTipo: 1, cbteNumero: 12, puntoVenta: 7, invoiceId: r.invoiceId, docTipo: 80 })
    expect(fila.pedido).toMatchObject({ letra: 'A', condicionPago: 'a 30 Dias', totales: { neto: 1000, iva: 210, total: 1210 } })

    const [inv] = invoices()
    expect(inv).toMatchObject({
      invoiceNumber: 'A-0007-00000012',
      invoiceType: 'A',
      transactionType: 'SALE',
      quoteId: null,
      userId: 'U1',
      status: 'AUTHORIZED',
      subtotal: 1000,
      taxAmount: 210,
      total: 1210,
      balance: 1210,
      emitidaPor: 'ARCA',
      cbteTipo: 1,
      cbteNumero: 12,
      cae: '76000000000012',
      docTipo: 80,
      docNro: '30711111111',
      colppyId: 'COLPPY-9',
      colppySyncStatus: 'OK',
    })
    expect(inv.qrUrl).toMatch(/^https:\/\/www\.afip\.gob\.ar\/fe\/qr\/\?p=/)
    expect(inv.items).toEqual([
      { productId: 'P1', sku: 'VAL-1', description: 'Válvula esférica 1"', quantity: 2, unitPrice: 500, discount: 0, taxRate: 21, subtotal: 1000, comment: null },
    ])
    expect(inv.notes).toMatch(/^Factura directa\. Emitida por el ERP \(ARCA\) el .+\. CAE 76000000000012\. Registrada en Colppy \(COLPPY-9\)\.$/)
    // vence a los 30 días
    expect(Math.round((inv.dueDate.getTime() - inv.issueDate.getTime()) / 86400000)).toBe(30)

    // Colppy: cotización sintética + emisión "ya realizada" (no llamó otra vez a ARCA)
    const [opts, quote] = ext.sendQuoteToColppy.mock.calls[0]
    expect(opts).toMatchObject({ action: 'factura-cuenta-corriente', condicionPago: 'a 30 Dias', descripcion: 'Factura directa A-0007-00000012' })
    expect(opts.fechaFactura).toEqual(inv.issueDate)
    expect(quote).toMatchObject({ id: `directa-${fila.id}`, quoteNumber: 'A-0007-00000012', bonification: 0, pricesIncludeTax: false })
    expect(inv.colppyPayload).toMatchObject({ idCliente: 'C77' })
    expect(tablas.customers.get('CUS1')!.colppyId).toBe('C77')
    expect(archivarFacturaEnSharePointBg).toHaveBeenCalledWith(r.invoiceId)
  })

  it('la misma clave dos veces llama al hook una sola vez y devuelve 200 con repetida', async () => {
    const a = await post(body())
    const b = await post(body())
    expect(a.status).toBe(201)
    expect(b.status).toBe(200)
    const ra = await a.json()
    const rb = await b.json()
    expect(rb).toMatchObject({ repetida: true, invoiceId: ra.invoiceId, invoiceNumber: 'A-0007-00000012', cae: ra.cae, colppy: { estado: 'OK' } })
    expect(ext.emitirComprobante).toHaveBeenCalledTimes(1)
    expect(invoices()).toHaveLength(1)
    expect(filasDiario()).toHaveLength(1)
  })

  it('una clave en EMITIENDO da 409 EN_CURSO sin llamar a ARCA', async () => {
    tablas.facturas.set('FDX', { id: 'FDX', idempotencyKey: CLAVE, estado: 'EMITIENDO', customerId: 'CUS1', invoiceId: null, createdAt: new Date(), updatedAt: new Date() })
    const res = await post(body())
    expect(res.status).toBe(409)
    expect((await res.json()).codigo).toBe('EN_CURSO')
    expect(ext.emitirComprobante).not.toHaveBeenCalled()
  })

  it('una clave RECHAZADA se puede reusar', async () => {
    ext.emitirComprobante.mockResolvedValueOnce({ ok: false, cbteTipo: 1, puntoVenta: 7, numero: 12, mensaje: '[10013] CUIT', errores: [{ Code: 10013, Msg: 'CUIT' }] })
    const r1 = await post(body())
    expect(r1.status).toBe(422)
    expect(await r1.json()).toMatchObject({ codigo: 'ARCA_RECHAZO', errores: [{ Code: 10013, Msg: 'CUIT' }] })
    expect(filasDiario()[0]).toMatchObject({ estado: 'RECHAZADA', invoiceId: null })

    const r2 = await post(body())
    expect(r2.status).toBe(201)
    expect(ext.emitirComprobante).toHaveBeenCalledTimes(2)
    expect(filasDiario()).toHaveLength(1)
    expect(filasDiario()[0]).toMatchObject({ estado: 'AUTORIZADA', error: null })
  })

  it('rechazo 10192 de ARCA: "obligado a FCE MiPyME: marcalo y volvé a emitir"', async () => {
    ext.emitirComprobante.mockResolvedValueOnce({ ok: false, cbteTipo: 1, puntoVenta: 7, numero: 12, mensaje: '[10192] FCE', errores: [{ Code: 10192, Msg: 'Corresponde FCE' }] })
    const r = await post(body())
    expect(r.status).toBe(422)
    expect(await r.json()).toMatchObject({ codigo: 'ARCA_RECHAZO', error: 'ARCA indica que el cliente está obligado a FCE MiPyME: marcalo y volvé a emitir' })
  })

  it('ARCA falló antes de recibir el pedido (WSAA): 502 ARCA_NO_SOLICITADA y la misma clave se puede reintentar', async () => {
    ext.emitirComprobante.mockRejectedValueOnce(new EmisionNoSolicitadaError(new Error('WSAA caído'), 1, 7))
    const r = await post(body())
    expect(r.status).toBe(502)
    expect((await r.json()).codigo).toBe('ARCA_NO_SOLICITADA')
    expect(filasDiario()[0].estado).toBe('NO_SOLICITADA')
    expect((await post(body())).status).toBe(201)
  })

  it('un resultado incierto deja la fila INCIERTA, el candado de ML puesto y responde 502', async () => {
    ext.emitirComprobante.mockRejectedValueOnce(new EmisionInciertaError(new Error('socket hang up'), 1, 7, 12))
    const res = await post(body({ mlVenta: PACK, preciosConIva: true, lineas: [{ descripcion: 'Válvula', cantidad: 1, precioUnitario: 1210 }] }))
    expect(res.status).toBe(502)
    const r = await res.json()
    expect(r).toMatchObject({ codigo: 'ARCA_INCIERTO', cbteTipo: 1, puntoVenta: 7, numero: 12 })
    expect(r.error).toMatch(/NO reintentes/)
    expect(filasDiario()[0]).toMatchObject({ estado: 'INCIERTA', cbteNumero: 12, mlPackId: PACK, intento: { estado: 'incierta', numero: 12 } })
    expect(tablas.candados.get(PACK)).toMatchObject({ status: 'EMITIENDO', invoiceId: null, cuit: '30-71111111-1', total: 1210 })
    expect(db.mlOrderInvoice.delete).not.toHaveBeenCalled()
    expect(invoices()).toHaveLength(0)
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/^\[DIRECTA_ARCA_INCIERTO\]/), expect.objectContaining({ numero: 12, mlPackId: PACK }))

    // La misma clave: 409 ARCA_INCIERTO; otra clave del mismo cliente: 409 EMISION_PENDIENTE (sin llamar a ARCA)
    ext.emitirComprobante.mockClear()
    const misma = await post(body({ mlVenta: PACK }))
    expect(misma.status).toBe(409)
    expect((await misma.json()).codigo).toBe('ARCA_INCIERTO')
    const otra = await post(body({ idempotencyKey: CLAVE2 }))
    expect(otra.status).toBe(409)
    expect((await otra.json()).codigo).toBe('EMISION_PENDIENTE')
    expect(ext.emitirComprobante).not.toHaveBeenCalled()

    // Banner de pendientes
    const p = await (await PENDIENTES()).json()
    expect(p.pendientes).toEqual([expect.objectContaining({ tipo: 'INCIERTA', cliente: 'EMPRESA SA', numero: '0007-00000012', mlPackId: PACK })])
  })

  it('si falla la transacción, la fila queda huérfana, responde 500 y el siguiente pedido para el mismo cliente da 409 EMISION_PENDIENTE', async () => {
    db.invoice.create.mockRejectedValueOnce(new Error('db caída'))
    const res = await post(body())
    expect(res.status).toBe(500)
    const r = await res.json()
    expect(r).toMatchObject({ codigo: 'ERP_HUERFANA', cae: '76000000000012', numero: '0007-00000012' })
    expect(r.error).toMatch(/NO reintentes/)
    expect(filasDiario()[0]).toMatchObject({ estado: 'AUTORIZADA', cae: '76000000000012', invoiceId: null })
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/^\[DIRECTA_ORPHAN\]/), expect.objectContaining({ cae: '76000000000012' }))

    const otra = await post(body({ idempotencyKey: CLAVE2 }))
    expect(otra.status).toBe(409)
    expect((await otra.json()).codigo).toBe('EMISION_PENDIENTE')
    const misma = await post(body())
    expect(misma.status).toBe(409)
    expect((await misma.json()).codigo).toBe('ERP_HUERFANA')
    expect(ext.emitirComprobante).toHaveBeenCalledTimes(1)
    expect((await listarPendientesFacturaDirecta()).map((p) => p.tipo)).toEqual(['HUERFANA'])
  })

  it('con el flag apagado no se llama a sendQuoteToColppy y el estado es NO_APLICA', async () => {
    process.env.FACTURACION_REGISTRAR_COLPPY = 'false'
    const res = await post(body())
    expect(res.status).toBe(201)
    expect((await res.json()).colppy).toEqual({ estado: 'NO_APLICA' })
    expect(ext.sendQuoteToColppy).not.toHaveBeenCalled()
    expect(invoices()[0]).toMatchObject({ colppySyncStatus: 'NO_APLICA', colppyId: null })
    expect(invoices()[0].notes).not.toMatch(/PENDIENTE/)
  })

  it('si Colppy falla, responde 201 con estado ERROR y el payload guardado', async () => {
    ext.sendQuoteToColppy.mockResolvedValueOnce({ success: false, error: 'Colppy: timeout', errorStage: 'colppy', colppyInvoicePayload: { idCliente: 'C77', items: [] } })
    const res = await post(body())
    expect(res.status).toBe(201)
    expect((await res.json()).colppy).toEqual({ estado: 'ERROR', error: 'Colppy: timeout' })
    expect(invoices()[0]).toMatchObject({ colppySyncStatus: 'ERROR', colppySyncError: 'Colppy: timeout', colppyPayload: { idCliente: 'C77' }, colppyId: null })
    expect(invoices()[0].notes).toMatch(/PENDIENTE de registrar en Colppy\./)
  })
})

describe('venta de Mercado Libre vinculada', () => {
  it('candado con el CUIT y el total que van a ARCA, EMITIDA con la Invoice y PDF subido a ML', async () => {
    const res = await post(body({ mlVenta: '4000000001', preciosConIva: true, lineas: [{ descripcion: 'Válvula', cantidad: 1, precioUnitario: 1210 }] }))
    expect(res.status).toBe(201)
    const r = await res.json()
    expect(r.ml).toEqual({ packId: PACK, uploadOk: true })
    // order id de un pack → clave del pack
    expect(tablas.candados.get(PACK)).toMatchObject({ status: 'EMITIDA', invoiceId: r.invoiceId, cuit: '30-71111111-1', total: 1210, mlUploadStatus: 'OK' })
    expect(invoices()[0].notes).toMatch(/^Factura directa\. Venta Mercado Libre #2000009000000001\./)
    expect(ext.uploadPackFiscalDocument).toHaveBeenCalledWith(PACK, expect.any(Buffer), 'factura.pdf')
    expect(ext.sendQuoteToColppy.mock.calls[0][0]).toMatchObject({ descripcion: `Venta Mercado Libre #${PACK}` })
  })

  it('venta con factura adjunta en ML y otro titular: confirmaciones (y el aviso de NC B si es anterior al corte)', async () => {
    // Monotributista (persona): ML informa otro DNI
    tablas.customers.set('CUS4', { ...tablas.customers.get('CUS1'), id: 'CUS4', name: 'PEREZ JUAN', cuit: '20-12345678-6', taxCondition: 'MONOTRIBUTO' })
    ext.consultarPersona.mockResolvedValue(persona({ cuit: '20123456786', tipoPersona: 'FISICA', condicionIva: 'MONOTRIBUTO' }))
    ext.getPackFiscalDocuments.mockResolvedValue([{ id: 'PDF-COLPPY' }])
    ext.getBuyerFiscal.mockResolvedValue({ docType: 'DNI', docNumber: '87654321', name: 'Otra Persona', taxpayerType: 'Consumidor Final' })
    const b = { customerId: 'CUS4', mlVenta: PACK, preciosConIva: true, lineas: [{ descripcion: 'Válvula', cantidad: 1, precioUnitario: 1210 }] }
    const res = await post(body(b))
    expect(res.status).toBe(409)
    const r = await res.json()
    expect(r.codigo).toBe('CONFIRMACION_REQUERIDA')
    expect(r.faltantes).toEqual(['ML_FACTURA_ADJUNTA', 'ML_OTRO_TITULAR'])
    expect(r.confirmacionesRequeridas.find((c: Fila) => c.codigo === 'ML_FACTURA_ADJUNTA').mensaje).toMatch(/anulala con una NC B en Colppy/i)
    expect(r.confirmacionesRequeridas.find((c: Fila) => c.codigo === 'ML_OTRO_TITULAR').mensaje).toMatch(/Otra Persona \(DNI 87654321\)/)
    expect(tablas.candados.size).toBe(0)
    expect(filasDiario()).toHaveLength(0)

    const conTodo = await post(body({ ...b, confirmaciones: [...CONFIRMA, 'ML_FACTURA_ADJUNTA', 'ML_OTRO_TITULAR'] }))
    expect(conTodo.status).toBe(201)
    expect(tablas.candados.get(PACK)).toMatchObject({ status: 'EMITIDA', cuit: '20-12345678-6' })
  })

  it('total distinto del cobrado en ML: confirmación; a una empresa con DNI en ML solo se avisa', async () => {
    ext.getBuyerFiscal.mockResolvedValue({ docType: 'DNI', docNumber: '12345678', name: 'Juan Perez', taxpayerType: 'Consumidor Final' })
    const p = await (await preview(body({ mlVenta: PACK, lineas: [{ descripcion: 'Válvula', cantidad: 2, precioUnitario: 400 }] }))).json()
    expect(p.confirmacionesRequeridas.map((c: Fila) => c.codigo)).toEqual(['ML_TOTAL_DISTINTO', 'EMISION_IRREVERSIBLE'])
    expect(p.confirmacionesRequeridas[0].mensaje).toBe('El total de la factura ($ 968,00) es distinto del cobrado en Mercado Libre ($ 1.210,00).')
    expect(p.avisos.map((a: Fila) => a.codigo)).toEqual(expect.arrayContaining(['ML_ANTERIOR_AL_CORTE', 'ML_TITULAR_EMPRESA']))
    expect(p.ml).toMatchObject({ packId: PACK, totalMl: 1210, titular: 'empresa', facturaEnMl: false })
  })

  it('la venta ya facturada: 409 YA_FACTURADA sin emitir; en dólares no se vincula', async () => {
    tablas.candados.set(PACK, { packId: PACK, status: 'EMITIDA', invoiceId: 'INV-ML' })
    const r = await post(body({ mlVenta: PACK }))
    expect(r.status).toBe(409)
    expect((await r.json()).codigo).toBe('YA_FACTURADA')
    const usd = await post(body({ idempotencyKey: CLAVE2, mlVenta: PACK, moneda: 'USD', tipoCambio: 1450 }))
    expect(usd.status).toBe(422)
    expect((await usd.json()).codigo).toBe('ML_SOLO_ARS')
    expect(ext.emitirComprobante).not.toHaveBeenCalled()
  })

  it('ARCA rechaza: se libera el candado de la venta', async () => {
    ext.emitirComprobante.mockResolvedValueOnce({ ok: false, cbteTipo: 1, puntoVenta: 7, numero: 12, mensaje: '[10015] doc', errores: [{ Code: 10015, Msg: 'doc' }] })
    const r = await post(body({ mlVenta: PACK, confirmaciones: [...CONFIRMA, 'ML_TOTAL_DISTINTO'] }))
    expect(r.status).toBe(422)
    expect(tablas.candados.has(PACK)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Validaciones y vista previa
// ---------------------------------------------------------------------------

describe('validaciones antes de ARCA', () => {
  it('sin confirmar la emisión: 409 CONFIRMACION_REQUERIDA, sin diario ni ARCA', async () => {
    const r = await post(body({ confirmaciones: [] }))
    expect(r.status).toBe(409)
    expect(await r.json()).toMatchObject({ codigo: 'CONFIRMACION_REQUERIDA', faltantes: ['EMISION_IRREVERSIBLE'] })
    expect(filasDiario()).toHaveLength(0)
    expect(ext.emitirComprobante).not.toHaveBeenCalled()
  })

  it('producto con IVA distinto de 21%: 422 IVA_NO_SOPORTADO; producto inexistente: 404', async () => {
    const r = await post(body({ lineas: [{ productId: 'P2', descripcion: 'Libro', cantidad: 1, precioUnitario: 100 }] }))
    expect(r.status).toBe(422)
    expect(await r.json()).toMatchObject({ codigo: 'IVA_NO_SOPORTADO', errores: [{ codigo: 'IVA_NO_SOPORTADO', linea: 1 }] })
    const r404 = await post(body({ lineas: [{ productId: 'NO', descripcion: 'X', cantidad: 1, precioUnitario: 100 }] }))
    expect(r404.status).toBe(404)
    expect((await r404.json()).codigo).toBe('PRODUCTO_NO_EXISTE')
  })

  it('condición distinta de ARCA (incluso RI vs Monotributo): 422; padrón caído: solo aviso', async () => {
    ext.consultarPersona.mockResolvedValue(persona({ condicionIva: 'MONOTRIBUTO' }))
    const r = await post(body())
    expect(r.status).toBe(422)
    expect((await r.json()).codigo).toBe('CONDICION_DISTINTA_ARCA')

    ext.consultarPersona.mockResolvedValue(persona({ activo: false }))
    expect((await (await post(body())).json()).codigo).toBe('CUIT_INACTIVO')

    ext.consultarPersona.mockRejectedValue(new PadronError('ARCA caído', 502))
    const p = await (await preview(body())).json()
    expect(p.ok).toBe(true)
    expect(p.avisos.map((a: Fila) => a.codigo)).toContain('PADRON_NO_DISPONIBLE')
    expect((await post(body())).status).toBe(201)
  })

  it('ARCA sin condición IVA pero con observaciones: RI en el ERP → confirmación (no error); sin tildarla no emite', async () => {
    ext.consultarPersona.mockResolvedValue(persona({ condicionIva: null, observaciones: ['El domicilio fiscal no está confirmado'] }))
    const p = await (await preview(body())).json()
    expect(p.errores.map((e: Fila) => e.codigo)).not.toContain('CONDICION_IVA_INCIERTA')
    const conf = p.confirmacionesRequeridas.find((c: Fila) => c.codigo === 'CONDICION_IVA_SIN_CONFIRMAR')
    expect(conf.mensaje).toContain('El domicilio fiscal no está confirmado')
    expect(conf.mensaje).toContain('según el ERP')
    // Tildando solo la de siempre (EMISION_IRREVERSIBLE) no emite: falta esta
    const r = await post(body())
    expect(r.status).toBe(409)
    const j = await r.json()
    expect(j.codigo).toBe('CONFIRMACION_REQUERIDA')
    expect(j.faltantes).toContain('CONDICION_IVA_SIN_CONFIRMAR')
    // Tildándola, emite la A como dice el ERP
    const ok = await post(body({ confirmaciones: [...CONFIRMA, 'CONDICION_IVA_SIN_CONFIRMAR'] }))
    expect(ok.status).toBe(201)
  })

  it('B a consumidor final ≥ $10M sin documento: 422 DOC_REQUERIDO_CF; con DNI emite con DocTipo 96', async () => {
    const lineas = [{ descripcion: 'Caldera', cantidad: 1, precioUnitario: 10_000_000 }]
    const r = await post(body({ customerId: 'CUS2', preciosConIva: true, condicionPago: 'Contado', lineas }))
    expect(r.status).toBe(422)
    expect((await r.json()).codigo).toBe('DOC_REQUERIDO_CF')
    expect(ext.consultarPersona).not.toHaveBeenCalled() // sin CUIT no hay padrón

    const ok = await post(body({ customerId: 'CUS2', preciosConIva: true, condicionPago: 'Contado', lineas, documentoReceptorB: { docTipo: 96, docNro: '12345678' } }))
    expect(ok.status).toBe(201)
    expect(ext.emitirComprobante.mock.calls[0][0]).toMatchObject({ letra: 'B', receptor: { condicionIvaId: 5, docTipo: 96, docNro: '12345678' }, importes: { total: 10_000_000 } })
    expect(invoices()[0]).toMatchObject({ invoiceNumber: 'B-0007-00000012', docTipo: 96, docNro: '12345678' })
    expect(ext.sendQuoteToColppy.mock.calls[0][0]).toMatchObject({ action: 'factura-contado' })
  })

  it('posible duplicado (misma factura reciente del cliente): pide confirmación de cada motivo por separado', async () => {
    expect((await post(body())).status).toBe(201)
    const r = await post(body({ idempotencyKey: CLAVE2 }))
    expect(r.status).toBe(409)
    const j = await r.json()
    expect(j.faltantes).toEqual(['POSIBLE_DUPLICADO', 'DIRECTA_RECIENTE'])
    expect(j.confirmacionesRequeridas.find((c: Fila) => c.codigo === 'POSIBLE_DUPLICADO').mensaje).toMatch(/A-0007-00000012/)
    expect(j.confirmacionesRequeridas.find((c: Fila) => c.codigo === 'DIRECTA_RECIENTE').mensaje).toMatch(/hace menos de 10 minutos .*\(0007-00000012\)/)
    // El tilde de un motivo no cubre el otro
    expect((await post(body({ idempotencyKey: CLAVE2, confirmaciones: [...CONFIRMA, 'POSIBLE_DUPLICADO'] }))).status).toBe(409)
    expect((await post(body({ idempotencyKey: CLAVE2, confirmaciones: [...CONFIRMA, 'POSIBLE_DUPLICADO', 'DIRECTA_RECIENTE'] }))).status).toBe(201)
  })

  it('un código suelto no confirma nada: hace falta la firma de lo que se mostró', async () => {
    const r = await postCrudo(body({ confirmaciones: ['EMISION_IRREVERSIBLE'] }))
    expect(r.status).toBe(409)
    const j = await r.json()
    expect(j).toMatchObject({ codigo: 'CONFIRMACION_REQUERIDA', faltantes: ['EMISION_IRREVERSIBLE'] })
    expect(j.confirmacionesRequeridas[0].firma).toMatch(/^EMISION_IRREVERSIBLE:[0-9a-f]{14}$/)
    expect(ext.emitirComprobante).not.toHaveBeenCalled()
    // Con la firma de la vista previa, sí
    expect((await postCrudo(body({ confirmaciones: [j.confirmacionesRequeridas[0].firma] }))).status).toBe(201)
  })

  it('un duplicado que aparece después de la vista previa vuelve a pedir confirmación aunque ya se hubiera tildado otro', async () => {
    // Pedido recurrente: hace 3 días se le facturó lo mismo al cliente (desde una cotización)
    tablas.invoices.set('INV-VIEJA', {
      id: 'INV-VIEJA',
      invoiceNumber: 'A-0007-00000005',
      customerId: 'CUS1',
      quoteId: 'Q1',
      transactionType: 'SALE',
      status: 'AUTHORIZED',
      currency: 'ARS',
      total: 1210,
      issueDate: new Date(Date.now() - 3 * 86400000),
    })
    // A ve la vista previa y tilda "posible duplicado" (el de hace 3 días) y la emisión
    const p = await (await preview(body())).json()
    expect(p.confirmacionesRequeridas.map((c: Fila) => c.codigo)).toEqual(['POSIBLE_DUPLICADO', 'EMISION_IRREVERSIBLE'])
    expect(p.confirmacionesRequeridas[0].mensaje).toMatch(/A-0007-00000005/)
    const cuerpoA = body({ confirmaciones: p.confirmacionesRequeridas.map((c: Fila) => c.firma) })

    // Mientras tanto B emite la misma factura al mismo cliente
    expect((await post(body({ idempotencyKey: CLAVE2, confirmaciones: [...CONFIRMA, 'POSIBLE_DUPLICADO'] }))).status).toBe(201)
    expect(ext.emitirComprobante).toHaveBeenCalledTimes(1)

    // A emite con lo que tildó: el motivo nuevo (y el duplicado que ahora es la de B) se vuelven a pedir
    const r = await postCrudo(cuerpoA)
    expect(r.status).toBe(409)
    const j = await r.json()
    expect(j.codigo).toBe('CONFIRMACION_REQUERIDA')
    expect(j.faltantes).toEqual(['POSIBLE_DUPLICADO', 'DIRECTA_RECIENTE'])
    expect(j.confirmacionesRequeridas.find((c: Fila) => c.codigo === 'POSIBLE_DUPLICADO').mensaje).toMatch(/A-0007-00000012/)
    expect(ext.emitirComprobante).toHaveBeenCalledTimes(1)
    expect(filasDiario()).toHaveLength(1)
  })

  it('el dólar de referencia cambió después de la vista previa: se vuelve a pedir la confirmación del TC', async () => {
    const b = body({ moneda: 'USD', tipoCambio: 1500 })
    const p = await (await preview(b)).json()
    expect(p.confirmacionesRequeridas.map((c: Fila) => c.codigo)).toEqual(['TIPO_CAMBIO_ALEJADO', 'EMISION_IRREVERSIBLE'])
    const firmas = p.confirmacionesRequeridas.map((c: Fila) => c.firma)
    // Se cargó el BNA del día (más bajo): el TC tipeado se aleja más todavía
    db.exchangeRate.findFirst.mockResolvedValueOnce({ rate: 1400, validFrom: new Date('2026-10-04T00:00:00Z') })
    const r = await postCrudo({ ...b, confirmaciones: firmas })
    expect(r.status).toBe(409)
    expect((await r.json()).faltantes).toEqual(['TIPO_CAMBIO_ALEJADO'])
    expect(ext.emitirComprobante).not.toHaveBeenCalled()
  })

  it('venta de ML con una factura del ERP por el mismo total: su propia confirmación (POSIBLE_DUPLICADO_ML)', async () => {
    tablas.invoices.set('INV-OTRO', {
      id: 'INV-OTRO',
      invoiceNumber: 'B-0007-00000003',
      customerId: 'CUS2',
      quoteId: null,
      transactionType: 'SALE',
      status: 'AUTHORIZED',
      currency: 'ARS',
      total: 1210,
      issueDate: new Date('2026-09-26T12:00:00-03:00'),
    })
    const p = await (await preview(body({ mlVenta: PACK, preciosConIva: true, lineas: [{ descripcion: 'Válvula', cantidad: 1, precioUnitario: 1210 }] }))).json()
    expect(p.confirmacionesRequeridas.map((c: Fila) => c.codigo)).toEqual(['POSIBLE_DUPLICADO_ML', 'EMISION_IRREVERSIBLE'])
    expect(p.confirmacionesRequeridas[0].mensaje).toMatch(/B-0007-00000003 a CONSUMIDOR FINAL/)
  })

  it('USD con TC alejado del BNA: confirmación; emitida con cotización y exchangeRate', async () => {
    const r = await post(body({ moneda: 'USD', tipoCambio: 1500 }))
    expect(r.status).toBe(409)
    expect((await r.json()).faltantes).toEqual(['TIPO_CAMBIO_ALEJADO'])
    const ok = await post(body({ moneda: 'USD', tipoCambio: 1460 }))
    expect(ok.status).toBe(201)
    expect(ext.emitirComprobante.mock.calls[0][0]).toMatchObject({ moneda: 'USD', cotizacion: 1460, cancelaEnMonedaExtranjera: false })
    expect(invoices()[0]).toMatchObject({ currency: 'USD', exchangeRate: 1460, total: 1210 })
  })

  it('emisor que no es ARCA: 503; cliente del exterior: 422; body mal formado: 400; vendedor: 403', async () => {
    process.env.FACTURACION_EMISOR = 'colppy'
    const r503 = await post(body())
    expect(r503.status).toBe(503)
    expect((await r503.json()).codigo).toBe('EMISOR_NO_ARCA')
    process.env.FACTURACION_EMISOR = 'arca'

    tablas.customers.set('CUS3', { ...tablas.customers.get('CUS1'), id: 'CUS3', cuit: 'CL-76000000-0', taxCondition: 'CLIENTE_EXTERIOR', country: 'Chile' })
    const ext422 = await post(body({ customerId: 'CUS3' }))
    expect(ext422.status).toBe(422)
    expect((await ext422.json()).codigo).toBe('CLIENTE_EXTERIOR')

    const r400 = await post({ ...body(), idempotencyKey: 'no-uuid' })
    expect(r400.status).toBe(400)
    expect((await r400.json()).codigo).toBe('PEDIDO_INVALIDO')

    const r404 = await post(body({ customerId: 'NO' }))
    expect(r404.status).toBe(404)

    ext.session = { user: { id: 'U2', role: 'VENDEDOR' } }
    expect((await post(body())).status).toBe(403)
    expect(ext.emitirComprobante).not.toHaveBeenCalled()
  })

  it('FUERA_DE_HORARIO: la fecha local del proceso no es la de Buenos Aires', () => {
    const t = process.env.TZ
    try {
      process.env.TZ = 'UTC'
      expect(fueraDeHorario(new Date('2026-10-06T01:30:00Z'))).toBe(true) // 22:30 AR del 5, ya 6 en UTC
      expect(fueraDeHorario(new Date('2026-10-05T15:00:00Z'))).toBe(false)
    } finally {
      process.env.TZ = t
    }
    expect(fueraDeHorario(new Date('2026-10-06T01:30:00Z'))).toBe(false)
  })
})

describe('vista previa (sin efectos)', () => {
  it('letra, receptor, totales, fechas y confirmaciones; no escribe nada ni llama a ARCA para emitir', async () => {
    const res = await preview({ ...body(), idempotencyKey: undefined, condicionPago: 'Contado' })
    expect(res.status).toBe(200)
    const p = await res.json()
    expect(p).toMatchObject({
      ok: true,
      letra: 'A',
      cbteTipoPrevisto: 1,
      esFce: false,
      receptor: { docTipo: 80, docNro: '30711111111', condicionIvaId: 1 },
      totales: { neto: 1000, iva: 210, total: 1210, totalArs: 1210 },
      errores: [],
      confirmacionesRequeridas: [{ codigo: 'EMISION_IRREVERSIBLE' }],
      padron: { estado: 'encontrado', condicionIva: 'RESPONSABLE_INSCRIPTO', activo: true },
      ml: null,
      cliente: { id: 'CUS1', condicionPagoSugerida: 'a 30 Dias' },
    })
    expect(p.fechaFactura).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(p.avisos.map((a: Fila) => a.codigo)).toContain('SIN_COMISION')
    expect(ext.emitirComprobante).not.toHaveBeenCalled()
    expect(db.facturaDirecta.create).not.toHaveBeenCalled()
    expect(db.facturaDirecta.updateMany).not.toHaveBeenCalled()
    expect(db.invoice.create).not.toHaveBeenCalled()
    expect(db.mlOrderInvoice.create).not.toHaveBeenCalled()
  })

  it('FCE: "Sale como FCE A" con el cliente obligado y el total ≥ umbral', async () => {
    tablas.customers.get('CUS1')!.fceObligado = true
    const p = await (await preview(body({ lineas: [{ descripcion: 'Caldera', cantidad: 1, precioUnitario: 5_000_000 }] }))).json()
    expect(p).toMatchObject({ ok: true, esFce: true, cbteTipoPrevisto: 201 })
    expect(p.avisos.map((a: Fila) => a.codigo)).toContain('SALE_COMO_FCE')
  })

  it('errores listados con el código (y la línea) sin cortar en el primero', async () => {
    const p = await (await preview(body({ lineas: [{ productId: 'P2', descripcion: '', cantidad: 0, precioUnitario: 1 }] }))).json()
    expect(p.ok).toBe(false)
    expect(p.errores.map((e: Fila) => e.codigo)).toEqual(['IVA_NO_SOPORTADO', 'DESCRIPCION_INVALIDA', 'CANTIDAD_INVALIDA'])
  })
})

// ---------------------------------------------------------------------------
// Fecha del comprobante y QR
// ---------------------------------------------------------------------------

describe('fecha del comprobante', () => {
  it('de 21 a 24 h de Argentina el QR lleva la misma fecha que el comprobante (CbteFch); la Invoice, la hora real', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-10-31T22:30:00-03:00')) // ya es 1/11 en UTC
      const r = await post(body())
      expect(r.status).toBe(201)
      const fecha = ext.emitirComprobante.mock.calls[0][0].fecha as Date
      expect(fechaYmdLocal(fecha)).toBe('2026-10-31') // → CbteFch 20261031
      const qr = JSON.parse(Buffer.from(String(invoices()[0].qrUrl).split('?p=')[1], 'base64').toString('utf8'))
      expect(qr.fecha).toBe('2026-10-31')
      expect(filasDiario()[0].qrUrl).toBe(invoices()[0].qrUrl)
      expect((invoices()[0].issueDate as Date).toISOString()).toBe('2026-11-01T01:30:00.000Z')
    } finally {
      vi.useRealTimers()
    }
  })
})

// ---------------------------------------------------------------------------
// Invoice de una fila AUTORIZADA (la usan la ruta y la reconciliación)
// ---------------------------------------------------------------------------

describe('crearInvoiceDirecta', () => {
  /** Fila huérfana real: ARCA autorizó la 0007-00000012 y la Invoice no se pudo crear */
  async function huerfana(over: Fila = {}): Promise<Fila> {
    db.invoice.create.mockRejectedValueOnce(new Error('db caída'))
    expect((await post(body(over))).status).toBe(500)
    const [fila] = filasDiario()
    expect(fila).toMatchObject({ estado: 'AUTORIZADA', cbteNumero: 12, invoiceId: null })
    return fila
  }
  const ajena = (over: Fila = {}) =>
    tablas.invoices.set('INV-AJENA', {
      id: 'INV-AJENA',
      invoiceNumber: 'A-0007-00000012',
      pointOfSale: 7,
      cbteTipo: 1,
      cbteNumero: 12,
      quoteId: null,
      customerId: 'CUS1',
      currency: 'ARS',
      total: 1210,
      transactionType: 'SALE',
      status: 'AUTHORIZED',
      issueDate: new Date(),
      ...over,
    })

  it('el comprobante ya es la factura de una cotización (u otro cliente, otro total, otra factura directa): lanza y no vincula', async () => {
    const fila = await huerfana()
    for (const [over, motivo] of [
      [{ quoteId: 'Q1' }, /es la factura de una cotización/],
      [{ customerId: 'CUS2' }, /es de otro cliente/],
      [{ total: 1000 }, /tiene otro total/],
    ] as const) {
      ajena(over)
      await expect(crearInvoiceDirecta(db as never, { ...fila } as never)).rejects.toThrow(motivo)
      expect(filasDiario()[0].invoiceId).toBeNull()
    }
    ajena()
    tablas.facturas.set('FD-OTRA', { id: 'FD-OTRA', idempotencyKey: 'otra', estado: 'AUTORIZADA', customerId: 'CUS1', invoiceId: 'INV-AJENA', createdAt: new Date(), updatedAt: new Date() })
    await expect(crearInvoiceDirecta(db as never, { ...fila } as never)).rejects.toThrow(/ya es de otra factura directa \(FD-OTRA\)/)
    expect(fila.invoiceId).toBeNull()
  })

  it('la misma factura ya registrada (sin cotización, mismo cliente y total): la vincula sin crear otra', async () => {
    const fila = await huerfana()
    ajena()
    const r = await crearInvoiceDirecta(db as never, { ...fila } as never)
    expect(r).toEqual({ invoiceId: 'INV-AJENA', invoiceNumber: 'A-0007-00000012', creada: false })
    expect(filasDiario()[0].invoiceId).toBe('INV-AJENA')
  })

  it('venta de ML sin el candado (o con otra factura en él): registra la Invoice igual y lo avisa fuerte, sin tocar el candado ajeno', async () => {
    const ml = { mlVenta: PACK, preciosConIva: true, lineas: [{ descripcion: 'Válvula', cantidad: 1, precioUnitario: 1210 }] }
    const fila = await huerfana(ml)
    expect(tablas.candados.get(PACK)).toMatchObject({ status: 'EMITIENDO', invoiceId: null })

    tablas.candados.set(PACK, { ...tablas.candados.get(PACK)!, status: 'EMITIDA', invoiceId: 'INV-ML' })
    const r = await crearInvoiceDirecta(db as never, { ...fila } as never)
    expect(r.creada).toBe(true)
    expect(r.avisoMl).toMatch(/ya está vinculada a otra factura \(INV-ML\)/)
    expect(tablas.candados.get(PACK)).toMatchObject({ status: 'EMITIDA', invoiceId: 'INV-ML' })
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/^\[DIRECTA_ML_CANDADO\]/), expect.objectContaining({ mlPackId: PACK, candadoInvoiceId: 'INV-ML' }))

    // Sin candado
    tablas.invoices.clear()
    tablas.candados.clear()
    filasDiario()[0].invoiceId = null
    const r2 = await crearInvoiceDirecta(db as never, { ...fila } as never)
    expect(r2.avisoMl).toMatch(/no tiene el candado de la factura directa/)
    expect(tablas.candados.size).toBe(0)
  })
})
