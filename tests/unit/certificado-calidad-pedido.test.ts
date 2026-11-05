import { describe, it, expect } from 'vitest'
import { aItemCertificado, agruparPorMarca, asuntoPedido, cuerpoPedido } from '@/lib/certificados-calidad/pedido'

const item = (sku: string, brand: string | null, quantity: string, lote: string | null) =>
  aItemCertificado({ sku: null, quantity, batchNumber: lote, product: { sku, brand } })

describe('pedido de certificado de calidad', () => {
  it('asunto como lo escribe Caro', () => {
    expect(asuntoPedido('Morixe Hermanos Sociedad Anonima Comercial e Industrial')).toBe(
      'Certificado de Calidad: MORIXE HERMANOS SOCIEDAD ANONIMA COMERCIAL E INDUSTRIAL.-'
    )
    expect(asuntoPedido('ACME S.A.')).toBe('Certificado de Calidad: ACME S.A.-')
  })

  it('ítem: código del producto, cantidad sin decimales, marca en mayúsculas', () => {
    expect(item('3318 05', 'Genebre', '2.00', ' 2025 030284 ')).toEqual({
      codigo: '3318 05', cantidad: 2, lote: '2025 030284', marca: 'GENEBRE',
    })
    expect(item('X', null, '1', '').marca).toBe('SIN MARCA')
    expect(item('X', null, '1', '').lote).toBeNull()
  })

  it('agrupa por marca para hacer un pedido por proveedor', () => {
    const g = agruparPorMarca([item('A', 'GENEBRE', '1', 'l'), item('B', 'WINTERS', '1', 'l'), item('C', 'genebre', '3', 'l')])
    expect([...g.keys()]).toEqual(['GENEBRE', 'WINTERS'])
    expect(g.get('GENEBRE')!.map((i) => i.codigo)).toEqual(['A', 'C'])
  })

  it('cuerpo con código, cantidad, lote y OC', () => {
    const html = cuerpoPedido(
      { contacto: 'Maxi', items: [item('3318 05', 'GENEBRE', '2', '2025 030284')], ordenCompra: '4500019014' },
      new Date('2026-11-05T13:00:00Z') // 10 hs AR
    )
    expect(html).toContain('Maxi, buen día. Espero que te encuentres bien.')
    expect(html).toContain(': 3318 05')
    expect(html).toContain('</u></b>: 2<br>')
    expect(html).toContain('NUMERO DE LOTE:</u></b> 2025 030284')
    expect(html).toContain('NUMERO DE ORDEN DE COMPRA</u></b>: 4500019014')
  })

  it('sin contacto conocido ni OC', () => {
    const html = cuerpoPedido({ items: [item('A', 'X', '1', 'L')] }, new Date('2026-11-05T19:00:00Z'))
    expect(html).toContain('Buenas tardes. Espero que se encuentren bien.')
    expect(html).not.toContain('ORDEN DE COMPRA')
  })
})
