/**
 * Archiva en SharePoint los PDF de los comprobantes emitidos por el ERP (ARCA)
 * desde una fecha. Sirve para el backfill inicial y para reintentar si alguno
 * falló. No pisa archivos existentes (los guardados a mano quedan como están).
 *
 *   npx tsx scripts/sharepoint-archivar-facturas.ts                  → dry-run desde el 1° del mes
 *   npx tsx scripts/sharepoint-archivar-facturas.ts --desde 2026-10-01 --apply
 *
 * Requiere SHAREPOINT_FACTURAS_SITE_ID (ver src/lib/sharepoint/facturas-emitidas.ts).
 */
import 'dotenv/config'
import { prisma } from '@/lib/prisma'
import { archivarFacturaEnSharePoint, carpetaMes } from '@/lib/sharepoint/facturas-emitidas'

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const i = args.indexOf('--desde')
  const hoy = new Date()
  const desde = i >= 0 ? new Date(`${args[i + 1]}T00:00:00-03:00`) : new Date(hoy.getFullYear(), hoy.getMonth(), 1)

  const facturas = await prisma.invoice.findMany({
    where: { emitidaPor: 'ARCA', issueDate: { gte: desde } },
    orderBy: { issueDate: 'asc' },
    select: { id: true, invoiceNumber: true, issueDate: true, customer: { select: { name: true } } },
  })
  console.log(`${facturas.length} comprobantes ARCA desde ${desde.toISOString().slice(0, 10)}${apply ? '' : ' (dry-run, usar --apply)'}`)

  for (const f of facturas) {
    if (!apply) {
      console.log(`  ${f.invoiceNumber}  ${f.customer.name}  → carpeta "${carpetaMes(f.issueDate)}"`)
      continue
    }
    const r = await archivarFacturaEnSharePoint(f.id)
    console.log(`  ${f.invoiceNumber}  ${r.ok ? (r.yaExistia ? 'ya estaba' : 'SUBIDA') + ` → ${r.path}` : `ERROR ${r.error}`}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
