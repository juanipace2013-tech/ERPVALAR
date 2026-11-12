import { describe, it, expect } from 'vitest'
import { armarAltaCobro, AltaCobroError, esCobrableFase1, type ImpagaCobroColppy, type PedidoAltaCobro } from '@/lib/cobros-colppy/alta-cobro'
import { estadoAplicaciones, validarPedidoCobro, CobroError } from '@/lib/cobros-colppy/registrar'

// Impaga real de JASKOWSKY (FacturaVenta/leer_facturas_a_cobrar, 10/11/2026)
const impagaMl: ImpagaCobroColppy = {
  idFactura: '54854713',
  nroFactura: '0007-00000279',
  tipoComprobante: 'FAV',
  fechaPago: '09-11-2026',
  descripcion: 'Venta Mercado Libre #2000015820511105 - CAE 86440667978821',
  totalFactura: 599275.76,
  cobrado: 0,
  saldoAnterior: 599275.76,
  Saldo: 599275.76,
  currency: null,
  rate: null,
  totalme: null,
  is_fce: '0',
}
// Segunda impaga del mismo cliente (inventada) para los casos con varias
const otraImpaga: ImpagaCobroColppy = { ...impagaMl, idFactura: '54900000', nroFactura: '0007-00000300', totalFactura: 100000, saldoAnterior: 100000, Saldo: 100000, descripcion: '' }
// Impaga real de LE GURIE en dólares
const impagaUsd: ImpagaCobroColppy = { ...impagaMl, idFactura: '55013602', nroFactura: '0007-00000311', totalFactura: '387711.5', saldoAnterior: '387711.5', Saldo: 387711.5, currency: 'USD', rate: '1570.000000', totalme: 246.95 }

const pedidoMl: PedidoAltaCobro = {
  idCliente: '14735302',
  idUsuario: 'usuario@colppy',
  fecha: '2026-11-02',
  nroRecibo1: '0001',
  nroRecibo2: '00012987',
  impagas: [impagaMl],
  cobros: { '54854713': 599275.76 },
  medios: [{ medio: 'Transferencia', cuenta: 'MERCADOPAGO', importe: 599275.76 }],
}

