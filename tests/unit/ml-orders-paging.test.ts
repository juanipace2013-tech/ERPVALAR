import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'

/**
 * searchPaidOrdersSince: pagina de a 50 hasta el tope (el listado de
 * facturación ML pide 3000) y avisa el total de ML. Una página que falla se
 * reintenta una vez; si sigue fallando, la primera corta todo y una posterior
 * devuelve lo ya traído con el error en info. fetch falso: nunca sale a la red
 * ni toca el token real.
 */

vi.mock('@/lib/prisma', () => ({
  prisma: {
    mlCredential: {
      findUnique: vi.fn(async () => ({ id: 'c1', accessToken: 'T', refreshToken: 'R', expiresAt: new Date(Date.now() + 3600_000), mlUserId: BigInt(1) })),
      findFirst: vi.fn(),
    },
  },
}))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { searchPaidOrdersSince } from '@/lib/mercadolibre/client'

let totalMl = 0
const offsets: number[] = []
/** offset → respuestas que fallan antes de contestar bien (status HTTP o 'red') */
const fallas = new Map<number, Array<number | 'red'>>()

beforeAll(() => {
  process.env.ML_USER_ID = '1'
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = new URL(url)
      if (!u.pathname.startsWith('/orders/search')) throw new Error(`ML: ruta inesperada ${u.pathname}`)
      const offset = Number(u.searchParams.get('offset'))
      const limit = Number(u.searchParams.get('limit'))
      offsets.push(offset)
      const falla = fallas.get(offset)?.shift()
      if (falla === 'red') throw new TypeError('fetch failed')
      if (falla) return new Response(JSON.stringify({ message: 'error' }), { status: falla })
      const n = Math.max(0, Math.min(limit, totalMl - offset))
      const results = Array.from({ length: n }, (_, i) => ({ id: offset + i + 1, status: 'paid', order_items: [] }))
      return new Response(JSON.stringify({ results, paging: { total: totalMl, offset, limit } }), { status: 200 })
    })
  )
})
afterAll(() => {
  vi.unstubAllGlobals()
  delete process.env.ML_USER_ID
})
beforeEach(() => {
  offsets.length = 0
  fallas.clear()
})

describe('searchPaidOrdersSince', () => {
  it('sigue paginando más allá de 200 hasta traer todas (tope 3000)', async () => {
    totalMl = 260
    const info: { total?: number } = {}
    const ordenes = await searchPaidOrdersSince(new Date('2026-10-01T03:00:00Z'), 3000, info)
    expect(ordenes).toHaveLength(260)
    expect(offsets).toEqual([0, 50, 100, 150, 200, 250])
    expect(info.total).toBe(260)
    expect(ordenes[259].id).toBe(260)
  })

  it('respeta el tope y deja el total de ML para el aviso de "truncado"', async () => {
    totalMl = 260
    const info: { total?: number } = {}
    const ordenes = await searchPaidOrdersSince(new Date('2026-10-01T03:00:00Z'), 200, info)
    expect(ordenes).toHaveLength(200)
    expect(offsets).toEqual([0, 50, 100, 150])
    expect(info.total).toBe(260)
  })

  it('corta en la primera página incompleta', async () => {
    totalMl = 30
    expect(await searchPaidOrdersSince(new Date('2026-10-01T03:00:00Z'), 3000)).toHaveLength(30)
    expect(offsets).toEqual([0])
  })
})

describe('searchPaidOrdersSince: páginas que fallan', () => {
  const desde = new Date('2026-10-01T03:00:00Z')
  const sinEspera = { esperaReintentoMs: 0 }

  it('una página posterior falla una vez (429): se reintenta y trae todo, sin error', async () => {
    totalMl = 160
    fallas.set(100, [429])
    const info: { total?: number; error?: string } = {}
    const ordenes = await searchPaidOrdersSince(desde, 3000, info, sinEspera)
    expect(ordenes).toHaveLength(160)
    expect(offsets).toEqual([0, 50, 100, 100, 150])
    expect(info.error).toBeUndefined()
  })

  it('una página posterior falla dos veces (5xx / red): devuelve las ya traídas y deja el error en info', async () => {
    totalMl = 160
    fallas.set(100, [503, 'red'])
    const info: { total?: number; error?: string } = {}
    const ordenes = await searchPaidOrdersSince(desde, 3000, info, sinEspera)
    expect(ordenes).toHaveLength(100)
    expect(offsets).toEqual([0, 50, 100, 100])
    expect(info).toMatchObject({ total: 160, error: 'fetch failed' })
  })

  it('la PRIMERA página falla (también al reintentar): lanza, no hay nada para mostrar', async () => {
    totalMl = 160
    fallas.set(0, [500, 502])
    const info: { total?: number; error?: string } = {}
    await expect(searchPaidOrdersSince(desde, 3000, info, sinEspera)).rejects.toThrow(/HTTP 502/)
    expect(offsets).toEqual([0, 0])
  })

  it('la primera página falla una vez: el reintento la trae', async () => {
    totalMl = 30
    fallas.set(0, [429])
    expect(await searchPaidOrdersSince(desde, 3000, undefined, sinEspera)).toHaveLength(30)
  })

  it('el reintento espera ~1 s por defecto', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    try {
      totalMl = 60
      fallas.set(50, [429])
      const p = searchPaidOrdersSince(desde, 3000)
      await vi.advanceTimersByTimeAsync(999)
      expect(offsets).toEqual([0, 50])
      await vi.advanceTimersByTimeAsync(1)
      expect(await p).toHaveLength(60)
      expect(offsets).toEqual([0, 50, 50])
    } finally {
      vi.useRealTimers()
    }
  })
})
