import { describe, it, expect, vi } from 'vitest'

/**
 * Factura E: cálculos y validaciones del diálogo (factura-exportacion-form.ts).
 * El diálogo repite reglas del servidor para avisar antes de emitir: estos
 * tests comparan sus resultados con las funciones del servidor (centavos, DES,
 * ítems, forma del pedido y validación completa del Cmp) para que no se
 * desalineen. Sin red ni base.
 *
 * Datos de PRUEBA: el caso Chile (3 × 2228 12 a USD 692,96 = 2.078,88), el
 * N° de DES del ejemplo del manual y un flete de USD 120 inventado (el flete
 * real todavía no se conoce).
 */

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/sharepoint/facturas-emitidas', () => ({ archivarFacturaEnSharePointBg: vi.fn() }))
vi.mock('@/lib/comisiones/liquidacion', () => ({ sincronizarComisionesDeQuote: vi.fn() }))

import {
  DES_REGEX,
  aCentavos,
  normalizarDes,
  validarExportacion,
  type ExportacionInput,
} from '@/lib/arca/emitir-exportacion'
import { INCOTERMS_EXPORTA_SIMPLE, INCOTERMS_SIN_FLETE, receptorExportacion } from '@/lib/arca/fex-params'
import {
  armarItemsExportacion,
  parsePedidoFacturaExportacion,
  type QuoteItemExportable,
} from '@/lib/facturacion/factura-exportacion'
import {
  DES_REGEX_FORM,
  armarPedidoFacturaE,
  calcularFacturaE,
  centavos,
  formatearFechaArca,
  indentarXml,
  normalizarDesForm,
  textoErrorArca,
  validarFormularioFacturaE,
  type FilaItemFacturaE,
  type FormFacturaE,
} from '@/lib/facturacion/factura-exportacion-form'

// Lo que manda el GET de prellenado
const INCOTERMS = INCOTERMS_EXPORTA_SIMPLE.map((codigo) => ({ codigo, sinFlete: INCOTERMS_SIN_FLETE.includes(codigo) }))

const QUOTE_ITEMS: QuoteItemExportable[] = [
  {
    id: 'qi-1',
    itemNumber: 1,
    productId: 'p-1',
    description: 'Válvula esférica GENEBRE 2228 12',
    manualSku: null,
    product: { sku: '2228 12', name: 'Válvula esférica 2228 12' },
    additionals: [],
    quantity: 3,
    unitPrice: 692.96,
    cantidadPendiente: 3,
  },
  {
    id: 'qi-2',
    itemNumber: 2,
    productId: 'p-2',
    description: 'Actuador neumático',
    manualSku: null,
    product: { sku: 'ACT-1', name: 'Actuador' },
    additionals: [],
    quantity: 2,
    unitPrice: 100.1,
    cantidadPendiente: 2,
  },
]

function fila(qi: QuoteItemExportable, extra: Partial<FilaItemFacturaE> = {}): FilaItemFacturaE {
  return {
    quoteItemId: qi.id,
    itemNumber: qi.itemNumber,
    codigo: qi.product?.sku ?? null,
    descripcionOriginal: qi.description ?? '',
    descripcion: qi.description ?? '',
    cantidadCotizada: qi.quantity,
    cantidadPendiente: qi.cantidadPendiente,
    cantidad: String(qi.cantidadPendiente),
    precioOriginal: qi.unitPrice,
    precio: String(qi.unitPrice),
    descuentoPct: 0,
    incluido: true,
    ...extra,
  }
}

function formChile(extra: Partial<FormFacturaE> = {}): FormFacturaE {
  return {
    filas: [fila(QUOTE_ITEMS[0]), fila(QUOTE_ITEMS[1], { incluido: false })],
    manuales: [],
    desNumero: '2133ECSI12',
    fob: '2078,88',
    incoterm: 'CPT',
    incotermLugar: 'Santiago',
    formaPago: 'Transferencia bancaria',
    obsComerciales: '',
    cancelaEnMonedaExtranjera: true,
    ...extra,
  }
}

const AHORA = new Date('2026-10-02T15:00:00Z') // 12:00 AR

/** Lo mismo que hace preparar() en el servidor con el pedido del diálogo */
function inputServidor(form: FormFacturaE, bonificacionPct = 0): { input: ExportacionInput | null; errores: string[] } {
  const { pedido, errores } = parsePedidoFacturaExportacion(JSON.parse(JSON.stringify(armarPedidoFacturaE(form))))
  if (!pedido) return { input: null, errores }
  const arm = armarItemsExportacion(QUOTE_ITEMS, pedido, bonificacionPct)
  if (arm.errores.length) return { input: null, errores: arm.errores }
  const rec = receptorExportacion({
    name: 'CLAUGER CHILE SPA',
    type: 'BUSINESS',
    taxCondition: 'CLIENTE_EXTERIOR',
    country: 'Chile',
    address: 'Av. Prueba 1234',
    city: 'Santiago',
    taxIdExterior: '76.123.456-7',
  })
  const input: ExportacionInput = {
    clase: 'FACTURA',
    regimen: 'EXPORTA_SIMPLE',
    tipoExpo: 1,
    puntoVenta: 10,
    moneda: 'USD',
    cotizacion: 1385.5,
    cancelaEnMonedaExtranjera: pedido.cancelaEnMonedaExtranjera !== false,
    receptor: rec.receptor!,
    items: arm.items,
    formaPago: pedido.formaPago,
    incoterm: pedido.incoterm,
    incotermLugar: pedido.incotermLugar,
    idioma: 1,
    obsComerciales: pedido.obsComerciales,
    exportaSimple: { desNumero: pedido.desNumero ?? '', fobUSD: Number(pedido.fobUSD) },
  }
  return { input, errores: validarExportacion(input, { ahora: AHORA }) }
}

