import { describe, it, expect } from 'vitest'

/**
 * Condiciones de pago (src/lib/facturacion/condicion-pago.ts): el mapa de
 * días que sendQuoteToColppy tenía en línea se movió acá sin cambios (lo
 * comparte la factura directa). Puro, sin red.
 */
import {
  CONDICIONES_PAGO,
  condicionPagoDesdeDias,
  diasCondicionPago,
  esCondicionPago,
  fechaVtoDesde,
} from '@/lib/facturacion/condicion-pago'

/** Copia literal del condicionPagoMap que estaba en sendQuoteToColppy (colppy.ts) antes de moverlo */
const MAPA_ANTERIOR: Record<string, number> = {
  Contado: 7,
  'a 7 Dias': 7,
  'a 15 Dias': 15,
  'a 30 Dias': 30,
  'a 45 Dias': 45,
  'a 60 Dias': 60,
  'a 90 Dias': 90,
  'a 120 Dias': 120,
  '0': 7,
  '7': 7,
  '15': 15,
  '30': 30,
  '45': 45,
  '60': 60,
  '90': 90,
  '120': 120,
}

/** Cálculo de colppy.ts: condicionPagoMap[id] ?? (días del cliente en Colppy) */
function diasVtoComoColppy(id: string, idCondicionPagoCliente: string | null) {
  const parsed = parseInt(idCondicionPagoCliente || '')
  return diasCondicionPago(id) ?? (Number.isFinite(parsed) ? parsed : 0)
}

describe('diasCondicionPago', () => {
  it('es idéntico al mapa en línea de antes, en todas sus claves', () => {
    for (const [k, v] of Object.entries(MAPA_ANTERIOR)) expect(diasCondicionPago(k)).toBe(v)
    // Contado vence a los 7 días (para que no aparezca vencida al emitir)
    expect(diasCondicionPago('Contado')).toBe(7)
  })

  it('clave desconocida → undefined (quien llama decide el fallback); nunca props del prototipo', () => {
    expect(diasCondicionPago('a 10 Dias')).toBeUndefined()
    expect(diasCondicionPago('')).toBeUndefined()
    expect(diasCondicionPago(null)).toBeUndefined()
    expect(diasCondicionPago(undefined)).toBeUndefined()
    expect(diasCondicionPago('toString')).toBeUndefined()
  })

  it('fallback numérico de colppy.ts: id numérico del mapa, o los días del cliente si la clave no existe', () => {
    expect(diasVtoComoColppy('30', null)).toBe(30)
    expect(diasVtoComoColppy('0', '60')).toBe(7) // 0 (Contado) no es falsy: no cae al cliente
    expect(diasVtoComoColppy('a 10 Dias', '10')).toBe(10)
    expect(diasVtoComoColppy('a 10 Dias', null)).toBe(0)
  })
})

describe('CONDICIONES_PAGO / esCondicionPago', () => {
  it('Contado y a 7/15/30/45/60/90/120 días, todas con días en el mapa', () => {
    expect(CONDICIONES_PAGO.map((c) => c.id)).toEqual(['Contado', 'a 7 Dias', 'a 15 Dias', 'a 30 Dias', 'a 45 Dias', 'a 60 Dias', 'a 90 Dias', 'a 120 Dias'])
    for (const c of CONDICIONES_PAGO) expect(diasCondicionPago(c.id)).toBe(c.id === 'Contado' ? 7 : c.dias)
    expect(esCondicionPago('a 30 Dias')).toBe(true)
    expect(esCondicionPago('30')).toBe(false)
    expect(esCondicionPago(30)).toBe(false)
  })
})

describe('condicionPagoDesdeDias (default según Customer.paymentTerms)', () => {
  it('null, 0 o negativo → Contado', () => {
    expect(condicionPagoDesdeDias(null)).toBe('Contado')
    expect(condicionPagoDesdeDias(undefined)).toBe('Contado')
    expect(condicionPagoDesdeDias(0)).toBe('Contado')
    expect(condicionPagoDesdeDias(-5)).toBe('Contado')
    expect(condicionPagoDesdeDias(NaN)).toBe('Contado')
  })

  it('la clave más chica que cubra los días; más de 120 → a 120 Dias', () => {
    expect(condicionPagoDesdeDias(1)).toBe('a 7 Dias')
    expect(condicionPagoDesdeDias(7)).toBe('a 7 Dias')
    expect(condicionPagoDesdeDias(10)).toBe('a 15 Dias')
    expect(condicionPagoDesdeDias(30)).toBe('a 30 Dias')
    expect(condicionPagoDesdeDias(31)).toBe('a 45 Dias')
    expect(condicionPagoDesdeDias(120)).toBe('a 120 Dias')
    expect(condicionPagoDesdeDias(180)).toBe('a 120 Dias')
  })
})

describe('fechaVtoDesde', () => {
  it('base + días de la condición (fecha local), sin tocar la base', () => {
    const base = new Date(2026, 9, 5, 10, 30)
    expect(fechaVtoDesde(base, 'a 30 Dias')).toEqual(new Date(2026, 10, 4, 10, 30))
    expect(fechaVtoDesde(base, 'Contado')).toEqual(new Date(2026, 9, 12, 10, 30))
    expect(fechaVtoDesde(base, 'desconocida')).toEqual(base)
    expect(base).toEqual(new Date(2026, 9, 5, 10, 30))
  })
})
