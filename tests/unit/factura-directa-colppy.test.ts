import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'

/**
 * Factura directa → Colppy (después de ARCA): la emisión "ya realizada"
 * (emisionYaRealizada) que no llama a ARCA, la opción fechaFactura de
 * sendQuoteToColppy, la toma idempotente del registro (REGISTRANDO), el
 * reintento desde "Reintentar registro en Colppy" y la guarda de la NC.
 * sendQuoteToColppy es el REAL contra un Colppy falso (fetch falso que solo
 * contesta las operaciones conocidas: nunca sale a la red). Prisma en memoria.
 */

process.env.TZ = 'America/Argentina/Buenos_Aires'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- filas falsas de Prisma, sin tipar a propósito
type Fila = Record<string, any>

const tablas = vi.hoisted(() => ({
  invoices: new Map<string, Fila>(),
  facturas: new Map<string, Fila>(),
  customers: new Map<string, Fila>(),
}))

const db = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type F = Record<string, any>
  const cmp = (v: unknown) => (v instanceof Date ? v.getTime() : Number(v))
  function cumple(row: F, where: F): boolean {
    return Object.entries(where).every(([k, c]) => {
      if (k === 'OR') return (c as F[]).some((w) => cumple(row, w))
      const v = row[k]
      if (c !== null && typeof c === 'object' && !(c instanceof Date)) {
        if ('in' in c && !(c.in as unknown[]).includes(v)) return false
        if ('lt' in c && !(cmp(v) < cmp(c.lt))) return false
        return true
      }
      return v === c
    })
  }
  const guardado = (data: F): F =>
    Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, v !== null && typeof v === 'object' && ['JsonNull', 'DbNull'].includes((v as object).constructor?.name) ? null : v])
    )
  return {
    product: { findMany: vi.fn(async () => []) },
    cotizacionFactura: { updateMany: vi.fn(async () => ({ count: 0 })) },
    customer: { update: vi.fn(async ({ where, data }: F) => Object.assign(tablas.customers.get(where.id)!, data)) },
    facturaDirecta: {
      findUnique: vi.fn(async ({ where }: F) => Array.from(tablas.facturas.values()).find((f) => f.invoiceId === where.invoiceId) ?? null),
    },
    invoice: {
      findUnique: vi.fn(async ({ where }: F) => {
        const i = tablas.invoices.get(where.id)
        if (!i) return null
        return {
          ...i,
          customer: tablas.customers.get(i.customerId),
          facturaDirecta: Array.from(tablas.facturas.values()).find((f) => f.invoiceId === i.id) ?? null,
          relatedInvoices: [],
          items: [],
          cotizacionFactura: null,
          quote: null,
        }
      }),
      update: vi.fn(async ({ where, data }: F) => Object.assign(tablas.invoices.get(where.id)!, guardado(data), { updatedAt: new Date() })),
      updateMany: vi.fn(async ({ where, data }: F) => {
        const is = Array.from(tablas.invoices.values()).filter((i) => cumple(i, where))
        for (const i of is) Object.assign(i, guardado(data), { updatedAt: new Date() })
        return { count: is.length }
      }),
    },
  }
})

vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/arca/config', () => ({
  isArcaConfigured: () => true,
  getArcaConfig: () => ({ cuit: '30715373579', env: 'homo', puntoVenta: 7, fceMontoMinimo: 5_549_862, cbu: null }),
}))
vi.mock('@/lib/colppy-inventory', () => ({ syncStockForSkusFireAndForget: vi.fn() }))
vi.mock('@/lib/sharepoint/facturas-emitidas', () => ({ archivarFacturaEnSharePointBg: vi.fn() }))

import { EmisionExternaError, sendQuoteToColppy, type EmisionExternaDatos } from '@/lib/colppy'
import { syncStockForSkusFireAndForget } from '@/lib/colppy-inventory'
import { reintentarAltaColppy } from '@/lib/facturacion/emision-arca'
import { NotaCreditoError, emitirNotaCredito } from '@/lib/facturacion/nota-credito-arca'
import {
  REGISTRANDO_VENCE_MS,
  emisionYaRealizada,
  registrarFacturaDirectaEnColppy,
  type PedidoFacturaDirectaGuardado,
} from '@/lib/facturacion/factura-directa'

// ---------------------------------------------------------------------------
// Colppy falso
// ---------------------------------------------------------------------------

