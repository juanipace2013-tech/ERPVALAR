/**
 * Prueba de Factura E (WSFEX) en HOMOLOGACIÓN de ARCA, sin base de datos: el
 * diario de idempotencia va en memoria y el receptor, los ítems y el DES son
 * datos de prueba. Los comprobantes de homologación no tienen validez fiscal.
 *
 *   ARCA_HOMO_DIR=/home/deploy/afip/homo ARCA_HOMO_CUIT=20340026463 \
 *     npx tsx scripts/arca-fex-prueba.ts [--caso exporta-simple|fca|despachante|todos] [--pv 10] [--emitir]
 *
 * Sin --emitir solo consulta (cotización, último número, request armado).
 * Con --emitir llama a FEXAuthorize en HOMOLOGACIÓN y confirma con FEXGetCMP.
 *
 * Se niega a correr si el ambiente no queda en homologación: fuerza
 * ARCA_ENV=homo con el certificado de prueba (ARCA_HOMO_DIR) y aborta si
 * ARCA_ENV ya venía en prod o si la URL de WSFEX no es la de homologación.
 */
import fs from 'fs'
import path from 'path'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

// --- Ambiente: SIEMPRE homologación, ANTES de cargar cualquier módulo de ARCA ---
if ((process.env.ARCA_ENV ?? '').toLowerCase() === 'prod') {
  console.error('ARCA_ENV=prod: esta prueba solo corre en homologación. Abortado.')
  process.exit(1)
}
const dir = process.env.ARCA_HOMO_DIR
const cuitHomo = process.env.ARCA_HOMO_CUIT
if (!dir || !cuitHomo) {
  console.error('Faltan ARCA_HOMO_DIR (carpeta con el .crt/.key de homologación) y ARCA_HOMO_CUIT. Abortado.')
  process.exit(1)
}
const archivos = fs.readdirSync(dir)
const crt = archivos.find((f) => f.endsWith('.crt'))
const key = archivos.find((f) => f.endsWith('.key'))
if (!crt || !key) {
  console.error(`No hay .crt y .key en ${dir}. Abortado.`)
  process.exit(1)
}
process.env.ARCA_ENV = 'homo'
process.env.ARCA_CUIT = cuitHomo
process.env.ARCA_CERT_PATH = path.join(dir, crt)
process.env.ARCA_KEY_PATH = path.join(dir, key)
process.env.ARCA_PUNTO_VENTA = process.env.ARCA_PUNTO_VENTA || '1'
process.env.ARCA_PUNTO_VENTA_EXPO = arg('pv') ?? '10'

type Caso = 'exporta-simple' | 'fca' | 'despachante'
const CASOS: Caso[] = ['exporta-simple', 'fca', 'despachante']

