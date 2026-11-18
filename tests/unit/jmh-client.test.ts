import { describe, it, expect } from 'vitest'
import { parseJmhCombinationInfo, parseJmhShopListing } from '@/lib/jmh/client'

// Recorte real de get_combination_info de tienda.jmh.com.ar (18/11/2026)
const INFO = {
  jsonrpc: '2.0',
  id: null,
  result: {
    product_id: 12671,
    product_template_id: 14243,
    display_name: '90Ø114 R 1/2" NPT 10 Bar/Psi',
    list_price: 130.5,
    price: 130.5,
    allow_out_of_stock_order: true,
    free_qty: 15.0,
    show_availability: true,
    is_storable: true,
    product_tracking_info: { item_id: 12671, currency: 'USD', price: 130.5 },
  },
}

describe('parseJmhCombinationInfo', () => {
  it('lee cantidad disponible y precio de lista en USD', () => {
    expect(parseJmhCombinationInfo(INFO)).toEqual({ stock: 15, precioListaUsd: 130.5, aPedido: true })
  })

  it('sin existencias devuelve 0, no null', () => {
    const r = parseJmhCombinationInfo({ result: { ...INFO.result, free_qty: 0 } })
    expect(r?.stock).toBe(0)
  })

  it('si la tienda no publica stock del artículo devuelve null', () => {
    expect(parseJmhCombinationInfo({ result: { ...INFO.result, is_storable: false } })?.stock).toBeNull()
    expect(parseJmhCombinationInfo({ result: { ...INFO.result, show_availability: false } })?.stock).toBeNull()
  })

  it('no informa precio si la moneda no es USD o viene en 0', () => {
    const pesos = { ...INFO.result, product_tracking_info: { currency: 'ARS' } }
    expect(parseJmhCombinationInfo({ result: pesos })?.precioListaUsd).toBeNull()
    expect(parseJmhCombinationInfo({ result: { ...INFO.result, list_price: 0 } })?.precioListaUsd).toBeNull()
  })

  it('respuesta de error o inesperada devuelve null', () => {
    expect(parseJmhCombinationInfo({ error: { message: 'Odoo Server Error' } })).toBeNull()
    expect(parseJmhCombinationInfo(null)).toBeNull()
    expect(parseJmhCombinationInfo({ result: {} })).toBeNull()
  })
})

describe('parseJmhShopListing', () => {
  const HTML = `
    <img src="/web/image/product.template/14253/image_512/%5BMN90114RF0060D%5D%2090%C3%98114%20R%201-2%22%20NPT%2060%20Bar-Psi?unique=20dbe96" />
    <img src="/web/image/product.template/14253/image_512/%5BMN90114RF0060D%5D%2090%C3%98114%20R%201-2%22%20NPT%2060%20Bar-Psi?unique=20dbe96" />
    <img src="/web/image/product.template/14235/image_512/74%C3%98100%20R%201-2%22NPT%200-160%20kpa-psi?unique=1" />
    <img src="/web/image/product.template/14412/image_512/%5Bsl05020062%5D%20Capilar?unique=2" />
  `
  it('saca templateId y código, sin repetir y salteando los que no tienen código', () => {
    expect(parseJmhShopListing(HTML)).toEqual([
      { templateId: 14253, codigo: 'MN90114RF0060D', nombre: '90Ø114 R 1-2" NPT 60 Bar-Psi' },
      { templateId: 14412, codigo: 'SL05020062', nombre: 'Capilar' },
    ])
  })
})
