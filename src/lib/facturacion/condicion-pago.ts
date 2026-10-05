/**
 * Condiciones de pago de una factura de venta (las de Colppy) y su
 * vencimiento.
 *
 * El mapa de días era el que sendQuoteToColppy tenía en línea para calcular
 * fechaVto (Colppy) y el vencimiento que va a ARCA (FchVtoPago de una FCE):
 * se movió acá sin cambios para que la factura directa use exactamente la
 * misma regla. "Contado" vence a los 7 días para que la factura no aparezca
 * vencida al emitirla.
 *
 * Módulo puro, sin imports: lo usan colppy.ts, la factura directa
 * (src/lib/facturacion/factura-directa.ts) y su pantalla ('use client').
 */

/** Condiciones que ofrece la factura directa (ids = textos que espera Colppy) */
export const CONDICIONES_PAGO = [
  { id: 'Contado', etiqueta: 'Contado', dias: 0 },
  { id: 'a 7 Dias', etiqueta: 'A 7 días', dias: 7 },
  { id: 'a 15 Dias', etiqueta: 'A 15 días', dias: 15 },
  { id: 'a 30 Dias', etiqueta: 'A 30 días', dias: 30 },
  { id: 'a 45 Dias', etiqueta: 'A 45 días', dias: 45 },
  { id: 'a 60 Dias', etiqueta: 'A 60 días', dias: 60 },
  { id: 'a 90 Dias', etiqueta: 'A 90 días', dias: 90 },
  { id: 'a 120 Dias', etiqueta: 'A 120 días', dias: 120 },
] as const

export type CondicionPago = (typeof CONDICIONES_PAGO)[number]['id']

/**
 * Días hasta el vencimiento según la condición. Soporta el texto de Colppy
 * ("a 30 Dias") y, como fallback, el id numérico ("30"). Es el mapa que
 * sendQuoteToColppy tenía en línea (condicionPagoMap), sin cambios.
 */
const DIAS_VENCIMIENTO: Record<string, number> = {
  Contado: 7, // +7 días para que no aparezca vencida al emitir
  'a 7 Dias': 7,
  'a 15 Dias': 15,
  'a 30 Dias': 30,
  'a 45 Dias': 45,
  'a 60 Dias': 60,
  'a 90 Dias': 90,
  'a 120 Dias': 120,
  // Fallback con claves numéricas por si llega el ID en vez del texto
  '0': 7,
  '7': 7,
  '15': 15,
  '30': 30,
  '45': 45,
  '60': 60,
  '90': 90,
  '120': 120,
}

/**
 * Días de vencimiento de la condición; undefined si no se conoce (quien llama
 * decide el fallback: sendQuoteToColppy usa los días del cliente en Colppy).
 */
export function diasCondicionPago(id: string | null | undefined): number | undefined {
  if (id === null || id === undefined) return undefined
  return Object.prototype.hasOwnProperty.call(DIAS_VENCIMIENTO, id) ? DIAS_VENCIMIENTO[id] : undefined
}

/** true si es una de las condiciones de CONDICIONES_PAGO */
export function esCondicionPago(id: unknown): id is CondicionPago {
  return typeof id === 'string' && CONDICIONES_PAGO.some((c) => c.id === id)
}

/**
 * Condición por defecto a partir de los días de plazo del cliente
 * (Customer.paymentTerms): la más chica que cubra esos días. null, 0 o
 * negativos → Contado; más de 120 → "a 120 Dias".
 */
export function condicionPagoDesdeDias(dias: number | null | undefined): CondicionPago {
  const d = Number(dias)
  if (!Number.isFinite(d) || d <= 0) return 'Contado'
  const plazos = CONDICIONES_PAGO.filter((c) => c.dias > 0)
  return (plazos.find((c) => c.dias >= d) ?? plazos[plazos.length - 1]).id
}

/**
 * Vencimiento = base + días de la condición (fecha local, como en
 * sendQuoteToColppy). Condición desconocida → la misma fecha.
 */
export function fechaVtoDesde(base: Date, condicion: string | null | undefined): Date {
  const vto = new Date(base.getTime())
  vto.setDate(vto.getDate() + (diasCondicionPago(condicion) ?? 0))
  return vto
}
