/**
 * Totales de una Factura B a partir de precios FINALES (IVA 21% incluido).
 *
 * Regla "total primero": el total es lo que paga el consumidor (suma de
 * precio final × cantidad × factor de bonificación), el neto sale de dividir
 * por 1,21 y el IVA contenido por diferencia. Así ImpNeto + ImpIVA = ImpTotal
 * = suma de los precios finales: $100 → 82,64 + 17,36 = 100,00. Antes se
 * redondeaba primero el neto y el IVA era neto × 21%: $100 → 82,64 + 17,35 =
 * 99,99 (un centavo menos de lo cobrado).
 *
 * Confirmado en homologación el 5/10/2026 (B DNI/CUIL/CUIT y exento): ARCA
 * (WSFE) acepta el IVA calculado como total − neto ($100 → 82,64 + 17,36;
 * $10,05 → 8,31 + 1,74) con DocTipo 96, 86 y 80 (condición 5) y con un exento
 * (condición 4).
 *
 * El precio unitario se redondea a 2 decimales igual que el ImporteUnitario
 * que va a Colppy, para que líneas y total cierren.
 *
 * Módulo puro, sin imports: lo comparten sendQuoteToColppy (Colppy, ARCA y la
 * Invoice del ERP, que sale del payload) y el borrador de facturas de Mercado
 * Libre (IVA contenido), para que todos muestren los mismos importes.
 */
export interface TotalesFacturaB {
  /** Total de la factura (= suma de los precios finales) */
  total: number
  /** Neto gravado = round2(total / 1,21) */
  neto: number
  /** IVA contenido = total − neto */
  iva: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function totalesFacturaB(
  lineas: Array<{ cantidad: number; precioFinal: number }>,
  bonificacionPct: number | null | undefined = 0
): TotalesFacturaB {
  const factor = 1 - (Number(bonificacionPct) || 0) / 100
  const bruto = lineas.reduce((s, l) => {
    const cantidad = Number(l.cantidad)
    const precio = round2(Number(l.precioFinal))
    return Number.isFinite(cantidad) && Number.isFinite(precio) ? s + precio * cantidad : s
  }, 0)
  const total = round2(bruto * factor)
  const neto = round2(total / 1.21)
  return { total, neto, iva: round2(total - neto) }
}

/** Totales de una Factura A (neto gravado, IVA 21% discriminado y total). */
export interface TotalesFacturaA {
  /** Neto gravado = round2(Σ unitario neto × cantidad × factor de bonificación) */
  neto: number
  /** IVA = round2(neto × 21%) */
  iva: number
  /** Total = round2(neto + IVA): con precios finales puede quedar unos centavos debajo de lo cobrado */
  total: number
}

/**
 * Factura A: NETO PRIMERO, exactamente como la rama A de sendQuoteToColppy (lo
 * que va a Colppy, a ARCA y a la Invoice del ERP). Si los precios incluyen IVA
 * (pricesIncludeTax, p. ej. ventas de ML) el unitario neto es precio / 1,21 SIN
 * redondear; las líneas se suman sin redondear, se aplica la bonificación y
 * recién ahí se redondea el neto; el IVA es neto × 21% redondeado. Así $100
 * final → 82,64 + 17,35 = 99,99.
 */
export function totalesFacturaA(
  lineas: Array<{ cantidad: number; precioUnitario: number }>,
  bonificacionPct: number | null | undefined,
  preciosConIva: boolean
): TotalesFacturaA {
  const bonifFactor = 1 - Number(bonificacionPct ?? 0) / 100
  let netoSinRedondear = 0
  for (const l of lineas) {
    const unitario = preciosConIva ? Number(l.precioUnitario) / 1.21 : Number(l.precioUnitario)
    netoSinRedondear += unitario * Number(l.cantidad)
  }
  const neto = Math.round(netoSinRedondear * bonifFactor * 100) / 100
  const iva = Math.round(neto * 0.21 * 100) / 100
  const total = Math.round((neto + iva) * 100) / 100
  return { neto, iva, total }
}

/** Factura A desde precios FINALES (con IVA), como el borrador de ML: totalesFacturaA con preciosConIva. */
export function totalesFacturaADesdeFinal(
  lineas: Array<{ cantidad: number; precioFinal: number }>,
  bonificacionPct: number | null | undefined = 0
): TotalesFacturaA {
  return totalesFacturaA(
    lineas.map((l) => ({ cantidad: l.cantidad, precioUnitario: l.precioFinal })),
    bonificacionPct,
    true
  )
}
