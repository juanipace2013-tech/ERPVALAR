import { describe, it, expect } from 'vitest'
import { asuntoFactura, destinatarios, nombreComprobante, cuerpoHtml } from '@/lib/email/borrador-factura'

const a = (address: string, name?: string) => ({ emailAddress: { address, name } })
const hilo = (from: string, to: string[], cc: string[] = []) => ({
  id: 'x', subject: 'RE: Pedido de Cotización', receivedDateTime: '2026-10-21T17:24:53Z',
  from: a(from), toRecipients: to.map((e) => a(e)), ccRecipients: cc.map((e) => a(e)),
})
const BUZON = 'administracion@val-ar.com.ar'
const dirs = (xs: Array<{ emailAddress: { address: string } }>) => xs.map((x) => x.emailAddress.address)

describe('borrador de factura', () => {
  it('asunto como lo escribe Caro', () => {
    expect(asuntoFactura({ numero: 198 }, 'RE: Pedido de Cotización')).toBe('Factura VALAR 00000198 // RE: Pedido de Cotización')
    expect(asuntoFactura({ numero: 200 }, 'RV: Confirmación de compra')).toBe('Factura VALAR 00000200 // RE: Confirmación de compra')
    expect(asuntoFactura({ numero: 199 }, null)).toBe('Factura VALAR 00000199')
  })

  it('para = administración del cliente, cc = resto + ventas@, sin internos', () => {
    const d = destinatarios(
      hilo('ventas@val-ar.com.ar', ['milagros.van@cipor.com.ar', BUZON], ['daniel.perez@cipor.com.ar', 'administracion@cipor.com.ar']),
      [], BUZON
    )
    expect(dirs(d.para)).toEqual(['administracion@cipor.com.ar'])
    expect(dirs(d.cc)).toEqual(['milagros.van@cipor.com.ar', 'daniel.perez@cipor.com.ar', 'ventas@val-ar.com.ar'])
  })

  it('suma casillas de pago del ERP y usa el ERP si el hilo es un reenvío interno', () => {
    const d = destinatarios(hilo('dario@exar.com.ar', [BUZON]), ['cuentasporpagar@exar.com.ar', 'otro@exar.com.ar'], BUZON)
    expect(dirs(d.para)).toEqual(['cuentasporpagar@exar.com.ar'])
    expect(dirs(d.cc)).toEqual(['dario@exar.com.ar', 'ventas@val-ar.com.ar'])
    const r = destinatarios(hilo('ventas@val-ar.com.ar', [BUZON]), ['compras@invap.com.ar'], BUZON)
    expect(dirs(r.para)).toEqual(['compras@invap.com.ar'])
  })

  it('texto con comprobante, OC y cotización', () => {
    const pdf = { letra: 'A', cbteTipo: 1, puntoVenta: 7, numero: 198, clase: 'FACTURA' } as any
    expect(nombreComprobante(pdf)).toBe('FCA 0007-00000198')
    const html = cuerpoHtml({ pdf, quoteNumber: 'VAL-2026-3367', ordenCompra: 'P-26-A181', emailsCliente: [] }, new Date('2026-10-23T19:41:00Z'))
    expect(html).toContain('Muy buenas tardes')
    expect(html).toContain('<b>FCA 0007-00000198</b> que corresponde a la <b>Orden de Compra N° P-26-A181</b> y <b>Cotización VAL-2026-3367</b>.')
    const sinOc = cuerpoHtml({ pdf, quoteNumber: 'VAL-2026-1', ordenCompra: null, emailsCliente: [] })
    expect(sinOc).toContain('que corresponde a la <b>Cotización VAL-2026-1</b>.')
  })
})
