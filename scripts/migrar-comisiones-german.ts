/**
 * Migra la "Planilla de Comisiones German 2026.xlsx" al módulo Comisiones.
 *
 * ⚠️ NO CORRER EN PROD: decisión 2026-07-20 — el módulo arranca en Agosto
 * 2026 y el historial (Enero–Julio) queda en la planilla Excel. Este script
 * se conserva por si algún día se decide importar el historial; por eso
 * además de --apply exige --force-historico.
 *
 * Importa:
 *   - TipoCambioMes (billete/divisa) de los meses con datos. El TC billete
 *     sale de las filas reales (columna E); el divisa del panel lateral, salvo
 *     que el panel esté desactualizado (difiere >5% del billete real), en cuyo
 *     caso se usa el billete de las filas como aproximación.
 *   - Cada hoja mensual con ventas → ComisionLiquidacion CERRADA con sus
 *     ComisionLinea (estado LIQUIDADO), ajustes y split efectivo/ML.
 *     El TC de cada línea es el de la planilla (columna E) para reproducir
 *     los ARS exactos; la tasa se recalcula con la escala corregida.
 *   - Hoja "Ventas 2026 GERMAN" → saldos pendientes de facturar como
 *     ComisionLinea estado CERRADO (forecast, solo USD).
 *
 * Validación: la suma de Comisión (ARS) reconstruida de cada mes debe
 * coincidir con la celda M21 de la hoja (tolerancia $1). Si un mes no valida,
 * el script aborta sin escribir (corre todo dentro de una transacción).
 *
 * ATENCIÓN: con --apply borra y recrea las liquidaciones 2026 de Germán y sus
 * líneas CERRADO migradas (cotizacionId null). No toca nada creado desde la UI
 * con vínculo al ERP.
 *
 * Uso:
 *   npx tsx scripts/migrar-comisiones-german.ts            (dry-run)
 *   npx tsx scripts/migrar-comisiones-german.ts --apply
 *   npx tsx scripts/migrar-comisiones-german.ts --apply --file "C:\ruta\planilla.xlsx"
 */
import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'

const prisma = new PrismaClient()

const DEFAULT_FILE =
  'C:\\Users\\santi\\VAL ARG SRL\\SP - VALARG - Documentos\\Armados Planillas\\German\\Planilla de Comisiones German 2026.xlsx'
const GERMAN_EMAIL = 'gacevedo@val-ar.com.ar'
const ANIO = 2026

// Nombre de hoja → mes (ojo: algunas tienen espacio al final en la planilla)
const HOJAS_MES: Array<{ hoja: string; mes: number }> = [
  { hoja: 'Enero', mes: 1 },
  { hoja: 'Febrero', mes: 2 },
  { hoja: 'Marzo', mes: 3 },
  { hoja: 'Abril', mes: 4 },
  { hoja: 'Mayo', mes: 5 },
  { hoja: 'Junio', mes: 6 },
  { hoja: 'Julio', mes: 7 },
  { hoja: 'Agosto ', mes: 8 },
  { hoja: 'Septiembre ', mes: 9 },
  { hoja: 'Octubre ', mes: 10 },
  { hoja: 'Noviembre', mes: 11 },
  { hoja: 'Diciembre', mes: 12 },
]

// Escala corregida (misma que seed-comisiones.ts)
function tasaParaTotal(totalUsd: number): number {
  if (totalUsd >= 100000) return 0.02
  if (totalUsd >= 75000) return 0.015
  if (totalUsd >= 50000) return 0.0125
  return 0.01
}

const r2 = (n: number) => Math.round(n * 100) / 100

interface FilaVenta {
  cliente: string
  presupuesto: string
  factura: string | null
  importeUsd: number
  tc: number
  tipo: 'BILLETE' | 'DIVISA'
}

function celda(ws: XLSX.WorkSheet, fila: number, col: string): unknown {
  const cell = ws[`${col}${fila}`]
  return cell ? cell.v : undefined
}

