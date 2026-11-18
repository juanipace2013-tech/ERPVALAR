/**
 * Carga/actualiza el mapeo JmhLink (código JMH -> product.template de
 * tienda.jmh.com.ar) recorriendo el listado público de la tienda
 * (/shop?ppg=200, ~6 páginas). El código sale del nombre de la imagen de cada
 * producto ("[MN90114RF0010D] 90Ø114 ..."); los artículos sin referencia
 * interna no se pueden vincular. Vincula productId por SKU = código.
 * Idempotente (upsert por código).
 *
 *   npx tsx scripts/cargar-jmh-links.ts            (dry run)
 *   npx tsx scripts/cargar-jmh-links.ts --apply
 */
import 'dotenv/config'
import { prisma } from '@/lib/prisma'
import { JMH_BASE, parseJmhShopListing } from '@/lib/jmh/client'

const apply = process.argv.includes('--apply')
const PPG = 200
const MAX_PAGES = 30

async function crawl() {
  const byCode = new Map<string, { templateId: number; nombre: string | null }>()
  let sinCodigo = 0
  let ultima = 1
  for (let page = 1; page <= Math.min(ultima, MAX_PAGES); page++) {
    const url = `${JMH_BASE}/shop${page > 1 ? `/page/${page}` : ''}?ppg=${PPG}`
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ERP-ValArg/1.0)' } })
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`)
    const html = await res.text()
    // el paginador dice cuántas páginas hay (una página puede traer menos de PPG)
    for (const m of html.matchAll(/\/shop\/page\/(\d+)/g)) ultima = Math.max(ultima, Number(m[1]))
    const enPagina = new Set(html.match(/data-product-template-id="\d+"/g) ?? []).size
    const items = parseJmhShopListing(html)
    for (const it of items) byCode.set(it.codigo, { templateId: it.templateId, nombre: it.nombre })
    sinCodigo += Math.max(0, enPagina - items.length)
    console.log(`página ${page}/${ultima}: ${enPagina} productos, ${items.length} con código`)
    await new Promise((r) => setTimeout(r, 1000))
  }
  console.log(`sin referencia interna (no vinculables): ${sinCodigo}`)
  return byCode
}

async function main() {
  const byCode = await crawl()
  const products = await prisma.product.findMany({
    where: { sku: { in: [...byCode.keys()] } },
    select: { id: true, sku: true, brand: true },
  })
  const prodBySku = new Map(products.map((p) => [p.sku, p.id]))
  const marcas = new Map<string, number>()
  for (const p of products) marcas.set(p.brand ?? '(sin marca)', (marcas.get(p.brand ?? '(sin marca)') ?? 0) + 1)
  console.log(`códigos en la tienda: ${byCode.size}; con producto en el ERP: ${products.length}`)
  console.log('por marca:', Object.fromEntries(marcas))
  if (!apply) { console.log('Dry run.'); return }

  let n = 0
  for (const [codigo, v] of byCode) {
    const data = { templateId: v.templateId, nombre: v.nombre, productId: prodBySku.get(codigo) ?? null }
    await prisma.jmhLink.upsert({ where: { codigo }, create: { codigo, ...data }, update: data })
    if (++n % 200 === 0) console.log(`${n}/${byCode.size}`)
  }
  console.log(`Listo: ${n} links.`)
}
main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
