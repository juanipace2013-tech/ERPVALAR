/**
 * FASE 0 — Prueba de concepto en Colppy: cargar una factura de venta como
 * APROBADA no-electrónica (número real externo, sin labelfe) y verificar que
 * Colppy genera asiento, mueve stock y CC sin intentar emitirla contra ARCA.
 *
 * Es lo que va a hacer el ERP desde septiembre con las facturas emitidas por
 * ARCA (PV 7). Esta prueba usa un número de PV/número de prueba y un cliente
 * de prueba; DESPUÉS HAY QUE ANULARLA EN COLPPY.
 *
 *   npx tsx scripts/colppy-test-aprobada.ts --cuit 30715373579 --sku 2000-03 --pv 0007 --nro 99999001
 *   npx tsx scripts/colppy-test-aprobada.ts --cuit ... --sku ... --apply     (sin --apply es dry-run)
 *
 *   --cuit   CUIT del cliente de prueba en Colppy (debe existir)
 *   --sku    SKU de un artículo de inventario (para ver el movimiento de stock)
 *   --pv     sucursal (default 0007)
 *   --nro    número (default 99999001 para que no choque con la numeración real)
 *   --tipo   A | B (default A)
 *   --moneda ARS | USD (default ARS)
 *   --neto   neto gravado (default 1000); IVA 21% y total se derivan
 *   --tc     tipo de cambio si USD (default 1495)
 *   --clase  FACTURA | NC (default FACTURA) — NC = nota de credito Aprobada (idTipoComprobante 5)
 *   --almacen nombre del depósito en Colppy (default: env COLPPY_ALMACEN) — sin esto no mueve stock
 */
import 'dotenv/config'
import {
  colppyCreateInvoice,
  colppyFindCustomerByCUIT,
  getCachedColppySession,
  getColppyItemId,
  type ColppyInvoicePayload,
} from '@/lib/colppy'

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : def
}

async function main() {
  const cuit = arg('cuit')
  const sku = arg('sku')
  const pv = arg('pv', '0007')!
  const nro = arg('nro', '99999001')!
  const tipo = (arg('tipo', 'A') as 'A' | 'B')
  const moneda = arg('moneda', 'ARS')!
  const almacen = arg('almacen', process.env.COLPPY_ALMACEN || '')!
  const clase = (arg('clase', 'FACTURA') as 'FACTURA' | 'NC')
  const tc = arg('tc', '1495')!
  const apply = process.argv.includes('--apply')
  if (!cuit || !sku) {
    console.error('Faltan --cuit y/o --sku')
    process.exit(1)
  }

  const session = await getCachedColppySession()
  const customer = await colppyFindCustomerByCUIT(session, cuit)
  if (!customer) {
    console.error(`Cliente con CUIT ${cuit} no existe en Colppy`)
    process.exit(1)
  }
  const idItem = await getColppyItemId(session, sku)
  console.log(`Cliente: ${customer.idEntidad} (${cuit}) · Item ${sku} → idItem ${idItem}`)
  if (idItem === '0') console.warn('⚠ El SKU no está en el inventario de Colppy; no va a mover stock')

  const hoy = new Date()
  const fmt = (d: Date) => `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`
  const vto = new Date(hoy.getTime() + 30 * 86400000)

  const neto = Number(arg('neto', '1000'))
  const iva = Math.round(neto * 21) / 100
  const total = Math.round((neto + iva) * 100) / 100
  const payload: ColppyInvoicePayload = {
    descripcion: `PRUEBA ERP - ${clase === 'NC' ? 'NC' : 'factura'} externa Aprobada (ANULAR) - CAE 00000000000000`,
    idCliente: customer.idEntidad,
    puntoVenta: pv,
    fechaFactura: fmt(hoy),
    fechaVto: fmt(vto),
    tipoFactura: tipo,
    idCondicionPago: 'a 30 Dias',
    moneda: moneda === 'USD' ? 'Dolar estadounidense' : 'Peso argentino',
    tipoCambio: moneda === 'USD' ? tc : '1',
    currency: moneda,
    exchangeRate: moneda === 'USD' ? Number(tc) : null,
    netoGravado: neto,
    netoNoGravado: 0,
    totalIVA: iva,
    totalFactura: total,
    estado: 'Aprobada',
    claseComprobante: clase === 'NC' ? 'NOTA_CREDITO' : 'FACTURA',
    nroFactura1: pv,
    nroFactura2: nro.padStart(8, '0'),
    items: [
      {
        idItem: Number(idItem) || 0,
        minimo: '',
        tipoItem: 'P',
        codigo: sku,
        Descripcion: `PRUEBA ERP ${sku}`,
        ImporteUnitario: tipo === 'A' ? neto : total,
        subtotal: neto,
        IVA: 21,
        Cantidad: 1,
        unidadMedida: 'Un',
        Comentario: 'Prueba Fase 0 - anular',
        porcDesc: 0,
        idPlanCuenta: 'Ventas',
        ccosto1: '',
        ccosto2: '',
        almacen,
        editable: false,
      },
    ],
  }
  if (!almacen) console.warn('⚠ Sin --almacen (ni COLPPY_ALMACEN): Colppy no va a mover stock')

  console.log('\nPayload alta_facturaventa (Aprobada, sin labelfe):')
  console.log(JSON.stringify(payload, null, 2))

  if (!apply) {
    console.log('\nDRY-RUN: no se envió nada. Agregar --apply para crear la factura en Colppy.')
    return
  }

  const res = await colppyCreateInvoice(session, payload)
  console.log('\n✅ Colppy respondió:', res)
  console.log(`
Verificar en Colppy:
  1. Ventas → Facturas: ${pv}-${nro.padStart(8, '0')} en estado Aprobada (no Borrador, no "Esperando AFIP")
  2. Cliente ${cuit} → Cuenta corriente: debe aparecer el débito por ${total}
  3. Contabilidad → Asientos: asiento de la factura (Deudores por Ventas / Ventas / IVA DF)
  4. Inventario → ${sku}: salida de 1 unidad
DESPUÉS: anular la factura en Colppy (o NC) para no dejar rastro contable.
`)
}

main().catch((e) => {
  console.error('FALLO:', e?.message || e)
  process.exit(1)
})
