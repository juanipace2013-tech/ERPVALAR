/**
 * Nota de crédito POR UNIDADES (devoluciones): el usuario elige cuántas
 * unidades de cada línea de la factura devuelve y los importes salen de las
 * líneas exactas que se mandaron a Colppy/ARCA (Invoice.colppyPayload.items):
 * mismo precio unitario, mismo descuento, mismo artículo de inventario (así la
 * NC devuelve el stock en Colppy). Funciones puras (testeables), compartidas
 * por el servidor y la vista previa del diálogo.
 */
import type { ColppyInvoicePayload } from '@/lib/colppy'

type LineaPayload = ColppyInvoicePayload['items'][number]

const r2 = (n: number) => Math.round(n * 100) / 100

export interface LineaAcreditable {
  /** Índice de la línea en colppyPayload.items de la factura */
  index: number
  codigo: string | null
  descripcion: string
  cantidadFacturada: number
  cantidadAcreditada: number
  cantidadDisponible: number
  /** Precio unitario NETO (sin IVA) después del descuento de la línea, tal como se facturó */
  netoUnitarioFactura: number
  /**
   * Neto unitario que se acredita: el de la factura, ajustado en proporción si
   * hubo NC por importe antes (bonificaciones ya acreditadas).
   */
  netoUnitario: number
  /** Precio unitario tal como está en la línea (neto en A, final con IVA en B) */
  importeUnitario: number
  porcDesc: number
  /** Mueve stock en Colppy (artículo de inventario) */
  conStock: boolean
  /**
   * Vínculo con la cotización (solo si la factura tiene cotización):
   * COTIZACION = se puede devolver a pendiente; ADICIONAL = es un adicional
   * del ítem `adicionalDe`; SIN_VINCULO = no se pudo vincular.
   */
  vinculo?: 'COTIZACION' | 'ADICIONAL' | 'SIN_VINCULO' | null
  adicionalDe?: number | null
}

/** Clave para sumar lo ya acreditado de una línea en NC anteriores (sin índice de línea guardado) */
export function claveLinea(codigo: string | null | undefined, descripcion: string | null | undefined): string {
  return `${(codigo || '').trim().toUpperCase()}|${(descripcion || '').trim().toUpperCase()}`
}

/** Lo ya devuelto en NC por unidades anteriores. */
export interface Acreditado {
  /** Por índice de línea de la factura (InvoiceItem.lineaFactura de la NC) */
  porIndice: Map<number, number>
  /** NC sin índice guardado: por claveLinea, se reparte en orden */
  porClave: Map<string, number>
}

export function acreditadoVacio(): Acreditado {
  return { porIndice: new Map(), porClave: new Map() }
}

/** Líneas de la factura con lo disponible para devolver (netoUnitario sin ajustar). */
export function lineasAcreditables(
  payload: Pick<ColppyInvoicePayload, 'items' | 'tipoFactura'>,
  acreditado: Acreditado
): LineaAcreditable[] {
  const esA = payload.tipoFactura === 'A'
  const restante = new Map(acreditado.porClave)
  return payload.items.map((it: LineaPayload, index: number) => {
    const cantidadFacturada = Number(it.Cantidad) || 0
    const clave = claveLinea(it.codigo, it.Descripcion)
    const porIndice = Math.min(cantidadFacturada, acreditado.porIndice.get(index) ?? 0)
    const porClave = Math.min(cantidadFacturada - porIndice, restante.get(clave) ?? 0)
    restante.set(clave, (restante.get(clave) ?? 0) - porClave)
    const yaAcreditado = porIndice + porClave
    const importeUnitario = Number(it.ImporteUnitario) || 0
    const porcDesc = Number(it.porcDesc) || 0
    const netoSinDesc = esA ? importeUnitario : importeUnitario / 1.21
    const netoUnitarioFactura = netoSinDesc * (1 - porcDesc / 100)
    return {
      index,
      codigo: it.codigo || null,
      descripcion: String(it.Descripcion || ''),
      cantidadFacturada,
      cantidadAcreditada: yaAcreditado,
      cantidadDisponible: Math.max(0, r2(cantidadFacturada - yaAcreditado)),
      netoUnitarioFactura,
      netoUnitario: netoUnitarioFactura,
      importeUnitario,
      porcDesc,
      conStock: !!it.idItem && it.idItem !== 0 && it.tipoItem === 'P',
    }
  })
}

/** Contexto de la factura para calcular la NC: lo pendiente de acreditar. */
export interface ContextoNc {
  /** Neto e IVA de la factura menos los de las NC anteriores */
  netoPendiente: number
  ivaPendiente: number
  hayNcPrevias: boolean
  /**
   * Factor sobre el neto de las líneas: < 1 si hubo NC por importe antes
   * (la bonificación se reparte en proporción entre las unidades que quedan).
   */
  factor: number
}

