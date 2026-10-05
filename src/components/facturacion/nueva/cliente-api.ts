import { clienteDesdeApi, type ClienteFacturaDirecta } from '@/lib/facturacion/factura-directa-ui'

/** Ficha del cliente para la factura directa (GET /api/clientes/[id]) */
export async function cargarClienteFactura(id: string): Promise<ClienteFacturaDirecta> {
  const r = await fetch(`/api/clientes/${encodeURIComponent(id)}`)
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((d as { error?: string }).error || 'No se pudo cargar el cliente')
  const c = clienteDesdeApi(d)
  if (!c) throw new Error('Respuesta inválida al cargar el cliente')
  return c
}
