import { describe, it, expect } from 'vitest'
import { parseBNABilletesHTML } from '@/lib/bna'

// Recorte real de la respuesta del cotizador histórico del BNA (16/9/2026)
const HTML_BNA = `
<div id="cotizacionesCercanas">
    <table class="table cotizacion">
                <thead>
                    <tr>
                        <th>Monedas</th>
                        <th>Compra</th>
                        <th>Venta</th>
                        <th>Fecha</th>
                    </tr>
                </thead>
                <tbody>
                            <tr>
                                <td>Dolar U.S.A</td>
                                <td class="dest">1480,0000</td>
                                <td class="dest">1530,0000</td>
                                <td>14/9/2026</td>
                            </tr>
                            <tr>
                                <td>Dolar U.S.A</td>
                                <td class="dest">1480,0000</td>
                                <td class="dest">1530,0000</td>
                                <td>15/9/2026</td>
                            </tr>
                            <tr>
                                <td>Dolar U.S.A</td>
                                <td class="dest">1485,0000</td>
                                <td class="dest">1535,0000</td>
                                <td>16/9/2026</td>
                            </tr>
                </tbody>
    </table>
</div>`

describe('parseBNABilletesHTML', () => {
  it('extrae compra, venta y fecha de cada fila Dolar U.S.A', () => {
    const filas = parseBNABilletesHTML(HTML_BNA)
    expect(filas).toHaveLength(3)
    expect(filas[1]).toEqual({
      fecha: new Date(Date.UTC(2026, 8, 15)),
      compra: 1480,
      venta: 1530,
    })
    expect(filas[2].venta).toBe(1535)
  })

  it('tolera separador de miles y devuelve vacío si no hay filas', () => {
    const conMiles = HTML_BNA.replace(/1480,0000/g, '1.480,0000')
    expect(parseBNABilletesHTML(conMiles)[0].compra).toBe(1480)
    expect(parseBNABilletesHTML('<html><body>sin tabla</body></html>')).toEqual([])
  })
})
