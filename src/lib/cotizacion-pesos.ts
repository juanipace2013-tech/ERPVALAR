/**
 * Presentar en pesos una cotización hecha en USD (clientes que no aceptan
 * presupuestos en dólares, ej. organismos públicos).
 *
 * La cotización NO se convierte: los ítems, el subtotal y el total siguen
 * guardados en USD (comisiones, análisis de facturación y ARCA trabajan sobre
 * esos importes). `Quote.mostrarEnPesos` solo cambia lo que ve el cliente
 * (PDF, mail y link público): cada precio unitario se pasa a pesos con el
 * `exchangeRate` de la cotización y los totales se rearman desde ahí, para que
 * el presupuesto sume exacto. Volver a USD es apagar la marca.
 */

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export type MonedaPresentacion = 'USD' | 'ARS'

/** true si la cotización es en USD, está marcada para mostrarse en pesos y tiene TC. */
export function cotizacionEnPesos(q: {
  currency: string
  mostrarEnPesos?: boolean | null
  exchangeRate: unknown
}): boolean {
  return q.currency === 'USD' && q.mostrarEnPesos === true && Number(q.exchangeRate) > 0
}

/** Moneda en la que se le muestran los importes al cliente. */
export function monedaPresentacion(q: {
  currency: string
  mostrarEnPesos?: boolean | null
  exchangeRate: unknown
}): MonedaPresentacion {
  return cotizacionEnPesos(q) || q.currency === 'ARS' ? 'ARS' : 'USD'
}

/** "USD 1.234,56" o "$ 1.234,56". */
export function formatoImporte(n: number, moneda: MonedaPresentacion): string {
  const txt = n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return moneda === 'ARS' ? `$ ${txt}` : `USD ${txt}`
}

interface ItemImporte {
  quantity: number
  unitPrice: number
  totalPrice: number
  isAlternative?: boolean | null
}

/**
 * Importes de la cotización en pesos. El unitario se redondea a centavos
 * (como al facturar en pesos, ver facturacion/moneda.ts) y el total de la
 * línea, el subtotal y el total salen de los unitarios ya redondeados. Las
 * alternativas no suman al subtotal, igual que en USD.
 */
export function importesEnPesos<T extends ItemImporte>(
  items: T[],
  bonificacionPct: number,
  tc: number
): { items: T[]; subtotal: number; total: number } {
  if (!(tc > 0)) throw new Error('Tipo de cambio inválido para pasar la cotización a pesos')
  let subtotal = 0
  const convertidos = items.map((it) => {
    const unitPrice = r2(Number(it.unitPrice) * tc)
    const totalPrice = r2(unitPrice * it.quantity)
    if (!it.isAlternative) subtotal += totalPrice
    return { ...it, unitPrice, totalPrice }
  })
  subtotal = r2(subtotal)
  const total = r2(subtotal * (1 - (Number(bonificacionPct) || 0) / 100))
  return { items: convertidos, subtotal, total }
}

/**
 * Importes tal como se le muestran al cliente: en pesos si la cotización está
 * marcada, sin tocar si no.
 */
export function importesPresentacion<T extends ItemImporte>(
  quote: {
    currency: string
    mostrarEnPesos?: boolean | null
    exchangeRate: unknown
    bonification: unknown
    subtotal: unknown
    total: unknown
  },
  items: T[]
): { moneda: MonedaPresentacion; items: T[]; subtotal: number; total: number } {
  if (cotizacionEnPesos(quote)) {
    return {
      moneda: 'ARS',
      ...importesEnPesos(items, Number(quote.bonification) || 0, Number(quote.exchangeRate)),
    }
  }
  return {
    moneda: monedaPresentacion(quote),
    items,
    subtotal: Number(quote.subtotal),
    total: Number(quote.total),
  }
}

/**
 * Renglones de "Condiciones comerciales" del PDF. En pesos no se nombra el
 * dólar ni la cláusula de diferencia de cambio.
 */
export function condicionesComerciales(o: {
  moneda: MonedaPresentacion
  exterior?: boolean
  pricesIncludeTax?: boolean
  validityDays: number
  paymentTerms: string
}): string[] {
  const enPesos = o.moneda === 'ARS'
  const expresados = enPesos
    ? 'expresados en pesos argentinos.'
    : 'expresados en dólares americanos cotización BNA billete vendedor.'
  const leyendaPrecios =
    o.exterior && !o.pricesIncludeTax
      ? `Operación de exportación: los precios no incluyen IVA y están expresados en ${enPesos ? 'pesos argentinos' : 'dólares americanos'}.`
      : o.pricesIncludeTax
        ? `Los precios INCLUYEN IVA (21%) y están ${expresados}`
        : `Los precios No incluyen IVA (21%) y están ${expresados}`
  return [
    leyendaPrecios,
    `Validez de la oferta: ${o.validityDays} días.`,
    'Lugar de entrega: 14 de Julio 175 - Paternal. CABA',
    `Condición de pago: ${o.paymentTerms}`,
    ...(enPesos
      ? []
      : [
          'Si hubiere una diferencia de cambio ±3% entre la fecha real de acreditación de los fondos y la fecha de',
          'emisión de la factura, nos veremos obligados a la emisión de una nota de débito o de crédito',
          'correspondiente a dicha diferencia.',
        ]),
  ]
}
