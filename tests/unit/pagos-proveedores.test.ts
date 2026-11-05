import { describe, it, expect } from 'vitest'
import genebre from '../fixtures/pagos-proveedores/genebre-sep2026.json'
import { calcularRetencion78, acumuladoPrevio, type PagoPrevioMes } from '@/lib/pagos-proveedores/retencion'
import { armarAltaPago, AltaPagoError, esPagableFase1, type ImpagaColppy } from '@/lib/pagos-proveedores/alta-pago'

// Impagas reales de BMS (Proveedor/facturas_impagas_proveedor, 5/11/2026)
const impagaBase = { tipoComprobante: 'FAC', RG: '78', moneda: '', currency: null, totalme: null, rate: null, pagado: 0, percepcionIVA: '0.00' }
const impagasBms: ImpagaColppy[] = [
  { ...impagaBase, idFactura: '24296591', nroFactura: '00006-00011271', fechaPago: '30-10-2026', totalFactura: '588876.75', saldoAnterior: 588876.75, Saldo: 588876.75 },
  { ...impagaBase, idFactura: '24341715', nroFactura: '00006-00011356', fechaPago: '05-11-2026', totalFactura: '1173942.00', saldoAnterior: 1173942, Saldo: 1173942 },
  { ...impagaBase, idFactura: '24362285', nroFactura: '00006-00011384', fechaPago: '06-11-2026', totalFactura: '3842211.54', saldoAnterior: 3842211.54, Saldo: 3842211.54 },
  { ...impagaBase, idFactura: '24536244', nroFactura: '00006-00011571', fechaPago: '20-11-2026', totalFactura: '1247207.50', saldoAnterior: 1247207.5, Saldo: 1247207.5 },
]
// Netos (FacturaCompra/leer_facturacompra)
const netosBms = [
  { estePago: 588876.75, totalFactura: 588876.75, netoGravado: 486675, netoNoGravado: 0 },
  { estePago: 1173942, totalFactura: 1173942, netoGravado: 970200, netoNoGravado: 0 },
  { estePago: 3842211.54, totalFactura: 3842211.54, netoGravado: 3175381.44, netoNoGravado: 0 },
]

