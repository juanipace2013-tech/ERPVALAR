import { describe, it, expect, vi } from 'vitest'

/**
 * Reconciliación de facturas directas inciertas o trabadas
 * (scripts/factura-directa-reconciliar.ts): qué número se consulta en ARCA,
 * cuándo se descarta, cuándo se autoriza y cuándo se deja para revisar a
 * mano; y de quién es el candado de la venta de ML. Sin red: ARCA y la DB
 * van inyectadas.
 */

import { candadoComparable, type ComprobanteArca } from '@/lib/mercadolibre/reconciliar-emitiendo'
import {
  candadoEsDeLaFila,
  cuitParaCandadoMl,
  decidirReconciliacionDirecta,
  type FilaAReconciliar,
  type InvoiceDelComprobante,
} from '@/lib/facturacion/factura-directa-reconciliacion'

const CUIT = '30711111111'

const comp = (numero: number, over: Partial<ComprobanteArca> = {}): ComprobanteArca => ({
  cbteTipo: 1,
  numero,
  ImpTotal: 1210,
  DocTipo: 80,
  DocNro: CUIT,
  CbteFch: '20261005',
  CodAutorizacion: `76000000000${numero}`,
  Resultado: 'A',
  ...over,
})

/** Factura directa A a CUIT por $1.210 del 5/10; el intento pidió la 0007-00000101 */
const fila = (over: Partial<FilaAReconciliar> = {}): FilaAReconciliar => ({
  id: 'FD1',
  letra: 'A',
  docTipo: 80,
  docNro: CUIT,
  total: 1210,
  fechaFactura: '2026-10-05',
  intento: { cbteTipo: 1, numero: 101 },
  ...over,
})

function arca(p: { ultimo: Record<number, number>; comprobantes: ComprobanteArca[]; erp?: Record<string, InvoiceDelComprobante> }) {
  return {
    ultimoAutorizado: vi.fn(async (tipo: number) => p.ultimo[tipo] ?? 0),
    consultar: vi.fn(async (tipo: number, numero: number) => p.comprobantes.find((c) => c.cbteTipo === tipo && c.numero === numero) ?? null),
    invoiceDelComprobante: vi.fn(async (tipo: number, numero: number) => p.erp?.[`${tipo}-${numero}`] ?? null),
  }
}

/** La 0007-00000100: factura de una cotización al mismo cliente por el mismo total (pedido recurrente) */
const DE_COTIZACION: InvoiceDelComprobante = { id: 'INV-Q', invoiceNumber: 'A-0007-00000100', facturaDirectaId: null }

