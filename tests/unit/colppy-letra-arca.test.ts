import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'

/**
 * Letra de la factura en Colppy vs ARCA (RG 5003: Monotributo → A) y receptor
 * de la Factura B (CUIL 86 / DNI 96) en el hook de emisión. Colppy con un
 * fetch falso (nunca sale a la red), ARCA (emitirComprobante y padrón) mockeados.
 */

const arca = vi.hoisted(() => ({
  emitirComprobante: vi.fn(),
  consultarPersona: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: { product: { findMany: vi.fn(async () => []) } } }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/arca/config', () => ({
  isArcaConfigured: () => true,
  getArcaConfig: () => ({ cuit: '30711111118', env: 'homo', fceMontoMinimo: 1e12, cbu: null }),
}))
vi.mock('@/lib/arca/padron', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/arca/padron')>()),
  consultarPersona: arca.consultarPersona,
}))
vi.mock('@/lib/arca/emitir', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/arca/emitir')>()),
  emitirComprobante: arca.emitirComprobante,
}))

import { readFileSync } from 'fs'
import path from 'path'
import { letraFacturaColppy, sendQuoteToColppy, EmisionExternaError, type EmisionExternaDatos } from '@/lib/colppy'
import { letraFacturaColppy as letraFacturaPura } from '@/lib/facturacion/letra-factura'
import { totalesFacturaA, totalesFacturaADesdeFinal, totalesFacturaB } from '@/lib/facturacion/totales-factura'
import { EmisionInciertaError, EmisionNoSolicitadaError, buildDetalle, receptorDesdeCondicion } from '@/lib/arca/emitir'
import { PadronError } from '@/lib/arca/padron'
import { avisoEmisionIncierta, crearHookEmisionArca, emisionDescartada, type HookEmisionArca } from '@/lib/facturacion/emision-arca'
import { logger } from '@/lib/logger'

// ---------------------------------------------------------------------------
// Colppy falso
// ---------------------------------------------------------------------------

const colppy = {
  /** valor del filtro CUIT → clientes que devuelve listar_cliente */
  clientes: new Map<string, Array<Record<string, string>>>(),
  llamadas: [] as Array<{ op: string; params: Record<string, unknown> }>,
}

beforeAll(() => {
  process.env.COLPPY_USER = 'test'
  process.env.COLPPY_PASSWORD = 'test'
  process.env.COLPPY_ID_EMPRESA = '1'
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body)
      const op = `${body.service.provision}/${body.service.operacion}`
      colppy.llamadas.push({ op, params: body.parameters })
      let resp: unknown
      if (op === 'Usuario/iniciar_sesion') resp = { response: { data: { claveSesion: 'S1' } } }
      else if (op === 'Cliente/listar_cliente') resp = { response: { data: colppy.clientes.get(body.parameters.filter[0].value) ?? [] } }
      else if (op === 'Cliente/alta_cliente') {
        // Como Colppy: el cliente nuevo aparece en las búsquedas siguientes
        const cuit = String(body.parameters.info_general.CUIT)
        const id = String(900 + colppy.llamadas.filter((l) => l.op === 'Cliente/alta_cliente').length - 1)
        const fila = { idCliente: id, RazonSocial: body.parameters.info_general.RazonSocial, CUIT: cuit }
        colppy.clientes.set(cuit, [...(colppy.clientes.get(cuit) ?? []), fila])
        resp = { response: { success: true, data: { idCliente: id } } }
      }
      else if (op === 'FacturaVenta/alta_facturaventa') resp = { response: { success: true, idfactura: '555' } }
      else throw new Error(`Colppy: operación inesperada ${op}`)
      return new Response(JSON.stringify(resp), { status: 200 })
    })
  )
})
afterAll(() => vi.unstubAllGlobals())

beforeEach(() => {
  colppy.clientes.clear()
  colppy.llamadas.length = 0
  arca.emitirComprobante.mockReset()
  arca.consultarPersona.mockReset()
  arca.consultarPersona.mockRejectedValue(new PadronError('No existe persona con ese Id', 404))
})

const CUIT = '20-12345678-6'

type ItemFactura = { productName: string; productSku: string; quantity: number; unitPrice: number }

/** Factura por sendQuoteToColppy con un emisor externo falso; devuelve lo que vio ARCA y Colppy */
async function facturar(
  taxCondition: string,
  unitPrice: number,
  pricesIncludeTax?: boolean,
  cuit = CUIT,
  extra: { items?: ItemFactura[]; bonification?: number } = {}
) {
  if (!colppy.clientes.size) colppy.clientes.set(cuit, [{ idCliente: '77', RazonSocial: 'CLIENTE', CUIT: cuit }])
  let datos: EmisionExternaDatos | null = null
  const r = await sendQuoteToColppy(
    {
      action: 'factura-contado',
      condicionPago: 'Contado',
      emisionExterna: async (d) => {
        datos = d
        return { puntoVenta: 7, numero: 1, numeroFormateado: '0007-00000001', cbteTipo: d.tipoFactura === 'A' ? 1 : 6, cae: '76000000000001', caeVencimiento: new Date() }
      },
    },
    {
      id: 'q1',
      quoteNumber: 'Q1',
      currency: 'ARS',
      exchangeRate: null,
      bonification: extra.bonification ?? 0,
      ...(pricesIncludeTax === undefined ? {} : { pricesIncludeTax }),
      customer: { name: 'CLIENTE', cuit, taxCondition, city: 'Rosario', province: 'Santa Fe' },
      items: extra.items ?? [{ productName: 'Válvula esférica', productSku: '', quantity: 2, unitPrice }],
    }
  )
  return { r, datos: datos as EmisionExternaDatos | null, payload: r.colppyInvoicePayload }
}

