import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest'

/**
 * Factura directa: parseo y validaciones del pedido, letra y bloqueos, totales
 * (las mismas funciones que sendQuoteToColppy), Factura B a consumidor final
 * ≥ $10M, USD y FCE, confirmaciones y la cotización sintética para Colppy.
 * Puro (Prisma falso solo para poder importar el servicio): sin red ni base.
 */

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
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

import { receptorDesdeCondicion } from '@/lib/arca/emitir'
import { totalesFacturaA, totalesFacturaB } from '@/lib/facturacion/totales-factura'
import {
  CONFIRMACIONES_FACTURA_DIRECTA,
  UMBRAL_IDENTIFICACION_CF,
  bloqueoClienteFacturaDirecta,
  calcularFacturaDirecta,
  codigoDeFirma,
  confirmacionesFaltantes,
  crearConfirmacion,
  datosEmisionFacturaDirecta,
  docTipoReceptorPrevisto,
  esCodigoConfirmacion,
  fechaComprobanteDirecta,
  fechaDesdeYmd,
  fechaYmdAr,
  fechaYmdLocal,
  firmaConfirmacion,
  tipoCambioAlejado,
  validarDocumentoReceptorB,
  validarLineasFacturaDirecta,
  validarPedidoFacturaDirecta,
  type EntradaCalculoFacturaDirecta,
} from '@/lib/facturacion/factura-directa-form'
import { cotizacionSinteticaParaColppy, type PedidoFacturaDirectaGuardado } from '@/lib/facturacion/factura-directa'

const UUID = '3f2b8c1e-9d4a-4e6b-8a1c-2b3d4e5f6a7b'

function entrada(over: Partial<EntradaCalculoFacturaDirecta> = {}): EntradaCalculoFacturaDirecta {
  return {
    taxCondition: 'RESPONSABLE_INSCRIPTO',
    cuit: '30-71111111-1',
    fceObligado: false,
    lineas: [
      { descripcion: 'Válvula esférica 1"', cantidad: 2, precioUnitario: 12345.67 },
      { descripcion: 'Manómetro', cantidad: 1, precioUnitario: 8900.5 },
    ],
    moneda: 'ARS',
    tipoCambio: null,
    preciosConIva: false,
    fceMontoMinimo: 5_549_862,
    ...over,
  }
}

const codigos = (ps: Array<{ codigo: string }>) => ps.map((p) => p.codigo)

// ---------------------------------------------------------------------------
// Pedido (estructura)
// ---------------------------------------------------------------------------