/**
 * Arma el contexto y ajusta netoUnitario de las líneas. Solo si hubo NC por
 * importe antes (`porImporte`: sin líneas devueltas) el factor es
 * netoPendiente / neto de las unidades disponibles, así devolver todo lo que
 * queda suma exactamente lo pendiente. Sin ajustes previos es 1: la diferencia
 * entre el encabezado y las líneas es solo redondeo (precios con IVA / 1,21).
 */
export function prepararContextoNc(
  lineas: LineaAcreditable[],
  factura: { neto: number; iva: number },
  ncsPrevias: Array<{ subtotal: number; taxAmount: number; porImporte?: boolean }>
): { lineas: LineaAcreditable[]; contexto: ContextoNc } {
  const netoPendiente = r2(factura.neto - ncsPrevias.reduce((s, n) => s + n.subtotal, 0))
  const ivaPendiente = r2(factura.iva - ncsPrevias.reduce((s, n) => s + n.taxAmount, 0))
  const netoLineas = lineas.reduce((s, l) => s + l.netoUnitarioFactura * l.cantidadDisponible, 0)
  const unidades = lineas.reduce((s, l) => s + l.cantidadDisponible, 0)
  let factor = 1
  if (ncsPrevias.some((n) => n.porImporte) && netoLineas > 0) {
    factor = netoPendiente / netoLineas
    // Centavos de redondeo (hasta medio centavo por unidad) no son una bonificación
    if (Math.abs(netoPendiente - netoLineas) <= 0.005 * unidades + 0.01 || factor > 1) factor = 1
    if (factor < 0) factor = 0
  }
  return {
    lineas: lineas.map((l) => ({ ...l, netoUnitario: l.netoUnitarioFactura * factor })),
    contexto: { netoPendiente, ivaPendiente, hayNcPrevias: ncsPrevias.length > 0, factor },
  }
}

export interface SeleccionUnidades {
  index: number
  cantidad: number
}

export interface ImportesNc {
  neto: number
  iva: number
  total: number
  /** Neto a precio de factura (sin el ajuste por NC por importe): base de la comisión */
  netoFactura: number
  /** Cantidad por índice de línea (ya agrupada y validada) */
  cantidades: Map<number, number>
  /** Devuelve todo lo facturado y no había NC antes: sale como NC total */
  devuelveTodo: boolean
  /** Con esta NC no queda nada por devolver */
  agotaTodo: boolean
}

/** Decimales permitidos: enteros si la línea se facturó en unidades enteras. */
function cantidadValida(cantidad: number, linea: LineaAcreditable): boolean {
  if (Number.isInteger(linea.cantidadFacturada)) return Number.isInteger(cantidad)
  return Math.abs(cantidad * 100 - Math.round(cantidad * 100)) < 1e-6
}

/**
 * Importes de una NC por unidades (servidor y vista previa del diálogo).
 * Lanza Error con mensaje para el usuario si la selección es inválida.
 */
export function calcularImportesNc(
  lineas: LineaAcreditable[],
  seleccion: SeleccionUnidades[],
  ctx: ContextoNc
): ImportesNc {
  const cantidades = new Map<number, number>()
  for (const s of seleccion) {
    const index = Number(s.index)
    const cantidad = Number(s.cantidad)
    const linea = Number.isInteger(index) ? lineas[index] : undefined
    if (!linea) throw new Error('Línea de factura inexistente')
    if (!Number.isFinite(cantidad) || cantidad < 0) throw new Error(`Cantidad inválida en "${linea.descripcion}"`)
    if (cantidad === 0) continue
    if (!cantidadValida(cantidad, linea)) {
      throw new Error(`"${linea.descripcion}": la cantidad a devolver tiene que ser un número entero de unidades`)
    }
    // La misma línea dos veces se suma (y se valida el total)
    cantidades.set(index, r2((cantidades.get(index) ?? 0) + cantidad))
  }
  if (!cantidades.size) throw new Error('Elegí al menos una unidad para devolver')

  let neto = 0
  let netoFactura = 0
  for (const [index, cantidad] of cantidades) {
    const linea = lineas[index]
    if (cantidad > linea.cantidadDisponible + 1e-9) {
      throw new Error(
        `"${linea.descripcion}": se pueden devolver como máximo ${linea.cantidadDisponible} (facturadas ${linea.cantidadFacturada}, ya devueltas ${linea.cantidadAcreditada})`
      )
    }
    neto += r2(linea.netoUnitario * cantidad)
    netoFactura += r2(linea.netoUnitarioFactura * cantidad)
  }
  neto = r2(neto)
  netoFactura = r2(netoFactura)

  const agotaTodo = lineas.every((l) => l.cantidadDisponible <= 0 || (cantidades.get(l.index) ?? 0) >= l.cantidadDisponible - 1e-9)
  const devuelveTodo = agotaTodo && !ctx.hayNcPrevias && lineas.every((l) => l.cantidadAcreditada === 0)
  let iva = r2(neto * 0.21)
  if (agotaTodo) {
    // Lo último que queda: el remanente exacto del encabezado (absorbe los
    // centavos de redondeo por línea y las bonificaciones ya acreditadas)
    neto = ctx.netoPendiente
    iva = ctx.ivaPendiente
  }
  return { neto, iva, total: r2(neto + iva), netoFactura, cantidades, devuelveTodo, agotaTodo }
}