const item = (unitPrice: number, quantity = 1): ItemFactura => ({ productName: 'Válvula', productSku: '', quantity, unitPrice })

describe('letra de la factura (Colppy) = letra de ARCA', () => {
  it('RI y Monotributo → A; el resto → B', () => {
    expect(letraFacturaColppy('RESPONSABLE_INSCRIPTO')).toBe('A')
    expect(letraFacturaColppy('MONOTRIBUTO')).toBe('A')
    for (const c of ['CONSUMIDOR_FINAL', 'EXENTO', 'NO_RESPONSABLE', 'RESPONSABLE_NO_INSCRIPTO', '', null, undefined]) {
      expect(letraFacturaColppy(c)).toBe('B')
    }
  })

  it('coincide con receptorDesdeCondicion para todas las condiciones del ERP', () => {
    for (const c of ['RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO', 'CONSUMIDOR_FINAL', 'NO_RESPONSABLE', 'RESPONSABLE_NO_INSCRIPTO']) {
      expect(letraFacturaColppy(c)).toBe(receptorDesdeCondicion(c, CUIT).letra)
    }
  })

  it('una sola regla: colppy.ts re-exporta la del módulo puro que usa SendToColppyDialog', () => {
    expect(letraFacturaColppy).toBe(letraFacturaPura)
    // Módulo apto para el navegador: sin imports (nada de Prisma / ARCA)
    const fuente = readFileSync(path.resolve(process.cwd(), 'src/lib/facturacion/letra-factura.ts'), 'utf8')
    expect(fuente).not.toMatch(/^\s*import\s/m)
    const dialogo = readFileSync(path.resolve(process.cwd(), 'src/components/quotes/SendToColppyDialog.tsx'), 'utf8')
    expect(dialogo).toMatch(/import \{ letraFacturaColppy \} from '@\/lib\/facturacion\/letra-factura'/)
    expect(dialogo).toMatch(/const invoiceType = letraFacturaColppy\(quote\.customer\.taxCondition\)/)
    expect(dialogo).not.toMatch(/=== 'RESPONSABLE_INSCRIPTO' \? 'A' : 'B'/)
    // El monotributista se muestra como Factura A, igual que se emite
    expect(letraFacturaPura('MONOTRIBUTO')).toBe('A')
  })
})

describe('totalesFacturaB: total primero (= precio final cobrado)', () => {
  it('$100 → neto 82,64 + IVA 17,36 = 100,00', () => {
    expect(totalesFacturaB([{ cantidad: 1, precioFinal: 100 }])).toEqual({ total: 100, neto: 82.64, iva: 17.36 })
  })

  it('varias líneas y cantidades: total = suma de precio × cantidad; neto + IVA = total siempre', () => {
    expect(totalesFacturaB([{ cantidad: 1, precioFinal: 100 }, { cantidad: 3, precioFinal: 50.5 }])).toEqual({ total: 251.5, neto: 207.85, iva: 43.65 })
    expect(totalesFacturaB([{ cantidad: 2, precioFinal: 12100 }])).toEqual({ total: 24200, neto: 20000, iva: 4200 })
    expect(totalesFacturaB([{ cantidad: 1.5, precioFinal: 100.1 }])).toEqual({ total: 150.15, neto: 124.09, iva: 26.06 })
    for (let p = 1; p < 400; p += 0.37) {
      const t = totalesFacturaB([{ cantidad: 3, precioFinal: p }])
      expect(Math.round((t.neto + t.iva) * 100) / 100).toBe(t.total)
    }
  })

  it('bonificación de cabecera sobre el total final', () => {
    expect(totalesFacturaB([{ cantidad: 2, precioFinal: 1210 }], 10)).toEqual({ total: 2178, neto: 1800, iva: 378 })
    expect(totalesFacturaB([{ cantidad: 1, precioFinal: 100 }], 3)).toEqual({ total: 97, neto: 80.17, iva: 16.83 })
  })

  it('precio unitario a 2 decimales (como el ImporteUnitario de Colppy) y líneas inválidas en 0', () => {
    expect(totalesFacturaB([{ cantidad: 2, precioFinal: 10.004 }])).toEqual(totalesFacturaB([{ cantidad: 2, precioFinal: 10 }]))
    expect(totalesFacturaB([{ cantidad: Number.NaN, precioFinal: 100 }, { cantidad: 1, precioFinal: 100 }])).toEqual({ total: 100, neto: 82.64, iva: 17.36 })
    expect(totalesFacturaB([])).toEqual({ total: 0, neto: 0, iva: 0 })
  })
})