function parseHojaMes(ws: XLSX.WorkSheet) {
  const filas: FilaVenta[] = []
  const rango = XLSX.utils.decode_range(ws['!ref'] as string)
  for (let r = 3; r <= rango.e.r + 1; r++) {
    const cliente = celda(ws, r, 'A')
    const importe = celda(ws, r, 'D')
    if (typeof cliente !== 'string' || typeof importe !== 'number') continue
    const tipoRaw = String(celda(ws, r, 'I') ?? 'BILLETE').trim().toUpperCase()
    filas.push({
      cliente: cliente.trim(),
      presupuesto: String(celda(ws, r, 'B') ?? '').trim(),
      factura: celda(ws, r, 'C') ? String(celda(ws, r, 'C')).trim() : null,
      importeUsd: importe,
      tc: Number(celda(ws, r, 'E') ?? 0),
      tipo: tipoRaw === 'DIVISA' ? 'DIVISA' : 'BILLETE',
    })
  }

  // Panel lateral (columnas L/M)
  const panel: Record<string, number> = {}
  let comisionesPlanilla: number | null = null
  for (let r = 1; r <= rango.e.r + 1; r++) {
    const label = celda(ws, r, 'L')
    const valor = celda(ws, r, 'M')
    if (typeof label !== 'string' || typeof valor !== 'number') continue
    const key = label.trim()
    if (key === 'Comisiones') comisionesPlanilla = valor
    else panel[key] = valor
  }

  return { filas, panel, comisionesPlanilla }
}

// Etiquetas del panel que NO son ajustes manuales
const NO_AJUSTE = new Set([
  'Facturación USD',
  'Menos $50000',
  '$50000 -$75000',
  '$75000 - $100000',
  'Mas de $100000',
  'Tipo de cambio',
  'Divisa',
  'Billete',
  'Basico:',
  'Comisiones',
  'Efectivo',
  'ML',
])

