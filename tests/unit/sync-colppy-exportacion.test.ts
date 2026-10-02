import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Sync de Colppy con la Factura E (exportación) cargada a mano en Colppy:
 * se vincula con la E que emitió el ERP (PV 10 + número, o colppyId pegado),
 * nunca crea una Invoice duplicada ni un cliente "fantasma" con el CUIT país
 * genérico (55000000034, que comparten todos los clientes de Chile).
 * Colppy y Prisma son falsos: sin red ni base.
 *
 * Datos de PRUEBA (RUT, TC, importes; el flete real todavía no se conoce).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- filas falsas de Prisma, sin tipar a propósito
type Fila = Record<string, any>

const db = vi.hoisted(() => ({
  customer: { findMany: vi.fn(), update: vi.fn(), upsert: vi.fn() },
  user: { findFirst: vi.fn() },
  quote: { findMany: vi.fn() },
  invoice: { deleteMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
  cotizacionFactura: { updateMany: vi.fn() },
  exchangeRate: { findFirst: vi.fn() },
  $transaction: vi.fn(),
}))
const colppy = vi.hoisted(() => ({ facturas: [] as Record<string, unknown>[], clientes: [] as Record<string, unknown>[] }))

vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/colppy', () => ({
  colppyLogin: vi.fn(async () => ({ claveSesion: 'sesion-de-prueba' })),
  getColppyConfig: () => ({ user: 'usuario', password: 'clave', idEmpresa: '1' }),
  md5Hash: () => 'md5',
  callColppyAPI: vi.fn(async () => ({ result: { estado: 0 }, response: { success: true, data: colppy.facturas } })),
  fetchAllColppyPages: vi.fn(async () => colppy.clientes),
  ColppyRateLimitError: class ColppyRateLimitError extends Error {},
  colppyLeerFacturaVenta: vi.fn(),
  getCachedColppySession: vi.fn(),
}))
vi.mock('@/lib/facturacion/vincular-envio-colppy', () => ({ vincularEnvioColppy: vi.fn(async () => ({ vinculado: false })) }))

import { arcaCbteTipo, resolverSyncArca, syncColppyFacturas } from '@/lib/facturacion/sync-colppy'
import { MARCA_COLPPY_MANUAL, notaCargadaEnColppy } from '@/lib/facturacion/colppy-manual'
import { esCuitPaisArca } from '@/lib/arca/fex-params'

const DESDE = new Date('2026-10-01T12:00:00Z')
const HASTA = new Date('2026-10-31T12:00:00Z')

/** Factura E 0010-00000001 del ERP, recién emitida (carga manual pendiente) */
function facturaEErp(over: Fila = {}): Fila {
  return {
    id: 'inv-e1',
    invoiceNumber: 'E-0010-00000001',
    emitidaPor: 'ARCA',
    cbteTipo: 19,
    pointOfSale: 10,
    cbteNumero: 1,
    colppyId: null,
    colppySyncStatus: 'MANUAL',
    colppySyncError: null,
    status: 'AUTHORIZED',
    currency: 'USD',
    quoteId: 'q1',
    customerId: 'c-cl',
    notes: `Factura E E-0010-00000001 (exportación) emitida por el ERP (ARCA WSFEX). CAE 76543210987654. ${MARCA_COLPPY_MANUAL}`,
    ...over,
  }
}

/** La misma E cargada a mano por Caro en Colppy (FAV letra E, USD 2.198,88 a TC 1450,5) */
function facturaEColppy(over: Fila = {}): Fila {
  return {
    idFactura: '5551',
    idEstadoFactura: '3',
    idTipoComprobante: '4',
    idTipoFactura: '3', // E
    idCliente: '777',
    nroFactura: '0010-00000001',
    totalFactura: '3189475.44',
    totalaplicado: '0',
    netoGravado: '0',
    totalIVA: '0',
    rate: '1450.5',
    fechaFactura: '2026-10-05',
    fechaPago: '2026-10-05',
    ...over,
  }
}

/** Cliente del exterior dado de alta en Colppy con el CUIT país de Chile */
const CLIENTE_COLPPY_CHILE = { idCliente: '777', CUIT: '55000000034', RazonSocial: 'CLAUGER CHILE SPA', NombreFantasia: 'CLAUGER CHILE SPA', idCondicionIva: '1' }

let facturasErp: Fila[] = []

