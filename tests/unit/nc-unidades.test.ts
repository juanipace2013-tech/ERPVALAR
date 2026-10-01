import { describe, it, expect } from 'vitest'
import {
  acreditadoVacio,
  calcularImportesNc,
  calcularNcImporte,
  calcularNcUnidades,
  claveLinea,
  lineasAcreditables,
  parseNumeroAr,
  prepararContextoNc,
  vincularLineasFactura,
  type ItemFacturaVinculable,
} from '@/lib/facturacion/nc-unidades'

const linea = (over: Record<string, unknown>) => ({
  idItem: 123, tipoItem: 'P', codigo: '3302 08', Descripcion: 'Filtro Y 3302 08', ImporteUnitario: 30.63,
  subtotal: 91.89, IVA: 21, Cantidad: 3, porcDesc: 0, ...over,
})

type Payload = Parameters<typeof lineasAcreditables>[0]

/** Líneas + contexto como lo arma el servidor */
function preparar(
  p: Payload,
  factura: { neto: number; iva: number },
  ncs: Array<{ subtotal: number; taxAmount: number; porImporte?: boolean }> = [],
  acreditado = acreditadoVacio()
) {
  return prepararContextoNc(lineasAcreditables(p, acreditado), factura, ncs)
}

describe('NC por unidades', () => {
  const payloadA = { tipoFactura: 'A' as const, items: [linea({})] }
  const facturaA = { neto: 91.89, iva: 19.3 }

  it('1 de 3 unidades: neto, IVA y línea de Colppy con el artículo (devuelve stock)', () => {
    const { lineas, contexto } = preparar(payloadA, facturaA)
    const r = calcularNcUnidades(payloadA, lineas, [{ index: 0, cantidad: 1 }], contexto)
    expect(r.neto).toBe(30.63)
    expect(r.iva).toBe(6.43)
    expect(r.total).toBe(37.06)
    expect(r.lineasColppy[0]).toMatchObject({ idItem: 123, tipoItem: 'P', codigo: '3302 08', Cantidad: 1, subtotal: 30.63 })
    expect(r.devuelveTodo).toBe(false)
  })

  it('no deja devolver más de lo disponible (descuenta NC anteriores por índice de línea)', () => {
    const acc = acreditadoVacio()
    acc.porIndice.set(0, 2)
    const { lineas, contexto } = preparar(payloadA, facturaA, [{ subtotal: 61.26, taxAmount: 12.86 }], acc)
    expect(lineas[0].cantidadDisponible).toBe(1)
    expect(() => calcularNcUnidades(payloadA, lineas, [{ index: 0, cantidad: 2 }], contexto)).toThrow(/como máximo 1/)
  })

  it('NC viejas sin índice: descuenta por código+descripción', () => {
    const acc = acreditadoVacio()
    acc.porClave.set(claveLinea('3302 08', 'Filtro Y 3302 08'), 2)
    expect(lineasAcreditables(payloadA, acc)[0].cantidadDisponible).toBe(1)
  })

  it('respeta el descuento de la línea (bonificación de la cotización)', () => {
    const p = { tipoFactura: 'A' as const, items: [linea({ ImporteUnitario: 100, porcDesc: 10, Cantidad: 2, subtotal: 180 })] }
    const { lineas, contexto } = preparar(p, { neto: 180, iva: 37.8 })
    const r = calcularNcUnidades(p, lineas, [{ index: 0, cantidad: 1 }], contexto)
    expect(r.neto).toBe(90)
    expect(r.lineasColppy[0].subtotal).toBe(90)
  })

  it('Factura B: el precio de la línea es final (con IVA) → neto = precio / 1,21', () => {
    const p = { tipoFactura: 'B' as const, items: [linea({ ImporteUnitario: 121, Cantidad: 2, subtotal: 242 })] }
    const { lineas, contexto } = preparar(p, { neto: 200, iva: 42 })
    const r = calcularNcUnidades(p, lineas, [{ index: 0, cantidad: 1 }], contexto)
    expect(r.neto).toBe(100)
    expect(r.total).toBe(121)
  })

  it('devolver todo sin NC previas se marca como total y toma el encabezado exacto', () => {
    const { lineas, contexto } = preparar(payloadA, facturaA)
    const r = calcularNcUnidades(payloadA, lineas, [{ index: 0, cantidad: 3 }], contexto)
    expect(r.devuelveTodo).toBe(true)
    expect(r.total).toBe(111.19)
  })

  it('línea sin artículo de inventario: no mueve stock', () => {
    const p = { tipoFactura: 'A' as const, items: [linea({ idItem: 0, tipoItem: '', codigo: '' })] }
    expect(lineasAcreditables(p, acreditadoVacio())[0].conStock).toBe(false)
  })

  it('la misma línea repetida se suma y no supera lo facturado', () => {
    const { lineas, contexto } = preparar(payloadA, facturaA)
    expect(() =>
      calcularNcUnidades(payloadA, lineas, [{ index: 0, cantidad: 2 }, { index: 0, cantidad: 2 }], contexto)
    ).toThrow(/como máximo 3/)
    const r = calcularNcUnidades(payloadA, lineas, [{ index: 0, cantidad: 1 }, { index: 0, cantidad: 1 }], contexto)
    expect(r.lineasColppy).toHaveLength(1)
    expect(r.lineasColppy[0].Cantidad).toBe(2)
  })

  it('rechaza fracciones de unidad, índices inválidos y cantidades negativas', () => {
    const { lineas, contexto } = preparar(payloadA, facturaA)
    expect(() => calcularImportesNc(lineas, [{ index: 0, cantidad: 0.333 }], contexto)).toThrow(/entero/)
    expect(() => calcularImportesNc(lineas, [{ index: 0.5, cantidad: 1 }], contexto)).toThrow(/inexistente/)
    expect(() => calcularImportesNc(lineas, [{ index: 5, cantidad: 1 }], contexto)).toThrow(/inexistente/)
    expect(() => calcularImportesNc(lineas, [{ index: 0, cantidad: -1 }], contexto)).toThrow(/inválida/)
    expect(() => calcularImportesNc(lineas, [{ index: 0, cantidad: NaN }], contexto)).toThrow(/inválida/)
  })

  it('después de un ajuste por importe, las unidades se acreditan en proporción y devolver todo cierra exacto', () => {
    // 10 × 100 = 1000 neto; NC por importe previa de 200 neto
    const p = { tipoFactura: 'A' as const, items: [linea({ ImporteUnitario: 100, Cantidad: 10, subtotal: 1000 })] }
    const { lineas, contexto } = preparar(p, { neto: 1000, iva: 210 }, [{ subtotal: 200, taxAmount: 42, porImporte: true }])
    expect(contexto.factor).toBeCloseTo(0.8)
    // 8 unidades = 640, y las 2 últimas = 160 (antes quedaban bloqueadas)
    const r8 = calcularNcUnidades(p, lineas, [{ index: 0, cantidad: 8 }], contexto)
    expect(r8.neto).toBe(640)
    expect(r8.lineasColppy[0]).toMatchObject({ ImporteUnitario: 80, Cantidad: 8, subtotal: 640 })
    expect(r8.netoFactura).toBe(800) // base de la comisión: precio de factura
    const todo = calcularNcUnidades(p, lineas, [{ index: 0, cantidad: 10 }], contexto)
    expect(todo.neto).toBe(800)
    expect(todo.iva).toBe(168)
    expect(todo.devuelveTodo).toBe(false) // hubo NC antes: no es NC total
    expect(todo.agotaTodo).toBe(true)
    expect(todo.lineasColppy[0].subtotal).toBe(800) // líneas = encabezado
  })

  it('diferencias de centavos por redondeo no generan factor', () => {
    const p = { tipoFactura: 'A' as const, items: [linea({ ImporteUnitario: 33.333, Cantidad: 3, subtotal: 100 })] }
    expect(preparar(p, { neto: 100, iva: 21 }).contexto.factor).toBe(1)
    // ML (precio con IVA / 1,21): 10 × 826,45 = 8264,50 vs encabezado 8264,46, sin NC previas
    const ml = { tipoFactura: 'A' as const, items: [linea({ ImporteUnitario: 826.45, Cantidad: 10, subtotal: 8264.5 })] }
    expect(preparar(ml, { neto: 8264.46, iva: 1735.54 }).contexto.factor).toBe(1)
    // Después de NC por unidades (no por importe) tampoco
    const acc = acreditadoVacio()
    acc.porIndice.set(0, 2)
    expect(preparar(ml, { neto: 8264.46, iva: 1735.54 }, [{ subtotal: 1652.9, taxAmount: 347.11 }], acc).contexto.factor).toBe(1)
  })

  it('ajuste por importe: tope, saldo exacto y el total de la factura va por NC total', () => {
    const ctx = { netoPendiente: 99.45, ivaPendiente: 20.89, hayNcPrevias: true }
    expect(calcularNcImporte(50, ctx)).toEqual({ neto: 50, iva: 10.5, total: 60.5 })
    expect(calcularNcImporte(99.45, ctx)).toEqual({ neto: 99.45, iva: 20.89, total: 120.34 })
    expect(() => calcularNcImporte(100, ctx)).toThrow(/supera el neto pendiente/)
    expect(() => calcularNcImporte(0, ctx)).toThrow(/mayor a cero/)
    expect(() => calcularNcImporte(1000, { netoPendiente: 1000, ivaPendiente: 210, hayNcPrevias: false })).toThrow(/NC total/)
  })

  it('devolver lo último que queda toma el remanente exacto del encabezado', () => {
    const acc = acreditadoVacio()
    acc.porIndice.set(0, 1)
    const { lineas, contexto } = preparar(payloadA, facturaA, [{ subtotal: 30.63, taxAmount: 6.43 }], acc)
    const r = calcularNcUnidades(payloadA, lineas, [{ index: 0, cantidad: 2 }], contexto)
    expect(r.neto).toBe(61.26)
    expect(r.iva).toBe(12.87) // 19,30 − 6,43, no 61,26 × 0,21 = 12,86
  })
})

