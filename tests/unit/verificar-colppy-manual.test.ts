import { describe, it, expect } from 'vitest'
import { verificarFacturaColppyManual } from '@/lib/facturacion/verificar-colppy-manual'

// Forma real de leer_facturaventa (2/10/2026): letra en idTipoFactura, "0007-00000028"
const info = (o: Record<string, unknown> = {}) => ({
  idFactura: '54300001',
  idCliente: '14600000',
  idTipoComprobante: '4',
  idTipoFactura: 'E',
  nroFactura: '0010-00000001',
  idEstadoFactura: 'Aprobada',
  totalFactura: 2603.55,
  currencyIso: 'USD',
  ...o,
})
const esperado = { colppyId: '54300001', pointOfSale: 10, cbteNumero: 1, total: 2603.55, currency: 'USD' }

describe('verificarFacturaColppyManual', () => {
  it('la misma Factura E: OK y devuelve el id del cliente en Colppy', () => {
    expect(verificarFacturaColppyManual(info(), esperado)).toEqual({ ok: true, idCliente: '14600000' })
    // El código numérico del listado también vale
    expect(verificarFacturaColppyManual(info({ idTipoFactura: '3' }), esperado).ok).toBe(true)
  })

  it('id inexistente en Colppy', () => {
    const r = verificarFacturaColppyManual(null, esperado)
    expect(r).toMatchObject({ ok: false })
    expect(!r.ok && r.error).toContain('No existe en Colppy')
  })

  it('id de otra factura (letra A, otro número, NC) se rechaza', () => {
    expect(verificarFacturaColppyManual(info({ idTipoFactura: 'A', nroFactura: '0007-00000028' }), esperado)).toMatchObject({ ok: false })
    const r = verificarFacturaColppyManual(info({ nroFactura: '0010-00000002' }), esperado)
    expect(!r.ok && r.error).toContain('en el ERP es la 0010-00000001')
    expect(verificarFacturaColppyManual(info({ idTipoComprobante: '8' }), esperado)).toMatchObject({ ok: false })
  })

  it('anulada en Colppy se rechaza', () => {
    expect(verificarFacturaColppyManual(info({ idEstadoFactura: 'Anulada' }), esperado)).toMatchObject({ ok: false })
  })

  it('otro cliente de Colppy se rechaza; sin cliente conocido se acepta y se informa', () => {
    expect(verificarFacturaColppyManual(info(), { ...esperado, colppyClienteId: '999' })).toMatchObject({ ok: false })
    expect(verificarFacturaColppyManual(info(), { ...esperado, colppyClienteId: '14600000' }).ok).toBe(true)
  })

  it('total distinto en la misma moneda se rechaza; en otra moneda no se compara', () => {
    expect(verificarFacturaColppyManual(info({ totalFactura: 2078.88 }), esperado)).toMatchObject({ ok: false })
    expect(verificarFacturaColppyManual(info({ totalFactura: 2603.56 }), esperado).ok).toBe(true)
    expect(verificarFacturaColppyManual(info({ totalFactura: 3800000, currencyIso: 'ARS' }), esperado).ok).toBe(true)
  })
})
