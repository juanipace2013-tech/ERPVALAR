import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Archivo de la Factura E en SharePoint: misma carpeta del mes y nombre
 * "Factura E 0010-0000000N CLIENTE.pdf". Graph y el armado de datos son
 * falsos (sin red ni base); el PDF y el nombre son los reales.
 */

const mocks = vi.hoisted(() => ({ buildFacturaPdfData: vi.fn(), getGraphToken: vi.fn() }))
vi.mock('@/lib/facturacion/factura-pdf-data', () => ({ buildFacturaPdfData: mocks.buildFacturaPdfData }))
vi.mock('@/lib/inbox/graph-mail', () => ({ getGraphToken: mocks.getGraphToken }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { archivarFacturaEnSharePoint } from '@/lib/sharepoint/facturas-emitidas'
import type { FacturaPDFData } from '@/lib/pdf/factura-generator'

/** Datos de PRUEBA (RUT, domicilio, DES del manual, TC) */
const facturaE: FacturaPDFData = {
  letra: 'E',
  cbteTipo: 19,
  clase: 'FACTURA',
  puntoVenta: 10,
  numero: 1,
  fecha: new Date('2026-10-05T13:00:00Z'),
  cae: '76543210987654',
  caeVencimiento: new Date('2026-10-15T15:00:00Z'),
  qrUrl: '',
  moneda: 'USD',
  cotizacion: 1450.5,
  condicionVenta: 'Transferencia anticipada 100%',
  receptor: {
    nombre: 'CLAUGER CHILE SPA',
    docTipoLabel: 'RUT',
    docNro: '76.123.456-7',
    condicionIva: 'IVA Exento - Operación de Exportación',
    domicilio: 'Av. Ejemplo 1234, Santiago, Chile',
  },
  items: [{ codigo: '2228 12', descripcion: 'Válvula', cantidad: 3, precioUnitario: 692.96, subtotal: 2078.88, alicuotaIva: 0 }],
  totales: { netoGravado: 0, netoNoGravado: 0, exento: 2078.88, iva: [], otrosTributos: 0, total: 2078.88 },
  exportacion: {
    destino: 'CHILE',
    cuitPais: '55000000034',
    cuitPaisDetalle: 'CHILE - Persona Jurídica',
    divisa: 'USD - Dólar Estadounidense',
    incoterm: 'CPT',
    incotermLugar: 'Santiago',
    tipoCambioArca: 1450.5,
    exportaSimple: { desNumero: '2133ECSI12', fobDesUSD: 2078.88, fobFacturaUSD: 2078.88 },
  },
}

const envOriginal = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SHAREPOINT_FACTURAS_SITE_ID = 'sitio-de-prueba'
  delete process.env.SHAREPOINT_FACTURAS_FOLDER
  mocks.buildFacturaPdfData.mockResolvedValue(facturaE)
  mocks.getGraphToken.mockResolvedValue('token-de-prueba')
})

afterEach(() => {
  process.env = { ...envOriginal }
  vi.unstubAllGlobals()
})

describe('SharePoint: archivo de la Factura E', () => {
  it('se sube a la carpeta del mes con el nombre "Factura E 0010-00000001 CLIENTE.pdf" sin pisar', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    const r = await archivarFacturaEnSharePoint('inv-e1')

    expect(r).toEqual({
      ok: true,
      path: 'Facturas Emitidas/VAL ARG S.R.L/10 2026/Factura E 0010-00000001 CLAUGER CHILE SPA.pdf',
      yaExistia: false,
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(
      'https://graph.microsoft.com/v1.0/sites/sitio-de-prueba/drive/root:/' +
        'Facturas%20Emitidas/VAL%20ARG%20S.R.L/10%202026/Factura%20E%200010-00000001%20CLAUGER%20CHILE%20SPA.pdf' +
        ':/content?@microsoft.graph.conflictBehavior=fail'
    )
    expect(init.method).toBe('PUT')
    // El cuerpo es el PDF real de la E
    expect(Buffer.from(init.body as Uint8Array).subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('si ya existe (409) no la pisa', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 409 })))
    const r = await archivarFacturaEnSharePoint('inv-e1')
    expect(r).toEqual(expect.objectContaining({ ok: true, yaExistia: true }))
  })
})
