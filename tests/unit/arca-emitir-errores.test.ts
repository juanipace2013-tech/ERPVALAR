import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * emitirComprobante: qué tipo de error lanza según DÓNDE falló, para que quien
 * llama sepa si puede reintentar (candado de ventas ML, cotizaciones, NC):
 *  - antes de pedir el CAE → EmisionNoSolicitadaError (no se emitió nada)
 *  - rechazo de ARCA CON códigos (Resultado R con observaciones, o ArcaError
 *    con errors) → { ok: false }
 *  - después de pedirlo, sin respuesta utilizable (Fault SOAP, HTTP 5xx / HTML,
 *    sobre sin resultado, corte de red, aprobado sin CAE) y sin poder
 *    recuperarlo con FECompConsultar → EmisionInciertaError con el número
 *    pedido (ARCA pudo haberlo autorizado)
 * WSFE falso: nunca sale a la red. Algunos casos usan el feCAESolicitar REAL
 * con el transporte HTTP (postSoap) y el ticket de WSAA falsos, para probar
 * cómo llegan una respuesta 504 en HTML o un Fault.
 */

const wsfe = vi.hoisted(() => ({
  feCompUltimoAutorizado: vi.fn(),
  feCAESolicitar: vi.fn(),
  feCompConsultar: vi.fn(),
}))
/** Los originales de wsfe.ts (para los casos que pasan por el transporte falso) */
const real = vi.hoisted(() => ({}) as { feCAESolicitar?: (typeof import('@/lib/arca/wsfe'))['feCAESolicitar']; feCompConsultar?: (typeof import('@/lib/arca/wsfe'))['feCompConsultar'] })
const http = vi.hoisted(() => ({ postSoap: vi.fn() }))

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/arca/config', () => ({
  isArcaConfigured: () => true,
  getArcaConfig: () => ({ cuit: '30711111118', env: 'homo', puntoVenta: 7, fceMontoMinimo: 1e12, cbu: null, wsfeUrl: 'https://wsfe.invalid/service.asmx' }),
}))
vi.mock('@/lib/arca/http', () => http)
vi.mock('@/lib/arca/wsaa', () => ({ getTicketAcceso: vi.fn(async () => ({ token: 'T', sign: 'S' })) }))
vi.mock('@/lib/arca/wsfe', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/arca/wsfe')>()
  real.feCAESolicitar = orig.feCAESolicitar
  real.feCompConsultar = orig.feCompConsultar
  return { ...orig, ...wsfe }
})

import { EmisionInciertaError, EmisionNoSolicitadaError, emitirComprobante, mensajeEmisionIncierta, type ComprobanteInput } from '@/lib/arca/emitir'
import { ArcaError } from '@/lib/arca/wsfe'

const facturaB: ComprobanteInput = {
  clase: 'FACTURA',
  letra: 'B',
  fecha: new Date('2026-10-05T12:00:00Z'),
  receptor: { condicionIvaId: 5, docTipo: 96, docNro: '12345678' },
  moneda: 'ARS',
  importes: {
    netoGravado: 82.64,
    netoNoGravado: 0,
    exento: 0,
    iva: [{ alicuota: '21', baseImponible: 82.64, importe: 17.36 }],
    total: 100,
  },
}

/** Respuesta SOAP de FECAESolicitar (como la manda ARCA) */
function respuestaFecae(det: string, cab = '<Resultado>R</Resultado>') {
  return (
    '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
    '<FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECAESolicitarResult>' +
    `<FeCabResp><Cuit>30711111118</Cuit><PtoVta>7</PtoVta><CbteTipo>6</CbteTipo>${cab}</FeCabResp>` +
    `<FeDetResp><FECAEDetResponse>${det}</FECAEDetResponse></FeDetResp>` +
    '</FECAESolicitarResult></FECAESolicitarResponse></soap:Body></soap:Envelope>'
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  wsfe.feCompUltimoAutorizado.mockResolvedValue(12)
})

