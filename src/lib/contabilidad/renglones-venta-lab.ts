/**
 * Renglones de una venta para el laboratorio contable (scripts/export-contabilidad-lab.ts).
 *
 * El InvoiceItem guarda la electroválvula con sus adicionales (bobina, conector…) en un solo
 * renglón con el precio combinado, pero a Colppy se manda un renglón por artículo (buildSplitItem),
 * y Colppy descarga stock y costo de cada uno. Para que el laboratorio mueva el mismo stock, se
 * exportan los renglones tal como fueron a Colppy (colppyPayload.items) cuando:
 *   - el payload tiene más renglones que la factura (hubo adicionales separados),
 *   - la factura tiene una sola alícuota (el payload no la trae por renglón) y
 *   - el neto de los renglones del payload es el mismo que el de la factura (o, si la factura guarda
 *     el precio con IVA, el del payload más el IVA de su alícuota).
 * Si no, salen los renglones de la factura como siempre.
 */

export type RenglonVentaLab = {
  sku: string
  descripcion: string
  cantidad: number
  precioUnitario: number
  dtoPct: number
  alicuota: number
  subtotal: number
}

type ItemFactura = {
  sku?: string | null
  product?: { sku: string } | null
  description?: string | null
  quantity: unknown
  unitPrice: unknown
  discount: unknown
  taxRate: unknown
  subtotal: unknown
}

type ItemPayload = {
  idItem?: number | string | null
  Descripcion?: string | null
  ImporteUnitario?: number | string | null
  Cantidad?: number | string | null
  porcDesc?: number | string | null
  subtotal?: number | string | null
}

const n = (v: unknown) => Number(v ?? 0) || 0
const centavos = (rows: { subtotal: number }[]) => Math.round(rows.reduce((s, r) => s + r.subtotal * 100, 0))

export function renglonesVentaLab(
  factura: { items: ItemFactura[]; colppyPayload?: unknown },
  skuPorItemColppy: Map<number, string>,
): RenglonVentaLab[] {
  const base: RenglonVentaLab[] = factura.items.map((it) => ({
    sku: it.sku || it.product?.sku || '',
    descripcion: it.description || '',
    cantidad: n(it.quantity),
    precioUnitario: n(it.unitPrice),
    dtoPct: n(it.discount),
    alicuota: n(it.taxRate),
    subtotal: n(it.subtotal),
  }))
  const payload = factura.colppyPayload as { items?: ItemPayload[] } | null | undefined
  const lineas = Array.isArray(payload?.items) ? payload!.items! : null
  if (!lineas || lineas.length <= base.length) return base
  const alicuotas = new Set(base.map((r) => r.alicuota))
  if (alicuotas.size !== 1) return base
  const alicuota = base[0].alicuota
  const separados: RenglonVentaLab[] = lineas.map((l) => {
    const cantidad = n(l.Cantidad)
    const precioUnitario = n(l.ImporteUnitario)
    const dtoPct = n(l.porcDesc)
    const subtotal =
      l.subtotal !== undefined && l.subtotal !== null
        ? n(l.subtotal)
        : Math.round(cantidad * precioUnitario * (1 - dtoPct / 100) * 100) / 100
    return { sku: skuPorItemColppy.get(n(l.idItem)) || '', descripcion: String(l.Descripcion ?? ''), cantidad, precioUnitario, dtoPct, alicuota, subtotal }
  })
  // Hasta un centavo de redondeo por renglón: si no cierra, el payload no es el de esta factura. Con la
  // cotización en precios con IVA, el InvoiceItem tiene el precio final y el payload el neto.
  const neto = centavos(separados), totalFactura = centavos(base), tolerancia = separados.length
  const conIva = Math.round(neto * (1 + alicuota / 100))
  if (Math.abs(neto - totalFactura) > tolerancia && Math.abs(conIva - totalFactura) > tolerancia) return base
  return separados
}

/** Ids de ítem de Colppy de los payloads que se van a separar (para buscar su SKU de una vez). */
export function itemsColppyAResolver(facturas: { items: unknown[]; colppyPayload?: unknown }[]): number[] {
  const ids = new Set<number>()
  for (const f of facturas) {
    const lineas = (f.colppyPayload as { items?: ItemPayload[] } | null | undefined)?.items
    if (Array.isArray(lineas) && lineas.length > f.items.length)
      for (const l of lineas) if (n(l.idItem) > 0) ids.add(n(l.idItem))
  }
  return [...ids]
}