describe('validarPedidoFacturaDirecta (estructura → 400)', () => {
  const base = {
    idempotencyKey: UUID,
    customerId: 'CUS1',
    moneda: 'USD',
    tipoCambio: '1.450,50',
    condicionPago: 'a 30 Dias',
    preciosConIva: false,
    lineas: [{ productId: 'P1', descripcion: '  Válvula   esférica ', cantidad: '1.234,5', precioUnitario: '2.078,88', comentario: ' ítem 10 ' }],
    confirmaciones: ['EMISION_IRREVERSIBLE', 'EMISION_IRREVERSIBLE'],
  }

  it('parsea números con coma (formato argentino) y normaliza textos', () => {
    const { pedido, errores } = validarPedidoFacturaDirecta(base, { requiereClave: true })
    expect(errores).toEqual([])
    expect(pedido).toMatchObject({
      idempotencyKey: UUID,
      customerId: 'CUS1',
      moneda: 'USD',
      tipoCambio: 1450.5,
      condicionPago: 'a 30 Dias',
      preciosConIva: false,
      documentoReceptorB: null,
      observaciones: null,
      mlVenta: null,
      confirmaciones: ['EMISION_IRREVERSIBLE'],
    })
    expect(pedido!.lineas).toEqual([{ productId: 'P1', descripcion: 'Válvula esférica', cantidad: 1234.5, precioUnitario: 2078.88, comentario: 'ítem 10' }])
  })

  it('números JSON tal cual; en pesos se ignora el tipo de cambio; un texto no numérico queda NaN (lo frena la validación 422)', () => {
    const { pedido } = validarPedidoFacturaDirecta({ ...base, moneda: 'ARS', lineas: [{ descripcion: 'X', cantidad: 2, precioUnitario: 'abc' }] })
    expect(pedido!.tipoCambio).toBeNull()
    expect(pedido!.lineas[0].cantidad).toBe(2)
    expect(pedido!.lineas[0].precioUnitario).toBeNaN()
    expect(pedido!.lineas[0].productId).toBeNull()
  })

  it('body mal formado: errores de estructura', () => {
    expect(validarPedidoFacturaDirecta(null).pedido).toBeNull()
    expect(validarPedidoFacturaDirecta([]).pedido).toBeNull()
    const r = validarPedidoFacturaDirecta({ ...base, idempotencyKey: 'x', customerId: '', moneda: 'EUR', condicionPago: 'a 10 Dias', lineas: 'no', confirmaciones: [1] }, { requiereClave: true })
    expect(r.pedido).toBeNull()
    expect(r.errores).toEqual(
      expect.arrayContaining([
        'idempotencyKey tiene que ser un UUID',
        'Falta el cliente (customerId)',
        'moneda tiene que ser "ARS" o "USD"',
        'condicionPago no es una condición de pago válida',
        'lineas tiene que ser una lista',
        'confirmaciones tiene que ser una lista de códigos',
      ])
    )
    expect(validarPedidoFacturaDirecta({ ...base, documentoReceptorB: { docTipo: 80, docNro: '20123456786' } }).errores).toEqual([
      'documentoReceptorB.docTipo tiene que ser 96 (DNI) u 86 (CUIL)',
    ])
    expect(validarPedidoFacturaDirecta({ ...base, mlVenta: 'ABC' }).errores).toEqual(['mlVenta tiene que ser el número de la venta (pack u orden)'])
    expect(validarPedidoFacturaDirecta({ ...base, preciosConIva: 'si' }).errores).toEqual(['preciosConIva tiene que ser true o false'])
    expect(validarPedidoFacturaDirecta({ ...base, lineas: [{ descripcion: 'X', cantidad: {}, precioUnitario: 1 }] }).errores).toEqual([
      'lineas[0].cantidad tiene que ser un número',
    ])
  })

  it('la vista previa no exige la clave; la venta de ML y el documento se normalizan', () => {
    const { pedido } = validarPedidoFacturaDirecta({ ...base, idempotencyKey: undefined, mlVenta: 2000009000000001, documentoReceptorB: { docTipo: '96', docNro: '12.345.678' } })
    expect(pedido).toMatchObject({ idempotencyKey: null, mlVenta: '2000009000000001', documentoReceptorB: { docTipo: 96, docNro: '12345678' } })
  })
})

describe('validarLineasFacturaDirecta (422)', () => {
  const ok = { descripcion: 'Válvula', cantidad: 1, precioUnitario: 100 }

  it('de 1 a 50 líneas', () => {
    expect(codigos(validarLineasFacturaDirecta([]))).toEqual(['SIN_LINEAS'])
    expect(validarLineasFacturaDirecta(Array.from({ length: 50 }, () => ok))).toEqual([])
    expect(codigos(validarLineasFacturaDirecta(Array.from({ length: 51 }, () => ok)))).toEqual(['DEMASIADAS_LINEAS'])
  })

  it('descripción, cantidad y precio > 0 finitos con hasta 2 decimales; comentario corto', () => {
    const r = validarLineasFacturaDirecta([
      { ...ok, descripcion: '   ' },
      { ...ok, descripcion: 'x'.repeat(201) },
      { ...ok, cantidad: 0 },
      { ...ok, cantidad: -1 },
      { ...ok, cantidad: NaN },
      { ...ok, cantidad: 1.005 },
      { ...ok, precioUnitario: 0 },
      { ...ok, precioUnitario: Infinity },
      { ...ok, precioUnitario: 10.001 },
      { ...ok, comentario: 'c'.repeat(201) },
      { ...ok, cantidad: 2.5, precioUnitario: 0.01 },
    ])
    expect(r.map((e) => `${e.linea}:${e.codigo}`)).toEqual([
      '1:DESCRIPCION_INVALIDA',
      '2:DESCRIPCION_INVALIDA',
      '3:CANTIDAD_INVALIDA',
      '4:CANTIDAD_INVALIDA',
      '5:CANTIDAD_INVALIDA',
      '6:CANTIDAD_INVALIDA',
      '7:PRECIO_INVALIDO',
      '8:PRECIO_INVALIDO',
      '9:PRECIO_INVALIDO',
      '10:COMENTARIO_LARGO',
    ])
    expect(r[5].mensaje).toBe('Línea 6: la cantidad admite hasta 2 decimales')
  })
})

