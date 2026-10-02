/**
 * Verificación del id de Colppy que se pega a mano en una factura cargada a
 * mano en Colppy (Factura E en la v1): la factura leída con leer_facturaventa
 * tiene que ser la misma que la del ERP. Sin esto, un id mal tipeado queda
 * vinculado para siempre y el sync no ve nunca la factura real.
 */

/** idTipoFactura: leer_facturaventa devuelve la letra; el listado, el código */
const LETRA_POR_CODIGO: Record<string, string> = { '0': 'A', '1': 'B', '2': 'C', '3': 'E' }

export type VerificacionColppyManual = { ok: true; idCliente: string | null } | { ok: false; error: string }

export function verificarFacturaColppyManual(
  info: Record<string, unknown> | null,
  esperado: {
    colppyId: string
    pointOfSale: number | null
    cbteNumero: number | null
    total: number
    currency: string
    /** id de Colppy del cliente (el pegado o el que ya tiene en el ERP) */
    colppyClienteId?: string | null
  }
): VerificacionColppyManual {
  if (!info) return { ok: false, error: `No existe en Colppy una factura con id ${esperado.colppyId}: revisá el id` }

  const tipoRaw = String(info.idTipoFactura ?? '').trim().toUpperCase()
  const letra = LETRA_POR_CODIGO[tipoRaw] ?? tipoRaw
  const nro = String(info.nroFactura ?? '').trim()
  const [pvColppy, numColppy] = nro.split('-').map((x) => Number(x))
  const numeroErp =
    esperado.pointOfSale && esperado.cbteNumero
      ? `${String(esperado.pointOfSale).padStart(4, '0')}-${String(esperado.cbteNumero).padStart(8, '0')}`
      : null
  const ref = `La factura ${esperado.colppyId} de Colppy es ${letra || '?'} ${nro || '(sin número)'}`

  if (String(info.idTipoComprobante ?? '') !== '4') {
    return { ok: false, error: `${ref} y no es una factura de venta: revisá el id` }
  }
  if (letra !== 'E') return { ok: false, error: `${ref}, no una Factura E: revisá el id` }
  if (!numeroErp || pvColppy !== esperado.pointOfSale || numColppy !== esperado.cbteNumero) {
    return { ok: false, error: `${ref} y en el ERP es la ${numeroErp ?? '(sin número)'}: revisá el id o el número cargado en Colppy` }
  }
  if (/anulad/i.test(String(info.idEstadoFactura ?? ''))) {
    return { ok: false, error: `${ref} pero está ANULADA en Colppy: pegá el id de la que quedó vigente` }
  }

  const idCliente = String(info.idCliente ?? '').trim() || null
  if (esperado.colppyClienteId && idCliente && idCliente !== esperado.colppyClienteId) {
    return {
      ok: false,
      error: `${ref} pero está cargada al cliente ${idCliente} de Colppy y este cliente es el ${esperado.colppyClienteId}: revisá el cliente en Colppy`,
    }
  }

  // Total: solo comparable si se cargó en la misma moneda
  const monedaColppy = String(info.currencyIso ?? '').toUpperCase()
  const totalColppy = Number(info.totalFactura)
  if (monedaColppy && monedaColppy === esperado.currency.toUpperCase() && Number.isFinite(totalColppy)) {
    if (Math.abs(Math.abs(totalColppy) - esperado.total) > 0.05) {
      return {
        ok: false,
        error: `${ref} pero su total es ${monedaColppy} ${totalColppy.toFixed(2)} y en el ERP ${esperado.total.toFixed(2)}: revisá los importes en Colppy`,
      }
    }
  }
  return { ok: true, idCliente }
}
