import { describe, it, expect } from 'vitest'
import { buildDetalle, cbteTipoFor, type ComprobanteInput } from '@/lib/arca/emitir'
import { CBTE_TIPO, CONCEPTO, CONDICION_IVA_RECEPTOR, DOC_TIPO, IVA_ID, MONEDA } from '@/lib/arca/wsfe'

/**
 * buildDetalle arma el FECAEDetRequest que va a ARCA. Si los importes no
 * cierran al centavo ARCA rechaza (10048/10049), así que acá se prueba la
 * aritmética y las reglas por letra/moneda/FCE sin tocar la red.
 */

const receptorRI = { condicionIvaId: CONDICION_IVA_RECEPTOR.RESPONSABLE_INSCRIPTO, docTipo: DOC_TIPO.CUIT, docNro: '30710591406' }
const consumidorFinal = { condicionIvaId: CONDICION_IVA_RECEPTOR.CONSUMIDOR_FINAL, docTipo: DOC_TIPO.CONSUMIDOR_FINAL, docNro: '0' }

function facturaA(over: Partial<ComprobanteInput> = {}): ComprobanteInput {
  return {
    clase: 'FACTURA',
    letra: 'A',
    fecha: new Date(2026, 8, 7),
    receptor: receptorRI,
    moneda: 'ARS',
    importes: {
      netoGravado: 1000,
      netoNoGravado: 0,
      exento: 0,
      iva: [{ alicuota: '21', baseImponible: 1000, importe: 210 }],
      total: 1210,
    },
    ...over,
  }
}

describe('buildDetalle: importes', () => {
  it('factura A en pesos con IVA 21%', () => {
    const det = buildDetalle(facturaA(), 15)
    expect(det).toMatchObject({
      Concepto: CONCEPTO.PRODUCTOS,
      DocTipo: DOC_TIPO.CUIT,
      DocNro: '30710591406',
      CbteDesde: 15,
      CbteHasta: 15,
      CbteFch: '20260907',
      ImpTotal: 1210,
      ImpNeto: 1000,
      ImpTotConc: 0,
      ImpOpEx: 0,
      ImpTrib: 0,
      ImpIVA: 210,
      MonId: MONEDA.PESOS,
      MonCotiz: 1,
    })
    expect(det.Iva).toEqual([{ Id: IVA_ID['21'], BaseImp: 1000, Importe: 210 }])
    expect(det.Tributos).toBeUndefined()
    expect(det.CbtesAsoc).toBeUndefined()
  })

  it('suma varias alícuotas y descarta las que están en cero', () => {
    const det = buildDetalle(
      facturaA({
        importes: {
          netoGravado: 3000,
          netoNoGravado: 0,
          exento: 0,
          iva: [
            { alicuota: '21', baseImponible: 2000, importe: 420 },
            { alicuota: '10.5', baseImponible: 1000, importe: 105 },
            { alicuota: '27', baseImponible: 0, importe: 0 },
          ],
          total: 3525,
        },
      }),
      1
    )
    expect(det.ImpIVA).toBe(525)
    expect(det.Iva).toHaveLength(2)
  })

  it('redondea a centavos y tolera diferencias de hasta 2 centavos', () => {
    const det = buildDetalle(
      facturaA({
        importes: {
          netoGravado: 33.333,
          netoNoGravado: 0,
          exento: 0,
          iva: [{ alicuota: '21', baseImponible: 33.333, importe: 6.99993 }],
          total: 40.34,
        },
      }),
      1
    )
    expect(det.ImpNeto).toBe(33.33)
    expect(det.ImpIVA).toBe(7)
    expect(det.ImpTotal).toBe(40.34)
  })

  it('rechaza importes que no cierran (ARCA 10048/10049)', () => {
    expect(() =>
      buildDetalle(facturaA({ importes: { ...facturaA().importes, total: 1300 } }), 1)
    ).toThrow(/Importes inconsistentes/)
  })

  it('incluye tributos (percepciones) en el total', () => {
    const det = buildDetalle(
      facturaA({
        importes: {
          netoGravado: 1000,
          netoNoGravado: 0,
          exento: 0,
          iva: [{ alicuota: '21', baseImponible: 1000, importe: 210 }],
          tributos: [{ Id: 7, Desc: 'Percepción IIBB CABA', BaseImp: 1000, Alic: 3, Importe: 30 }],
          total: 1240,
        },
      }),
      1
    )
    expect(det.ImpTrib).toBe(30)
    expect(det.Tributos).toHaveLength(1)
  })
})

