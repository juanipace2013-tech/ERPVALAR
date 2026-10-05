/**
 * Prueba de la factura directa ("Nueva factura") en HOMOLOGACIÓN de ARCA
 * (WSFE), SIN base de datos: arma los totales con las mismas funciones puras
 * que la factura directa (calcularFacturaDirecta + datosEmisionFacturaDirecta
 * de src/lib/facturacion/factura-directa-form.ts) y pide el CAE con el MISMO
 * hook (crearHookEmisionArca(...).hook(datos)). Los receptores son de prueba.
 * Los comprobantes de homologación no tienen validez fiscal.
 *
 *   ARCA_HOMO_DIR=/home/deploy/afip/homo ARCA_HOMO_CUIT=20340026463 \
 *     npx tsx scripts/factura-directa-prueba.ts [--caso <caso>|todos] [--pv 1] [--emitir]
 *
 *   Casos: a-ri (A a un RI, CUIT 33693450239), a-mono (A a condición 6),
 *          a-usd (A en dólares con la cotización de ARCA), fce-a (FCE A: solo
 *          si hay ARCA_CBU; si no, se saltea), b-cf-dni (B a consumidor final
 *          con DNI), b-cf (B a consumidor final sin documento), b-exento.
 *   --cuit <cuit>       receptor de los casos A y del exento (default 33693450239)
 *   --cuit-mono <cuit>  receptor del caso a-mono (default el de --cuit)
 *   --tc <n>            cotización del caso a-usd si ARCA no la informa
 *
 * Sin --emitir solo muestra lo que se mandaría (totales, receptor previsto).
 * Con --emitir pide el CAE en HOMOLOGACIÓN e imprime CAE o rechazo por caso,
 * y lo confirma con FECompConsultar.
 *
 * Se niega a correr si el ambiente no queda en homologación: fuerza
 * ARCA_ENV=homo con el certificado de prueba (ARCA_HOMO_DIR / ARCA_HOMO_CUIT)
 * ANTES de cargar cualquier módulo de ARCA y aborta si ARCA_ENV venía en prod
 * o si la URL de WSFE no es la de homologación. No carga dotenv: Prisma puede
 * cargar el .env al importarse, pero no pisa lo forzado acá ni se conecta.
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
const cuitHomo = (process.env.ARCA_HOMO_CUIT ?? '').replace(/\D/g, '')
if (!dir || cuitHomo.length !== 11) {
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
process.env.ARCA_TA_DIR = dir
process.env.ARCA_PUNTO_VENTA = arg('pv') ?? '1'

type Caso = 'a-ri' | 'a-mono' | 'a-usd' | 'fce-a' | 'b-cf-dni' | 'b-cf' | 'b-exento'
const CASOS: Caso[] = ['a-ri', 'a-mono', 'a-usd', 'fce-a', 'b-cf-dni', 'b-cf', 'b-exento']

interface DefinicionCaso {
  titulo: string
  cliente: { name: string; cuit: string; taxCondition: string; fceObligado?: boolean }
  moneda: 'ARS' | 'USD'
  tipoCambio?: number | null
  condicionPago: string
  preciosConIva: boolean
  documentoReceptorB?: { docTipo: 96 | 86; docNro: string } | null
  lineas: Array<{ descripcion: string; cantidad: number; precioUnitario: number }>
}

async function main() {
  const { getArcaConfig } = await import('@/lib/arca/config')
  const cfg = getArcaConfig()
  if (cfg.env !== 'homo' || !/wswhomo/.test(cfg.wsfeUrl) || !/wsaahomo/.test(cfg.wsaaUrl)) {
    throw new Error(`El ambiente no quedó en homologación (env ${cfg.env}, ${cfg.wsfeUrl}). Abortado.`)
  }
  const { crearHookEmisionArca } = await import('@/lib/facturacion/emision-arca')
  const { EmisionExternaError } = await import('@/lib/colppy')
  const form = await import('@/lib/facturacion/factura-directa-form')
  const wsfe = await import('@/lib/arca/wsfe')
  const { describeCbteTipo, receptorDesdeCondicion } = await import('@/lib/arca/emitir')

  const emitir = process.argv.includes('--emitir')
  const pedido = arg('caso') ?? 'todos'
  const casos: Caso[] = pedido === 'todos' ? CASOS : CASOS.includes(pedido as Caso) ? [pedido as Caso] : []
  if (!casos.length) throw new Error(`Caso desconocido: ${pedido} (${CASOS.join(', ')} o todos)`)
  const cuitRi = (arg('cuit') ?? '33693450239').replace(/\D/g, '')
  const cuitMono = (arg('cuit-mono') ?? cuitRi).replace(/\D/g, '')

  console.log(`HOMOLOGACIÓN · CUIT ${cfg.cuit} · PV ${cfg.puntoVenta} · ${emitir ? 'EMITE (homo)' : 'solo muestra, sin llamar a ARCA (agregar --emitir para pedir el CAE)'}`)
  if (emitir) console.log('FEDummy:', JSON.stringify(await wsfe.feDummy()))

  // Cotización oficial de ARCA para el caso en dólares (con CanMisMonExt N ARCA controla que no se aleje)
  let tcUsd = Number(arg('tc') ?? (emitir ? NaN : 1400))
  if (emitir && casos.includes('a-usd')) {
    try {
      const ctz = await wsfe.feParamGetCotizacion('DOL')
      tcUsd = Math.round(ctz.MonCotiz * 100) / 100
      console.log(`Cotización DOL de ARCA: ${ctz.MonCotiz} (${ctz.FchCotiz}) → se usa ${tcUsd}`)
    } catch (e) {
      console.log(`No se pudo leer la cotización de ARCA (${(e as Error).message}); se usa --tc ${tcUsd}`)
    }
  }

  const lineasNetas = [
    { descripcion: 'Válvula esférica 1" (PRUEBA)', cantidad: 2, precioUnitario: 12345.67 },
    { descripcion: 'Manómetro 0-10 bar (PRUEBA)', cantidad: 1, precioUnitario: 8900.5 },
  ]
  const definiciones: Record<Caso, DefinicionCaso> = {
    'a-ri': {
      titulo: 'Factura A a Responsable Inscripto',
      cliente: { name: 'CLIENTE RI DE PRUEBA', cuit: cuitRi, taxCondition: 'RESPONSABLE_INSCRIPTO' },
      moneda: 'ARS',
      condicionPago: 'a 30 Dias',
      preciosConIva: false,
      lineas: lineasNetas,
    },
    'a-mono': {
      titulo: 'Factura A a Monotributista (condición 6), precios con IVA',
      cliente: { name: 'CLIENTE MONOTRIBUTO DE PRUEBA', cuit: cuitMono, taxCondition: 'MONOTRIBUTO' },
      moneda: 'ARS',
      condicionPago: 'Contado',
      preciosConIva: true,
      lineas: [{ descripcion: 'Válvula esférica 1/2" (PRUEBA)', cantidad: 3, precioUnitario: 100 }],
    },
    'a-usd': {
      titulo: 'Factura A en dólares',
      cliente: { name: 'CLIENTE RI DE PRUEBA', cuit: cuitRi, taxCondition: 'RESPONSABLE_INSCRIPTO' },
      moneda: 'USD',
      tipoCambio: tcUsd,
      condicionPago: 'a 15 Dias',
      preciosConIva: false,
      lineas: [{ descripcion: 'Válvula de control 2" (PRUEBA)', cantidad: 1, precioUnitario: 1250.4 }],
    },
    'fce-a': {
      titulo: 'FCE MiPyME A (cliente obligado, umbral bajado para la prueba)',
      cliente: { name: 'CLIENTE GRANDE DE PRUEBA', cuit: cuitRi, taxCondition: 'RESPONSABLE_INSCRIPTO', fceObligado: true },
      moneda: 'ARS',
      condicionPago: 'a 30 Dias',
      preciosConIva: false,
      lineas: lineasNetas,
    },
    'b-cf-dni': {
      titulo: 'Factura B a consumidor final con DNI (96)',
      cliente: { name: 'CONSUMIDOR DE PRUEBA', cuit: '', taxCondition: 'CONSUMIDOR_FINAL' },
      moneda: 'ARS',
      condicionPago: 'Contado',
      preciosConIva: true,
      documentoReceptorB: { docTipo: 96, docNro: '41234567' },
      lineas: [{ descripcion: 'Válvula esférica 3/4" (PRUEBA)', cantidad: 1, precioUnitario: 100 }],
    },
    'b-cf': {
      titulo: 'Factura B a consumidor final sin documento (99)',
      cliente: { name: 'CONSUMIDOR FINAL', cuit: '', taxCondition: 'CONSUMIDOR_FINAL' },
      moneda: 'ARS',
      condicionPago: 'Contado',
      preciosConIva: true,
      lineas: [{ descripcion: 'Junta (PRUEBA)', cantidad: 3, precioUnitario: 10.05 }],
    },
    'b-exento': {
      titulo: 'Factura B a Exento (condición 4)',
      cliente: { name: 'ENTIDAD EXENTA DE PRUEBA', cuit: cuitRi, taxCondition: 'EXENTO' },
      moneda: 'ARS',
      condicionPago: 'a 30 Dias',
      preciosConIva: true,
      lineas: [{ descripcion: 'Válvula de seguridad (PRUEBA)', cantidad: 1, precioUnitario: 1563.13 }],
    },
  }

  for (const caso of casos) {
    const d = definiciones[caso]
    console.log(`\n=== ${caso}: ${d.titulo} ===`)
    const umbralOriginal = process.env.ARCA_FCE_MONTO_MINIMO
    try {
      if (caso === 'fce-a') {
        if (!getArcaConfig().cbu) {
          console.log('SALTEADO: no hay ARCA_CBU (22 dígitos) en el ambiente: sin CBU no se puede emitir una FCE')
          continue
        }
        // Umbral bajo SOLO para este caso: así una factura chica sale como FCE
        process.env.ARCA_FCE_MONTO_MINIMO = '1000'
      }
      const c = getArcaConfig()
      const calculo = form.calcularFacturaDirecta({
        taxCondition: d.cliente.taxCondition,
        cuit: d.cliente.cuit,
        fceObligado: !!d.cliente.fceObligado,
        lineas: d.lineas,
        moneda: d.moneda,
        tipoCambio: d.tipoCambio ?? null,
        preciosConIva: d.preciosConIva,
        fceMontoMinimo: c.fceMontoMinimo,
        documentoReceptorB: d.documentoReceptorB ?? null,
        cbuConfigurado: !!c.cbu,
      })
      const r = receptorDesdeCondicion(d.cliente.taxCondition, d.cliente.cuit)
      const receptor = d.documentoReceptorB && r.letra === 'B' ? { ...r.receptor, ...d.documentoReceptorB } : r.receptor
      console.log(
        `${calculo.esFce ? 'FCE A' : `Factura ${calculo.letra}`} (${calculo.cbteTipoPrevisto}) · receptor cond. ${receptor.condicionIvaId} doc ${receptor.docTipo} ${receptor.docNro} · ` +
          `${d.moneda}${d.moneda === 'USD' ? ` TC ${d.tipoCambio}` : ''} neto ${calculo.totales.neto} IVA ${calculo.totales.iva} total ${calculo.totales.total} (ARS ${calculo.totales.totalArs})`
      )
      if (calculo.errores.length) {
        console.log(`NO SE EMITE: ${calculo.errores.map((e) => `[${e.codigo}] ${e.mensaje}`).join(' · ')}`)
        continue
      }
      const datos = form.datosEmisionFacturaDirecta(calculo, {
        moneda: d.moneda,
        tipoCambio: d.tipoCambio ?? null,
        condicionPago: d.condicionPago,
        fecha: form.fechaComprobanteDirecta(new Date()),
        descripcion: `PRUEBA homologación factura directa (${caso})`,
      })
      if (!emitir) continue

      const hook = crearHookEmisionArca({
        name: d.cliente.name,
        cuit: d.cliente.cuit,
        taxCondition: d.cliente.taxCondition,
        fceObligado: !!d.cliente.fceObligado,
        ...(d.documentoReceptorB ? { documentoReceptorB: d.documentoReceptorB } : {}),
      })
      try {
        const em = await hook.hook(datos)
        const obs = hook.getEmision()?.observaciones ?? []
        console.log(
          `AUTORIZADA ${describeCbteTipo(em.cbteTipo)} ${em.numeroFormateado} CAE ${em.cae} vto ${em.caeVencimiento.toISOString().slice(0, 10)}` +
            `${hook.getFceVtoPago() ? ` · vto pago FCE ${hook.getFceVtoPago()!.toISOString().slice(0, 10)}` : ''}` +
            `${obs.length ? ` · obs: ${obs.map((o) => `[${o.Code}] ${o.Msg}`).join(' · ')}` : ''}`
        )
        const vuelta = await wsfe.feCompConsultar(em.cbteTipo, em.numero, em.puntoVenta)
        console.log(
          `  FECompConsultar: ${vuelta ? `total ${vuelta.ImpTotal} ${vuelta.MonId} ${vuelta.MonCotiz} doc ${vuelta.DocTipo} ${vuelta.DocNro} fecha ${vuelta.CbteFch} · coincide: ${Math.abs(vuelta.ImpTotal - calculo.totales.total) < 0.01}` : 'NO lo encuentra'}`
        )
      } catch (e) {
        const intento = hook.getIntentoEmision()
        const detalles = e instanceof EmisionExternaError && Array.isArray(e.detalles) ? (e.detalles as Array<{ Code: number; Msg: string }>) : []
        console.log(
          `${intento?.estado === 'rechazada' ? 'RECHAZADA' : `ERROR (${intento?.estado ?? 'antes de llamar a ARCA'})`}: ${(e as Error).message}` +
            `${detalles.length ? ` · ${detalles.map((x) => `[${x.Code}] ${x.Msg}`).join(' · ')}` : ''}`
        )
        // Un resultado incierto en homologación igual se informa y se sigue con el próximo caso
      }
    } finally {
      if (umbralOriginal === undefined) delete process.env.ARCA_FCE_MONTO_MINIMO
      else process.env.ARCA_FCE_MONTO_MINIMO = umbralOriginal
    }
  }
}

main().catch((e) => {
  console.error('ERROR', (e as Error).message)
  process.exitCode = 1
})
