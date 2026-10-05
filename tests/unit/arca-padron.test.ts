import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Padrón A5 (consultarPersona): respuestas armadas con la forma de las que
 * devolvió ARCA en prod (lectura, 5/10/2026). SOAP falso: nunca sale a la red.
 *  - "No existe persona con ese Id" → PadronError.noExiste (404).
 *  - Otros 404 (clave inválida, errorConstancia sin datos) → noExiste false.
 *  - Un CUIL puro NO es un error: datosGenerales con tipoClave "CUIL".
 */

const soap = vi.hoisted(() => ({ postSoap: vi.fn() }))

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/arca/config', () => ({ getArcaConfig: () => ({ cuit: '30711111118', env: 'homo' }) }))
vi.mock('@/lib/arca/wsaa', () => ({ getTicketAcceso: vi.fn(async () => ({ token: 'T', sign: 'S' })) }))
vi.mock('@/lib/arca/http', () => ({ postSoap: soap.postSoap }))

import { PadronError, consultarPersona } from '@/lib/arca/padron'

const sobre = (body: string) =>
  `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${body}</soap:Body></soap:Envelope>`
const fault = (msg: string) => sobre(`<soap:Fault><faultcode>soap:Server</faultcode><faultstring>${msg}</faultstring></soap:Fault>`)
const respuesta = (personaReturn: string) =>
  sobre(`<ns2:getPersona_v2Response xmlns:ns2="http://a5.soap.ws.server.puc.sr/"><personaReturn>${personaReturn}</personaReturn></ns2:getPersona_v2Response>`)

const datosGenerales = (extra: string) =>
  `<datosGenerales><apellido>PEREZ</apellido><nombre>JUAN</nombre><estadoClave>ACTIVO</estadoClave><idPersona>20123456786</idPersona>${extra}<domicilioFiscal><direccion>SAN MARTIN 100</direccion><localidad>ROSARIO</localidad><descripcionProvincia>SANTA FE</descripcionProvincia><codPostal>2000</codPostal></domicilioFiscal></datosGenerales>`

async function errorDe(cuit: string): Promise<PadronError> {
  try {
    await consultarPersona(cuit)
  } catch (e) {
    return e as PadronError
  }
  throw new Error('se esperaba un PadronError')
}

beforeEach(() => vi.clearAllMocks())

describe('consultarPersona: errores', () => {
  it('"No existe persona con ese Id": 404 con noExiste', async () => {
    soap.postSoap.mockResolvedValue({ status: 500, text: fault('No existe persona con ese Id') })
    const e = await errorDe('20-12345678-6')
    expect(e).toBeInstanceOf(PadronError)
    expect(e).toMatchObject({ status: 404, noExiste: true, message: 'No existe persona con ese Id' })
  })

  it('clave inválida: sigue siendo 404 para /api/afip/cuit, pero NO es "no existe"', async () => {
    soap.postSoap.mockResolvedValue({ status: 500, text: fault('La clave ingresada es inválida') })
    expect(await errorDe('20123456786')).toMatchObject({ status: 404, noExiste: false })
  })

  it('errorConstancia sin datos generales: 404 con las observaciones, NO es "no existe"', async () => {
    soap.postSoap.mockResolvedValue({ status: 200, text: respuesta('<errorConstancia><error>La clave tiene inconsistencias</error></errorConstancia>') })
    expect(await errorDe('20123456786')).toMatchObject({ status: 404, noExiste: false, message: 'La clave tiene inconsistencias' })
  })

  it('otro fault de ARCA: 502, NO es "no existe"', async () => {
    soap.postSoap.mockResolvedValue({ status: 500, text: fault('Error interno del servicio') })
    expect(await errorDe('20123456786')).toMatchObject({ status: 502, noExiste: false })
  })

  it('CUIT de largo inválido: 400 (sin consultar)', async () => {
    expect(await errorDe('2012345')).toMatchObject({ status: 400, noExiste: false })
    expect(soap.postSoap).not.toHaveBeenCalled()
  })

  it('PadronError sin opciones: noExiste false', () => {
    expect(new PadronError('x', 404).noExiste).toBe(false)
    expect(new PadronError('x', 404, { noExiste: true }).noExiste).toBe(true)
  })
})

describe('consultarPersona: datos', () => {
  it('CUIL puro: no es un error; tipoClave CUIL, persona física activa, sin condición IVA ni observaciones', async () => {
    soap.postSoap.mockResolvedValue({ status: 200, text: respuesta(datosGenerales('<tipoClave>CUIL</tipoClave><tipoPersona>FISICA</tipoPersona>')) })
    const p = await consultarPersona('20-12345678-6')
    expect(p).toMatchObject({
      cuit: '20123456786',
      razonSocial: 'PEREZ JUAN',
      tipoPersona: 'FISICA',
      activo: true,
      tipoClave: 'CUIL',
      condicionIva: null,
      observaciones: [],
      domicilio: { direccion: 'SAN MARTIN 100', localidad: 'ROSARIO', provincia: 'Santa Fe', codigoPostal: '2000' },
    })
  })

  it('CUIT sin impuestos y con errorConstancia: devuelve los datos con las observaciones tal cual', async () => {
    soap.postSoap.mockResolvedValue({
      status: 200,
      text: respuesta(
        `${datosGenerales('<tipoClave>CUIT</tipoClave><tipoPersona>FISICA</tipoPersona>')}<errorConstancia><error>Obs 1</error><error>Obs 2</error></errorConstancia>`
      ),
    })
    const p = await consultarPersona('20123456786')
    expect(p).toMatchObject({ tipoClave: 'CUIT', condicionIva: null, observaciones: ['Obs 1', 'Obs 2'] })
  })

  it('monotributista: datosMonotributo → MONOTRIBUTO', async () => {
    soap.postSoap.mockResolvedValue({
      status: 200,
      text: respuesta(`${datosGenerales('<tipoClave>CUIT</tipoClave><tipoPersona>FISICA</tipoPersona>')}<datosMonotributo><categoriaMonotributo><idCategoria>1</idCategoria></categoriaMonotributo></datosMonotributo>`),
    })
    expect((await consultarPersona('20123456786')).condicionIva).toBe('MONOTRIBUTO')
  })
})
