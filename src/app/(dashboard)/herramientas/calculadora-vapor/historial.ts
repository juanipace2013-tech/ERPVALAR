import {
  calcularReguladoraVapor,
  type ResultadoCalculo,
} from '@/lib/calculoReguladoraVapor'
import { generateReguladoraVaporPDF } from '@/lib/pdf/reguladora-vapor-generator'

// ─── Tipos y helpers compartidos entre el historial y la calculadora ─────────

export interface CalculoHistorial {
  id: string
  p1: number
  p2: number
  q: number
  cliente: string | null
  referencia: string | null
  regimen: string
  cvCalculado: number
  medida: string | null
  porcentajeTrabajo: number | null
  createdAt: string
  user: { id: string; name: string }
}

export const fmt = (n: number, decimales = 2) =>
  n.toLocaleString('es-AR', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  })

export const fmtPct = (fraccion: number, decimales = 2) =>
  `${fmt(fraccion * 100, decimales)}%`

export const fmtFechaHora = (iso: string) =>
  new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))

/** Genera y descarga el PDF de un resultado. */
export async function descargarReguladoraPDF(
  resultado: ResultadoCalculo,
  cliente: string | null,
  referencia: string | null,
  fecha: Date
): Promise<void> {
  const blob = await generateReguladoraVaporPDF({
    resultado,
    cliente: cliente ?? undefined,
    referencia: referencia ?? undefined,
    fecha,
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const sufijo = cliente ? `-${cliente.replace(/[^\p{L}\p{N}]+/gu, '-')}` : ''
  a.download = `Reguladora-Vapor${sufijo}-${fecha.toISOString().slice(0, 10)}.pdf`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Regenera y descarga el PDF de un cálculo guardado (con su fecha original). */
export async function descargarPDFDeCalculo(c: CalculoHistorial): Promise<void> {
  const resultado = calcularReguladoraVapor(c.p1, c.p2, c.q)
  await descargarReguladoraPDF(resultado, c.cliente, c.referencia, new Date(c.createdAt))
}

/** URL de la calculadora precargada con los valores de un cálculo guardado. */
export function urlNuevaDesdeCalculo(c: CalculoHistorial): string {
  const params = new URLSearchParams({
    p1: String(c.p1),
    p2: String(c.p2),
    q: String(c.q),
  })
  if (c.cliente) params.set('cliente', c.cliente)
  if (c.referencia) params.set('ref', c.referencia)
  return `/herramientas/calculadora-vapor/nueva?${params.toString()}`
}
