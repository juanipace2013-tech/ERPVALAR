import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * Factura E desde una cotización (servicio de negocio): armado de ítems en USD
 * sin IVA, validaciones previas, persistencia del diario FacturaExportacion,
 * registro de la Invoice + CotizacionFactura (solo mercadería) y el guard de
 * NC. Con DB (Prisma) y ARCA (WSFEX) falsos: sin red ni base.
 *
 * Los datos del caso Chile son de PRUEBA (domicilio, RUT, N° de DES del
 * manual, cotización y el flete de USD 120: el flete real todavía no se conoce).
 */

// ---------------------------------------------------------------------------
// Mocks (hoisted): Prisma en memoria, ARCA, comisiones, SharePoint y logger
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- filas falsas de Prisma, sin tipar a propósito
type Fila = Record<string, any>

const db = vi.hoisted(() => {
  const filas = new Map<string, Fila>()
  const m = {
    filas,
    quote: { findUnique: vi.fn(), update: vi.fn() },
    facturaExportacion: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      aggregate: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    invoice: { create: vi.fn() },
    cotizacionFactura: { create: vi.fn() },
    quoteStatusHistory: { create: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  }
  return m
})

vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/sharepoint/facturas-emitidas', () => ({
  archivarFacturaEnSharePointBg: vi.fn(),
  archivarFacturaEnSharePoint: vi.fn(async () => ({ ok: false, omitido: true, error: 'test' })),
}))
vi.mock('@/lib/comisiones/liquidacion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/comisiones/liquidacion')>()),
  sincronizarComisionesDeQuote: vi.fn(async () => undefined),
}))
vi.mock('@/lib/arca/wsfex', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/arca/wsfex')>()),
  fexGetLastCmp: vi.fn(),
  fexGetLastId: vi.fn(),
  fexAuthorize: vi.fn(),
  fexGetCmp: vi.fn(),
  fexGetCotizacion: vi.fn(),
}))

import { ExportacionBloqueadaError, ExportacionValidacionError } from '@/lib/arca/emitir-exportacion'
import { fexAuthorize, fexGetCotizacion, fexGetLastCmp, fexGetLastId, type FexAuthorizeResult } from '@/lib/arca/wsfex'
import { sincronizarComisionesDeQuote } from '@/lib/comisiones/liquidacion'
import { archivarFacturaEnSharePointBg } from '@/lib/sharepoint/facturas-emitidas'
import {
  FORMA_PAGO_DEFAULT,
  FacturaExportacionError,
  MARCA_COLPPY_MANUAL,
  armarItemsExportacion,
  cantidadPendienteQuoteItem,
  codigoQuoteItem,
  descripcionQuoteItem,
  emitirFacturaExportacion,
  formaPagoPorDefecto,
  montosComisionExportacion,
  notasFacturaExportacion,
  parsePedidoFacturaExportacion,
  persistenciaFacturaExportacion,
  prefillFacturaExportacion,
  qrUrlExportacion,
  registrarInvoiceExportacion,
  saldoFobDes,
  vistaPreviaFacturaExportacion,
  type PedidoFacturaExportacion,
  type QuoteItemExportable,
} from '@/lib/facturacion/factura-exportacion'
import { MENSAJE_NC_EXPORTACION, NotaCreditoError, assertNoEsExportacion } from '@/lib/facturacion/nota-credito-arca'

const FIXTURE = fs.readFileSync(path.resolve(__dirname, '../fixtures/fex-chile-exporta-simple.xml'), 'utf8')
const normalizarXml = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><').trim()

/** 5/10/2026 10:00 en Argentina (13:00 UTC): la fecha del XML de referencia */
const AHORA = new Date('2026-10-05T13:00:00Z')
const CAE = '76543210987654'

// ---------------------------------------------------------------------------
// Datos de prueba
// ---------------------------------------------------------------------------

function quoteItem(over: Partial<QuoteItemExportable> = {}): QuoteItemExportable {
  return {
    id: 'qi1',
    itemNumber: 10,
    productId: 'p1',
    description: null,
    manualSku: null,
    product: { sku: '2228 12', name: 'Válvula GENEBRE art. 2228 12' },
    additionals: [],
    quantity: 3,
    unitPrice: 692.96,
    cantidadPendiente: 3,
    ...over,
  }
}