describe('sendQuoteToColppy: importes por letra', () => {
  it('RI sin flag (precios netos): A, sin cambios', async () => {
    const { r, datos, payload } = await facturar('RESPONSABLE_INSCRIPTO', 1000)
    expect(r.success).toBe(true)
    expect(datos).toMatchObject({ tipoFactura: 'A', netoGravado: 2000, totalIVA: 420, totalFactura: 2420 })
    expect(payload).toMatchObject({ tipoFactura: 'A', estado: 'Aprobada' })
    expect(payload!.items[0]).toMatchObject({ ImporteUnitario: 1000, Cantidad: 2, subtotal: 2000 })
  })

  it('RI con precios finales (venta ML): A con el neto', async () => {
    const { datos, payload } = await facturar('RESPONSABLE_INSCRIPTO', 1210, true)
    expect(datos).toMatchObject({ tipoFactura: 'A', netoGravado: 2000, totalFactura: 2420 })
    expect(payload!.items[0].ImporteUnitario).toBe(1000)
  })

  it('Consumidor Final: B con el precio final, sin cambios', async () => {
    const { datos, payload } = await facturar('CONSUMIDOR_FINAL', 1210)
    expect(datos).toMatchObject({ tipoFactura: 'B', netoGravado: 2000, totalIVA: 420, totalFactura: 2420 })
    expect(payload!.items[0]).toMatchObject({ ImporteUnitario: 1210, subtotal: 2420 })
  })

  it('Factura B de $100: Colppy y ARCA reciben 82,64 + 17,36 = 100,00 (antes 99,99)', async () => {
    const { datos, payload } = await facturar('CONSUMIDOR_FINAL', 100, true, CUIT, { items: [item(100)] })
    expect(datos).toMatchObject({ tipoFactura: 'B', netoGravado: 82.64, totalIVA: 17.36, totalFactura: 100 })
    expect(payload).toMatchObject({ tipoFactura: 'B', netoGravado: 82.64, totalIVA: 17.36, totalFactura: 100 })
    // La línea sigue con el precio final
    expect(payload!.items[0]).toMatchObject({ ImporteUnitario: 100, Cantidad: 1, subtotal: 100 })
  })

  it('Factura B con varias líneas, cantidades y bonificación: el total es la suma de los precios finales', async () => {
    const multi = await facturar('CONSUMIDOR_FINAL', 0, true, CUIT, { items: [item(100), item(50.5, 3)] })
    expect(multi.datos).toMatchObject({ netoGravado: 207.85, totalIVA: 43.65, totalFactura: 251.5 })
    expect(multi.payload!.items.map((i) => i.ImporteUnitario)).toEqual([100, 50.5])

    const bonif = await facturar('CONSUMIDOR_FINAL', 0, true, CUIT, { items: [item(1210, 2)], bonification: 10 })
    expect(bonif.datos).toMatchObject({ netoGravado: 1800, totalIVA: 378, totalFactura: 2178 })
    expect(bonif.payload!.items[0]).toMatchObject({ ImporteUnitario: 1210, porcDesc: 10, subtotal: 2178 })
  })

  it('Factura B: lo que va a ARCA (hook real) cierra: ImpNeto + ImpIVA = ImpTotal = precio final', async () => {
    arca.emitirComprobante.mockImplementation(async (c: { importes: unknown }) => ({ ...emisionOk(6), importes: c.importes }))
    colppy.clientes.set(CUIT, [{ idCliente: '77', RazonSocial: 'CLIENTE', CUIT }])
    const h = crearHookEmisionArca({ name: 'CLIENTE', cuit: CUIT, taxCondition: 'CONSUMIDOR_FINAL', documentoReceptorB: { docTipo: 86, docNro: '20123456786' } })
    const r = await sendQuoteToColppy(
      { action: 'factura-contado', condicionPago: 'Contado', emisionExterna: h.hook },
      { id: 'q', quoteNumber: 'ML 1', currency: 'ARS', exchangeRate: null, bonification: 0, pricesIncludeTax: true, customer: { name: 'CLIENTE', cuit: CUIT, taxCondition: 'CONSUMIDOR_FINAL' }, items: [item(100)] }
    )
    expect(r.success).toBe(true)
    const pedido = arca.emitirComprobante.mock.calls[0][0]
    expect(pedido.importes).toEqual({ netoGravado: 82.64, netoNoGravado: 0, exento: 0, iva: [{ alicuota: '21', baseImponible: 82.64, importe: 17.36 }], total: 100 })
    const det = buildDetalle(pedido, 1)
    expect(det).toMatchObject({ ImpNeto: 82.64, ImpIVA: 17.36, ImpTotal: 100 })
    expect(Math.round((det.ImpNeto + det.ImpIVA) * 100) / 100).toBe(det.ImpTotal)
    // Y la Invoice del ERP sale del mismo payload
    expect(r.colppyInvoicePayload).toMatchObject({ netoGravado: 82.64, totalIVA: 17.36, totalFactura: 100 })
  })

  it('Factura A: sin cambios (neto primero, como antes)', async () => {
    // Fuera del alcance de este cambio: la A con precios finales sigue con su
    // cálculo histórico (en $100 da 82,64 + 17,35 = 99,99)
    const { datos } = await facturar('RESPONSABLE_INSCRIPTO', 0, true, CUIT, { items: [item(100)] })
    expect(datos).toMatchObject({ tipoFactura: 'A', netoGravado: 82.64, totalIVA: 17.35, totalFactura: 99.99 })
  })

  it('Exento: B con el precio final, sin cambios', async () => {
    const { datos } = await facturar('EXENTO', 1210, true)
    expect(datos).toMatchObject({ tipoFactura: 'B', netoGravado: 2000, totalFactura: 2420 })
  })

  it('Monotributo sin flag: ahora A, con los MISMOS totales que tenía como B', async () => {
    const { datos, payload } = await facturar('MONOTRIBUTO', 1210)
    expect(datos).toMatchObject({ tipoFactura: 'A', netoGravado: 2000, totalIVA: 420, totalFactura: 2420 })
    expect(payload).toMatchObject({ tipoFactura: 'A' })
    expect(payload!.items[0].ImporteUnitario).toBe(1000) // neto: la A discrimina el IVA
  })

  it('Monotributo con precios finales (venta ML): A', async () => {
    const { datos } = await facturar('MONOTRIBUTO', 1210, true)
    expect(datos).toMatchObject({ tipoFactura: 'A', netoGravado: 2000, totalFactura: 2420 })
  })

  it('cliente del exterior: sigue rechazado (Factura E)', async () => {
    const { r } = await facturar('CLIENTE_EXTERIOR', 100, false, 'CL-76543210')
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/exterior/i)
  })
})