describe('retención Ganancias régimen 78 (igual que Colppy)', () => {
  it('OP real 0001-00005506 BMS: base 4.632.256,44 → 88.165,13', () => {
    const r = calcularRetencion78(netosBms, [])
    expect(r.baseEstePago).toBe(4632256.44)
    expect(r.baseAcumulada).toBe(4632256.44)
    expect(r.retencion).toBe(88165.13)
    expect(r.avisos).toEqual([])
  })

  it('GENEBRE 2/9/2026 (68 facturas con percepciones): base 176.876.183,58 → 3.533.043,67', () => {
    const r = calcularRetencion78(genebre.op5301, [])
    expect(r.baseEstePago).toBe(176876183.58)
    expect(r.retencion).toBe(3533043.67)
  })

  it('GENEBRE 22/9/2026, segundo pago del mes: acumula sobre el primero → 232.985.048,67 y 1.122.177,30', () => {
    const previo: PagoPrevioMes = { idPago: '9316808', nroPago: '0001-00005301', fecha: '02/09/2026', idRetGanancias1: '78', baseCalculo1: 176876183.58, retGanancias1: 3533043.67 }
    const r = calcularRetencion78(genebre.op5372, [previo])
    expect(r.basePrevia).toBe(176876183.58)
    expect(r.baseAcumulada).toBe(232985048.67)
    expect(r.retencion).toBe(1122177.3)
  })

  it('debajo del mínimo no retiene, pero la base acumulada queda', () => {
    const r = calcularRetencion78([{ estePago: 121000, totalFactura: 121000, netoGravado: 100000, netoNoGravado: 0 }], [])
    expect(r).toMatchObject({ baseAcumulada: 100000, retencion: 0 })
  })

  it('pago parcial: neto proporcional', () => {
    const r = calcularRetencion78([{ estePago: 605000, totalFactura: 1210000, netoGravado: 1000000, netoNoGravado: 0 }], [])
    expect(r.baseEstePago).toBe(500000)
    expect(r.retencion).toBe(5520)
  })

  it('pagos previos: usa la base del último (es acumulada) y suma lo retenido; avisa los que no tienen régimen', () => {
    const a = acumuladoPrevio([
      { idPago: '1', nroPago: '0001-1', fecha: '', idRetGanancias1: '78', baseCalculo1: 300000, retGanancias1: 1520 },
      { idPago: '2', nroPago: '0001-2', fecha: '', idRetGanancias1: '78', baseCalculo1: 500000, retGanancias1: 4000 },
      { idPago: '3', nroPago: '0001-3', fecha: '', idRetGanancias1: '0', baseCalculo1: 0, retGanancias1: 0 },
    ])
    expect(a.basePrevia).toBe(500000)
    expect(a.retenidoPrevio).toBe(5520)
    expect(a.avisos[0]).toContain('0001-3')
  })

  it('pago anulado en el medio del mes: no infla la base de los siguientes', () => {
    // A neto 1.000.000 (anulado), B neto 500.000 guardado con base acumulada 1.500.000
    const a = acumuladoPrevio([
      { idPago: '1', nroPago: '0001-00000010', fecha: '', idRetGanancias1: '78', baseCalculo1: 1000000, retGanancias1: 15520, anulado: true },
      { idPago: '2', nroPago: '0001-00000011', fecha: '', idRetGanancias1: '78', baseCalculo1: 1500000, retGanancias1: 10000 },
    ])
    expect(a.basePrevia).toBe(500000)
    expect(a.retenidoPrevio).toBe(10000)
    expect(a.avisos.join(' ')).toMatch(/anulado/)
    // C neto 300.000: base 800.000 → (800.000 − 224.000) × 2 % − 10.000 = 1.520
    const r = calcularRetencion78([{ estePago: 363000, totalFactura: 363000, netoGravado: 300000, netoNoGravado: 0 }], [
      { idPago: '1', nroPago: '0001-00000010', fecha: '', idRetGanancias1: '78', baseCalculo1: 1000000, retGanancias1: 15520, anulado: true },
      { idPago: '2', nroPago: '0001-00000011', fecha: '', idRetGanancias1: '78', baseCalculo1: 1500000, retGanancias1: 10000 },
    ])
    expect(r.retencion).toBe(1520)
  })

  it('anulado y bases que no crecen: usa la mayor vigente y avisa', () => {
    const a = acumuladoPrevio([
      { idPago: '1', nroPago: '0001-00000010', fecha: '', idRetGanancias1: '78', baseCalculo1: 1000000, retGanancias1: 15520, anulado: true },
      { idPago: '2', nroPago: '0001-00000011', fecha: '', idRetGanancias1: '78', baseCalculo1: 400000, retGanancias1: 3520 },
    ])
    expect(a.basePrevia).toBe(400000)
    expect(a.avisos.join(' ')).toMatch(/no van creciendo/)
  })

  it('un anulado sin régimen no genera el aviso de "sin retención"', () => {
    const a = acumuladoPrevio([{ idPago: '3', nroPago: '0001-3', fecha: '', idRetGanancias1: '0', baseCalculo1: 0, retGanancias1: 0, anulado: true }])
    expect(a.avisos).toEqual([])
  })

  it('nunca da negativo si ya se retuvo de más', () => {
    const r = calcularRetencion78([{ estePago: 1210, totalFactura: 1210, netoGravado: 1000, netoNoGravado: 0 }], [
      { idPago: '1', nroPago: 'x', fecha: '', idRetGanancias1: '78', baseCalculo1: 300000, retGanancias1: 99999 },
    ])
    expect(r.retencion).toBe(0)
  })
})

