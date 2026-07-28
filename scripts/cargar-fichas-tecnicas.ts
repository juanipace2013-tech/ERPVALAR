/**
 * Carga masiva de fichas técnicas de productos desde una carpeta de PDFs.
 *
 * Los archivos deben llamarse "<código> - <descripción>.pdf" (o "<código>.pdf").
 * El código es la familia del producto: "2401 - Válvula....pdf" se asigna a
 * TODOS los productos cuyo SKU sea "2401" o empiece con "2401 " (los diámetros:
 * "2401 09", "2401 10", etc.), porque comparten la misma ficha.
 *
 * Cada producto recibe su PROPIA copia del archivo en
 * public/uploads/fichas-tecnicas/ (mismo layout que sube la UI), para que
 * reemplazar/borrar la ficha de un producto no rompa la de sus hermanos.
 *
 * Si hay varios PDFs para el mismo código (ej. ficha + manual IOM), se elige
 * uno con esta preferencia: sin "manual" en el nombre > con " - " en el
 * nombre > el más grande. Los descartados se listan para revisión.
 *
 * Idempotente: los productos que ya tienen ficha se saltean (usar --overwrite
 * para reemplazarla; el archivo anterior se elimina del disco).
 *
 * Uso (correr en el VPS, donde vive la DB de prod y el public/uploads):
 *   npx tsx scripts/cargar-fichas-tecnicas.ts <carpeta-pdfs> --brand GENEBRE            (dry run)
 *   npx tsx scripts/cargar-fichas-tecnicas.ts <carpeta-pdfs> --brand GENEBRE --apply
 *
 * --brand filtra por Product.brand (recomendado: códigos numéricos de marcas
 * distintas pueden pisarse). Sin --brand matchea contra todo el catálogo.
 *
 * MODO MAPA (--map <archivo.json>): para marcas cuyo nombre de archivo no trae
 * el código al inicio (ej. Winters: "PFQ_PFQ-LF_sp.pdf" es la ficha de la serie
 * PFQ). El JSON es un objeto { "SERIE": "archivo.pdf" } relativo a la carpeta.
 * El matching es por prefijo normalizado (mayúsculas, sin espacios/guiones):
 * la serie "PFQ" matchea "PFQ106R6R11". Si un SKU matchea varias series gana
 * la más larga ("LE3-DISPLAY" le gana a "LE3"). Una serie terminada en "ZR"
 * (ej. "PFQ-ZR") matchea los SKU de su base que contengan "ZR" en el resto del
 * part number ("PFQ106ZRR6R11"), y le gana a la base.
 *   npx tsx scripts/cargar-fichas-tecnicas.ts <carpeta> --brand WINTERS --map fichas.json
 */
import { PrismaClient } from '@prisma/client'
import { copyFile, mkdir, readdir, readFile, stat, unlink } from 'fs/promises'
import path from 'path'

const prisma = new PrismaClient()

const MAX_SIZE = 3 * 1024 * 1024 // 3MB — límite de adjuntos del email
const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'fichas-tecnicas')
// Código al inicio del nombre: "2401", "2458G", "0130E", "2459A"...
const CODE_REGEX = /^(\d{3,5}[A-Z]?)(?=[\s.\-_]|$)/i

interface Candidate {
  code: string
  filePath: string
  fileName: string
  size: number
}

function pickBest(files: Candidate[]): { chosen: Candidate; discarded: Candidate[] } {
  const score = (f: Candidate) =>
    (f.fileName.toLowerCase().includes('manual') ? 0 : 100) +
    (f.fileName.includes(' - ') ? 10 : 0) +
    f.size / MAX_SIZE // desempate por tamaño (siempre < 1 punto)
  const sorted = [...files].sort((a, b) => score(b) - score(a))
  return { chosen: sorted[0], discarded: sorted.slice(1) }
}

async function collectPdfs(dir: string): Promise<Candidate[]> {
  const out: Candidate[] = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await collectPdfs(full)))
      continue
    }
    if (path.extname(entry.name).toLowerCase() !== '.pdf') continue
    const match = entry.name.match(CODE_REGEX)
    if (!match) continue
    const info = await stat(full)
    if (info.size > MAX_SIZE) {
      console.log(`  [SKIP >3MB] ${entry.name} (${(info.size / 1024 / 1024).toFixed(1)}MB)`)
      continue
    }
    out.push({
      code: match[1].toUpperCase(),
      filePath: full,
      fileName: entry.name,
      size: info.size,
    })
  }
  return out
}