describe('sendQuoteToColppy: cliente en Colppy por CUIT/CUIL', () => {
  it('encuentra al cliente cargado sin guiones (no crea un duplicado)', async () => {
    colppy.clientes.set('20123456786', [{ idCliente: '41', RazonSocial: 'VIEJO', CUIT: '20123456786' }])
    const { r, payload } = await facturar('CONSUMIDOR_FINAL', 1210)
    expect(r.success).toBe(true)
    expect(payload!.idCliente).toBe('41')
    const listados = colppy.llamadas.filter((l) => l.op === 'Cliente/listar_cliente')
    expect(listados.map((l) => (l.params.filter as Array<{ value: string }>)[0].value)).toEqual([CUIT, '20123456786'])
    expect(colppy.llamadas.some((l) => l.op === 'Cliente/alta_cliente')).toBe(false)
  })

  it('dos facturas a la vez para el mismo comprador nuevo: UNA sola alta en Colppy (mutex por CUIT)', async () => {
    colppy.clientes.set('otro', [])
    const enviar = (n: number) =>
      sendQuoteToColppy(
        { action: 'factura-contado', condicionPago: 'Contado', emisionExterna: async (d) => ({ puntoVenta: 7, numero: n, numeroFormateado: `0007-0000000${n}`, cbteTipo: d.tipoFactura === 'A' ? 1 : 6, cae: '76000000000001', caeVencimiento: new Date() }) },
        { id: `q${n}`, quoteNumber: `ML ${n}`, currency: 'ARS', exchangeRate: null, bonification: 0, pricesIncludeTax: true, customer: { name: 'NUEVO', cuit: CUIT, taxCondition: 'CONSUMIDOR_FINAL' }, items: [item(1210)] }
      )
    const [a, b] = await Promise.all([enviar(1), enviar(2)])
    expect(a.success && b.success).toBe(true)
    expect(colppy.llamadas.filter((l) => l.op === 'Cliente/alta_cliente')).toHaveLength(1)
    // Las dos facturas quedan en el mismo cliente
    expect(a.colppyInvoicePayload!.idCliente).toBe('900')
    expect(b.colppyInvoicePayload!.idCliente).toBe('900')
  })

  it('mutex por CUIT: CUIT distintos no se esperan entre sí (dos altas)', async () => {
    colppy.clientes.set('otro', [])
    const enviar = (cuit: string) =>
      sendQuoteToColppy(
        { action: 'factura-contado', condicionPago: 'Contado', emisionExterna: async (d) => ({ puntoVenta: 7, numero: 1, numeroFormateado: '0007-00000001', cbteTipo: d.tipoFactura === 'A' ? 1 : 6, cae: '76000000000001', caeVencimiento: new Date() }) },
        { id: 'q', quoteNumber: 'ML', currency: 'ARS', exchangeRate: null, bonification: 0, pricesIncludeTax: true, customer: { name: 'NUEVO', cuit, taxCondition: 'CONSUMIDOR_FINAL' }, items: [item(1210)] }
      )
    await Promise.all([enviar(CUIT), enviar('27-12345678-0')])
    expect(colppy.llamadas.filter((l) => l.op === 'Cliente/alta_cliente')).toHaveLength(2)
  })

  it('CUIL sin padrón: lo da de alta con su CUIL, el nombre y domicilio recibidos, condición 3', async () => {
    colppy.clientes.set('otro', [])
    const { r, payload } = await facturar('CONSUMIDOR_FINAL', 1210)
    expect(r.success).toBe(true)
    // El padrón se consulta (con guiones) y su 404 no corta el alta
    expect(arca.consultarPersona).toHaveBeenCalledWith(CUIT)
    const alta = colppy.llamadas.find((l) => l.op === 'Cliente/alta_cliente')!
    expect(alta.params.info_general).toMatchObject({ RazonSocial: 'CLIENTE', CUIT, DirPostalCiudad: 'Rosario', DirPostalProvincia: 'Santa Fé' })
    expect(alta.params.info_otra).toMatchObject({ idCondicionIva: '3' })
    expect(payload!.idCliente).toBe('900')
  })
})

