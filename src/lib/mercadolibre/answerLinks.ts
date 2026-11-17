/**
 * Links a otras publicaciones propias en las respuestas a preguntas de ML.
 *
 * Cuando el comprador pide otra medida del mismo modelo y esa medida tiene
 * publicación ACTIVA, la respuesta lleva el link para que vaya directo.
 *
 * El link nunca lo escribe el modelo: la IA solo pone un marcador
 * ([[LINK:MLA123]]) y acá se reemplaza por el permalink que devolvió la API de
 * ML para esa publicación. Cualquier marcador desconocido o URL que no sea uno
 * de esos permalinks se saca / se marca para revisión.
 *
 * Sobre la política de ML: las Políticas de Publicación cuentan "URL o sitios
 * web" como dato de contacto prohibido en preguntas y respuestas, pero permiten
 * enlaces a páginas dentro de Mercado Libre; la doc de la API de preguntas no
 * dice nada de links. En la práctica la cuenta tiene respuestas con links a
 * mercadolibre.com.ar publicadas desde sep-2026 y siguen ACTIVE (verificado
 * 17/11/2026). Links a cualquier otro sitio siguen prohibidos.
 */

import type { MlItemLite } from './client'

/** Publicación activa de una variante, confirmada contra la API de ML. */
export interface ActiveListing {
  mlItemId: string
  title: string
  permalink: string
}

const PLACEHOLDER_RE = /\[\[\s*LINK\s*:\s*(MLA\d+)\s*\]\]/gi
const URL_RE = /(?:https?:\/\/|www\.)[^\s"'<>]+/gi
// Solo se acepta como link un permalink https de Mercado Libre Argentina.
const ML_PERMALINK_RE = /^https:\/\/([a-z0-9-]+\.)*mercadolibre\.com\.ar\/\S+$/i

export function linkPlaceholder(mlItemId: string): string {
  return `[[LINK:${mlItemId}]]`
}

export function isMlPermalink(url: string | null | undefined): url is string {
  return !!url && ML_PERMALINK_RE.test(url)
}

/**
 * De las publicaciones vinculadas a un producto (ids guardados en el ERP),
 * elige una que la API de ML confirme activa y con permalink. Prefiere la que
 * tiene stock publicado. Devuelve null si ninguna está activa (o si ML no
 * devolvió datos): en ese caso no hay que decir que está publicada.
 */
export function pickActiveListing(
  candidateIds: string[],
  live: Map<string, MlItemLite>
): ActiveListing | null {
  const active = candidateIds
    .map((id) => live.get(id))
    .filter((it): it is MlItemLite => !!it && it.status === 'active' && isMlPermalink(it.permalink))
  if (!active.length) return null
  const best = active.find((it) => (it.available_quantity ?? 0) > 0) ?? active[0]
  return { mlItemId: best.id, title: best.title, permalink: best.permalink! }
}

export interface ApplyLinksResult {
  answer: string
  /** Problemas que requieren revisión humana (vacío = todo bien). */
  issues: string[]
  /** Permalinks que quedaron en el texto final. */
  links: string[]
}

/**
 * Reemplaza los marcadores [[LINK:MLA...]] por el permalink real y valida que
 * no quede ninguna otra URL. Respeta el máximo de caracteres: si con los links
 * no entra, se sacan los links (nunca se corta una URL por la mitad).
 */
export function applyListingLinks(
  rawAnswer: string,
  listings: ActiveListing[],
  maxChars: number
): ApplyLinksResult {
  const byId = new Map(listings.map((l) => [l.mlItemId.toUpperCase(), l]))
  const issues: string[] = []
  const links: string[] = []

  // 1. URLs escritas por el modelo: solo se toleran si son exactamente un
  //    permalink conocido; el resto se elimina.
  const allowed = new Set(listings.map((l) => l.permalink))
  let text = rawAnswer.replace(URL_RE, (url) => {
    const clean = url.replace(/[.,;:)]+$/, '')
    if (allowed.has(clean)) return url
    issues.push('La IA escribió un link que no sale de los datos; se quitó')
    return ''
  })

  // 2. Marcadores -> permalink. La puntuación pegada al marcador se saca para
  //    que no forme parte del link.
  const replaceMarkers = (withLinks: boolean) =>
    text.replace(new RegExp(PLACEHOLDER_RE.source + '[.,;:]?', 'gi'), (_m, id: string) => {
      const listing = byId.get(id.toUpperCase())
      if (!listing) {
        issues.push(`La IA citó una publicación que no está activa (${id}); se quitó el link`)
        return ''
      }
      if (!withLinks) return ''
      if (!links.includes(listing.permalink)) links.push(listing.permalink)
      return listing.permalink
    })

  const tidy = (s: string) =>
    s
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/ +([.,;])/g, '$1')
      .trim()

  let answer = tidy(replaceMarkers(true))
  if (answer.length > maxChars) {
    links.length = 0
    answer = tidy(replaceMarkers(false)).slice(0, maxChars)
    issues.push(`Con el link la respuesta supera los ${maxChars} caracteres; se quitó el link`)
  }

  return { answer, issues: [...new Set(issues)], links }
}

/** Texto sin los permalinks permitidos (para chequear contacto/links prohibidos). */
export function stripAllowedLinks(answer: string, links: string[]): string {
  let out = answer
  for (const l of links) out = out.split(l).join(' ')
  return out
}