describe('con el número del intento (incierta): solo se consulta ESE número', () => {
  it('ARCA no llegó al número pedido: DESCARTADA, aunque el anterior sea igual (misma factura de una cotización)', async () => {
    const d = arca({ ultimo: { 1: 100 }, comprobantes: [comp(100)], erp: { '1-100': DE_COTIZACION } })
    const r = await decidirReconciliacionDirecta(fila(), d)
    expect(r.accion).toBe('descartar')
    expect(r.detalle).toMatch(/no llegó a autorizar la Factura A N° 101 .*el último autorizado es el 100/)
    expect(d.consultar).not.toHaveBeenCalled()
  })

  it('el número pedido es de este receptor y total, y no es otra factura del ERP: AUTORIZADA con ese comprobante', async () => {
    const d = arca({ ultimo: { 1: 102 }, comprobantes: [comp(100), comp(101), comp(102, { DocNro: '30722222222' })], erp: { '1-100': DE_COTIZACION } })
    const r = await decidirReconciliacionDirecta(fila(), d)
    expect(r).toMatchObject({ accion: 'autorizar', comprobante: { numero: 101, CodAutorizacion: '76000000000101' } })
    expect(d.consultar.mock.calls).toEqual([[1, 101]])
  })

  it('el número pedido es de otro receptor o de otro total: ARCA no emitió esta (DESCARTADA)', async () => {
    for (const otro of [{ DocNro: '30722222222' }, { ImpTotal: 999 }]) {
      const r = await decidirReconciliacionDirecta(fila(), arca({ ultimo: { 1: 101 }, comprobantes: [comp(101, otro)] }))
      expect(r.accion).toBe('descartar')
      expect(r.detalle).toMatch(/es de otro receptor o total/)
    }
  })

  it('el número pedido ya es otra factura del ERP: DESCARTADA si es de otro receptor; si coincide todo, revisar a mano (nunca se pega a la ajena)', async () => {
    const ajena: InvoiceDelComprobante = { id: 'INV-X', invoiceNumber: 'A-0007-00000101', facturaDirectaId: 'FD-OTRA' }
    const otro = await decidirReconciliacionDirecta(fila(), arca({ ultimo: { 1: 101 }, comprobantes: [comp(101, { DocNro: '30722222222' })], erp: { '1-101': ajena } }))
    expect(otro.accion).toBe('descartar')
    expect(otro.detalle).toMatch(/es A-0007-00000101, de otro flujo/)

    const igual = await decidirReconciliacionDirecta(fila(), arca({ ultimo: { 1: 101 }, comprobantes: [comp(101)], erp: { '1-101': ajena } }))
    expect(igual).toMatchObject({ accion: 'revisar', candidatos: [{ numero: 101 }] })
    expect(igual.detalle).toMatch(/ya está registrada en el ERP como A-0007-00000101/)
  })

  it('consumidor final sin identificar (99): no se afirma nada aunque el total coincida', async () => {
    const f = fila({ letra: 'B', docTipo: 99, docNro: '0', intento: { cbteTipo: 6, numero: 40 } })
    const r = await decidirReconciliacionDirecta(f, arca({ ultimo: { 6: 40 }, comprobantes: [comp(40, { cbteTipo: 6, DocTipo: 99, DocNro: '0' })] }))
    expect(r).toMatchObject({ accion: 'revisar', candidatos: [{ numero: 40 }] })
  })

  it('ARCA no responde (o no devuelve el número): no se concluye nada', async () => {
    const caido = arca({ ultimo: {}, comprobantes: [] })
    caido.ultimoAutorizado.mockRejectedValueOnce(new Error('timeout'))
    expect(await decidirReconciliacionDirecta(fila(), caido)).toMatchObject({ accion: 'revisar', errores: ['FECompUltimoAutorizado: timeout'] })

    const sinDetalle = arca({ ultimo: { 1: 105 }, comprobantes: [] })
    expect((await decidirReconciliacionDirecta(fila(), sinDetalle)).accion).toBe('revisar')

    const consultaFalla = arca({ ultimo: { 1: 105 }, comprobantes: [] })
    consultaFalla.consultar.mockRejectedValueOnce(new Error('500'))
    expect(await decidirReconciliacionDirecta(fila(), consultaFalla)).toMatchObject({ accion: 'revisar', errores: ['FECompConsultar: 500'] })
  })
})

describe('sin número (trabada, o incierta sin número): se recorre ARCA para atrás', () => {
  const trabada = fila({ intento: null })

  it('un comprobante igual que ya es otra factura del ERP no cuenta: DESCARTADA', async () => {
    const d = arca({
      ultimo: { 1: 100, 201: 0 },
      comprobantes: [comp(100), comp(99, { CbteFch: '20261004' })],
      erp: { '1-100': DE_COTIZACION },
    })
    const r = await decidirReconciliacionDirecta(trabada, d)
    expect(r.accion).toBe('descartar')
    expect(r.detalle).toMatch(/1 ya registrados en el ERP por otro flujo/)
  })

  it('uno solo igual y sin registrar: AUTORIZADA; varios: revisar a mano', async () => {
    const uno = arca({ ultimo: { 1: 101, 201: 0 }, comprobantes: [comp(101), comp(100, { DocNro: '30722222222' }), comp(99, { CbteFch: '20261004' })] })
    expect(await decidirReconciliacionDirecta(trabada, uno)).toMatchObject({ accion: 'autorizar', comprobante: { numero: 101 } })

    const dos = arca({ ultimo: { 1: 101, 201: 0 }, comprobantes: [comp(101), comp(100), comp(99, { CbteFch: '20261004' })] })
    const r = await decidirReconciliacionDirecta(trabada, dos)
    expect(r).toMatchObject({ accion: 'revisar' })
    if (r.accion === 'revisar') expect(r.candidatos.map((c) => c.numero)).toEqual([101, 100])
  })

  it('una incierta sin número busca solo su tipo; con errores de ARCA no concluye', async () => {
    const d = arca({ ultimo: { 201: 3 }, comprobantes: [comp(3, { cbteTipo: 201, DocNro: '30722222222' }), comp(2, { cbteTipo: 201, CbteFch: '20261001' })] })
    const r = await decidirReconciliacionDirecta(fila({ intento: { cbteTipo: 201, numero: null } }), d)
    expect(r.accion).toBe('descartar')
    expect(d.ultimoAutorizado.mock.calls).toEqual([[201]])

    const conError = arca({ ultimo: { 1: 2, 201: 0 }, comprobantes: [comp(1, { CbteFch: '20261004' })] })
    conError.consultar.mockRejectedValueOnce(new Error('timeout'))
    expect((await decidirReconciliacionDirecta(trabada, conError)).accion).toBe('revisar')
  })
})