describe('Factura E: reglas del diálogo alineadas con el servidor', () => {
  it('centavos() redondea igual que aCentavos()', () => {
    for (const n of [0, 0.005, 1.005, 2.675, 692.96 * 3, 100.1 * 2, 1234.5678, 2078.875, 0.1 + 0.2, 999999.995]) {
      expect(centavos(n)).toBe(aCentavos(n))
    }
  })

  it('normalización y formato del DES iguales a los del servidor', () => {
    expect(DES_REGEX_FORM.source).toBe(DES_REGEX.source)
    for (const raw of [' 2133 ecsi12 ', '2133ECSI12', 'abc', '26001EC01000123A', '12345678', '1234-5678']) {
      expect(normalizarDesForm(raw)).toBe(normalizarDes(raw))
      expect(DES_REGEX_FORM.test(normalizarDesForm(raw))).toBe(DES_REGEX.test(normalizarDes(raw)))
    }
  })

  it('totales en centavos iguales a armarItemsExportacion (con bonificación y flete manual)', () => {
    const form = formChile({
      filas: [fila(QUOTE_ITEMS[0], { descuentoPct: 7.5 }), fila(QUOTE_ITEMS[1], { cantidad: '1', descuentoPct: 7.5 })],
      manuales: [{ descripcion: 'Flete internacional', importe: '120' }],
    })
    const calc = calcularFacturaE(form.filas, form.manuales)
    const { pedido } = parsePedidoFacturaExportacion(JSON.parse(JSON.stringify(armarPedidoFacturaE(form))))
    const arm = armarItemsExportacion(QUOTE_ITEMS, pedido!, 7.5)
    expect(arm.errores).toEqual([])
    const mercaderia = arm.lineas.filter((l) => !l.manual).reduce((s, l) => s + Math.round(l.subtotal * 100), 0) / 100
    const manual = arm.lineas.filter((l) => l.manual).reduce((s, l) => s + Math.round(l.subtotal * 100), 0) / 100
    expect(calc.mercaderiaUSD).toBe(mercaderia)
    expect(calc.manualUSD).toBe(manual)
    expect(calc.manualUSD).toBe(120)
    expect(calc.totalUSD).toBe(Math.round((mercaderia + manual) * 100) / 100)
    expect(calc.filas.map((f) => f.subtotalUSD)).toEqual(arm.lineas.filter((l) => !l.manual).map((l) => l.subtotal))
  })

  it('el pedido que arma el diálogo pasa el control de forma del POST y la validación completa del Cmp', () => {
    const r = inputServidor(formChile())
    expect(r.errores).toEqual([])
    expect(r.input?.exportaSimple).toEqual({ desNumero: '2133ECSI12', fobUSD: 2078.88 })
  })

  it('con flete manual (CPT) también pasa la validación del servidor: total = FOB + flete', () => {
    const r = inputServidor(formChile({ manuales: [{ descripcion: 'Flete internacional', importe: '120,00' }] }))
    expect(r.errores).toEqual([])
    expect(r.input?.items.filter((i) => i.manual)).toHaveLength(1)
  })
})

