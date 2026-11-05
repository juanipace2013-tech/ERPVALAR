/**
 * Pedido de certificado de calidad al proveedor, armado desde un remito con
 * "Solicita certificado de calidad". Replica el mail que Caro le manda a mano
 * a GENEBRE (Maxi):
 *
 *   Asunto: "Certificado de Calidad: <RAZÓN SOCIAL DEL CLIENTE>.-"
 *   Texto:  CODIGO / CANTIDAD / NUMERO DE LOTE por ítem + NUMERO DE ORDEN DE COMPRA
 *
 * Queda como borrador en el buzón de administración (mismo que el borrador de
 * factura) para que lo revisen y lo envíen desde Outlook.
 */
import { getGraphToken } from '@/lib/inbox/graph-mail'
import { buzonBorradores, FIRMA } from '@/lib/email/borrador-factura'

const G = 'https://graph.microsoft.com/v1.0'
const VENTAS = 'ventas@val-ar.com.ar'

/** A quién se le pide el certificado, por marca del producto */
export const CONTACTOS_PROVEEDOR: Record<string, { email: string; nombre?: string }> = {
  GENEBRE: { email: 'gandur@genebre.com.ar', nombre: 'Maxi' },
}

export interface ItemCertificado {
  codigo: string
  cantidad: number
  lote: string | null
  marca: string
}

export interface ItemRemitoRaw {
  sku: string | null
  quantity: number | string | { toString(): string }
  batchNumber: string | null
  product: { sku: string; brand: string | null } | null
}

export function marcaDe(item: Pick<ItemRemitoRaw, 'product'>): string {
  return item.product?.brand?.trim().toUpperCase() || 'SIN MARCA'
}

export function aItemCertificado(i: ItemRemitoRaw): ItemCertificado {
  return {
    codigo: (i.product?.sku || i.sku || '').trim(),
    cantidad: Number(i.quantity.toString()),
    lote: i.batchNumber?.trim() || null,
    marca: marcaDe(i),
  }
}

/** Ítems agrupados por marca: un pedido por proveedor */
export function agruparPorMarca(items: ItemCertificado[]): Map<string, ItemCertificado[]> {
  const m = new Map<string, ItemCertificado[]>()
  for (const it of items) {
    if (!m.has(it.marca)) m.set(it.marca, [])
    m.get(it.marca)!.push(it)
  }
  return m
}

export function asuntoPedido(cliente: string): string {
  const c = cliente.trim().replace(/[.\-\s]+$/, '')
  return `Certificado de Calidad: ${c.toUpperCase()}.-`
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fmtCant = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString('es-AR'))

function saludo(ahora: Date): string {
  const hora = Number(
    new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: 'numeric', hour12: false }).format(ahora)
  )
  return hora < 13 ? 'buen día' : 'buenas tardes'
}

export function cuerpoPedido(
  d: { contacto?: string; items: ItemCertificado[]; ordenCompra?: string | null },
  ahora = new Date()
): string {
  const s = saludo(ahora)
  const inicio = d.contacto
    ? `${esc(d.contacto)}, ${s}. Espero que te encuentres bien.`
    : `${s[0].toUpperCase()}${s.slice(1)}. Espero que se encuentren bien.`
  const items = d.items
    .map(
      (it) => `<p style="margin:0 0 12px 0">
<b><u style="background:#FFFF00">CODIGO</u></b><span style="background:#FFFF00">: ${esc(it.codigo)}</span><br>
<b><u>CANTIDAD</u></b>: ${fmtCant(it.cantidad)}<br>
<b><u>NUMERO DE LOTE:</u></b> ${esc(it.lote ?? '')}
</p>`
    )
    .join('\n')
  const oc = d.ordenCompra?.trim()
    ? `<p><b><u>NUMERO DE ORDEN DE COMPRA</u></b>: ${esc(d.ordenCompra.trim())}</p>`
    : ''
  return `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt">
<p>${inicio}</p>
<p>Cuando sea posible, por favor, solicito el Certificado de Calidad del siguiente material:</p>
${items}
${oc}
<p><br></p>
<p>Aguardo,<br>Muchas gracias.</p>
<p><br></p>
${FIRMA}
</div>`
}

export async function crearBorradorPedido(p: {
  para: string
  asunto: string
  html: string
}): Promise<{ draftId: string; webLink: string }> {
  const buzon = buzonBorradores()
  const token = await getGraphToken()
  const res = await fetch(`${G}/users/${buzon}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject: p.asunto,
      body: { contentType: 'HTML', content: p.html },
      toRecipients: [{ emailAddress: { address: p.para } }],
      ccRecipients: [{ emailAddress: { address: VENTAS } }],
    }),
  })
  if (!res.ok) {
    const det = (await res.text().catch(() => '')).slice(0, 300)
    throw new Error(`Graph ${res.status}: ${det}`)
  }
  const j = (await res.json()) as { id: string; webLink: string }
  return { draftId: j.id, webLink: j.webLink }
}
