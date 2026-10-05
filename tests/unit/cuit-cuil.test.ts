import { describe, it, expect } from 'vitest'
import { cuilsCandidatosDesdeDni, digitoVerificadorCuit, esCuitValido } from '@/lib/cuit-utils'

describe('dígito verificador de CUIT/CUIL (módulo 11)', () => {
  it('valida CUIT reales y rechaza el dígito cambiado', () => {
    expect(esCuitValido('33-69345023-9')).toBe(true) // AFIP
    expect(esCuitValido('33693450239')).toBe(true)
    expect(esCuitValido('33-69345023-8')).toBe(false)
    expect(esCuitValido('20-12345678-6')).toBe(true)
    expect(esCuitValido('20-12345678-9')).toBe(false)
  })

  it('largo distinto de 11 o vacío no es válido', () => {
    expect(esCuitValido('2012345678')).toBe(false)
    expect(esCuitValido('')).toBe(false)
    expect(esCuitValido(null)).toBe(false)
  })

  it('resto 0 → dígito 0; resto 1 → null (la combinación no se usa)', () => {
    expect(digitoVerificadorCuit('2030111222')).toBe(0)
    expect(digitoVerificadorCuit('2020000009')).toBeNull()
    expect(digitoVerificadorCuit('123')).toBeNull()
  })

  it('estricto: el resto 1 con dígito 9 no es válido', () => {
    // 20-20000009-? da resto 1: no existe ese CUIL (ARCA usa el 23)
    expect(esCuitValido('20-20000009-9')).toBe(false)
  })
})

describe('CUIL posibles a partir del DNI', () => {
  it('20, 27, 23 y 24 con su dígito, en ese orden', () => {
    expect(cuilsCandidatosDesdeDni('12345678')).toEqual(['20123456786', '27123456780', '23123456785', '24123456781'])
  })

  it('DNI de 7 dígitos: se completa con 0 a 8', () => {
    expect(cuilsCandidatosDesdeDni('5.123.456')).toEqual(['20051234562', '27051234567', '23051234561', '24051234568'])
  })

  it('si 20 da dígito 10 queda el 23 con dígito 9 (varón)', () => {
    const c = cuilsCandidatosDesdeDni(20000009)
    expect(c.some((x) => x.startsWith('20'))).toBe(false)
    expect(c).toContain('23200000099')
    expect(c[0]).toBe('27200000094')
  })

  it('si 27 da dígito 10 queda el 23 con dígito 4 (mujer)', () => {
    const c = cuilsCandidatosDesdeDni('20000006')
    expect(c.some((x) => x.startsWith('27'))).toBe(false)
    expect(c).toContain('23200000064')
  })

  it('si el 23 da 10 se descarta', () => {
    expect(cuilsCandidatosDesdeDni('30111222')).toEqual(['20301112220', '27301112225', '24301112226'])
  })

  it('todos los candidatos pasan la validación estricta', () => {
    for (const dni of ['12345678', '5123456', '20000009', '20000006', '30111222']) {
      for (const c of cuilsCandidatosDesdeDni(dni)) expect(esCuitValido(c)).toBe(true)
    }
  })

  it('DNI inválido: sin candidatos', () => {
    expect(cuilsCandidatosDesdeDni('123456')).toEqual([])
    expect(cuilsCandidatosDesdeDni('123456789')).toEqual([])
    expect(cuilsCandidatosDesdeDni(null)).toEqual([])
  })
})
