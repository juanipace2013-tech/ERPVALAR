/**
 * Backfill del texto de las fichas técnicas (Product.technicalSheetText).
 *
 * Recorre los productos con ficha cargada y sin extracción hecha
 * (technicalSheetTextAt null), extrae el texto del PDF con unpdf y lo guarda.
 * Las fichas se cargaron como una copia por producto (ver
 * cargar-fichas-tecnicas.ts), así que hay miles de PDFs idénticos: se cachea
 * por hash del archivo para extraer cada PDF distinto una sola vez.
 *
 * Fichas que son imagen (jpg/png) o PDFs sin capa de texto quedan con texto
 * null pero technicalSheetTextAt seteado, para no reintentar en cada pregunta.
 *
 * Uso (en el server de prod, donde están los archivos):
 *   npx tsx scripts/extraer-texto-fichas-tecnicas.ts            (dry run: cuenta y muestra 5 ejemplos)
 *   npx tsx scripts/extraer-texto-fichas-tecnicas.ts --apply
 *   npx tsx scripts/extraer-texto-fichas-tecnicas.ts --apply --force   (re-extrae todo)
 */
import 'dotenv/config'
import { createHash } from 'crypto'
import { readFile } from 'fs/promises'
import { prisma } from '@/lib/prisma'
import { extractPdfText, technicalSheetPath } from '@/lib/productos/fichaTecnicaText'

const apply = process.argv.includes('--apply')
const force = process.argv.includes('--force')
const BATCH = 200

async function main() {
  const products = await prisma.product.findMany({
    where: {
      technicalSheetUrl: { not: null },
      ...(force ? {} : { technicalSheetTextAt: null }),
    },
    select: { id: true, sku: true, technicalSheetUrl: true },
    orderBy: { sku: 'asc' },
  })
  console.log(`Productos con ficha a procesar: ${products.length}${force ? ' (--force)' : ''}`)

  if (!apply) {
    for (const p of products.slice(0, 5)) {
      const url = p.technicalSheetUrl!
      try {
        const text = url.toLowerCase().endsWith('.pdf')
          ? await extractPdfText(await readFile(technicalSheetPath(url)))
          : null
        console.log(`\n--- ${p.sku} <- ${url} (${text?.length ?? 0} chars)`)
        console.log((text ?? '(sin texto)').slice(0, 400))
      } catch (e) {
        console.log(`\n--- ${p.sku} <- ${url}: ERROR ${e}`)
      }
    }
    console.log('\nDry run: no se escribió nada. Correr con --apply para ejecutar.')
    return
  }

  const cache = new Map<string, string | null>()
  let ok = 0
  let sinTexto = 0
  let errores = 0
  let hits = 0
  const t0 = Date.now()

  for (let i = 0; i < products.length; i += BATCH) {
    const batch = products.slice(i, i + BATCH)
    for (const p of batch) {
      const url = p.technicalSheetUrl!
      let text: string | null = null
      try {
        if (url.toLowerCase().endsWith('.pdf')) {
          const data = await readFile(technicalSheetPath(url))
          const hash = createHash('sha1').update(data).digest('hex')
          if (cache.has(hash)) {
            text = cache.get(hash)!
            hits++
          } else {
            text = await extractPdfText(data)
            cache.set(hash, text)
          }
        }
      } catch (e) {
        errores++
        console.log(`  ERROR ${p.sku} (${url}): ${String(e).slice(0, 120)}`)
      }
      if (text) ok++
      else sinTexto++
      await prisma.product.update({
        where: { id: p.id },
        data: { technicalSheetText: text, technicalSheetTextAt: new Date() },
      })
    }
    console.log(
      `${Math.min(i + BATCH, products.length)}/${products.length} — con texto ${ok}, sin texto ${sinTexto}, errores ${errores}, cache hits ${hits}, PDFs distintos ${cache.size} (${Math.round((Date.now() - t0) / 1000)}s)`
    )
  }

  console.log(`\nListo: ${ok} con texto, ${sinTexto} sin texto (imagen/escaneado/error), ${errores} errores de lectura.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
