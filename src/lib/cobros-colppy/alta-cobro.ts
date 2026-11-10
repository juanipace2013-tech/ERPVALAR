/**
 * Arma los `parameters` de Cliente/alta_cobro de Colppy igual que la pantalla
 * "Agregar cobro" de Clientes. Formato capturado del front de Colppy el
 * 10/11/2026 (recibo real 0001-00012987, idCobro 12183687); ver
 * docs/DISENO-COBROS-COLPPY.md.
 *
 * - `cobros`: TODAS las impagas que lista Colppy
 *   (FacturaVenta/leer_facturas_a_cobrar); las que no se cobran van con
 *   pagar:false y esteCobro:0.
 * - `mediospagos`: medios de cobro, con medio y cuenta POR NOMBRE
 *   (idMedioCobro "Transferencia", idPlanCuenta "Cta Cte Galicia").
 * - A diferencia de alta_pago, las dos grillas van como ARREGLOS.
 * Alcance: FAV/NDV en pesos o en dólares, transferencias a cuentas en pesos,
 * sin retenciones, anticipos ni cobros a cuenta.
 *
 * Facturas en dólares (leído del front de Colppy, colppyall_min.js, grilla
 * facturasacobrargrid y cobroform; SIN captura de un guardado real todavía):
 * - `esteCobro`/`saldoAnterior` van en pesos al T/C de la FACTURA (`rate`).
 * - `tcCobroRate` es el T/C al que se cobra; el front agrega `totalme`
 *   ("USD-<total en dólares>").
 * - diferenciaTipoCambio = Σ esteCobro / rate × tcCobroRate − Σ esteCobro.
 * - totalACobrar = totalEsteCobro + diferenciaTipoCambio = Σ medios.
 * Función pura (testeable): no agrega sesión ni idEmpresa.
 */

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000

/** Una fila de FacturaVenta/leer_facturas_a_cobrar (data[]) */
export interface ImpagaCobroColppy {
  idFactura: string
  nroFactura: string
  tipoComprobante: string
  /** Vencimiento, DD-MM-YYYY */
  fechaPago: string
  moneda?: string | null
  /** "USD" en facturas en moneda extranjera; null en pesos */
  currency?: string | null
  rate?: string | number | null
  totalme?: string | number | null
  totalFactura: string | number
  cobrado?: string | number
  saldoAnterior: string | number
  Saldo?: string | number
  descripcion?: string
  is_fce?: string | number
}

export interface MedioCobro {
  /** Como lo nombra la grilla de cobros de Colppy */
  medio: 'Transferencia'
  /** Nombre de la cuenta en Colppy (Tesoreria/leer_origen_fondos2 → Nombre) */
  cuenta: string
  importe: number
}

export interface PedidoAltaCobro {
  idCliente: string
  /** Usuario de Colppy de la sesión (el front lo manda en idUsuario) */
  idUsuario: string
  /** YYYY-MM-DD */
  fecha: string
  nroRecibo1: string
  nroRecibo2: string
  impagas: ImpagaCobroColppy[]
  /** idFactura → importe que se cobra en este recibo */
  cobros: Record<string, number>
  /** idFactura → T/C al que se cobra (solo facturas en dólares; si falta, el de la factura) */
  tcCobro?: Record<string, number>
  medios: MedioCobro[]
  descripcion?: string
}

export interface AltaCobroArmado {
  parameters: Record<string, unknown>
  /** Σ esteCobro: pesos al T/C de cada factura (lo que baja el saldo en Colppy) */
  totalAplicado: number
  /** Σ (cobrado al T/C del cobro − al T/C de la factura) de las facturas en dólares */
  diferenciaCambio: number
  totalCobrado: number
}

export class AltaCobroError extends Error {
  constructor(public errores: string[]) {
    super(errores.join(' · '))
    this.name = 'AltaCobroError'
  }
}

/** Saldo pendiente de una impaga, en pesos */
export function saldoImpagaCobro(f: ImpagaCobroColppy): number {
  return r2(Number(f.Saldo ?? f.saldoAnterior))
}

