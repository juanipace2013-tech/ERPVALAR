/**
 * Electroválvulas de vapor GENEBRE 4427 / 4428 (Lista 16 Rev. 01, vigencia 01/04/2025,
 * "CGE_ARG_2024-08-01_ELECTROVALVULAS_L12 VAPOR.pdf").
 *
 * Pasan a cotizarse como el resto: el artículo es la válvula SIN bobina y la
 * bobina 4816 + conector 4801 08 se agregan en la cotización (ver
 * src/lib/genebre-electrovalvulas.ts).
 *  - "4427 04 220V" → "4427 04" con el precio de lista sin bobina.
 *  - Alta de las bobinas 4816 que faltan y de los kits de repuesto.
 *
 * Uso (en el VPS): npx tsx scripts/electrovalvulas-vapor-lista16.ts            (simulación)
 *                  npx tsx scripts/electrovalvulas-vapor-lista16.ts --apply    (aplica)
 */
import { PrismaClient, Prisma } from '@prisma/client'

const prisma = new PrismaClient()
const APLICAR = process.argv.includes('--apply')

const VALVULAS: Record<string, number> = {
  '4427 04': 157.56, '4427 05': 171.68, '4427 06': 196.4, '4427 07': 318.56, '4427 08': 434.76, '4427 09': 621.24,
  '4428 04': 237.68, '4428 05': 295.88, '4428 06': 380.56, '4428 07': 436.64, '4428 08': 520.24, '4428 09': 744.64,
}
const BOBINA_INCLUIDA = 'Bobina de 16W 220V, clase F, IP65.'
const SIN_BOBINA = 'Sin bobina: usa bobina de 16W Art. 4816 (se cotiza aparte).'
// Los costos cargados eran lista x 0,70 (válvula + bobina): se mantiene la relación.
const COSTO_SOBRE_LISTA = 0.7

const NUEVOS: Array<[string, string, number]> = [
  ['4816 110', '4816 110 - BOBINA 16 W. CLASE H (180ºC)    110V.A.C.', 25.88],
  ['4816 220', '4816 220 - BOBINA 16 W. CLASE H (180ºC)    220V.A.C.', 25.88],
  ['4816 24', '4816 24 - BOBINA 16 W. CLASE H (180ºC)    24V.A.C.', 25.88],
  ['4816 C24', '4816 C24 - BOBINA 16 W. CLASE H (180ºC)    24V.D.C.', 25.88],
  ...(['04', '05', '06', '07', '08', '09'] as const).flatMap((m, i): Array<[string, string, number]> => [
    [`KP4427 ${m}`, `KP4427 ${m} - KIT PISTON EV VAPOR 4427 ${m}`, [37, 54.6, 90.88, 106.28, 146.04, 214.72][i]],
    [`KP4428 ${m}`, `KP4428 ${m} - KIT PISTON EV VAPOR 4428 ${m}`, [40.72, 62.04, 99.96, 116.8, 160.68, 232.32][i]],
  ]),
  ['KT4427', 'KT4427 - KIT TUBO GUIA+NUCLEO PARA 4427', 34.8],
  ['KT4428', 'KT4428 - KIT TUBO GUIA+NUCLEO PARA 4428', 42.2],
  ['KD4428', 'KD4428 - CONJUNTO DISIPADOR TEMP. P/4428', 92.52],
]

const r2 = (n: number) => Math.round(n * 100) / 100

async function main() {
  console.log(APLICAR ? '== APLICANDO ==' : '== SIMULACIÓN (agregar --apply para aplicar) ==')
  const ref = await prisma.product.findUnique({ where: { sku: '4816 220' } })
  if (!ref) throw new Error('No existe 4816 220: no hay de dónde tomar proveedor y marca')

  for (const [sku, lista] of Object.entries(VALVULAS)) {
    const conBobina = await prisma.product.findUnique({ where: { sku: `${sku} 220V` } })
    const sinSufijo = await prisma.product.findUnique({ where: { sku } })
    if (conBobina && sinSufijo) throw new Error(`Existen "${sku}" y "${sku} 220V": resolver a mano`)
    const p = conBobina ?? sinSufijo
    if (!p) { console.log(`FALTA  ${sku}: no existe en el catálogo, no se crea (sin descripción ni ficha)`); continue }

    const costoUsd = r2(lista * COSTO_SOBRE_LISTA)
    const factor = p.lastCostUsd && Number(p.lastCostUsd) > 0 ? costoUsd / Number(p.lastCostUsd) : null
    const data: Prisma.ProductUpdateInput = {
      sku,
      name: p.name.replace(BOBINA_INCLUIDA, SIN_BOBINA),
      description: p.description?.replace(BOBINA_INCLUIDA, SIN_BOBINA),
      listPriceUSD: lista,
      lastCostUsd: p.lastCostUsd ? costoUsd : null,
      lastCost: p.lastCost && factor ? r2(Number(p.lastCost) * factor) : p.lastCost,
      averageCost: p.averageCost && factor ? r2(Number(p.averageCost) * factor) : p.averageCost,
      // El artículo de Colppy con bobina ("... 220V") ya no corresponde a este SKU.
      ...(conBobina ? { colppyItemId: null, colppyCode: null } : {}),
    }
    console.log(`${p.sku.padEnd(14)} → ${sku}  lista ${p.listPriceUSD} → ${lista}  costo USD ${p.lastCostUsd ?? '-'} → ${data.lastCostUsd ?? '-'}  stock ${p.stockQuantity}${p.name.includes(BOBINA_INCLUIDA) ? '' : '  (nombre sin el texto de bobina: queda igual)'}`)
    if (APLICAR) await prisma.product.update({ where: { id: p.id }, data })
  }

  for (const [sku, name, lista] of NUEVOS) {
    const p = await prisma.product.findUnique({ where: { sku } })
    if (p) {
      console.log(`${sku.padEnd(14)} existe  lista ${p.listPriceUSD} → ${lista}`)
      if (APLICAR) await prisma.product.update({ where: { id: p.id }, data: { listPriceUSD: lista } })
    } else {
      console.log(`${sku.padEnd(14)} ALTA    lista ${lista}  "${name}"`)
      if (APLICAR) {
        await prisma.product.create({
          data: { sku, name, description: name, brand: ref.brand, supplierId: ref.supplierId, listPriceUSD: lista, unit: 'UN' },
        })
      }
    }
  }
}

main()
  .catch((e) => { console.error('ERROR:', e.message); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
