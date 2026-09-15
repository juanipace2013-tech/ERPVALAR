import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { fechaFromSubject, parseStockXlsx } from '@/lib/winters-stock/mail-ingest'

function buildXlsx(rows: Array<Record<string, unknown>>): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Stock')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

describe('fechaFromSubject', () => {
  it('lee la fecha del asunto real de WINTERS', () => {
    const d = fechaFromSubject('WINTERS INSTRUMENTS SA // STOCK WINAR I al 14/09/2026')
    expect(d?.toISOString()).toBe('2026-09-14T12:00:00.000Z')
  })

  it('acepta dia y mes de un digito', () => {
    const d = fechaFromSubject('STOCK WINAR I al 3/8/2026')
    expect(d?.toISOString()).toBe('2026-08-03T12:00:00.000Z')
  })

  it('devuelve null si no hay fecha', () => {
    expect(fechaFromSubject('STOCK WINAR actualizado')).toBeNull()
    expect(fechaFromSubject(undefined)).toBeNull()
  })
})

describe('parseStockXlsx', () => {
  it('parsea las columnas de la planilla WINAR', () => {
    const buffer = buildXlsx([
      { 'Número de artículo': '120B0404', 'Cant. disponible': 28, 'Descripción artículo': 'Adaptador de bronce' },
      { 'Número de artículo': '103SR04', 'Cant. disponible': 8, 'Descripción artículo': null },
    ])
    expect(parseStockXlsx(buffer)).toEqual([
      { codigo: '120B0404', cantidad: 28, descripcion: 'Adaptador de bronce' },
      { codigo: '103SR04', cantidad: 8, descripcion: null },
    ])
  })

  it('saltea filas sin codigo, sin cantidad numerica o con codigo repetido', () => {
    const buffer = buildXlsx([
      { 'Número de artículo': '120B0404', 'Cant. disponible': 28 },
      { 'Número de artículo': '', 'Cant. disponible': 5 },
      { 'Número de artículo': 'SIN-CANT', 'Cant. disponible': 'n/a' },
      { 'Número de artículo': '120B0404', 'Cant. disponible': 99 },
    ])
    const rows = parseStockXlsx(buffer)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ codigo: '120B0404', cantidad: 28 })
  })

  it('devuelve vacio si cambiaron los encabezados', () => {
    const buffer = buildXlsx([{ Codigo: '120B0404', Cantidad: 28 }])
    expect(parseStockXlsx(buffer)).toEqual([])
  })
})
