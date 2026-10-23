import { describe, it, expect } from 'vitest'
import { candidateCodes, findExactSkuMatch } from '@/lib/quotes/manual-sku-match'

describe('candidateCodes', () => {
  it('toma el SKU manual y el código al principio de la descripción', () => {
    expect(candidateCodes('', 'UR3CJFBM-4 Griswold Válvula Esférica 3V - 1"')).toEqual([
      'UR3CJFBM-4 Griswold',
      'UR3CJFBM-4',
    ])
    expect(candidateCodes(' FAB-001 ', 'Válvula especial')).toEqual(['FAB-001', 'Válvula especial', 'Válvula'])
  })

  it('no repite candidatos ni usa textos muy cortos', () => {
    expect(candidateCodes('CN7505A2001', 'CN7505A2001')).toEqual(['CN7505A2001'])
    expect(candidateCodes('', 'DN 200')).toEqual(['DN 200'])
    expect(candidateCodes('', '')).toEqual([])
  })
})

describe('findExactSkuMatch', () => {
  const products = [{ sku: '2094 12' }, { sku: 'UR3CJFBM-4' }, { sku: 'UR3CJFBM-40' }]

  it('encuentra SKUs con espacio y sin distinguir mayúsculas', () => {
    expect(findExactSkuMatch(candidateCodes('', '2094 12 Válvula compuerta'), products)).toEqual({ sku: '2094 12' })
    expect(findExactSkuMatch(candidateCodes('', 'ur3cjfbm-4 Griswold'), products)).toEqual({ sku: 'UR3CJFBM-4' })
  })

  it('no matchea por coincidencia parcial', () => {
    expect(findExactSkuMatch(candidateCodes('', 'UR3CJFBM Griswold'), products)).toBeNull()
  })
})