async function main() {
  const { getArcaConfig } = await import('@/lib/arca/config')
  const cfg = getArcaConfig()
  if (cfg.env !== 'homo' || !/wswhomo/.test(cfg.wsfexUrl)) {
    throw new Error(`El ambiente no quedó en homologación (env ${cfg.env}, ${cfg.wsfexUrl}). Abortado.`)
  }
  const wsfex = await import('@/lib/arca/wsfex')
  const ex = await import('@/lib/arca/emitir-exportacion')
  const { MONEDA_FEX, FEX_CBTE, receptorExportacion } = await import('@/lib/arca/fex-params')

  const emitir = process.argv.includes('--emitir')
  const pedido = arg('caso') ?? 'exporta-simple'
  const casos: Caso[] = pedido === 'todos' ? CASOS : CASOS.includes(pedido as Caso) ? [pedido as Caso] : []
  if (!casos.length) throw new Error(`Caso desconocido: ${pedido} (exporta-simple, fca, despachante o todos)`)
  const pv = cfg.puntoVentaExportacion!

  console.log(`HOMOLOGACIÓN · CUIT ${cfg.cuit} · PV ${pv} · ${emitir ? 'EMITE (homo)' : 'solo consulta'}`)
  console.log('FEXDummy:', JSON.stringify(await wsfex.fexDummy()))
  const ctz = await wsfex.fexGetCotizacion(MONEDA_FEX.DOLAR)
  console.log(`Cotización DOL: ${ctz.cotizacion} (del ${ctz.fechaCotizacion}, consultada ${ctz.fechaConsultada}, ${ctz.diasAtras} días atrás)`)

  // Receptor de prueba con la forma real (Chile, persona jurídica)
  const rec = receptorExportacion({
    name: 'CLIENTE DE PRUEBA SPA',
    businessName: 'CLIENTE DE PRUEBA SPA',
    type: 'BUSINESS',
    taxCondition: 'CLIENTE_EXTERIOR',
    country: 'Chile',
    address: 'Av. de Prueba 1234',
    city: 'Santiago',
    taxIdExterior: '76.000.000-0',
  })
  if (!rec.receptor) throw new Error(`Receptor de prueba incompleto: ${rec.faltantes.join(', ')}`)

  // Diario en memoria (la prueba no toca ninguna base de datos)
  const filas = new Map<number, { estado: string; cbteNumero: number }>()
  const persistencia: import('@/lib/arca/emitir-exportacion').PersistenciaExportacion = {
    async buscarBloqueante() {
      for (const [fexId, f] of filas) if (f.estado === 'PENDIENTE' || f.estado === 'INCIERTA') return { fexId, ...f }
      return null
    },
    async maxFexId() {
      return filas.size ? Math.max(...filas.keys()) : 0
    },
    async reservar(r) {
      filas.set(r.fexId, { estado: 'PENDIENTE', cbteNumero: r.cbteNumero })
    },
    async marcarAutorizada(fexId) {
      filas.get(fexId)!.estado = 'AUTORIZADA'
    },
    async marcarRechazada(fexId) {
      filas.get(fexId)!.estado = 'RECHAZADA'
    },
    async marcarIncierta(fexId) {
      filas.get(fexId)!.estado = 'INCIERTA'
    },
  }

  const mercaderia = [
    { codigo: '2228 12', descripcion: 'Válvula de equilibrado estático (PRUEBA)', cantidad: 3, precioUnitario: 692.96 },
  ]
  const flete = { descripcion: 'Flete internacional (PRUEBA)', cantidad: 1, precioUnitario: 524.67, manual: true }

  for (const caso of casos) {
    const input: import('@/lib/arca/emitir-exportacion').ExportacionInput = {
      clase: 'FACTURA',
      regimen: caso === 'despachante' ? 'DESPACHANTE' : 'EXPORTA_SIMPLE',
      tipoExpo: 1,
      puntoVenta: pv,
      receptor: rec.receptor,
      moneda: 'USD',
      cotizacion: ctz.cotizacion,
      cancelaEnMonedaExtranjera: true,
      items: caso === 'exporta-simple' ? [...mercaderia, flete] : mercaderia,
      formaPago: 'Transferencia bancaria',
      incoterm: caso === 'exporta-simple' ? 'CPT' : 'FCA',
      incotermLugar: caso === 'exporta-simple' ? 'Santiago' : 'Buenos Aires',
      idioma: 1,
      obsComerciales: `PRUEBA homologación (${caso})`,
      ...(caso === 'despachante'
        ? { permisoExistente: 'N' as const }
        : { exportaSimple: { desNumero: '2133ECSI12', fobUSD: 2078.88 } }),
    }

    console.log(`\n=== Caso ${caso} ===`)
    const vista = await ex.vistaPreviaExportacion(input, persistencia)
    console.log(`N° ${vista.numeroInterno} · Id ${vista.fexId} · total USD ${vista.totales.totalUSD} (mercadería ${vista.totales.mercaderiaUSD}, manual ${vista.totales.manualUSD})`)
    console.log(vista.cmpXml.replace(/></g, '>\n<'))
    if (!emitir) continue

    const r = await ex.emitirExportacion(input, persistencia)
    if (r.ok) {
      console.log(`AUTORIZADA ${r.numeroInterno} CAE ${r.cae} vto ${r.caeVencimiento.toISOString().slice(0, 10)}${r.reproceso ? ' (reproceso)' : ''}`)
      if (r.observaciones.length) console.log('  Observaciones/eventos:', wsfex.formatFexErrores(r.observaciones))
      const c = await wsfex.fexGetCmp(FEX_CBTE.FACTURA_E, pv, r.numero)
      console.log(`  FEXGetCMP: ${c ? `Id ${c.Id} total ${c.Imp_total} CAE ${c.Cae} · coincide con lo enviado: ${ex.coincideConEnviado(c, r.cmp)}` : 'NO lo encuentra'}`)
    } else {
      console.log(`${r.estado}: ${r.mensaje}`)
      if (r.errores.length) console.log('  Errores:', wsfex.formatFexErrores(r.errores))
      // Un INCIERTO bloquea los casos siguientes de esta corrida (como en el ERP)
    }
  }
}

main().catch((e) => {
  console.error('ERROR', (e as Error).message)
  process.exitCode = 1
})
