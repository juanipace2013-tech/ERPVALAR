import { describe, it, expect } from 'vitest'
import { esNumeroColppy, factorMoneda, itemsDesdeEnvio } from '@/lib/facturacion/vincular-envio-colppy'

describe('vincular envío Colppy', () => {
  it('reconoce números reales de Colppy y descarta los de borrador del ERP', () => {
    expect(esNumeroColppy('0003-00015423')).toBe(true)
    expect(esNumeroColppy('BORRADOR-COLPPY-54164669')).toBe(false)
    expect(esNumeroColppy(null)).toBe(false)
  })

  it('factor de moneda entre la cotización y la factura', () => {
    expect(factorMoneda('USD', 'USD', 1540)).toBe(1)
    expect(factorMoneda('USD', 'ARS', 1540)).toBe(1540)
    expect(factorMoneda('ARS', 'USD', 1540)).toBeCloseTo(1 / 1540)
    expect(factorMoneda('USD', 'ARS', 0)).toBe(1)
  })

  it('arma los ítems de la factura desde el envío (con cotización y producto)', () => {
    const qi = new Map([['q1', { productId: 'p1', description: null, productName: 'Válvula 3302 08', sku: '3302 08' }]])
    const items = itemsDesdeEnvio(
      [
        { cotizacionItemId: 'q1', cantidad: '2', precioUnitario: '30.6300', subtotal: '61.26' },
        { cotizacionItemId: 'q2', cantidad: '0', precioUnitario: '10', subtotal: '0' },
      ],
      qi,
      1540
    )
    expect(items).toEqual([
      { quoteItemId: 'q1', productId: 'p1', sku: '3302 08', description: 'Válvula 3302 08', quantity: 2, unitPrice: 47170.2, discount: 0, taxRate: 21, subtotal: 94340.4 },
    ])
  })
})
