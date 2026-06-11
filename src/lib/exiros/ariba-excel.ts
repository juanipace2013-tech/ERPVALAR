/**
 * Parser del Excel de contenido de evento de SAP Ariba ("Descargar contenido"
 * → Excel, formato .xls BIFF8 viejo — SheetJS lo lee bien).
 *
 * Estructura típica (evento real de Pampa Energía):
 *   - "Instr.de intención de respuesta" / "Instr.de enviar respuesta" → se ignoran
 *   - "DV_sheet_*" → se ignora
 *   - "2 Condiciones, Requisitos y ..." → checklist de papeleo (informativa)
 *   - "3 Propuesta Económica (Sobre)" → los ítems
 *
 * IMPORTANTE: los nombres de hoja y de columna varían entre compradores y
 * eventos, así que NADA se hardcodea por nombre exacto:
 *   - La hoja de ítems es la que tenga una fila de headers con al menos
 *     "Descripción" y "Cantidad" (case/acento-insensible).
 *   - Las columnas se mapean por nombre de header normalizado.
 *   - Ítems = filas con valor jerárquico (^\d+\.\d+) en la columna Número y
 *     Descripción no vacía. Filas de ayuda/leyenda quedan afuera solas.
 *   - Requisitos = en las demás hojas con tabla Número/Nombre, las filas con
 *     número jerárquico y Nombre no vacío.
 */

import * as XLSX from 'xlsx'

export interface AribaItem {
  nro: number
  descCorta: string
  descLarga: string | null
  cantidad: number | null
  unidad: string | null
  cliente: string | null
  fechaRequerida: Date | null
}

export interface AribaParseResult {
  items: AribaItem[]
  requisitos: string[]
  hojaItems: string | null
}

const NUM_JERARQUICO = /^\d+\.\d+/

/** lowercase + sin acentos + sin espacios repetidos, para matchear headers */
function normalizar(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim()
}

function texto(v: unknown): string {
  return String(v ?? '').trim()
}

function parseCantidad(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const n = parseFloat(String(v).replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function parseFecha(v: unknown): Date | null {
  if (v == null || v === '') return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  if (typeof v === 'number') {
    // Serial de Excel (días desde 1900) — fallback si cellDates no aplicó
    const ms = Math.round((v - 25569) * 86400 * 1000)
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const s = String(v).trim()
  // dd/mm/yyyy (formato AR habitual en Ariba es-AR)
  const ar = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (ar) {
    const d = new Date(Number(ar[3]), Number(ar[2]) - 1, Number(ar[1]), 12)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

type Fila = unknown[]

/** Busca en las primeras filas una fila de headers que cumpla el predicado.
 *  Devuelve el índice de la fila o -1. */
function buscarFilaHeaders(filas: Fila[], predicado: (headersNorm: string[]) => boolean): number {
  const limite = Math.min(filas.length, 15)
  for (let i = 0; i < limite; i++) {
    const headersNorm = (filas[i] || []).map(normalizar)
    if (predicado(headersNorm)) return i
  }
  return -1
}

/** Índice de la primera columna cuyo header normalizado contiene `needle`. */
function colPor(headersNorm: string[], needle: string): number {
  return headersNorm.findIndex((h) => h.includes(needle))
}

export function parseAribaExcel(buffer: Buffer): AribaParseResult {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })

  const items: AribaItem[] = []
  const requisitos: string[] = []
  let hojaItems: string | null = null

  // Pasada 1: detectar la hoja de ítems (headers con Descripción + Cantidad)
  const hojas = workbook.SheetNames.filter((name) => {
    const n = normalizar(name)
    return !n.startsWith('instr') && !n.startsWith('dv_sheet')
  })

  const filasPorHoja = new Map<string, Fila[]>()
  for (const name of hojas) {
    const ws = workbook.Sheets[name]
    if (!ws) continue
    filasPorHoja.set(
      name,
      XLSX.utils.sheet_to_json<Fila>(ws, { header: 1, defval: null, raw: true })
    )
  }

  for (const name of hojas) {
    const filas = filasPorHoja.get(name) || []
    const idxHeaders = buscarFilaHeaders(
      filas,
      // "cantidad" puede venir abreviado ("Cant.") según el comprador
      (h) => h.some((c) => c.includes('descripcion')) && h.some((c) => c.startsWith('cant'))
    )
    if (idxHeaders === -1) continue

    hojaItems = name
    const headersNorm = (filas[idxHeaders] || []).map(normalizar)

    let colNumero = colPor(headersNorm, 'numero')
    if (colNumero === -1) colNumero = 0
    const colNombre = colPor(headersNorm, 'nombre')
    const colDescripcion = colPor(headersNorm, 'descripcion')
    const colCantidad = headersNorm.findIndex((c) => c.startsWith('cant'))
    const colUnidad = colPor(headersNorm, 'unidad')
    const colShipTo = colPor(headersNorm, 'ship to')
    const colFecha = colPor(headersNorm, 'fecha de entrega')

    for (let i = idxHeaders + 1; i < filas.length; i++) {
      const fila = filas[i] || []
      const numero = texto(fila[colNumero])
      if (!NUM_JERARQUICO.test(numero)) continue

      const descLarga = colDescripcion >= 0 ? texto(fila[colDescripcion]) : ''
      if (!descLarga) continue

      const nombre = colNombre >= 0 ? texto(fila[colNombre]) : ''
      // nro Int: la parte después del punto ("3.4" → 4); fallback secuencial
      const sub = parseInt(numero.split('.')[1], 10)
      items.push({
        nro: Number.isFinite(sub) ? sub : items.length + 1,
        descCorta: nombre || descLarga.slice(0, 120),
        descLarga,
        cantidad: colCantidad >= 0 ? parseCantidad(fila[colCantidad]) : null,
        unidad: colUnidad >= 0 ? texto(fila[colUnidad]) || null : null,
        cliente: colShipTo >= 0 ? texto(fila[colShipTo]) || null : null,
        fechaRequerida: colFecha >= 0 ? parseFecha(fila[colFecha]) : null,
      })
    }
    break // una sola hoja de ítems
  }

  // Pasada 2: requisitos — las demás hojas con tabla Número/Nombre
  for (const name of hojas) {
    if (name === hojaItems) continue
    const filas = filasPorHoja.get(name) || []
    const idxHeaders = buscarFilaHeaders(
      filas,
      (h) => h.some((c) => c.includes('numero')) && h.some((c) => c === 'nombre' || c.includes('nombre'))
    )
    if (idxHeaders === -1) continue

    const headersNorm = (filas[idxHeaders] || []).map(normalizar)
    let colNumero = colPor(headersNorm, 'numero')
    if (colNumero === -1) colNumero = 0
    const colNombre = colPor(headersNorm, 'nombre')
    if (colNombre === -1) continue

    for (let i = idxHeaders + 1; i < filas.length; i++) {
      const fila = filas[i] || []
      if (!NUM_JERARQUICO.test(texto(fila[colNumero]))) continue
      const nombre = texto(fila[colNombre])
      if (nombre) requisitos.push(nombre)
    }
  }

  return { items, requisitos, hojaItems }
}
