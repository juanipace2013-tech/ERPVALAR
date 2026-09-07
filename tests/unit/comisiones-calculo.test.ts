import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  ESCALA_DEFAULT,
  calcularComisionLinea,
  mesHabilitado,
  redondear2,
  tasaParaTotal,
  tcParaOperacion,
} from '@/lib/comisiones/calculo'

describe('tasaParaTotal (escala mensual)', () => {
  it('piso inclusivo y techo exclusivo en cada tramo', () => {
    expect(tasaParaTotal(0, ESCALA_DEFAULT)).toBe(0.0125)
    expect(tasaParaTotal(19999.99, ESCALA_DEFAULT)).toBe(0.0125)
    expect(tasaParaTotal(20000, ESCALA_DEFAULT)).toBe(0.015)
    expect(tasaParaTotal(39999.99, ESCALA_DEFAULT)).toBe(0.015)
    expect(tasaParaTotal(40000, ESCALA_DEFAULT)).toBe(0.0175)
    expect(tasaParaTotal(60000, ESCALA_DEFAULT)).toBe(0.02)
    expect(tasaParaTotal(1_000_000, ESCALA_DEFAULT)).toBe(0.02)
  })

  it('total negativo o escala vacía cae al primer tramo / 0', () => {
    expect(tasaParaTotal(-5, ESCALA_DEFAULT)).toBe(0.0125)
    expect(tasaParaTotal(100, [])).toBe(0)
  })
})

describe('calcularComisionLinea', () => {
  it('USD = importe × tasa, ARS = USD × TC, ambos redondeados a 2 decimales', () => {
    const r = calcularComisionLinea(12345.67, 0.0175, 1234.5)
    expect(r.comisionUsd).toBe(216.05)
    expect(r.comisionArs).toBe(266712.77)
  })

  it('sin tipo de cambio la comisión en ARS queda null', () => {
    const r = calcularComisionLinea(1000, 0.02, null)
    expect(r).toEqual({ comisionUsd: 20, comisionArs: null })
  })

  it('el ARS se calcula sobre el USD sin redondear (no arrastra redondeo)', () => {
    const r = calcularComisionLinea(26.6667, 0.0125, 1000)
    expect(r.comisionUsd).toBe(0.33)
    expect(r.comisionArs).toBe(333.33)
  })
})

describe('helpers', () => {
  it('redondear2 redondea a centavos', () => {
    expect(redondear2(2.675)).toBe(2.68)
    expect(redondear2(10.125)).toBe(10.13)
    expect(redondear2(-1.234)).toBe(-1.23)
    expect(redondear2(100)).toBe(100)
  })

  it('tcParaOperacion elige billete o divisa', () => {
    const tc = { billete: 1300, divisa: 1280 }
    expect(tcParaOperacion(tc, 'BILLETE')).toBe(1300)
    expect(tcParaOperacion(tc, 'DIVISA')).toBe(1280)
    expect(tcParaOperacion({ billete: null, divisa: null }, 'BILLETE')).toBeNull()
  })

  it('mesHabilitado arranca en julio 2026', () => {
    expect(mesHabilitado(2026, 6)).toBe(false)
    expect(mesHabilitado(2026, 7)).toBe(true)
    expect(mesHabilitado(2027, 1)).toBe(true)
    expect(mesHabilitado(2025, 12)).toBe(false)
  })
})