beforeEach(() => {
  vi.clearAllMocks()
  facturasErp = [facturaEErp()]
  colppy.facturas = [facturaEColppy()]
  colppy.clientes = [CLIENTE_COLPPY_CHILE]

  db.customer.findMany.mockResolvedValue([{ id: 'c-cl', colppyId: null, cuit: 'CL-761234567', name: 'CLAUGER CHILE SPA' }])
  db.user.findFirst.mockResolvedValue({ id: 'u-sistema' })
  db.quote.findMany.mockResolvedValue([])
  db.invoice.deleteMany.mockResolvedValue({ count: 0 })
  // Busca por igualdad exacta de todos los campos del where (colppyId o PV + tipo + número)
  db.invoice.findFirst.mockImplementation(async ({ where }: { where: Fila }) =>
    facturasErp.find((f) => Object.entries(where).every(([k, v]) => f[k] === v)) ?? null
  )
  db.invoice.update.mockResolvedValue({})
  db.invoice.create.mockImplementation(async ({ data }: { data: Fila }) => ({ id: 'inv-nueva', ...data }))
  db.cotizacionFactura.updateMany.mockResolvedValue({ count: 1 })
  db.customer.upsert.mockResolvedValue({ id: 'c-nuevo' })
  db.exchangeRate.findFirst.mockResolvedValue({ rate: 1450 })
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db))
})

describe('arcaCbteTipo: letra E', () => {
  it('E → 19 Factura E, 21 NC E, 20 ND E (antes caía en 1 y duplicaba la factura)', () => {
    expect(arcaCbteTipo('SALE', 'E', '4')).toBe(19)
    expect(arcaCbteTipo('CREDIT_NOTE', 'E', '5')).toBe(21)
    expect(arcaCbteTipo('DEBIT_NOTE', 'E', '8')).toBe(20)
  })

  it('A/B y FCE no cambian', () => {
    expect(arcaCbteTipo('SALE', 'A', '4')).toBe(1)
    expect(arcaCbteTipo('SALE', 'B', '10')).toBe(6)
    expect(arcaCbteTipo('CREDIT_NOTE', 'A', '5')).toBe(3)
    expect(arcaCbteTipo('SALE', 'A', '51')).toBe(201)
  })
})

describe('helpers de la carga manual', () => {
  it('CUIT país genérico de ARCA vs CUIT argentino', () => {
    expect(esCuitPaisArca('55000000034')).toBe(true)
    expect(esCuitPaisArca('50000000016')).toBe(true)
    expect(esCuitPaisArca('51600000032')).toBe(true)
    expect(esCuitPaisArca('55-00000003-4')).toBe(true)
    expect(esCuitPaisArca('30715373579')).toBe(false)
    expect(esCuitPaisArca('20340026463')).toBe(false)
    expect(esCuitPaisArca('CL-761234567')).toBe(false)
    expect(esCuitPaisArca(null)).toBe(false)
  })

  it('la nota deja de decir PENDIENTE al vincular el id de Colppy', () => {
    expect(notaCargadaEnColppy(`Factura E E-0010-00000001. ${MARCA_COLPPY_MANUAL}`, '5551')).toBe(
      'Factura E E-0010-00000001. Cargada a mano en Colppy (5551).'
    )
    expect(notaCargadaEnColppy(null, '5551')).toBe('Cargada a mano en Colppy (5551).')
  })
})

