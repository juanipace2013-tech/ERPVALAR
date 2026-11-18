import { describe, it, expect } from 'vitest'
import { buzonesOC, terminosOC } from '@/lib/quotes/oc-mail'
import { detectarTipoOC } from '@/lib/quotes/oc-archivo'

describe('terminosOC', () => {
  it('busca por cotización, OC y dominio del cliente', () => {
    expect(
      terminosOC({
        quoteNumber: 'VAL-2026-4331',
        purchaseOrderNumber: '003138',
        emailsCliente: ['tesoreria@prevind.com.ar; compras@prevind.com.ar', null],
      })
    ).toEqual(['VAL-2026-4331', '003138', 'prevind.com.ar'])
  })

  it('con mail genérico busca la dirección completa y saltea OC cortas y el dominio propio', () => {
    expect(
      terminosOC({
        quoteNumber: 'VAL-2026-1',
        purchaseOrderNumber: '12',
        emailsCliente: ['Juan@Gmail.com', 'ventas@val-ar.com.ar', 'no-es-mail'],
      })
    ).toEqual(['VAL-2026-1', 'juan@gmail.com'])
  })
})

describe('buzonesOC', () => {
  it('suma la casilla del vendedor solo si es de la empresa', () => {
    expect(buzonesOC('Lucas@val-ar.com.ar')).toEqual([
      'ventas@val-ar.com.ar',
      'administracion@val-ar.com.ar',
      'lucas@val-ar.com.ar',
    ])
    expect(buzonesOC('alguien@gmail.com')).toHaveLength(2)
    expect(buzonesOC('ventas@val-ar.com.ar')).toHaveLength(2)
  })
})

describe('detectarTipoOC', () => {
  it('reconoce PDF, JPG y PNG por contenido y rechaza el resto', () => {
    expect(detectarTipoOC(Buffer.from('%PDF-1.7 ...'))).toBe('application/pdf')
    expect(detectarTipoOC(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(detectarTipoOC(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png')
    expect(detectarTipoOC(Buffer.from('MZ\x90\x00'))).toBeNull()
    expect(detectarTipoOC(Buffer.from('PK\x03\x04'))).toBeNull()
  })
})