interface ProductRow {
  id: string
  sku: string
  technicalSheetUrl: string | null
}

// Grupo listo para asignar: una familia/serie con su PDF elegido y sus productos
interface Group {
  code: string
  chosen: Candidate
  products: ProductRow[]
}

// Normaliza para comparar SKU contra serie: "PFQ-ZR" -> "PFQZR", "3WPS - " -> "3WPS"
const norm = (s: string) => s.toUpperCase().replace(/[\s\-_./]/g, '')

/** Modo clásico: el código sale del nombre del archivo y matchea SKU exacto o "código + espacio". */
async function buildGroupsFromFilenames(sourceDir: string, brand: string | null, ambiguos: string[], sinProductos: string[]): Promise<Group[]> {
  console.log('Escaneando PDFs...')
  const pdfs = await collectPdfs(sourceDir)

  const byCode = new Map<string, Candidate[]>()
  for (const p of pdfs) {
    const list = byCode.get(p.code) || []
    list.push(p)
    byCode.set(p.code, list)
  }
  console.log(`${pdfs.length} PDFs con código, ${byCode.size} códigos distintos.\n`)

  const groups: Group[] = []
  for (const [code, files] of Array.from(byCode.entries()).sort()) {
    const { chosen, discarded } = pickBest(files)
    if (discarded.length > 0) {
      ambiguos.push(`${code}: se usa "${chosen.fileName}", descartados: ${discarded.map((d) => `"${d.fileName}"`).join(', ')}`)
    }

    const products = await prisma.product.findMany({
      where: {
        OR: [{ sku: code }, { sku: { startsWith: `${code} ` } }],
        ...(brand ? { brand: { equals: brand, mode: 'insensitive' } } : {}),
      },
      select: { id: true, sku: true, technicalSheetUrl: true },
      orderBy: { sku: 'asc' },
    })

    if (products.length === 0) {
      sinProductos.push(`${code} ("${chosen.fileName}")`)
      continue
    }
    groups.push({ code, chosen, products })
  }
  return groups
}

