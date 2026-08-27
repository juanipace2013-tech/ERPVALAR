/**
 * Emite un comprobante de PRUEBA vía WSFE y lo consulta de vuelta.
 *
 * ⚠ Pensado para HOMOLOGACIÓN (ARCA_ENV=homo + certificado de homologación
 * generado en WSASS). En producción emite un comprobante REAL: el script se
 * niega salvo que se pase --prod-real a propósito.
 *
 *   ARCA_ENV=homo ARCA_CERT_PATH=... ARCA_KEY_PATH=... npx tsx scripts/arca-emitir-prueba.ts
 *   npx tsx scripts/arca-emitir-prueba.ts --letra B --moneda USD --cotiz 1495 --total 1210
 *
 *   --letra  A | B (default A)
 *   --cuit   CUIT receptor (default 30715373579 para A; B sin CUIT = consumidor final)
 *   --moneda ARS | USD (default ARS)
 *   --cotiz  cotización si USD
 *   --neto   neto gravado (default 1000) — IVA 21% y total se derivan
 *   --nc <cbteTipo>:<pv>:<nro>[:<yyyymmdd>]   emite NOTA DE CRÉDITO asociada a ese comprobante
 *          (ej. --nc 1:1:1). La fecha del asociado es obligatoria para FCE; default hoy.
 *   --fce    emite como FCE MiPyME (201/206; con --nc: 203/208)
 *   --cbu    CBU del emisor para FCE (default el de VAL ARG)
 *   --vto    días hasta el vencimiento de pago FCE (default 30)
 *   --anula  S | N — Opcional 22 para NC FCE (default S)
 */
import 'dotenv/config'
import { getArcaConfig } from '@/lib/arca/config'
import { emitirComprobante, receptorDesdeCondicion } from '@/lib/arca/emitir'
import { buildQrUrl, feCompConsultar } from '@/lib/arca/wsfe'

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : def
}

async function main() {
  const cfg = getArcaConfig()
  if (cfg.env === 'prod' && !process.argv.includes('--prod-real')) {
    console.error('ARCA_ENV=prod: esto emitiría un comprobante REAL. Usá ARCA_ENV=homo o pasá --prod-real a propósito.')
    process.exit(1)
  }
  const letra = (arg('letra', 'A') as 'A' | 'B')
  const moneda = (arg('moneda', 'ARS') as 'ARS' | 'USD')
  const cotiz = Number(arg('cotiz', '1'))
  const neto = Number(arg('neto', '1000'))
  const iva = Math.round(neto * 21) / 100
  const total = Math.round((neto + iva) * 100) / 100
  const cuit = arg('cuit', letra === 'A' ? '30715373579' : undefined)
  const nc = arg('nc')
  // FCE exige la fecha del asociado (obs 10158): tipo:pv:nro[:yyyymmdd], default hoy
  const hoy = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const asociados = nc
    ? [{ Tipo: Number(nc.split(':')[0]), PtoVta: Number(nc.split(':')[1]), Nro: Number(nc.split(':')[2]), Cuit: cfg.cuit, CbteFch: nc.split(':')[3] ?? hoy }]
    : undefined
  const { receptor } = receptorDesdeCondicion(letra === 'A' ? 'RESPONSABLE_INSCRIPTO' : 'CONSUMIDOR_FINAL', cuit)

  const esFce = process.argv.includes('--fce')
  const vtoDias = Number(arg('vto', '30'))
  const fce = esFce
    ? nc
      ? { anulacion: (arg('anula', 'S') as 'S' | 'N') }
      : { vtoPago: new Date(Date.now() + vtoDias * 86400_000), cbu: arg('cbu', '0070363320000001263286') }
    : undefined

  console.log(`ARCA ${cfg.env} PV ${cfg.puntoVenta} — ${nc ? 'NOTA DE CRÉDITO' : 'Factura'}${esFce ? ' FCE' : ''} ${letra} ${moneda} neto=${neto} iva=${iva} total=${total}${nc ? ` asociada a ${nc}` : ''}`)
  const r = await emitirComprobante({
    clase: nc ? 'NOTA_CREDITO' : 'FACTURA',
    letra,
    fce,
    asociados,
    fecha: new Date(),
    receptor,
    moneda,
    cotizacion: moneda === 'USD' ? cotiz : undefined,
    importes: { netoGravado: neto, netoNoGravado: 0, exento: 0, iva: [{ alicuota: '21', baseImponible: neto, importe: iva }], total },
  })
  console.log(JSON.stringify(r, (k, v) => (k === 'raw' ? undefined : v), 2))
  if (!r.ok) process.exit(2)

  console.log('\nQR:', buildQrUrl({
    fecha: r.fecha, cuit: cfg.cuit, ptoVta: r.puntoVenta, tipoCmp: r.cbteTipo, nroCmp: r.numero,
    importe: total, moneda: moneda === 'USD' ? 'DOL' : 'PES', ctz: moneda === 'USD' ? cotiz : 1,
    tipoDocRec: receptor.docTipo, nroDocRec: receptor.docNro, codAut: r.cae,
  }))

  console.log('\nFECompConsultar:')
  const c = await feCompConsultar(r.cbteTipo, r.numero)
  console.log(JSON.stringify(c, (k, v) => (k === 'raw' ? undefined : v), 2))
}

main().catch((e) => {
  console.error('FALLO:', e?.message || e)
  process.exit(1)
})
