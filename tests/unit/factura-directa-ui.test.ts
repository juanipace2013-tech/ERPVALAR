import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest'

/**
 * Pantalla "Nueva factura" (/facturas/nueva): armado del pedido y su firma,
 * validación local (= servidor), clave de idempotencia, clasificación de las
 * respuestas de la emisión (bloqueante / reintentar con la misma clave /
 * confirmar / corregir), avisos del éxito, productos, venta de ML, alta de
 * cliente y el estado en Colppy del detalle. Puro: sin red ni base.
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

import { ROLES } from '@/lib/authz'
import { esCuitValido } from '@/lib/cuit-utils'
import { REGISTRANDO_VENCE_MS, type PreviewFacturaDirecta, type ResultadoFacturaDirecta } from '@/lib/facturacion/factura-directa'
import { calcularFacturaDirecta, crearConfirmacion, validarPedidoFacturaDirecta } from '@/lib/facturacion/factura-directa-form'
import {
  ESTADO_EMISION_INICIAL,
  REGISTRANDO_COLPPY_VENCE_MS,
  ROLES_FACTURA_DIRECTA,
  altaClienteDesdeArca,
  altaClienteDuplicada,
  aplicarConfirmacionesRequeridas,
  armarPedidoFacturaDirecta,
  avisosResultadoEmision,
  bloqueosVentaMl,
  cambiaSignificadoPrecios,
  clasificarRespuestaEmision,
  claveTrasResultado,
  clienteDesdeApi,
  cuerpoAltaCliente,
  cuerpoEmisionFacturaDirecta,
  documentoReceptorDesdeForm,
  erroresDeLinea,
  estadoSubidaMl,
  estadoTrasEmision,
  etiquetaColppyAsociado,
  etiquetaComprobante,
  firmaPedidoFacturaDirecta,
  formInicial,
  formParaCliente,
  invalidarVistaPrevia,
  ivaProductoSoportado,
  lineaConProducto,
  lineaEnBlanco,
  lineaVacia,
  lineasDesdeVentaMl,
  ncRequiereRegistroColppy,
  notaRedondeoPreciosConIva,
  nuevaClaveIdempotencia,
  numeroATexto,
  precioVentaSugerido,
  problemasDeError,
  puedeEmitirFacturaDirecta,
  puedeFacturaDirecta,
  puedeReintentarColppy,
  reintentoConConfirmacionesVigentes,
  SUBIDA_ML_EN_CURSO_MS,
  tipoCambioDesdeApi,
  validarAltaCliente,
  validarFormularioFacturaDirecta,
  type ClienteFacturaDirecta,
  type FormFacturaDirecta,
  type VistaPreviaVigente,
} from '@/lib/facturacion/factura-directa-ui'
import { parseNumeroAr } from '@/lib/facturacion/nc-unidades'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const RI: ClienteFacturaDirecta = {
  id: 'c-ri',
  name: 'ACME SA',
  businessName: 'ACME SA',
  cuit: '30-71234567-1',
  taxCondition: 'RESPONSABLE_INSCRIPTO',
  country: 'Argentina',
  status: 'ACTIVE',
  fceObligado: false,
  paymentTerms: 30,
}
const CF: ClienteFacturaDirecta = { ...RI, id: 'c-cf', name: 'Juan Pérez', businessName: null, cuit: '20-12345678-6', taxCondition: 'CONSUMIDOR_FINAL', paymentTerms: null }

let n = 0
const uid = () => `u${++n}`

function form(over: Partial<FormFacturaDirecta> = {}): FormFacturaDirecta {
  return {
    ...formInicial(uid()),
    lineas: [{ ...lineaVacia(uid()), descripcion: 'Válvula esférica 1"', cantidad: '2', precio: '1.000,50' }],
    ...over,
  }
}

describe('roles', () => {
  it('son los mismos que exigen las rutas (ROLES.FINANZAS)', () => {
    expect([...ROLES_FACTURA_DIRECTA].sort()).toEqual([...ROLES.FINANZAS].sort())
  })
  it('solo ADMIN, GERENTE y CONTADOR', () => {
    expect(puedeFacturaDirecta('ADMIN')).toBe(true)
    expect(puedeFacturaDirecta('CONTADOR')).toBe(true)
    expect(puedeFacturaDirecta('VENDEDOR')).toBe(false)
    expect(puedeFacturaDirecta(undefined)).toBe(false)
  })
})

describe('cliente y formulario', () => {
  it('normaliza el cliente de GET /api/clientes/[id]', () => {
    const c = clienteDesdeApi({ id: 'x', name: 'A', cuit: '30-1', taxCondition: 'MONOTRIBUTO', fceObligado: true, paymentTerms: 45, status: 'ACTIVE', country: 'Argentina', quotes: [] })
    expect(c).toMatchObject({ id: 'x', taxCondition: 'MONOTRIBUTO', fceObligado: true, paymentTerms: 45, businessName: null })
    expect(clienteDesdeApi({ name: 'sin id' })).toBeNull()
    expect(clienteDesdeApi({ id: 'y', paymentTerms: null })!.paymentTerms).toBeNull()
  })

  it('al elegir el cliente: condición de pago por sus días, precios con IVA en la B y documento del cliente', () => {
    const f = form({ docReceptor: { tipo: 'DNI', nro: '123' } })
    const a = formParaCliente(f, RI)
    expect(a.condicionPago).toBe('a 30 Dias')
    expect(a.preciosConIva).toBe(false)
    expect(a.docReceptor).toEqual({ tipo: 'CLIENTE', nro: '' })
    expect(a.lineas).toBe(f.lineas)
    const b = formParaCliente(f, CF)
    expect(b.condicionPago).toBe('Contado')
    expect(b.preciosConIva).toBe(true)
    // De una B a una A: los precios tipeados siguen siendo finales (no cambia lo que significan)
    const deBaA = formParaCliente(b, RI)
    expect(deBaA.preciosConIva).toBe(true)
    expect(cambiaSignificadoPrecios({ letra: 'B', preciosConIva: b.preciosConIva }, { letra: 'A', preciosConIva: deBaA.preciosConIva })).toBe(false)
    // De una A con netos a una B: sí cambia (hay que avisar)
    expect(cambiaSignificadoPrecios({ letra: 'A', preciosConIva: a.preciosConIva }, { letra: 'B', preciosConIva: formParaCliente(a, CF).preciosConIva })).toBe(true)
  })

  it('avisa cuando cambia lo que significa el precio (neto ↔ final)', () => {
    expect(cambiaSignificadoPrecios({ letra: 'A', preciosConIva: false }, { letra: 'B', preciosConIva: true })).toBe(true)
    expect(cambiaSignificadoPrecios({ letra: 'A', preciosConIva: true }, { letra: 'B', preciosConIva: true })).toBe(false)
    expect(cambiaSignificadoPrecios({ letra: null, preciosConIva: false }, { letra: 'B', preciosConIva: true })).toBe(false)
  })

  it('numeroATexto no es ambiguo para parseNumeroAr', () => {
    for (const x of [1234.56, 12.345, 1500, 0.5, 1_000_000.25]) expect(parseNumeroAr(numeroATexto(x))).toBeCloseTo(x, 4)
    expect(numeroATexto(NaN)).toBe('')
    expect(numeroATexto(null)).toBe('')
  })

  it('línea en blanco', () => {
    expect(lineaEnBlanco(lineaVacia('a'))).toBe(true)
    expect(lineaEnBlanco({ ...lineaVacia('a'), precio: '1' })).toBe(false)
    expect(lineaEnBlanco({ ...lineaVacia('a'), productId: 'p' })).toBe(false)
  })
})

describe('pedido y firma', () => {
  it('arma el pedido que entiende validarPedidoFacturaDirecta (números argentinos)', () => {
    const p = armarPedidoFacturaDirecta(RI, form({ observaciones: '  OC 123  ', mlVenta: ' ' }))
    expect(p).toMatchObject({ customerId: 'c-ri', moneda: 'ARS', tipoCambio: null, preciosConIva: false, documentoReceptorB: null, observaciones: 'OC 123', mlVenta: null })
    expect(p.lineas[0]).toEqual({ productId: null, descripcion: 'Válvula esférica 1"', cantidad: 2, precioUnitario: 1000.5, comentario: null })
    const v = validarPedidoFacturaDirecta(cuerpoEmisionFacturaDirecta(p, nuevaClaveIdempotencia(), [], []), { requiereClave: true })
    expect(v.errores).toEqual([])
    expect(v.pedido!.lineas[0].precioUnitario).toBe(1000.5)
  })

  it('USD: manda el tipo de cambio; un texto que no es número viaja tal cual (el servidor lo rechaza)', () => {
    expect(armarPedidoFacturaDirecta(RI, form({ moneda: 'USD', tipoCambio: '1.450,5' })).tipoCambio).toBe(1450.5)
    expect(armarPedidoFacturaDirecta(RI, form({ moneda: 'USD', tipoCambio: 'abc' })).tipoCambio).toBe('abc')
    expect(armarPedidoFacturaDirecta(RI, form({ moneda: 'ARS', tipoCambio: '1450' })).tipoCambio).toBeNull()
  })

  it('B: precios siempre con IVA y documento del comprador (DNI/CUIL) solo si no es el del cliente', () => {
    const p = armarPedidoFacturaDirecta(CF, form({ preciosConIva: false, docReceptor: { tipo: 'DNI', nro: '12.345.678' } }))
    expect(p.preciosConIva).toBe(true)
    expect(p.documentoReceptorB).toEqual({ docTipo: 96, docNro: '12345678' })
    expect(documentoReceptorDesdeForm('B', { tipo: 'CUIL', nro: '20-12345678-6' })).toEqual({ docTipo: 86, docNro: '20123456786' })
    expect(documentoReceptorDesdeForm('B', { tipo: 'CLIENTE', nro: '1' })).toBeNull()
    // En la A nunca viaja (el servidor igual lo ignoraría)
    expect(documentoReceptorDesdeForm('A', { tipo: 'DNI', nro: '12345678' })).toBeNull()
  })

  it('cualquier edición cambia la firma; la clave y las confirmaciones no son parte de ella', () => {
    const f = form()
    const firma = firmaPedidoFacturaDirecta(armarPedidoFacturaDirecta(RI, f))
    expect(firmaPedidoFacturaDirecta(armarPedidoFacturaDirecta(RI, { ...f }))).toBe(firma)
    const cambios: Array<Partial<FormFacturaDirecta>> = [
      { condicionPago: 'a 15 Dias' },
      { preciosConIva: true },
      { observaciones: 'x' },
      { moneda: 'USD', tipoCambio: '1000' },
      { lineas: [{ ...f.lineas[0], precio: '1.000,51' }] },
      { lineas: [{ ...f.lineas[0], comentario: 'OC 1' }] },
      { mlVenta: '2000001' },
    ]
    for (const c of cambios) expect(firmaPedidoFacturaDirecta(armarPedidoFacturaDirecta(RI, { ...f, ...c }))).not.toBe(firma)
    expect(firmaPedidoFacturaDirecta(armarPedidoFacturaDirecta({ ...RI, id: 'otro' }, f))).not.toBe(firma)
  })

  it('el cuerpo de la emisión lleva las FIRMAS de las confirmaciones tildadas que pidió el servidor', () => {
    const p = armarPedidoFacturaDirecta(RI, form())
    const irreversible = crearConfirmacion('EMISION_IRREVERSIBLE', 'x')
    const otroTitular = crearConfirmacion('ML_OTRO_TITULAR', 'z')
    const c = cuerpoEmisionFacturaDirecta(p, 'k', [irreversible, crearConfirmacion('POSIBLE_DUPLICADO', 'y')], [irreversible.firma, otroTitular.firma])
    expect(c.confirmaciones).toEqual([irreversible.firma])
    expect(c.idempotencyKey).toBe('k')
    // Un código suelto tildado no viaja
    expect(cuerpoEmisionFacturaDirecta(p, 'k', [irreversible], ['EMISION_IRREVERSIBLE']).confirmaciones).toEqual([])
  })

  it('reintento: solo si sigue tildado todo lo que lleva el cuerpo guardado', () => {
    const a = crearConfirmacion('EMISION_IRREVERSIBLE', 'x')
    const b = crearConfirmacion('ML_OTRO_TITULAR', 'y')
    expect(reintentoConConfirmacionesVigentes({ confirmaciones: [a.firma, b.firma] }, [a.firma, b.firma])).toBe(true)
    expect(reintentoConConfirmacionesVigentes({ confirmaciones: [a.firma, b.firma] }, [a.firma])).toBe(false)
    expect(reintentoConConfirmacionesVigentes({ confirmaciones: [] }, [])).toBe(true)
  })
})

describe('validación local (= calcularFacturaDirecta del servidor)', () => {
  it('sin cliente', () => {
    const v = validarFormularioFacturaDirecta(null, form())
    expect(v.errores.map((e) => e.codigo)).toEqual(['SIN_CLIENTE'])
    expect(v.calculo).toBeNull()
  })

  it('los totales son los mismos que calcula el servidor con el pedido parseado', () => {
    const f = form({ lineas: [{ ...lineaVacia('a'), descripcion: 'x', cantidad: '3', precio: '100' }, { ...lineaVacia('b'), descripcion: 'y', cantidad: '1,5', precio: '33,33' }] })
    for (const cliente of [RI, CF]) {
      const v = validarFormularioFacturaDirecta(cliente, f)
      const { pedido } = validarPedidoFacturaDirecta(armarPedidoFacturaDirecta(cliente, f))
      const servidor = calcularFacturaDirecta({ ...cliente, ...pedido!, fceMontoMinimo: Infinity })
      expect(v.calculo!.totales).toEqual(servidor.totales)
      expect(v.errores).toEqual([])
    }
  })

  it('errores de línea con su número de fila', () => {
    const f = form({ lineas: [{ ...lineaVacia('a'), descripcion: 'ok', cantidad: '1', precio: '10' }, { ...lineaVacia('b'), descripcion: '', cantidad: '0', precio: '1,234' }] })
    const v = validarFormularioFacturaDirecta(RI, f)
    expect(erroresDeLinea(v.errores, 0)).toEqual([])
    expect(erroresDeLinea(v.errores, 1).map((e) => e.codigo).sort()).toEqual(['CANTIDAD_INVALIDA', 'DESCRIPCION_INVALIDA', 'PRECIO_INVALIDO'])
  })

  it('USD sin tipo de cambio, ML en dólares, observaciones largas, cliente inactivo', () => {
    const v = validarFormularioFacturaDirecta({ ...RI, status: 'INACTIVE' }, form({ moneda: 'USD', tipoCambio: '', mlVenta: '2000001', observaciones: 'x'.repeat(501) }))
    expect(v.errores.map((e) => e.codigo)).toEqual(expect.arrayContaining(['CLIENTE_INACTIVO', 'TIPO_CAMBIO_INVALIDO', 'ML_SOLO_ARS', 'OBSERVACIONES_LARGAS']))
    expect(validarFormularioFacturaDirecta(RI, form({ mlVenta: '20000-01' })).errores.map((e) => e.codigo)).toContain('ML_VENTA_INVALIDA')
  })

  it('cliente del exterior: bloquea y no hay cálculo', () => {
    const v = validarFormularioFacturaDirecta({ ...RI, taxCondition: 'CLIENTE_EXTERIOR', country: 'Chile', cuit: 'CL-761234567' }, form())
    expect(v.errores.map((e) => e.codigo)).toContain('CLIENTE_EXTERIOR')
    expect(v.calculo).toBeNull()
  })

  it('B a consumidor final ≥ $10M sin documento: pide DNI/CUIL; con DNI pasa', () => {
    const cf = { ...CF, cuit: '0' }
    const grande = form({ lineas: [{ ...lineaVacia('a'), descripcion: 'x', cantidad: '1', precio: '10.000.000' }] })
    expect(validarFormularioFacturaDirecta(cf, grande).errores.map((e) => e.codigo)).toContain('DOC_REQUERIDO_CF')
    const conDni = validarFormularioFacturaDirecta(cf, { ...grande, docReceptor: { tipo: 'DNI', nro: '12345678' } })
    expect(conDni.errores).toEqual([])
    expect(validarFormularioFacturaDirecta(cf, { ...grande, docReceptor: { tipo: 'DNI', nro: '' } }).errores.map((e) => e.codigo)).toContain('DOC_INVALIDO')
  })

  it('no repite el aviso de comisión (va en el pie) y la FCE la decide la vista previa', () => {
    const v = validarFormularioFacturaDirecta({ ...RI, fceObligado: true }, form({ lineas: [{ ...lineaVacia('a'), descripcion: 'x', cantidad: '1', precio: '99.000.000' }] }))
    expect(v.avisos.map((a) => a.codigo)).not.toContain('SIN_COMISION')
    expect(v.calculo!.esFce).toBe(false)
  })

  it('nota del redondeo de la A con precios con IVA', () => {
    const lineas = [{ cantidad: 1, precioUnitario: 100 }]
    const a = calcularFacturaDirecta({ taxCondition: 'RESPONSABLE_INSCRIPTO', lineas: [{ descripcion: 'x', ...lineas[0] }], moneda: 'ARS', tipoCambio: null, preciosConIva: true, fceMontoMinimo: Infinity })
    expect(a.totales.total).toBe(99.99)
    expect(notaRedondeoPreciosConIva('A', true, lineas, a.totales.total)).toContain('99,99')
    expect(notaRedondeoPreciosConIva('A', false, lineas, 121)).toBeNull()
    expect(notaRedondeoPreciosConIva('B', true, lineas, 100)).toBeNull()
  })
})

describe('clave de idempotencia', () => {
  it('UUID v4 que acepta el servidor (con randomUUID o con getRandomValues)', () => {
    expect(nuevaClaveIdempotencia()).toMatch(UUID_REGEX)
    const sinRandomUuid = { getRandomValues: <T extends ArrayBufferView | null>(a: T) => globalThis.crypto.getRandomValues(a as Uint8Array) as unknown as T }
    for (let i = 0; i < 20; i++) expect(nuevaClaveIdempotencia(sinRandomUuid)).toMatch(UUID_REGEX)
    expect(nuevaClaveIdempotencia()).not.toBe(nuevaClaveIdempotencia())
  })
})

const IRREVERSIBLE = crearConfirmacion('EMISION_IRREVERSIBLE', 'irreversible')

function preview(over: Partial<PreviewFacturaDirecta> = {}): PreviewFacturaDirecta {
  return {
    ok: true,
    letra: 'A',
    cbteTipoPrevisto: 1,
    esFce: false,
    receptor: { docTipo: 80, docNro: '30712345671', condicionIvaId: 1 },
    totales: { neto: 100, iva: 21, total: 121, totalArs: 121 },
    preciosConIva: false,
    condicionPago: 'Contado',
    fechaFactura: '2026-10-05',
    fechaVto: '2026-10-12',
    errores: [],
    avisos: [],
    confirmacionesRequeridas: [IRREVERSIBLE],
    padron: null,
    ml: null,
    cliente: null,
    tipoCambioReferencia: null,
    ...over,
  }
}

describe('vista previa y emitir', () => {
  const firma = 'F'
  const DUPLICADA = crearConfirmacion('POSIBLE_DUPLICADO', 'duplicada')
  const vista: VistaPreviaVigente = { data: preview(), firma, clave: 'k' }

  it('emitir: vista previa vigente, ok, con clave y todo confirmado', () => {
    const t = [IRREVERSIBLE.firma]
    expect(puedeEmitirFacturaDirecta(null, firma, []).puede).toBe(false)
    expect(puedeEmitirFacturaDirecta(vista, 'otra', t).motivo).toMatch(/desactualizada/)
    expect(puedeEmitirFacturaDirecta(vista, firma, []).puede).toBe(false)
    expect(puedeEmitirFacturaDirecta(vista, firma, ['EMISION_IRREVERSIBLE']).puede).toBe(false) // el código solo no alcanza
    expect(puedeEmitirFacturaDirecta(vista, firma, t)).toEqual({ puede: true, motivo: null })
    expect(puedeEmitirFacturaDirecta({ ...vista, clave: null }, firma, t).puede).toBe(false)
    expect(puedeEmitirFacturaDirecta({ ...vista, data: preview({ ok: false }) }, firma, t).puede).toBe(false)
  })

  it('409 CONFIRMACION_REQUERIDA: se piden las nuevas y la clave se conserva', () => {
    const r = clasificarRespuestaEmision({
      status: 409,
      body: {
        error: 'Falta confirmar',
        codigo: 'CONFIRMACION_REQUERIDA',
        confirmacionesRequeridas: [IRREVERSIBLE, DUPLICADA],
        faltantes: ['POSIBLE_DUPLICADO'],
      },
    })
    expect(r.tipo).toBe('confirmar')
    expect(claveTrasResultado(r)).toBe('conservar')
    if (r.tipo !== 'confirmar') throw new Error()
    const nueva = aplicarConfirmacionesRequeridas(vista, r.requeridas)
    expect(nueva.clave).toBe('k')
    expect(puedeEmitirFacturaDirecta(nueva, firma, [IRREVERSIBLE.firma]).puede).toBe(false)
    expect(puedeEmitirFacturaDirecta(nueva, firma, [IRREVERSIBLE.firma, DUPLICADA.firma]).puede).toBe(true)
  })
})

describe('clasificación de la respuesta de la emisión', () => {
  const factura: ResultadoFacturaDirecta = {
    invoiceId: 'inv1',
    invoiceNumber: 'A-0007-00000012',
    cae: '76123456789012',
    caeVencimiento: '2026-10-15T00:00:00.000Z',
    total: 121,
    currency: 'ARS',
    pdfUrl: '/api/facturas/inv1/pdf',
    colppy: { estado: 'OK' },
    ml: null,
    repetida: false,
  }

  it('201 y 200 (repetida): emitida, la clave se descarta', () => {
    for (const status of [201, 200]) {
      const r = clasificarRespuestaEmision({ status, body: { ...factura, repetida: status === 200 } })
      expect(r.tipo).toBe('emitida')
      expect(claveTrasResultado(r)).toBe('descartar')
    }
  })

  it('error de red, 5xx sin código y 2xx sin factura: reintentar con la misma clave', () => {
    const casos = [
      clasificarRespuestaEmision({ errorRed: 'Failed to fetch' }),
      clasificarRespuestaEmision({ status: 504, body: null }),
      clasificarRespuestaEmision({ status: 500, body: { error: 'boom' } }),
      clasificarRespuestaEmision({ status: 201, body: {} }),
    ]
    for (const r of casos) {
      expect(r.tipo).toBe('reintentar')
      expect(claveTrasResultado(r)).toBe('conservar')
    }
  })

  it('ARCA_NO_SOLICITADA, EN_CURSO y ML_NO_DISPONIBLE: reintentar con la misma clave', () => {
    for (const [status, codigo] of [
      [502, 'ARCA_NO_SOLICITADA'],
      [409, 'EN_CURSO'],
      [502, 'ML_NO_DISPONIBLE'],
    ] as const) {
      const r = clasificarRespuestaEmision({ status, body: { error: 'x', codigo } })
      expect(r).toMatchObject({ tipo: 'reintentar', codigo })
      expect(claveTrasResultado(r)).toBe('conservar')
    }
  })

  it('ARCA_INCIERTO (502 o 409): bloqueante con el número, NO se reintenta', () => {
    const r = clasificarRespuestaEmision({
      status: 502,
      body: { error: 'ARCA no confirmó', codigo: 'ARCA_INCIERTO', cbteTipo: 1, puntoVenta: 7, numero: 123, facturaDirectaId: 'fd1' },
    })
    expect(r).toEqual({
      tipo: 'bloqueada',
      bloqueo: { tipo: 'INCIERTA', mensaje: 'ARCA no confirmó', numero: '0007-00000123', cae: null, facturaDirectaId: 'fd1' },
    })
    expect(claveTrasResultado(r)).toBe('descartar')
    const r409 = clasificarRespuestaEmision({ status: 409, body: { error: 'ya incierta', codigo: 'ARCA_INCIERTO', facturaDirectaId: 'fd1' } })
    expect(r409).toMatchObject({ tipo: 'bloqueada', bloqueo: { tipo: 'INCIERTA', numero: null } })
    // Número desconocido (null) no se inventa
    const sinNumero = clasificarRespuestaEmision({ status: 502, body: { error: 'x', codigo: 'ARCA_INCIERTO', puntoVenta: 7, numero: null } })
    expect(sinNumero).toMatchObject({ bloqueo: { numero: null } })
  })

  it('ERP_HUERFANA (500 o 409): bloqueante con número y CAE', () => {
    const r = clasificarRespuestaEmision({ status: 500, body: { error: 'NO reintentes', codigo: 'ERP_HUERFANA', cae: '761', numero: '0007-00000123', cbteTipo: 1, facturaDirectaId: 'fd2' } })
    expect(r).toEqual({ tipo: 'bloqueada', bloqueo: { tipo: 'HUERFANA', mensaje: 'NO reintentes', numero: '0007-00000123', cae: '761', facturaDirectaId: 'fd2' } })
    expect(clasificarRespuestaEmision({ status: 409, body: { error: 'x', codigo: 'ERP_HUERFANA', cae: '761', numero: null } })).toMatchObject({
      tipo: 'bloqueada',
      bloqueo: { tipo: 'HUERFANA', cae: '761' },
    })
  })

  it('422 de validación y ARCA_RECHAZO: corregir, la clave se regenera', () => {
    const v = clasificarRespuestaEmision({
      status: 422,
      body: { error: 'Línea 2: falta la descripción', codigo: 'DESCRIPCION_INVALIDA', errores: [{ codigo: 'DESCRIPCION_INVALIDA', mensaje: 'Línea 2: falta la descripción', linea: 2 }] },
    })
    expect(v).toMatchObject({ tipo: 'error', problemas: [{ codigo: 'DESCRIPCION_INVALIDA', linea: 2 }] })
    expect(claveTrasResultado(v)).toBe('regenerar')
    const arca = clasificarRespuestaEmision({
      status: 422,
      body: { error: 'ARCA indica que el cliente está obligado a FCE MiPyME: marcalo y volvé a emitir', codigo: 'ARCA_RECHAZO', errores: [{ Code: 10192, Msg: 'obligado' }], detalle: 'x' },
    })
    expect(arca.tipo).toBe('error')
    if (arca.tipo !== 'error') throw new Error()
    expect(arca.titulo).toMatch(/ARCA rechazó/)
    expect(arca.problemas.map((p) => p.codigo)).toEqual(['ARCA_RECHAZO', 'ARCA 10192'])
    expect(claveTrasResultado(arca)).toBe('regenerar')
  })

  it('400 (errores de texto), 404, EMISION_PENDIENTE (refresca el banner), 401/403 y 503', () => {
    expect(clasificarRespuestaEmision({ status: 400, body: { error: 'x', codigo: 'PEDIDO_INVALIDO', errores: ['moneda inválida'] } })).toMatchObject({
      tipo: 'error',
      problemas: [{ codigo: 'PEDIDO_INVALIDO', mensaje: 'moneda inválida' }],
    })
    expect(clasificarRespuestaEmision({ status: 404, body: { error: 'El cliente no existe', codigo: 'CLIENTE_NO_EXISTE' } })).toMatchObject({
      tipo: 'error',
      problemas: [{ codigo: 'CLIENTE_NO_EXISTE', mensaje: 'El cliente no existe' }],
    })
    expect(clasificarRespuestaEmision({ status: 409, body: { error: 'otra pendiente', codigo: 'EMISION_PENDIENTE' } })).toMatchObject({ tipo: 'error', refrescarPendientes: true })
    expect(clasificarRespuestaEmision({ status: 409, body: { error: 'ya', codigo: 'YA_FACTURADA' } })).toMatchObject({ tipo: 'error', refrescarPendientes: false })
    expect(clasificarRespuestaEmision({ status: 403, body: { error: 'Sin permisos' } })).toMatchObject({ tipo: 'error' })
    expect(clasificarRespuestaEmision({ status: 401, body: { error: 'No autorizado' } })).toMatchObject({ tipo: 'error' })
    expect(clasificarRespuestaEmision({ status: 503, body: { error: 'fuera', codigo: 'FUERA_DE_HORARIO' } })).toMatchObject({ tipo: 'error', problemas: [{ codigo: 'FUERA_DE_HORARIO' }] })
  })

  it('problemasDeError sin lista usa el mensaje', () => {
    expect(problemasDeError({ error: 'x', codigo: 'Y' })).toEqual([{ codigo: 'Y', mensaje: 'x' }])
    expect(problemasDeError(null, 500)).toEqual([{ codigo: 'ERROR', mensaje: 'Error 500' }])
  })

  it('avisos del éxito: Colppy pendiente o con error, FCE en borrador y ML sin subir', () => {
    expect(avisosResultadoEmision(factura)).toHaveLength(1)
    expect(avisosResultadoEmision({ ...factura, repetida: true })[0].titulo).toMatch(/ya se había emitido/)
    const err = avisosResultadoEmision({ ...factura, colppy: { estado: 'ERROR', error: 'Colppy caído' }, ml: { packId: '2000001', uploadOk: false, error: '403' } })
    expect(err.map((a) => a.nivel)).toEqual(['success', 'warning', 'warning'])
    expect(err[1].descripcion).toBe('Colppy caído')
    expect(err[2].descripcion).toContain('403')
    expect(avisosResultadoEmision({ ...factura, colppy: { estado: 'BORRADOR_FCE' } })[1].titulo).toMatch(/BORRADOR/)
    expect(avisosResultadoEmision({ ...factura, colppy: { estado: 'NO_APLICA' } })).toHaveLength(1)
    expect(avisosResultadoEmision({ ...factura, colppy: { estado: 'PENDIENTE' } })[1].nivel).toBe('info')
    expect(avisosResultadoEmision({ ...factura, ml: { packId: '1', uploadOk: true } })).toHaveLength(1)
  })

  it('repetida con ML sin subir y sin error: la subida puede estar en curso (info, no "no se pudo subir")', () => {
    const enCurso = avisosResultadoEmision({ ...factura, repetida: true, ml: { packId: '1', uploadOk: false } })
    expect(enCurso.map((a) => a.nivel)).toEqual(['success', 'info'])
    expect(enCurso[1].titulo).toMatch(/puede estar en curso/)
    // Con error, o en la primera respuesta, sí es un fallo
    expect(avisosResultadoEmision({ ...factura, repetida: true, ml: { packId: '1', uploadOk: false, error: '403' } })[1].nivel).toBe('warning')
    expect(avisosResultadoEmision({ ...factura, ml: { packId: '1', uploadOk: false } })[1].titulo).toMatch(/no se pudo subir/)
  })

  it('detalle: "Reintentar subida a ML" solo si falló o si pasó un rato sin resultado', () => {
    const ahora = new Date('2026-10-05T15:00:00Z')
    const hace = (ms: number) => new Date(ahora.getTime() - ms).toISOString()
    expect(estadoSubidaMl({ mlUploadStatus: 'OK', updatedAt: hace(10 * 60_000) }, ahora)).toEqual({ estado: 'ok', puedeReintentar: false })
    expect(estadoSubidaMl({ mlUploadStatus: 'ERROR', updatedAt: hace(1000) }, ahora)).toEqual({ estado: 'error', puedeReintentar: true })
    expect(estadoSubidaMl({ mlUploadStatus: null, updatedAt: hace(30_000) }, ahora)).toEqual({ estado: 'en-curso', puedeReintentar: false })
    expect(estadoSubidaMl({ mlUploadStatus: null, updatedAt: hace(SUBIDA_ML_EN_CURSO_MS + 1000) }, ahora)).toEqual({ estado: 'sin-subir', puedeReintentar: true })
    expect(estadoSubidaMl({ mlUploadStatus: null }, ahora).puedeReintentar).toBe(true)
  })
})

describe('estado de la pantalla después de emitir', () => {
  const firma = 'F'
  const vista: VistaPreviaVigente = { data: preview(), firma, clave: 'k1' }
  const base = { ...ESTADO_EMISION_INICIAL, vista, tildadas: [IRREVERSIBLE.firma] }
  const cuerpo = cuerpoEmisionFacturaDirecta(armarPedidoFacturaDirecta(RI, form()), 'k1', vista.data.confirmacionesRequeridas, base.tildadas)

  it('una edición invalida la vista previa y su clave', () => {
    const v = invalidarVistaPrevia(vista)!
    expect(v.clave).toBeNull()
    expect(puedeEmitirFacturaDirecta(v, firma, base.tildadas).puede).toBe(false)
    expect(invalidarVistaPrevia(null)).toBeNull()
  })

  it('error de red: guarda el mismo cuerpo (misma clave) para reintentar', () => {
    const e = estadoTrasEmision(base, clasificarRespuestaEmision({ errorRed: 'Failed to fetch' }), cuerpo)
    expect(e.reintento!.cuerpo.idempotencyKey).toBe('k1')
    expect(e.reintento!.cuerpo).toBe(cuerpo)
    expect(e.vista!.clave).toBe('k1')
    expect(e.frenada).toBe(false)
  })

  it('bloqueante: diálogo, pantalla frenada y sin clave', () => {
    const e = estadoTrasEmision(
      { ...base, reintento: { titulo: 't', mensaje: 'm', cuerpo } },
      clasificarRespuestaEmision({ status: 502, body: { error: 'x', codigo: 'ARCA_INCIERTO', puntoVenta: 7, numero: 5 } }),
      cuerpo
    )
    expect(e.bloqueo!.numero).toBe('0007-00000005')
    expect(e.frenada).toBe(true)
    expect(e.reintento).toBeNull()
    expect(puedeEmitirFacturaDirecta(e.vista, firma, base.tildadas).puede).toBe(false)
  })

  it('422: muestra el error y obliga a otra vista previa (otra clave)', () => {
    const e = estadoTrasEmision(base, clasificarRespuestaEmision({ status: 422, body: { error: 'x', codigo: 'PRECIO_INVALIDO' } }), cuerpo)
    expect(e.error!.problemas[0].codigo).toBe('PRECIO_INVALIDO')
    expect(e.vista!.clave).toBeNull()
    expect(e.tildadas).toEqual([])
    expect(puedeEmitirFacturaDirecta(e.vista, firma, []).motivo).toMatch(/desactualizada/)
  })

  it('confirmación nueva: misma clave; se destilda la faltante y lo que cambió de texto, queda lo que sigue igual', () => {
    const dupVieja = crearConfirmacion('POSIBLE_DUPLICADO', 'dup vieja')
    const tcVieja = crearConfirmacion('TIPO_CAMBIO_ALEJADO', 'tc 1450')
    const e = estadoTrasEmision(
      { ...base, tildadas: [IRREVERSIBLE.firma, dupVieja.firma, tcVieja.firma] },
      clasificarRespuestaEmision({
        status: 409,
        body: {
          error: 'Falta confirmar',
          codigo: 'CONFIRMACION_REQUERIDA',
          confirmacionesRequeridas: [IRREVERSIBLE, crearConfirmacion('POSIBLE_DUPLICADO', 'dup nueva'), crearConfirmacion('TIPO_CAMBIO_ALEJADO', 'tc 1400')],
          faltantes: ['POSIBLE_DUPLICADO', 'TIPO_CAMBIO_ALEJADO'],
        },
      }),
      cuerpo
    )
    expect(e.vista!.clave).toBe('k1')
    expect(e.tildadas).toEqual([IRREVERSIBLE.firma])
    expect(e.vista!.data.confirmacionesRequeridas.map((c) => c.mensaje)).toEqual(['irreversible', 'dup nueva', 'tc 1400'])
  })

  it('aplica la política de la clave de claveTrasResultado en todos los casos', () => {
    const casos = [
      clasificarRespuestaEmision({ status: 201, body: { invoiceId: 'i', cae: '1', invoiceNumber: 'A-1', total: 1, currency: 'ARS', colppy: { estado: 'OK' }, ml: null, repetida: false } }),
      clasificarRespuestaEmision({ status: 500, body: { error: 'x', codigo: 'ERP_HUERFANA', cae: '1' } }),
      clasificarRespuestaEmision({ status: 502, body: { error: 'x', codigo: 'ARCA_NO_SOLICITADA' } }),
      clasificarRespuestaEmision({ status: 409, body: { error: 'x', codigo: 'CONFIRMACION_REQUERIDA', confirmacionesRequeridas: [], faltantes: [] } }),
      clasificarRespuestaEmision({ status: 422, body: { error: 'x', codigo: 'TOTAL_INVALIDO' } }),
    ]
    for (const r of casos) {
      const e = estadoTrasEmision(base, r, cuerpo)
      const politica = claveTrasResultado(r)
      if (politica === 'conservar') {
        expect(e.vista!.clave).toBe('k1')
        expect(e.vista!.firma).toBe(firma)
      } else if (politica === 'regenerar') {
        expect(e.vista!.clave).toBeNull()
        expect(e.vista!.firma).not.toBe(firma)
      } else {
        expect(e.vista!.clave).toBeNull()
      }
    }
  })

  it('emitida: la clave no se vuelve a usar', () => {
    const e = estadoTrasEmision(base, { tipo: 'emitida', factura: {} as ResultadoFacturaDirecta }, cuerpo)
    expect(e.vista!.clave).toBeNull()
    expect(e.frenada).toBe(false)
  })
})

describe('productos', () => {
  it('solo IVA 21% (null cuenta como 21, como el servidor; Decimal llega como texto)', () => {
    expect(ivaProductoSoportado(null)).toBe(true)
    expect(ivaProductoSoportado('21')).toBe(true)
    expect(ivaProductoSoportado('21.00')).toBe(true)
    expect(ivaProductoSoportado('10.5')).toBe(false)
    const ok = lineaConProducto(lineaVacia('a'), { id: 'p1', sku: 'GEN-1', name: 'Válvula  esférica', taxRate: '21' })
    expect(ok.linea).toMatchObject({ productId: 'p1', sku: 'GEN-1', descripcion: 'Válvula esférica' })
    const no = lineaConProducto(lineaVacia('a'), { id: 'p2', sku: 'X', name: 'y', taxRate: '10.5' })
    expect(no.linea).toBeNull()
    expect(no.error).toMatch(/10.5%/)
  })

  it('precio de venta sugerido: SALE vigente en la moneda, el más nuevo; con precios finales suma el 21%', () => {
    const ahora = new Date('2026-10-05T12:00:00Z')
    const precios = [
      { priceType: 'SALE', currency: 'ARS', amount: '1000', validFrom: '2026-01-01T00:00:00Z', validUntil: null },
      { priceType: 'SALE', currency: 'ARS', amount: '1200', validFrom: '2026-09-01T00:00:00Z', validUntil: null },
      { priceType: 'SALE', currency: 'ARS', amount: '5000', validFrom: '2026-11-01T00:00:00Z', validUntil: null },
      { priceType: 'SALE', currency: 'ARS', amount: '9000', validFrom: '2026-01-01T00:00:00Z', validUntil: '2026-02-01T00:00:00Z' },
      { priceType: 'COST', currency: 'ARS', amount: '10', validFrom: '2026-10-01T00:00:00Z', validUntil: null },
      { priceType: 'SALE', currency: 'USD', amount: '7.5', validFrom: '2026-10-01T00:00:00Z', validUntil: null },
    ]
    expect(precioVentaSugerido(precios, 'ARS', false, ahora)).toEqual({ neto: 1200, precio: 1200 })
    expect(precioVentaSugerido(precios, 'ARS', true, ahora)).toEqual({ neto: 1200, precio: 1452 })
    expect(precioVentaSugerido(precios, 'USD', false, ahora)).toEqual({ neto: 7.5, precio: 7.5 })
    expect(precioVentaSugerido([], 'ARS', false, ahora)).toBeNull()
    expect(precioVentaSugerido(undefined, 'ARS', false, ahora)).toBeNull()
  })
})

describe('venta de Mercado Libre', () => {
  it('precarga las líneas (precios finales) como texto que parseNumeroAr entiende', () => {
    const lineas = lineasDesdeVentaMl(
      {
        lineas: [
          { productId: 'p1', sku: 'S1', descripcion: 'Reductora  de presión', cantidad: 2, precioUnitario: 15999.9 },
          { productId: null, sku: null, descripcion: 'Otro', cantidad: 1, precioUnitario: 1500 },
        ],
      },
      uid
    )
    expect(lineas).toHaveLength(2)
    expect(lineas[0]).toMatchObject({ productId: 'p1', sku: 'S1', descripcion: 'Reductora de presión', cantidad: '2', precio: '15999,9' })
    expect(parseNumeroAr(lineas[1].precio)).toBe(1500)
    expect(new Set(lineas.map((l) => l.uid)).size).toBe(2)
  })

  it('bloqueos: ya facturada y órdenes sin pagar', () => {
    expect(bloqueosVentaMl({ packId: '1', pagada: true, noPagas: [], yaFacturada: null })).toEqual([])
    const b = bloqueosVentaMl({ packId: '1', pagada: false, noPagas: [{ orderId: '9', status: 'cancelled' }], yaFacturada: { invoiceId: 'i', invoiceNumber: 'B-0007-00000001', status: 'EMITIDA' } })
    expect(b).toHaveLength(2)
    expect(b[0]).toContain('B-0007-00000001')
    expect(b[1]).toContain('9 (cancelled)')
  })
})

describe('alta de cliente desde ARCA', () => {
  it('prellena desde la constancia; sin condición IVA hay que elegirla', () => {
    const f = altaClienteDesdeArca('30-71234567-1', { name: 'ACME SA', type: 'BUSINESS', taxCondition: 'RESPONSABLE_INSCRIPTO', address: 'Calle 1', city: 'CABA', province: 'Buenos Aires' })
    expect(f).toMatchObject({ cuit: '30712345671', name: 'ACME SA', taxCondition: 'RESPONSABLE_INSCRIPTO', city: 'CABA' })
    expect(altaClienteDesdeArca('20123456786', { name: 'Juan', type: 'INDIVIDUAL' }).taxCondition).toBe('')
    expect(validarAltaCliente(altaClienteDesdeArca('20123456786', { name: 'Juan' }), esCuitValido)).toContain('Elegí la condición frente al IVA')
  })

  it('valida y arma el cuerpo de POST /api/clientes', () => {
    const f = { ...altaClienteDesdeArca('20123456786', { name: 'Juan Pérez', type: 'INDIVIDUAL' }), taxCondition: 'CONSUMIDOR_FINAL', paymentTerms: '30', email: '' }
    expect(validarAltaCliente(f, esCuitValido)).toEqual([])
    expect(validarAltaCliente({ ...f, cuit: '20123456787' }, esCuitValido)).toContain('El CUIT no es válido')
    expect(validarAltaCliente({ ...f, email: 'mal' }, esCuitValido)).toContain('El email no es válido')
    const body = cuerpoAltaCliente(f)
    expect(body).toMatchObject({ name: 'Juan Pérez', type: 'INDIVIDUAL', cuit: '20123456786', taxCondition: 'CONSUMIDOR_FINAL', country: 'Argentina', status: 'ACTIVE', paymentTerms: 30 })
    expect(body.email).toBeUndefined()
  })

  it('alta duplicada: 400 "Ya existe..." o 409', () => {
    expect(altaClienteDuplicada(400, 'Ya existe un cliente con este CUIT: ACME')).toBe(true)
    expect(altaClienteDuplicada(409, null)).toBe(true)
    expect(altaClienteDuplicada(400, 'Datos inválidos')).toBe(false)
  })
})

describe('tipo de cambio', () => {
  it('lee rates[0] USD→ARS con su fecha', () => {
    expect(tipoCambioDesdeApi({ rates: [{ fromCurrency: 'USD', toCurrency: 'ARS', rate: '1450.5', validFrom: '2026-10-03T03:00:00.000Z' }] })).toEqual({ rate: 1450.5, fecha: '2026-10-03' })
    expect(tipoCambioDesdeApi({ rates: [{ fromCurrency: 'EUR', toCurrency: 'ARS', rate: 1 }] })).toBeNull()
    expect(tipoCambioDesdeApi({ error: 'x' })).toBeNull()
  })
})

describe('detalle de la factura: Colppy', () => {
  const ahora = new Date('2026-10-05T15:00:00Z')
  const base = { emitidaPor: 'ARCA', colppyId: null, colppySyncStatus: 'PENDIENTE', updatedAt: ahora.toISOString() }

  it('el vencimiento de REGISTRANDO es el del servidor', () => {
    expect(REGISTRANDO_COLPPY_VENCE_MS).toBe(REGISTRANDO_VENCE_MS)
  })

  it('reintentar: PENDIENTE/ERROR, REGISTRANDO trabado; nunca NO_APLICA, OK, borrador o manual', () => {
    expect(puedeReintentarColppy(base, ahora)).toBe(true)
    expect(puedeReintentarColppy({ ...base, colppySyncStatus: 'ERROR' }, ahora)).toBe(true)
    expect(puedeReintentarColppy({ ...base, colppySyncStatus: 'NO_APLICA' }, ahora)).toBe(false)
    expect(puedeReintentarColppy({ ...base, colppySyncStatus: 'REGISTRANDO' }, ahora)).toBe(false)
    expect(puedeReintentarColppy({ ...base, colppySyncStatus: 'REGISTRANDO', updatedAt: new Date(ahora.getTime() - 16 * 60_000).toISOString() }, ahora)).toBe(true)
    for (const s of ['OK', 'BORRADOR_FCE', 'MANUAL']) expect(puedeReintentarColppy({ ...base, colppySyncStatus: s }, ahora)).toBe(false)
    expect(puedeReintentarColppy({ ...base, colppyId: '123' }, ahora)).toBe(false)
    expect(puedeReintentarColppy({ ...base, emitidaPor: null }, ahora)).toBe(false)
    expect(puedeReintentarColppy({ ...base, colppySyncStatus: null }, ahora)).toBe(false)
  })

  it('la NC espera el registro en Colppy (misma regla que nota-credito-arca.ts)', () => {
    expect(ncRequiereRegistroColppy({ tieneColppyPayload: false, colppySyncStatus: 'PENDIENTE' })).toBe(true)
    expect(ncRequiereRegistroColppy({ tieneColppyPayload: false, colppySyncStatus: 'REGISTRANDO' })).toBe(true)
    expect(ncRequiereRegistroColppy({ tieneColppyPayload: true, colppySyncStatus: 'ERROR' })).toBe(false)
    expect(ncRequiereRegistroColppy({ tieneColppyPayload: false, colppySyncStatus: 'NO_APLICA' })).toBe(false)
    expect(ncRequiereRegistroColppy({ tieneColppyPayload: false, colppySyncStatus: 'OK' })).toBe(false)
  })

  it('etiquetas de los comprobantes asociados', () => {
    expect(etiquetaColppyAsociado('OK')).toBeNull()
    expect(etiquetaColppyAsociado(null)).toBeNull()
    expect(etiquetaColppyAsociado('BORRADOR_FCE')).toBe('Borrador FCE en Colppy')
    expect(etiquetaColppyAsociado('NO_APLICA')).toBe('No se registra en Colppy')
    expect(etiquetaColppyAsociado('PENDIENTE')).toBe('Pendiente Colppy')
  })

  it('etiqueta del comprobante', () => {
    expect(etiquetaComprobante('A', true)).toBe('FCE MiPyME A')
    expect(etiquetaComprobante('B', true)).toBe('Factura B')
    expect(etiquetaComprobante(null)).toBe('Factura')
  })
})