describe('emitirComprobante: errores', () => {
  it('falla FECompUltimoAutorizado (ARCA / WSAA caído): EmisionNoSolicitadaError, sin pedir el CAE', async () => {
    wsfe.feCompUltimoAutorizado.mockRejectedValue(new Error('WSAA: connect ETIMEDOUT'))
    const e = await emitirComprobante(facturaB).catch((x) => x)
    expect(e).toBeInstanceOf(EmisionNoSolicitadaError)
    expect(e).toMatchObject({ message: 'WSAA: connect ETIMEDOUT', cbteTipo: 6, puntoVenta: 7 })
    expect(wsfe.feCAESolicitar).not.toHaveBeenCalled()
  })

  it('importes inconsistentes (buildDetalle): EmisionNoSolicitadaError', async () => {
    const mal = { ...facturaB, importes: { ...facturaB.importes, total: 120 } }
    const e = await emitirComprobante(mal).catch((x) => x)
    expect(e).toBeInstanceOf(EmisionNoSolicitadaError)
    expect(e.message).toMatch(/Importes inconsistentes/)
    expect(wsfe.feCAESolicitar).not.toHaveBeenCalled()
  })

  it('corte de red al pedir el CAE y FECompConsultar no lo confirma: EmisionInciertaError con el número pedido', async () => {
    wsfe.feCAESolicitar.mockRejectedValue(new Error('socket hang up'))
    wsfe.feCompConsultar.mockRejectedValue(new Error('timeout'))
    const e = await emitirComprobante(facturaB).catch((x) => x)
    expect(e).toBeInstanceOf(EmisionInciertaError)
    expect(e).toMatchObject({ message: 'socket hang up', cbteTipo: 6, puntoVenta: 7, numero: 13 })
    expect(wsfe.feCompConsultar).toHaveBeenCalledWith(6, 13, 7)
  })

  it('corte de red pero ARCA lo había autorizado: se recupera el CAE (sin cambios)', async () => {
    wsfe.feCAESolicitar.mockRejectedValue(new Error('socket hang up'))
    wsfe.feCompConsultar.mockResolvedValue({ Resultado: 'A', CodAutorizacion: '76000000000013', FchVto: '20261015', CbteFch: '20261005', ImpTotal: 100, DocNro: '12345678' })
    const r = await emitirComprobante(facturaB)
    expect(r).toMatchObject({ ok: true, numero: 13, cae: '76000000000013', recuperado: true })
  })

  it('ArcaError CON códigos de ARCA (sin detalle, Errors a nivel raíz): rechazo { ok: false }', async () => {
    wsfe.feCAESolicitar.mockRejectedValue(new ArcaError('FECAESolicitar sin detalle de respuesta: 600 x', [{ Code: 600, Msg: 'x' }]))
    wsfe.feCompConsultar.mockResolvedValue(null)
    const r = await emitirComprobante(facturaB)
    expect(r).toMatchObject({ ok: false, numero: 13, errores: [{ Code: 600, Msg: 'x' }] })
  })

  it('ARCA error 10015 (ArcaError con el código): rechazo { ok: false }', async () => {
    wsfe.feCAESolicitar.mockRejectedValue(new ArcaError('FECAESolicitar sin detalle de respuesta: 10015 doc', [{ Code: 10015, Msg: 'doc' }]))
    wsfe.feCompConsultar.mockResolvedValue(null)
    expect(await emitirComprobante(facturaB)).toMatchObject({ ok: false, cbteTipo: 6, numero: 13, errores: [{ Code: 10015 }] })
  })

  it('ArcaError SIN códigos (Fault / respuesta inesperada) y FECompConsultar no lo encuentra: EmisionInciertaError, no rechazo', async () => {
    wsfe.feCAESolicitar.mockRejectedValue(new ArcaError('WSFE FECAESolicitar fault: Server was unable to process request'))
    wsfe.feCompConsultar.mockResolvedValue(null)
    const e = await emitirComprobante(facturaB).catch((x) => x)
    expect(e).toBeInstanceOf(EmisionInciertaError)
    expect(e).toMatchObject({ cbteTipo: 6, puntoVenta: 7, numero: 13, message: 'WSFE FECAESolicitar fault: Server was unable to process request' })
  })

  it('ArcaError SIN códigos pero ARCA lo había autorizado: se recupera el CAE', async () => {
    wsfe.feCAESolicitar.mockRejectedValue(new ArcaError('WSFE FECAESolicitar: respuesta inesperada (HTTP 502)'))
    wsfe.feCompConsultar.mockResolvedValue({ Resultado: 'A', CodAutorizacion: '76000000000013', FchVto: '20261015', CbteFch: '20261005', ImpTotal: 100, DocNro: '12345678' })
    expect(await emitirComprobante(facturaB)).toMatchObject({ ok: true, numero: 13, recuperado: true })
  })

  it('Resultado R con observaciones (10015): rechazo { ok: false } sin consultar', async () => {
    wsfe.feCAESolicitar.mockResolvedValue({ Resultado: 'R', CbteDesde: 13, CAE: '', CAEFchVto: '', Observaciones: [{ Code: 10015, Msg: 'DocNro no registrado' }], Errors: [], Events: [], raw: null })
    const r = await emitirComprobante(facturaB)
    expect(r).toMatchObject({ ok: false, numero: 13, mensaje: '[10015] DocNro no registrado' })
    expect(wsfe.feCompConsultar).not.toHaveBeenCalled()
  })

  it.each([
    ['aprobado sin CAE', { Resultado: 'A', CAE: '' }],
    ['aprobado sin CAE aunque traiga un código suelto', { Resultado: 'A', CAE: '', Errors: [{ Code: 501, Msg: 'Error interno' }] }],
    ['R sin ningún código', { Resultado: 'R', CAE: '' }],
  ])('%s: no es un rechazo; sin poder confirmarlo → EmisionInciertaError', async (_caso, r) => {
    wsfe.feCAESolicitar.mockResolvedValue({ CbteDesde: 13, CAEFchVto: '', Observaciones: [], Errors: [], Events: [], raw: null, ...r })
    wsfe.feCompConsultar.mockResolvedValue(null)
    const e = await emitirComprobante(facturaB).catch((x) => x)
    expect(e).toBeInstanceOf(EmisionInciertaError)
    expect(e).toMatchObject({ numero: 13 })
    expect(wsfe.feCompConsultar).toHaveBeenCalledWith(6, 13, 7)
  })
})