describe('alta_cobro (igual que la pantalla de Colppy)', () => {
  it('recibo real 0001-00012987 JASKOWSKY: mismo pedido que mandó Colppy', () => {
    const a = armarAltaCobro(pedidoMl)
    expect(a.totalAplicado).toBe(599275.76)
    expect(a.totalCobrado).toBe(599275.76)
    // Capturado del front de Colppy el 10/11/2026 (sin sesión ni idEmpresa)
    expect(a.parameters).toEqual({
      cobros: [
        {
          idFactura: '54854713',
          nroFactura: '0007-00000279',
          tipoComprobante: 'FAV',
          fechaPago: '09-11-2026',
          moneda: '',
          descripcion: 'Venta Mercado Libre #2000015820511105 - CAE 86440667978821',
          currency: null,
          tcCobroRate: '',
          rate: null,
          totalFactura: 599275.76,
          cobrado: 0,
          saldoAnterior: 599275.76,
          esteCobro: 599275.76,
          esteCobroMe: '',
          Saldo: 0,
          pagar: true,
        },
      ],
      mediospagos: [
        { idMedioCobro: 'Transferencia', idPlanCuenta: 'MERCADOPAGO', Banco: '', nroCheque: '', fechaValidez: '', importe: 599275.76, VAD: 'S', Conciliado: '', idTabla: 0, idElemento: 0, idItem: 0 },
      ],
      estesoreria: '0',
      idUsuario: 'usuario@colppy',
      idCobro: '',
      idCliente: '14735302',
      nroRecibo1: '0001',
      nroRecibo2: '00012987',
      fechaCobro: '02-11-2026',
      idEstadoCobro: 'Aprobado',
      descripcion: '',
      valorCambio: '0',
      totalEsteCobro: 599275.76,
      saldoFacturas: 0,
      anticipo: 0,
      descuentos: 0,
      intereses: 0,
      retencionIIBB: 0,
      totalACobrar: 599275.76,
      idMedioCobro: 'Transferencia',
      totalCobrado: 599275.76,
      retencionOtras: 0,
      retsufridas: [],
      retsufridasotras: [],
      diferenciaTipoCambio: 0,
    })
  })

  it('manda todas las impagas: las no cobradas con esteCobro 0 y pagar false', () => {
    const a = armarAltaCobro({ ...pedidoMl, impagas: [impagaMl, otraImpaga] })
    const cobros = a.parameters.cobros as Array<Record<string, unknown>>
    expect(cobros).toHaveLength(2)
    expect(cobros[1]).toMatchObject({ idFactura: '54900000', esteCobro: 0, pagar: false, Saldo: 100000 })
    expect(a.parameters.saldoFacturas).toBe(100000)
  })

  it('cobro parcial: deja el saldo restante', () => {
    const a = armarAltaCobro({ ...pedidoMl, cobros: { '54854713': 200000 }, medios: [{ medio: 'Transferencia', cuenta: 'Cta Cte Galicia', importe: 200000 }] })
    const cobros = a.parameters.cobros as Array<Record<string, unknown>>
    expect(cobros[0]).toMatchObject({ esteCobro: 200000, Saldo: 399275.76, pagar: true })
    expect(a.parameters.saldoFacturas).toBe(399275.76)
  })

  it('dos medios que suman lo aplicado', () => {
    const a = armarAltaCobro({
      ...pedidoMl,
      medios: [
        { medio: 'Transferencia', cuenta: 'Cta Cte Galicia', importe: 500000 },
        { medio: 'Transferencia', cuenta: 'MERCADOPAGO', importe: 99275.76 },
      ],
    })
    expect(a.totalCobrado).toBe(599275.76)
    expect(a.parameters.mediospagos).toHaveLength(2)
  })

  it('rechaza: medios que no cuadran, más que el saldo, comprobante que ya no está, número inválido', () => {
    const errores = (p: Partial<PedidoAltaCobro>) => {
      try {
        armarAltaCobro({ ...pedidoMl, ...p })
      } catch (e) {
        return (e as AltaCobroError).errores.join(' | ')
      }
      return ''
    }
    expect(errores({ medios: [{ medio: 'Transferencia', cuenta: 'MERCADOPAGO', importe: 599275 }] })).toContain('Los medios de cobro suman')
    expect(errores({ cobros: { '54854713': 600000 }, medios: [{ medio: 'Transferencia', cuenta: 'MERCADOPAGO', importe: 600000 }] })).toContain('el saldo es 599275.76')
    expect(errores({ cobros: { '1': 10 } })).toContain('ya no figura impago')
    expect(errores({ nroRecibo2: '12987' })).toContain('Número de recibo inválido')
    expect(errores({ medios: [] })).toContain('Falta el medio de cobro')
  })

  it('no cobra NC, comprobantes sin saldo, otras monedas ni dólares sin T/C', () => {
    expect(esCobrableFase1(impagaMl)).toEqual({ ok: true })
    expect(esCobrableFase1(impagaUsd)).toEqual({ ok: true })
    expect(esCobrableFase1({ ...impagaMl, tipoComprobante: 'NCV' })).toMatchObject({ ok: false })
    expect(esCobrableFase1({ ...impagaMl, Saldo: 0 })).toMatchObject({ ok: false })
    expect(esCobrableFase1({ ...impagaUsd, currency: 'EUR' })).toMatchObject({ ok: false })
    expect(esCobrableFase1({ ...impagaUsd, rate: null })).toMatchObject({ ok: false })
  })
})

