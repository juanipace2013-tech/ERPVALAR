import { describe, it, expect } from 'vitest'
import { getPosicionadores } from '@/lib/genebre-posicionadores'

describe('getPosicionadores', () => {
  it('ofrece los posicionadores lineales 5952 para todas las medidas de la 5065A', () => {
    for (const medida of ['05', '06', '07', '08', '09', '10', '11', '12']) {
      expect(getPosicionadores(`5065A ${medida}`).map((o) => o.sku)).toEqual(['5952 00', '5952 04'])
    }
  })

  it('tolera espacios sobrantes en el SKU', () => {
    expect(getPosicionadores('  5065A 12 ')).toHaveLength(2)
  })

  it('no ofrece posicionador a otras series', () => {
    expect(getPosicionadores('5065 12')).toEqual([])
    expect(getPosicionadores('2025 05')).toEqual([])
    expect(getPosicionadores('5952 00')).toEqual([])
  })
})
