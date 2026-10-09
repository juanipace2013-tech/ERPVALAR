/**
 * Exportador de SÓLO LECTURA de Colppy para el laboratorio contable
 * (valarg-contabilidad): compras, pagos y cobros que el paralelo registra
 * a partir de Colppy. Acá no se da de alta, modifica ni borra nada: sólo
 * operaciones listar_* / leer_* de la API.
 *
 * Archivos generados (JSON) en --out:
 *   colppy-compras-<label>.json   facturas de compra del período (listar + leer, con renglones)
 *   colppy-diario-<label>.json    diario contable del período (pagos, cobros y sus aplicaciones)
 *   colppy-refs-<label>.json      facturas de venta y compra referenciadas por el diario
 *   colppy-items.json             idItem → código de inventario
 *   colppy-terceros.json          id de cliente/proveedor → razón social y CUIT
 *
 * Uso (en el VPS, que tiene las credenciales de Colppy):
 *   npx tsx scripts/export-colppy-lab.ts --mes 2026-10 --out /tmp/lab
 *   npx tsx scripts/export-colppy-lab.ts --desde 2026-10-01 --hasta 2026-10-05 --out /tmp/lab
 * Después: scp a data/erp-export/ del laboratorio, junto con export-contabilidad-lab.ts.
 */
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { callColppyAPI, colppyLogin, colppyLogout, getColppyConfig, md5Hash } from '../src/lib/colppy'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function rango(): { desde: string; hasta: string; label: string } {
  const mes = arg('mes')
  if (mes) {
    if (!/^\d{4}-\d{2}$/.test(mes)) throw new Error(`--mes inválido: ${mes}`)
    const [y, m] = mes.split('-').map(Number)
    const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate()
    return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, '0')}`, label: mes }
  }
  const desde = arg('desde'), hasta = arg('hasta')
  if (!desde || !hasta || !/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta))
    throw new Error('Indicar --mes AAAA-MM o --desde/--hasta AAAA-MM-DD')
  return { desde, hasta, label: `${desde}_${hasta}` }
}

async function main() {
  const { desde, hasta, label } = rango()
  const out = arg('out') || '/tmp/colppy-lab'
  mkdirSync(out, { recursive: true })
  const config = getColppyConfig()
  const session = await colppyLogin()
  const call = async (provision: string, operacion: string, parameters: Record<string, unknown>) => {
    if (!/^(listar|leer)_/.test(operacion)) throw new Error(`Operación no permitida (sólo lectura): ${operacion}`)
    const r = await callColppyAPI<any>({
      auth: { usuario: config.user, password: md5Hash(config.password) },
      service: { provision, operacion },
      parameters: { sesion: { usuario: session.usuario, claveSesion: session.claveSesion }, idEmpresa: session.idEmpresa, ...parameters },
    }, 120000, { throwOnEstadoError: false })
    if (r?.result?.estado !== 0) throw new Error(`${provision}/${operacion}: ${r?.result?.mensaje ?? 'error'}`)
    return r.response
  }
  const paginado = async (provision: string, operacion: string, extra: Record<string, unknown> = {}) => {
    const all: any[] = []
    for (let start = 0; ; start += 1000) {
      const r = await call(provision, operacion, { start, limit: 1000, ...extra })
      const data = r?.data ?? []
      all.push(...data)
      if (data.length < 1000) return all
    }
  }
  try {
    // Compras del período con sus renglones.
    const lista = await paginado('FacturaCompra', 'listar_facturasCompra', {
      filter: [{ field: 'fechaFactura', op: '>=', value: desde }, { field: 'fechaFactura', op: '<=', value: hasta }],
      order: { field: ['idFactura'], order: 'asc' },
    })
    const compras: any[] = []
    for (const f of lista) compras.push({ lista: f, detalle: await call('FacturaCompra', 'leer_facturacompra', { idFactura: f.idFactura }) })
    writeFileSync(join(out, `colppy-compras-${label}.json`), JSON.stringify(compras))

    // Diario del período: pagos (tabla 14), cobros (20) y lo que aplican.
    const diario: any[] = []
    for (let start = 0; ; start += 1000) {
      const r = await call('Contabilidad', 'listar_movimientosdiario', { fromDate: desde, toDate: hasta, start, limit: 1000 })
      const m = r?.movimientos ?? []
      diario.push(...m)
      if (m.length < 1000) break
    }
    writeFileSync(join(out, `colppy-diario-${label}.json`), JSON.stringify(diario))

    // Comprobantes referenciados: ventas del período (tabla 19) y facturas aplicadas por pagos/cobros.
    const ventas = new Set<string>(), comprasRef = new Set<string>()
    for (const m of diario) {
      if (m.idTabla === '19') ventas.add(m.idElemento)
      if (m.idTablaAplicado === '19') ventas.add(m.idElementoAplicado)
      if (m.idTablaAplicado === '8') comprasRef.add(m.idElementoAplicado)
    }
    const refs: any = { ventas: {}, compras: {} }
    // Con los renglones: una venta que no sale del ERP (Factura E de RCEL) se importa desde Colppy.
    for (const id of ventas) {
      const r = await call('FacturaVenta', 'leer_facturaventa', { idFactura: id })
      refs.ventas[id] = r?.infofactura ? { ...r.infofactura, itemsFactura: r.itemsFactura ?? [] } : null
    }
    for (const id of comprasRef) refs.compras[id] = (await call('FacturaCompra', 'leer_facturacompra', { idFactura: id }))?.infofactura ?? null
    writeFileSync(join(out, `colppy-refs-${label}.json`), JSON.stringify(refs))

    // Maestros: ítems de inventario y terceros.
    const items = (await paginado('Inventario', 'listar_itemsinventario', { order: { field: 'codigo', order: 'asc' } }))
      .map((i: any) => ({ id: String(i.idItem), codigo: String(i.codigo ?? '').trim(), descripcion: i.descripcion ?? '' }))
    writeFileSync(join(out, 'colppy-items.json'), JSON.stringify(items))
    const clientes = (await paginado('Cliente', 'listar_cliente', { order: [{ field: 'RazonSocial', dir: 'asc' }] }))
      .map((c: any) => ({ id: String(c.idCliente), razonSocial: c.RazonSocial ?? c.NombreFantasia ?? '', cuit: c.CUIT ?? '' }))
    const proveedores = (await paginado('Proveedor', 'listar_proveedor', { order: [{ field: 'RazonSocial', dir: 'asc' }] }))
      .map((p: any) => ({ id: String(p.idProveedor), razonSocial: p.RazonSocial ?? p.NombreFantasia ?? '', cuit: p.CUIT ?? '' }))
    writeFileSync(join(out, 'colppy-terceros.json'), JSON.stringify({ clientes, proveedores }))

    console.log(`Colppy ${desde} a ${hasta} → ${out}`)
    console.log(`  compras: ${compras.length} · diario: ${diario.length} movimientos · referencias: ${ventas.size} ventas, ${comprasRef.size} compras`)
    console.log(`  maestros: ${items.length} ítems, ${clientes.length} clientes, ${proveedores.length} proveedores`)
    console.log('Listo. Sólo lectura: no se modificó nada en Colppy.')
  } finally {
    await colppyLogout(session).catch(() => {})
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
