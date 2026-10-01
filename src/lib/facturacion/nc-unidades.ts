/**
 * Nota de crédito POR UNIDADES (devoluciones): el usuario elige cuántas
 * unidades de cada línea de la factura devuelve y los importes salen de las
 * líneas exactas que se mandaron a Colppy/ARCA (Invoice.colppyPayload.items):
 * mismo precio unitario, mismo descuento, mismo artículo de inventario (así la
 * NC devuelve el stock en Colppy). Funciones puras (testeables).
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
  /** Precio unitario NETO (sin IVA) después del descuento de la línea */
  netoUnitario: number
  /** Precio unitario tal como está en la línea (neto en A, final con IVA en B) */
  importeUnitario: number
  porcDesc: number
  /** Mueve stock en Colppy (artículo de inventario) */
  conStock: boolean
}

/** Clave para sumar lo ya acreditado de una línea en NC anteriores */
export function claveLinea(codigo: string | null | undefined, descripcion: string | null | undefined): string {
  return `${(codigo || '').trim().toUpperCase()}|${(descripcion || '').trim().toUpperCase()}`
}

/**
 * Líneas de la factura con lo disponible para devolver.
 * @param acreditadoPorClave cantidades ya devueltas en NC anteriores, por claveLinea
 */
export function lineasAcreditables(
  payload: Pick<ColppyInvoicePayload, 'items' | 'tipoFactura'>,
  acreditadoPorClave: Map<string, number>
): LineaAcreditable[] {
  const esA = payload.tipoFactura === 'A'
  // Si la misma línea (código+descripción) aparece más de una vez, lo
  // acreditado se reparte en orden.
  const restante = new Map(acreditadoPorClave)
  return payload.items.map((it: LineaPayload, index: number) => {
    const cantidadFacturada = Number(it.Cantidad) || 0
    const clave = claveLinea(it.codigo, it.Descripcion)
    const yaAcreditado = Math.min(cantidadFacturada, restante.get(clave) ?? 0)
    restante.set(clave, (restante.get(clave) ?? 0) - yaAcreditado)
    const importeUnitario = Number(it.ImporteUnitario) || 0
    const porcDesc = Number(it.porcDesc) || 0
    const netoSinDesc = esA ? importeUnitario : importeUnitario / 1.21
    return {
      index,
      codigo: it.codigo || null,
      descripcion: String(it.Descripcion || ''),
      cantidadFacturada,
      cantidadAcreditada: yaAcreditado,
      cantidadDisponible: Math.max(0, cantidadFacturada - yaAcreditado),
      netoUnitario: netoSinDesc * (1 - porcDesc / 100),
      importeUnitario,
      porcDesc,
      conStock: !!it.idItem && it.idItem !== 0 && it.tipoItem === 'P',
    }
  })
}

export interface SeleccionUnidades {
  index: number
  cantidad: number
}

export interface CalculoNcUnidades {
  neto: number
  iva: number
  total: number
  /** Líneas para el payload de Colppy (mismo formato que la factura) */
  lineasColppy: LineaPayload[]
  /** Detalle por línea (para InvoiceItems de la NC y el PDF) */
  detalle: Array<{ linea: LineaAcreditable; cantidad: number; neto: number }>
  /** Devuelve todo lo facturado (y no había NC previas): conviene NC total */
  devuelveTodo: boolean
}

/** Calcula la NC por unidades. Lanza Error con mensaje para el usuario si la selección es inválida. */
export function calcularNcUnidades(
  payload: Pick<ColppyInvoicePayload, 'items' | 'tipoFactura'>,
  lineas: LineaAcreditable[],
  seleccion: SeleccionUnidades[]
): CalculoNcUnidades {
  const elegidas = seleccion.filter((s) => Number(s.cantidad) > 0)
  if (!elegidas.length) throw new Error('Elegí al menos una unidad para devolver')

  const detalle: CalculoNcUnidades['detalle'] = []
  const lineasColppy: LineaPayload[] = []
  for (const s of elegidas) {
    const linea = lineas[s.index]
    if (!linea) throw new Error('Línea de factura inexistente')
    const cantidad = Number(s.cantidad)
    if (!Number.isFinite(cantidad) || cantidad <= 0) throw new Error(`Cantidad inválida en "${linea.descripcion}"`)
    if (cantidad > linea.cantidadDisponible + 1e-9) {
      throw new Error(`"${linea.descripcion}": se pueden devolver como máximo ${linea.cantidadDisponible} (facturadas ${linea.cantidadFacturada}, ya devueltas ${linea.cantidadAcreditada})`)
    }
    const neto = r2(linea.netoUnitario * cantidad)
    detalle.push({ linea, cantidad, neto })
    const original = payload.items[s.index]
    lineasColppy.push({
      ...original,
      Cantidad: cantidad,
      // mismo criterio que la factura: subtotal = ImporteUnitario × cantidad × (1 − desc)
      subtotal: r2(Number(original.ImporteUnitario) * cantidad * (1 - (Number(original.porcDesc) || 0) / 100)),
    })
  }

  const neto = r2(detalle.reduce((acc, d) => acc + d.neto, 0))
  const iva = r2(neto * 0.21)
  const devuelveTodo =
    lineas.every((l) => l.cantidadAcreditada === 0) &&
    lineas.every((l) => {
      const sel = elegidas.find((s) => s.index === l.index)
      return l.cantidadFacturada === 0 || (sel && Number(sel.cantidad) >= l.cantidadFacturada)
    })
  return { neto, iva, total: r2(neto + iva), lineasColppy, detalle, devuelveTodo }
}
