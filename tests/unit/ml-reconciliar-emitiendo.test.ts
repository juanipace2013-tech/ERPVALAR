import { describe, it, expect, vi } from 'vitest'

/**
 * Ventas de ML trabadas en "revisar" (candado EMITIENDO sin factura tras un
 * ARCA_INCIERTO): cómo decide scripts/ml-reconciliar-emitiendo.ts si ARCA tiene
 * un comprobante para la venta. ARCA falso (funciones inyectadas): sin red.
 */
import {
  TIPOS_FACTURA_ML,
  VENTANA_NUMEROS,
  coincideConCandado,
  escanearArcaParaCandado,
  ymdLocal,
  type CandadoEmitiendo,
  type ComprobanteArca,
} from '@/lib/mercadolibre/reconciliar-emitiendo'

const candado: CandadoEmitiendo = {
  packId: '2000009000000001',
  cuit: '20-12345678-6',
  total: 100,
  createdAt: new Date(2026, 9, 5, 11, 30), // 5/10/2026 11:30 (hora local)
}

function cbte(cbteTipo: number, numero: number, over: Partial<ComprobanteArca> = {}): ComprobanteArca {
  return {
    cbteTipo,
    numero,
    ImpTotal: 5000,
    DocTipo: 80,
    DocNro: '30711111118',
    CbteFch: '20261005',
    CodAutorizacion: `7600000000${String(numero).padStart(4, '0')}`,
    Resultado: 'A',
    ...over,
  }
}

describe('coincideConCandado', () => {
  it('mismo total (±1 peso) y el CUIT/CUIL del candado', () => {
    expect(coincideConCandado({ ImpTotal: 100, DocNro: '20123456786' }, candado)).toBe(true)
    // La A redondea: $100 cobrados → 99,99 emitidos
    expect(coincideConCandado({ ImpTotal: 99.99, DocNro: '20123456786' }, candado)).toBe(true)
    expect(coincideConCandado({ ImpTotal: 101, DocNro: '20123456786' }, candado)).toBe(true)
    expect(coincideConCandado({ ImpTotal: 101.01, DocNro: '20123456786' }, candado)).toBe(false)
  })

  it('B a un consumidor que ARCA no tiene: el DNI de adentro del CUIL (dígitos 3 a 10)', () => {
    expect(coincideConCandado({ ImpTotal: 100, DocNro: '12345678' }, candado)).toBe(true)
    // DNI de 7 dígitos: el cero de adelante no cuenta
    expect(coincideConCandado({ ImpTotal: 100, DocNro: '5123456' }, { cuit: '20-05123456-2', total: 100 })).toBe(true)
    expect(coincideConCandado({ ImpTotal: 100, DocNro: '87654321' }, candado)).toBe(false)
    expect(coincideConCandado({ ImpTotal: 100, DocNro: '27123456780' }, candado)).toBe(false) // otro CUIL del mismo DNI
  })

  it('sin CUIT o sin total en el candado: nunca coincide', () => {
    expect(coincideConCandado({ ImpTotal: 100, DocNro: '20123456786' }, { cuit: null, total: 100 })).toBe(false)
    expect(coincideConCandado({ ImpTotal: 100, DocNro: '20123456786' }, { cuit: '20-12345678-6', total: null })).toBe(false)
  })
})

