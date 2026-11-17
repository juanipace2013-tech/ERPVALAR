import { describe, it, expect, vi } from 'vitest'

// answerAi importa el SDK de Anthropic y el logger; acá solo se prueba la
// lógica pura (no se llama a la IA ni a ML).
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import {
  applyListingLinks,
  isMlPermalink,
  linkPlaceholder,
  pickActiveListing,
  type ActiveListing,
} from '@/lib/mercadolibre/answerLinks'
import { finalizeAnswer, ML_ANSWER_MAX_CHARS } from '@/lib/mercadolibre/answerAi'
import type { MlItemLite } from '@/lib/mercadolibre/client'

const L2221_06: ActiveListing = {
  mlItemId: 'MLA1313195117',
  title: 'Válvula Aguja 3000lbs Rosca H- H A105 1ø Genebre 2221 06',
  permalink:
    'https://articulo.mercadolibre.com.ar/MLA-1313195117-valvula-aguja-3000lbs-rosca-h-h-a105-1-genebre-2221-06-_JM',
}

const live = (...items: MlItemLite[]) => new Map(items.map((i) => [i.id, i]))

describe('pickActiveListing', () => {
  it('devuelve la publicación activa con el título y permalink que informa ML', () => {
    const r = pickActiveListing(
      ['MLA1313195117'],
      live({ id: 'MLA1313195117', title: L2221_06.title, status: 'active', permalink: L2221_06.permalink })
    )
    expect(r).toEqual(L2221_06)
  })

  it('null si la publicación está pausada, cerrada o ML no la devolvió', () => {
    const paused = live({ id: 'MLA1', title: 't', status: 'paused', permalink: L2221_06.permalink })
    expect(pickActiveListing(['MLA1'], paused)).toBeNull()
    expect(pickActiveListing(['MLA2'], paused)).toBeNull()
    expect(pickActiveListing(['MLA1'], new Map())).toBeNull()
    expect(pickActiveListing([], paused)).toBeNull()
  })

  it('null si la activa no trae un permalink de Mercado Libre', () => {
    expect(pickActiveListing(['MLA1'], live({ id: 'MLA1', title: 't', status: 'active' }))).toBeNull()
    expect(
      pickActiveListing(
        ['MLA1'],
        live({ id: 'MLA1', title: 't', status: 'active', permalink: 'https://otrositio.com/MLA-1' })
      )
    ).toBeNull()
  })

  it('con varias activas prefiere la que tiene stock publicado', () => {
    const r = pickActiveListing(
      ['MLA1', 'MLA2'],
      live(
        { id: 'MLA1', title: 'a', status: 'active', available_quantity: 0, permalink: 'https://articulo.mercadolibre.com.ar/MLA-1-a-_JM' },
        { id: 'MLA2', title: 'b', status: 'active', available_quantity: 5, permalink: 'https://articulo.mercadolibre.com.ar/MLA-2-b-_JM' }
      )
    )
    expect(r?.mlItemId).toBe('MLA2')
  })
})

describe('isMlPermalink', () => {
  it('acepta solo https de mercadolibre.com.ar', () => {
    expect(isMlPermalink(L2221_06.permalink)).toBe(true)
    expect(isMlPermalink('https://www.mercadolibre.com.ar/algo/up/MLAU1')).toBe(true)
    expect(isMlPermalink('http://articulo.mercadolibre.com.ar/MLA-1')).toBe(false)
    expect(isMlPermalink('https://mercadolibre.com.ar.evil.com/MLA-1')).toBe(false)
    expect(isMlPermalink('https://evilmercadolibre.com.ar/MLA-1')).toBe(false)
    expect(isMlPermalink(null)).toBe(false)
  })
})