describe('facturas en dólares cobradas en pesos', () => {
  // FAV 0007-00000154 de LE GURIE (recibo real 0001-00012880): USD 5.165,83 a T/C 1.535
  const fav154: ImpagaCobroColppy = {
    ...impagaMl,
    idFactura: '54577906',
    nroFactura: '0007-00000154',
    descripcion: '',
    totalFactura: '7929549.05',
    saldoAnterior: '7929549.05',
    Saldo: 7929549.05,
    currency: 'USD',
    rate: '1535.000000',
    totalme: 5165.83,
  }
  const base: PedidoAltaCobro = { ...pedidoMl, idCliente: '11328281', impagas: [fav154], cobros: { '54577906': 7929549.05 } }

  it('al T/C del cobro: la diferencia de cambio da igual que en el recibo real (51.658,30)', () => {
    const a = armarAltaCobro({ ...base, tcCobro: { '54577906': 1545 }, medios: [{ medio: 'Transferencia', cuenta: 'Cta Cte Galicia', importe: 7981207.35 }] })
    expect(a.totalAplicado).toBe(7929549.05)
    expect(a.diferenciaCambio).toBe(51658.3)
    expect(a.parameters).toMatchObject({ totalEsteCobro: 7929549.05, diferenciaTipoCambio: 51658.3, totalACobrar: 7981207.35, totalCobrado: 7981207.35, saldoFacturas: 0 })
    const fila = (a.parameters.cobros as Array<Record<string, unknown>>)[0]
    expect(fila).toMatchObject({ currency: 'USD', rate: '1535.000000', tcCobroRate: 1545, esteCobro: 7929549.05, Saldo: 0, pagar: true })
    expect(String(fila.totalme)).toMatch(/^USD-5165\.83/)
  })

  it('al T/C de la factura: sin diferencia de cambio', () => {
    const a = armarAltaCobro({ ...base, medios: [{ medio: 'Transferencia', cuenta: 'Cta Cte Galicia', importe: 7929549.05 }] })
    expect(a.diferenciaCambio).toBe(0)
    expect(a.parameters).toMatchObject({ diferenciaTipoCambio: 0, totalACobrar: 7929549.05 })
    expect((a.parameters.cobros as Array<Record<string, unknown>>)[0]).toMatchObject({ tcCobroRate: 1535 })
  })

  it('T/C del cobro menor al de la factura: diferencia negativa', () => {
    const a = armarAltaCobro({ ...base, tcCobro: { '54577906': 1500 }, medios: [{ medio: 'Transferencia', cuenta: 'Cta Cte Galicia', importe: 7748745 }] })
    expect(a.diferenciaCambio).toBe(-180804.05)
    expect(a.parameters.totalACobrar).toBe(7748745)
  })

  it('pesos y dólares en el mismo recibo; la factura en dólares no cobrada va sin diferencia', () => {
    const a = armarAltaCobro({ ...pedidoMl, impagas: [impagaMl, fav154], tcCobro: {} })
    expect(a.diferenciaCambio).toBe(0)
    const cobros = a.parameters.cobros as Array<Record<string, unknown>>
    expect(cobros[0]).toMatchObject({ tcCobroRate: '', currency: null })
    expect(cobros[1]).toMatchObject({ esteCobro: 0, pagar: false, tcCobroRate: 1535 })
  })

  it('rechaza: medios al T/C equivocado y T/C disparatado', () => {
    expect(() => armarAltaCobro({ ...base, tcCobro: { '54577906': 1545 }, medios: [{ medio: 'Transferencia', cuenta: 'Cta Cte Galicia', importe: 7929549.05 }] })).toThrow(/total a cobrar es 7981207.35/)
    expect(() => armarAltaCobro({ ...base, tcCobro: { '54577906': 15.45 }, medios: [{ medio: 'Transferencia', cuenta: 'Cta Cte Galicia', importe: 79812.07 }] })).toThrow(/muy lejos/)
  })
})

describe('verificación de un cobro incierto por saldos', () => {
  const apps = [
    { colppyInvoiceId: 'A', previousBalance: 1000, amount: 1000 },
    { colppyInvoiceId: 'B', previousBalance: 500, amount: 200 },
  ]
  it('aplicado: la cobrada entera ya no figura y la parcial bajó', () => {
    expect(estadoAplicaciones(apps, new Map([['B', 300]]))).toBe('APLICADO')
  })
  it('sin aplicar: todo sigue con el saldo de antes', () => {
    expect(
      estadoAplicaciones(
        apps,
        new Map([
          ['A', 1000],
          ['B', 500],
        ])
      )
    ).toBe('SIN_APLICAR')
  })
  it('dudoso: una bajó y la otra no, o no hay aplicaciones', () => {
    expect(estadoAplicaciones(apps, new Map([['B', 500]]))).toBe('DUDOSO')
    expect(estadoAplicaciones([], new Map())).toBe('DUDOSO')
  })
})

