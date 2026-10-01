import { describe, it, expect } from 'vitest'
import { armarImputacionNc } from '@/lib/facturacion/imputacion-nc'

// infofactura real (leer_facturaventa) de ECOBUILDING A-0007-00000005
const ecobuilding = {
  idFactura: '54195420',
  idTipoComprobante: '4',
  nroFactura: '0007-00000005',
  fechaPago: '08-10-2026',
  totalFactura: 111.19,
  currencyIso: 'USD',
  rate: '1540.000000',
  saldoaaplicar: 171232.6,
}

describe('armarImputacionNc', () => {
  it('NC de 1 unidad sobre la factura en USD: importes en pesos como la grilla de Colppy', () => {
    expect(armarImputacionNc(ecobuilding, 57072.4)).toEqual({
      idFactura: '54195420',
      nroFactura: '0007-00000005',
      tipoComprobante: 'FAV',
      fechaPago: '08-10-2026',
      RG: null,
      moneda: 'P',
      totalFactura: 171232.6,
      pagado: 0,
      saldoAnterior: 171232.6,
      estePago: 57072.4,
      Saldo: 114160.2,
      pagar: true,
    })
  })

  it('factura con cobros parciales: aplica hasta el saldo', () => {
    const r = armarImputacionNc({ ...ecobuilding, saldoaaplicar: 30000 }, 57072.4)
    expect(r).toMatchObject({ pagado: 141232.6, saldoAnterior: 30000, estePago: 30000, Saldo: 0 })
  })

  it('factura en pesos', () => {
    const r = armarImputacionNc({ ...ecobuilding, currencyIso: null, rate: null, totalFactura: 1000, saldoaaplicar: 1000 }, 242)
    expect(r).toMatchObject({ totalFactura: 1000, estePago: 242, Saldo: 758 })
  })

  it('no imputa si la factura ya está saldada o los datos no cierran', () => {
    expect(armarImputacionNc({ ...ecobuilding, saldoaaplicar: 0 }, 100)).toBeNull()
    expect(armarImputacionNc({ ...ecobuilding, idTipoComprobante: 'NCV' }, 100)).toBeNull()
    expect(armarImputacionNc({ ...ecobuilding, rate: null }, 100)).toBeNull()
    expect(armarImputacionNc({ ...ecobuilding, fechaPago: '2026-10-08' }, 100)).toBeNull()
    expect(armarImputacionNc(ecobuilding, 0)).toBeNull()
  })
})
