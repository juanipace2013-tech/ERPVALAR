import { describe, expect, it } from 'vitest'
import { stripTrailingSegment, generateSkuVariants } from '@/lib/purchase-invoices/sku-variants'

describe('stripTrailingSegment', () => {
  it('saca el sufijo de variante de un código de 3 partes', () => {
    expect(stripTrailingSegment('4427 08 99')).toBe('4427 08')
    expect(stripTrailingSegment('  4519 02 C24 ')).toBe('4519 02')
  })

  it('no toca códigos de 1 o 2 partes', () => {
    expect(stripTrailingSegment('4427 08')).toBeNull()
    expect(stripTrailingSegment('5800-140')).toBeNull()
    expect(stripTrailingSegment('')).toBeNull()
  })
})

describe('generateSkuVariants', () => {
  it('quita ceros iniciales de la primera parte', () => {
    expect(generateSkuVariants('0012416 04')).toEqual(['12416 04', '012416 04', '0012416 04'])
  })
})
