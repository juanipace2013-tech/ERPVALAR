import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest'
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'

/**
 * Pantalla "Nueva factura": los componentes y la página se renderizan sin
 * romperse (renderToString, sin navegador) y muestran lo que corresponde en
 * cada estado (bloqueos, confirmaciones, reintento con la misma clave,
 * pantalla frenada). La lógica está probada en factura-directa-ui.test.ts.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams('') }))
const sesion = vi.hoisted(() => ({ role: 'ADMIN' }))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { role: sesion.role } }, status: 'authenticated' }) }))

// Nunca a la red (en el render del servidor los efectos no corren)
beforeAll(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      throw new Error(`Red bloqueada en tests: ${String(url)}`)
    })
  )
})
afterAll(() => vi.unstubAllGlobals())
afterEach(() => expect(globalThis.fetch).not.toHaveBeenCalled())

import NuevaFacturaPage from '@/app/(dashboard)/facturas/nueva/page'
import { ClienteFacturaPicker } from '@/components/facturacion/nueva/ClienteFacturaPicker'
import { CondicionesFactura } from '@/components/facturacion/nueva/CondicionesFactura'
import { LineasFacturaEditor } from '@/components/facturacion/nueva/LineasFacturaEditor'
import { ResumenEmision } from '@/components/facturacion/nueva/ResumenEmision'
import { VentaMlVinculo } from '@/components/facturacion/nueva/VentaMlVinculo'
import { EmisionBloqueadaDialog } from '@/components/facturacion/nueva/EmisionBloqueadaDialog'
import type { PreviewFacturaDirecta } from '@/lib/facturacion/factura-directa'
import { formInicial, lineaVacia, type ClienteFacturaDirecta } from '@/lib/facturacion/factura-directa-ui'
import { crearConfirmacion } from '@/lib/facturacion/factura-directa-form'

/** Texto visible (sin etiquetas ni los comentarios que React mete entre textos) */
const texto = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

const RI: ClienteFacturaDirecta = {
  id: 'c1',
  name: 'ACME',
  businessName: 'ACME SA',
  cuit: '30712345671',
  taxCondition: 'RESPONSABLE_INSCRIPTO',
  country: 'Argentina',
  status: 'ACTIVE',
  fceObligado: true,
  paymentTerms: 30,
}

const preview: PreviewFacturaDirecta = {
  ok: true,
  letra: 'A',
  cbteTipoPrevisto: 201,
  esFce: true,
  receptor: { docTipo: 80, docNro: '30712345671', condicionIvaId: 1 },
  totales: { neto: 100, iva: 21, total: 121, totalArs: 175450 },
  preciosConIva: false,
  condicionPago: 'a 30 Dias',
  fechaFactura: '2026-10-05',
  fechaVto: '2026-11-04',
  errores: [],
  avisos: [{ codigo: 'SALE_COMO_FCE', mensaje: 'Sale como FCE MiPyME A' }],
  confirmacionesRequeridas: [
    crearConfirmacion('EMISION_IRREVERSIBLE', 'Se emite en ARCA y no se puede borrar'),
    crearConfirmacion('TIPO_CAMBIO_ALEJADO', 'El tipo de cambio se aleja del BNA'),
  ],
  padron: { estado: 'encontrado', razonSocial: 'ACME SA', condicionIva: 'RESPONSABLE_INSCRIPTO', activo: true, observaciones: [], mensaje: null },
  ml: null,
  cliente: { id: 'c1', name: 'ACME', cuit: '30712345671', taxCondition: 'RESPONSABLE_INSCRIPTO', fceObligado: true, condicionPagoSugerida: 'a 30 Dias' },
  tipoCambioReferencia: { rate: 1450, fecha: '2026-10-03' },
}