describe('Factura E: validación previa del diálogo', () => {
  it('caso Chile sin flete (todavía no se conoce): sin errores y con aviso de CPT sin línea de flete', () => {
    const v = validarFormularioFacturaE(formChile(), INCOTERMS)
    expect(v.errores).toEqual([])
    expect(v.calculo.mercaderiaUSD).toBe(2078.88)
    expect(v.calculo.totalUSD).toBe(2078.88)
    expect(v.diferenciaFobUSD).toBe(0)
    expect(v.avisos.join(' ')).toContain('Con CPT el flete lo pagamos nosotros')
  })

  it('FOB del DES distinto de la mercadería: error con la diferencia', () => {
    const v = validarFormularioFacturaE(formChile({ fob: '2078.80' }), INCOTERMS)
    expect(v.diferenciaFobUSD).toBe(-0.08)
    expect(v.errores.join(' ')).toContain('no coincide con la mercadería facturada')
    // y el servidor también lo rechaza
    expect(inputServidor(formChile({ fob: '2078.80' })).errores.length).toBeGreaterThan(0)
  })

  it('FCA con línea de flete: error (el flete lo paga el cliente)', () => {
    const form = formChile({ incoterm: 'FCA', manuales: [{ descripcion: 'Flete internacional', importe: '120' }] })
    const v = validarFormularioFacturaE(form, INCOTERMS)
    expect(v.errores.join(' ')).toContain('Con FCA el flete lo paga el cliente')
    expect(inputServidor(form).errores.length).toBeGreaterThan(0)
  })

  it('cantidad mayor a lo pendiente, precio inválido y ningún ítem elegido', () => {
    expect(
      validarFormularioFacturaE(formChile({ filas: [fila(QUOTE_ITEMS[0], { cantidad: '4' })] }), INCOTERMS).errores.join(' ')
    ).toContain('Máximo 3')
    expect(
      validarFormularioFacturaE(formChile({ filas: [fila(QUOTE_ITEMS[0], { precio: '0' })] }), INCOTERMS).errores.join(' ')
    ).toContain('precio tiene que ser mayor a cero')
    expect(
      validarFormularioFacturaE(formChile({ filas: [fila(QUOTE_ITEMS[0], { incluido: false })] }), INCOTERMS).errores
    ).toContain('Elegí al menos un ítem de la cotización')
  })

  it('DES, forma de pago, lugar del Incoterm y línea manual inválidos', () => {
    const v = validarFormularioFacturaE(
      formChile({
        desNumero: '12-34',
        formaPago: '',
        incotermLugar: 'Santiago de Chile, Región Metropolitana',
        manuales: [{ descripcion: '', importe: 'abc' }],
      }),
      INCOTERMS
    )
    const t = v.errores.join(' | ')
    expect(t).toContain('N° de DES')
    expect(t).toContain('Falta la forma de pago')
    expect(t).toContain('lugar del Incoterm admite hasta 20')
    expect(t).toContain('Línea manual 1: Falta la descripción')
  })

  it('precio cambiado respecto de la cotización: aviso, no error', () => {
    const v = validarFormularioFacturaE(formChile({ filas: [fila(QUOTE_ITEMS[0], { precio: '700' })], fob: '2100' }), INCOTERMS)
    expect(v.errores).toEqual([])
    expect(v.avisos.join(' ')).toContain('precio distinto al de la cotización')
  })

  it('el pedido manda la descripción solo si se cambió, las líneas manuales con cantidad 1 y el DES normalizado', () => {
    const p = armarPedidoFacturaE(
      formChile({
        desNumero: ' 2133 ecsi12 ',
        filas: [fila(QUOTE_ITEMS[0]), fila(QUOTE_ITEMS[1], { descripcion: 'Actuador neumático doble efecto', cantidad: '1' })],
        manuales: [{ descripcion: ' Flete internacional ', importe: '1.234,50' }],
      }),
      { cotizacionEsperada: 1385.5, dryRun: true }
    )
    expect(p.items[0]).toEqual({ quoteItemId: 'qi-1', cantidad: 3, precioUnitario: 692.96 })
    expect(p.items[1]).toEqual({ quoteItemId: 'qi-2', cantidad: 1, precioUnitario: 100.1, descripcion: 'Actuador neumático doble efecto' })
    expect(p.lineasManuales).toEqual([{ descripcion: 'Flete internacional', cantidad: 1, precioUnitario: 1234.5 }])
    expect(p.desNumero).toBe('2133ECSI12')
    expect(p.fobUSD).toBe(2078.88)
    expect(p.cotizacionEsperada).toBe(1385.5)
    expect(p.dryRun).toBe(true)
    expect(p.obsComerciales).toBeUndefined()
    // La emisión manda dryRun: false explícito (el servidor no emite si falta)
    expect(armarPedidoFacturaE(formChile()).dryRun).toBe(false)
  })
})

describe('Factura E: presentación', () => {
  it('formatearFechaArca acepta YYYY-MM-DD y yyyymmdd', () => {
    expect(formatearFechaArca('2026-10-01')).toBe('01/10/2026')
    expect(formatearFechaArca('20261001')).toBe('01/10/2026')
    expect(formatearFechaArca('otra')).toBe('otra')
  })

  it('indentarXml indenta por nivel sin perder contenido', () => {
    const xml = '<?xml version="1.0"?><a><b>1</b><c><d x="1"/><e>2</e></c></a>'
    const out = indentarXml(xml)
    expect(out).toBe(['<?xml version="1.0"?>', '<a>', '  <b>1</b>', '  <c>', '    <d x="1"/>', '    <e>2</e>', '  </c>', '</a>'].join('\n'))
    expect(out.replace(/\n\s*/g, '')).toBe(xml)
  })

  it('textoErrorArca muestra código y mensaje', () => {
    expect(textoErrorArca({ Code: 2060, Msg: 'DES inexistente' })).toBe('2060: DES inexistente')
    expect(textoErrorArca('texto')).toBe('texto')
  })
})