/** Modo mapa: series explícitas { "SERIE": "archivo.pdf" }, matching por prefijo normalizado, gana la serie más larga. */
async function buildGroupsFromMap(sourceDir: string, mapFile: string, brand: string | null, sinProductos: string[]): Promise<Group[]> {
  const mapping: Record<string, string> = JSON.parse(await readFile(mapFile, 'utf8'))

  interface Entry {
    code: string
    codeNorm: string
    baseNorm: string // sin el sufijo ZR (igual a codeNorm si no lo tiene)
    requiresZR: boolean
    candidate: Candidate
  }
  const entries: Entry[] = []
  for (const [code, fileName] of Object.entries(mapping)) {
    const filePath = path.join(sourceDir, fileName)
    const info = await stat(filePath) // si el archivo del mapa no existe, corta acá
    if (info.size > MAX_SIZE) {
      console.log(`  [SKIP >3MB] ${code}: ${fileName} (${(info.size / 1024 / 1024).toFixed(1)}MB)`)
      continue
    }
    const codeNorm = norm(code)
    const requiresZR = codeNorm.length > 2 && codeNorm.endsWith('ZR')
    entries.push({
      code,
      codeNorm,
      baseNorm: requiresZR ? codeNorm.slice(0, -2) : codeNorm,
      requiresZR,
      candidate: { code, filePath, fileName, size: info.size },
    })
  }
  console.log(`Mapa: ${entries.length} series con PDF.\n`)

  const products = await prisma.product.findMany({
    where: brand ? { brand: { equals: brand, mode: 'insensitive' } } : {},
    select: { id: true, sku: true, technicalSheetUrl: true },
    orderBy: { sku: 'asc' },
  })

  const byEntry = new Map<Entry, ProductRow[]>()
  for (const product of products) {
    const skuNorm = norm(product.sku)
    const matches = entries.filter((e) =>
      e.requiresZR
        ? skuNorm.startsWith(e.baseNorm) && skuNorm.slice(e.baseNorm.length).includes('ZR')
        : skuNorm.startsWith(e.codeNorm)
    )
    if (matches.length === 0) continue
    // Gana la serie más específica: la de código más largo; a igual largo, la ZR
    const best = matches.sort((a, b) => b.codeNorm.length - a.codeNorm.length || Number(b.requiresZR) - Number(a.requiresZR))[0]
    const list = byEntry.get(best) || []
    list.push(product)
    byEntry.set(best, list)
  }

  const groups: Group[] = []
  for (const entry of entries) {
    const matched = byEntry.get(entry) || []
    if (matched.length === 0) {
      sinProductos.push(`${entry.code} ("${entry.candidate.fileName}")`)
      continue
    }
    groups.push({ code: entry.code, chosen: entry.candidate, products: matched })
  }
  return groups.sort((a, b) => a.code.localeCompare(b.code))
}

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const overwrite = args.includes('--overwrite')
  const brandIdx = args.indexOf('--brand')
  const brand = brandIdx !== -1 ? args[brandIdx + 1] : null
  const mapIdx = args.indexOf('--map')
  const mapFile = mapIdx !== -1 ? args[mapIdx + 1] : null
  const sourceDir = args.find((a, i) => !a.startsWith('--') && i !== brandIdx + 1 && i !== mapIdx + 1)

  if (!sourceDir) {
    throw new Error('Falta la carpeta de PDFs. Uso: npx tsx scripts/cargar-fichas-tecnicas.ts <carpeta> [--brand MARCA] [--map mapa.json] [--apply] [--overwrite]')
  }

  console.log(apply ? '=== MODO APPLY (escribe en DB y disco) ===' : '=== DRY RUN (no escribe) ===')
  console.log(`Carpeta: ${sourceDir}`)
  console.log(`Marca: ${brand || '(todas)'}`)
  console.log(`Matching: ${mapFile ? `mapa explícito (${mapFile})` : 'código en el nombre del archivo'}\n`)

  let asignados = 0
  let salteados = 0
  const sinProductos: string[] = []
  const ambiguos: string[] = []

  const groups = mapFile
    ? await buildGroupsFromMap(sourceDir, mapFile, brand, sinProductos)
    : await buildGroupsFromFilenames(sourceDir, brand, ambiguos, sinProductos)

  for (const { code, chosen, products } of groups) {
    console.log(`\n--- ${code} (${products.length} productos) <- ${chosen.fileName} (${Math.round(chosen.size / 1024)}KB)`)
    for (const product of products) {
      if (product.technicalSheetUrl && !overwrite) {
        console.log(`  [YA TIENE] ${product.sku}`)
        salteados++
        continue
      }

      console.log(`  ${product.sku}`)
      asignados++

      if (!apply) continue

      await mkdir(UPLOAD_DIR, { recursive: true })
      const safeSku = product.sku.replace(/[^a-zA-Z0-9-_]/g, '-')
      const destName = `${safeSku}_ficha_${Date.now()}.pdf`
      await copyFile(chosen.filePath, path.join(UPLOAD_DIR, destName))

      if (product.technicalSheetUrl) {
        try {
          await unlink(path.join(process.cwd(), 'public', product.technicalSheetUrl))
        } catch {
          // Archivo anterior ya no existe: continuar
        }
      }

      await prisma.product.update({
        where: { id: product.id },
        data: {
          technicalSheetUrl: `/uploads/fichas-tecnicas/${destName}`,
          technicalSheetName: chosen.fileName,
        },
      })
    }
  }

  console.log(`\n${apply ? 'Asignadas' : 'Se asignarían'}: ${asignados} fichas. Salteados (ya tenían): ${salteados}.`)

  if (ambiguos.length > 0) {
    console.log(`\nCódigos con más de un PDF (revisar elección):`)
    ambiguos.forEach((a) => console.log(`  - ${a}`))
  }

  if (sinProductos.length > 0) {
    console.log(`\nPDFs sin producto que matchee${brand ? ` (marca ${brand})` : ''}: ${sinProductos.length}`)
    sinProductos.forEach((s) => console.log(`  - ${s}`))
  }

  if (!apply) {
    console.log('\nDry run: no se escribió nada. Correr con --apply para ejecutar.')
  }
}

main()
  .catch((e) => {
    console.error('ERROR:', e.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
