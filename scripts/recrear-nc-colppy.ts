/**
 * Recrea en Colppy una NC emitida por el ERP (ARCA) que se borró en Colppy,
 * con el mismo número/CAE, su moneda y tipo de cambio, imputada a su factura
 * (ItemsCobro, como "Emitir NC" de Colppy). Caso de uso: la NC en USD se editó
 * en la pantalla de Colppy, que le borra la moneda, y hubo que borrarla.
 *
 *   npx tsx scripts/recrear-nc-colppy.ts NCA-0007-00000001          (simulación)
 *   npx tsx scripts/recrear-nc-colppy.ts NCA-0007-00000001 --apply  (alta real)
 *
 * Antes de dar de alta verifica que la NC ya no exista en Colppy (por id y
 * por número), y después que la factura quede con el saldo esperado.
 */
import { prisma } from '@/lib/prisma'
import {
  callColppyAPI,
  colppyCreateInvoice,
  colppyLeerFacturaVenta,
  getCachedColppySession,
  getColppyConfig,
  md5Hash,
  type ColppyInvoicePayload,
} from '@/lib/colppy'
import { armarImputacionNc } from '@/lib/facturacion/imputacion-nc'

const numero = process.argv[2]
const apply = process.argv.includes('--apply')

async function listarPorNumero(nroFactura: string, idCliente: string) {
  const session = await getCachedColppySession()
  const config = getColppyConfig()
  const r = await callColppyAPI<any>({
    auth: { usuario: config.user, password: md5Hash(config.password) },
    service: { provision: 'FacturaVenta', operacion: 'listar_facturasventa' },
    parameters: {
      sesion: { usuario: session.usuario, claveSesion: session.claveSesion },
      idEmpresa: session.idEmpresa,
      start: 0,
      limit: 20,
      filter: [
        { field: 'nroFactura', op: '=', value: nroFactura },
        { field: 'idCliente', op: '=', value: idCliente },
      ],
      order: { field: ['idFactura'], order: 'desc' },
    },
  } as any)
  return (r?.response?.data ?? []) as any[]
}

async function main() {
  if (!numero) throw new Error('Uso: npx tsx scripts/recrear-nc-colppy.ts <numero NC del ERP> [--apply]')
  const nc = await prisma.invoice.findFirst({
    where: { invoiceNumber: numero, transactionType: 'CREDIT_NOTE', emitidaPor: 'ARCA' },
    select: {
      id: true, invoiceNumber: true, total: true, currency: true, exchangeRate: true, colppyId: true, colppyPayload: true,
      relatedInvoice: { select: { invoiceNumber: true, colppyId: true } },
    },
  })
  if (!nc) throw new Error(`No existe la NC ${numero} en el ERP`)
  const payload = nc.colppyPayload as ColppyInvoicePayload | null
  if (!payload) throw new Error('La NC no tiene colppyPayload')
  if (payload.mipyme) throw new Error('NC FCE: se carga como borrador, no usar este script')
  if (!nc.relatedInvoice?.colppyId) throw new Error('La factura no tiene colppyId')
  const session = await getCachedColppySession()

  // 1. La NC no tiene que existir más en Colppy
  if (nc.colppyId) {
    const vieja = await colppyLeerFacturaVenta(session, nc.colppyId)
    if (vieja && vieja.idFactura) throw new Error(`La NC sigue existiendo en Colppy (id ${nc.colppyId}): borrala primero`)
  }
  const nroColppy = `${payload.nroFactura1}-${payload.nroFactura2}`
  const mismas = (await listarPorNumero(nroColppy, payload.idCliente)).filter((x) => String(x.idTipoComprobante) === '5')
  if (mismas.length) throw new Error(`Ya hay una NC ${nroColppy} del cliente en Colppy: ${JSON.stringify(mismas.map((x) => x.idFactura))}`)

  // 2. Imputación a la factura
  const info = await colppyLeerFacturaVenta(session, nc.relatedInvoice.colppyId)
  if (!info) throw new Error('No se pudo leer la factura en Colppy')
  const esUsd = nc.currency === 'USD'
  const imputacion = armarImputacionNc(info, {
    total: Number(nc.total),
    moneda: esUsd ? 'USD' : 'ARS',
    tipoCambio: esUsd ? Number(nc.exchangeRate) : 1,
  })
  if (!imputacion) throw new Error(`No corresponde imputar (saldo de la factura: ${info.saldoaaplicar})`)
  const nuevo: ColppyInvoicePayload = { ...payload, itemsCobro: [imputacion.item], idCondicionPago: 'Contado' }
  console.log('Factura en Colppy:', JSON.stringify({ id: info.idFactura, nro: info.nroFactura, total: info.totalFactura, moneda: info.currencyIso, rate: info.rate, saldo: info.saldoaaplicar }))
  console.log('NC a dar de alta:', JSON.stringify({
    nro: nroColppy, estado: nuevo.estado, clase: nuevo.claseComprobante, moneda: nuevo.currency, tc: nuevo.exchangeRate,
    neto: nuevo.netoGravado, iva: nuevo.totalIVA, total: nuevo.totalFactura,
    items: nuevo.items.map((i) => ({ codigo: i.codigo, idItem: i.idItem, cant: i.Cantidad, pu: i.ImporteUnitario })),
  }))
  console.log('ItemsCobro:', JSON.stringify(nuevo.itemsCobro), '→ saldo esperado de la factura:', imputacion.saldoEsperadoArs)
  if (!apply) {
    console.log('\nSIMULACIÓN: no se dio de alta nada. Correr con --apply.')
    return
  }

  // 3. Alta + verificación
  const res = await colppyCreateInvoice(session, nuevo)
  console.log('Alta OK:', JSON.stringify(res))
  const despues = await colppyLeerFacturaVenta(session, nc.relatedInvoice.colppyId)
  const saldo = Number(despues?.saldoaaplicar)
  const ok = Math.abs(saldo - imputacion.saldoEsperadoArs) <= 1
  console.log(`Saldo de la factura después: ${saldo} (esperado ${imputacion.saldoEsperadoArs}) → ${ok ? 'IMPUTADA OK' : 'NO COINCIDE'}`)
  const lista = await listarPorNumero(nroColppy, payload.idCliente)
  console.log('NC en Colppy:', JSON.stringify(lista.map((x) => ({ id: x.idFactura, tipo: x.idTipoComprobante, total: x.totalFactura, aplicado: x.totalaplicado, cur: x.idCurrency, rate: x.rate }))))
  await prisma.invoice.update({
    where: { id: nc.id },
    data: { colppyId: res.idFactura, colppySyncStatus: 'OK', colppySyncError: null },
  })
  console.log(`ERP: ${nc.invoiceNumber} ahora apunta a colppyId ${res.idFactura}`)
}

main()
  .catch((e) => {
    console.error('ERROR:', (e as Error).message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