export interface CalculoNcUnidades extends ImportesNc {
  /** Líneas para el payload de Colppy (mismo formato que la factura) */
  lineasColppy: LineaPayload[]
  /** Detalle por línea (para InvoiceItems de la NC y el PDF) */
  detalle: Array<{ linea: LineaAcreditable; cantidad: number; neto: number }>
}

/** Calcula la NC por unidades con sus líneas para Colppy. Lanza Error si la selección es inválida. */
export function calcularNcUnidades(
  payload: Pick<ColppyInvoicePayload, 'items' | 'tipoFactura'>,
  lineas: LineaAcreditable[],
  seleccion: SeleccionUnidades[],
  ctx: ContextoNc
): CalculoNcUnidades {
  const imp = calcularImportesNc(lineas, seleccion, ctx)
  const detalle: CalculoNcUnidades['detalle'] = []
  const lineasColppy: LineaPayload[] = []
  for (const [index, cantidad] of imp.cantidades) {
    const linea = lineas[index]
    detalle.push({ linea, cantidad, neto: r2(linea.netoUnitario * cantidad) })
    const original = payload.items[index]
    // Con bonificación previa (factor < 1) el precio unitario baja en la misma proporción
    const importeUnitario = ctx.factor === 1 ? Number(original.ImporteUnitario) : r2(Number(original.ImporteUnitario) * ctx.factor)
    lineasColppy.push({
      ...original,
      ImporteUnitario: importeUnitario,
      Cantidad: cantidad,
      // mismo criterio que la factura: subtotal = ImporteUnitario × cantidad × (1 − desc)
      subtotal: r2(importeUnitario * cantidad * (1 - (Number(original.porcDesc) || 0) / 100)),
    })
  }
  return { ...imp, lineasColppy, detalle }
}

/**
 * NC por importe (ajuste/bonificación): neto pedido → neto/IVA/total, igual en
 * el servidor y en la vista previa. Hasta lo pendiente; si es todo lo
 * pendiente toma el IVA exacto del encabezado. Por el total de una factura sin
 * NC previas no corresponde un ajuste (no anula la factura ni la comisión):
 * para eso está la NC total o la devolución por unidades.
 */
export function calcularNcImporte(netoPedido: number, ctx: Pick<ContextoNc, 'netoPendiente' | 'ivaPendiente' | 'hayNcPrevias'>): { neto: number; iva: number; total: number } {
  if (!Number.isFinite(netoPedido) || netoPedido <= 0) throw new Error('Indicá el neto del ajuste (mayor a cero)')
  let neto = r2(netoPedido)
  if (neto > ctx.netoPendiente + 0.01) {
    throw new Error(`El neto del ajuste (${neto}) supera el neto pendiente de acreditar (${ctx.netoPendiente}). Para anular la factura completa usá la NC total.`)
  }
  let iva = r2(neto * 0.21)
  if (Math.abs(neto - ctx.netoPendiente) <= 0.01) {
    if (!ctx.hayNcPrevias) {
      throw new Error('Es el total de la factura: usá la NC total (anula la factura) o la devolución por unidades, así se descuenta la comisión y vuelve el stock.')
    }
    neto = ctx.netoPendiente
    iva = ctx.ivaPendiente
  }
  return { neto, iva, total: r2(neto + iva) }
}

// ─── Vínculo línea de la factura → ítem de la factura/cotización ───────────

export interface ItemFacturaVinculable {
  id: string
  quoteItemId: string | null
  quantity: number
  /** sku de la línea, del producto, manualSku del ítem de cotización */
  codigos: Array<string | null | undefined>
  /** descripción de la línea, nombre del producto, descripción del ítem de cotización */
  nombres: Array<string | null | undefined>
  /** Adicionales del ítem de cotización, en orden (van como líneas propias en la factura) */
  adicionales: Array<{ codigos: Array<string | null | undefined>; nombres: Array<string | null | undefined> }>
}