describe('escanearArcaParaCandado', () => {
  it('encuentra la Factura B que ARCA autorizó para la venta (total y DNI) entre otras', async () => {
    const ultimos: Record<number, number> = { 1: 40, 6: 13, 201: 0 }
    const arca: Record<string, ComprobanteArca> = {
      '6:13': cbte(6, 13, { ImpTotal: 100, DocTipo: 96, DocNro: '12345678' }),
      '6:12': cbte(6, 12, { ImpTotal: 100, DocTipo: 96, DocNro: '99999999' }),
      '6:11': cbte(6, 11, { CbteFch: '20261004' }), // de antes del candado: corta
      '1:40': cbte(1, 40),
    }
    const consultar = vi.fn(async (t: number, n: number) => arca[`${t}:${n}`] ?? null)
    const r = await escanearArcaParaCandado(candado, { ultimoAutorizado: async (t) => ultimos[t], consultar })
    expect(r.coincidencias.map((c) => [c.cbteTipo, c.numero])).toEqual([[6, 13]])
    expect(r.errores).toEqual([])
    // B: 13, 12, 11 (y corta por la fecha); A: del 40 al 1 (no hay ninguno anterior al candado); FCE A: ninguno
    expect(consultar.mock.calls.filter(([t]) => t === 6).map(([, n]) => n)).toEqual([13, 12, 11])
    expect(consultar.mock.calls.filter(([t]) => t === 1).map(([, n]) => n)).toEqual(Array.from({ length: 40 }, (_, i) => 40 - i))
    expect(consultar.mock.calls.some(([t]) => t === 201)).toBe(false)
  })

  it('tipos revisados: Factura A, Factura B y FCE A', () => {
    expect(TIPOS_FACTURA_ML).toEqual([1, 6, 201])
  })

  it('nada coincide: sin coincidencias ni errores (se puede liberar)', async () => {
    const r = await escanearArcaParaCandado(candado, {
      ultimoAutorizado: async () => 3,
      consultar: async (t, n) => cbte(t, n),
    })
    expect(r).toEqual({ coincidencias: [], posibles: [], errores: [], revisados: 9 })
  })

  it('muchos comprobantes después del candado: recorre más de 20 hasta llegar al día', async () => {
    // El PV 7 es compartido con las cotizaciones: la B de la venta quedó 60 números atrás
    const consultar = vi.fn(async (t: number, n: number) =>
      t !== 6 ? null : n === 940 ? cbte(6, n, { ImpTotal: 100, DocTipo: 86, DocNro: '20123456786' }) : n < 930 ? cbte(6, n, { CbteFch: '20261004' }) : cbte(6, n)
    )
    const r = await escanearArcaParaCandado(candado, { ultimoAutorizado: async (t) => (t === 6 ? 1000 : 0), consultar })
    expect(r.coincidencias.map((c) => c.numero)).toEqual([940])
    expect(r.errores).toEqual([])
  })

  it('llega al tope sin llegar al día del candado: es un error (el script no libera)', async () => {
    const r = await escanearArcaParaCandado(
      candado,
      { ultimoAutorizado: async (t) => (t === 6 ? 50 : 0), consultar: async (t, n) => cbte(t, n) },
      { ventana: 10 }
    )
    expect(r.coincidencias).toEqual([])
    expect(r.errores).toEqual(['tipo 6: se revisaron 10 números para atrás desde el 50 sin llegar al día del candado (20261005)'])
    expect(VENTANA_NUMEROS).toBeGreaterThanOrEqual(200)
  })

  it('mismo comprador por otro total (borrador editado): queda como posible, no libera', async () => {
    const r = await escanearArcaParaCandado(candado, {
      ultimoAutorizado: async (t) => (t === 6 ? 2 : 0),
      consultar: async (t, n) => (n === 2 ? cbte(t, n, { ImpTotal: 150, DocTipo: 96, DocNro: '12345678' }) : cbte(t, n, { CbteFch: '20261001' })),
    })
    expect(r.coincidencias).toEqual([])
    expect(r.posibles.map((c) => [c.cbteTipo, c.numero])).toEqual([[6, 2]])
  })

  it('una consulta falla: queda el error (el script no libera)', async () => {
    const r = await escanearArcaParaCandado(candado, {
      ultimoAutorizado: async (t) => {
        if (t === 201) throw new Error('timeout')
        return 1
      },
      consultar: async (t, n) => {
        if (t === 6) throw new Error('HTTP 504')
        return cbte(t, n)
      },
    })
    expect(r.coincidencias).toEqual([])
    expect(r.errores).toEqual(['tipo 6 N° 1: FECompConsultar: HTTP 504', 'tipo 201: FECompUltimoAutorizado: timeout'])
  })

  it('ymdLocal arma la fecha como toCbteFch (hora local)', () => {
    expect(ymdLocal(new Date(2026, 9, 5, 23, 59))).toBe('20261005')
    expect(ymdLocal(new Date(2026, 0, 2))).toBe('20260102')
  })
})