const resumenHtml = (over: Partial<Parameters<typeof ResumenEmision>[0]> = {}) =>
  renderToString(
    h(ResumenEmision, {
      vista: { data: preview, firma: 'f', clave: 'k' },
      vigente: true,
      cargandoVista: false,
      vistaHabilitada: { puede: true, motivo: null },
      onVistaPrevia: () => {},
      tildadas: [],
      onTildar: () => {},
      emision: { puede: false, motivo: 'Falta confirmar 2 puntos' },
      onEmitir: () => {},
      emitiendo: false,
      error: null,
      reintento: null,
      onReintentar: () => {},
      onDescartarReintento: () => {},
      frenada: false,
      moneda: 'USD',
      ...over,
    })
  )

/** Los checkboxes de las confirmaciones (Radix: <button role="checkbox">) */
const checkboxes = (html: string) => html.match(/<button[^>]*role="checkbox"[^>]*>/g) ?? []

const resumen = (over: Partial<Parameters<typeof ResumenEmision>[0]> = {}) =>
  texto(
    renderToString(
      h(ResumenEmision, {
        vista: { data: preview, firma: 'f', clave: 'k' },
        vigente: true,
        cargandoVista: false,
        vistaHabilitada: { puede: true, motivo: null },
        onVistaPrevia: () => {},
        tildadas: [],
        onTildar: () => {},
        emision: { puede: false, motivo: 'Falta confirmar 2 puntos' },
        onEmitir: () => {},
        emitiendo: false,
        error: null,
        reintento: null,
        onReintentar: () => {},
        onDescartarReintento: () => {},
        frenada: false,
        moneda: 'USD',
        ...over,
      })
    )
  )

describe('página', () => {
  it('con rol de finanzas muestra el formulario', () => {
    sesion.role = 'CONTADOR'
    const t = texto(renderToString(h(NuevaFacturaPage)))
    expect(t).toContain('Nueva factura')
    expect(t).toContain('Nuevo cliente desde CUIT')
  })

  it('un vendedor no puede facturar sin cotización', () => {
    sesion.role = 'VENDEDOR'
    const t = texto(renderToString(h(NuevaFacturaPage)))
    expect(t).toContain('administración, gerencia o contaduría')
    expect(t).not.toContain('Nuevo cliente desde CUIT')
    sesion.role = 'ADMIN'
  })
})

describe('cliente', () => {
  it('letra, condición y FCE', () => {
    const t = texto(renderToString(h(ClienteFacturaPicker, { cliente: RI, onChange: () => {} })))
    expect(t).toContain('Factura A')
    expect(t).toContain('Responsable Inscripto')
    expect(t).toContain('FCE MiPyME')
  })

  it('un cliente del exterior se bloquea y lleva a la cotización', () => {
    const t = texto(renderToString(h(ClienteFacturaPicker, { cliente: { ...RI, taxCondition: 'CLIENTE_EXTERIOR', country: 'Chile', cuit: 'CL-761234567' }, onChange: () => {} })))
    expect(t).toContain('no se factura desde acá')
    expect(t).toContain('Factura E')
    expect(t).not.toContain('Factura A')
  })
})

describe('condiciones, líneas y venta de ML', () => {
  it('USD con el BNA de referencia y aviso si el TC se aleja; en la B pide el comprador', () => {
    const f = { ...formInicial('a'), moneda: 'USD' as const, tipoCambio: '2000' }
    const t = texto(renderToString(h(CondicionesFactura, { form: f, onCampo: () => {}, cliente: RI, letra: 'B', tcReferencia: { rate: 1450, fecha: '2026-10-03' }, cargandoTc: false, onRecargarTc: () => {} })))
    expect(t).toContain('03/10/2026')
    expect(t).toContain('Se aleja más de 3%')
    expect(t).toContain('Comprador en ARCA')
    const a = texto(renderToString(h(CondicionesFactura, { form: f, onCampo: () => {}, cliente: RI, letra: 'A', tcReferencia: null, cargandoTc: false, onRecargarTc: () => {} })))
    expect(a).not.toContain('Comprador en ARCA')
    expect(a).toContain('Se tipean precios netos')
  })

  it('líneas: errores por fila (las vacías solo después de pedir la vista previa) y subtotal', () => {
    const lineas = [{ ...lineaVacia('a'), productId: 'p', sku: 'GEN-1', descripcion: 'Válvula', cantidad: '2', precio: '1.000,50' }, lineaVacia('b')]
    const errores = [{ codigo: 'DESCRIPCION_INVALIDA', mensaje: 'Línea 2: falta la descripción', linea: 2 }]
    const props = { lineas, onChange: () => {}, preciosFinales: false, moneda: 'ARS' as const, errores, nuevoUid: () => 'z' }
    const antes = texto(renderToString(h(LineasFacturaEditor, { ...props, mostrarErroresEnBlanco: false })))
    expect(antes).toContain('GEN-1')
    expect(antes).toContain('$2.001,00')
    expect(antes).not.toContain('falta la descripción')
    expect(texto(renderToString(h(LineasFacturaEditor, { ...props, mostrarErroresEnBlanco: true })))).toContain('Línea 2: falta la descripción')
  })

  it('la venta de ML solo en pesos', () => {
    expect(texto(renderToString(h(VentaMlVinculo, { mlVenta: '2000001', onMlVenta: () => {}, moneda: 'ARS', onPrecargar: () => {} })))).toContain('Buscar')
    expect(texto(renderToString(h(VentaMlVinculo, { mlVenta: '2000001', onMlVenta: () => {}, moneda: 'USD', onPrecargar: () => {} })))).toContain('solo se vincula a una factura en pesos')
  })
})

