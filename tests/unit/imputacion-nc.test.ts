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
const ncUsd = { total: 37.06, moneda: 'USD' as const, tipoCambio: 1540 }

describe('armarImputacionNc', () => {
  it('NC USD de 1 unidad: estePago en dólares (Colppy lo pasa a pesos), saldos de la factura en pesos', () => {
    expect(armarImputacionNc(ecobuilding, ncUsd)).toEqual({
      item: {
        idFactura: '54195420',
        nroFactura: '0007-00000005',
        tipoComprobante: 'FAV',
        fechaPago: '08-10-2026',
        RG: null,
        moneda: 'P',
        totalFactura: 171232.6,
        pagado: 0,
        saldoAnterior: 171232.6,
        estePago: 37.06,
        Saldo: 114160.2,
        pagar: true,
      },
      saldoEsperadoArs: 114160.2,
    })
  })

  it('caso real SIDERCA: NC total USD 316,32 a 1.508,5 → 477.168,72 aplicados', () => {
    const r = armarImputacionNc(
      { ...ecobuilding, idFactura: '53896857', nroFactura: '0003-00015282', totalFactura: 316.32, rate: '1508.5', saldoaaplicar: 477168.72 },
      { total: 316.32, moneda: 'USD', tipoCambio: 1508.5 }
    )
    expect(r?.item.estePago).toBe(316.32)
    expect(r?.saldoEsperadoArs).toBe(0)
  })

  it('factura con cobros parciales: aplica hasta el saldo (en la moneda de la NC)', () => {
    const r = armarImputacionNc({ ...ecobuilding, saldoaaplicar: 30800 }, ncUsd)
    expect(r?.item).toMatchObject({ pagado: 140432.6, saldoAnterior: 30800, estePago: 20, Saldo: 0 })
  })

  it('NC y factura en pesos', () => {
    const r = armarImputacionNc(
      { ...ecobuilding, currencyIso: null, rate: null, totalFactura: 1000, saldoaaplicar: 1000 },
      { total: 242, moneda: 'ARS', tipoCambio: 1 }
    )
    expect(r?.item).toMatchObject({ totalFactura: 1000, estePago: 242, Saldo: 758 })
  })

  it('no imputa si la factura ya está saldada o los datos no cierran', () => {
    expect(armarImputacionNc({ ...ecobuilding, saldoaaplicar: 0 }, ncUsd)).toBeNull()
    expect(armarImputacionNc({ ...ecobuilding, idTipoComprobante: 'NCV' }, ncUsd)).toBeNull()
    expect(armarImputacionNc({ ...ecobuilding, rate: null }, ncUsd)).toBeNull()
    expect(armarImputacionNc({ ...ecobuilding, fechaPago: '2026-10-08' }, ncUsd)).toBeNull()
    expect(armarImputacionNc(ecobuilding, { ...ncUsd, total: 0 })).toBeNull()
    expect(armarImputacionNc(ecobuilding, { ...ncUsd, tipoCambio: 0 })).toBeNull()
  })
})