// ---------------------------------------------------------------------------
// Hook de emisión ARCA
// ---------------------------------------------------------------------------

const datosHook = (tipoFactura: 'A' | 'B'): EmisionExternaDatos => ({
  tipoFactura,
  netoGravado: 1000,
  totalIVA: 210,
  totalFactura: 1210,
  currency: 'ARS',
  exchangeRate: null,
  fechaFactura: new Date('2026-10-05T12:00:00Z'),
  fechaVto: new Date('2026-10-12T12:00:00Z'),
  idCondicionPago: 'Contado',
  descripcion: 'Venta Mercado Libre #1',
})

const emisionOk = (cbteTipo: number) => ({
  ok: true,
  cbteTipo,
  puntoVenta: 7,
  numero: 3,
  numeroFormateado: '0007-00000003',
  cae: '76000000000003',
  caeVencimiento: new Date(),
  fecha: new Date('2026-10-05T12:00:00Z'),
  observaciones: [],
})

describe('crearHookEmisionArca', () => {
  it('RI sin documento especial: A, condición 1, CUIT (sin cambios)', async () => {
    arca.emitirComprobante.mockResolvedValue(emisionOk(1))
    const h = crearHookEmisionArca({ name: 'RI SA', cuit: '30-71111111-8', taxCondition: 'RESPONSABLE_INSCRIPTO' })
    await h.hook(datosHook('A'))
    expect(arca.emitirComprobante.mock.calls[0][0]).toMatchObject({ letra: 'A', receptor: { condicionIvaId: 1, docTipo: 80, docNro: '30711111118' } })
    expect(h.getReceptor()).toEqual({ docTipo: 80, docNro: '30711111118' })
  })

  it('Monotributo: A, condición 6', async () => {
    arca.emitirComprobante.mockResolvedValue(emisionOk(1))
    const h = crearHookEmisionArca({ name: 'MONO', cuit: CUIT, taxCondition: 'MONOTRIBUTO' })
    await h.hook(datosHook('A'))
    expect(arca.emitirComprobante.mock.calls[0][0]).toMatchObject({ letra: 'A', receptor: { condicionIvaId: 6, docTipo: 80 } })
  })

  it('letra distinta entre ARCA y Colppy: no emite', async () => {
    const h = crearHookEmisionArca({ name: 'MONO', cuit: CUIT, taxCondition: 'MONOTRIBUTO' })
    await expect(h.hook(datosHook('B'))).rejects.toBeInstanceOf(EmisionExternaError)
    expect(arca.emitirComprobante).not.toHaveBeenCalled()
  })

  it('B consumidor final con CUIL: DocTipo 86 (también en el QR y en getReceptor)', async () => {
    arca.emitirComprobante.mockResolvedValue(emisionOk(6))
    const h = crearHookEmisionArca({
      name: 'JUAN PEREZ',
      cuit: CUIT,
      taxCondition: 'CONSUMIDOR_FINAL',
      documentoReceptorB: { docTipo: 86, docNro: '20123456786' },
    })
    await h.hook(datosHook('B'))
    expect(arca.emitirComprobante.mock.calls[0][0]).toMatchObject({ letra: 'B', receptor: { condicionIvaId: 5, docTipo: 86, docNro: '20123456786' } })
    expect(h.getReceptor()).toEqual({ docTipo: 86, docNro: '20123456786' })
    const qr = JSON.parse(Buffer.from(h.getQrUrl()!.split('?p=')[1], 'base64').toString('utf8'))
    expect(qr).toMatchObject({ tipoDocRec: 86, nroDocRec: 20123456786, tipoCmp: 6 })
  })

  it('B consumidor final con DNI: DocTipo 96', async () => {
    arca.emitirComprobante.mockResolvedValue(emisionOk(6))
    const h = crearHookEmisionArca({ name: 'X', cuit: CUIT, taxCondition: 'CONSUMIDOR_FINAL', documentoReceptorB: { docTipo: 96, docNro: '12345678' } })
    await h.hook(datosHook('B'))
    expect(arca.emitirComprobante.mock.calls[0][0].receptor).toEqual({ condicionIvaId: 5, docTipo: 96, docNro: '12345678' })
  })

  it('B exento: condición 4 con CUIT', async () => {
    arca.emitirComprobante.mockResolvedValue(emisionOk(6))
    const h = crearHookEmisionArca({ name: 'FUNDACION', cuit: '30-69345023-9', taxCondition: 'EXENTO', documentoReceptorB: { docTipo: 80, docNro: '30693450239' } })
    await h.hook(datosHook('B'))
    expect(arca.emitirComprobante.mock.calls[0][0].receptor).toEqual({ condicionIvaId: 4, docTipo: 80, docNro: '30693450239' })
  })

  it('el documento de la B se ignora en una A', async () => {
    arca.emitirComprobante.mockResolvedValue(emisionOk(1))
    const h = crearHookEmisionArca({ name: 'RI', cuit: CUIT, taxCondition: 'RESPONSABLE_INSCRIPTO', documentoReceptorB: { docTipo: 96, docNro: '12345678' } })
    await h.hook(datosHook('A'))
    expect(arca.emitirComprobante.mock.calls[0][0].receptor).toEqual({ condicionIvaId: 1, docTipo: 80, docNro: '20123456786' })
  })

  it('documento de la B inválido: no emite', async () => {
    const h = crearHookEmisionArca({ name: 'X', cuit: CUIT, taxCondition: 'CONSUMIDOR_FINAL', documentoReceptorB: { docTipo: 99, docNro: '0' } })
    await expect(h.hook(datosHook('B'))).rejects.toBeInstanceOf(EmisionExternaError)
    expect(arca.emitirComprobante).not.toHaveBeenCalled()
    // Nunca se llamó a ARCA: se puede reintentar
    expect(h.getIntentoEmision()).toBeNull()
    expect(emisionDescartada(h.getIntentoEmision())).toBe(true)
  })
})

