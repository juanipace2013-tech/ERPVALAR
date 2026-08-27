/**
 * Sincroniza Customer.fceObligado contra el padrón oficial de ARCA de
 * "empresas grandes" obligadas a recibir Factura de Crédito Electrónica
 * MiPyME (RG 4367).
 *
 * Fuente: la misma API JSON que alimenta el listado público
 * https://servicioscf.afip.gob.ar/facturadecreditoelectronica/Listado-RFCE-Mi-PyMe.asp
 *
 * El padrón manda en ambos sentidos: marca los clientes cuyo CUIT figura y
 * desmarca los que ya no figuran (loguea cada cambio).
 *
 *   npx tsx scripts/fce-padron-sync.ts           # dry-run: solo muestra
 *   npx tsx scripts/fce-padron-sync.ts --apply   # aplica los cambios
 */
import 'dotenv/config'
import { prisma } from '@/lib/prisma'

const PADRON_URL =
  'https://servicioscf.afip.gob.ar/FCEServicioConsulta/api/fceconsulta.aspx/getGrandesEmpresas'

interface EmpresaGrande {
  Cuit: number
  Denominacion: string
  Fecha_Inicio: string
  Actividad_Principal: string
}

async function fetchPadron(): Promise<Map<string, EmpresaGrande>> {
  const res = await fetch(PADRON_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: '{}',
  })
  if (!res.ok) throw new Error(`Padrón FCE: HTTP ${res.status}`)
  const wrapper = (await res.json()) as { d?: string }
  if (!wrapper.d) throw new Error('Padrón FCE: respuesta sin campo d')
  const empresas = JSON.parse(wrapper.d) as EmpresaGrande[]
  if (!Array.isArray(empresas) || empresas.length < 100) {
    // Un padrón sospechosamente chico probablemente es un error del servicio:
    // mejor abortar que desmarcar clientes en masa.
    throw new Error(`Padrón FCE: solo ${empresas?.length ?? 0} empresas — se aborta por seguridad`)
  }
  const map = new Map<string, EmpresaGrande>()
  for (const e of empresas) map.set(String(e.Cuit), e)
  return map
}

async function main() {
  const apply = process.argv.includes('--apply')
  const padron = await fetchPadron()
  console.log(`Padrón ARCA: ${padron.size} empresas grandes obligadas a recibir FCE`)

  const customers = await prisma.customer.findMany({
    select: { id: true, name: true, cuit: true, fceObligado: true, status: true },
  })

  const marcar: typeof customers = []
  const desmarcar: typeof customers = []
  for (const c of customers) {
    const cuit = (c.cuit || '').replace(/\D/g, '')
    const enPadron = cuit.length === 11 && padron.has(cuit)
    if (enPadron && !c.fceObligado) marcar.push(c)
    if (!enPadron && c.fceObligado) desmarcar.push(c)
  }

  console.log(`\nClientes en el padrón a MARCAR fceObligado (${marcar.length}):`)
  for (const c of marcar) {
    const e = padron.get((c.cuit || '').replace(/\D/g, ''))!
    console.log(`  + ${c.name} (${c.cuit}) — "${e.Denominacion}", obligada desde ${e.Fecha_Inicio}`)
  }
  console.log(`\nClientes marcados que YA NO figuran, a desmarcar (${desmarcar.length}):`)
  for (const c of desmarcar) console.log(`  - ${c.name} (${c.cuit})`)

  if (!apply) {
    console.log('\nDry-run: no se cambió nada. Correr con --apply para aplicar.')
    return
  }
  if (marcar.length) {
    await prisma.customer.updateMany({
      where: { id: { in: marcar.map((c) => c.id) } },
      data: { fceObligado: true },
    })
  }
  if (desmarcar.length) {
    await prisma.customer.updateMany({
      where: { id: { in: desmarcar.map((c) => c.id) } },
      data: { fceObligado: false },
    })
  }
  console.log(`\nAplicado: ${marcar.length} marcados, ${desmarcar.length} desmarcados.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
