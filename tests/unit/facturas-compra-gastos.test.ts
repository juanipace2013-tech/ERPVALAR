import { describe, it, expect, vi, beforeEach } from 'vitest'

// Facturas de compra de gastos (seguros, gastos bancarios...): líneas con
// cuenta de Colppy, sin artículo ni stock.

const createMock = vi.fn()
vi.mock('@/lib/prisma', () => ({
  prisma: {
    purchaseInvoice: { create: (...a: unknown[]) => createMock(...a), findUnique: vi.fn() },
    product: { findMany: vi.fn(async () => []) },
    purchaseInvoiceItem: { update: vi.fn() },
  },
}))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/purchase-invoices/learned-links', () => ({ findLearnedLinks: vi.fn(async () => new Map()) }))

import { CUENTAS_COLPPY, CUENTAS_GASTO, CUENTAS_GASTO_FRECUENTES, cuentaGasto, cuentasGastoOrdenadas } from '@/lib/compras/cuentas-colppy'
import { createPurchaseInvoice, PurchaseInvoiceInputError, type CreatePurchaseInvoiceInput } from '@/lib/purchase-invoices/create'

describe('cuentas de gasto de Colppy', () => {
  it('trae la cuenta de la captura real (Visuar → "Gastos Galpon") y las de seguros y bancos', () => {
    expect(cuentaGasto('Gastos Galpon')?.codigo).toBe('521120')
    expect(cuentaGasto('Seguros')?.codigo).toBe('521108')
    expect(cuentaGasto('Gastos Bancarios')?.codigo).toBe('521113')
  })

  it('el nombre tiene que ser exacto, como en Colppy (con espacios finales incluidos)', () => {
    expect(cuentaGasto('Fletes y Transporte ')).not.toBeNull()
    expect(cuentaGasto('Fletes y Transporte')).toBeNull()
    expect(cuentaGasto('seguros')).toBeNull()
    expect(cuentaGasto('')).toBeNull()
    expect(cuentaGasto(null)).toBeNull()
  })

  it('Mercaderías no es una cuenta de gasto (es la línea de artículo de siempre)', () => {
    expect(CUENTAS_COLPPY.some((c) => c.codigo === '115100')).toBe(true)
    expect(CUENTAS_GASTO.some((c) => c.codigo === '115100')).toBe(false)
    expect(cuentaGasto('Mercaderías')).toBeNull()
  })

  it('las frecuentes existen todas y van primero; no hay códigos ni nombres repetidos', () => {
    const { frecuentes, resto } = cuentasGastoOrdenadas()
    expect(frecuentes.map((c) => c.nombre)).toEqual(CUENTAS_GASTO_FRECUENTES)
    expect(frecuentes.length + resto.length).toBe(CUENTAS_GASTO.length)
    expect(new Set(CUENTAS_COLPPY.map((c) => c.codigo)).size).toBe(CUENTAS_COLPPY.length)
    expect(new Set(CUENTAS_COLPPY.map((c) => c.nombre)).size).toBe(CUENTAS_COLPPY.length)
  })
})

describe('alta de factura de compra con líneas de gasto', () => {
  const base: CreatePurchaseInvoiceInput = {
    supplierId: 'sup1',
    voucherType: 'A',
    invoiceDate: '2026-10-26',
    dueDate: '2026-10-26',
    pointOfSale: '00031',
    invoiceNumberSuffix: '00346507',
    items: [],
  }

  beforeEach(() => {
    createMock.mockReset()
    createMock.mockImplementation(async (args: { data: { items: { create: unknown[] } } }) => ({ id: 'fc1', supplierId: 'sup1', items: [], _data: args.data }))
  })

  it('la línea de gasto guarda la cuenta y nunca un artículo; la de mercadería queda como siempre', async () => {
    await createPurchaseInvoice(
      {
        ...base,
        items: [
          { description: 'SAMSUNG ANAFE A GAS', quantity: 1, listPrice: 505040.5, taxRate: 21, colppyAccount: 'Gastos Galpon', productId: 'prod-x' },
          { description: 'VALVULA ESFERICA', quantity: 2, listPrice: 1000, taxRate: 21, productId: 'prod-y' },
        ],
      },
      'user1'
    )
    const items = createMock.mock.calls[0][0].data.items.create as Array<{ productId: string | null; colppyAccount: string | null }>
    expect(items[0]).toMatchObject({ productId: null, colppyAccount: 'Gastos Galpon' })
    expect(items[1]).toMatchObject({ productId: 'prod-y', colppyAccount: null })
  })

  it('frena una cuenta que no está en Colppy antes de guardar nada', async () => {
    await expect(
      createPurchaseInvoice({ ...base, items: [{ description: 'Póliza', quantity: 1, listPrice: 100, taxRate: 21, colppyAccount: 'Seguro del auto' }] }, 'user1')
    ).rejects.toThrow(PurchaseInvoiceInputError)
    expect(createMock).not.toHaveBeenCalled()
  })
})
