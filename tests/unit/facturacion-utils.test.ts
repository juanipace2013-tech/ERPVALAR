import { describe, it, expect } from 'vitest'
import { classifyQuote, getFarthestDelivery, getNextDeliveryTranche, isItemInStock, parseDeliveryDays } from '@/lib/facturacion-utils'

const item = (deliveryTime: string | null, isAlternative = false) => ({ deliveryTime, isAlternative })

describe('parseDeliveryDays', () => {
  it('inmediato / vacío = 0 días', () => {
    expect(parseDeliveryDays(null)).toBe(0)
    expect(parseDeliveryDays('')).toBe(0)
    expect(parseDeliveryDays('Inmediato')).toBe(0)
    expect(parseDeliveryDays(' STOCK ')).toBe(0)
  })
  it('parsea días simples, con tilde y hábiles', () => {
    expect(parseDeliveryDays('7 dias')).toBe(7)
    expect(parseDeliveryDays('15 días')).toBe(15)
    expect(parseDeliveryDays('30 días hábiles')).toBe(30)
  })
  it('en rangos toma el mayor', () => {
    expect(parseDeliveryDays('7-10 días')).toBe(10)
    expect(parseDeliveryDays('7 a 10 días')).toBe(10)
  })
  it('texto no parseable devuelve null', () => {
    expect(parseDeliveryDays('A confirmar')).toBeNull()
    expect(parseDeliveryDays('Consultar')).toBeNull()
  })
})

describe('classifyQuote', () => {
  it('ready cuando todos los ítems principales están en stock', () => {
    expect(classifyQuote([item('Inmediato'), item(null), item('30 días', true)])).toBe('ready')
  })
  it('partial con mezcla, pending sin stock, pending sin ítems principales', () => {
    expect(classifyQuote([item('Inmediato'), item('15 días')])).toBe('partial')
    expect(classifyQuote([item('15 días'), item('30 días')])).toBe('pending')
    expect(classifyQuote([item('Inmediato', true)])).toBe('pending')
  })
  it('isItemInStock acepta inmediato/inmediata/stock', () => {
    expect(isItemInStock('Inmediata')).toBe(true)
    expect(isItemInStock('7 días')).toBe(false)
  })
})

describe('getFarthestDelivery', () => {
  it('devuelve el plazo mayor ignorando alternativos', () => {
    expect(getFarthestDelivery([item('7 días'), item('15-20 días'), item('60 días', true)])).toBe('20 días')
  })
  it('todo inmediato → Inmediato; solo no parseable → A confirmar', () => {
    expect(getFarthestDelivery([item(null), item('Inmediato')])).toBe('Inmediato')
    expect(getFarthestDelivery([item('Consultar')])).toBe('A confirmar')
  })
  it('un plazo numérico gana sobre un no parseable', () => {
    expect(getFarthestDelivery([item('Consultar'), item('10 días')])).toBe('10 días')
  })
})

describe('getNextDeliveryTranche', () => {
  // Cronograma tipo EBINOX OC P09724: 5 tramos, 160 un. totales
  const cronograma = [
    { fecha: '2026-12-18T12:00:00.000Z', cantidad: 72 },
    { fecha: '2027-02-15T12:00:00.000Z', cantidad: 24 },
    { fecha: '2027-04-30T12:00:00.000Z', cantidad: 24 },
    { fecha: '2027-07-13T12:00:00.000Z', cantidad: 24 },
    { fecha: '2027-09-25T12:00:00.000Z', cantidad: 16 },
  ]

  it('sin facturar apunta al primer tramo', () => {
    const next = getNextDeliveryTranche(cronograma, 0)
    expect(next?.fecha).toBe('2026-12-18T12:00:00.000Z')
    expect(next?.cantidad).toBe(72)
    expect(next?.cantidadAcumulada).toBe(72)
    // 10 días antes, preservando las 12:00 UTC de la fecha civil
    expect(next?.facturarDesde).toBe('2026-12-08T12:00:00.000Z')
  })

  it('facturado el primer tramo completo avanza al segundo', () => {
    const next = getNextDeliveryTranche(cronograma, 72)
    expect(next?.fecha).toBe('2027-02-15T12:00:00.000Z')
    expect(next?.cantidadAcumulada).toBe(96)
  })

  it('facturación parcial de un tramo sigue apuntando a ese tramo', () => {
    const next = getNextDeliveryTranche(cronograma, 50)
    expect(next?.fecha).toBe('2026-12-18T12:00:00.000Z')
  })

  it('todo facturado devuelve null', () => {
    expect(getNextDeliveryTranche(cronograma, 160)).toBeNull()
    expect(getNextDeliveryTranche(cronograma, 200)).toBeNull()
  })

  it('cronograma vacío devuelve null', () => {
    expect(getNextDeliveryTranche([], 0)).toBeNull()
  })

  it('ordena tramos aunque vengan desordenados', () => {
    const desordenado = [cronograma[2], cronograma[0], cronograma[1]]
    const next = getNextDeliveryTranche(desordenado, 0)
    expect(next?.fecha).toBe('2026-12-18T12:00:00.000Z')
  })
})