// ---------------------------------------------------------------------------
// Letra, bloqueos y totales
// ---------------------------------------------------------------------------

describe('letra según la condición del cliente (nunca a mano) y bloqueos', () => {
  it('RI y Monotributo → A; Consumidor Final y Exento → B', () => {
    expect(calcularFacturaDirecta(entrada()).letra).toBe('A')
    expect(calcularFacturaDirecta(entrada({ taxCondition: 'MONOTRIBUTO' })).letra).toBe('A')
    expect(calcularFacturaDirecta(entrada({ taxCondition: 'CONSUMIDOR_FINAL' })).letra).toBe('B')
    expect(calcularFacturaDirecta(entrada({ taxCondition: 'EXENTO' })).letra).toBe('B')
    // misma letra que ARCA
    for (const t of ['RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'CONSUMIDOR_FINAL', 'EXENTO']) {
      expect(calcularFacturaDirecta(entrada({ taxCondition: t })).letra).toBe(receptorDesdeCondicion(t, '30711111111').letra)
    }
  })

  it('cliente del exterior (condición, país o clave) y condiciones viejas: bloqueados', () => {
    expect(bloqueoClienteFacturaDirecta({ taxCondition: 'CLIENTE_EXTERIOR' })?.codigo).toBe('CLIENTE_EXTERIOR')
    expect(bloqueoClienteFacturaDirecta({ taxCondition: 'RESPONSABLE_INSCRIPTO', country: 'Chile' })?.codigo).toBe('CLIENTE_EXTERIOR')
    expect(bloqueoClienteFacturaDirecta({ taxCondition: 'CONSUMIDOR_FINAL', cuit: 'CL-76000000-0' })?.codigo).toBe('CLIENTE_EXTERIOR')
    expect(bloqueoClienteFacturaDirecta({ taxCondition: 'NO_RESPONSABLE' })?.codigo).toBe('CONDICION_NO_SOPORTADA')
    expect(bloqueoClienteFacturaDirecta({ taxCondition: 'RESPONSABLE_NO_INSCRIPTO' })?.codigo).toBe('CONDICION_NO_SOPORTADA')
    expect(bloqueoClienteFacturaDirecta({ taxCondition: 'RESPONSABLE_INSCRIPTO', country: 'Argentina' })).toBeNull()
    expect(codigos(calcularFacturaDirecta(entrada({ taxCondition: 'CLIENTE_EXTERIOR' })).errores)).toContain('CLIENTE_EXTERIOR')
  })
})

describe('totales: las mismas funciones que sendQuoteToColppy', () => {
  it('Factura A con precios netos: neto, IVA 21% y total', () => {
    const c = calcularFacturaDirecta(entrada())
    expect(c.totales).toEqual({ neto: 33591.84, iva: 7054.29, total: 40646.13, totalArs: 40646.13 })
    expect(c.totales).toMatchObject(totalesFacturaA(entrada().lineas, 0, false))
    expect(c).toMatchObject({ cbteTipoPrevisto: 1, esFce: false, preciosConIva: false, errores: [] })
  })

  it('Factura A con precios finales (IVA incluido): $100 → 82,64 + 17,35 = 99,99', () => {
    const c = calcularFacturaDirecta(entrada({ preciosConIva: true, lineas: [{ descripcion: 'X', cantidad: 1, precioUnitario: 100 }] }))
    expect(c.totales).toEqual({ neto: 82.64, iva: 17.35, total: 99.99, totalArs: 99.99 })
    expect(c.preciosConIva).toBe(true)
  })

  it('Factura B: total primero ($100 → 82,64 + 17,36) y precios finales siempre (aviso si vino sin IVA)', () => {
    const c = calcularFacturaDirecta(entrada({ taxCondition: 'CONSUMIDOR_FINAL', preciosConIva: false, lineas: [{ descripcion: 'X', cantidad: 1, precioUnitario: 100 }] }))
    expect(c.totales).toEqual({ neto: 82.64, iva: 17.36, total: 100, totalArs: 100 })
    expect(c).toMatchObject({ letra: 'B', cbteTipoPrevisto: 6, preciosConIva: true })
    expect(codigos(c.avisos)).toContain('PRECIOS_FINALES')
    expect(c.totales).toMatchObject(totalesFacturaB([{ cantidad: 1, precioFinal: 100 }], 0))
  })

  it('total inválido (IVA 0 por un neto ínfimo); toda factura avisa que no genera comisión', () => {
    const c = calcularFacturaDirecta(entrada({ lineas: [{ descripcion: 'X', cantidad: 1, precioUnitario: 0.01 }] }))
    expect(codigos(c.errores)).toEqual(['TOTAL_INVALIDO'])
    expect(codigos(calcularFacturaDirecta(entrada()).avisos)).toContain('SIN_COMISION')
  })

  it('las líneas inválidas no suman pero dan error', () => {
    const c = calcularFacturaDirecta(entrada({ lineas: [{ descripcion: 'X', cantidad: 1, precioUnitario: 100 }, { descripcion: '', cantidad: 0, precioUnitario: 50 }] }))
    expect(c.totales.neto).toBe(100)
    expect(codigos(c.errores)).toEqual(['DESCRIPCION_INVALIDA', 'CANTIDAD_INVALIDA'])
  })
})

describe('USD: total en pesos y tipo de cambio', () => {
  it('totalArs = total × TC (redondeado); TC obligatorio entre 1 y 100.000 con hasta 4 decimales', () => {
    const c = calcularFacturaDirecta(entrada({ moneda: 'USD', tipoCambio: 1450.5, lineas: [{ descripcion: 'X', cantidad: 1, precioUnitario: 1000 }] }))
    expect(c.totales).toEqual({ neto: 1000, iva: 210, total: 1210, totalArs: 1755105 })
    for (const tc of [null, 0, 0.5, 100001, 1450.12345, NaN]) {
      expect(codigos(calcularFacturaDirecta(entrada({ moneda: 'USD', tipoCambio: tc })).errores)).toContain('TIPO_CAMBIO_INVALIDO')
    }
  })

  it('TC alejado más de 3% del último BNA: confirmación', () => {
    expect(tipoCambioAlejado(1500, 1450)).toBe(true) // +3,4%
    expect(tipoCambioAlejado(1490, 1450)).toBe(false) // +2,8%
    expect(tipoCambioAlejado(1400, 1450)).toBe(true) // -3,4%
    expect(tipoCambioAlejado(1500, null)).toBe(false)
  })
})

describe('FCE MiPyME (misma regla que el hook de ARCA)', () => {
  it('obligado + A + total en pesos ≥ umbral → FCE A (201) con aviso; debajo del umbral no', () => {
    const fce = calcularFacturaDirecta(entrada({ fceObligado: true, fceMontoMinimo: 40000 }))
    expect(fce).toMatchObject({ esFce: true, cbteTipoPrevisto: 201 })
    expect(codigos(fce.avisos)).toContain('SALE_COMO_FCE')
    expect(calcularFacturaDirecta(entrada({ fceObligado: true, fceMontoMinimo: 50000 })).esFce).toBe(false)
    expect(calcularFacturaDirecta(entrada({ fceObligado: false, fceMontoMinimo: 1 })).esFce).toBe(false)
  })

  it('en USD el umbral se compara con total × TC', () => {
    const e = entrada({ moneda: 'USD', tipoCambio: 1400, fceObligado: true, fceMontoMinimo: 5_549_862, lineas: [{ descripcion: 'X', cantidad: 1, precioUnitario: 3300 }] })
    // 3300 × 1,21 = 3993 USD × 1400 = 5.590.200 ≥ 5.549.862
    expect(calcularFacturaDirecta(e).esFce).toBe(true)
    expect(calcularFacturaDirecta({ ...e, tipoCambio: 1300 }).esFce).toBe(false) // 5.190.900
  })

  it('la B nunca es FCE; sin ARCA_CBU no se puede emitir la FCE', () => {
    expect(calcularFacturaDirecta(entrada({ taxCondition: 'EXENTO', fceObligado: true, fceMontoMinimo: 1 })).esFce).toBe(false)
    expect(codigos(calcularFacturaDirecta(entrada({ fceObligado: true, fceMontoMinimo: 1, cbuConfigurado: false })).errores)).toEqual(['FCE_SIN_CBU'])
  })
})

describe('Factura B a consumidor final ≥ $10.000.000 (RG 5866)', () => {
  const cf = (total: number, over: Partial<EntradaCalculoFacturaDirecta> = {}) =>
    calcularFacturaDirecta(entrada({ taxCondition: 'CONSUMIDOR_FINAL', cuit: '', lineas: [{ descripcion: 'X', cantidad: 1, precioUnitario: total }], ...over }))

  it('sin documento (99) desde el umbral: error DOC_REQUERIDO_CF; con DNI o CUIL, no', () => {
    expect(UMBRAL_IDENTIFICACION_CF).toBe(10_000_000)
    expect(codigos(cf(10_000_000).errores)).toEqual(['DOC_REQUERIDO_CF'])
    expect(cf(9_999_999.99).errores).toEqual([])
    expect(cf(10_000_000, { documentoReceptorB: { docTipo: 96, docNro: '12345678' } }).errores).toEqual([])
    expect(cf(10_000_000, { documentoReceptorB: { docTipo: 86, docNro: '20123456786' } }).errores).toEqual([])
    // Con CUIT (80) no hace falta
    expect(cf(20_000_000, { cuit: '20-12345678-6' }).errores).toEqual([])
  })

  it('en USD cuenta el equivalente en pesos', () => {
    expect(codigos(cf(8000, { moneda: 'USD', tipoCambio: 1300 }).errores)).toEqual(['DOC_REQUERIDO_CF']) // 10.400.000
    expect(cf(7000, { moneda: 'USD', tipoCambio: 1300 }).errores).toEqual([])
  })

  it('documento de la B: DNI 7-8 dígitos, CUIL con dígito verificador', () => {
    expect(validarDocumentoReceptorB({ docTipo: 96, docNro: '1234567' })).toBeNull()
    expect(validarDocumentoReceptorB({ docTipo: 96, docNro: '123456' })?.codigo).toBe('DOC_INVALIDO')
    expect(validarDocumentoReceptorB({ docTipo: 96, docNro: '00000000' })?.codigo).toBe('DOC_INVALIDO')
    expect(validarDocumentoReceptorB({ docTipo: 86, docNro: '20123456789' })?.codigo).toBe('DOC_INVALIDO')
    expect(codigos(cf(100, { documentoReceptorB: { docTipo: 96, docNro: '12' } }).errores)).toEqual(['DOC_INVALIDO'])
  })

  it('el documento previsto coincide con receptorDesdeCondicion de ARCA', () => {
    for (const [cond, cuit] of [
      ['CONSUMIDOR_FINAL', ''],
      ['CONSUMIDOR_FINAL', '20-12345678-6'],
      ['CONSUMIDOR_FINAL', '12345678'],
      ['EXENTO', '30-70000000-8'],
      ['EXENTO', ''],
      ['RESPONSABLE_INSCRIPTO', '30-71111111-1'],
    ]) {
      expect(docTipoReceptorPrevisto(cond, cuit)).toBe(receptorDesdeCondicion(cond, cuit).receptor.docTipo)
    }
    expect(docTipoReceptorPrevisto('CONSUMIDOR_FINAL', '', { docTipo: 96, docNro: '1' })).toBe(96)
  })
})

// ---------------------------------------------------------------------------
// Confirmaciones y datos para ARCA
// ---------------------------------------------------------------------------

describe('confirmaciones', () => {
  it('faltan las requeridas cuya FIRMA no vino; un código suelto no confirma; códigos conocidos', () => {
    const req = [crearConfirmacion('EMISION_IRREVERSIBLE', 'x'), crearConfirmacion('POSIBLE_DUPLICADO', 'y')]
    const [irreversible, duplicado] = req.map((c) => c.firma)
    expect(confirmacionesFaltantes(req, [irreversible]).map((c) => c.codigo)).toEqual(['POSIBLE_DUPLICADO'])
    expect(confirmacionesFaltantes(req, [duplicado, irreversible, 'OTRA'])).toEqual([])
    // Los códigos solos (sin la firma de lo que se mostró) no confirman nada
    expect(confirmacionesFaltantes(req, ['EMISION_IRREVERSIBLE', 'POSIBLE_DUPLICADO']).map((c) => c.codigo)).toEqual(['EMISION_IRREVERSIBLE', 'POSIBLE_DUPLICADO'])
    expect(Object.keys(CONFIRMACIONES_FACTURA_DIRECTA)).toEqual([
      'EMISION_IRREVERSIBLE',
      'TIPO_CAMBIO_ALEJADO',
      'POSIBLE_DUPLICADO',
      'DIRECTA_RECIENTE',
      'POSIBLE_DUPLICADO_ML',
      'ML_FACTURA_ADJUNTA',
      'ML_FACTURA_SIN_VERIFICAR',
      'ML_TOTAL_DISTINTO',
      'ML_OTRO_TITULAR',
      'CONDICION_IVA_SIN_CONFIRMAR',
    ])
    expect(esCodigoConfirmacion('ML_OTRO_TITULAR')).toBe(true)
    expect(esCodigoConfirmacion('toString')).toBe(false)
  })

  it('la firma ata el tilde al texto: otro motivo (otro duplicado, otro TC) es otra firma', () => {
    const a = crearConfirmacion('POSIBLE_DUPLICADO', 'Posible factura duplicada: A-0007-00000005 del 2/10/2026')
    expect(a.firma).toMatch(/^POSIBLE_DUPLICADO:[0-9a-f]{14}$/)
    expect(codigoDeFirma(a.firma)).toBe('POSIBLE_DUPLICADO')
    // Determinística (igual en el navegador y en el servidor)
    expect(crearConfirmacion('POSIBLE_DUPLICADO', a.mensaje).firma).toBe(a.firma)
    expect(firmaConfirmacion('POSIBLE_DUPLICADO', a.mensaje)).toBe(a.firma)
    expect(crearConfirmacion('POSIBLE_DUPLICADO', 'Posible factura duplicada: A-0007-00000012 del 5/10/2026').firma).not.toBe(a.firma)
    // Mismo texto con otro código: otra firma
    expect(firmaConfirmacion('DIRECTA_RECIENTE', a.mensaje)).not.toBe(a.firma)
    // Sin mensaje: el texto por defecto
    expect(crearConfirmacion('EMISION_IRREVERSIBLE').mensaje).toBe(CONFIRMACIONES_FACTURA_DIRECTA.EMISION_IRREVERSIBLE)
    const vieja = crearConfirmacion('TIPO_CAMBIO_ALEJADO', 'El TC 1500 se aleja del BNA 1450')
    expect(confirmacionesFaltantes([crearConfirmacion('TIPO_CAMBIO_ALEJADO', 'El TC 1500 se aleja del BNA 1400')], [vieja.firma])).toHaveLength(1)
  })
})

describe('fecha del comprobante', () => {
  it('las 12:00 locales del día: CbteFch (local) y el QR (UTC) dan el mismo día', () => {
    const t = process.env.TZ
    try {
      for (const tz of ['America/Argentina/Buenos_Aires', 'UTC', 'Asia/Tokyo']) {
        process.env.TZ = tz
        const ahora = new Date(2026, 9, 31, 23, 45) // 31/10 23:45 local
        const f = fechaComprobanteDirecta(ahora)
        expect(fechaYmdLocal(f)).toBe('2026-10-31')
        expect(f.toISOString().slice(0, 10)).toBe('2026-10-31')
        expect(fechaDesdeYmd('2026-10-31').getTime()).toBe(f.getTime())
      }
    } finally {
      process.env.TZ = t
    }
  })
})

describe('datos para el hook de ARCA', () => {
  it('los mismos campos que arma sendQuoteToColppy; vencimiento según la condición', () => {
    const c = calcularFacturaDirecta(entrada({ moneda: 'USD', tipoCambio: 1450.5 }))
    const fecha = new Date(2026, 9, 5, 11, 0)
    expect(datosEmisionFacturaDirecta(c, { moneda: 'USD', tipoCambio: 1450.5, condicionPago: 'Contado', fecha, descripcion: 'Factura directa' })).toEqual({
      tipoFactura: 'A',
      netoGravado: c.totales.neto,
      totalIVA: c.totales.iva,
      totalFactura: c.totales.total,
      currency: 'USD',
      exchangeRate: 1450.5,
      fechaFactura: fecha,
      fechaVto: new Date(2026, 9, 12, 11, 0), // Contado: +7 días
      idCondicionPago: 'Contado',
      descripcion: 'Factura directa',
    })
    expect(datosEmisionFacturaDirecta(c, { moneda: 'ARS', tipoCambio: null, condicionPago: 'a 30 Dias', fecha, descripcion: '' }).exchangeRate).toBeNull()
  })

  it('fecha en hora de Buenos Aires', () => {
    expect(fechaYmdAr(new Date('2026-10-06T02:30:00Z'))).toBe('2026-10-05') // 23:30 AR
    expect(fechaYmdAr(new Date('2026-10-06T03:30:00Z'))).toBe('2026-10-06')
  })
})

// ---------------------------------------------------------------------------
// Cotización sintética para Colppy = importes de la Invoice
// ---------------------------------------------------------------------------

describe('cotizacionSinteticaParaColppy: Colppy recalcula los mismos importes que la Invoice', () => {
  /** El cálculo de sendQuoteToColppy (colppy.ts) a partir de la cotización */
  function totalesComoColppy(q: ReturnType<typeof cotizacionSinteticaParaColppy>, letra: 'A' | 'B') {
    return letra === 'B'
      ? totalesFacturaB(q.items.map((i) => ({ cantidad: i.quantity, precioFinal: i.unitPrice })), q.bonification)
      : totalesFacturaA(q.items.map((i) => ({ cantidad: i.quantity, precioUnitario: i.unitPrice })), q.bonification, q.pricesIncludeTax!)
  }

  const casos: Array<[string, Partial<EntradaCalculoFacturaDirecta>]> = [
    ['A neto', {}],
    ['A con precios finales', { preciosConIva: true, lineas: [{ descripcion: 'X', cantidad: 3, precioUnitario: 100 }, { descripcion: 'Y', cantidad: 1.5, precioUnitario: 99.99 }] }],
    ['B consumidor final', { taxCondition: 'CONSUMIDOR_FINAL', lineas: [{ descripcion: 'X', cantidad: 3, precioUnitario: 10.05 }, { descripcion: 'Y', cantidad: 2, precioUnitario: 1999.9 }] }],
    ['B exento con preciosConIva=false (se fuerza final)', { taxCondition: 'EXENTO', preciosConIva: false }],
    ['A en dólares', { moneda: 'USD', tipoCambio: 1450.5 }],
  ]

  it.each(casos)('%s', (_n, over) => {
    const e = entrada(over)
    const c = calcularFacturaDirecta(e)
    expect(c.errores).toEqual([])
    const lineas = e.lineas.map((l, i) => ({ productId: null, sku: i ? null : 'SKU-1', descripcion: l.descripcion, cantidad: l.cantidad, precioUnitario: l.precioUnitario, comentario: null }))
    const pedido = {
      letra: c.letra,
      preciosConIva: c.preciosConIva,
      tipoCambio: e.tipoCambio ?? null,
      cliente: { name: 'CLIENTE', cuit: e.cuit!, taxCondition: e.taxCondition!, fceObligado: false },
    } as PedidoFacturaDirectaGuardado
    // La Invoice guarda subtotal/taxAmount/total = c.totales
    const inv = { invoiceNumber: `${c.letra}-0007-00000012`, currency: e.moneda, exchangeRate: e.tipoCambio, customer: { name: 'CLIENTE', cuit: e.cuit!, taxCondition: e.taxCondition! } }
    const q = cotizacionSinteticaParaColppy(inv, lineas, { id: 'FD1', mlPackId: null, pedido })
    expect(totalesComoColppy(q, c.letra)).toEqual({ neto: c.totales.neto, iva: c.totales.iva, total: c.totales.total })
    expect(q).toMatchObject({ id: 'directa-FD1', quoteNumber: inv.invoiceNumber, bonification: 0, currency: e.moneda, exchangeRate: e.moneda === 'USD' ? 1450.5 : null })
    expect(q.items[0]).toMatchObject({ productSku: 'SKU-1', comentario: `Factura directa ${inv.invoiceNumber}` })
    expect(q.items[1].productSku).toBe('')
  })

  it('la condición IVA del momento de emitir manda (la letra salió de ahí) y el comentario de la línea se respeta', () => {
    const pedido = { letra: 'A', preciosConIva: false, tipoCambio: null, cliente: { name: 'C', cuit: '30-71111111-1', taxCondition: 'MONOTRIBUTO', fceObligado: false } } as PedidoFacturaDirectaGuardado
    const q = cotizacionSinteticaParaColppy(
      { invoiceNumber: 'A-0007-00000001', currency: 'ARS', exchangeRate: null, customer: { name: 'C', cuit: '30-71111111-1', taxCondition: 'RESPONSABLE_INSCRIPTO' } },
      [{ productId: null, sku: null, descripcion: 'X', cantidad: 1, precioUnitario: 10, comentario: 'OC 4500 ítem 3' }],
      { id: 'FD2', mlPackId: '2000009000000001', pedido }
    )
    expect(q.customer.taxCondition).toBe('MONOTRIBUTO')
    expect(q.items[0].comentario).toBe('OC 4500 ítem 3')
    expect(q.pricesIncludeTax).toBe(false)
  })
})