describe('crearHookEmisionArca: intento de emisión (para liberar o no un candado)', () => {
  const hookB = () => crearHookEmisionArca({ name: 'X', cuit: CUIT, taxCondition: 'CONSUMIDOR_FINAL', documentoReceptorB: { docTipo: 96, docNro: '12345678' } })

  it('autorizada: número y estado; no se puede reintentar', async () => {
    arca.emitirComprobante.mockResolvedValue(emisionOk(6))
    const h = hookB()
    await h.hook(datosHook('B'))
    expect(h.getIntentoEmision()).toEqual({ cbteTipo: 6, puntoVenta: 7, numero: 3, estado: 'autorizada' })
    expect(emisionDescartada(h.getIntentoEmision())).toBe(false)
  })

  it('rechazo definitivo de ARCA (ok: false): rechazada, se puede reintentar', async () => {
    arca.emitirComprobante.mockResolvedValue({ ok: false, cbteTipo: 6, puntoVenta: 7, numero: 4, errores: [{ Code: 10015, Msg: 'doc' }], mensaje: '[10015] doc' })
    const h = hookB()
    await expect(h.hook(datosHook('B'))).rejects.toBeInstanceOf(EmisionExternaError)
    expect(h.getIntentoEmision()).toMatchObject({ estado: 'rechazada', numero: 4 })
    expect(emisionDescartada(h.getIntentoEmision())).toBe(true)
  })

  it('falló antes de pedir el CAE (EmisionNoSolicitadaError): no-solicitada, se puede reintentar', async () => {
    arca.emitirComprobante.mockRejectedValue(new EmisionNoSolicitadaError(new Error('WSAA caído'), 6, 7))
    const h = hookB()
    await expect(h.hook(datosHook('B'))).rejects.toThrow('WSAA caído')
    expect(h.getIntentoEmision()).toMatchObject({ estado: 'no-solicitada', numero: null, error: 'WSAA caído' })
    expect(emisionDescartada(h.getIntentoEmision())).toBe(true)
  })

  it('corte después de pedir el CAE (EmisionInciertaError): incierta con el número esperado, NO reintentar', async () => {
    arca.emitirComprobante.mockRejectedValue(new EmisionInciertaError(new Error('socket hang up'), 6, 7, 15))
    const h = hookB()
    await expect(h.hook(datosHook('B'))).rejects.toThrow('socket hang up')
    expect(h.getIntentoEmision()).toEqual({ cbteTipo: 6, puntoVenta: 7, numero: 15, estado: 'incierta', error: 'socket hang up' })
    expect(emisionDescartada(h.getIntentoEmision())).toBe(false)
  })

  it('cualquier otro error al llamar a ARCA: incierta (no se sabe qué pasó)', async () => {
    arca.emitirComprobante.mockRejectedValue(new Error('ECONNRESET'))
    const h = hookB()
    await expect(h.hook(datosHook('B'))).rejects.toThrow('ECONNRESET')
    expect(h.getIntentoEmision()).toMatchObject({ cbteTipo: 6, estado: 'incierta', numero: null })
    expect(emisionDescartada(h.getIntentoEmision())).toBe(false)
  })

  it('B con CDI: DocTipo 87 aceptado (también en el QR)', async () => {
    arca.emitirComprobante.mockResolvedValue(emisionOk(6))
    const h = crearHookEmisionArca({ name: 'X', cuit: CUIT, taxCondition: 'CONSUMIDOR_FINAL', documentoReceptorB: { docTipo: 87, docNro: '20123456786' } })
    await h.hook(datosHook('B'))
    expect(arca.emitirComprobante.mock.calls[0][0].receptor).toEqual({ condicionIvaId: 5, docTipo: 87, docNro: '20123456786' })
    const qr = JSON.parse(Buffer.from(h.getQrUrl()!.split('?p=')[1], 'base64').toString('utf8'))
    expect(qr).toMatchObject({ tipoDocRec: 87, nroDocRec: 20123456786 })
  })
})

