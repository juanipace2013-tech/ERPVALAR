/**
 * Diagnóstico de conectividad con ARCA (WSAA + WSFEv1). SOLO LECTURA.
 *
 *   npx tsx scripts/arca-check.ts            → dummy + TA + último autorizado por tipo
 *   npx tsx scripts/arca-check.ts params     → además lista tablas de parámetros
 *   npx tsx scripts/arca-check.ts consultar <cbteTipo> <nro>  → FECompConsultar
 *
 * Requiere ARCA_* en .env (ver src/lib/arca/config.ts).
 */
import 'dotenv/config'
import { getArcaConfig } from '@/lib/arca/config'
import { getTicketAcceso } from '@/lib/arca/wsaa'
import {
  CBTE_TIPO,
  feCompConsultar,
  feCompUltimoAutorizado,
  feDummy,
  feParamGet,
  feParamGetCotizacion,
} from '@/lib/arca/wsfe'

async function main() {
  const cfg = getArcaConfig()
  console.log(`ARCA env=${cfg.env} cuit=${cfg.cuit} PV=${cfg.puntoVenta}`)
  console.log(`  wsaa=${cfg.wsaaUrl}`)
  console.log(`  wsfe=${cfg.wsfeUrl}`)

  console.log('\n[1] FEDummy')
  console.log(await feDummy())

  console.log('\n[2] WSAA ticket de acceso')
  const ta = await getTicketAcceso('wsfe')
  console.log(`  token=${ta.token.slice(0, 20)}... vence ${ta.expirationTime}`)

  const mode = process.argv[2]

  if (mode === 'consultar') {
    const tipo = Number(process.argv[3])
    const nro = Number(process.argv[4])
    console.log(`\n[3] FECompConsultar tipo=${tipo} nro=${nro}`)
    console.log(await feCompConsultar(tipo, nro))
    return
  }

  console.log('\n[3] FECompUltimoAutorizado por tipo (PV del ERP)')
  const tipos: Array<[string, number]> = [
    ['Factura A', CBTE_TIPO.FACTURA_A],
    ['Nota Crédito A', CBTE_TIPO.NOTA_CREDITO_A],
    ['Nota Débito A', CBTE_TIPO.NOTA_DEBITO_A],
    ['Factura B', CBTE_TIPO.FACTURA_B],
    ['Nota Crédito B', CBTE_TIPO.NOTA_CREDITO_B],
    ['Factura E', CBTE_TIPO.FACTURA_E],
  ]
  for (const [nombre, tipo] of tipos) {
    try {
      const n = await feCompUltimoAutorizado(tipo)
      console.log(`  ${nombre.padEnd(16)} (${tipo}): ${n}`)
    } catch (e) {
      console.log(`  ${nombre.padEnd(16)} (${tipo}): ERROR ${(e as Error).message}`)
    }
  }

  console.log('\n[4] Cotización DOL')
  try {
    console.log(await feParamGetCotizacion('DOL'))
  } catch (e) {
    console.log('  ERROR', (e as Error).message)
  }

  if (mode === 'params') {
    for (const t of ['PtosVenta', 'CondicionIvaReceptor', 'TiposIva', 'TiposMonedas'] as const) {
      console.log(`\n[5] FEParamGet${t}`)
      try {
        console.log(JSON.stringify(await feParamGet(t), null, 1).slice(0, 3000))
      } catch (e) {
        console.log('  ERROR', (e as Error).message)
      }
    }
  }
}

main().catch((e) => {
  console.error('FALLO:', e)
  process.exit(1)
})