describe('applyListingLinks', () => {
  it('caso real: reemplaza el marcador por el permalink de la 2221 06', () => {
    const raw = `Hola, sí, trabajamos la medida de 1 pulgada. Puede comprarla desde esta publicación:\n${linkPlaceholder('MLA1313195117')}\n\nSaludos, VAL ARG`
    const r = applyListingLinks(raw, [L2221_06], 2000)
    expect(r.answer).toBe(
      `Hola, sí, trabajamos la medida de 1 pulgada. Puede comprarla desde esta publicación:\n${L2221_06.permalink}\n\nSaludos, VAL ARG`
    )
    expect(r.links).toEqual([L2221_06.permalink])
    expect(r.issues).toEqual([])
  })

  it('saca la puntuación pegada al marcador para no romper el link', () => {
    const r = applyListingLinks(`Hola, la encuentra acá: [[LINK:MLA1313195117]]. Saludos, VAL ARG`, [L2221_06], 2000)
    expect(r.answer).toBe(`Hola, la encuentra acá: ${L2221_06.permalink} Saludos, VAL ARG`)
  })

  it('marcador de una publicación que no está entre las activas: se quita y pide revisión', () => {
    const r = applyListingLinks('Hola, sí la tenemos: [[LINK:MLA999]]\nSaludos, VAL ARG', [L2221_06], 2000)
    expect(r.answer).toBe('Hola, sí la tenemos:\nSaludos, VAL ARG')
    expect(r.answer).not.toMatch(/LINK|http/)
    expect(r.links).toEqual([])
    expect(r.issues.join(' ')).toMatch(/MLA999/)
  })

  it('una URL inventada por el modelo se quita aunque sea de Mercado Libre', () => {
    const r = applyListingLinks(
      'Hola, la encuentra en https://articulo.mercadolibre.com.ar/MLA-555-inventada-_JM y en www.otrositio.com. Saludos, VAL ARG',
      [L2221_06],
      2000
    )
    expect(r.answer).not.toMatch(/https?:|www\./)
    expect(r.issues.length).toBe(1)
  })

  it('tolera que el modelo copie el permalink exacto de una publicación activa', () => {
    const r = applyListingLinks(`Hola: ${L2221_06.permalink}. Saludos`, [L2221_06], 2000)
    expect(r.answer).toContain(L2221_06.permalink)
    expect(r.issues).toEqual([])
  })

  it('si con el link supera el máximo, saca el link en vez de cortarlo', () => {
    const body = 'x'.repeat(1950)
    const r = applyListingLinks(`${body} [[LINK:MLA1313195117]]`, [L2221_06], 2000)
    expect(r.answer.length).toBeLessThanOrEqual(2000)
    expect(r.answer).not.toMatch(/http|LINK/)
    expect(r.links).toEqual([])
    expect(r.issues.join(' ')).toMatch(/2000/)
  })

  it('sin marcadores ni links deja el texto igual', () => {
    const t = 'Hola, sí, hay stock disponible.\n\nSaludos, VAL ARG'
    expect(applyListingLinks(t, [], 2000)).toEqual({ answer: t, issues: [], links: [] })
  })
})

describe('finalizeAnswer', () => {
  it('el link a la publicación propia no cuenta como contacto prohibido', () => {
    const r = finalizeAnswer(`Hola, sí la tenemos:\n[[LINK:MLA1313195117]]\n\nSaludos, VAL ARG`, [L2221_06])
    expect(r.answer).toContain(L2221_06.permalink)
    expect(r.forbidden).toBe(false)
    expect(r.linkIssues).toEqual([])
    expect(r.answer.length).toBeLessThanOrEqual(ML_ANSWER_MAX_CHARS)
  })

  it('sigue marcando teléfonos, mails y redes aunque haya un link válido', () => {
    const r = finalizeAnswer(`Hola, escríbanos por whatsapp al 11 4444 5555.\n[[LINK:MLA1313195117]]`, [L2221_06])
    expect(r.forbidden).toBe(true)
  })

  it('sin publicación activa no queda ningún link en la respuesta', () => {
    const r = finalizeAnswer('Hola, sí la trabajamos: [[LINK:MLA1313195117]]\nSaludos, VAL ARG', [])
    expect(r.answer).not.toMatch(/http|LINK/)
    expect(r.linkIssues.length).toBe(1)
  })
})