// ---------------------------------------------------------------------------
// Cotizaciones (send-to-colppy / generate-invoice): ARCA no confirmó el CAE
// ---------------------------------------------------------------------------

describe('avisoEmisionIncierta (rutas de cotizaciones)', () => {
  const quoteRi = {
    id: 'q1',
    quoteNumber: 'VAL-2026-0001',
    currency: 'ARS',
    exchangeRate: null,
    bonification: 0,
    customer: { name: 'RI SA', cuit: '30-71111111-8', taxCondition: 'RESPONSABLE_INSCRIPTO' },
    items: [item(1000)],
  }
  const hookRi = () => crearHookEmisionArca({ name: 'RI SA', cuit: '30-71111111-8', taxCondition: 'RESPONSABLE_INSCRIPTO' })

  it('504 / Fault después de pedir el CAE (EmisionInciertaError): mensaje bloqueante con el número, log [ARCA_INCIERTO], nada de "reintentá"', async () => {
    colppy.clientes.set('30-71111111-8', [{ idCliente: '77', RazonSocial: 'RI SA', CUIT: '30-71111111-8' }])
    arca.emitirComprobante.mockRejectedValue(new EmisionInciertaError(new Error('WSFE FECAESolicitar: respuesta inesperada (HTTP 504)'), 1, 7, 21))
    const h = hookRi()
    // Como en las rutas: sendQuoteToColppy atrapa el error y devuelve success false sin emisión
    const r = await sendQuoteToColppy({ action: 'factura-cuenta-corriente', emisionExterna: h.hook }, quoteRi)
    expect(r).toMatchObject({ success: false, errorStage: 'colppy' })
    expect(h.getEmision()).toBeNull()
    // Nunca se llegó a Colppy con la factura
    expect(colppy.llamadas.some((l) => l.op === 'FacturaVenta/alta_facturaventa')).toBe(false)

    const msg = avisoEmisionIncierta(h, { quoteId: 'q1', quoteNumber: 'VAL-2026-0001', error: r.error })
    expect(msg).toBe('ARCA no confirmó el comprobante (Factura A N° 0007-00000021): NO reintentes; revisalo en ARCA antes de volver a emitir')
    expect(msg).not.toMatch(/no se emitió nada|reintentá/i)
    expect(logger.error).toHaveBeenCalledWith(
      `[ARCA_INCIERTO] ${msg}`,
      expect.objectContaining({ quoteId: 'q1', quoteNumber: 'VAL-2026-0001', cbteTipo: 1, puntoVenta: 7, numero: 21, estado: 'incierta' })
    )
  })

  it('pedido cortado sin aviso (en curso) también bloquea, con número desconocido', () => {
    const h = {
      getEmision: () => null,
      getIntentoEmision: () => ({ cbteTipo: 6, puntoVenta: 7, numero: null, estado: 'en-curso' as const }),
    } as unknown as HookEmisionArca
    expect(avisoEmisionIncierta(h)).toMatch(/^ARCA no confirmó el comprobante \(Factura B N° PV 0007, número desconocido\): NO reintentes/)
  })

  it('rechazo de ARCA, falla antes de pedir el CAE, emitida o sin hook: null (las rutas siguen como siempre)', async () => {
    expect(avisoEmisionIncierta(null)).toBeNull()
    expect(avisoEmisionIncierta(hookRi())).toBeNull() // nunca llamó a ARCA

    arca.emitirComprobante.mockResolvedValue({ ok: false, cbteTipo: 1, puntoVenta: 7, numero: 4, errores: [{ Code: 10015, Msg: 'doc' }], mensaje: '[10015] doc' })
    const rechazada = hookRi()
    await expect(rechazada.hook(datosHook('A'))).rejects.toBeInstanceOf(EmisionExternaError)
    expect(avisoEmisionIncierta(rechazada)).toBeNull()

    arca.emitirComprobante.mockRejectedValue(new EmisionNoSolicitadaError(new Error('WSAA caído'), 1, 7))
    const noSolicitada = hookRi()
    await expect(noSolicitada.hook(datosHook('A'))).rejects.toThrow('WSAA caído')
    expect(avisoEmisionIncierta(noSolicitada)).toBeNull()

    arca.emitirComprobante.mockResolvedValue(emisionOk(1))
    const emitida = hookRi()
    await emitida.hook(datosHook('A'))
    expect(avisoEmisionIncierta(emitida)).toBeNull()
    expect(logger.error).not.toHaveBeenCalledWith(expect.stringContaining('[ARCA_INCIERTO]'), expect.anything())
  })
})

// ---------------------------------------------------------------------------
// Factura A: totalesFacturaA = el cálculo histórico en línea de sendQuoteToColppy
// ---------------------------------------------------------------------------

/**
 * Copia LITERAL de la rama A de sendQuoteToColppy antes de extraerla a
 * totalesFacturaA (itemsConIVA + acumulación de netoGravado + cierre + el
 * redondeo del payload). Sirve para probar que el refactor no cambió ni un
 * centavo de lo que va a ARCA/Colppy.
 */