describe('validación del pedido de cobro', () => {
  const ok = {
    idempotencyKey: '0b0e4c1e-7a57-4c3b-9d55-0d6f0c2a9b11',
    customerId: 'c1',
    fecha: '2026-11-02',
    cobros: { '54854713': 599275.76 },
    medios: [{ cuenta: 'MERCADOPAGO', importe: 599275.76 }],
  }
  it('acepta un pedido completo', () => {
    expect(validarPedidoCobro(ok)).toMatchObject({ customerId: 'c1', cobros: { '54854713': 599275.76 }, medios: [{ cuenta: 'MERCADOPAGO', importe: 599275.76 }] })
  })
  it('rechaza sin clave, sin comprobantes o con medios incompletos', () => {
    expect(() => validarPedidoCobro({ ...ok, idempotencyKey: 'x' })).toThrow(CobroError)
    expect(() => validarPedidoCobro({ ...ok, cobros: {} })).toThrow(CobroError)
    expect(() => validarPedidoCobro({ ...ok, medios: [{ cuenta: '', importe: 1 }] })).toThrow(CobroError)
  })
})

describe('cobro con e-cheq recibido', () => {
  // Recibo real 0001-00013016 de ZEN INGENIERIA (12/11/2026): FAV en USD al T/C de la factura, e-cheq Santander
  const fav317: ImpagaCobroColppy = { ...impagaMl, idFactura: '55067191', nroFactura: '0007-00000317', descripcion: 'Factura de Ventas', totalFactura: '65783', saldoAnterior: '65783', Saldo: 65783, currency: 'USD', rate: '1570.000000', totalme: 41.9 }
  const base: PedidoAltaCobro = {
    ...pedidoMl,
    idCliente: '1218332',
    fecha: '2026-11-12',
    nroRecibo2: '00013016',
    impagas: [fav317],
    cobros: { '55067191': 65783 },
    medios: [{ medio: 'Echeqs', cuenta: '', banco: 'SANTANDER RIO', numero: '00002751', fechaPago: '2026-11-26', importe: 65783 }],
  }

  it('manda el e-cheq como la grilla de Colppy: Valores a Depositar, número sin ceros y fecha DD/MM/AAAA', () => {
    const a = armarAltaCobro(base)
    expect(a.parameters.mediospagos).toEqual([
      { idMedioCobro: 'Echeqs', idPlanCuenta: 'Valores a Depositar', Banco: 'SANTANDER RIO', nroCheque: 2751, fechaValidez: '26/11/2026', importe: 65783, VAD: 'S', Conciliado: '', idTabla: 0, idElemento: 0, idItem: 0 },
    ])
    expect(a.parameters).toMatchObject({ idMedioCobro: 'Echeqs', totalACobrar: 65783, totalCobrado: 65783, diferenciaTipoCambio: 0 })
  })

  it('e-cheq y transferencia en el mismo recibo', () => {
    const a = armarAltaCobro({
      ...base,
      medios: [
        { medio: 'Echeqs', cuenta: '', banco: 'ICBC', numero: '14719505', fechaPago: '2026-11-09', importe: 60000 },
        { medio: 'Transferencia', cuenta: 'Cta Cte Galicia', importe: 5783 },
      ],
    })
    expect(a.totalCobrado).toBe(65783)
    expect((a.parameters.mediospagos as Array<Record<string, unknown>>)[1]).toMatchObject({ idMedioCobro: 'Transferencia', idPlanCuenta: 'Cta Cte Galicia', nroCheque: '', fechaValidez: '' })
  })

  it('rechaza un e-cheq sin banco, número o fecha', () => {
    expect(() => armarAltaCobro({ ...base, medios: [{ medio: 'Echeqs', cuenta: '', banco: '', numero: 'x', importe: 65783 }] })).toThrow(/banco del e-cheq/)
    expect(() => validarPedidoCobro({ idempotencyKey: '0b0e4c1e-7a57-4c3b-9d55-0d6f0c2a9b11', customerId: 'c1', fecha: '2026-11-12', cobros: { '55067191': 65783 }, medios: [{ medio: 'Echeqs', banco: 'ICBC', numero: '', fechaPago: '2026-11-26', importe: 65783 }] })).toThrow(CobroError)
    expect(validarPedidoCobro({ idempotencyKey: '0b0e4c1e-7a57-4c3b-9d55-0d6f0c2a9b11', customerId: 'c1', fecha: '2026-11-12', cobros: { '55067191': 65783 }, medios: [{ medio: 'Echeqs', banco: 'ICBC', numero: '2751', fechaPago: '2026-11-26', importe: 65783 }] }).medios[0]).toMatchObject({ medio: 'Echeqs', banco: 'ICBC', numero: '2751', fechaPago: '2026-11-26' })
  })
})
