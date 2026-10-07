import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Búsqueda del artículo en el inventario de Colppy (getColppyItemId).
 * Colppy a veces responde estado 0 con response.success=false ("No se pudo
 * procesar la acción"): antes eso quedaba como "no existe" y la línea iba como
 * ítem manual (A 0007-00000059, 4020 06). fetch falso: nunca sale a la red.
 */

const db = vi.hoisted(() => ({ product: { updateMany: vi.fn() } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { getColppyItemId } from '@/lib/colppy'

const session = { usuario: 'u', claveSesion: 'k', idEmpresa: '1' }
const noProcesada = { result: { estado: 0, mensaje: 'La operación se realizó correctamente' }, response: { success: false, message: 'No se pudo procesar la acción' } }
const encontrada = { result: { estado: 0 }, response: { success: true, data: [{ idItem: '555', codigo: '4020 06' }] } }
const vacia = { result: { estado: 0 }, response: { success: true, data: [] } }

function respuestas(...bodies: unknown[]) {
  const fetchMock = vi.fn()
  for (const b of bodies) fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(b), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv('COLPPY_USER', 'u')
  vi.stubEnv('COLPPY_PASSWORD', 'p')
  vi.stubEnv('COLPPY_ID_EMPRESA', '1')
  db.product.updateMany.mockReset().mockResolvedValue({ count: 1 })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('getColppyItemId', () => {
  it('encontrado: devuelve el idItem y lo guarda en el producto', async () => {
    respuestas(encontrada)
    await expect(getColppyItemId(session, '4020 06')).resolves.toBe('555')
    expect(db.product.updateMany).toHaveBeenCalledWith({ where: { sku: '4020 06', colppyItemId: null }, data: { colppyItemId: 555 } })
  })

  it('no existe en Colppy: "0" (ítem manual), sin reintentar', async () => {
    const f = respuestas(vacia)
    await expect(getColppyItemId(session, 'XX')).resolves.toBe('0')
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('Colppy no procesa la búsqueda: reintenta y la segunda vez lo encuentra', async () => {
    const f = respuestas(noProcesada, encontrada)
    const p = getColppyItemId(session, '4020 06')
    await vi.runAllTimersAsync()
    await expect(p).resolves.toBe('555')
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('Colppy no procesa ninguna vez: error (no se emite la factura con la línea sin artículo)', async () => {
    const f = respuestas(noProcesada, noProcesada, noProcesada)
    const p = getColppyItemId(session, '4020 06')
    const assertion = expect(p).rejects.toThrow(/4020 06.*No se emitió la factura/)
    await vi.runAllTimersAsync()
    await assertion
    expect(f).toHaveBeenCalledTimes(3)
  })
})
