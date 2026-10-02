/**
 * Facturas que el ERP NO registra solo en Colppy: se cargan a mano y después
 * se vincula su id (colppySyncStatus 'MANUAL'; en la v1, la Factura E de
 * exportación). Liviano a propósito: lo usan la emisión de la E, el PATCH
 * /api/facturas/[id]/colppy-id y el sync diario de Colppy.
 */

export const COLPPY_SYNC_MANUAL = 'MANUAL'

/** Texto de la nota de la Invoice mientras falta cargarla en Colppy */
export const MARCA_COLPPY_MANUAL = 'PENDIENTE de cargar a mano en Colppy.'

/**
 * Nota de la Invoice una vez vinculada con la factura cargada a mano en
 * Colppy: reemplaza la marca de pendiente (o agrega la línea si no estaba).
 */
export function notaCargadaEnColppy(notes: string | null | undefined, colppyId: string): string {
  const cargada = `Cargada a mano en Colppy (${colppyId}).`
  const n = notes ?? ''
  return n.includes(MARCA_COLPPY_MANUAL) ? n.replace(MARCA_COLPPY_MANUAL, cargada) : `${n} ${cargada}`.trim()
}
