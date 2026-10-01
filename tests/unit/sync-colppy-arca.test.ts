import { describe, it, expect } from 'vitest'
import { resolverSyncArca } from '@/lib/facturacion/sync-colppy'

const factA = { status: 'AUTHORIZED' as const, cbteTipo: 1, pointOfSale: 7, cbteNumero: 3 }
const fce = { status: 'AUTHORIZED' as const, cbteTipo: 201, pointOfSale: 7, cbteNumero: 1 }
const colppy = (statusColppy: string, tipoComp = '4', nroFactura = '0007-00000003') => ({ statusColppy, tipoComp, nroFactura })

describe('sync Colppy sobre comprobantes emitidos por el ERP (ARCA)', () => {
  it('una factura impaga queda AUTHORIZED (nunca PENDING: la limpieza borraba los PENDING)', () => {
    const r = resolverSyncArca(factA, colppy('PENDING'))
    expect(r.status).toBe('AUTHORIZED')
    expect(r.colppySyncStatus).toBe('OK')
    expect(r.actualizarSaldo).toBe(true)
  })

  it('cobrada en Colppy → PAID; si se anula el recibo vuelve a AUTHORIZED', () => {
    expect(resolverSyncArca(factA, colppy('PAID')).status).toBe('PAID')
    expect(resolverSyncArca({ ...factA, status: 'PAID' }, colppy('PENDING')).status).toBe('AUTHORIZED')
  })

  it('una PENDING heredada de syncs viejos se recupera a AUTHORIZED', () => {
    expect(resolverSyncArca({ ...factA, status: 'PENDING' }, colppy('PENDING')).status).toBe('AUTHORIZED')
  })

  it('anulada por NC total del ERP: no toca status ni saldo', () => {
    const r = resolverSyncArca({ ...factA, status: 'CANCELLED' }, colppy('PENDING'))
    expect(r.status).toBe('CANCELLED')
    expect(r.actualizarSaldo).toBe(false)
  })

  it('FCE aprobada bien (tildada como MiPyME, mismo número) → OK', () => {
    const r = resolverSyncArca(fce, colppy('PENDING', '51', '0007-00000001'))
    expect(r.colppySyncStatus).toBe('OK')
    expect(r.colppySyncError).toBeNull()
  })

  it('FCE aprobada sin tildar FCE → ERROR con el motivo', () => {
    const r = resolverSyncArca(fce, colppy('PENDING', '4', '0007-00000001'))
    expect(r.colppySyncStatus).toBe('ERROR')
    expect(r.colppySyncError).toMatch(/sin tildar/)
  })

  it('FCE aprobada con otro número (provisorio) → ERROR indicando el correcto', () => {
    const r = resolverSyncArca(fce, colppy('PENDING', '51', '0007-12345678'))
    expect(r.colppySyncStatus).toBe('ERROR')
    expect(r.colppySyncError).toMatch(/0007-00000001/)
  })
})