describe('vincularLineasFactura', () => {
  const item = (id: string, over: Partial<ItemFacturaVinculable> = {}): ItemFacturaVinculable => ({
    id, quoteItemId: `q-${id}`, quantity: 2, codigos: [], nombres: [], adicionales: [], ...over,
  })

  it('mismo código en dos ítems: cada línea va a su ítem (por posición)', () => {
    const lineas = [
      { codigo: '3302 08', Descripcion: 'Valvula', Cantidad: 2 },
      { codigo: 'ACT-1', Descripcion: 'Actuador', Cantidad: 2 },
      { codigo: '3302 08', Descripcion: 'Valvula', Cantidad: 3 },
    ]
    const items = [
      item('a', { codigos: ['3302 08'], adicionales: [{ codigos: ['ACT-1'], nombres: [] }] }),
      item('b', { quantity: 3, codigos: ['3302 08'] }),
    ]
    const v = vincularLineasFactura(lineas, items)
    expect(v.map((x) => x && [x.invoiceItemId, x.adicional, x.principal])).toEqual([
      ['a', false, 0],
      ['a', true, 0],
      ['b', false, 2],
    ])
  })

  it('descripción editada y sin código: vincula por posición', () => {
    const v = vincularLineasFactura(
      [{ codigo: '', Descripcion: 'Texto editado en el diálogo', Cantidad: 2 }],
      [item('a', { nombres: ['Descripción de la cotización'] })]
    )
    expect(v[0]?.invoiceItemId).toBe('a')
  })

  it('con líneas manuales (sin ítem): vincula por código/descripción en orden', () => {
    const lineas = [
      { codigo: '', Descripcion: 'Flete', Cantidad: 1 },
      { codigo: 'X1', Descripcion: 'Valvula', Cantidad: 2 },
      { codigo: 'X1', Descripcion: 'Valvula', Cantidad: 5 },
    ]
    const items = [item('a', { codigos: ['X1'] }), item('b', { quantity: 5, codigos: ['X1'] })]
    const v = vincularLineasFactura(lineas, items)
    expect(v[0]).toBeNull()
    expect(v[1]?.invoiceItemId).toBe('a')
    expect(v[2]?.invoiceItemId).toBe('b')
  })

  it('un adicional con el código de otro ítem principal no consume ese ítem', () => {
    const lineas = [
      { codigo: 'V1', Descripcion: 'Valvula', Cantidad: 2 },
      { codigo: 'ACT', Descripcion: 'Actuador', Cantidad: 2 },
      { codigo: '', Descripcion: 'Flete', Cantidad: 1 },
      { codigo: 'ACT', Descripcion: 'Actuador', Cantidad: 4 },
    ]
    const items = [
      item('a', { codigos: ['V1'], adicionales: [{ codigos: ['ACT'], nombres: [] }] }),
      item('b', { quantity: 4, codigos: ['ACT'] }),
    ]
    const v = vincularLineasFactura(lineas, items)
    expect(v[1]).toMatchObject({ invoiceItemId: 'a', adicional: true })
    expect(v[3]).toMatchObject({ invoiceItemId: 'b', adicional: false })
  })
})

describe('parseNumeroAr', () => {
  it('lee formato argentino y punto decimal', () => {
    expect(parseNumeroAr('5.000')).toBe(5000)
    expect(parseNumeroAr('5.000,50')).toBe(5000.5)
    expect(parseNumeroAr('1.234.567')).toBe(1234567)
    expect(parseNumeroAr('30,63')).toBe(30.63)
    expect(parseNumeroAr('30.63')).toBe(30.63)
    expect(parseNumeroAr('abc')).toBeNaN()
    expect(parseNumeroAr('')).toBeNaN()
  })
})