/** Moneda de la impaga: pesos, dólares, u otra (no soportada) */
export function monedaImpaga(f: ImpagaCobroColppy): 'ARS' | 'USD' | 'OTRA' {
  const c = String(f.currency ?? '')
    .trim()
    .toUpperCase()
  if (c === 'USD') return 'USD'
  if (c !== '' && c !== 'ARS') return 'OTRA'
  // Sin moneda pero con total en moneda extranjera: dato inconsistente, no se toca
  const totalMe = Number(f.totalme)
  return f.moneda || (Number.isFinite(totalMe) && totalMe !== 0) ? 'OTRA' : 'ARS'
}

/** T/C de la factura (solo en dólares); 0 si no viene */
export function tcFacturaImpaga(f: ImpagaCobroColppy): number {
  const n = Number(f.rate)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Se cobra si es factura o nota de débito, en pesos o en dólares, con saldo */
export function esCobrableFase1(f: ImpagaCobroColppy): { ok: true } | { ok: false; motivo: string } {
  const tipo = String(f.tipoComprobante)
  if (tipo !== 'FAV' && tipo !== 'NDV') return { ok: false, motivo: `${tipo || 'Comprobante'} (por ahora solo facturas y notas de débito)` }
  const moneda = monedaImpaga(f)
  if (moneda === 'OTRA') return { ok: false, motivo: 'Moneda no soportada: por ahora se cobra en Colppy' }
  if (moneda === 'USD' && !tcFacturaImpaga(f)) return { ok: false, motivo: 'Factura en dólares sin tipo de cambio: se cobra en Colppy' }
  if (Number(f.is_fce) === 1) return { ok: false, motivo: 'Factura de crédito electrónica: por ahora se cobra en Colppy' }
  if (!(saldoImpagaCobro(f) > 0)) return { ok: false, motivo: 'Sin saldo' }
  return { ok: true }
}

function ddmmyyyy(fechaIso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaIso)
  if (!m) throw new AltaCobroError([`Fecha inválida: ${fechaIso}`])
  return `${m[3]}-${m[2]}-${m[1]}`
}