describe('candado de la venta de ML', () => {
  const t0 = new Date('2026-10-05T13:00:00Z')
  const seg = (s: number) => new Date(t0.getTime() + s * 1000)
  const filaMl = { estado: 'INCIERTA', createdAt: t0, updatedAt: seg(30), total: 1210, docNro: CUIT }
  const candado = { status: 'EMITIENDO', invoiceId: null, createdAt: seg(1), total: 1210, cuit: '30-71111111-1' }

  it('es de la fila: EMITIENDO sin factura, mismo documento y total, tomado entre la reserva y el INCIERTA', () => {
    expect(candadoEsDeLaFila(candado, filaMl)).toBe(true)
    // B a consumidor final con DNI: el candado guarda el DNI
    expect(candadoEsDeLaFila({ ...candado, cuit: '12345678' }, { ...filaMl, docNro: '12345678' })).toBe(true)
    // Trabada (EMITIENDO): el candado es posterior a la reserva
    expect(candadoEsDeLaFila({ ...candado, createdAt: seg(60) }, { ...filaMl, estado: 'EMITIENDO', updatedAt: t0 })).toBe(true)
  })

  it('no es de la fila (no se toca): otro documento, otro total, anterior a la fila, posterior al INCIERTA, EMITIDA o con factura', () => {
    expect(candadoEsDeLaFila({ ...candado, cuit: '20-12345678-6' }, filaMl)).toBe(false)
    expect(candadoEsDeLaFila({ ...candado, total: 1000 }, filaMl)).toBe(false)
    expect(candadoEsDeLaFila({ ...candado, total: null }, filaMl)).toBe(false)
    expect(candadoEsDeLaFila({ ...candado, createdAt: seg(-5) }, filaMl)).toBe(false)
    expect(candadoEsDeLaFila({ ...candado, createdAt: seg(120) }, filaMl)).toBe(false) // lo volvió a tomar el flujo de ML
    expect(candadoEsDeLaFila({ ...candado, status: 'EMITIDA' }, filaMl)).toBe(false)
    expect(candadoEsDeLaFila({ ...candado, invoiceId: 'INV9' }, filaMl)).toBe(false)
    expect(candadoEsDeLaFila(candado, { ...filaMl, docNro: null })).toBe(false)
  })

  it('documento del candado: CUIT/CUIL formateado, o el DNI / "0" tal cual', () => {
    expect(cuitParaCandadoMl({ docNro: CUIT })).toBe('30-71111111-1')
    expect(cuitParaCandadoMl({ docNro: '12345678' })).toBe('12345678')
    expect(cuitParaCandadoMl({ docNro: '0' })).toBe('0')
  })

  it('reconciliación de ML: un candado con DNI o "0" (factura directa B) no se puede comparar ni liberar', () => {
    expect(candadoComparable({ cuit: '30-71111111-1', total: 1210 })).toBe(true)
    expect(candadoComparable({ cuit: '20123456786', total: 1210 })).toBe(true)
    expect(candadoComparable({ cuit: '12345678', total: 1210 })).toBe(false)
    expect(candadoComparable({ cuit: '0', total: 1210 })).toBe(false)
    expect(candadoComparable({ cuit: null, total: 1210 })).toBe(false)
    expect(candadoComparable({ cuit: '30-71111111-1', total: null })).toBe(false)
  })
})
