import { describe, it, expect } from 'vitest'
import { MAX_PAGE_LIMIT, parseLimit, parsePage } from '@/lib/pagination'
import { ROLES, hasRole, requireRole } from '@/lib/authz'

describe('parsePage / parseLimit', () => {
  it('page: default 1, rechaza 0, negativos y basura', () => {
    expect(parsePage(null)).toBe(1)
    expect(parsePage('3')).toBe(3)
    expect(parsePage('0')).toBe(1)
    expect(parsePage('-2')).toBe(1)
    expect(parsePage('abc')).toBe(1)
  })
  it('limit: default, tope máximo y valores inválidos', () => {
    expect(parseLimit(null, 50)).toBe(50)
    expect(parseLimit('20', 50)).toBe(20)
    expect(parseLimit('999999', 50)).toBe(MAX_PAGE_LIMIT)
    expect(parseLimit('0', 50)).toBe(50)
    expect(parseLimit('NaN', 50)).toBe(50)
    expect(parseLimit('500', 50, 100)).toBe(100)
  })
})

describe('requireRole', () => {
  const session = (role?: string) => (role ? ({ user: { role } } as any) : null)
  it('deja pasar a los roles del grupo', () => {
    expect(requireRole(session('ADMIN'), ROLES.GESTION)).toBeNull()
    expect(requireRole(session('GERENTE'), ROLES.GESTION)).toBeNull()
    expect(hasRole(session('VENDEDOR'), ROLES.OPERATIVOS)).toBe(true)
  })
  it('devuelve 403 para roles fuera del grupo o sin sesión', async () => {
    const res = requireRole(session('VENDEDOR'), ROLES.GESTION)
    expect(res?.status).toBe(403)
    expect(await res?.json()).toEqual({ error: 'No tenés permisos para esta acción' })
    expect(requireRole(session('CONTADOR'), ROLES.OPERATIVOS)?.status).toBe(403)
    expect(requireRole(null, ROLES.ADMIN)?.status).toBe(403)
  })
})
