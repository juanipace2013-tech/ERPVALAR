import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'

/**
 * Vínculo venta de ML ↔ factura (src/lib/mercadolibre/venta-ml-vinculo.ts):
 * normalización de la clave (order id de un pack → pack), candado
 * MlOrderInvoice (P2002 = YA_FACTURADA, se libera solo si ARCA seguro no
 * emitió), verificación al emitir, titular y total distintos. Prisma y ML
 * falsos: sin red.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- filas falsas de Prisma, sin tipar a propósito
type Fila = Record<string, any>

const db = vi.hoisted(() => ({
  mlOrderInvoice: { create: vi.fn(), delete: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
  mlItemLink: { findMany: vi.fn() },
}))
const ml = vi.hoisted(() => ({
  getPack: vi.fn(),
  getSaleOrder: vi.fn(),
  getBuyerFiscal: vi.fn(),
  getPackFiscalDocuments: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

// Nunca a la red: importar @prisma/client carga el .env (con credenciales reales)
beforeAll(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      throw new Error(`Red bloqueada en tests: ${String(url)}`)
    })
  )
})
afterAll(() => vi.unstubAllGlobals())
afterEach(() => expect(globalThis.fetch).not.toHaveBeenCalled())
vi.mock('@/lib/mercadolibre/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mercadolibre/client')>()),
  ...ml,
}))

import { Prisma } from '@prisma/client'
import { MlApiError, type MlSaleOrder } from '@/lib/mercadolibre/client'
import type { HookEmisionArca, IntentoEmisionArca } from '@/lib/facturacion/emision-arca'
import { limpiarCachesFacturacionMl } from '@/lib/mercadolibre/facturacion'
import {
  VentaMlError,
  compararTitularVentaMl,
  facturaAdjuntaEnMl,
  inspeccionarVentaMl,
  liberarCandadoVentaMl,
  resolverVentaMl,
  tomarCandadoVentaMl,
  totalDistintoDeMl,
  verificarVentaMlFacturable,
  vincularFacturaAVentaMl,
} from '@/lib/mercadolibre/venta-ml-vinculo'

const PACK = '2000009000000001'
const no404 = () => new MlApiError('404', 404, null)

function orden(over: Partial<MlSaleOrder> = {}): MlSaleOrder {
  return {
    id: 4000000001,
    status: 'paid',
    date_created: '2026-09-25T10:00:00.000-03:00',
    pack_id: Number(PACK),
    total_amount: 93356.08,
    buyer: { id: 1, nickname: 'COMPRADORML', billing_info: { id: 'BI-1' } },
    order_items: [{ item: { id: 'MLA1', title: 'Válvula esférica 1"' }, quantity: 1, unit_price: 93356.08 }],
    ...over,
  }
}

const candados = new Map<string, Fila>()

beforeEach(() => {
  vi.clearAllMocks()
  limpiarCachesFacturacionMl()
  candados.clear()
  db.mlOrderInvoice.create.mockImplementation(async ({ data }: Fila) => {
    if (candados.has(data.packId)) throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5.22.0' })
    candados.set(data.packId, { status: 'EMITIENDO', invoiceId: null, ...data })
    return candados.get(data.packId)
  })
  db.mlOrderInvoice.delete.mockImplementation(async ({ where }: Fila) => {
    const f = candados.get(where.packId)
    candados.delete(where.packId)
    return f
  })
  db.mlOrderInvoice.update.mockImplementation(async ({ where, data }: Fila) => {
    candados.set(where.packId, { ...candados.get(where.packId), ...data })
    return candados.get(where.packId)
  })
  db.mlOrderInvoice.findUnique.mockImplementation(async ({ where }: Fila) => {
    const f = candados.get(where.packId)
    return f ? { ...f, invoice: f.invoiceId ? { id: f.invoiceId, invoiceNumber: 'A-0007-00000003' } : null } : null
  })
  db.mlItemLink.findMany.mockResolvedValue([])
  // Pack de dos órdenes; la orden 4000000002 pertenece al pack
  ml.getPack.mockImplementation(async (id: string) => {
    if (String(id) === PACK) return { id: Number(PACK), orders: [{ id: 4000000001 }, { id: 4000000002 }] }
    throw no404()
  })
  ml.getSaleOrder.mockImplementation(async (id: number | string) => {
    if (Number(id) === 4000000001) return orden({ total_amount: 50000 })
    if (Number(id) === 4000000002) return orden({ id: 4000000002, total_amount: 43356.08, date_created: '2026-09-24T09:00:00.000-03:00' })
    if (Number(id) === 5000000001) return orden({ id: 5000000001, pack_id: null, total_amount: 1000 })
    throw no404()
  })
  ml.getBuyerFiscal.mockResolvedValue({ docType: 'DNI', docNumber: '12345678', name: 'Juan Perez', taxpayerType: 'Consumidor Final' })
  ml.getPackFiscalDocuments.mockRejectedValue(no404())
})

describe('resolverVentaMl: clave de la venta', () => {
  it('un order id que pertenece a un pack devuelve la clave del pack con todas sus órdenes', async () => {
    const v = await resolverVentaMl('4000000002')
    expect(v.packId).toBe(PACK)
    expect(v.orders.map((o) => o.id)).toEqual([4000000001, 4000000002])
    expect(v.totalMl).toBe(93356.08)
    // fecha = la orden más vieja
    expect(v.fecha.toISOString()).toBe(new Date('2026-09-24T09:00:00.000-03:00').toISOString())
  })

  it('el pack tal cual; una orden sin pack es su propia clave', async () => {
    expect((await resolverVentaMl(PACK)).packId).toBe(PACK)
    const sinPack = await resolverVentaMl('5000000001')
    expect(sinPack).toMatchObject({ packId: '5000000001', totalMl: 1000 })
    expect(sinPack.orders).toHaveLength(1)
  })

  it('inexistente en ML → VentaMlError ML_VENTA_NO_EXISTE (404)', async () => {
    const e = await resolverVentaMl('999').catch((x) => x)
    expect(e).toBeInstanceOf(VentaMlError)
    expect(e).toMatchObject({ codigo: 'ML_VENTA_NO_EXISTE', status: 404 })
  })
})

describe('candado MlOrderInvoice', () => {
  const datos = { packId: PACK, orderIds: ['4000000001'], buyerNickname: 'COMPRADORML', cuitReceptor: '20-12345678-6', totalFactura: 93356.07, userId: 'U1' }

  it('toma el candado con el CUIT y el total que van a ARCA', async () => {
    await tomarCandadoVentaMl(datos)
    expect(db.mlOrderInvoice.create).toHaveBeenCalledWith({
      data: { packId: PACK, orderIds: ['4000000001'], buyerNickname: 'COMPRADORML', cuit: '20-12345678-6', total: 93356.07, createdById: 'U1' },
    })
  })

  it('un P2002 al tomar el candado da YA_FACTURADA (409)', async () => {
    await tomarCandadoVentaMl(datos)
    const e = await tomarCandadoVentaMl(datos).catch((x) => x)
    expect(e).toBeInstanceOf(VentaMlError)
    expect(e).toMatchObject({ codigo: 'YA_FACTURADA', status: 409, message: 'Esta venta ya fue facturada (o se está facturando en este momento)' })
  })

  it('otro error de la DB se propaga tal cual', async () => {
    db.mlOrderInvoice.create.mockRejectedValueOnce(new Error('db caída'))
    await expect(tomarCandadoVentaMl(datos)).rejects.toThrow('db caída')
  })

  it('vincular: EMITIDA con su invoiceId (en la transacción que se le pasa)', async () => {
    await tomarCandadoVentaMl(datos)
    const tx = { mlOrderInvoice: { update: vi.fn(async () => ({})) } }
    await vincularFacturaAVentaMl(tx as unknown as Prisma.TransactionClient, PACK, 'INV1')
    expect(tx.mlOrderInvoice.update).toHaveBeenCalledWith({ where: { packId: PACK }, data: { invoiceId: 'INV1', status: 'EMITIDA' } })
  })

  function hook(intento: IntentoEmisionArca | null, emitida = false): HookEmisionArca {
    return {
      hook: vi.fn(),
      getEmision: () => (emitida ? ({ ok: true } as never) : null),
      getIntentoEmision: () => intento,
      getQrUrl: () => null,
      getReceptor: () => null,
      getFceVtoPago: () => null,
    }
  }
  const intento = (estado: IntentoEmisionArca['estado']): IntentoEmisionArca => ({ cbteTipo: 1, puntoVenta: 7, numero: 5, estado })

  it('se libera solo si la emisión quedó descartada (sin hook, nunca pedida, rechazada o no solicitada)', async () => {
    for (const [h, libera] of [
      [null, true],
      [hook(null), true],
      [hook(intento('rechazada')), true],
      [hook(intento('no-solicitada')), true],
      [hook(intento('incierta')), false],
      [hook(intento('en-curso')), false],
      [hook(intento('autorizada'), true), false],
    ] as Array<[HookEmisionArca | null, boolean]>) {
      await tomarCandadoVentaMl(datos)
      expect(await liberarCandadoVentaMl(PACK, h)).toBe(libera)
      expect(candados.has(PACK)).toBe(!libera)
      candados.clear()
    }
    expect(db.mlOrderInvoice.delete).toHaveBeenCalledWith({ where: { packId: PACK } })
  })
})

describe('verificarVentaMlFacturable (al emitir)', () => {
  it('venta con candado (por la clave tal cual): 409 YA_FACTURADA sin llamar a ML', async () => {
    candados.set(PACK, { packId: PACK, status: 'EMITIDA', invoiceId: 'INV9' })
    const e = await verificarVentaMlFacturable(PACK).catch((x) => x)
    expect(e).toMatchObject({ codigo: 'YA_FACTURADA', status: 409 })
    expect(ml.getPack).not.toHaveBeenCalled()
  })

  it('order id de un pack que ya tiene candado: YA_FACTURADA (normaliza antes de buscar)', async () => {
    candados.set(PACK, { packId: PACK, status: 'EMITIENDO', invoiceId: null })
    const e = await verificarVentaMlFacturable('4000000002').catch((x) => x)
    expect(e).toMatchObject({ codigo: 'YA_FACTURADA', status: 409 })
  })

  it('órdenes no pagas: 422 ML_NO_PAGADA', async () => {
    ml.getSaleOrder.mockImplementation(async (id: number) => orden({ id, status: id === 4000000002 ? 'cancelled' : 'paid' }))
    const e = await verificarVentaMlFacturable(PACK).catch((x) => x)
    expect(e).toMatchObject({ codigo: 'ML_NO_PAGADA', status: 422, message: 'La venta tiene órdenes que no están pagas (4000000002: cancelled)' })
  })

  it('la factura adjunta en ML se consulta sin caché', async () => {
    expect(await facturaAdjuntaEnMl(PACK)).toBe(false) // queda en caché 3 min
    ml.getPackFiscalDocuments.mockResolvedValue([{ id: 'PDF-COLPPY' }])
    expect(await facturaAdjuntaEnMl(PACK)).toBe(false)
    const v = await verificarVentaMlFacturable(PACK)
    expect(v.facturaEnMl).toBe(true)
  })
})

describe('inspeccionarVentaMl (informativa)', () => {
  it('pack, total, documento de ML, líneas para precargar y anterior al corte', async () => {
    db.mlItemLink.findMany.mockResolvedValue([{ mlItemId: 'MLA1', product: { id: 'P1', sku: 'VAL-1', name: 'Válvula esférica 1" GENEBRE' } }])
    const v = await inspeccionarVentaMl('4000000002')
    expect(v).toMatchObject({
      packId: PACK,
      orderIds: ['4000000001', '4000000002'],
      totalMl: 93356.08,
      pagada: true,
      documentoMl: { tipo: 'DNI', numero: '12345678' },
      nombreMl: 'Juan Perez',
      facturaEnMl: false,
      yaFacturada: null,
      anteriorAlCorte: true, // 24/9/2026: antes del corte del 1/10
    })
    expect(v.lineas[0]).toEqual({ productId: 'P1', sku: 'VAL-1', descripcion: 'Válvula esférica 1" GENEBRE', cantidad: 1, precioUnitario: 93356.08 })
  })

  it('ya facturada desde el ERP: lo informa sin pedirle más datos a ML', async () => {
    candados.set(PACK, { packId: PACK, status: 'EMITIDA', invoiceId: 'INV3' })
    const v = await inspeccionarVentaMl(PACK)
    expect(v.yaFacturada).toEqual({ invoiceId: 'INV3', invoiceNumber: 'A-0007-00000003', status: 'EMITIDA' })
    expect(ml.getBuyerFiscal).not.toHaveBeenCalled()
    expect(ml.getPackFiscalDocuments).not.toHaveBeenCalled()
  })
})

describe('otro titular y total distinto', () => {
  it('mismo CUIT/CUIL o mismo DNI (el de adentro del CUIL) → mismo', () => {
    expect(compararTitularVentaMl('20123456786', { numero: '20-12345678-6' })).toBe('mismo')
    expect(compararTitularVentaMl('20123456786', { numero: '12345678' })).toBe('mismo')
    expect(compararTitularVentaMl('27123456780', { numero: '20-12345678-6' })).toBe('mismo') // otro CUIL del mismo DNI
    expect(compararTitularVentaMl('12345678', { numero: '12.345.678' })).toBe('mismo') // B con DNI
    expect(compararTitularVentaMl('20051234562', { numero: '5123456' })).toBe('mismo') // DNI de 7 dígitos
  })

  it('persona distinta → otro (confirmación); CUIT de empresa → empresa (solo se informa)', () => {
    expect(compararTitularVentaMl('20123456786', { numero: '87654321' })).toBe('otro')
    expect(compararTitularVentaMl('12345678', { numero: '20-87654321-1' })).toBe('otro')
    expect(compararTitularVentaMl('20123456786', { numero: '30-71111111-8' })).toBe('otro')
    expect(compararTitularVentaMl('30711111118', { numero: '12345678' })).toBe('empresa')
    expect(compararTitularVentaMl('33693450239', { numero: '30-71111111-8' })).toBe('empresa')
    expect(compararTitularVentaMl('30711111118', { numero: '30-71111111-8' })).toBe('mismo')
  })

  it('sin documento de ML o factura sin documento (99) → sin-dato', () => {
    expect(compararTitularVentaMl('20123456786', null)).toBe('sin-dato')
    expect(compararTitularVentaMl('0', { numero: '12345678' })).toBe('sin-dato')
    expect(compararTitularVentaMl(null, { numero: '12345678' })).toBe('sin-dato')
  })

  it('total distinto: 1 peso o más (la A con precios finales redondea centavos: no cuenta)', () => {
    expect(totalDistintoDeMl(99.99, 100)).toBe(false)
    expect(totalDistintoDeMl(93356.07, 93356.08)).toBe(false)
    expect(totalDistintoDeMl(99, 100)).toBe(true)
    expect(totalDistintoDeMl(101.5, 100)).toBe(true)
  })
})
