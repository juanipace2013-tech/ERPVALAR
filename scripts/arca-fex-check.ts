/**
 * Diagnóstico de WSFEX (Factura E de exportación). SOLO LECTURA: nunca llama
 * a FEXAuthorize ni a ningún método que cree comprobantes.
 *
 *   npx tsx scripts/arca-fex-check.ts              → dummy + TA + PV + últimos números + Id + cotización DOL
 *   npx tsx scripts/arca-fex-check.ts params       → además lista las tablas y las compara con fex-params.ts
 *   npx tsx scripts/arca-fex-check.ts --cmp 19:10:1  → FEXGetCMP de ese comprobante (tipo:pv:nro)
 *
 * Requiere ARCA_* en .env (ver src/lib/arca/config.ts). El PV de exportación
 * sale de ARCA_PUNTO_VENTA_EXPO (si no está, se usa 10 solo para consultar).
 */
import 'dotenv/config'
import { getArcaConfig } from '@/lib/arca/config'
import { getTicketAcceso } from '@/lib/arca/wsaa'
import {
  fexDummy,
  fexGetCmp,
  fexGetCotizacion,
  fexGetLastCmp,
  fexGetLastId,
  fexGetParam,
  type FexParamTabla,
} from '@/lib/arca/wsfex'
import {
  DST_CUIT,
  DST_PAIS,
  FEX_ACTIVIDAD_PRINCIPAL,
  FEX_CBTE,
  FEX_OPCIONAL,
  FEX_PUNTO_VENTA_PROD,
  IDIOMA,
  INCOTERMS,
  MONEDA_FEX,
  TIPO_EXPO,
  UMED_UNIDADES,
} from '@/lib/arca/fex-params'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function intentar<T>(titulo: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch (e) {
    console.log(`  ${titulo}: ERROR ${(e as Error).message}`)
    return null
  }
}

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v))

/** Compara un valor esperado (fex-params.ts) contra la tabla de ARCA. */
function verificar(nombre: string, ok: boolean, detalle: string) {
  console.log(`  ${ok ? 'OK        ' : 'DIFERENCIA'} ${nombre}: ${detalle}`)
}