function totalesALegacy(
  items: Array<{ cantidad: number | string; precioUnitario: number | string }>,
  bonification: number | null | undefined,
  pricesIncludeTax: boolean
) {
  const bonifFactor = 1 - Number(bonification ?? 0) / 100
  const itemsConIVA = items.map((item) => {
    let precioUnitario = item.precioUnitario as number
    if (pricesIncludeTax) {
      precioUnitario = precioUnitario / 1.21
    }
    return { ...item, precioUnitario }
  })
  let netoGravado = 0
  for (const item of itemsConIVA) {
    const cantidad = Number(item.cantidad)
    const importeUnitario = Number(item.precioUnitario)
    const importeTotal = importeUnitario * cantidad
    netoGravado += importeTotal
  }
  netoGravado = Math.round(netoGravado * bonifFactor * 100) / 100
  const totalIVA = Math.round(netoGravado * 0.21 * 100) / 100
  const totalFactura = Math.round((netoGravado + totalIVA) * 100) / 100
  return {
    neto: Math.round(netoGravado * 100) / 100,
    iva: Math.round(totalIVA * 100) / 100,
    total: Math.round(totalFactura * 100) / 100,
  }
}

/** PRNG con semilla (mulberry32): casos reproducibles */
function prng(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('totalesFacturaA: mismos números que el cálculo histórico de la rama A', () => {
  it('barrido de precios (0,01 a 20,00 de a centavo y hasta 5000 salteado), cantidades y bonificaciones, con y sin IVA incluido', () => {
    const precios: number[] = []
    for (let c = 1; c <= 2000; c++) precios.push(c / 100)
    for (let p = 20; p <= 5000; p += 0.37) precios.push(Math.round(p * 100) / 100)
    let casos = 0
    const distintos: string[] = []
    for (const precio of precios) {
      for (const cantidad of [1, 2, 3, 7]) {
        for (const bonif of [0, 3, 7.5]) {
          for (const conIva of [true, false]) {
            const linea = [{ cantidad, precioUnitario: precio }]
            const a = totalesFacturaA(linea, bonif, conIva)
            const l = totalesALegacy(linea, bonif, conIva)
            if (a.neto !== l.neto || a.iva !== l.iva || a.total !== l.total) distintos.push(`${precio}×${cantidad} bonif ${bonif} conIva ${conIva}`)
            casos++
          }
        }
      }
    }
    expect(casos).toBeGreaterThan(50000)
    expect(distintos).toEqual([])
  })

  it('varias líneas al azar (semilla fija), bonificación null/undefined y valores que llegan como texto', () => {
    const rnd = prng(20261005)
    for (let i = 0; i < 3000; i++) {
      const n = 1 + Math.floor(rnd() * 6)
      const lineas = Array.from({ length: n }, () => ({
        cantidad: 1 + Math.floor(rnd() * 12),
        precioUnitario: Math.round(rnd() * 250000) / 100,
      }))
      const bonif = [0, null, undefined, 5, 12.5][i % 5]
      const conIva = i % 2 === 0
      expect(totalesFacturaA(lineas, bonif, conIva)).toEqual(totalesALegacy(lineas, bonif, conIva))
    }
    // Inputs de formulario como texto (Number() en los dos lados)
    const texto = [{ cantidad: '2', precioUnitario: '100.5' }, { cantidad: '3', precioUnitario: '0.99' }]
    expect(totalesFacturaA(texto as unknown as Array<{ cantidad: number; precioUnitario: number }>, 3, true)).toEqual(totalesALegacy(texto, 3, true))
  })

  it('totalesFacturaADesdeFinal = totalesFacturaA con IVA incluido: $100 → 82,64 + 17,35 = 99,99', () => {
    expect(totalesFacturaADesdeFinal([{ cantidad: 1, precioFinal: 100 }])).toEqual({ neto: 82.64, iva: 17.35, total: 99.99 })
    expect(totalesFacturaADesdeFinal([{ cantidad: 2, precioFinal: 1210 }], 10)).toEqual(totalesFacturaA([{ cantidad: 2, precioUnitario: 1210 }], 10, true))
  })

  it('sendQuoteToColppy (A, varias líneas, bonificación, precios finales): ARCA y Colppy reciben lo mismo que con el cálculo histórico', async () => {
    const items = [item(100), item(50.5, 3), item(1234.57, 2)]
    for (const [pricesIncludeTax, bonification] of [[true, 0], [true, 3], [false, 7.5]] as const) {
      colppy.clientes.clear()
      const { datos, payload } = await facturar('RESPONSABLE_INSCRIPTO', 0, pricesIncludeTax, CUIT, { items, bonification })
      const legacy = totalesALegacy(items.map((i) => ({ cantidad: i.quantity, precioUnitario: i.unitPrice })), bonification, pricesIncludeTax)
      expect(datos).toMatchObject({ tipoFactura: 'A', netoGravado: legacy.neto, totalIVA: legacy.iva, totalFactura: legacy.total })
      expect(payload).toMatchObject({ netoGravado: legacy.neto, totalIVA: legacy.iva, totalFactura: legacy.total })
    }
  })
})