export function armarAltaCobro(p: PedidoAltaCobro): AltaCobroArmado {
  const errores: string[] = []
  if (!/^\d+$/.test(p.idCliente)) errores.push('Cliente sin id de Colppy')
  if (!p.idUsuario) errores.push('Falta el usuario de Colppy')
  if (!/^\d{4}$/.test(p.nroRecibo1) || !/^\d{8}$/.test(p.nroRecibo2)) errores.push(`Número de recibo inválido: ${p.nroRecibo1}-${p.nroRecibo2}`)
  const fecha = ddmmyyyy(p.fecha)

  const porId = new Map(p.impagas.map((f) => [String(f.idFactura), f]))
  for (const id of Object.keys(p.cobros)) {
    if (!porId.has(id)) errores.push(`El comprobante ${id} ya no figura impago en Colppy`)
  }

  let difSinRedondear = 0
  const cobros = p.impagas.map((f) => {
    const importe = r2(Number(p.cobros[String(f.idFactura)] ?? 0))
    const saldo = saldoImpagaCobro(f)
    const pagar = importe > 0
    const enDolares = monedaImpaga(f) === 'USD'
    const tcFactura = tcFacturaImpaga(f)
    // T/C del cobro: el pedido, o el de la factura (sin diferencia de cambio)
    let tcCobro: number | '' = ''
    if (enDolares && tcFactura) {
      const crudo = p.tcCobro?.[String(f.idFactura)]
      const pedido = Number(crudo)
      const valido = Number.isFinite(pedido) && pedido > 0
      tcCobro = pagar && valido ? r4(pedido) : r4(tcFactura)
      if (pagar) {
        if (crudo !== undefined && !valido) errores.push(`${f.nroFactura}: tipo de cambio del cobro inválido`)
        // Un T/C muy lejos del de la factura casi seguro es un error de tipeo
        else if (tcCobro < tcFactura * 0.5 || tcCobro > tcFactura * 2) errores.push(`${f.nroFactura}: el tipo de cambio del cobro (${tcCobro}) está muy lejos del de la factura (${tcFactura})`)
        else difSinRedondear += (importe / tcFactura) * tcCobro - importe
      }
    }
    if (pagar) {
      const c = esCobrableFase1(f)
      if (!c.ok) errores.push(`${f.nroFactura}: ${c.motivo}`)
      if (importe > saldo + 0.005) errores.push(`${f.nroFactura}: se cobra ${importe} y el saldo es ${saldo}`)
    }
    if (importe < 0) errores.push(`${f.nroFactura}: importe negativo`)
    return {
      idFactura: String(f.idFactura),
      nroFactura: f.nroFactura,
      tipoComprobante: f.tipoComprobante,
      fechaPago: f.fechaPago,
      moneda: f.moneda ?? '',
      descripcion: f.descripcion ?? '',
      currency: f.currency ?? null,
      tcCobroRate: tcCobro,
      rate: f.rate ?? null,
      totalFactura: r2(Number(f.totalFactura)),
      cobrado: Number(f.cobrado) || 0,
      saldoAnterior: saldo,
      esteCobro: pagar ? importe : 0,
      esteCobroMe: '',
      Saldo: pagar ? r2(saldo - importe) : saldo,
      // El front de Colppy agrega esto a las filas en moneda extranjera
      ...(enDolares && tcFactura ? { totalme: `${f.currency}-${Number(f.totalFactura) / Number(tcFactura.toFixed(2))}` } : {}),
      pagar,
    }
  })
  const diferenciaCambio = r2(difSinRedondear)

  const totalAplicado = r2(cobros.reduce((a, c) => a + c.esteCobro, 0))
  if (!(totalAplicado > 0)) errores.push('No hay comprobantes para cobrar')

  if (!p.medios.length) errores.push('Falta el medio de cobro')
  for (const m of p.medios) {
    if (m.medio !== 'Transferencia') errores.push(`Medio de cobro no soportado todavía: ${m.medio}`)
    if (!m.cuenta?.trim()) errores.push('Falta la cuenta del medio de cobro')
    if (!(r2(m.importe) > 0)) errores.push(`Importe inválido en ${m.cuenta || 'un medio de cobro'}`)
  }
  const totalCobrado = r2(p.medios.reduce((a, m) => a + r2(m.importe), 0))
  // Sin retenciones ni cobros a cuenta: lo cobrado es lo aplicado más la diferencia de cambio
  const totalACobrar = r2(totalAplicado + diferenciaCambio)
  if (Math.abs(totalCobrado - totalACobrar) > 0.005) {
    errores.push(`Los medios de cobro suman ${totalCobrado} y el total a cobrar es ${totalACobrar}`)
  }

  if (errores.length) throw new AltaCobroError(errores)

  const saldoFacturas = r2(cobros.reduce((a, c) => a + c.Saldo, 0))
  const parameters: Record<string, unknown> = {
    cobros,
    mediospagos: p.medios.map((m) => ({
      idMedioCobro: m.medio,
      idPlanCuenta: m.cuenta.trim(),
      Banco: '',
      nroCheque: '',
      fechaValidez: '',
      importe: r2(m.importe),
      VAD: 'S',
      Conciliado: '',
      idTabla: 0,
      idElemento: 0,
      idItem: 0,
    })),
    estesoreria: '0',
    idUsuario: p.idUsuario,
    idCobro: '',
    idCliente: p.idCliente,
    nroRecibo1: p.nroRecibo1,
    nroRecibo2: p.nroRecibo2,
    fechaCobro: fecha,
    idEstadoCobro: 'Aprobado',
    descripcion: (p.descripcion ?? '').slice(0, 200),
    valorCambio: '0',
    totalEsteCobro: totalAplicado,
    saldoFacturas,
    anticipo: 0,
    descuentos: 0,
    intereses: 0,
    retencionIIBB: 0,
    totalACobrar,
    idMedioCobro: p.medios[0].medio,
    totalCobrado,
    retencionOtras: 0,
    retsufridas: [],
    retsufridasotras: [],
    diferenciaTipoCambio: diferenciaCambio,
  }
  return { parameters, totalAplicado, diferenciaCambio, totalCobrado }
}
