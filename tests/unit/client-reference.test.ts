import { describe, it, expect } from 'vitest'
import {
  CLIENT_REFERENCE_MAX,
  normalizeClientReference,
  withClientReference,
} from '@/lib/quotes/client-reference'

describe('normalizeClientReference', () => {
  it('vacío, espacios o no-string → null', () => {
    expect(normalizeClientReference('')).toBeNull()
    expect(normalizeClientReference('   ')).toBeNull()
    expect(normalizeClientReference(null)).toBeNull()
    expect(normalizeClientReference(undefined)).toBeNull()
    expect(normalizeClientReference(3000001204)).toBeNull()
  })

  it('colapsa espacios y saltos de línea (pegado desde un mail)', () => {
    expect(normalizeClientReference('  SOLPED 3000001204\n\tPos.  30 ')).toBe('SOLPED 3000001204 Pos. 30')
  })

  it('corta al máximo de la columna', () => {
    expect(normalizeClientReference('x'.repeat(500))).toHaveLength(CLIENT_REFERENCE_MAX)
  })
})

describe('withClientReference', () => {
  const desc = '2406 14 Válvula de retención a clapeta tipo wafer. Diámetro 6".'

  it('sin referencia devuelve la descripción tal cual', () => {
    expect(withClientReference(desc, null)).toBe(desc)
    expect(withClientReference(desc, undefined)).toBe(desc)
    expect(withClientReference(desc, '  ')).toBe(desc)
  })

  it('agrega la referencia al final', () => {
    expect(withClientReference(desc, 'SOLPED 3000001204 · Pos. 30')).toBe(
      `${desc} - Ref. cliente: SOLPED 3000001204 · Pos. 30`
    )
  })

  it('es idempotente: no la duplica si la descripción ya la trae', () => {
    const una = withClientReference(desc, 'SOLPED 3000001204 · Pos. 30')
    expect(withClientReference(una, 'SOLPED 3000001204 · Pos. 30')).toBe(una)
  })
})
