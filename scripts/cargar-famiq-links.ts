/**
 * Carga/actualiza el mapeo FamiqLink (código FAMIQ -> webId de famiq.com.ar)
 * a partir de un JSON generado crawleando el sitemap del sitio:
 *   { "<webId>": { "codigo": "322741", "nombre": "...", "ficha": "https://...pdf" }, ... }
 *
 * El webId permite consultar stock en vivo y precio de lista por la API
 * pública (GET /producto/{webId}/data). Vincula productId por SKU = código.
 * Idempotente (upsert por código). Si un código aparece dos veces gana el
 * último webId (el sitio a veces duplica publicaciones).
 *
 *   npx tsx scripts/cargar-famiq-links.ts <archivo.json>            (dry run)
 *   npx tsx scripts/cargar-famiq-links.ts <archivo.json> --apply
 */
import 'dotenv/config'
import { readFileSync } from 'fs'
import { prisma } from '@/lib/prisma'

const apply = process.argv.includes('--apply')
const file = process.argv.slice(2).find((a) => !a.startsWith('--'))
if (!file) throw new Error('Falta el JSON del crawl')

async function main() {
  const raw = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, { codigo?: string; nombre?: string; ficha?: string | null; err?: string }>
  const byCode = new Map<string, { webId: number; nombre: string | null; ficha: string | null }>()
  for (const [webId, v] of Object.entries(raw)) {
    if (!v.codigo) continue
    byCode.set(v.codigo, { webId: Number(webId), nombre: v.nombre ?? null, ficha: v.ficha ?? null })
  }
  const products = await prisma.product.findMany({ where: { sku: { in: [...byCode.keys()] } }, select: { id: true, sku: true } })
  const prodBySku = new Map(products.map((p) => [p.sku, p.id]))
  console.log(`códigos en el crawl: ${byCode.size}; con producto en el ERP: ${products.length}`)
  if (!apply) { console.log('Dry run.'); return }

  let n = 0
  for (const [codigo, v] of byCode) {
    await prisma.famiqLink.upsert({
      where: { codigo },
      create: { codigo, webId: v.webId, nombre: v.nombre, fichaUrl: v.ficha, productId: prodBySku.get(codigo) ?? null },
      update: { webId: v.webId, nombre: v.nombre, fichaUrl: v.ficha, productId: prodBySku.get(codigo) ?? null },
    })
    if (++n % 200 === 0) console.log(`${n}/${byCode.size}`)
  }
  console.log(`Listo: ${n} links.`)
}
main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
