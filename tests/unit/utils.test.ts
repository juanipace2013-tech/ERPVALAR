import { describe, it, expect } from 'vitest'
import { formatCUIT, parseDecimalAR, validateCUIT } from '@/lib/utils'

describe('validateCUIT', () => {
  it('acepta CUITs válidos con y sin guiones', () => {
    expect(validateCUIT('20-12345678-6')).toBe(true)
    expect(validateCUIT('20123456786')).toBe(true)
    expect(validateCUIT('30-71059140-3')).toBe(true)
  })
  it('rechaza dígito verificador incorrecto, largo inválido y basura', () => {
    expect(validateCUIT('20-12345678-5')).toBe(false)
    expect(validateCUIT('2012345678')).toBe(false)
    expect(validateCUIT('abc')).toBe(false)
    expect(validateCUIT('')).toBe(false)
  })
})

describe('formatCUIT', () => {
  it('formatea 11 dígitos como XX-XXXXXXXX-X y deja lo demás intacto', () => {
    expect(formatCUIT('20123456786')).toBe('20-12345678-6')
    expect(formatCUIT('20-12345678-6')).toBe('20-12345678-6')
    expect(formatCUIT('123')).toBe('123')
  })
})

describe('parseDecimalAR', () => {
  it('interpreta coma decimal y punto de miles', () => {
    expect(parseDecimalAR('2.359,43')).toBe(2359.43)
    expect(parseDecimalAR('1.234.567,89')).toBe(1234567.89)
    expect(parseDecimalAR('0,5')).toBe(0.5)
  })
  it('sin coma toma el punto como decimal', () => {
    expect(parseDecimalAR('2359.43')).toBe(2359.43)
    expect(parseDecimalAR('100')).toBe(100)
  })
  it('ignora símbolos y devuelve 0 para vacío o inválido', () => {
    expect(parseDecimalAR('$ 1.500,00')).toBe(1500)
    expect(parseDecimalAR('USD 12,5')).toBe(12.5)
    expect(parseDecimalAR('')).toBe(0)
    expect(parseDecimalAR('abc')).toBe(0)
  })
})