describe('resolverSyncArca: Factura E (19)', () => {
  const e = { status: 'AUTHORIZED' as const, cbteTipo: 19, pointOfSale: 10, cbteNumero: 1, colppySyncStatus: 'MANUAL' }

  it('cargada con letra E y el mismo número → OK, actualiza saldo', () => {
    const r = resolverSyncArca(e, { statusColppy: 'PENDING', tipoComp: '4', nroFactura: '0010-00000001', letra: 'E' })
    expect(r).toEqual({ status: 'AUTHORIZED', actualizarSaldo: true, colppySyncStatus: 'OK', colppySyncError: null })
  })

  it('cobrada en Colppy → PAID', () => {
    expect(resolverSyncArca(e, { statusColppy: 'PAID', tipoComp: '4', nroFactura: '0010-00000001', letra: 'E' }).status).toBe('PAID')
  })

  it('otro número (id mal pegado o mal cargada) → ERROR y no toca estado ni saldo', () => {
    const r = resolverSyncArca(e, { statusColppy: 'PAID', tipoComp: '4', nroFactura: '0010-00000002', letra: 'E' })
    expect(r.colppySyncStatus).toBe('ERROR')
    expect(r.actualizarSaldo).toBe(false)
    expect(r.status).toBe('AUTHORIZED')
    expect(r.colppySyncError).toMatch(/0010-00000002 \(tiene que ser 0010-00000001\)/)
  })

  it('cargada con otra letra → ERROR', () => {
    const r = resolverSyncArca(e, { statusColppy: 'PENDING', tipoComp: '10', nroFactura: '0010-00000001', letra: 'B' })
    expect(r.colppySyncStatus).toBe('ERROR')
    expect(r.colppySyncError).toMatch(/letra B \(tiene que ser E\)/)
  })

  it('anulada (CANCELLED) no se toca', () => {
    const r = resolverSyncArca({ ...e, status: 'CANCELLED' }, { statusColppy: 'PAID', tipoComp: '4', nroFactura: '0010-00000001', letra: 'E' })
    expect(r.status).toBe('CANCELLED')
    expect(r.actualizarSaldo).toBe(false)
  })
})