const colppy = {
  llamadas: [] as Array<{ op: string; params: Fila }>,
  /** Respuesta de alta_facturaventa (null = OK con idfactura 555) */
  altaFalla: null as string | null,
  /** Demora del alta (para probar dos registros a la vez) */
  demoraAlta: 0,
}
const altas = () => colppy.llamadas.filter((l) => l.op === 'FacturaVenta/alta_facturaventa')

beforeAll(() => {
  process.env.COLPPY_USER = 'test'
  process.env.COLPPY_PASSWORD = 'test'
  process.env.COLPPY_ID_EMPRESA = '1'
  process.env.COLPPY_ALMACEN = 'ALM1'
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { body: string }) => {
      if (url !== 'https://login.colppy.com/lib/frontera2/service.php') throw new Error(`Red bloqueada en tests: ${url}`)
      const body = JSON.parse(init.body)
      const op = `${body.service.provision}/${body.service.operacion}`
      colppy.llamadas.push({ op, params: body.parameters })
      let resp: unknown
      if (op === 'Usuario/iniciar_sesion') resp = { response: { data: { claveSesion: 'S1' } } }
      else if (op === 'Cliente/listar_cliente') resp = { response: { data: [{ idCliente: '77', RazonSocial: 'EMPRESA SA', CUIT: body.parameters.filter[0].value }] } }
      else if (op === 'Inventario/listar_itemsinventario') resp = { response: { data: [{ idItem: '901' }] } }
      else if (op === 'FacturaVenta/alta_facturaventa') {
        if (colppy.demoraAlta) await new Promise((r) => setTimeout(r, colppy.demoraAlta))
        resp = colppy.altaFalla ? { response: { success: false, message: colppy.altaFalla } } : { response: { success: true, idfactura: '555' } }
      } else throw new Error(`Colppy: operación inesperada ${op}`)
      return new Response(JSON.stringify(resp), { status: 200 })
    })
  )
})
afterAll(() => vi.unstubAllGlobals())

// ---------------------------------------------------------------------------
// Datos: Factura A 0007-00000012 a EMPRESA SA, emitida por la factura directa
// ---------------------------------------------------------------------------

const ISSUE = new Date(2026, 8, 28, 15, 30) // 28/9/2026 15:30 (fecha del CAE)

function pedido(over: Partial<PedidoFacturaDirectaGuardado> = {}): PedidoFacturaDirectaGuardado {
  return {
    version: 1,
    customerId: 'CUS1',
    cliente: { name: 'EMPRESA SA', cuit: '30-71111111-1', taxCondition: 'RESPONSABLE_INSCRIPTO', fceObligado: false },
    moneda: 'ARS',
    tipoCambio: null,
    condicionPago: 'a 30 Dias',
    preciosConIva: false,
    documentoReceptorB: null,
    observaciones: null,
    confirmaciones: ['EMISION_IRREVERSIBLE'],
    letra: 'A',
    esFce: false,
    receptor: { docTipo: 80, docNro: '30711111111', condicionIvaId: 1 },
    totales: { neto: 1000, iva: 210, total: 1210, totalArs: 1210 },
    fechaFactura: '2026-09-28',
    fechaVto: '2026-10-28',
    ml: null,
    lineas: [
      { productId: 'P1', sku: 'VAL-1', descripcion: 'Válvula esférica 1"', cantidad: 2, precioUnitario: 400, comentario: 'OC 4500 ítem 1' },
      { productId: null, sku: null, descripcion: 'Flete', cantidad: 1, precioUnitario: 200, comentario: null },
    ],
    ...over,
  }
}

function invoiceBase() {
  return {
    id: 'INV1',
    invoiceNumber: 'A-0007-00000012',
    invoiceType: 'A',
    transactionType: 'SALE',
    status: 'AUTHORIZED',
    customerId: 'CUS1',
    currency: 'ARS',
    exchangeRate: null,
    subtotal: 1000,
    taxAmount: 210,
    total: 1210,
    issueDate: ISSUE,
    emitidaPor: 'ARCA',
    pointOfSale: 7,
    cbteTipo: 1,
    cbteNumero: 12,
    cae: '76000000000012',
    caeExpiration: new Date(2026, 9, 8),
    colppyId: null,
    colppySyncStatus: 'PENDIENTE',
    colppySyncError: null,
    colppyPayload: null,
    notes: 'Factura directa. Emitida por el ERP (ARCA) el 28/9/2026. CAE 76000000000012. PENDIENTE de registrar en Colppy.',
    updatedAt: new Date(),
  }
}
type InvoiceFalsa = ReturnType<typeof invoiceBase>
function invoice(over: Fila = {}): InvoiceFalsa {
  return { ...invoiceBase(), ...over } as InvoiceFalsa
}

