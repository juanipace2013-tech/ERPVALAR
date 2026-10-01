import { describe, it, expect } from 'vitest'
import { calcularNcUnidades, claveLinea, lineasAcreditables } from '@/lib/facturacion/nc-unidades'

const linea = (over: Record<string, unknown>) => ({
  idItem: 123, tipoItem: 'P', codigo: '3302 08', Descripcion: 'Filtro Y 3302 08', ImporteUnitario: 30.63,
  subtotal: 91.89, IVA: 21, Cantidad: 3, porcDesc: 0, ...over,
})

describe('NC por unidades', () => {
  const payloadA = { tipoFactura: 'A' as const, items: [linea({})] }

  it('1 de 3 unidades: neto, IVA y línea de Colppy con el artículo (devuelve stock)', () => {
    const lineas = lineasAcreditables(payloadA, new Map())
    const r = calcularNcUnidades(payloadA, lineas, [{ index: 0, cantidad: 1 }])
    expect(r.neto).toBe(30.63)
    expect(r.iva).toBe(6.43)
    expect(r.total).toBe(37.06)
    expect(r.lineasColppy[0]).toMatchObject({ idItem: 123, tipoItem: 'P', codigo: '3302 08', Cantidad: 1, subtotal: 30.63 })
    expect(r.devuelveTodo).toBe(false)
  })

  it('no deja devolver más de lo disponible (descuenta NC anteriores)', () => {
    const lineas = lineasAcreditables(payloadA, new Map([[claveLinea('3302 08', 'Filtro Y 3302 08'), 2]]))
    expect(lineas[0].cantidadDisponible).toBe(1)
    expect(() => calcularNcUnidades(payloadA, lineas, [{ index: 0, cantidad: 2 }])).toThrow(/como máximo 1/)
  })

  it('respeta el descuento de la línea (bonificación de la cotización)', () => {
    const p = { tipoFactura: 'A' as const, items: [linea({ ImporteUnitario: 100, porcDesc: 10, Cantidad: 2, subtotal: 180 })] }
    const r = calcularNcUnidades(p, lineasAcreditables(p, new Map()), [{ index: 0, cantidad: 1 }])
    expect(r.neto).toBe(90)
    expect(r.lineasColppy[0].subtotal).toBe(90)
  })

  it('Factura B: el precio de la línea es final (con IVA) → neto = precio / 1,21', () => {
    const p = { tipoFactura: 'B' as const, items: [linea({ ImporteUnitario: 121, Cantidad: 2, subtotal: 242 })] }
    const r = calcularNcUnidades(p, lineasAcreditables(p, new Map()), [{ index: 0, cantidad: 1 }])
    expect(r.neto).toBe(100)
    expect(r.total).toBe(121)
  })

  it('devolver todo sin NC previas se marca como total', () => {
    const lineas = lineasAcreditables(payloadA, new Map())
    expect(calcularNcUnidades(payloadA, lineas, [{ index: 0, cantidad: 3 }]).devuelveTodo).toBe(true)
  })

  it('línea sin artículo de inventario: no mueve stock', () => {
    const p = { tipoFactura: 'A' as const, items: [linea({ idItem: 0, tipoItem: '', codigo: '' })] }
    expect(lineasAcreditables(p, new Map())[0].conStock).toBe(false)
  })
})