async function main() {
  const apply = process.argv.includes('--apply')
  const fileIdx = process.argv.indexOf('--file')
  const file = fileIdx !== -1 ? process.argv[fileIdx + 1] : DEFAULT_FILE

  if (apply && !process.argv.includes('--force-historico')) {
    throw new Error(
      'El historial pre-Agosto 2026 queda en el Excel (no se migra). ' +
        'Si de verdad querés importarlo, agregá --force-historico.'
    )
  }

  console.log(apply ? '=== MODO APPLY ===' : '=== DRY RUN (no escribe) ===')
  console.log(`Planilla: ${file}\n`)

  const german = await prisma.user.findUnique({ where: { email: GERMAN_EMAIL } })
  if (!german) throw new Error(`No existe el usuario ${GERMAN_EMAIL}`)

  const wb = XLSX.readFile(file)

  // ── 1. Parsear y validar todos los meses ────────────────────────────────
  interface MesParseado {
    mes: number
    filas: FilaVenta[]
    totalUsd: number
    tasa: number
    comisionesArs: number
    basicoArs: number
    ajustes: Array<{ concepto: string; montoArs: number }>
    efectivoArs: number | null
    mlArs: number | null
    tcBillete: number | null
    tcDivisa: number | null
  }

  const meses: MesParseado[] = []
  const tiposCambio: Array<{ mes: number; billete: number; divisa: number }> = []

  for (const { hoja, mes } of HOJAS_MES) {
    const ws = wb.Sheets[hoja]
    if (!ws) {
      console.log(`Hoja "${hoja}" no encontrada, salteo`)
      continue
    }
    const { filas, panel, comisionesPlanilla } = parseHojaMes(ws)

    // TC del mes: billete de las filas reales; divisa de las filas si hay,
    // si no del panel (salvo panel desactualizado).
    const tcBilleteFilas = [...new Set(filas.filter((f) => f.tipo === 'BILLETE').map((f) => f.tc))]
    const tcDivisaFilas = [...new Set(filas.filter((f) => f.tipo === 'DIVISA').map((f) => f.tc))]
    const panelBillete = panel['Billete'] ?? null
    const panelDivisa = panel['Divisa'] ?? null

    let tcBillete = tcBilleteFilas.length > 0 ? Math.max(...tcBilleteFilas) : panelBillete
    let tcDivisa: number | null = null
    if (tcDivisaFilas.length > 0) {
      tcDivisa = Math.max(...tcDivisaFilas)
    } else if (panelDivisa !== null && panelBillete !== null && tcBillete !== null) {
      // panel confiable solo si su billete coincide razonablemente con las filas
      const panelConfiable = Math.abs(panelBillete - tcBillete) / tcBillete < 0.05
      tcDivisa = panelConfiable ? panelDivisa : tcBillete
    } else {
      tcDivisa = tcBillete
    }

    if (filas.length === 0) {
      // Mes sin ventas: no migramos liquidación ni TC (los TC del panel de
      // meses futuros están desactualizados).
      continue
    }

    const totalUsd = r2(filas.reduce((s, f) => s + f.importeUsd, 0))
    const tasa = tasaParaTotal(totalUsd)
    const comisionesArs = r2(filas.reduce((s, f) => s + r2(f.importeUsd * tasa * f.tc), 0))

    // Validación contra la planilla (celda "Comisiones" del panel)
    if (comisionesPlanilla !== null) {
      const diff = Math.abs(comisionesArs - comisionesPlanilla)
      const marca = diff <= 1 ? 'OK' : `DIFIERE $${diff.toFixed(2)}`
      console.log(
        `Mes ${mes}: ${filas.length} ventas · USD ${totalUsd.toFixed(2)} · tasa ${(tasa * 100).toFixed(2)}% · ` +
          `ARS calc ${comisionesArs.toFixed(2)} vs planilla ${comisionesPlanilla.toFixed(2)} → ${marca}`
      )
      if (diff > 1) {
        throw new Error(`Mes ${mes}: la comisión reconstruida difiere de la planilla ($${diff.toFixed(2)})`)
      }
    } else {
      console.log(`Mes ${mes}: sin celda "Comisiones" en el panel (no valida)`)
    }

    const basicoArs = panel['Basico:'] ?? 1_500_000

    // Ajustes: todo label del panel que no sea parte de la estructura.
    // La planilla es inconsistente con el signo (Enero: "Deuda Germán" en
    // positivo pero resta; Febrero: "Sommier Center" ya en negativo), así que
    // normalizamos: los ajustes migrados siempre restan.
    const ajustes = Object.entries(panel)
      .filter(([k]) => !NO_AJUSTE.has(k))
      .map(([concepto, monto]) => ({ concepto, montoArs: monto > 0 ? -monto : monto }))

    meses.push({
      mes,
      filas,
      totalUsd,
      tasa,
      comisionesArs,
      basicoArs,
      ajustes,
      efectivoArs: panel['Efectivo'] ?? null,
      mlArs: panel['ML'] ?? null,
      tcBillete,
      tcDivisa,
    })
    if (tcBillete !== null && tcDivisa !== null) {
      tiposCambio.push({ mes, billete: tcBillete, divisa: tcDivisa })
    }
  }

  // ── 2. Saldos pendientes (hoja Ventas 2026 GERMAN) ──────────────────────
  const wsVentas = wb.Sheets['Ventas 2026 GERMAN']
  const pendientes: Array<{
    cliente: string
    presupuesto: string
    factura: string | null
    importeUsd: number
    facturadoUsd: number
    saldoUsd: number
  }> = []
  if (wsVentas) {
    // La columna S (Saldo) está vacía en la planilla real: el saldo se
    // calcula como Importe − Σ Fac-01..Fac-12. Umbral USD 1 para ignorar
    // residuos de redondeo (hay uno de $0,02).
    const FAC_COLS = ['G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R']
    const rango = XLSX.utils.decode_range(wsVentas['!ref'] as string)
    for (let r = 2; r <= rango.e.r + 1; r++) {
      const presupuesto = celda(wsVentas, r, 'B')
      const cliente = celda(wsVentas, r, 'D')
      const importe = celda(wsVentas, r, 'E')
      if (typeof presupuesto !== 'string' || typeof cliente !== 'string') continue
      if (typeof importe !== 'number') continue
      const facturado = FAC_COLS.reduce((s, col) => {
        const v = celda(wsVentas, r, col)
        return typeof v === 'number' ? s + v : s
      }, 0)
      const saldo = r2(importe - facturado)
      if (saldo <= 1) continue
      pendientes.push({
        cliente: cliente.trim(),
        presupuesto: presupuesto.trim(),
        factura: celda(wsVentas, r, 'C') ? String(celda(wsVentas, r, 'C')).trim() : null,
        importeUsd: r2(importe),
        facturadoUsd: r2(facturado),
        saldoUsd: saldo,
      })
    }
  } else {
    console.log('Hoja "Ventas 2026 GERMAN" no encontrada: no se migran saldos pendientes')
  }
  const totalPendiente = r2(pendientes.reduce((s, p) => s + p.saldoUsd, 0))
  console.log(`\nSaldos pendientes de facturar: ${pendientes.length} ventas · USD ${totalPendiente.toFixed(2)}`)
  console.log(`Tipos de cambio a cargar: ${tiposCambio.map((t) => `${t.mes}: B ${t.billete} / D ${t.divisa}`).join(' · ')}`)

  if (!apply) {
    console.log('\nDry run: no se escribió nada. Correr con --apply para migrar.')
    return
  }

  // ── 3. Escribir todo en una transacción ─────────────────────────────────
  await prisma.$transaction(
    async (tx) => {
      // Limpiar migración previa (idempotencia)
      await tx.comisionLinea.deleteMany({
        where: {
          vendedorId: german.id,
          OR: [
            { liquidacion: { anio: ANIO } },
            { estado: 'CERRADO', cotizacionId: null },
          ],
        },
      })
      await tx.comisionAjuste.deleteMany({
        where: { liquidacion: { vendedorId: german.id, anio: ANIO } },
      })
      await tx.comisionLiquidacion.deleteMany({ where: { vendedorId: german.id, anio: ANIO } })

      for (const tc of tiposCambio) {
        await tx.tipoCambioMes.upsert({
          where: { anio_mes: { anio: ANIO, mes: tc.mes } },
          create: { anio: ANIO, mes: tc.mes, billete: tc.billete, divisa: tc.divisa },
          update: { billete: tc.billete, divisa: tc.divisa },
        })
      }

      for (const m of meses) {
        const ajustesTotal = m.ajustes.reduce((s, a) => s + a.montoArs, 0)
        const netoArs = r2(m.basicoArs + m.comisionesArs + ajustesTotal)
        await tx.comisionLiquidacion.create({
          data: {
            vendedorId: german.id,
            anio: ANIO,
            mes: m.mes,
            estado: 'CERRADA',
            totalFacturadoUsd: m.totalUsd,
            tasaMes: m.tasa,
            basicoArs: m.basicoArs,
            comisionesArs: m.comisionesArs,
            netoArs,
            efectivoArs: m.efectivoArs,
            mlArs: m.mlArs,
            notas: 'Migrada de Planilla de Comisiones German 2026.xlsx',
            cerradaEn: new Date(ANIO, m.mes, 0), // último día del mes
            ajustes: { create: m.ajustes },
            lineas: {
              create: m.filas.map((f) => ({
                vendedorId: german.id,
                clienteNombre: f.cliente,
                presupuesto: f.presupuesto,
                numeroFactura: f.factura === 'S/F' ? null : f.factura,
                importeFacturadoUsd: f.importeUsd,
                tipoOperacion: f.tipo,
                tipoCambio: f.tc,
                anioImputacion: ANIO,
                mesImputacion: m.mes,
                estado: 'LIQUIDADO' as const,
                tasaAplicada: m.tasa,
                comisionUsd: r2(f.importeUsd * m.tasa),
                comisionArs: r2(f.importeUsd * m.tasa * f.tc),
              })),
            },
          },
        })
      }

      await tx.comisionLinea.createMany({
        data: pendientes.map((p) => ({
          vendedorId: german.id,
          clienteNombre: p.cliente,
          presupuesto: p.presupuesto,
          numeroFactura: p.factura === 'S/F' ? null : p.factura,
          importeCerradoUsd: p.importeUsd,
          importeFacturadoUsd: p.facturadoUsd,
          estado: 'CERRADO' as const,
        })),
      })
    },
    { timeout: 120_000 }
  )

  console.log(`\nOK. Migrados ${meses.length} meses cerrados + ${pendientes.length} saldos pendientes.`)
}

main()
  .catch((e) => {
    console.error('ERROR:', e.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
