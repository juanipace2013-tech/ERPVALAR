import { describe, it, expect } from 'vitest'
import { condicionPagoCliente, etiquetaCondicionPago, esPlazoPago } from '@/lib/clientes/condicion-pago-cliente'

describe('condición de pago del cliente: manda el ERP', () => {
  const colppy = { paymentTerms: 'Contado', paymentTermsDays: 0 }

  it('usa la del ERP cuando está cargada', () => {
    expect(condicionPagoCliente(30, colppy)).toEqual({ paymentTerms: 'a 30 Días', paymentTermsDays: 30 })
  })

  it('Contado cargado en el ERP (0) le gana a un plazo de Colppy', () => {
    expect(condicionPagoCliente(0, { paymentTerms: 'a 60 Días', paymentTermsDays: 60 })).toEqual({
      paymentTerms: 'Contado',
      paymentTermsDays: 0,
    })
  })

  it('sin condición en el ERP queda la de Colppy', () => {
    const deColppy = { paymentTerms: 'a 45 Días', paymentTermsDays: 45 }
    expect(condicionPagoCliente(null, deColppy)).toBe(deColppy)
    expect(condicionPagoCliente(undefined, deColppy)).toBe(deColppy)
  })

  it('etiquetas y plazos válidos', () => {
    expect(etiquetaCondicionPago(0)).toBe('Contado')
    expect(etiquetaCondicionPago(null)).toBe('Contado')
    expect(etiquetaCondicionPago(15)).toBe('a 15 Días')
    expect(esPlazoPago(30)).toBe(true)
    expect(esPlazoPago(0)).toBe(true)
    expect(esPlazoPago(20)).toBe(false)
    expect(esPlazoPago('30')).toBe(false)
  })
})
