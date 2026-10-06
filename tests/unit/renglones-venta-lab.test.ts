import { describe, it, expect } from 'vitest'
import { renglonesVentaLab, itemsColppyAResolver } from '@/lib/contabilidad/renglones-venta-lab'

/**
 * Export al laboratorio contable: una electroválvula con bobina y conector va en un solo
 * InvoiceItem (precio combinado) pero a Colppy en tres renglones. El laboratorio tiene que
 * recibir los tres para descargar el mismo stock que Colppy. Datos ficticios.
 */
const factura = (colppyPayload?: unknown) => ({
  items: [{ sku: '4020 03', description: '4020 03 Electroválvula', quantity: '14', unitPrice: '161.83', discount: '0', taxRate: '21', subtotal: '2265.62' }],
  colppyPayload,
})
const payload = {
  items: [
    { idItem: 111, Descripcion: '4020 03 Electroválvula', ImporteUnitario: 38.96, Cantidad: 14, porcDesc: 0, subtotal: 545.44 },
    { idItem: 222, Descripcion: 'Bobina 4808 22', ImporteUnitario: 31.59, Cantidad: 14, porcDesc: 0, subtotal: 442.26 },
    { idItem: 333, Descripcion: 'Conector 4801 08', ImporteUnitario: 91.28, Cantidad: 14, porcDesc: 0, subtotal: 1277.92 },
  ],
}
const skus = new Map([[111, '4020 03'], [222, '4808 22'], [333, '4801 08']])

describe('renglones de venta para el laboratorio', () => {
  it('separa los adicionales como fueron a Colppy, con su SKU y la alícuota de la factura', () => {
    const r = renglonesVentaLab(factura(payload), skus)
    expect(r.map((x) => [x.sku, x.cantidad, x.precioUnitario, x.alicuota, x.subtotal])).toEqual([
      ['4020 03', 14, 38.96, 21, 545.44],
      ['4808 22', 14, 31.59, 21, 442.26],
      ['4801 08', 14, 91.28, 21, 1277.92],
    ])
  })

  it('sin payload, sin adicionales o con un neto distinto deja los renglones de la factura', () => {
    expect(renglonesVentaLab(factura(), skus)).toHaveLength(1)
    expect(renglonesVentaLab(factura({ items: [payload.items[0]] }), skus)).toHaveLength(1)
    const otro = { items: payload.items.map((l) => ({ ...l, subtotal: l.subtotal + 10 })) }
    expect(renglonesVentaLab(factura(otro), skus)[0].sku).toBe('4020 03')
    expect(renglonesVentaLab(factura(otro), skus)).toHaveLength(1)
  })

  it('separa también cuando la factura guarda el precio con IVA y el payload el neto (A-0007-00000028)', () => {
    const f = { items: [{ sku: null, description: '4020 03 Válvula', quantity: '14', unitPrice: '104.1', discount: '0', taxRate: '21', subtotal: '1457.4' }],
      colppyPayload: { items: [
        { idItem: 11427181, Descripcion: '4020 03 Válvula', ImporteUnitario: 67.95, Cantidad: 14, porcDesc: 0, subtotal: 951.31 },
        { idItem: 952033, Descripcion: '4808 22 Bobina', ImporteUnitario: 14.89, Cantidad: 14, porcDesc: 0, subtotal: 208.5 },
        { idItem: 931591, Descripcion: '4801 08 Conector', ImporteUnitario: 3.19, Cantidad: 14, porcDesc: 0, subtotal: 44.66 },
      ] } }
    const r = renglonesVentaLab(f, new Map())
    expect(r.map((x) => [x.descripcion, x.precioUnitario, x.subtotal])).toEqual([['4020 03 Válvula', 67.95, 951.31], ['4808 22 Bobina', 14.89, 208.5], ['4801 08 Conector', 3.19, 44.66]])
  })

  it('con varias alícuotas no separa (el payload no dice cuál lleva cada adicional)', () => {
    const f = factura(payload)
    f.items.push({ sku: 'FLETE', description: 'Flete', quantity: '1', unitPrice: '0', discount: '0', taxRate: '10.5', subtotal: '0' })
    expect(renglonesVentaLab(f, skus)).toHaveLength(2)
  })

  it('un ítem de Colppy sin producto en el ERP sale sin SKU (el laboratorio lo busca por la descripción)', () => {
    const r = renglonesVentaLab(factura(payload), new Map([[111, '4020 03']]))
    expect(r[1].sku).toBe('')
    expect(r[1].descripcion).toBe('Bobina 4808 22')
  })

  it('junta los ítems de Colppy a resolver sólo de las facturas que se separan', () => {
    expect(itemsColppyAResolver([factura(payload), factura({ items: [payload.items[0]] })]).sort()).toEqual([111, 222, 333])
  })
})
