import { describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import path from 'path'

// Silencia los warn/error del ciclo de emisión (los casos de corte loguean a propósito)
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { ArcaError } from '@/lib/arca/wsfe'
import {
  FEX_CMP_ORDEN,
  FexFaultError,
  buildFexAuthXml,
  buildFexAuthorizeBody,
  buildFexEnvelope,
  buscarCotizacionHaciaAtras,
  fechaDesdeYmd,
  fechaIsoAR,
  fechaYmdAR,
  fmtDecimal,
  parseFexAuthorizeResponse,
  parseFexCtzResult,
  parseFexGetCmpResponse,
  parseFexParamLista,
  parseFexSoapResponse,
  type FexAuthorizeResult,
  type FexCmp,
  type FexCmpConsultado,
} from '@/lib/arca/wsfex'
import {
  ExportacionBloqueadaError,
  ExportacionValidacionError,
  aCentavos,
  buildFexRequest,
  emitirExportacion,
  numeroInternoExportacion,
  validarExportacion,
  vistaPreviaExportacion,
  type ExportacionInput,
  type FexCliente,
  type PersistenciaExportacion,
} from '@/lib/arca/emitir-exportacion'
import { FEX_ACTIVIDAD_PRINCIPAL, esCbteExportacion, receptorExportacion } from '@/lib/arca/fex-params'

/**
 * Factura E por WSFEX: armado del Cmp en el orden del XSD, parseo de las
 * respuestas de ARCA, validaciones de Exporta Simple y el ciclo idempotente
 * de emisión (con cliente ARCA y persistencia falsos: sin red ni DB).
 */

const FIXTURE = fs.readFileSync(path.resolve(__dirname, '../fixtures/fex-chile-exporta-simple.xml'), 'utf8')
const normalizarXml = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><').trim()

/** 5/10/2026 10:00 en Argentina (13:00 UTC) */
const AHORA = new Date('2026-10-05T13:00:00Z')

function facturaChile(over: Partial<ExportacionInput> = {}): ExportacionInput {
  return {
    regimen: 'EXPORTA_SIMPLE',
    puntoVenta: 10,
    receptor: {
      cliente: 'CLAUGER CHILE SPA',
      domicilio: 'Av. Ejemplo 1234, Santiago, Chile',
      dstCmp: 208,
      cuitPais: '55000000034',
      idImpositivo: '76.123.456-7',
    },
    moneda: 'USD',
    cotizacion: 1450.5,
    items: [
      { codigo: '2228 12', descripcion: 'Válvula GENEBRE art. 2228 12', cantidad: 3, precioUnitario: 692.96 },
      { descripcion: 'Flete internacional', cantidad: 1, precioUnitario: 120, manual: true },
    ],
    formaPago: 'Transferencia bancaria',
    incoterm: 'CPT',
    incotermLugar: 'Santiago',
    exportaSimple: { desNumero: '2133ECSI12', fobUSD: 2078.88 },
    ...over,
  }
}

function erroresDe(input: ExportacionInput, ahora = AHORA): string[] {
  try {
    buildFexRequest(input, 1, 1, { ahora })
    return []
  } catch (e) {
    expect(e).toBeInstanceOf(ExportacionValidacionError)
    return (e as ExportacionValidacionError).errores
  }
}

const soap = (inner: string) =>
  `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" ` +
  `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><soap:Body>${inner}</soap:Body></soap:Envelope>`

const authorizeXml = (resultAuth: string, err = '<ErrCode>0</ErrCode><ErrMsg>OK</ErrMsg>', evt = '<EventCode>0</EventCode><EventMsg>Ok</EventMsg>') =>
  soap(
    `<FEXAuthorizeResponse xmlns="http://ar.gov.afip.dif.fexv1/"><FEXAuthorizeResult>${resultAuth}` +
      `<FEXErr>${err}</FEXErr><FEXEvents>${evt}</FEXEvents></FEXAuthorizeResult></FEXAuthorizeResponse>`
  )

// ---------------------------------------------------------------------------
// Serialización
// ---------------------------------------------------------------------------

describe('buildFexAuthorizeBody', () => {
  it('arma el Cmp de Chile (Exporta Simple, CPT + flete) igual al XML de referencia', () => {
    const { cmp } = buildFexRequest(facturaChile(), 1, 1, { ahora: AHORA })
    expect(buildFexAuthorizeBody(cmp)).toBe(normalizarXml(FIXTURE))
  })

  it('respeta el orden del XSD y los nombres explícitos de los hijos de cada lista', () => {
    const cmp: FexCmp = {
      Id: 9,
      Fecha_cbte: '20261005',
      Cbte_Tipo: 21,
      Punto_vta: 10,
      Cbte_nro: 2,
      Tipo_expo: 1,
      Permiso_existente: 'S',
      Permisos: [{ Id_permiso: '26001EC01000123A', Dst_merc: 208 }],
      Dst_cmp: 208,
      Cliente: 'CLIENTE',
      Cuit_pais_cliente: '55000000034',
      Domicilio_cliente: 'Calle 1',
      Id_impositivo: '761234567',
      Moneda_Id: 'DOL',
      Moneda_ctz: 1450.5,
      CanMisMonExt: 'S',
      Obs_comerciales: 'obs comerciales',
      Imp_total: 10,
      Obs: 'obs',
      Cmps_asoc: [{ Cbte_tipo: 19, Cbte_punto_vta: 10, Cbte_nro: 1, Cbte_cuit: '30715373579' }],
      Forma_pago: 'Transferencia',
      Incoterms: 'CPT',
      Incoterms_Ds: 'Santiago',
      Idioma_cbte: 1,
      Items: [{ Pro_codigo: 'A', Pro_ds: 'Item', Pro_qty: 1, Pro_umed: 7, Pro_precio_uni: 10, Pro_bonificacion: 0, Pro_total_item: 10 }],
      Opcionales: [{ Id: '2402', Valor: '10.00' }],
      Fecha_pago: '20261010',
      Actividades: [{ Id: FEX_ACTIVIDAD_PRINCIPAL }],
    }
    const xml = buildFexAuthorizeBody(cmp)
    const posiciones = FEX_CMP_ORDEN.map((k) => xml.indexOf(`<ar:${k}>`))
    expect(posiciones.every((p) => p > 0)).toBe(true)
    expect([...posiciones].sort((a, b) => a - b)).toEqual(posiciones)

    expect(xml).toContain('<ar:Permisos><ar:Permiso><ar:Id_permiso>26001EC01000123A</ar:Id_permiso><ar:Dst_merc>208</ar:Dst_merc></ar:Permiso></ar:Permisos>')
    expect(xml).toContain(
      '<ar:Cmps_asoc><ar:Cmp_asoc><ar:Cbte_tipo>19</ar:Cbte_tipo><ar:Cbte_punto_vta>10</ar:Cbte_punto_vta><ar:Cbte_nro>1</ar:Cbte_nro><ar:Cbte_cuit>30715373579</ar:Cbte_cuit></ar:Cmp_asoc></ar:Cmps_asoc>'
    )
    expect(xml).toContain('<ar:Items><ar:Item><ar:Pro_codigo>A</ar:Pro_codigo>')
    expect(xml).toContain('<ar:Opcionales><ar:Opcional><ar:Id>2402</ar:Id><ar:Valor>10.00</ar:Valor></ar:Opcional></ar:Opcionales>')
    expect(xml).toContain(`<ar:Actividades><ar:Actividad><ar:Id>${FEX_ACTIVIDAD_PRINCIPAL}</ar:Id></ar:Actividad></ar:Actividades>`)
    expect(xml).not.toMatch(/Cmps_aso>|Opcionale>|Actividade>|Item>s/)
  })

  it('omite los opcionales vacíos y manda Cuit_pais_cliente 0 (obligatorio en el XSD) si falta', () => {
    const { cmp } = buildFexRequest(
      facturaChile({ receptor: { cliente: 'X', domicilio: 'Y', dstCmp: 202, cuitPais: null, idImpositivo: '1234567019' } }),
      1,
      1,
      { ahora: AHORA }
    )
    const xml = buildFexAuthorizeBody(cmp)
    expect(xml).toContain('<ar:Cuit_pais_cliente>0</ar:Cuit_pais_cliente>')
    for (const vacio of ['Permisos', 'Obs', 'Obs_comerciales', 'Cmps_asoc', 'Fecha_pago', 'Actividades']) {
      expect(xml).not.toContain(`<ar:${vacio}>`)
    }
    // La línea de flete no tiene código: no va Pro_codigo vacío
    expect(xml.match(/<ar:Pro_codigo>/g)).toHaveLength(1)
  })

  it('escapa los caracteres especiales de XML', () => {
    const { cmp } = buildFexRequest(
      facturaChile({ receptor: { ...facturaChile().receptor, cliente: 'A & B <SPA>' } }),
      1,
      1,
      { ahora: AHORA }
    )
    expect(buildFexAuthorizeBody(cmp)).toContain('<ar:Cliente>A &amp; B &lt;SPA&gt;</ar:Cliente>')
  })

  it('Auth de FEXGetLast_CMP lleva Pto_venta y Cbte_Tipo adentro, después de Cuit', () => {
    expect(buildFexAuthXml({ token: 'T', sign: 'S', cuit: '30715373579', Pto_venta: 10, Cbte_Tipo: 19 })).toBe(
      '<ar:Auth><ar:Token>T</ar:Token><ar:Sign>S</ar:Sign><ar:Cuit>30715373579</ar:Cuit><ar:Pto_venta>10</ar:Pto_venta><ar:Cbte_Tipo>19</ar:Cbte_Tipo></ar:Auth>'
    )
    expect(buildFexAuthXml({ token: 'T', sign: 'S', cuit: '30715373579' })).toBe(
      '<ar:Auth><ar:Token>T</ar:Token><ar:Sign>S</ar:Sign><ar:Cuit>30715373579</ar:Cuit></ar:Auth>'
    )
  })

  it('sobre SOAP con el namespace de fexv1', () => {
    const env = buildFexEnvelope('FEXGetLast_ID', '<ar:Auth/>')
    expect(env).toContain('xmlns:ar="http://ar.gov.afip.dif.fexv1/"')
    expect(env).toContain('<soapenv:Body><ar:FEXGetLast_ID><ar:Auth/></ar:FEXGetLast_ID></soapenv:Body>')
  })

  it('formatea decimales sin notación exponencial', () => {
    expect(fmtDecimal(2078.88, 2, 2)).toBe('2078.88')
    expect(fmtDecimal(120, 6, 2)).toBe('120.00')
    expect(fmtDecimal(3, 6)).toBe('3')
    expect(fmtDecimal(1450.5, 6)).toBe('1450.5')
    expect(fmtDecimal(0.0000001, 6)).toBe('0')
  })
})

// ---------------------------------------------------------------------------
// Parseo de respuestas
// ---------------------------------------------------------------------------

describe('parseo de respuestas de WSFEX', () => {
  const resultAuth = (resultado: string, reproceso = 'N', cae = '76401234567890', obs = '') =>
    `<FEXResultAuth><Id>8</Id><Cuit>30715373579</Cuit><Cbte_tipo>19</Cbte_tipo><Punto_vta>10</Punto_vta><Cbte_nro>1</Cbte_nro>` +
    `<Cae>${cae}</Cae><Fch_venc_Cae>20261015</Fch_venc_Cae><Fch_cbte>20261005</Fch_cbte><Resultado>${resultado}</Resultado>` +
    `<Reproceso>${reproceso}</Reproceso><Motivos_Obs>${obs}</Motivos_Obs></FEXResultAuth>`

  it("aprobado: FEXErr 0 y FEXEvents 0 no son errores", () => {
    const r = parseFexAuthorizeResponse(authorizeXml(resultAuth('A')))
    expect(r).toMatchObject({
      Id: 8,
      Cbte_tipo: 19,
      Punto_vta: 10,
      Cbte_nro: 1,
      Cae: '76401234567890',
      Fch_venc_Cae: '20261015',
      Fch_cbte: '20261005',
      Resultado: 'A',
      Reproceso: false,
      Motivos_Obs: '',
      errores: [],
      eventos: [],
    })
  })

  it('rechazo con error (1668 exportador no registrado) no lanza', () => {
    const r = parseFexAuthorizeResponse(
      authorizeXml(resultAuth('R', 'N', ''), '<ErrCode>1668</ErrCode><ErrMsg>El emisor no se encuentra registrado como exportador</ErrMsg>')
    )
    expect(r.Resultado).toBe('R')
    expect(r.Cae).toBe('')
    expect(r.errores).toEqual([{ Code: 1668, Msg: 'El emisor no se encuentra registrado como exportador' }])
  })

  it('rechazo sin FEXResultAuth (2059 DES inexistente)', () => {
    const r = parseFexAuthorizeResponse(authorizeXml('', '<ErrCode>2059</ErrCode><ErrMsg>DES inexistente</ErrMsg>'))
    expect(r.Resultado).toBe('')
    expect(r.errores[0].Code).toBe(2059)
  })

  it("reproceso 'S': ARCA devuelve lo ya autorizado para ese Id", () => {
    const r = parseFexAuthorizeResponse(authorizeXml(resultAuth('A', 'S')))
    expect(r.Reproceso).toBe(true)
    expect(r.Cae).toBe('76401234567890')
  })

  it('eventos distintos de 0 se informan', () => {
    const r = parseFexAuthorizeResponse(authorizeXml(resultAuth('A'), undefined, '<EventCode>5</EventCode><EventMsg>Aviso</EventMsg>'))
    expect(r.eventos).toEqual([{ Code: 5, Msg: 'Aviso' }])
  })

  it('SOAP Fault → FexFaultError (es ArcaError)', () => {
    const xml = soap('<soap:Fault><faultcode>soap:Server</faultcode><faultstring>Server was unable to process request</faultstring></soap:Fault>')
    expect(() => parseFexAuthorizeResponse(xml, 500)).toThrow(FexFaultError)
    expect(() => parseFexAuthorizeResponse(xml, 500)).toThrow(ArcaError)
    expect(() => parseFexAuthorizeResponse(xml, 500)).toThrow(/unable to process/)
  })

  it('HTML de un proxy → ArcaError que NO es Fault (resultado desconocido)', () => {
    try {
      parseFexSoapResponse('FEXAuthorize', '<html><body>502 Bad Gateway</body></html>', 502)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ArcaError)
      expect(e).not.toBeInstanceOf(FexFaultError)
    }
  })

  const getCmpXml = (inner: string, err = '<ErrCode>0</ErrCode><ErrMsg>OK</ErrMsg>') =>
    soap(`<FEXGetCMPResponse xmlns="http://ar.gov.afip.dif.fexv1/"><FEXGetCMPResult>${inner}<FEXErr>${err}</FEXErr></FEXGetCMPResult></FEXGetCMPResponse>`)

  it('FEXGetCMP con 1020 (no existe) → null', () => {
    expect(parseFexGetCmpResponse(getCmpXml('', '<ErrCode>1020</ErrCode><ErrMsg>No existe</ErrMsg>'))).toBeNull()
  })

  it('FEXGetCMP con otro error → lanza', () => {
    expect(() => parseFexGetCmpResponse(getCmpXml('', '<ErrCode>1000</ErrCode><ErrMsg>Token</ErrMsg>'))).toThrow(ArcaError)
  })

  it('FEXGetCMP encontrado → datos tipados', () => {
    const c = parseFexGetCmpResponse(
      getCmpXml(
        '<FEXResultGet><Id>8</Id><Fecha_cbte>20261005</Fecha_cbte><Cbte_tipo>19</Cbte_tipo><Punto_vta>10</Punto_vta><Cbte_nro>1</Cbte_nro>' +
          '<Tipo_expo>1</Tipo_expo><Permiso_existente>N</Permiso_existente><Dst_cmp>208</Dst_cmp><Cliente>CLAUGER CHILE SPA</Cliente>' +
          '<Cuit_pais_cliente>55000000034</Cuit_pais_cliente><Domicilio_cliente>Av. Ejemplo 1234</Domicilio_cliente>' +
          '<Id_impositivo>76.123.456-7</Id_impositivo><Moneda_Id>DOL</Moneda_Id><Moneda_ctz>1450.5</Moneda_ctz><CanMisMonExt>S</CanMisMonExt>' +
          '<Imp_total>2198.88</Imp_total><Forma_pago>Transferencia bancaria</Forma_pago><Incoterms>CPT</Incoterms><Idioma_cbte>1</Idioma_cbte>' +
          '<Items><Item><Pro_codigo>2228 12</Pro_codigo><Pro_ds>Valvula</Pro_ds><Pro_qty>3</Pro_qty><Pro_umed>7</Pro_umed>' +
          '<Pro_precio_uni>692.96</Pro_precio_uni><Pro_bonificacion>0</Pro_bonificacion><Pro_total_item>2078.88</Pro_total_item></Item></Items>' +
          '<Fecha_cbte_cae>20261005</Fecha_cbte_cae><Fch_venc_Cae>20261015</Fch_venc_Cae><Cae>76401234567890</Cae><Resultado>A</Resultado>' +
          '<Motivos_Obs /><Opcionales><Opcional><Id>2401</Id><Valor>2133ECSI12</Valor></Opcional><Opcional><Id>2402</Id><Valor>2078.88</Valor></Opcional></Opcionales>' +
          '</FEXResultGet>'
      )
    )
    expect(c).toMatchObject({
      Id: 8,
      Cbte_nro: 1,
      Imp_total: 2198.88,
      Id_impositivo: '76.123.456-7',
      Cuit_pais_cliente: '55000000034',
      Cae: '76401234567890',
      Resultado: 'A',
      Motivos_Obs: '',
      Items: [{ Pro_codigo: '2228 12', Pro_qty: 3, Pro_total_item: 2078.88 }],
      Opcionales: [
        { Id: '2401', Valor: '2133ECSI12' },
        { Id: '2402', Valor: '2078.88' },
      ],
    })
  })

  it('FEXGetPARAM_Ctz: 1800 (sin cotización) → null; con cotización → valor', () => {
    expect(parseFexCtzResult({ FEXErr: { ErrCode: '1800', ErrMsg: 'Codigo de moneda (DOL) inexistente o SIN cotización' } })).toBeNull()
    expect(
      parseFexCtzResult({ FEXResultGet: { Mon_ctz: '1450.5', Mon_fecha: '20261001' }, FEXErr: { ErrCode: '0', ErrMsg: 'OK' } })
    ).toEqual({ monCtz: 1450.5, monFecha: '20261001' })
    expect(() => parseFexCtzResult({ FEXErr: { ErrCode: '1000', ErrMsg: 'x' } })).toThrow(ArcaError)
  })

  it('tablas FEXGetPARAM_* como lista aunque venga un solo elemento', () => {
    expect(parseFexParamLista({ FEXResultGet: { ClsFEXResponse_PtoVenta: { Pve_Nro: '10', Pve_Bloqueado: 'N' } } })).toEqual([
      { Pve_Nro: '10', Pve_Bloqueado: 'N' },
    ])
    expect(parseFexParamLista({ FEXResultGet: '' })).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// buildFexRequest: armado y validaciones (sección 6 del plan)
// ---------------------------------------------------------------------------

describe('buildFexRequest: Exporta Simple', () => {
  it('Factura E 19 con Tipo_expo 1, Permiso N sin Permisos, DOL, CanMisMonExt S y opcionales 2401/2402', () => {
    const { cmp, totales } = buildFexRequest(facturaChile(), 1, 8, { ahora: AHORA })
    expect(cmp).toMatchObject({
      Id: 8,
      Cbte_Tipo: 19,
      Punto_vta: 10,
      Cbte_nro: 1,
      Fecha_cbte: '20261005',
      Tipo_expo: 1,
      Permiso_existente: 'N',
      Moneda_Id: 'DOL',
      Moneda_ctz: 1450.5,
      CanMisMonExt: 'S',
      Imp_total: 2198.88,
      Idioma_cbte: 1,
    })
    expect(cmp.Permisos).toBeUndefined()
    expect(cmp.Opcionales).toEqual([
      { Id: '2401', Valor: '2133ECSI12' },
      { Id: '2402', Valor: '2078.88' },
    ])
    expect(totales).toEqual({ totalUSD: 2198.88, mercaderiaUSD: 2078.88, manualUSD: 120 })
  })

  it("CanMisMonExt 'N' si el cliente no paga en dólares", () => {
    expect(buildFexRequest(facturaChile({ cancelaEnMonedaExtranjera: false }), 1, 1, { ahora: AHORA }).cmp.CanMisMonExt).toBe('N')
  })

  it('FOB del DES con decimales redondos: "1234.50"', () => {
    const { cmp } = buildFexRequest(
      facturaChile({
        items: [{ descripcion: 'Válvula', cantidad: 1, precioUnitario: 1234.5 }],
        exportaSimple: { desNumero: '2133ECSI12', fobUSD: 1234.5 },
      }),
      1,
      1,
      { ahora: AHORA }
    )
    expect(cmp.Opcionales?.[1]).toEqual({ Id: '2402', Valor: '1234.50' })
  })

  it('normaliza el N° de DES (sin espacios, mayúsculas)', () => {
    const { cmp } = buildFexRequest(facturaChile({ exportaSimple: { desNumero: ' 2133 ecsi12 ', fobUSD: 2078.88 } }), 1, 1, { ahora: AHORA })
    expect(cmp.Opcionales?.[0]).toEqual({ Id: '2401', Valor: '2133ECSI12' })
  })

  it('bonificación como MONTO y sumas en centavos', () => {
    const { cmp, totales } = buildFexRequest(
      facturaChile({
        items: [
          { descripcion: 'A', cantidad: 3, precioUnitario: 100, bonificacion: 30 },
          { descripcion: 'B', cantidad: 3, precioUnitario: 0.1 },
          { descripcion: 'C', cantidad: 1, precioUnitario: 0.2 },
        ],
        incoterm: 'FCA',
        exportaSimple: { desNumero: '2133ECSI12', fobUSD: 270.5 },
      }),
      1,
      1,
      { ahora: AHORA }
    )
    expect(cmp.Items[0]).toMatchObject({ Pro_precio_uni: 100, Pro_bonificacion: 30, Pro_total_item: 270 })
    expect(cmp.Items[1].Pro_total_item).toBe(0.3)
    expect(cmp.Imp_total).toBe(270.5)
    expect(totales.mercaderiaUSD).toBe(270.5)
    expect(aCentavos(1.005)).toBe(101)
    expect(aCentavos(692.96 * 3)).toBe(207888)
  })

  it('FCA sin línea de flete: total = FOB', () => {
    const { cmp } = buildFexRequest(
      facturaChile({ incoterm: 'FCA', items: [facturaChile().items[0]] }),
      1,
      1,
      { ahora: AHORA }
    )
    expect(cmp.Imp_total).toBe(2078.88)
    expect(cmp.Incoterms).toBe('FCA')
  })

  it('rechaza FOB del DES distinto de la mercadería (2022/2060)', () => {
    const errores = erroresDe(facturaChile({ exportaSimple: { desNumero: '2133ECSI12', fobUSD: 2000 } }))
    expect(errores.some((e) => e.includes('2022/2060'))).toBe(true)
  })

  it('rechaza FOB mayor al total (2021)', () => {
    const errores = erroresDe(facturaChile({ exportaSimple: { desNumero: '2133ECSI12', fobUSD: 3000 } }))
    expect(errores.some((e) => e.includes('2021'))).toBe(true)
  })

  it('rechaza FOB con más de 2 decimales', () => {
    const errores = erroresDe(facturaChile({ exportaSimple: { desNumero: '2133ECSI12', fobUSD: 2078.885 } }))
    expect(errores.some((e) => e.includes('2 decimales'))).toBe(true)
  })

  it('rechaza FCA (o FOB) con línea de flete', () => {
    for (const incoterm of ['FCA', 'FOB']) {
      const errores = erroresDe(facturaChile({ incoterm }))
      expect(errores.some((e) => e.includes('solo corresponde con CPT, CIP o DAP'))).toBe(true)
    }
  })

  it('rechaza Incoterms no habilitados para Exporta Simple o inexistentes', () => {
    expect(erroresDe(facturaChile({ incoterm: 'DDP' })).some((e) => e.includes('Exporta Simple'))).toBe(true)
    expect(erroresDe(facturaChile({ incoterm: 'XYZ' })).some((e) => e.includes('1640'))).toBe(true)
  })

  it('rechaza falta de forma de pago, Incoterm o domicilio', () => {
    expect(erroresDe(facturaChile({ formaPago: '  ' })).some((e) => e.includes('1620'))).toBe(true)
    expect(erroresDe(facturaChile({ incoterm: '', incotermLugar: '' })).some((e) => e.includes('Falta el Incoterm'))).toBe(true)
    expect(
      erroresDe(facturaChile({ receptor: { ...facturaChile().receptor, domicilio: '' } })).some((e) => e.includes('domicilio'))
    ).toBe(true)
  })

  it('rechaza receptor sin CUIT país ni ID impositivo (1580)', () => {
    const errores = erroresDe(facturaChile({ receptor: { ...facturaChile().receptor, cuitPais: null, idImpositivo: null } }))
    expect(errores.some((e) => e.includes('1580'))).toBe(true)
  })

  it('rechaza N° de DES con formato inválido', () => {
    for (const desNumero of ['ABC-1234567', '1234567', '123456789012', '']) {
      const errores = erroresDe(facturaChile({ exportaSimple: { desNumero, fobUSD: 2078.88 } }))
      expect(errores.some((e) => e.includes('N° de DES inválido'))).toBe(true)
    }
  })

  it('rechaza Exporta Simple con permisos o con otro Tipo_expo', () => {
    const errores = erroresDe(
      facturaChile({ tipoExpo: 2, fechaPago: '20261010', permisos: [{ idPermiso: '26001EC01000123A', dstMerc: 208 }] })
    )
    expect(errores.some((e) => e.includes('Tipo_expo 1'))).toBe(true)
    expect(errores.some((e) => e.includes('2056'))).toBe(true)
  })

  it('rechaza cantidad mayor a la pendiente y bonificación mayor al ítem (1812)', () => {
    const errores = erroresDe(
      facturaChile({
        items: [
          { descripcion: 'A', cantidad: 4, precioUnitario: 692.96, cantidadPendiente: 3 },
          { descripcion: 'B', cantidad: 1, precioUnitario: 10, bonificacion: 11 },
        ],
      })
    )
    expect(errores.some((e) => e.includes('supera la pendiente'))).toBe(true)
    expect(errores.some((e) => e.includes('1812'))).toBe(true)
  })

  it('junta todos los errores en una sola excepción', () => {
    const errores = erroresDe(facturaChile({ formaPago: '', cotizacion: 0, exportaSimple: { desNumero: 'x', fobUSD: 1 } }))
    expect(errores.length).toBeGreaterThanOrEqual(3)
  })

  it('PV de exportación sin configurar', () => {
    expect(erroresDe(facturaChile({ puntoVenta: undefined })).some((e) => e.includes('ARCA_PUNTO_VENTA_EXPO'))).toBe(true)
  })

  it('validarExportacion devuelve [] para la factura de Chile', () => {
    expect(validarExportacion(facturaChile(), { ahora: AHORA })).toEqual([])
  })
})

describe('buildFexRequest: fecha en hora argentina', () => {
  it('a las 22:30 de Argentina (ya es mañana en UTC) la fecha sigue siendo hoy', () => {
    const ahora = new Date('2026-10-06T01:30:00Z') // 5/10 22:30 AR
    expect(fechaYmdAR(ahora)).toBe('20261005')
    expect(fechaIsoAR(ahora)).toBe('2026-10-05')
    expect(buildFexRequest(facturaChile(), 1, 1, { ahora }).cmp.Fecha_cbte).toBe('20261005')
  })

  it('rechaza una fecha que no es hoy (1500)', () => {
    const errores = erroresDe(facturaChile({ fecha: new Date('2026-10-02T13:00:00Z') }))
    expect(errores.some((e) => e.includes('1500'))).toBe(true)
  })

  it('fechaDesdeYmd da el mismo día leído en UTC y en hora AR', () => {
    const d = fechaDesdeYmd('20261005')
    expect(d.toISOString().slice(0, 10)).toBe('2026-10-05')
    expect(fechaIsoAR(d)).toBe('2026-10-05')
  })
})

describe('buildFexRequest: NC/ND E y despachante (fases 2 y 3, solo el armado)', () => {
  const asociada = { cbteTipo: 19, puntoVenta: 10, numero: 1, cuit: '30715373579' }

  it('NC E: 21, solo opcional 2402, sin CanMisMonExt ni Permiso_existente, con Cmps_asoc', () => {
    const { cmp } = buildFexRequest(
      facturaChile({
        clase: 'NOTA_CREDITO',
        items: [facturaChile().items[0]],
        asociados: [asociada],
        exportaSimple: { desNumero: '', fobUSD: 2078.88, fobOriginalUSD: 2078.88 },
      }),
      1,
      1,
      { ahora: AHORA }
    )
    expect(cmp.Cbte_Tipo).toBe(21)
    expect(cmp.Opcionales).toEqual([{ Id: '2402', Valor: '2078.88' }])
    expect(cmp.CanMisMonExt).toBeUndefined()
    expect(cmp.Permiso_existente).toBeUndefined()
    expect(cmp.Cmps_asoc).toEqual([{ Cbte_tipo: 19, Cbte_punto_vta: 10, Cbte_nro: 1, Cbte_cuit: '30715373579' }])
  })

  it('NC E sin comprobante asociado o con FOB mayor al original → error', () => {
    const sinAsoc = erroresDe(facturaChile({ clase: 'NOTA_CREDITO', items: [facturaChile().items[0]] }))
    expect(sinAsoc.some((e) => e.includes('exactamente un comprobante'))).toBe(true)
    const fobMayor = erroresDe(
      facturaChile({
        clase: 'NOTA_CREDITO',
        items: [facturaChile().items[0]],
        asociados: [asociada],
        exportaSimple: { desNumero: '', fobUSD: 2078.88, fobOriginalUSD: 1000 },
      })
    )
    expect(fobMayor.some((e) => e.includes('2023'))).toBe(true)
  })

  it('despachante: permiso S exige formato válido; sin opcionales del DES', () => {
    const base = facturaChile({ regimen: 'DESPACHANTE', exportaSimple: undefined, incoterm: 'CIF', permisoExistente: 'S' })
    const malo = erroresDe({ ...base, permisos: [{ idPermiso: '123', dstMerc: 208 }] })
    expect(malo.some((e) => e.includes('formato inválido'))).toBe(true)
    const { cmp } = buildFexRequest({ ...base, permisos: [{ idPermiso: '26001ec01000123a', dstMerc: 208 }] }, 1, 1, { ahora: AHORA })
    expect(cmp.Permiso_existente).toBe('S')
    expect(cmp.Permisos).toEqual([{ Id_permiso: '26001EC01000123A', Dst_merc: 208 }])
    expect(cmp.Opcionales).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Receptor y helpers
// ---------------------------------------------------------------------------

describe('receptorExportacion', () => {
  const clauger = {
    name: 'Clauger Chile',
    businessName: 'CLAUGER CHILE SPA',
    type: 'BUSINESS',
    taxCondition: 'CLIENTE_EXTERIOR',
    country: 'Chile',
    address: 'Av. Ejemplo 1234',
    city: 'Santiago',
    taxIdExterior: '76.123.456-7',
  }

  it('Chile persona jurídica → 208 / 55000000034 / RUT tal como se cargó', () => {
    const r = receptorExportacion(clauger)
    expect(r.faltantes).toEqual([])
    expect(r.receptor).toEqual({
      cliente: 'CLAUGER CHILE SPA',
      domicilio: 'Av. Ejemplo 1234, Santiago, Chile',
      dstCmp: 208,
      cuitPais: '55000000034',
      idImpositivo: '76.123.456-7',
    })
    expect(r.iso).toBe('CL')
  })

  it('Chile persona física → 50000000032; Paraguay y Uruguay con sus CUIT país', () => {
    expect(receptorExportacion({ ...clauger, type: 'INDIVIDUAL' }).receptor?.cuitPais).toBe('50000000032')
    expect(receptorExportacion({ ...clauger, country: 'Paraguay' }).receptor).toMatchObject({ dstCmp: 221, cuitPais: '55000000026' })
    expect(receptorExportacion({ ...clauger, country: 'Uruguay' }).receptor).toMatchObject({ dstCmp: 225, cuitPais: '55000000018' })
  })

  it('Bolivia (sin CUIT país verificado) sale solo con el NIT', () => {
    const r = receptorExportacion({ ...clauger, country: 'Bolivia', taxIdExterior: '1234567019' })
    expect(r.receptor).toMatchObject({ dstCmp: 202, cuitPais: null, idImpositivo: '1234567019' })
    const sinNit = receptorExportacion({ ...clauger, country: 'Bolivia', taxIdExterior: null })
    expect(sinNit.receptor).toBeNull()
    expect(sinNit.faltantes.some((f) => f.includes('NIT'))).toBe(true)
  })

  it('lista los datos que faltan', () => {
    const r = receptorExportacion({ ...clauger, businessName: null, name: ' ', address: null, city: '' })
    expect(r.receptor).toBeNull()
    expect(r.faltantes).toEqual(expect.arrayContaining(['Razón social', 'Domicilio', 'Ciudad']))
  })

  it('país sin código de ARCA cargado y cliente argentino', () => {
    expect(receptorExportacion({ ...clauger, country: 'Perú' }).faltantes.some((f) => f.includes('Perú'))).toBe(true)
    const ar = receptorExportacion({ ...clauger, country: 'Argentina', taxCondition: 'RESPONSABLE_INSCRIPTO' })
    expect(ar.faltantes.some((f) => f.includes('no es del exterior'))).toBe(true)
  })

  it('sin RUT pero con CUIT país: advertencia, no bloquea', () => {
    const r = receptorExportacion({ ...clauger, taxIdExterior: '' })
    expect(r.receptor?.idImpositivo).toBeNull()
    expect(r.advertencias[0]).toContain('RUT')
  })
})

describe('helpers', () => {
  it('número interno de la Invoice', () => {
    expect(numeroInternoExportacion(19, 10, 1)).toBe('E-0010-00000001')
    expect(numeroInternoExportacion(21, 10, 3)).toBe('NCE-0010-00000003')
    expect(numeroInternoExportacion(20, 10, 12)).toBe('NDE-0010-00000012')
  })

  it('esCbteExportacion', () => {
    expect([19, 20, 21].every(esCbteExportacion)).toBe(true)
    expect([1, 6, 201, null].some((t) => esCbteExportacion(t))).toBe(false)
  })

  it('cotización: si hoy no hay (1800) usa el día anterior y dice cuál', async () => {
    const consultadas: string[] = []
    const r = await buscarCotizacionHaciaAtras(async (f) => {
      consultadas.push(f)
      return f === '2026-10-01' ? { monCtz: 1450.5, monFecha: '20261001' } : null
    }, '2026-10-02')
    expect(consultadas).toEqual(['2026-10-02', '2026-10-01'])
    expect(r).toEqual({ monId: 'DOL', cotizacion: 1450.5, fechaConsultada: '2026-10-01', fechaCotizacion: '20261001', diasAtras: 1 })
  })

  it('cotización: descarta la del mismo día del comprobante aunque ARCA la tenga', async () => {
    const consultadas: string[] = []
    const r = await buscarCotizacionHaciaAtras(
      async (f) => {
        consultadas.push(f)
        // ARCA ya publicó la del día (cierre) y además devuelve una fecha igual al comprobante
        return f === '2026-10-01' ? { monCtz: 1460, monFecha: '20261002' } : f === '2026-09-30' ? { monCtz: 1450.5, monFecha: '20260930' } : null
      },
      '2026-10-01',
      7,
      'DOL',
      { antesDeIso: '2026-10-02' }
    )
    expect(consultadas).toEqual(['2026-10-01', '2026-09-30'])
    expect(r).toMatchObject({ cotizacion: 1450.5, fechaCotizacion: '20260930', diasAtras: 1 })
  })

  it('cotización: cruza fin de mes y nunca inventa un valor', async () => {
    const consultadas: string[] = []
    await expect(
      buscarCotizacionHaciaAtras(async (f) => {
        consultadas.push(f)
        return null
      }, '2026-10-02')
    ).rejects.toThrow(ArcaError)
    expect(consultadas).toHaveLength(7)
    expect(consultadas.at(-1)).toBe('2026-09-26')
  })
})

// ---------------------------------------------------------------------------
// Ciclo idempotente de emisión (sección 7) con ARCA y DB falsos
// ---------------------------------------------------------------------------

const CAE = '76401234567890'

function respuestaA(over: Partial<FexAuthorizeResult> = {}): FexAuthorizeResult {
  return {
    Id: 8,
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

function consultado(over: Partial<FexCmpConsultado> = {}): FexCmpConsultado {
  return {
    Id: 8,
    Fecha_cbte: '20261005',
    Cbte_tipo: 19,
    Punto_vta: 10,
    Cbte_nro: 1,
    Tipo_expo: 1,
    Permiso_existente: 'N',
    Dst_cmp: 208,
    Cliente: 'CLAUGER CHILE SPA',
    Cuit_pais_cliente: '55000000034',
    Domicilio_cliente: 'Av. Ejemplo 1234, Santiago, Chile',
    Id_impositivo: '76.123.456-7',
    Moneda_Id: 'DOL',
    Moneda_ctz: 1450.5,
    CanMisMonExt: 'S',
    Imp_total: 2198.88,
    Forma_pago: 'Transferencia bancaria',
    Incoterms: 'CPT',
    Incoterms_Ds: 'Santiago',
    Idioma_cbte: 1,
    Items: [],
    Opcionales: [],
    Fecha_cbte_cae: '20261005',
    Fch_venc_Cae: '20261015',
    Cae: CAE,
    Resultado: 'A',
    Motivos_Obs: '',
    raw: {},
    ...over,
  }
}

function escenario(authorize: (xml: string) => Promise<FexAuthorizeResult>, over: Partial<PersistenciaExportacion> = {}) {
  const log: string[] = []
  const persistencia: PersistenciaExportacion = {
    buscarBloqueante: vi.fn(async () => null),
    maxFexId: vi.fn(async () => 7),
    reservar: vi.fn(async (r) => {
      log.push(`reservar:${r.fexId}:${r.cbteNumero}`)
    }),
    marcarAutorizada: vi.fn(async () => {
      log.push('marcarAutorizada')
    }),
    marcarRechazada: vi.fn(async () => {
      log.push('marcarRechazada')
    }),
    marcarIncierta: vi.fn(async () => {
      log.push('marcarIncierta')
    }),
    ...over,
  }
  const cliente = {
    getLastCmp: vi.fn(async () => 0),
    getLastId: vi.fn(async () => 5),
    authorize: vi.fn(async (xml: string) => {
      log.push('authorize')
      return authorize(xml)
    }),
    getCmp: vi.fn(async (): Promise<FexCmpConsultado | null> => null),
  } satisfies FexCliente
  const emitir = () =>
    emitirExportacion(facturaChile(), persistencia, { cliente, ahora: () => AHORA, esperaReintentoMs: 0 })
  return { log, persistencia, cliente, emitir }
}

const timeout = () => Promise.reject(new Error('ARCA timeout (60000 ms) en servicios1.afip.gov.ar'))

describe('emitirExportacion: ciclo idempotente', () => {
  it('reserva el Id ANTES de llamar a ARCA; Id = max(ARCA, DB) + 1; número = último + 1', async () => {
    const s = escenario(async () => respuestaA())
    const r = await s.emitir()
    expect(s.log).toEqual(['reservar:8:1', 'authorize', 'marcarAutorizada'])
    expect(r).toMatchObject({
      ok: true,
      estado: 'AUTORIZADA',
      fexId: 8,
      numero: 1,
      numeroInterno: 'E-0010-00000001',
      numeroFormateado: '0010-00000001',
      cae: CAE,
      reproceso: false,
      persistido: true,
    })
    if (r.ok) {
      expect(r.fecha.toISOString().slice(0, 10)).toBe('2026-10-05')
      expect(r.totales.mercaderiaUSD).toBe(2078.88)
    }
    // El cuerpo enviado es exactamente el del Cmp reservado
    const reserva = vi.mocked(s.persistencia.reservar).mock.calls[0][0]
    expect(s.cliente.authorize).toHaveBeenCalledWith(reserva.cmpXml)
    expect(reserva.cmpXml).toBe(buildFexAuthorizeBody(reserva.cmp))
  })

  it("rechazo 'R' → RECHAZADA sin consultar FEXGetCMP", async () => {
    const s = escenario(async () =>
      respuestaA({ Resultado: 'R', Cae: '', errores: [{ Code: 2059, Msg: 'DES inexistente' }] })
    )
    const r = await s.emitir()
    expect(r).toMatchObject({ ok: false, estado: 'RECHAZADA', fexId: 8, errores: [{ Code: 2059, Msg: 'DES inexistente' }] })
    expect(s.cliente.getCmp).not.toHaveBeenCalled()
    expect(s.log).toEqual(['reservar:8:1', 'authorize', 'marcarRechazada'])
  })

  it("timeout y reintento con el MISMO cuerpo → Reproceso 'S'", async () => {
    let n = 0
    const s = escenario(() => (n++ === 0 ? timeout() : Promise.resolve(respuestaA({ Reproceso: true }))))
    const r = await s.emitir()
    expect(s.cliente.authorize).toHaveBeenCalledTimes(2)
    const [primero, segundo] = vi.mocked(s.cliente.authorize).mock.calls
    expect(segundo[0]).toBe(primero[0])
    expect(r).toMatchObject({ ok: true, reproceso: true })
    expect(s.persistencia.reservar).toHaveBeenCalledTimes(1)
  })

  it('dos timeouts y el comprobante figura en ARCA con el mismo Id → AUTORIZADA recuperada', async () => {
    const s = escenario(timeout)
    s.cliente.getCmp.mockResolvedValue(consultado())
    const r = await s.emitir()
    expect(s.cliente.authorize).toHaveBeenCalledTimes(2)
    expect(s.cliente.getCmp).toHaveBeenCalledWith(19, 10, 1)
    expect(r).toMatchObject({ ok: true, recuperado: true, cae: CAE })
  })

  it('dos timeouts y el comprobante no figura → INCIERTA (bloquea), nunca un Id nuevo', async () => {
    const s = escenario(timeout)
    const r = await s.emitir()
    expect(r).toMatchObject({ ok: false, estado: 'INCIERTA', fexId: 8 })
    expect(s.log).toEqual(['reservar:8:1', 'authorize', 'authorize', 'marcarIncierta'])
    expect(s.persistencia.reservar).toHaveBeenCalledTimes(1)
  })

  it('el número existe en ARCA pero con otro Id/importe → INCIERTA', async () => {
    const s = escenario(timeout)
    s.cliente.getCmp.mockResolvedValue(consultado({ Id: 99, Imp_total: 10 }))
    expect(await s.emitir()).toMatchObject({ ok: false, estado: 'INCIERTA' })
  })

  it('FEXGetCMP falla después del corte → INCIERTA', async () => {
    const s = escenario(timeout)
    s.cliente.getCmp.mockRejectedValue(new Error('sin red'))
    expect(await s.emitir()).toMatchObject({ ok: false, estado: 'INCIERTA' })
  })

  it('timeout y el reintento vuelve rechazado: se confirma con FEXGetCMP (el primero pudo autorizarse)', async () => {
    let n = 0
    const s = escenario(() =>
      n++ === 0
        ? timeout()
        : Promise.resolve(respuestaA({ Resultado: 'R', Cae: '', errores: [{ Code: 1550, Msg: 'Numero ya autorizado' }] }))
    )
    s.cliente.getCmp.mockResolvedValue(consultado())
    expect(await s.emitir()).toMatchObject({ ok: true, recuperado: true })
  })

  it('timeout, reintento rechazado y el número no figura → INCIERTA (el primero pudo seguir en proceso)', async () => {
    let n = 0
    const s = escenario(() =>
      n++ === 0 ? timeout() : Promise.resolve(respuestaA({ Resultado: 'R', Cae: '', errores: [{ Code: 2059, Msg: 'DES' }] }))
    )
    expect(await s.emitir()).toMatchObject({ ok: false, estado: 'INCIERTA' })
    expect(s.persistencia.marcarRechazada).not.toHaveBeenCalled()
  })

  it('SOAP Fault y el número no figura → INCIERTA: no libera el número (ARCA pudo grabarlo con demora)', async () => {
    const s = escenario(() => Promise.reject(new FexFaultError('WSFEX FEXAuthorize fault: Server was unable to process request ---> Timeout')))
    const r = await s.emitir()
    expect(s.cliente.authorize).toHaveBeenCalledTimes(1)
    expect(s.cliente.getCmp).toHaveBeenCalledTimes(1)
    expect(r).toMatchObject({ ok: false, estado: 'INCIERTA' })
    expect(s.persistencia.marcarRechazada).not.toHaveBeenCalled()
  })

  it('error interno de ARCA (500) y el número no figura → INCIERTA, no RECHAZADA', async () => {
    const s = escenario(async () => respuestaA({ Resultado: '', Cae: '', errores: [{ Code: 500, Msg: 'Error interno de aplicación' }] }))
    expect(await s.emitir()).toMatchObject({ ok: false, estado: 'INCIERTA', errores: [{ Code: 500 }] })
    expect(s.persistencia.marcarRechazada).not.toHaveBeenCalled()
  })

  it('error interno de ARCA (500) → se confirma con FEXGetCMP antes de rechazar', async () => {
    const s = escenario(async () => respuestaA({ Resultado: '', Cae: '', errores: [{ Code: 500, Msg: 'Error interno de aplicación' }] }))
    s.cliente.getCmp.mockResolvedValue(consultado())
    expect(await s.emitir()).toMatchObject({ ok: true, recuperado: true })
  })

  it("'A' con otro Id (Id reutilizado) → INCIERTA, no se toma ese CAE", async () => {
    const s = escenario(async () => respuestaA({ Id: 3, Cbte_nro: 7, Reproceso: true }))
    expect(await s.emitir()).toMatchObject({ ok: false, estado: 'INCIERTA' })
  })

  it('si no se puede marcar AUTORIZADA en la DB igual devuelve el CAE (persistido=false)', async () => {
    const s = escenario(async () => respuestaA(), { marcarAutorizada: vi.fn(async () => Promise.reject(new Error('db caída'))) })
    expect(await s.emitir()).toMatchObject({ ok: true, cae: CAE, persistido: false })
  })

  it('con un comprobante PENDIENTE/INCIERTO no emite', async () => {
    const s = escenario(async () => respuestaA(), {
      buscarBloqueante: vi.fn(async () => ({ fexId: 4, estado: 'INCIERTA', cbteNumero: 1 })),
    })
    await expect(s.emitir()).rejects.toThrow(ExportacionBloqueadaError)
    expect(s.cliente.authorize).not.toHaveBeenCalled()
    expect(s.persistencia.reservar).not.toHaveBeenCalled()
  })

  it('si la numeración de ARCA no coincide con la DB no emite', async () => {
    const s = escenario(async () => respuestaA(), { ultimoNumeroAutorizado: vi.fn(async () => 0) })
    s.cliente.getLastCmp.mockResolvedValue(1)
    await expect(s.emitir()).rejects.toThrow(ExportacionBloqueadaError)
    expect(s.cliente.authorize).not.toHaveBeenCalled()
  })

  it('si la reserva en la DB falla, no se llama a ARCA', async () => {
    const s = escenario(async () => respuestaA(), { reservar: vi.fn(async () => Promise.reject(new Error('unique'))) })
    await expect(s.emitir()).rejects.toThrow('unique')
    expect(s.cliente.authorize).not.toHaveBeenCalled()
  })

  it('datos inválidos: lanza antes de consultar ARCA', async () => {
    const s = escenario(async () => respuestaA())
    await expect(
      emitirExportacion(facturaChile({ formaPago: '' }), s.persistencia, { cliente: s.cliente, ahora: () => AHORA })
    ).rejects.toThrow(ExportacionValidacionError)
    expect(s.cliente.getLastCmp).not.toHaveBeenCalled()
  })
})

describe('vistaPreviaExportacion (dryRun)', () => {
  it('devuelve el request exacto sin reservar ni llamar a FEXAuthorize', async () => {
    const s = escenario(async () => respuestaA())
    const v = await vistaPreviaExportacion(facturaChile(), s.persistencia, {
      cliente: s.cliente,
      ahora: () => AHORA,
      cuitEmisor: '30715373579',
    })
    expect(v).toMatchObject({ dryRun: true, numero: 1, fexId: 8, numeroInterno: 'E-0010-00000001', advertencias: [] })
    expect(v.cmpXml).toBe(buildFexAuthorizeBody(v.cmp))
    expect(v.xml).toContain('<ar:Token>(oculto)</ar:Token>')
    expect(v.xml).toContain(v.cmpXml)
    expect(s.cliente.authorize).not.toHaveBeenCalled()
    expect(s.persistencia.reservar).not.toHaveBeenCalled()
  })
})
