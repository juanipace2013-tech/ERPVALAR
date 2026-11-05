/**
 * Arma los `parameters` de Pago/alta_pago de Colppy igual que la pantalla
 * "Agregar pago" de Proveedores. Formato capturado del front de Colppy el
 * 5/11/2026 (OP real 0001-00005506 a BMS, idPago 9594743); ver
 * docs/DISENO-PAGOS-PROVEEDORES-COLPPY.md.
 *
 * - `recordsToInsertUpdate`: TODAS las impagas que lista Colppy
 *   (Proveedor/facturas_impagas_proveedor); las que no se pagan van con
 *   pagar:false y estePago:0.
 * - `recordsToInsertUpdate1`: medios de pago, con medio y cuenta POR NOMBRE
 *   (idMedioPago "Transferencia", idPlanCuenta "Cta Cte Galicia").
 * - totalFacturas = Σ estePago; totalpagado = totalFacturas − retención = Σ medios.
 * Fase 1: solo facturas (FAC) en pesos y transferencias desde bancos en pesos.
 * Función pura (testeable): no agrega sesión ni idEmpresa.
 */

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** Una fila de Proveedor/facturas_impagas_proveedor (resultados[]) */
export interface ImpagaColppy {
  idFactura: string
  nroFactura: string
  tipoComprobante: string
  /** Vencimiento, DD-MM-YYYY */
  fechaPago: string
  RG: string | null
  moneda: string | null
  currency: unknown
  totalme: unknown
  rate: unknown
  totalFactura: string | number
  pagado: string | number
  saldoAnterior: string | number
  Saldo: string | number
  percepcionIVA?: string | number
  descripcion?: string
}

export interface MedioPago {
  /** "Transferencia" (bancos) o "Tarjeta de Crédito" (tarjetas), como los nombra la grilla de pagos de Colppy */
  medio: 'Transferencia' | 'Tarjeta de Crédito'
  /** Nombre del banco en Colppy (Tesoreria/leer_origen_fondos2 → Nombre) */
  cuenta: string
  importe: number
}

export interface PedidoAltaPago {
  idProveedor: string
  /** YYYY-MM-DD */
  fecha: string
  nroPago1: string
  nroPago2: string
  impagas: ImpagaColppy[]
  /** idFactura → importe que se le paga en esta OP */
  pagos: Record<string, number>
  retencion: { regimen: string; baseAcumulada: number; importe: number } | null
  medios: MedioPago[]
  descripcion?: string
}

export interface AltaPagoArmado {
  parameters: Record<string, unknown>
  totalFacturas: number
  retencion: number
  totalPagado: number
}

export class AltaPagoError extends Error {
  constructor(public errores: string[]) {
    super(errores.join(' · '))
    this.name = 'AltaPagoError'
  }
}

/** Saldo pendiente de una impaga, en pesos */
export function saldoImpaga(f: ImpagaColppy): number {
  return r2(Number(f.Saldo ?? f.saldoAnterior))
}

/** Fase 1: se paga solo si es factura (FAC) en pesos */
export function esPagableFase1(f: ImpagaColppy): { ok: true } | { ok: false; motivo: string } {
  if (String(f.tipoComprobante) !== 'FAC') return { ok: false, motivo: `${f.tipoComprobante || 'Comprobante'} (por ahora solo facturas)` }
  if (f.moneda || f.currency || (f.totalme !== null && f.totalme !== undefined && f.totalme !== '')) {
    return { ok: false, motivo: 'Factura en moneda extranjera (todavía no)' }
  }
  if (!(saldoImpaga(f) > 0)) return { ok: false, motivo: 'Sin saldo' }
  return { ok: true }
}

function ddmmyyyy(fechaIso: string, sep: '-' | '/'): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaIso)
  if (!m) throw new AltaPagoError([`Fecha inválida: ${fechaIso}`])
  return [m[3], m[2], m[1]].join(sep)
}