describe('buildDetalle: moneda', () => {
  it('USD exige cotización y marca cancelación en moneda extranjera', () => {
    expect(() => buildDetalle(facturaA({ moneda: 'USD' }), 1)).toThrow(/sin cotización/)
    const det = buildDetalle(facturaA({ moneda: 'USD', cotizacion: 1350.5, cancelaEnMonedaExtranjera: true }), 1)
    expect(det.MonId).toBe(MONEDA.DOLAR)
    expect(det.MonCotiz).toBe(1350.5)
    expect(det.CanMisMonExt).toBe('S')
    const detPesos = buildDetalle(facturaA(), 1)
    expect(detPesos.CanMisMonExt).toBeUndefined()
  })
})

describe('buildDetalle: letra y clase', () => {
  it('factura C no discrimina IVA', () => {
    const det = buildDetalle(
      facturaA({
        letra: 'C',
        receptor: consumidorFinal,
        importes: { netoGravado: 1210, netoNoGravado: 0, exento: 0, iva: [], total: 1210 },
      }),
      1
    )
    expect(det.ImpIVA).toBe(0)
    expect(det.Iva).toBeUndefined()
    expect(det.DocNro).toBe('0')
  })

  it('nota de crédito requiere comprobante asociado', () => {
    expect(() => buildDetalle(facturaA({ clase: 'NOTA_CREDITO' }), 1)).toThrow(/comprobante asociado/)
    const det = buildDetalle(
      facturaA({ clase: 'NOTA_CREDITO', asociados: [{ Tipo: CBTE_TIPO.FACTURA_A, PtoVta: 7, Nro: 12 }] }),
      1
    )
    expect(det.CbtesAsoc).toEqual([{ Tipo: CBTE_TIPO.FACTURA_A, PtoVta: 7, Nro: 12 }])
  })

  it('cbteTipoFor mapea letra, clase y FCE', () => {
    expect(cbteTipoFor('A', 'FACTURA')).toBe(CBTE_TIPO.FACTURA_A)
    expect(cbteTipoFor('B', 'NOTA_CREDITO')).toBe(CBTE_TIPO.NOTA_CREDITO_B)
    expect(cbteTipoFor('A', 'FACTURA', true)).toBe(CBTE_TIPO.FCE_A)
    expect(cbteTipoFor('A', 'NOTA_CREDITO', true)).toBe(CBTE_TIPO.FCE_NOTA_CREDITO_A)
  })
})

describe('buildDetalle: FCE MiPyME', () => {
  it('factura FCE lleva vencimiento, CBU (2101) y sistema de circulación (27)', () => {
    const det = buildDetalle(
      facturaA({ fce: { vtoPago: new Date(2026, 9, 7), cbu: '0170099520000012345678', transmision: 'SCA' } }),
      1
    )
    expect(det.FchVtoPago).toBe('20261007')
    expect(det.Opcionales).toEqual([
      { Id: '2101', Valor: '0170099520000012345678' },
      { Id: '27', Valor: 'SCA' },
    ])
  })

  it('factura FCE sin vencimiento o con CBU inválido se rechaza', () => {
    expect(() => buildDetalle(facturaA({ fce: { cbu: '0170099520000012345678' } }), 1)).toThrow(/vencimiento/)
    expect(() => buildDetalle(facturaA({ fce: { vtoPago: new Date(), cbu: '123' } }), 1)).toThrow(/CBU/)
  })

  it('NC FCE lleva Opcional 22 y no CBU', () => {
    const det = buildDetalle(
      facturaA({
        clase: 'NOTA_CREDITO',
        fce: { anulacion: 'S' },
        asociados: [{ Tipo: CBTE_TIPO.FCE_A, PtoVta: 7, Nro: 3 }],
      }),
      1
    )
    expect(det.Opcionales).toEqual([{ Id: '22', Valor: 'S' }])
    expect(det.FchVtoPago).toBeUndefined()
  })

  it('FCE exige CUIT del receptor', () => {
    expect(() =>
      buildDetalle(facturaA({ receptor: consumidorFinal, fce: { vtoPago: new Date(), cbu: '0170099520000012345678' } }), 1)
    ).toThrow(/CUIT/)
  })
})
