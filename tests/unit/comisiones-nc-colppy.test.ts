import { describe, it, expect } from 'vitest'
import {
  MARCA_ANULADA_POR_NC,
  MARCA_NC_COLPPY,
  buscarRefactura,
  leerMarcaNC,
  mismoImporte,
  mismoNumeroComprobante,
  netoComprobante,
} from '@/lib/comisiones/nc-colppy'
import { MARCA_NC_SIN_PENDIENTE } from '@/lib/comisiones/liquidacion'

/**
 * NC hechas directo en Colppy contra facturas de comisiones. Caso real que
 * motivó la regla de "mes posterior": Naviera Cruz del Sur, facturas 18/9
 * (VAL-2026-3239 / 3212) con NC totales el 29/10 que debían restar en octubre.
 */

describe('leerMarcaNC', () => {
  it('lee la marca de factura anulada por NC del mismo mes', () => {
    expect(leerMarcaNC(`${MARCA_ANULADA_POR_NC}nc1: NC 0003-1 de Colppy anula esta factura`)).toEqual({
      ncId: 'nc1',
      facturaId: null,
    })
  })

  it('lee la marca de fila negativa por NC de mes posterior (con SIN_PENDIENTE adelante)', () => {
    const msg = `${MARCA_NC_SIN_PENDIENTE} ${MARCA_NC_COLPPY}nc2:cf9: NC 0003-00001301 de Colppy s/ A-0003-00015347 (2026-09-18)`
    expect(leerMarcaNC(msg)).toEqual({ ncId: 'nc2', facturaId: 'cf9' })
  })

  it('ignora otros mensajes', () => {
    expect(leerMarcaNC(null)).toBeNull()
    expect(leerMarcaNC('NC total s/ A-0007-00000010: todo')).toBeNull()
    expect(leerMarcaNC(`${MARCA_NC_SIN_PENDIENTE} Devolución s/ A-1: 2 u.`)).toBeNull()
  })
})

describe('netoComprobante / mismoImporte', () => {
  it('usa el subtotal (neto) y cae al total si no vino', () => {
    expect(netoComprobante({ subtotal: 1502.46, total: 1817.98 })).toBe(1502.46)
    expect(netoComprobante({ subtotal: 0, total: 1817.98 })).toBe(1817.98)
  })

  it('tolera redondeos de TC (0,5% / mín USD 1) y compara en valor absoluto', () => {
    expect(mismoImporte(1502.46, 1502.46)).toBe(true)
    expect(mismoImporte(1503.2, 1502.46)).toBe(true)
    expect(mismoImporte(-1300.08, 1300.08)).toBe(true)
    expect(mismoImporte(1817.98, 1502.46)).toBe(false) // total con IVA vs neto
  })
})

describe('mismoNumeroComprobante', () => {
  it('acepta el número completo o solo el final', () => {
    expect(mismoNumeroComprobante('0003-00001301', '0003-00001301')).toBe(true)
    expect(mismoNumeroComprobante('1301', '0003-00001301')).toBe(true)
  })

  it('rechaza otro número o vacío', () => {
    expect(mismoNumeroComprobante('1302', '0003-00001301')).toBe(false)
    expect(mismoNumeroComprobante('', '0003-00001301')).toBe(false)
    expect(mismoNumeroComprobante(null, '0003-00001301')).toBe(false)
  })
})

describe('buscarRefactura', () => {
  const nc = { id: 'nc', customerId: 'c1', subtotal: 1000, total: 1210, issueDate: new Date(2026, 9, 29) }

  it('detecta una FAV nueva del mismo cliente y neto, el día de la NC o después', () => {
    const favs = [{ id: 'f2', customerId: 'c1', subtotal: 1000, total: 1210, issueDate: new Date(2026, 9, 29) }]
    expect(buscarRefactura(nc, favs, 'f1')?.id).toBe('f2')
  })

  it('no cuenta la factura original, ni FAV anteriores, de otro cliente o de otro importe', () => {
    const favs = [
      { id: 'f1', customerId: 'c1', subtotal: 1000, total: 1210, issueDate: new Date(2026, 9, 30) },
      { id: 'f3', customerId: 'c1', subtotal: 1000, total: 1210, issueDate: new Date(2026, 8, 18) },
      { id: 'f4', customerId: 'c2', subtotal: 1000, total: 1210, issueDate: new Date(2026, 9, 30) },
      { id: 'f5', customerId: 'c1', subtotal: 800, total: 968, issueDate: new Date(2026, 9, 30) },
    ]
    expect(buscarRefactura(nc, favs, 'f1')).toBeUndefined()
  })
})
