import { describe, it, expect } from 'vitest'
import { plazoEntregaItem } from '@/lib/ordenes-compra/plazo-entrega'

describe('plazo de entrega por ítem de la orden de compra', () => {
  it('guarda el texto limpio', () => {
    expect(plazoEntregaItem('  6   semanas ')).toBe('6 semanas')
    expect(plazoEntregaItem('Inmediato')).toBe('Inmediato')
  })

  it('vacío o no texto queda sin plazo', () => {
    expect(plazoEntregaItem('')).toBeNull()
    expect(plazoEntregaItem('   ')).toBeNull()
    expect(plazoEntregaItem(undefined)).toBeNull()
    expect(plazoEntregaItem(null)).toBeNull()
    expect(plazoEntregaItem(42)).toBeNull()
  })

  it('recorta a 100 caracteres', () => {
    expect(plazoEntregaItem('x'.repeat(150))).toHaveLength(100)
  })
})
