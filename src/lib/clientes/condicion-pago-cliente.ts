/**
 * Condición de pago del cliente. Manda el ERP (Customer.paymentTerms, en días):
 * se edita en la ficha del cliente y es la que se usa al facturar. La de
 * Colppy solo se toma mientras el ERP no tenga ninguna cargada (null).
 */

/** Plazos que acepta Colppy como condición de pago (días; 0 = Contado). */
export const PLAZOS_PAGO_DIAS = [0, 7, 15, 30, 45, 60, 90, 120] as const

export function esPlazoPago(dias: unknown): dias is (typeof PLAZOS_PAGO_DIAS)[number] {
  return typeof dias === 'number' && (PLAZOS_PAGO_DIAS as readonly number[]).includes(dias)
}

/** "Contado" o "a 30 Días". */
export function etiquetaCondicionPago(dias: number | null | undefined): string {
  const d = Number(dias)
  return Number.isFinite(d) && d > 0 ? `a ${d} Días` : 'Contado'
}

/**
 * Condición a mostrar/usar: la del ERP si está cargada (0 = Contado cuenta
 * como cargada); si no, la de Colppy.
 */
export function condicionPagoCliente(
  diasErp: number | null | undefined,
  colppy: { paymentTerms: string; paymentTermsDays: number }
): { paymentTerms: string; paymentTermsDays: number } {
  if (diasErp === null || diasErp === undefined) return colppy
  const dias = Number(diasErp)
  if (!Number.isFinite(dias) || dias < 0) return colppy
  return { paymentTerms: etiquetaCondicionPago(dias), paymentTermsDays: dias }
}