async function main() {
  const cfg = getArcaConfig()
  const pv = cfg.puntoVentaExportacion ?? FEX_PUNTO_VENTA_PROD
  console.log(`ARCA env=${cfg.env} cuit=${cfg.cuit} PV expo=${cfg.puntoVentaExportacion ?? `(sin ARCA_PUNTO_VENTA_EXPO, consulto ${pv})`}`)
  console.log(`  wsaa=${cfg.wsaaUrl}`)
  console.log(`  wsfex=${cfg.wsfexUrl}`)

  console.log('\n[1] FEXDummy')
  console.log(await fexDummy())

  console.log('\n[2] WSAA ticket de acceso (wsfex)')
  const ta = await getTicketAcceso('wsfex')
  console.log(`  token=${ta.token.slice(0, 20)}... vence ${ta.expirationTime}`)

  const cmpArg = arg('cmp')
  if (cmpArg) {
    const [tipo, pvCmp, nro] = cmpArg.split(':').map(Number)
    console.log(`\n[3] FEXGetCMP tipo=${tipo} pv=${pvCmp} nro=${nro}`)
    const c = await fexGetCmp(tipo, pvCmp, nro)
    if (!c) console.log('  No existe')
    else {
      const { raw, ...resto } = c
      console.log(JSON.stringify(resto, null, 1))
      console.log('  raw:', JSON.stringify(raw).slice(0, 3000))
    }
    return
  }

  console.log('\n[3] FEXGetPARAM_PtoVenta')
  const pvs = await intentar('PtoVenta', () => fexGetParam('PtoVenta'))
  for (const p of pvs ?? []) {
    console.log(`  PV ${s(p.Pve_Nro)} bloqueado=${s(p.Pve_Bloqueado)} baja=${s(p.Pve_FchBaja) || '-'}`)
  }

  console.log(`\n[4] FEXGetLast_CMP en PV ${pv}`)
  for (const [nombre, tipo] of [
    ['Factura E', FEX_CBTE.FACTURA_E],
    ['Nota Débito E', FEX_CBTE.NOTA_DEBITO_E],
    ['Nota Crédito E', FEX_CBTE.NOTA_CREDITO_E],
  ] as const) {
    const n = await intentar(nombre, () => fexGetLastCmp(tipo, pv))
    if (n !== null) console.log(`  ${nombre.padEnd(15)} (${tipo}): ${n}`)
  }

  console.log('\n[5] FEXGetLast_ID')
  const lastId = await intentar('Last_ID', () => fexGetLastId())
  if (lastId !== null) console.log(`  ${lastId}`)

  console.log('\n[6] Cotización DOL (FEXGetPARAM_Ctz, desde hoy hacia atrás)')
  const ctz = await intentar('Ctz', () => fexGetCotizacion(MONEDA_FEX.DOLAR))
  if (ctz) {
    console.log(`  ${ctz.cotizacion} (consultada ${ctz.fechaConsultada}, fecha ARCA ${ctz.fechaCotizacion}, ${ctz.diasAtras} día(s) atrás)`)
  }

  if (process.argv[2] !== 'params') return

  const tabla = async (t: FexParamTabla) => (await intentar(t, () => fexGetParam(t))) ?? []
  const listar = (filas: Record<string, unknown>[], max = 40) => {
    for (const f of filas.slice(0, max)) console.log('   ', JSON.stringify(f))
    if (filas.length > max) console.log(`    ... (${filas.length - max} más)`)
  }

  console.log('\n[7] Cbte_Tipo')
  const cbtes = await tabla('Cbte_Tipo')
  listar(cbtes)
  for (const t of Object.values(FEX_CBTE)) {
    const f = cbtes.find((c) => Number(c.Cbte_Id) === t)
    verificar(`Cbte_Tipo ${t}`, !!f, s(f?.Cbte_Ds) || 'no figura')
  }

  console.log('\n[8] Tipo_Expo')
  const tex = await tabla('Tipo_Expo')
  listar(tex)
  for (const t of Object.values(TIPO_EXPO)) {
    const f = tex.find((c) => Number(c.Tex_Id) === t)
    verificar(`Tipo_expo ${t}`, !!f, s(f?.Tex_Ds) || 'no figura')
  }

  console.log('\n[9] Incoterms')
  const inc = await tabla('Incoterms')
  listar(inc)
  const incArca = inc.map((c) => s(c.Inc_Id))
  for (const i of INCOTERMS) verificar(`Incoterm ${i}`, incArca.includes(i), incArca.includes(i) ? 'vigente' : 'no figura')

  console.log('\n[10] Idiomas')
  const idi = await tabla('Idiomas')
  listar(idi)
  for (const t of Object.values(IDIOMA)) {
    const f = idi.find((c) => Number(c.Idi_Id) === t)
    verificar(`Idioma ${t}`, !!f, s(f?.Idi_Ds) || 'no figura')
  }

  console.log('\n[11] UMed')
  const umed = await tabla('UMed')
  listar(umed, 20)
  const u7 = umed.find((c) => Number(c.Umed_Id) === UMED_UNIDADES)
  verificar(`UMed ${UMED_UNIDADES}`, !!u7, s(u7?.Umed_Ds) || 'no figura')

  console.log('\n[12] MON')
  const mon = await tabla('MON')
  const dol = mon.find((c) => s(c.Mon_Id) === MONEDA_FEX.DOLAR)
  verificar(`Moneda ${MONEDA_FEX.DOLAR}`, !!dol, s(dol?.Mon_Ds) || 'no figura')

  console.log('\n[13] DST_pais (solo los mapeados en fex-params.ts)')
  const paises = await tabla('DST_pais')
  for (const [iso, codigo] of Object.entries(DST_PAIS)) {
    const f = paises.find((c) => Number(c.DST_Codigo) === codigo)
    verificar(`DST_pais ${iso}=${codigo}`, !!f, s(f?.DST_Ds) || 'no figura')
  }

  console.log('\n[14] DST_CUIT (solo los mapeados en fex-params.ts)')
  const cuits = await tabla('DST_CUIT')
  for (const [iso, porTipo] of Object.entries(DST_CUIT)) {
    for (const [tipo, cuit] of Object.entries(porTipo)) {
      const f = cuits.find((c) => s(c.DST_CUIT) === cuit)
      verificar(`DST_CUIT ${iso} ${tipo}=${cuit}`, !!f, s(f?.DST_Ds) || 'no figura')
    }
  }

  console.log('\n[15] Opcionales')
  const opc = await tabla('Opcionales')
  listar(opc)
  for (const id of Object.values(FEX_OPCIONAL)) {
    const f = opc.find((c) => s(c.Opc_Id) === id)
    verificar(`Opcional ${id}`, !!f, s(f?.Opc_Ds) || 'no figura')
  }

  console.log('\n[16] Actividades')
  const act = await tabla('Actividades')
  listar(act)
  const a = act.find((c) => Number(c.Id) === FEX_ACTIVIDAD_PRINCIPAL)
  verificar(`Actividad ${FEX_ACTIVIDAD_PRINCIPAL}`, !!a, s(a?.Desc) || 'no figura')
}

main().catch((e) => {
  console.error('FALLO:', e)
  process.exit(1)
})