beforeEach(() => {
  vi.clearAllMocks()
  colppy.llamadas.length = 0
  colppy.altaFalla = null
  colppy.demoraAlta = 0
  tablas.invoices.clear()
  tablas.facturas.clear()
  tablas.customers.clear()
  tablas.customers.set('CUS1', { id: 'CUS1', name: 'EMPRESA SA', cuit: '30-71111111-1', taxCondition: 'RESPONSABLE_INSCRIPTO', colppyId: null })
  tablas.invoices.set('INV1', invoice())
  tablas.facturas.set('FD1', { id: 'FD1', invoiceId: 'INV1', mlPackId: null, pedido: pedido() })
})

// ---------------------------------------------------------------------------
// Emisión "ya realizada"
// ---------------------------------------------------------------------------

const datosA = (over: Partial<EmisionExternaDatos> = {}): EmisionExternaDatos => ({
  tipoFactura: 'A',
  netoGravado: 1000,
  totalIVA: 210,
  totalFactura: 1210,
  currency: 'ARS',
  exchangeRate: null,
  fechaFactura: ISSUE,
  fechaVto: new Date(2026, 9, 28),
  idCondicionPago: 'a 30 Dias',
  descripcion: 'x',
  ...over,
})

describe('emisionYaRealizada (no llama a ARCA)', () => {
  it('importes iguales: devuelve el número y el CAE guardados', async () => {
    const r = await emisionYaRealizada(tablas.invoices.get('INV1') as InvoiceFalsa)(datosA({ totalFactura: 1210.004 }))
    expect(r).toEqual({ puntoVenta: 7, numero: 12, numeroFormateado: '0007-00000012', cbteTipo: 1, cae: '76000000000012', caeVencimiento: new Date(2026, 9, 8) })
  })

  it('letra, moneda o importes distintos: lanza EmisionExternaError', async () => {
    const hook = emisionYaRealizada(tablas.invoices.get('INV1') as InvoiceFalsa)
    for (const d of [datosA({ totalFactura: 1210.01 }), datosA({ netoGravado: 999.99 }), datosA({ totalIVA: 210.01 }), datosA({ tipoFactura: 'B' }), datosA({ currency: 'USD' })]) {
      await expect(hook(d)).rejects.toBeInstanceOf(EmisionExternaError)
    }
  })

  it('si los totales que calcula Colppy difieren, no se llama a alta_facturaventa', async () => {
    const inv = invoice({ total: 1210.5 })
    const r = await sendQuoteToColppy(
      { action: 'factura-cuenta-corriente', condicionPago: 'a 30 Dias', emisionExterna: emisionYaRealizada(inv) },
      {
        id: 'directa-FD1',
        quoteNumber: inv.invoiceNumber,
        currency: 'ARS',
        exchangeRate: null,
        bonification: 0,
        pricesIncludeTax: false,
        customer: { name: 'EMPRESA SA', cuit: '30-71111111-1', taxCondition: 'RESPONSABLE_INSCRIPTO' },
        items: [{ productName: 'Válvula', productSku: '', quantity: 1, unitPrice: 1000 }],
      }
    )
    expect(r).toMatchObject({ success: false, errorStage: 'arca' })
    expect(r.error).toMatch(/no se registró en Colppy/)
    expect(r.emision).toBeUndefined()
    expect(altas()).toHaveLength(0)
  })
})

