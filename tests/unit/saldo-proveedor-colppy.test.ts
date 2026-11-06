import { describe, it, expect, vi, beforeEach } from 'vitest'

// Saldo de un proveedor leído de Colppy (listar_proveedor filtrado): es lo que
// actualiza el listado del ERP después de un pago o de una factura.

const callMock = vi.fn()
vi.mock('@/lib/colppy', () => ({
  callColppyAPI: (...a: unknown[]) => callMock(...a),
  getCachedColppySession: vi.fn(async () => ({ usuario: 'u', claveSesion: 'k', idEmpresa: '1' })),
  getColppyConfig: () => ({ user: 'u', password: 'p' }),
  invalidateColppySessionCache: vi.fn(),
  md5Hash: (s: string) => s,
  ColppySessionExpiredError: class extends Error {},
}))

import { colppySaldoProveedor } from '@/lib/pagos-proveedores/colppy-pagos'

const ok = (data: unknown[]) => ({ result: { estado: 0 }, response: { success: true, data } })

describe('colppySaldoProveedor', () => {
  beforeEach(() => callMock.mockReset())

  it('devuelve el Saldo de la fila con ese id (como el listado de Colppy)', async () => {
    callMock.mockResolvedValue(ok([{ idProveedor: '1001', RazonSocial: 'PROVEEDOR DE PRUEBA SA', Saldo: '1234.56' }]))
    expect(await colppySaldoProveedor('1001')).toBe(1234.56)
    const pedido = callMock.mock.calls[0][0]
    expect(pedido.service).toEqual({ provision: 'Proveedor', operacion: 'listar_proveedor' })
    expect(pedido.parameters.filter).toEqual([{ field: 'idProveedor', op: '=', value: '1001' }])
  })

  it('si Colppy ignora el filtro, busca la fila del proveedor entre las que vinieron', async () => {
    callMock.mockResolvedValue(
      ok([
        { idProveedor: '1', Saldo: '10' },
        { idProveedor: '2002', Saldo: '98765.43' },
      ])
    )
    expect(await colppySaldoProveedor('2002')).toBe(98765.43)
  })

  it('si el proveedor no aparece o el saldo no es un número, null (no se toca el saldo guardado)', async () => {
    callMock.mockResolvedValue(ok([{ idProveedor: '1', Saldo: '10' }]))
    expect(await colppySaldoProveedor('2')).toBeNull()
    callMock.mockResolvedValue(ok([{ idProveedor: '2', Saldo: '' }]))
    expect(await colppySaldoProveedor('2')).toBeNull()
  })
})
