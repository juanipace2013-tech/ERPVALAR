import { describe, it, expect } from 'vitest'
import { facturaEnPesos, itemsEnPesos } from '@/lib/facturacion/moneda'

describe('facturar en pesos una cotización en USD', () => {
  it('solo aplica a cotizaciones en USD con monedaFactura ARS', () => {
    expect(facturaEnPesos('USD', 'ARS')).toBe(true)
    expect(facturaEnPesos('USD', 'USD')).toBe(false)
    expect(facturaEnPesos('USD', undefined)).toBe(false)
    expect(facturaEnPesos('ARS', 'ARS')).toBe(false)
  })

  it('convierte principal y adicionales con el TC, redondeando a 2 decimales cada uno', () => {
    const [it0] = itemsEnPesos(
      [{ productName: 'Válvula', quantity: 2, unitPrice: 111.79, additionals: [{ name: 'Actuador', sku: 'X', unitPrice: 10.005 }] }],
      1540
    )
    expect(it0.unitPrice).toBe(172156.6)
    expect(it0.additionals![0].unitPrice).toBe(15407.7)
    expect(it0.quantity).toBe(2)
    expect(it0.productName).toBe('Válvula')
  })
})