/** Cotización VAL-2026-3507 (CLAUGER CHILE SPA, 3 × 2228 12) tal como la devuelve Prisma */
function quoteChile(over: Record<string, unknown> = {}) {
  return {
    id: 'q1',
    quoteNumber: 'VAL-2026-3507',
    status: 'ACCEPTED',
    currency: 'USD',
    bonification: 0,
    terms: 'Transferencia anticipada 100%',
    purchaseOrderNumber: '90855-196-049',
    customerId: 'c1',
    salesPersonId: 'u-vendedor',
    customer: {
      id: 'c1',
      name: 'CLAUGER CHILE SPA',
      businessName: 'CLAUGER CHILE SPA',
      type: 'BUSINESS',
      taxCondition: 'CLIENTE_EXTERIOR',
      country: 'Chile',
      address: 'Av. Ejemplo 1234',
      city: 'Santiago',
      taxIdExterior: '76.123.456-7',
      paymentTerms: 0,
    },
    items: [
      {
        id: 'qi1',
        itemNumber: 10,
        productId: 'p1',
        description: null,
        manualSku: null,
        product: { sku: '2228 12', name: 'Válvula GENEBRE art. 2228 12' },
        additionals: [],
        quantity: 3,
        unitPrice: 692.96,
        cantidadFacturada: 0,
        invoiceItems: [],
      },
    ],
    ...over,
  }
}

function pedidoChile(over: Partial<PedidoFacturaExportacion> = {}): PedidoFacturaExportacion {
  return {
    items: [{ quoteItemId: 'qi1', cantidad: 3 }],
    // Flete de PRUEBA: el importe real todavía no se conoce
    lineasManuales: [{ descripcion: 'Flete internacional', precioUnitario: 120 }],
    desNumero: '2133ECSI12',
    fobUSD: 2078.88,
    incoterm: 'CPT',
    incotermLugar: 'Santiago',
    formaPago: 'Transferencia bancaria',
    ...over,
  }
}

function respuestaA(over: Partial<FexAuthorizeResult> = {}): FexAuthorizeResult {
  return {
    Id: 1,
    Cuit: '30715373579',
    Cbte_tipo: 19,
    Punto_vta: 10,
    Cbte_nro: 1,
    Cae: CAE,
    Fch_venc_Cae: '20261015',
    Fch_cbte: '20261005',
    Resultado: 'A',
    Reproceso: false,
    Motivos_Obs: '',
    errores: [],
    eventos: [],
    raw: {},
    ...over,
  }
}

const ENV_ARCA = {
  ARCA_ENV: 'homo',
  ARCA_CUIT: '30715373579',
  ARCA_CERT_PATH: '/tmp/test.crt',
  ARCA_KEY_PATH: '/tmp/test.key',
  ARCA_PUNTO_VENTA: '7',
  ARCA_PUNTO_VENTA_EXPO: '10',
}
const envPrevio: Record<string, string | undefined> = {}

/** Prisma en memoria para FacturaExportacion; el resto de los modelos son vi.fn */
function prepararDb(quote: unknown = quoteChile()) {
  db.filas.clear()
  db.quote.findUnique.mockResolvedValue(quote)
  db.quote.update.mockResolvedValue({})
  db.facturaExportacion.create.mockImplementation(async ({ data }: { data: Fila }) => {
    const fila = {
      id: `fx-${data.fexId}`,
      invoiceId: null,
      cae: null,
      caeVencimiento: null,
      fechaCbte: null,
      motivosObs: null,
      reproceso: false,
      recuperado: false,
      errores: null,
      ...data,
    }
    db.filas.set(String(data.fexId), fila)
    return fila
  })
  db.facturaExportacion.update.mockImplementation(async ({ where, data }: { where: Fila; data: Fila }) => {
    const fila =
      where.fexId !== undefined ? db.filas.get(String(where.fexId)) : [...db.filas.values()].find((f) => f.id === where.id)
    if (!fila) throw new Error('fila inexistente')
    Object.assign(fila, data)
    return fila
  })
  db.facturaExportacion.findUnique.mockImplementation(async ({ where }: { where: Fila }) => {
    const fila = db.filas.get(String(where.fexId))
    return fila ? { ...fila, customer: { paymentTerms: 0 } } : null
  })
  // buscarBloqueante: { puntoVenta, OR: [{ estado: { in } }, { estado, invoiceId: null }] }
  db.facturaExportacion.findFirst.mockImplementation(
    async ({ where }: { where: Fila }) =>
      [...db.filas.values()].find(
        (f) =>
          f.puntoVenta === where.puntoVenta &&
          (where.OR as Fila[]).some((c) =>
            c.estado.in ? c.estado.in.includes(f.estado) : f.estado === c.estado && f.invoiceId === c.invoiceId
          )
      ) ?? null
  )
  db.facturaExportacion.findMany.mockImplementation(async ({ where }: { where: Fila }) =>
    [...db.filas.values()].filter((f) => f.desNumero === where.desNumero && f.estado === where.estado)
  )
  db.facturaExportacion.aggregate.mockImplementation(async ({ where, _max }: { where?: Fila; _max: Fila }) => {
    const todas = [...db.filas.values()]
    if (_max.fexId) {
      return { _max: { fexId: todas.length ? todas.map((f) => f.fexId as bigint).reduce((a, b) => (a > b ? a : b)) : null } }
    }
    const nums = todas
      .filter((f) => f.puntoVenta === where?.puntoVenta && f.cbteTipo === where?.cbteTipo && f.estado === where?.estado)
      .map((f) => f.cbteNumero as number)
    return { _max: { cbteNumero: nums.length ? Math.max(...nums) : null } }
  })
  db.invoice.create.mockImplementation(async ({ data }: { data: Fila }) => ({ id: 'inv-1', ...data }))
  db.cotizacionFactura.create.mockResolvedValue({ id: 'cf-1' })
  db.quoteStatusHistory.create.mockResolvedValue({})
  db.$executeRaw.mockResolvedValue(1)
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db))

  vi.mocked(fexGetLastCmp).mockResolvedValue(0)
  vi.mocked(fexGetLastId).mockResolvedValue(0)
  vi.mocked(fexGetCotizacion).mockResolvedValue({
    monId: 'DOL',
    cotizacion: 1450.5,
    fechaConsultada: '2026-10-05',
    fechaCotizacion: '20261002',
    diasAtras: 0,
  })
  vi.mocked(fexAuthorize).mockResolvedValue(respuestaA())
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(AHORA)
  for (const [k, v] of Object.entries(ENV_ARCA)) {
    envPrevio[k] = process.env[k]
    process.env[k] = v
  }
  prepararDb()
})