describe('vista previa y emisión', () => {
  it('muestra el comprobante, el receptor, los totales en USD y las confirmaciones', () => {
    const t = resumen()
    expect(t).toContain('FCE MiPyME A')
    expect(t).toContain('CUIT 30712345671')
    expect(t).toContain('USD 121,00')
    expect(t).toContain('$175.450,00')
    expect(t).toContain('Se emite en ARCA y no se puede borrar')
    expect(t).toContain('El tipo de cambio se aleja del BNA')
    expect(t).toContain('Falta confirmar 2 puntos')
  })

  it('desactualizada: no muestra la vista previa vieja', () => {
    const t = resumen({ vigente: false })
    expect(t).toContain('desactualizada')
    expect(t).not.toContain('Se emite en ARCA y no se puede borrar')
  })

  it('reintento con la misma clave', () => {
    const t = resumen({ reintento: { titulo: 'Se cortó la conexión mientras se emitía', mensaje: 'Reintentar es seguro' } })
    expect(t).toContain('Reintentar (misma clave)')
    expect(t).toContain('Volver a editar')
  })

  it('con un reintento pendiente las confirmaciones no se pueden destildar (el reintento manda las ya enviadas)', () => {
    const tildadas = preview.confirmacionesRequeridas.map((c) => c.firma)
    const libres = checkboxes(resumenHtml({ tildadas }))
    expect(libres).toHaveLength(2)
    expect(libres.every((c) => !/\sdisabled=""/.test(c))).toBe(true)
    expect(libres.every((c) => c.includes('aria-checked="true"'))).toBe(true)
    const trabadas = checkboxes(resumenHtml({ tildadas, reintento: { titulo: 'Se cortó la conexión', mensaje: 'Reintentar es seguro' } }))
    expect(trabadas).toHaveLength(2)
    expect(trabadas.every((c) => /\sdisabled=""/.test(c))).toBe(true)
  })

  it('frenada después de un resultado bloqueante', () => {
    expect(resumen({ frenada: true })).toContain('no se emite más desde esta pantalla')
  })

  it('error a corregir', () => {
    expect(resumen({ error: { titulo: 'ARCA rechazó la factura', problemas: [{ codigo: 'ARCA 10192', mensaje: 'obligado a FCE' }] } })).toContain('obligado a FCE')
  })

  it('el diálogo bloqueante muestra número y CAE y dice que no se reintente', () => {
    // Radix monta el diálogo en un portal: en el render del servidor no hay DOM, solo se controla que no rompa
    expect(() =>
      renderToString(h(EmisionBloqueadaDialog, { bloqueo: { tipo: 'HUERFANA', mensaje: 'm', numero: '0007-00000001', cae: '7612', facturaDirectaId: 'fd1' }, onEntendido: () => {} }))
    ).not.toThrow()
  })
})