export type VinculoLinea = { invoiceItemId: string; quoteItemId: string | null; adicional: boolean; principal: number } | null

const nrm = (x: string | null | undefined) => (x ?? '').trim().toUpperCase()

function coincide(
  linea: { codigo?: string | null; Descripcion?: string | null },
  x: { codigos: Array<string | null | undefined>; nombres: Array<string | null | undefined> }
): boolean {
  const cod = nrm(linea.codigo)
  if (cod && x.codigos.some((c) => nrm(c) === cod)) return true
  const desc = nrm(linea.Descripcion)
  return !!desc && x.nombres.some((n) => nrm(n) === desc)
}

/**
 * Vincula cada línea de la factura (colppyPayload.items) con el InvoiceItem
 * que la generó. La factura se arma con, por cada ítem de cotización, su línea
 * principal y a continuación una línea por adicional, en el mismo orden en
 * que se crean los InvoiceItems (uno por ítem). Si la cantidad de líneas
 * cuadra con esa estructura se vincula por posición (exacto aunque se repita
 * el código o se haya editado la descripción); si no (líneas manuales), por
 * código/descripción en orden, consumiendo cada ítem una sola vez.
 * `principal` es el índice de la línea principal (para adicionales).
 */
export function vincularLineasFactura(
  lineas: Array<{ codigo?: string | null; Descripcion?: string | null; Cantidad?: unknown }>,
  items: ItemFacturaVinculable[]
): VinculoLinea[] {
  const cant = (l: { Cantidad?: unknown }) => Number(l.Cantidad) || 0
  const mismaCant = (a: number, b: number) => Math.abs(a - b) < 1e-6

  // 1. Por posición
  const esperado: Array<{ item: ItemFacturaVinculable; adicional: number | null }> = items.flatMap((item) => [
    { item, adicional: null },
    ...item.adicionales.map((_, i) => ({ item, adicional: i })),
  ])
  if (esperado.length === lineas.length && esperado.length > 0) {
    let principal = -1
    const out: VinculoLinea[] = []
    let ok = true
    for (let i = 0; i < lineas.length && ok; i++) {
      const e = esperado[i]
      const l = lineas[i]
      if (!mismaCant(cant(l), e.item.quantity)) ok = false
      // Si la línea tiene código y el ítem también, tienen que coincidir (los
      // adicionales de un ítem pueden venir en cualquier orden)
      const codigos = e.adicional === null ? e.item.codigos : e.item.adicionales.flatMap((a) => a.codigos)
      if (nrm(l.codigo) && codigos.some((c) => nrm(c)) && !coincide({ codigo: l.codigo }, { codigos, nombres: [] })) ok = false
      if (e.adicional === null) principal = i
      out.push({ invoiceItemId: e.item.id, quoteItemId: e.item.quoteItemId, adicional: e.adicional !== null, principal })
    }
    if (ok) return out
  }

  // 2. Por código/descripción, en orden
  const usados = new Set<string>()
  let ultimo: { item: ItemFacturaVinculable; principal: number; pendientes: number } | null = null
  return lineas.map((l, i) => {
    // ¿Es el próximo adicional del último ítem principal?
    if (ultimo && ultimo.pendientes < ultimo.item.adicionales.length) {
      const a = ultimo.item.adicionales[ultimo.pendientes]
      if (coincide(l, a) && mismaCant(cant(l), ultimo.item.quantity)) {
        ultimo.pendientes++
        return { invoiceItemId: ultimo.item.id, quoteItemId: ultimo.item.quoteItemId, adicional: true, principal: ultimo.principal }
      }
    }
    const libres = items.filter((it) => !usados.has(it.id) && coincide(l, it))
    const item = libres.find((it) => mismaCant(it.quantity, cant(l))) ?? libres[0]
    if (item) {
      usados.add(item.id)
      ultimo = { item, principal: i, pendientes: 0 }
      return { invoiceItemId: item.id, quoteItemId: item.quoteItemId, adicional: false, principal: i }
    }
    // Adicional fuera de orden del último principal
    if (ultimo && ultimo.item.adicionales.some((a) => coincide(l, a))) {
      return { invoiceItemId: ultimo.item.id, quoteItemId: ultimo.item.quoteItemId, adicional: true, principal: ultimo.principal }
    }
    return null
  })
}

/** Número en formato argentino o con punto decimal: "5.000,50" → 5000.5, "5.000" → 5000, "12.5" → 12.5. NaN si no es número. */
export function parseNumeroAr(s: string): number {
  const t = (s || '').trim().replace(/\s/g, '')
  if (!t) return NaN
  if (t.includes(',')) return Number(t.replace(/\./g, '').replace(',', '.'))
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ''))
  return Number(t)
}