afterEach(() => {
  vi.useRealTimers()
  for (const [k, v] of Object.entries(envPrevio)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

async function errorDe(p: Promise<unknown>): Promise<Error> {
  try {
    await p
  } catch (e) {
    return e as Error
  }
  throw new Error('se esperaba un error')
}

// ---------------------------------------------------------------------------
// Helpers puros
// ---------------------------------------------------------------------------

describe('helpers puros', () => {
  it('cantidad pendiente: misma regla que generate-invoice (NC restan, anuladas no cuentan, máx. con la columna)', () => {
    const inv = (status: string, transactionType = 'SALE') => ({ status, transactionType })
    expect(cantidadPendienteQuoteItem({ quantity: 5, cantidadFacturada: 0, invoiceItems: [] })).toBe(5)
    expect(
      cantidadPendienteQuoteItem({
        quantity: 5,
        cantidadFacturada: 0,
        invoiceItems: [
          { quantity: 3, invoice: inv('AUTHORIZED') },
          { quantity: 1, invoice: inv('AUTHORIZED', 'CREDIT_NOTE') },
          { quantity: 2, invoice: inv('CANCELLED') },
        ],
      })
    ).toBe(3)
    // La columna manda cuando es mayor
    expect(cantidadPendienteQuoteItem({ quantity: 5, cantidadFacturada: '4', invoiceItems: [{ quantity: 1, invoice: inv('AUTHORIZED') }] })).toBe(1)
  })

  it('forma de pago por defecto: primera línea de las condiciones si entra en 50 caracteres', () => {
    expect(formaPagoPorDefecto('Transferencia anticipada 100%\nPlazo de entrega: 15 días')).toBe('Transferencia anticipada 100%')
    expect(formaPagoPorDefecto('  \n  Contado  ')).toBe('Contado')
    expect(formaPagoPorDefecto(null)).toBe(FORMA_PAGO_DEFAULT)
    expect(formaPagoPorDefecto('x'.repeat(51))).toBe(FORMA_PAGO_DEFAULT)
  })

  it('descripción y código del ítem (los adicionales van en la misma línea)', () => {
    expect(descripcionQuoteItem(quoteItem())).toBe('Válvula GENEBRE art. 2228 12')
    expect(descripcionQuoteItem(quoteItem({ description: 'Válvula esférica 1/2"' }))).toBe('Válvula esférica 1/2"')
    expect(
      descripcionQuoteItem(
        quoteItem({ additionals: [{ description: null, product: { name: 'Actuador 5952' } }, { description: 'Montaje', product: null }] })
      )
    ).toBe('Válvula GENEBRE art. 2228 12 (incluye: Actuador 5952, Montaje)')
    expect(codigoQuoteItem(quoteItem())).toBe('2228 12')
    expect(codigoQuoteItem(quoteItem({ product: null, manualSku: 'MAN-1' }))).toBe('MAN-1')
    expect(codigoQuoteItem(quoteItem({ product: null, manualSku: null }))).toBeNull()
  })

  it('arma los ítems: mercadería vinculada a la cotización + flete manual que no comisiona', () => {
    const { items, lineas, errores } = armarItemsExportacion([quoteItem()], pedidoChile(), 0)
    expect(errores).toEqual([])
    expect(items).toEqual([
      { codigo: '2228 12', descripcion: 'Válvula GENEBRE art. 2228 12', cantidad: 3, precioUnitario: 692.96, bonificacion: 0, cantidadPendiente: 3 },
      { codigo: null, descripcion: 'Flete internacional', cantidad: 1, precioUnitario: 120, bonificacion: 0, manual: true },
    ])
    expect(lineas.map((l) => [l.quoteItemId, l.manual, l.subtotal])).toEqual([
      ['qi1', false, 2078.88],
      [null, true, 120],
    ])
  })

  it('el descuento % se manda como MONTO de bonificación, redondeado al centavo', () => {
    const { items, lineas } = armarItemsExportacion([quoteItem()], { items: [{ quoteItemId: 'qi1', cantidad: 3 }] }, 3)
    // 3 × 692,96 = 2078,88; 3% = 62,3664 → 62,37
    expect(items[0].bonificacion).toBe(62.37)
    expect(lineas[0]).toMatchObject({ descuentoPct: 3, bonificacion: 62.37, subtotal: 2016.51 })
    // El descuento por línea pisa el de la cotización; precio y descripción editables
    const r = armarItemsExportacion(
      [quoteItem()],
      { items: [{ quoteItemId: 'qi1', cantidad: 1, precioUnitario: 700, descuentoPct: 0, descripcion: 'Ball valve 2228 12' }] },
      3
    )
    expect(r.items[0]).toMatchObject({ precioUnitario: 700, bonificacion: 0, descripcion: 'Ball valve 2228 12' })
  })

  it('junta todos los errores de los ítems', () => {
    const { errores } = armarItemsExportacion(
      [quoteItem()],
      {
        items: [
          { quoteItemId: 'otro', cantidad: 1 },
          { quoteItemId: 'qi1', cantidad: 1.234 },
          { quoteItemId: 'qi1', cantidad: 1 },
        ],
        lineasManuales: [{ descripcion: ' ', precioUnitario: 0 }],
      },
      0
    )
    expect(errores).toEqual([
      'El ítem otro no pertenece a la cotización (o es una alternativa)',
      'Ítem 10: la cantidad admite hasta 2 decimales',
      'Ítem 10: está elegido dos veces',
      'Línea manual 1: falta la descripción (ej. "Flete internacional")',
      'Línea manual 1: el importe tiene que ser mayor a cero, con hasta 2 decimales',
    ])
    expect(armarItemsExportacion([quoteItem()], { items: [] }, 0).errores).toContain('Elegí al menos un ítem de la cotización')
    expect(
      armarItemsExportacion([quoteItem()], { items: [{ quoteItemId: 'qi1', cantidad: 1, descuentoPct: 100 }] }, 0).errores
    ).toEqual(['Ítem 10: el descuento tiene que estar entre 0 y 100%'])
  })

  it('saldo FOB de un DES: facturas suman, NC restan, solo AUTORIZADAS', () => {
    expect(saldoFobDes([])).toBe(0)
    expect(
      saldoFobDes([
        { cbteTipo: 19, estado: 'AUTORIZADA', fobUSD: 2078.88 },
        { cbteTipo: 19, estado: 'RECHAZADA', fobUSD: 2078.88 },
      ])
    ).toBe(2078.88)
    expect(
      saldoFobDes([
        { cbteTipo: 19, estado: 'AUTORIZADA', fobUSD: 2078.88 },
        { cbteTipo: 21, estado: 'AUTORIZADA', fobUSD: 2078.88 },
      ])
    ).toBe(0)
  })

  it('comisión: solo la mercadería, en USD y ARS con el TC de ARCA', () => {
    expect(montosComisionExportacion({ mercaderiaUSD: 2078.88 }, 1450.5)).toEqual({
      montoUSD: 2078.88,
      montoARS: 3015415.44,
      tipoCambio: 1450.5,
    })
  })

  it('QR de la E: moneda DOL y sin documento del receptor', () => {
    const url = qrUrlExportacion(
      { Punto_vta: 10, Cbte_Tipo: 19, Cbte_nro: 1, Imp_total: 2198.88, Moneda_ctz: 1450.5 },
      { cae: CAE, fechaCbte: '20261005', cuit: '30715373579' }
    )
    const qr = JSON.parse(Buffer.from(url.split('?p=')[1], 'base64').toString('utf8'))
    expect(qr).toMatchObject({ fecha: '2026-10-05', cuit: 30715373579, ptoVta: 10, tipoCmp: 19, nroCmp: 1, importe: 2198.88, moneda: 'DOL', ctz: 1450.5, codAut: Number(CAE) })
    expect(qr).not.toHaveProperty('tipoDocRec')
    expect(qr).not.toHaveProperty('nroDocRec')
  })

  it('la nota de la Invoice trae DES, FOB, Incoterm, flete y el aviso de carga manual en Colppy', () => {
    const n = notasFacturaExportacion({
      numeroInterno: 'E-0010-00000001',
      cae: CAE,
      emitidaEl: AHORA,
      cmp: {
        Incoterms: 'CPT',
        Incoterms_Ds: 'Santiago',
        Moneda_ctz: 1450.5,
        Opcionales: [
          { Id: '2401', Valor: '2133ECSI12' },
          { Id: '2402', Valor: '2078.88' },
        ],
      },
      manualUSD: 120,
    })
    expect(n).toContain('Factura E E-0010-00000001')
    expect(n).toContain(`CAE ${CAE}`)
    expect(n).toContain('DES 2133ECSI12, FOB USD 2.078,88')
    expect(n).toContain('Incoterm CPT Santiago')
    expect(n).toContain('Flete/seguro USD 120,00 (no comisiona)')
    expect(n.endsWith(MARCA_COLPPY_MANUAL)).toBe(true)
  })

  it('valida la forma del body del POST', () => {
    const ok = parsePedidoFacturaExportacion({ ...pedidoChile(), dryRun: true })
    expect(ok.errores).toEqual([])
    expect(ok.pedido).toMatchObject({ desNumero: '2133ECSI12', fobUSD: 2078.88, items: [{ quoteItemId: 'qi1', cantidad: 3 }] })
    expect(parsePedidoFacturaExportacion(null).pedido).toBeNull()
    const mal = parsePedidoFacturaExportacion({ items: [{ quoteItemId: 'qi1', cantidad: '3' }], fobUSD: '2078.88', lineasManuales: {} })
    expect(mal.pedido).toBeNull()
    expect(mal.errores).toEqual([
      'items[0]: la cantidad tiene que ser un número',
      'lineasManuales tiene que ser una lista de { descripcion, precioUnitario }',
      'fobUSD tiene que ser un número',
    ])
  })
})

// ---------------------------------------------------------------------------
// Guard de NC A/B
// ---------------------------------------------------------------------------

describe('guard de NC A/B sobre comprobantes de exportación', () => {
  it('rechaza NC A/B (WSFE) sobre una Factura, ND o NC E', () => {
    for (const tipo of [19, 20, 21]) {
      const e = (() => {
        try {
          assertNoEsExportacion(tipo)
        } catch (err) {
          return err
        }
      })()
      expect(e).toBeInstanceOf(NotaCreditoError)
      expect((e as NotaCreditoError).status).toBe(422)
      expect((e as Error).message).toBe(MENSAJE_NC_EXPORTACION)
    }
  })

  it('no toca A, B ni FCE', () => {
    for (const tipo of [1, 6, 11, 201, 206, null, undefined]) expect(() => assertNoEsExportacion(tipo)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Persistencia del diario
// ---------------------------------------------------------------------------

describe('persistencia FacturaExportacion', () => {
  it('un rechazo libera el número (numeroOcupado null) y guarda los errores', async () => {
    const p = persistenciaFacturaExportacion({ quoteId: 'q1', customerId: 'c1', userId: 'u1', lineas: [] })
    db.filas.set('5', { id: 'fx-5', fexId: BigInt(5), cbteNumero: 1, numeroOcupado: 1, estado: 'PENDIENTE' })
    await p.marcarRechazada(5, { errores: [{ Code: 2059, Msg: 'DES inexistente' }], mensaje: 'x', response: null })
    expect(db.filas.get('5')).toMatchObject({ estado: 'RECHAZADA', numeroOcupado: null, errores: '[2059] DES inexistente' })
  })

  it('el control de numeración (prod) solo se agrega si se pide', () => {
    expect(persistenciaFacturaExportacion({ quoteId: null, customerId: 'c', userId: 'u', lineas: [] }).ultimoNumeroAutorizado).toBeUndefined()
    expect(
      persistenciaFacturaExportacion({ quoteId: null, customerId: 'c', userId: 'u', lineas: [] }, { controlarNumeracion: true })
        .ultimoNumeroAutorizado
    ).toBeTypeOf('function')
  })
})

// ---------------------------------------------------------------------------
// Servicio completo (DB y ARCA falsos)
// ---------------------------------------------------------------------------

describe('Factura E desde una cotización', () => {
  it('vista previa (dryRun): el Cmp exacto es el XML de referencia y NO llama a FEXAuthorize ni reserva', async () => {
    const v = await vistaPreviaFacturaExportacion('q1', pedidoChile())
    expect(v.cmpXml).toBe(normalizarXml(FIXTURE))
    expect(v).toMatchObject({ dryRun: true, numeroInterno: 'E-0010-00000001', fexId: 1, quoteNumber: 'VAL-2026-3507' })
    expect(v.totales).toEqual({ totalUSD: 2198.88, mercaderiaUSD: 2078.88, manualUSD: 120 })
    expect(v.cotizacionArca.fechaCotizacion).toBe('20261002')
    expect(v.xml).toContain('<ar:Token>(oculto)</ar:Token>')
    expect(fexAuthorize).not.toHaveBeenCalled()
    expect(db.facturaExportacion.create).not.toHaveBeenCalled()
  })

  it('emite: reserva ANTES de ARCA y registra Invoice E, CotizacionFactura (solo mercadería) y la cotización', async () => {
    vi.mocked(fexAuthorize).mockImplementation(async () => {
      // La fila ya estaba PENDIENTE con el Id cuando se llamó a ARCA
      expect(db.filas.get('1')).toMatchObject({ estado: 'PENDIENTE', numeroOcupado: 1, desNumero: '2133ECSI12', fobUSD: 2078.88 })
      return respuestaA()
    })
    const r = await emitirFacturaExportacion('q1', pedidoChile({ cotizacionEsperada: 1450.5 }), { userId: 'u1' })
    expect(r).toMatchObject({ ok: true, invoiceId: 'inv-1', huerfana: false, numeroInterno: 'E-0010-00000001', cae: CAE, fexId: 1 })

    // Lo enviado es exactamente lo reservado
    const fila = db.filas.get('1')!
    expect(fexAuthorize).toHaveBeenCalledWith(fila.cmpXml)
    expect(fila).toMatchObject({
      estado: 'AUTORIZADA',
      invoiceId: 'inv-1',
      cae: CAE,
      fechaCbte: '20261005',
      totalUSD: 2198.88,
      mercaderiaUSD: 2078.88,
      manualUSD: 120,
      incoterm: 'CPT',
      canMisMonExt: 'S',
      quoteId: 'q1',
      createdById: 'u1',
    })

    const inv = db.invoice.create.mock.calls[0][0].data
    expect(inv).toMatchObject({
      invoiceNumber: 'E-0010-00000001',
      invoiceType: 'E',
      transactionType: 'SALE',
      status: 'AUTHORIZED',
      emitidaPor: 'ARCA',
      pointOfSale: 10,
      cbteTipo: 19,
      cbteNumero: 1,
      currency: 'USD',
      exchangeRate: 1450.5,
      subtotal: 2198.88,
      taxAmount: 0,
      total: 2198.88,
      balance: 2198.88,
      docTipo: null,
      docNro: '76.123.456-7',
      colppySyncStatus: 'MANUAL',
      userId: 'u-vendedor',
      cae: CAE,
    })
    const qr = JSON.parse(Buffer.from(inv.qrUrl.split('?p=')[1], 'base64').toString('utf8'))
    expect(qr).toMatchObject({ moneda: 'DOL', tipoCmp: 19, ptoVta: 10, importe: 2198.88 })
    expect(inv.items.create).toEqual([
      expect.objectContaining({ quoteItemId: 'qi1', sku: '2228 12', quantity: 3, unitPrice: 692.96, taxRate: 0, subtotal: 2078.88 }),
      expect.objectContaining({ quoteItemId: null, description: 'Flete internacional', quantity: 1, taxRate: 0, subtotal: 120 }),
    ])

    // Comisión: el flete no cuenta
    const cf = db.cotizacionFactura.create.mock.calls[0][0].data
    expect(cf).toMatchObject({ estado: 'EMITIDA', invoiceId: 'inv-1', numeroFactura: 'E-0010-00000001', montoUSD: 2078.88, tipoCambio: 1450.5 })
    expect(cf.items.create).toEqual([{ cotizacionItemId: 'qi1', cantidad: 3, precioUnitario: 692.96, subtotal: 2078.88 }])

    // Cotización: 3 de 3 facturadas → CONVERTED
    expect(db.$executeRaw).toHaveBeenCalledTimes(1)
    expect(db.quote.update.mock.calls[0][0].data).toMatchObject({ status: 'CONVERTED' })
    expect(sincronizarComisionesDeQuote).toHaveBeenCalledWith('q1', { crearLiquidacion: true })
    expect(archivarFacturaEnSharePointBg).toHaveBeenCalledWith('inv-1')
  })

  it('facturación parcial: deja la cotización FACTURADA_PARCIAL', async () => {
    const r = await emitirFacturaExportacion(
      'q1',
      pedidoChile({ items: [{ quoteItemId: 'qi1', cantidad: 1 }], fobUSD: 692.96 }),
      { userId: 'u1' }
    )
    expect(r.ok).toBe(true)
    expect(db.quote.update.mock.calls[0][0].data).toMatchObject({ status: 'FACTURADA_PARCIAL' })
  })

  it("rechazo de ARCA: RECHAZADA, libera el número y no crea Invoice", async () => {
    vi.mocked(fexAuthorize).mockResolvedValue(
      respuestaA({ Resultado: 'R', Cae: '', errores: [{ Code: 2059, Msg: 'DES inexistente' }] })
    )
    const r = await emitirFacturaExportacion('q1', pedidoChile(), { userId: 'u1' })
    expect(r).toMatchObject({ ok: false, estado: 'RECHAZADA', fexId: 1, numeroFormateado: '0010-00000001' })
    expect(db.filas.get('1')).toMatchObject({ estado: 'RECHAZADA', numeroOcupado: null })
    expect(db.invoice.create).not.toHaveBeenCalled()
    expect(sincronizarComisionesDeQuote).not.toHaveBeenCalled()
  })

  it('si el ERP no puede guardar la Invoice queda huérfana: AUTORIZADA con CAE y sin invoiceId (nunca re-emitir)', async () => {
    db.invoice.create.mockRejectedValue(new Error('deadlock'))
    const r = await emitirFacturaExportacion('q1', pedidoChile(), { userId: 'u1' })
    expect(r).toMatchObject({ ok: true, huerfana: true, invoiceId: null, cae: CAE })
    expect(db.filas.get('1')).toMatchObject({ estado: 'AUTORIZADA', cae: CAE, invoiceId: null })
    expect(fexAuthorize).toHaveBeenCalledTimes(1)

    // La reconciliación la registra con el CAE guardado, sin volver a ARCA
    db.invoice.create.mockImplementation(async ({ data }: { data: Fila }) => ({ id: 'inv-2', ...data }))
    const reg = await registrarInvoiceExportacion(1)
    expect(reg).toEqual({ invoiceId: 'inv-2', numeroInterno: 'E-0010-00000001', creada: true })
    expect(db.filas.get('1')!.invoiceId).toBe('inv-2')
    expect(fexAuthorize).toHaveBeenCalledTimes(1)
    // Idempotente
    expect(await registrarInvoiceExportacion(1)).toMatchObject({ invoiceId: 'inv-2', creada: false })
    expect(db.invoice.create).toHaveBeenCalledTimes(2)
  })

  it('una huérfana (AUTORIZADA sin Invoice) bloquea otra emisión aunque sea con otro DES, hasta reconciliarla', async () => {
    db.invoice.create.mockRejectedValue(new Error('deadlock'))
    expect(await emitirFacturaExportacion('q1', pedidoChile(), { userId: 'u1' })).toMatchObject({ huerfana: true })

    // Los ítems siguen pendientes en la cotización: sin el bloqueo se facturarían dos veces
    const p = await prefillFacturaExportacion('q1')
    expect(p.comprobanteSinResolver).toMatchObject({ fexId: 1, estado: 'AUTORIZADA SIN REGISTRAR EN EL ERP' })
    expect(p.bloqueos.join(' ')).toContain('arca-fex-reconciliar')
    const e = await errorDe(emitirFacturaExportacion('q1', pedidoChile({ desNumero: '2133ECSI13' }), { userId: 'u1' }))
    expect(e).toBeInstanceOf(ExportacionBloqueadaError)
    expect(fexAuthorize).toHaveBeenCalledTimes(1)

    // Registrada por la reconciliación deja de bloquear
    db.invoice.create.mockImplementation(async ({ data }: { data: Fila }) => ({ id: 'inv-2', ...data }))
    await registrarInvoiceExportacion(1)
    expect((await prefillFacturaExportacion('q1')).comprobanteSinResolver).toBeNull()
  })

  it('valida TODO antes de consultar ARCA: FOB distinto de la mercadería, Incoterm FCA con flete', async () => {
    const e = await errorDe(
      emitirFacturaExportacion('q1', pedidoChile({ fobUSD: 2000, incoterm: 'FCA' }), { userId: 'u1' })
    )
    expect(e).toBeInstanceOf(ExportacionValidacionError)
    const errores = (e as ExportacionValidacionError).errores
    expect(errores.some((m) => m.includes('no coincide con la mercadería facturada'))).toBe(true)
    expect(errores.some((m) => m.includes('Con FCA el flete lo paga el cliente'))).toBe(true)
    expect(fexGetCotizacion).not.toHaveBeenCalled()
    expect(fexGetLastCmp).not.toHaveBeenCalled()
    expect(db.facturaExportacion.create).not.toHaveBeenCalled()
  })

  it('la cantidad no puede superar lo pendiente de la cotización', async () => {
    const e = await errorDe(
      emitirFacturaExportacion('q1', pedidoChile({ items: [{ quoteItemId: 'qi1', cantidad: 4 }], fobUSD: 2771.84 }), { userId: 'u1' })
    )
    expect(e).toBeInstanceOf(ExportacionValidacionError)
    expect((e as ExportacionValidacionError).errores.join(' ')).toContain('supera la pendiente de facturar (3)')
  })

  it('un DES ya usado en otra Factura E autorizada no se puede volver a usar', async () => {
    db.filas.set('1', { id: 'fx-1', fexId: BigInt(1), cbteTipo: 19, puntoVenta: 10, cbteNumero: 1, estado: 'AUTORIZADA', desNumero: '2133ECSI12', fobUSD: 2078.88 })
    const e = await errorDe(emitirFacturaExportacion('q1', pedidoChile({ desNumero: '2133 ecsi12' }), { userId: 'u1' }))
    expect(e).toBeInstanceOf(ExportacionValidacionError)
    expect((e as ExportacionValidacionError).errores.join(' ')).toContain('El DES 2133ECSI12 ya se usó en E-0010-00000001')
    expect(fexAuthorize).not.toHaveBeenCalled()
  })

  it('si la cotización de ARCA cambió desde que se abrió el diálogo, no emite (409)', async () => {
    const e = await errorDe(emitirFacturaExportacion('q1', pedidoChile({ cotizacionEsperada: 1440 }), { userId: 'u1' }))
    expect(e).toBeInstanceOf(FacturaExportacionError)
    expect((e as FacturaExportacionError).status).toBe(409)
    expect(db.facturaExportacion.create).not.toHaveBeenCalled()
    expect(fexAuthorize).not.toHaveBeenCalled()
  })

  it('con un comprobante PENDIENTE o INCIERTO en el PV no se emite otro', async () => {
    db.filas.set('7', { id: 'fx-7', fexId: BigInt(7), cbteTipo: 19, puntoVenta: 10, cbteNumero: 1, estado: 'INCIERTA' })
    const e = await errorDe(emitirFacturaExportacion('q1', pedidoChile(), { userId: 'u1' }))
    expect(e).toBeInstanceOf(ExportacionBloqueadaError)
    expect(fexAuthorize).not.toHaveBeenCalled()
  })

  it('en prod controla la numeración: ARCA tiene un número que el ERP no conoce → bloquea', async () => {
    process.env.ARCA_ENV = 'prod'
    vi.mocked(fexGetLastCmp).mockResolvedValue(2)
    const e = await errorDe(emitirFacturaExportacion('q1', pedidoChile(), { userId: 'u1' }))
    expect(e).toBeInstanceOf(ExportacionBloqueadaError)
    expect(fexAuthorize).not.toHaveBeenCalled()
  })

  it('cliente argentino → 422 (va por Factura A/B); cotización en ARS → 400', async () => {
    db.quote.findUnique.mockResolvedValue(
      quoteChile({ customer: { ...quoteChile().customer, taxCondition: 'RESPONSABLE_INSCRIPTO', country: 'Argentina' } })
    )
    const e = await errorDe(emitirFacturaExportacion('q1', pedidoChile(), { userId: 'u1' }))
    expect(e).toBeInstanceOf(FacturaExportacionError)
    expect((e as FacturaExportacionError).status).toBe(422)

    db.quote.findUnique.mockResolvedValue(quoteChile({ currency: 'ARS' }))
    const e2 = await errorDe(emitirFacturaExportacion('q1', pedidoChile(), { userId: 'u1' }))
    expect((e2 as FacturaExportacionError).status).toBe(400)
  })

  it('sin ARCA_PUNTO_VENTA_EXPO la Factura E queda deshabilitada (503) y el prellenado lo avisa', async () => {
    delete process.env.ARCA_PUNTO_VENTA_EXPO
    const e = await errorDe(emitirFacturaExportacion('q1', pedidoChile(), { userId: 'u1' }))
    expect(e).toBeInstanceOf(FacturaExportacionError)
    expect((e as FacturaExportacionError).status).toBe(503)
    const p = await prefillFacturaExportacion('q1')
    expect(p.configurado).toBe(false)
    expect(p.bloqueos.join(' ')).toContain('Factura E no configurada')
    expect(fexGetCotizacion).not.toHaveBeenCalled()
  })

  it('prellenado: ítems pendientes, receptor, cotización de ARCA con su fecha y defaults', async () => {
    const p = await prefillFacturaExportacion('q1')
    expect(p).toMatchObject({
      configurado: true,
      ambiente: 'homo',
      puntoVenta: 10,
      bloqueos: [],
      faltantesCliente: [],
      cliente: { nombre: 'CLAUGER CHILE SPA', iso: 'CL', dstCmp: 208, cuitPais: '55000000034', etiquetaIdFiscal: 'RUT' },
      cotizacion: { cotizacion: 1450.5, fechaCotizacion: '20261002' },
      defaults: { incoterm: 'CPT', incotermLugar: 'Santiago', formaPago: 'Transferencia anticipada 100%', cancelaEnMonedaExtranjera: true },
    })
    expect(p.items).toEqual([
      expect.objectContaining({ quoteItemId: 'qi1', codigo: '2228 12', cantidadPendiente: 3, precioUnitario: 692.96, subtotal: 2078.88 }),
    ])
    expect(p.incoterms.map((i) => i.codigo)).toEqual(['FCA', 'FOB', 'CPT', 'CIP', 'DAP'])
    expect(p.incoterms.find((i) => i.codigo === 'FCA')?.sinFlete).toBe(true)
  })

  it('prellenado: cliente sin domicilio ni RUT queda bloqueado con la lista de faltantes', async () => {
    db.quote.findUnique.mockResolvedValue(
      quoteChile({ customer: { ...quoteChile().customer, address: null, country: 'Perú', taxIdExterior: null } })
    )
    const p = await prefillFacturaExportacion('q1')
    expect(p.faltantesCliente.length).toBeGreaterThan(0)
    expect(p.bloqueos.some((b) => b.startsWith('Faltan datos del cliente'))).toBe(true)
  })
})
