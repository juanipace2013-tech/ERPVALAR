import { describe, it, expect } from 'vitest'
import {
  cotizacionEnPesos,
  monedaPresentacion,
  formatoImporte,
  importesEnPesos,
  importesPresentacion,
  condicionesComerciales,
} from '@/lib/cotizacion-pesos'

describe('cotización presentada en pesos', () => {
  it('solo aplica a cotizaciones en USD marcadas y con tipo de cambio', () => {
    expect(cotizacionEnPesos({ currency: 'USD', mostrarEnPesos: true, exchangeRate: 1565 })).toBe(true)
    expect(cotizacionEnPesos({ currency: 'USD', mostrarEnPesos: false, exchangeRate: 1565 })).toBe(false)
    expect(cotizacionEnPesos({ currency: 'USD', exchangeRate: 1565 })).toBe(false)
    expect(cotizacionEnPesos({ currency: 'USD', mostrarEnPesos: true, exchangeRate: 0 })).toBe(false)
    expect(cotizacionEnPesos({ currency: 'ARS', mostrarEnPesos: true, exchangeRate: 1565 })).toBe(false)
    expect(monedaPresentacion({ currency: 'USD', mostrarEnPesos: true, exchangeRate: '1565.000000' })).toBe('ARS')
    expect(monedaPresentacion({ currency: 'USD', mostrarEnPesos: false, exchangeRate: 1565 })).toBe('USD')
    expect(monedaPresentacion({ currency: 'ARS', exchangeRate: 1 })).toBe('ARS')
  })

  it('caso real VAL-2026-4088: 4 un. a USD 100,71 con TC 1.565', () => {
    const r = importesEnPesos([{ quantity: 4, unitPrice: 100.71, totalPrice: 402.84 }], 0, 1565)
    expect(r.items[0].unitPrice).toBe(157611.15)
    expect(r.items[0].totalPrice).toBe(630444.6)
    expect(r.subtotal).toBe(630444.6)
    expect(r.total).toBe(630444.6)
  })

  it('el total de la línea sale del unitario ya redondeado, así el presupuesto suma exacto', () => {
    // 10,333 × 1550,5 = 16021,3165 → unitario 16021,32; ×3 = 48063,96 (no 48063,95)
    const r = importesEnPesos([{ quantity: 3, unitPrice: 10.333, totalPrice: 31 }], 0, 1550.5)
    expect(r.items[0].unitPrice).toBe(16021.32)
    expect(r.items[0].totalPrice).toBe(48063.96)
    expect(r.subtotal).toBe(48063.96)
  })

  it('las alternativas se convierten pero no suman, y la bonificación se aplica al subtotal', () => {
    const r = importesEnPesos(
      [
        { quantity: 2, unitPrice: 50, totalPrice: 100 },
        { quantity: 2, unitPrice: 80, totalPrice: 160, isAlternative: true },
        { quantity: 1, unitPrice: 25.5, totalPrice: 25.5 },
      ],
      10,
      1000
    )
    expect(r.items.map((i) => i.totalPrice)).toEqual([100000, 160000, 25500])
    expect(r.subtotal).toBe(125500)
    expect(r.total).toBe(112950)
  })

  it('conserva los demás campos del ítem y no modifica el original', () => {
    const original = [{ quantity: 1, unitPrice: 10, totalPrice: 10, code: '2848 06' }]
    const r = importesEnPesos(original, 0, 1500)
    expect(r.items[0].code).toBe('2848 06')
    expect(original[0].unitPrice).toBe(10)
  })

  it('rechaza un tipo de cambio inválido', () => {
    expect(() => importesEnPesos([], 0, 0)).toThrow()
    expect(() => importesEnPesos([], 0, NaN)).toThrow()
  })

  it('importesPresentacion deja la cotización en USD tal cual si no está marcada', () => {
    const items = [{ quantity: 4, unitPrice: 100.71, totalPrice: 402.84 }]
    const base = { currency: 'USD', exchangeRate: 1565, bonification: 0, subtotal: '402.84', total: '402.84' }
    const usd = importesPresentacion({ ...base, mostrarEnPesos: false }, items)
    expect(usd).toEqual({ moneda: 'USD', items, subtotal: 402.84, total: 402.84 })
    const ars = importesPresentacion({ ...base, mostrarEnPesos: true }, items)
    expect(ars.moneda).toBe('ARS')
    expect(ars.total).toBe(630444.6)
  })

  it('formatea con el símbolo de la moneda', () => {
    expect(formatoImporte(402.84, 'USD')).toBe('USD 402,84')
    expect(formatoImporte(630444.6, 'ARS')).toBe('$ 630.444,60')
  })
})

describe('condiciones comerciales del PDF', () => {
  const base = { validityDays: 30, paymentTerms: 'Contado' }

  it('en USD mantiene la leyenda del dólar BNA y la cláusula de diferencia de cambio', () => {
    const c = condicionesComerciales({ ...base, moneda: 'USD' })
    expect(c[0]).toBe('Los precios No incluyen IVA (21%) y están expresados en dólares americanos cotización BNA billete vendedor.')
    expect(c.join(' ')).toContain('diferencia de cambio')
    expect(c).toHaveLength(7)
  })

  it('en pesos no nombra dólares, BNA ni diferencia de cambio', () => {
    for (const pricesIncludeTax of [false, true]) {
      for (const exterior of [false, true]) {
        const texto = condicionesComerciales({ ...base, moneda: 'ARS', pricesIncludeTax, exterior }).join(' ')
        expect(texto).toContain('pesos argentinos')
        expect(texto).not.toMatch(/d[oó]lar|USD|BNA|diferencia de cambio/i)
      }
    }
    const c = condicionesComerciales({ ...base, moneda: 'ARS' })
    expect(c).toEqual([
      'Los precios No incluyen IVA (21%) y están expresados en pesos argentinos.',
      'Validez de la oferta: 30 días.',
      'Lugar de entrega: 14 de Julio 175 - Paternal. CABA',
      'Condición de pago: Contado',
    ])
  })

  it('con IVA incluido lo dice en la leyenda', () => {
    expect(condicionesComerciales({ ...base, moneda: 'ARS', pricesIncludeTax: true })[0]).toBe(
      'Los precios INCLUYEN IVA (21%) y están expresados en pesos argentinos.'
    )
  })
})
