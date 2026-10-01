import { describe, it, expect } from 'vitest'
import { carpetaMes } from '@/lib/sharepoint/facturas-emitidas'

describe('carpeta del mes en SharePoint ("10 2026")', () => {
  it('usa mes y año en hora argentina', () => {
    expect(carpetaMes(new Date('2026-10-01T12:00:00Z'))).toBe('10 2026')
    // 1/10 01:00 UTC = 30/9 22:00 en Argentina → septiembre
    expect(carpetaMes(new Date('2026-10-01T01:00:00Z'))).toBe('09 2026')
  })
})