describe('armarAltaPago (formato capturado del front de Colppy)', () => {
  const pedidoBms = {
    idProveedor: '493365',
    fecha: '2026-11-05',
    nroPago1: '0001',
    nroPago2: '00005506',
    impagas: impagasBms,
    pagos: { '24296591': 588876.75, '24341715': 1173942, '24362285': 3842211.54 },
    retencion: { regimen: '78', baseAcumulada: 4632256.44, importe: 88165.13 },
    medios: [{ medio: 'Transferencia' as const, cuenta: 'Cta Cte Galicia', importe: 5516865.16 }],
  }

  it('reproduce el alta_pago real de la OP 0001-00005506', () => {
    const r = armarAltaPago(pedidoBms)
    expect(r).toMatchObject({ totalFacturas: 5605030.29, retencion: 88165.13, totalPagado: 5516865.16 })
    expect(r.parameters).toMatchObject({
      idPago: '',
      idProveedor: '493365',
      fechaPago: '05-11-2026',
      valorCambio: '0',
      totalpagado: 5516865.16,
      idEstadoPago: 'Aprobado',
      totalFacturas: 5605030.29,
      anticipo: 0,
      descuentos: 0,
      intereses: 0,
      idRetGanancias1: '78',
      baseCalculo1: 4632256.44,
      retGanancias1: 88165.13,
      retemitidas: [],
      retencionIIBB: 0,
      nroPago1: '0001',
      nroPago2: '00005506',
      descripcion: '',
      diferenciaTipoCambio: 0,
      origen: 'proveedores',
    })
    const recs = JSON.parse(r.parameters.recordsToInsertUpdate as string) as any[]
    expect(recs).toHaveLength(4)
    // Primer renglón: idéntico al capturado
    expect(recs[0]).toEqual({
      idFactura: '24296591', nroFactura: '00006-00011271', RETE: '', percepcionIVA: '0.00', tipoComprobante: 'FAC',
      fechaPago: '30-10-2026', RG: '78', moneda: '', rate: null, currency: null, totalme: null, totalFactura: '588876.75',
      pagado: 0, saldoAnterior: 588876.75, estePago: 588876.75, tcPagoRate: '', Saldo: 0, pagar: true, saldoNC: '',
      retencionAcumulada: '0.00',
    })
    // La que no se paga va igual, con pagar:false
    expect(recs[3]).toMatchObject({ idFactura: '24536244', estePago: 0, Saldo: 1247207.5, pagar: false, retencionAcumulada: 0 })
    expect(JSON.parse(r.parameters.recordsToInsertUpdate1 as string)).toEqual([
      { idMedioPago: 'Transferencia', idPlanCuenta: 'Cta Cte Galicia', nroCheque: '', fechaValidez: '05/11/2026', importe: 5516865.16, idTabla: 0, idElemento: 0, idItem: 0, CED: 'S', Conciliado: '', Moneda: '' },
    ])
  })

  it('pago parcial: Saldo = saldo − estePago', () => {
    const r = armarAltaPago({ ...pedidoBms, pagos: { '24296591': 100000 }, retencion: null, medios: [{ medio: 'Transferencia', cuenta: 'Cta Cte Galicia', importe: 100000 }] })
    const recs = JSON.parse(r.parameters.recordsToInsertUpdate as string) as any[]
    expect(recs[0]).toMatchObject({ estePago: 100000, Saldo: 488876.75, pagar: true })
    expect(r.parameters).toMatchObject({ idRetGanancias1: '', baseCalculo1: '', retGanancias1: 0, totalpagado: 100000 })
  })

  it('con régimen y retención 0 (debajo del mínimo) igual manda la base para que acumule', () => {
    const r = armarAltaPago({ ...pedidoBms, pagos: { '24296591': 100000 }, retencion: { regimen: '78', baseAcumulada: 82644.63, importe: 0 }, medios: [{ medio: 'Transferencia', cuenta: 'Cta Cte Galicia', importe: 100000 }] })
    expect(r.parameters).toMatchObject({ idRetGanancias1: '78', baseCalculo1: 82644.63, retGanancias1: 0 })
  })

  it('varias transferencias que suman el total', () => {
    const r = armarAltaPago({ ...pedidoBms, medios: [{ medio: 'Transferencia', cuenta: 'Cta Cte Galicia', importe: 5000000 }, { medio: 'Transferencia', cuenta: 'MERCADOPAGO', importe: 516865.16 }] })
    expect((JSON.parse(r.parameters.recordsToInsertUpdate1 as string) as any[]).map((m) => m.idPlanCuenta)).toEqual(['Cta Cte Galicia', 'MERCADOPAGO'])
  })

  it('tarjeta de crédito: medio "Tarjeta de Crédito" con la tarjeta por nombre (front de Colppy)', () => {
    const r = armarAltaPago({
      ...pedidoBms,
      pagos: { '24296591': 588876.75 },
      retencion: null,
      medios: [{ medio: 'Tarjeta de Crédito', cuenta: 'TARJETA GALICIA', importe: 588876.75 }],
    })
    expect(JSON.parse(r.parameters.recordsToInsertUpdate1 as string)).toEqual([
      { idMedioPago: 'Tarjeta de Crédito', idPlanCuenta: 'TARJETA GALICIA', nroCheque: '', fechaValidez: '', importe: 588876.75, idTabla: 0, idElemento: 0, idItem: 0, CED: 'S', Conciliado: '', Moneda: '' },
    ])
  })

  it('rechaza medios que Colppy usa pero el ERP todavía no (cheques, efectivo)', () => {
    expect(() =>
      armarAltaPago({ ...pedidoBms, medios: [{ medio: 'Echeqs' as never, cuenta: 'Cta Cte Galicia', importe: 5516865.16 }] })
    ).toThrow(/Medio de pago no soportado todavía: Echeqs/)
  })

  it('rechaza medios que no cierran con el total a pagar', () => {
    expect(() => armarAltaPago({ ...pedidoBms, medios: [{ medio: 'Transferencia', cuenta: 'Cta Cte Galicia', importe: 5605030.29 }] })).toThrow(/suman 5605030.29 y el total a pagar es 5516865.16/)
  })

  it('rechaza pagar más que el saldo, facturas que ya no están impagas y NC/moneda extranjera', () => {
    const e = (() => {
      try {
        armarAltaPago({
          ...pedidoBms,
          impagas: [
            ...impagasBms,
            { ...impagaBase, idFactura: '9', nroFactura: '00001-00000009', tipoComprobante: 'NC', fechaPago: '01-11-2026', totalFactura: '-1000', saldoAnterior: -1000, Saldo: -1000 },
          ],
          pagos: { '24296591': 600000, '777': 10, '9': 5 },
          retencion: null,
          medios: [{ medio: 'Transferencia', cuenta: 'Cta Cte Galicia', importe: 600015 }],
        })
      } catch (err) {
        return err as AltaPagoError
      }
    })()
    expect(e).toBeInstanceOf(AltaPagoError)
    expect(e!.errores.join('\n')).toMatch(/777 ya no figura impaga/)
    expect(e!.errores.join('\n')).toMatch(/00006-00011271: se paga 600000 y el saldo es 588876.75/)
    expect(e!.errores.join('\n')).toMatch(/00001-00000009: NC/)
  })

  it('fase 1: solo facturas en pesos con saldo', () => {
    expect(esPagableFase1(impagasBms[0]).ok).toBe(true)
    expect(esPagableFase1({ ...impagasBms[0], moneda: 'USD' }).ok).toBe(false)
    expect(esPagableFase1({ ...impagasBms[0], tipoComprobante: 'NC' }).ok).toBe(false)
    expect(esPagableFase1({ ...impagasBms[0], Saldo: 0 }).ok).toBe(false)
  })

  it('rechaza número de OP, fecha o proveedor inválidos', () => {
    expect(() => armarAltaPago({ ...pedidoBms, nroPago2: '5506' })).toThrow(/Número de OP inválido/)
    expect(() => armarAltaPago({ ...pedidoBms, fecha: '05/11/2026' })).toThrow(/Fecha inválida/)
    expect(() => armarAltaPago({ ...pedidoBms, idProveedor: '' })).toThrow(/Proveedor sin id de Colppy/)
  })
})