export function armarAltaPago(p: PedidoAltaPago): AltaPagoArmado {
  const errores: string[] = []
  if (!/^\d+$/.test(p.idProveedor)) errores.push('Proveedor sin id de Colppy')
  if (!/^\d{4}$/.test(p.nroPago1) || !/^\d{8}$/.test(p.nroPago2)) errores.push(`Número de OP inválido: ${p.nroPago1}-${p.nroPago2}`)
  const fechaGuion = ddmmyyyy(p.fecha, '-')
  const fechaBarra = ddmmyyyy(p.fecha, '/')

  const porId = new Map(p.impagas.map((f) => [String(f.idFactura), f]))
  for (const id of Object.keys(p.pagos)) {
    if (!porId.has(id)) errores.push(`La factura ${id} ya no figura impaga en Colppy`)
  }

  const records = p.impagas.map((f) => {
    const importe = r2(Number(p.pagos[String(f.idFactura)] ?? 0))
    const saldo = saldoImpaga(f)
    const pagar = importe > 0
    if (pagar) {
      const pagable = esPagableFase1(f)
      if (!pagable.ok) errores.push(`${f.nroFactura}: ${pagable.motivo}`)
      if (importe > saldo + 0.005) errores.push(`${f.nroFactura}: se paga ${importe} y el saldo es ${saldo}`)
    }
    if (importe < 0) errores.push(`${f.nroFactura}: importe negativo`)
    return {
      idFactura: String(f.idFactura),
      nroFactura: f.nroFactura,
      RETE: '',
      percepcionIVA: f.percepcionIVA ?? '0.00',
      tipoComprobante: f.tipoComprobante,
      fechaPago: f.fechaPago,
      RG: f.RG,
      moneda: f.moneda ?? '',
      rate: f.rate ?? null,
      currency: f.currency ?? null,
      totalme: f.totalme ?? null,
      totalFactura: String(f.totalFactura),
      pagado: Number(f.pagado) || 0,
      saldoAnterior: saldo,
      estePago: pagar ? importe : 0,
      tcPagoRate: '',
      Saldo: pagar ? r2(saldo - importe) : saldo,
      pagar,
      saldoNC: '',
      retencionAcumulada: pagar ? '0.00' : 0,
    }
  })

  const totalFacturas = r2(records.reduce((a, r) => a + r.estePago, 0))
  if (!(totalFacturas > 0)) errores.push('No hay facturas para pagar')

  const retencion = p.retencion ? r2(p.retencion.importe) : 0
  if (retencion < 0) errores.push('La retención no puede ser negativa')
  if (retencion > totalFacturas) errores.push('La retención supera lo que se paga')
  if (p.retencion && !/^\d+$/.test(p.retencion.regimen)) errores.push('Régimen de retención inválido')
  if (p.retencion && !(p.retencion.baseAcumulada > 0)) errores.push('Falta la base de cálculo de la retención')
  const totalPagado = r2(totalFacturas - retencion)

  if (!p.medios.length) errores.push('Falta el medio de pago')
  for (const m of p.medios) {
    if (m.medio !== 'Transferencia' && m.medio !== 'Tarjeta de Crédito') errores.push(`Medio de pago no soportado todavía: ${m.medio}`)
    if (!m.cuenta?.trim()) errores.push('Falta la cuenta del medio de pago')
    if (!(r2(m.importe) > 0)) errores.push(`Importe inválido en ${m.cuenta || 'un medio de pago'}`)
  }
  const sumaMedios = r2(p.medios.reduce((a, m) => a + r2(m.importe), 0))
  if (Math.abs(sumaMedios - totalPagado) > 0.005) {
    errores.push(`Los medios de pago suman ${sumaMedios} y el total a pagar es ${totalPagado}`)
  }

  if (errores.length) throw new AltaPagoError(errores)

  // Con régimen se manda la base acumulada aunque la retención dé 0 (debajo del
  // mínimo): Colppy la guarda en el pago y el próximo pago del mes acumula sobre ella.
  const conRetencion = !!p.retencion
  const parameters: Record<string, unknown> = {
    idPago: '',
    idProveedor: p.idProveedor,
    fechaPago: fechaGuion,
    valorCambio: '0',
    totalpagado: totalPagado,
    idEstadoPago: 'Aprobado',
    totalFacturas,
    anticipo: 0,
    descuentos: 0,
    intereses: 0,
    // Sin régimen va como lo guarda Colppy (leer_pago: régimen "0", base y retención 0)
    idRetGanancias1: conRetencion ? p.retencion!.regimen : '0',
    baseCalculo1: conRetencion ? r2(p.retencion!.baseAcumulada) : 0,
    retGanancias1: conRetencion ? retencion : 0,
    retemitidas: [],
    retencionIIBB: 0,
    nroPago1: p.nroPago1,
    nroPago2: p.nroPago2,
    recordsToInsertUpdate: records,
    recordsToInsertUpdate1: p.medios.map((m) => ({
      idMedioPago: m.medio,
      idPlanCuenta: m.cuenta.trim(),
      nroCheque: '',
      fechaValidez: fechaBarra,
      importe: r2(m.importe),
      idTabla: 0,
      idElemento: 0,
      idItem: 0,
      CED: 'S',
      Conciliado: '',
      Moneda: '',
    })),
    descripcion: (p.descripcion ?? '').slice(0, 200),
    diferenciaTipoCambio: 0,
    origen: 'proveedores',
  }
  return { parameters, totalFacturas, retencion, totalPagado }
}