describe('syncColppyFacturas con una Factura E cargada a mano en Colppy', () => {
  it('sin el id pegado: la vincula por PV 10 + número, sin duplicar ni crear cliente fantasma', async () => {
    const r = await syncColppyFacturas(DESDE, HASTA)

    // Nunca se crea cliente por el CUIT país ni Invoice nueva
    expect(db.customer.upsert).not.toHaveBeenCalled()
    expect(db.customer.update).not.toHaveBeenCalled()
    expect(db.invoice.create).not.toHaveBeenCalled()

    // Busca la E del ERP con el tipo 19
    expect(db.invoice.findFirst).toHaveBeenCalledWith({ where: { emitidaPor: 'ARCA', pointOfSale: 10, cbteTipo: 19, cbteNumero: 1 } })
    // 1) vincula el id de Colppy y la nota deja de decir PENDIENTE
    const [vinculo, estado] = db.invoice.update.mock.calls.map((c) => c[0])
    expect(vinculo.where).toEqual({ id: 'inv-e1' })
    expect(vinculo.data.colppyId).toBe('5551')
    expect(vinculo.data.notes).toContain('Cargada a mano en Colppy (5551).')
    expect(vinculo.data.notes).not.toContain(MARCA_COLPPY_MANUAL)
    expect(db.cotizacionFactura.updateMany).toHaveBeenCalledWith({ where: { invoiceId: 'inv-e1' }, data: { colppyInvoiceId: '5551' } })
    // 2) MANUAL → OK, con el saldo de Colppy (USD)
    expect(estado.where).toEqual({ id: 'inv-e1' })
    expect(estado.data).toEqual({
      status: 'AUTHORIZED',
      paymentStatus: 'UNPAID',
      balance: 2198.88,
      colppySyncStatus: 'OK',
      colppySyncError: null,
    })

    expect(r).toEqual(
      expect.objectContaining({ created: 0, updated: 1, skipped: 0, customersCreated: 0, customersLinkedByCuit: 0, errors: 0 })
    )
    expect(r.porTipoComprobante).toEqual({ 'FAV E': 1 })
  })

  it('con el id ya pegado (PATCH colppy-id): solo actualiza el cobro', async () => {
    facturasErp = [facturaEErp({ colppyId: '5551', colppySyncStatus: 'OK', notes: 'Cargada a mano en Colppy (5551).' })]
    colppy.facturas = [facturaEColppy({ idEstadoFactura: '5', totalaplicado: '3189475.44' })]

    const r = await syncColppyFacturas(DESDE, HASTA)

    expect(db.invoice.create).not.toHaveBeenCalled()
    expect(db.customer.upsert).not.toHaveBeenCalled()
    expect(db.invoice.update).toHaveBeenCalledTimes(1)
    expect(db.invoice.update.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ status: 'PAID', paymentStatus: 'PAID', balance: 0, colppySyncStatus: 'OK' })
    )
    expect(r.updated).toBe(1)
  })

  it('id pegado de otra factura (otro número en Colppy): ERROR y no toca el saldo', async () => {
    facturasErp = [facturaEErp({ colppyId: '5551', colppySyncStatus: 'OK' })]
    colppy.facturas = [facturaEColppy({ nroFactura: '0010-00000002', idEstadoFactura: '5', totalaplicado: '3189475.44' })]

    await syncColppyFacturas(DESDE, HASTA)

    const data = db.invoice.update.mock.calls[0][0].data
    expect(data.colppySyncStatus).toBe('ERROR')
    expect(data.colppySyncError).toMatch(/tiene que ser 0010-00000001/)
    expect(data.status).toBe('AUTHORIZED')
    expect(data).not.toHaveProperty('balance')
    expect(data).not.toHaveProperty('paymentStatus')
  })

  it('E en Colppy que no coincide con ninguna del ERP: no se importa y avisa', async () => {
    colppy.facturas = [facturaEColppy({ nroFactura: '0010-00000002' })]

    const r = await syncColppyFacturas(DESDE, HASTA)

    expect(db.invoice.create).not.toHaveBeenCalled()
    expect(db.customer.upsert).not.toHaveBeenCalled()
    expect(db.invoice.update).not.toHaveBeenCalled()
    expect(r.skipped).toBe(1)
    expect(r.skipReasons).toEqual({ exportacion_sin_factura_erp: 1 })
    expect(r.errors).toBe(1)
    expect(r.errorDetails[0]).toMatch(/0010-00000002 .*no coincide con ninguna Factura E/)
  })

  it('cargada dos veces en Colppy: la segunda no se vincula y avisa', async () => {
    facturasErp = [facturaEErp({ colppyId: '5550', colppySyncStatus: 'OK' })]

    const r = await syncColppyFacturas(DESDE, HASTA)

    expect(db.invoice.update).not.toHaveBeenCalled()
    expect(db.invoice.create).not.toHaveBeenCalled()
    expect(r.skipReasons).toEqual({ exportacion_duplicada_en_colppy: 1 })
    expect(r.errorDetails[0]).toMatch(/cargada dos veces en Colppy/)
  })

  it('cargada con otra letra en el PV 0010 (solo exportación): no se importa ni crea cliente, y avisa', async () => {
    colppy.facturas = [facturaEColppy({ idTipoFactura: '1' })] // B

    const r = await syncColppyFacturas(DESDE, HASTA)

    expect(db.invoice.create).not.toHaveBeenCalled()
    expect(db.invoice.update).not.toHaveBeenCalled()
    expect(db.customer.upsert).not.toHaveBeenCalled()
    expect(r.skipReasons).toEqual({ exportacion_letra_incorrecta: 1 })
    expect(r.errorDetails[0]).toMatch(/letra B en el PV 0010, que es solo de exportación/)
  })

  it('un cliente de Colppy con CUIT país nunca crea ni vincula un cliente por CUIT (otro PV, otra letra)', async () => {
    facturasErp = []
    colppy.facturas = [facturaEColppy({ idTipoFactura: '1', nroFactura: '0007-00000099', rate: '0', totalFactura: '1000', netoGravado: '1000' })]

    const r = await syncColppyFacturas(DESDE, HASTA)

    expect(db.customer.upsert).not.toHaveBeenCalled()
    expect(db.customer.update).not.toHaveBeenCalled()
    expect(db.invoice.create).not.toHaveBeenCalled()
    expect(r.skipReasons).toEqual({ cliente_cuit_pais: 1 })
  })

  it('una factura A de un cliente nuevo se sigue importando como siempre (auto-alta por CUIT)', async () => {
    facturasErp = []
    colppy.clientes = [{ idCliente: '901', CUIT: '30712345678', RazonSocial: 'CLIENTE NUEVO SA', NombreFantasia: 'CLIENTE NUEVO', idCondicionIva: '1' }]
    colppy.facturas = [
      facturaEColppy({
        idFactura: '6001',
        idTipoFactura: '0', // A
        idCliente: '901',
        nroFactura: '0003-00012345',
        totalFactura: '121000',
        netoGravado: '100000',
        totalIVA: '21000',
        rate: '0',
      }),
    ]

    const r = await syncColppyFacturas(DESDE, HASTA)

    expect(db.customer.upsert).toHaveBeenCalledTimes(1)
    expect(db.invoice.create).toHaveBeenCalledTimes(1)
    expect(db.invoice.create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ customerId: 'c-nuevo', invoiceType: 'A', colppyId: '6001', total: 121000 })
    )
    expect(r.created).toBe(1)
    expect(r.customersCreated).toBe(1)
  })
})