describe('sendQuoteToColppy: opción fechaFactura', () => {
  it('fija fechaFactura y fechaVto (y la fecha que recibe la emisión externa)', async () => {
    let datos: EmisionExternaDatos | null = null
    const r = await sendQuoteToColppy(
      {
        action: 'factura-cuenta-corriente',
        condicionPago: 'a 30 Dias',
        fechaFactura: ISSUE,
        emisionExterna: async (d) => {
          datos = d
          return emisionYaRealizada(invoice())(d)
        },
      },
      {
        id: 'q',
        quoteNumber: 'A-0007-00000012',
        currency: 'ARS',
        exchangeRate: null,
        bonification: 0,
        pricesIncludeTax: false,
        customer: { name: 'EMPRESA SA', cuit: '30-71111111-1', taxCondition: 'RESPONSABLE_INSCRIPTO' },
        items: [{ productName: 'Válvula', productSku: '', quantity: 1, unitPrice: 1000 }],
      }
    )
    expect(r.success).toBe(true)
    expect(r.colppyInvoicePayload).toMatchObject({ fechaFactura: '28-09-2026', fechaVto: '28-10-2026', estado: 'Aprobada', nroFactura1: '0007', nroFactura2: '00000012' })
    expect(altas()[0].params).toMatchObject({ fechaFactura: '28-09-2026', fechaVto: '28-10-2026', fechaPago: '28-10-2026', idEstadoFactura: 'Aprobada' })
    expect(datos!.fechaFactura).toEqual(ISSUE)
    expect(datos!.fechaVto).toEqual(new Date(2026, 9, 28, 15, 30))
  })

  it('sin la opción: la fecha de hoy (como siempre)', async () => {
    const hoy = new Date()
    const dd = `${String(hoy.getDate()).padStart(2, '0')}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${hoy.getFullYear()}`
    const r = await sendQuoteToColppy(
      { action: 'factura-contado', condicionPago: 'Contado', emisionExterna: async (d) => emisionYaRealizada(invoice())(d) },
      {
        id: 'q',
        quoteNumber: 'Q',
        currency: 'ARS',
        exchangeRate: null,
        bonification: 0,
        pricesIncludeTax: false,
        customer: { name: 'EMPRESA SA', cuit: '30-71111111-1', taxCondition: 'RESPONSABLE_INSCRIPTO' },
        items: [{ productName: 'Válvula', productSku: '', quantity: 1, unitPrice: 1000 }],
      }
    )
    expect(r.colppyInvoicePayload?.fechaFactura).toBe(dd)
  })
})

// ---------------------------------------------------------------------------
// Registro en Colppy
// ---------------------------------------------------------------------------