describe('emitirComprobante: respuestas reales de transporte (feCAESolicitar de verdad, HTTP falso)', () => {
  beforeEach(() => {
    wsfe.feCAESolicitar.mockImplementation((p) => real.feCAESolicitar!(p))
  })

  it('504 en HTML después de FECAESolicitar y la recuperación también falla: EmisionInciertaError (antes: rechazo y se liberaba el candado)', async () => {
    http.postSoap.mockResolvedValue({ status: 504, text: '<html><head><title>504 Gateway Time-out</title></head><body><center><h1>504 Gateway Time-out</h1></center></body></html>' })
    wsfe.feCompConsultar.mockImplementation((t, n, pv) => real.feCompConsultar!(t, n, pv)) // también 504
    const e = await emitirComprobante(facturaB).catch((x) => x)
    expect(e).toBeInstanceOf(EmisionInciertaError)
    expect(e).toMatchObject({ cbteTipo: 6, puntoVenta: 7, numero: 13 })
    expect(e.message).toMatch(/respuesta inesperada \(HTTP 504\)/)
    expect(e.causa).toBeInstanceOf(ArcaError)
    // Se pidió el CAE y se intentó recuperar el número pedido
    expect(http.postSoap).toHaveBeenCalledTimes(2)
    expect(http.postSoap.mock.calls[0][1]).toContain('<ar:FECAESolicitar>')
    expect(http.postSoap.mock.calls[1][1]).toContain('<ar:FECompConsultar>')
    expect(mensajeEmisionIncierta(e)).toBe(
      'ARCA no confirmó el comprobante (Factura B N° 0007-00000013): NO reintentes; revisalo en ARCA antes de volver a emitir'
    )
  })

  it('Fault SOAP: EmisionInciertaError', async () => {
    http.postSoap.mockResolvedValue({
      status: 500,
      text: '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><soap:Fault><faultcode>soap:Server</faultcode><faultstring>Server was unable to process request.</faultstring></soap:Fault></soap:Body></soap:Envelope>',
    })
    wsfe.feCompConsultar.mockRejectedValue(new Error('timeout'))
    const e = await emitirComprobante(facturaB).catch((x) => x)
    expect(e).toBeInstanceOf(EmisionInciertaError)
    expect(e.message).toMatch(/fault: Server was unable to process request/)
  })

  it('ARCA rechaza con la observación 10015 (Resultado R): { ok: false } con el código', async () => {
    http.postSoap.mockResolvedValue({
      status: 200,
      text: respuestaFecae(
        '<Concepto>1</Concepto><DocTipo>96</DocTipo><DocNro>12345678</DocNro><CbteDesde>13</CbteDesde><CbteHasta>13</CbteHasta><CbteFch>20261005</CbteFch><Resultado>R</Resultado>' +
          '<Observaciones><Obs><Code>10015</Code><Msg>Campo DocNro: no se encuentra registrado en los padrones de ARCA</Msg></Obs></Observaciones>'
      ),
    })
    const r = await emitirComprobante(facturaB)
    expect(r).toMatchObject({ ok: false, cbteTipo: 6, numero: 13, errores: [{ Code: 10015 }] })
    expect(r.ok === false && r.mensaje).toMatch(/^\[10015\] Campo DocNro/)
    expect(wsfe.feCompConsultar).not.toHaveBeenCalled()
  })
})

describe('mensajeEmisionIncierta', () => {
  it('con y sin número', () => {
    expect(mensajeEmisionIncierta({ cbteTipo: 3, puntoVenta: 7, numero: 4 })).toBe(
      'ARCA no confirmó el comprobante (Nota de Crédito A N° 0007-00000004): NO reintentes; revisalo en ARCA antes de volver a emitir'
    )
    expect(mensajeEmisionIncierta({ cbteTipo: 1, puntoVenta: 7, numero: null })).toMatch(/^ARCA no confirmó el comprobante \(Factura A N° PV 0007, número desconocido\): NO reintentes/)
  })
})