describe('registrarFacturaDirectaEnColppy', () => {
  it('arma el alta desde la factura emitida (Aprobada con su número real y CAE), guarda payload, id y nota', async () => {
    const r = await registrarFacturaDirectaEnColppy('INV1')
    expect(r).toEqual({ ok: true, estado: 'OK', colppyId: '555' })
    const [alta] = altas()
    expect(alta.params).toMatchObject({
      idCliente: '77',
      idEstadoFactura: 'Aprobada',
      idTipoFactura: 'A',
      nroFactura1: '0007',
      nroFactura2: '00000012',
      fechaFactura: '28-09-2026',
      fechaVto: '28-10-2026',
      idCondicionPago: 'a 30 Dias',
      descripcion: 'Factura directa A-0007-00000012 - CAE 76000000000012',
    })
    expect(alta.params.itemsFactura).toHaveLength(2)
    const inv = tablas.invoices.get('INV1')!
    expect(inv).toMatchObject({ colppyId: '555', colppySyncStatus: 'OK', colppySyncError: null })
    expect(inv.notes).toBe('Factura directa. Emitida por el ERP (ARCA) el 28/9/2026. CAE 76000000000012. Registrada en Colppy (555).')
    expect(inv.colppyPayload).toMatchObject({ idCliente: '77', estado: 'Aprobada', netoGravado: 1000, totalIVA: 210, totalFactura: 1210 })
    expect(inv.colppyPayload.items.map((i: Fila) => [i.Descripcion, i.Comentario, i.codigo])).toEqual([
      ['Válvula esférica 1"', 'OC 4500 ítem 1', 'VAL-1'],
      ['Flete', 'Factura directa A-0007-00000012', ''],
    ])
    expect(tablas.customers.get('CUS1')!.colppyId).toBe('77')
    expect(syncStockForSkusFireAndForget).toHaveBeenCalledWith(['VAL-1'], { quoteNumber: 'A-0007-00000012', action: 'factura-directa' })
  })

  it('la toma de REGISTRANDO es idempotente: dos registros a la vez dan un solo alta', async () => {
    colppy.demoraAlta = 20
    const [a, b] = await Promise.all([registrarFacturaDirectaEnColppy('INV1'), registrarFacturaDirectaEnColppy('INV1')])
    expect([a.estado, b.estado].sort()).toEqual(['EN_CURSO', 'OK'])
    expect(altas()).toHaveLength(1)
    // Ya registrada: no vuelve a ir a Colppy
    expect(await registrarFacturaDirectaEnColppy('INV1')).toEqual({ ok: true, estado: 'OK', colppyId: '555' })
    expect(altas()).toHaveLength(1)
  })

  it('un REGISTRANDO de más de 15 minutos se vuelve a tomar; NO_APLICA nunca', async () => {
    tablas.invoices.set('INV1', invoice({ colppySyncStatus: 'REGISTRANDO', updatedAt: new Date(Date.now() - 60_000) }))
    expect((await registrarFacturaDirectaEnColppy('INV1')).estado).toBe('EN_CURSO')
    tablas.invoices.set('INV1', invoice({ colppySyncStatus: 'REGISTRANDO', updatedAt: new Date(Date.now() - REGISTRANDO_VENCE_MS - 1000) }))
    expect((await registrarFacturaDirectaEnColppy('INV1')).estado).toBe('OK')

    tablas.invoices.set('INV1', invoice({ colppySyncStatus: 'NO_APLICA' }))
    colppy.llamadas.length = 0
    expect(await registrarFacturaDirectaEnColppy('INV1')).toMatchObject({ ok: false, estado: 'NO_APLICA' })
    expect(altas()).toHaveLength(0)
  })

  it('si Colppy falla queda ERROR con el payload guardado y el reintento lo reenvía tal cual', async () => {
    colppy.altaFalla = 'Servicio no disponible'
    const r1 = await registrarFacturaDirectaEnColppy('INV1')
    expect(r1).toMatchObject({ ok: false, estado: 'ERROR' })
    expect(r1.error).toMatch(/Servicio no disponible/)
    const inv = tablas.invoices.get('INV1')!
    expect(inv).toMatchObject({ colppySyncStatus: 'ERROR', colppyId: null })
    expect(inv.colppyPayload).toMatchObject({ idCliente: '77', nroFactura2: '00000012' })
    expect(inv.notes).toMatch(/PENDIENTE de registrar en Colppy\./)

    colppy.altaFalla = null
    colppy.llamadas.length = 0
    // "Reintentar registro en Colppy" (reenviar-colppy): con payload, se reenvía sin rearmar
    const r2 = await reintentarAltaColppy('INV1')
    expect(r2).toMatchObject({ ok: true, colppyId: '555' })
    expect(colppy.llamadas.map((l) => l.op)).not.toContain('Cliente/listar_cliente')
    expect(altas()).toHaveLength(1)
    expect(tablas.invoices.get('INV1')!.notes).toMatch(/Registrada en Colppy \(555\)\.$/)
  })

  it('dos "Reintentar registro en Colppy" a la vez de una factura directa CON payload guardado: un solo alta (toma REGISTRANDO)', async () => {
    colppy.altaFalla = 'Servicio no disponible'
    expect((await registrarFacturaDirectaEnColppy('INV1')).estado).toBe('ERROR')
    expect(tablas.invoices.get('INV1')!.colppyPayload).toMatchObject({ idCliente: '77' })

    colppy.altaFalla = null
    colppy.demoraAlta = 20
    colppy.llamadas.length = 0
    const [a, b] = await Promise.all([reintentarAltaColppy('INV1'), reintentarAltaColppy('INV1')])
    expect(altas()).toHaveLength(1)
    expect([a.ok, b.ok].sort()).toEqual([false, true])
    expect([a, b].find((r) => !r.ok)!.error).toMatch(/registrando en Colppy en este momento/)
    expect(tablas.invoices.get('INV1')).toMatchObject({ colppyId: '555', colppySyncStatus: 'OK', colppySyncError: null })
    // Con payload no se rearma (no se vuelve a buscar el cliente en Colppy)
    expect(colppy.llamadas.map((l) => l.op)).not.toContain('Cliente/listar_cliente')
  })

  it('"Reintentar registro en Colppy" de una factura directa sin payload: se delega al registro de la factura directa', async () => {
    const r = await reintentarAltaColppy('INV1')
    expect(r).toEqual({ ok: true, colppyId: '555', borradorFce: false })
    expect(altas()).toHaveLength(1)
    expect(tablas.invoices.get('INV1')!.colppySyncStatus).toBe('OK')
  })

  it('una factura sin payload que NO es directa sigue igual que antes', async () => {
    tablas.facturas.clear()
    expect(await reintentarAltaColppy('INV1')).toEqual({ ok: false, error: 'La factura no tiene payload de Colppy guardado' })
    expect(colppy.llamadas).toHaveLength(0)
  })
})

describe('nota de crédito sobre una factura directa sin registrar en Colppy', () => {
  it('409 "Registrá primero la factura en Colppy" (PENDIENTE / ERROR / REGISTRANDO sin payload)', async () => {
    for (const estado of ['PENDIENTE', 'ERROR', 'REGISTRANDO']) {
      tablas.invoices.set('INV1', invoice({ colppySyncStatus: estado }))
      const e = await emitirNotaCredito('INV1', { userId: 'U1', modo: 'TOTAL' }).catch((x) => x)
      expect(e).toBeInstanceOf(NotaCreditoError)
      expect(e).toMatchObject({ status: 409 })
      expect(e.message).toMatch(/^Registrá primero la factura en Colppy/)
    }
  })
})
