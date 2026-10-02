/**
 * Factura E (exportación): cálculos y validaciones del diálogo
 * (src/components/quotes/FacturaExportacionDialog.tsx).
 *
 * Repite en el navegador las reglas de armarItemsExportacion y buildFexRequest
 * para avisar ANTES de emitir; el servidor sigue siendo la autoridad y vuelve
 * a validar todo. Este módulo lo usa un componente 'use client': no importa
 * nada de servidor (Prisma, ARCA). De factura-exportacion.ts solo toma TIPOS,
 * que se borran al compilar. Las reglas duplicadas (centavos, DES) tienen un
 * test que las compara con las del servidor.
 */
import type { PedidoFacturaExportacion } from '@/lib/facturacion/factura-exportacion'
import { parseNumeroAr } from '@/lib/facturacion/nc-unidades'

/** = MAX_LINEAS_MANUALES del servicio */
export const MAX_LINEAS_MANUALES_FORM = 5
export const MAX_FORMA_PAGO = 50
export const MAX_INCOTERM_LUGAR = 20
export const MAX_OBS_COMERCIALES = 4000
/** Descripción propuesta para la línea manual */
export const DESCRIPCION_FLETE_DEFAULT = 'Flete internacional'

/** = DES_REGEX de emitir-exportacion.ts (laxo: el manual dice 11 y el ejemplo oficial tiene 10) */
export const DES_REGEX_FORM = /^[0-9A-Z]{8,11}$/

/** = normalizarDes: sin espacios y en mayúsculas */
export function normalizarDesForm(raw: string | null | undefined): string {
  return (raw ?? '').toUpperCase().replace(/\s+/g, '')
}

/** USD → centavos enteros con redondeo half-up (= aCentavos de emitir-exportacion.ts). */
export function centavos(n: number): number {
  if (!Number.isFinite(n)) return NaN
  const [ent, dec = ''] = Math.abs(n).toFixed(8).split('.')
  const c = Number(ent) * 100 + Number(dec.slice(0, 2)) + (Number(dec.slice(2)) >= 500000 ? 1 : 0)
  return n < 0 ? -c : c
}

export function hastaDosDecimales(n: number): boolean {
  return Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6
}

/** Importe o cantidad tipeados en formato argentino ("2.078,88") o con punto decimal ("2078.88"). Vacío → NaN. */
export function parseMontoForm(s: string): number {
  return parseNumeroAr(s)
}

// ---------------------------------------------------------------------------
// Estado del formulario
// ---------------------------------------------------------------------------

/** Ítem pendiente de la cotización en el diálogo */
export interface FilaItemFacturaE {
  quoteItemId: string
  itemNumber: number
  codigo: string | null
  /** La que propone el servidor (descripción + adicionales) */
  descripcionOriginal: string
  descripcion: string
  cantidadCotizada: number
  cantidadPendiente: number
  /** Texto tipeado */
  cantidad: string
  /** USD sin IVA de la cotización */
  precioOriginal: number
  /** Texto tipeado (USD) */
  precio: string
  /** Bonificación de la cotización (%): va como MONTO en el Item */
  descuentoPct: number
  incluido: boolean
}

/** Línea agregada a mano (flete internacional, seguro): no comisiona ni integra el FOB */
export interface LineaManualFacturaE {
  descripcion: string
  /** Texto tipeado (USD) */
  importe: string
}

export interface FormFacturaE {
  filas: FilaItemFacturaE[]
  manuales: LineaManualFacturaE[]
  desNumero: string
  /** FOB del DES tipeado (USD) */
  fob: string
  incoterm: string
  incotermLugar: string
  formaPago: string
  obsComerciales: string
  cancelaEnMonedaExtranjera: boolean
}

export interface IncotermForm {
  codigo: string
  descripcion?: string
  /** El flete lo paga el cliente: sin línea de flete y total = FOB */
  sinFlete: boolean
}

// ---------------------------------------------------------------------------
// Totales
// ---------------------------------------------------------------------------

export interface CalculoFacturaE {
  /** Por fila de la cotización (null si no está incluida o es inválida) */
  filas: Array<{ quoteItemId: string; subtotalUSD: number | null; bonificacionUSD: number; error: string | null }>
  manuales: Array<{ subtotalUSD: number | null; error: string | null }>
  seleccionados: number
  /** Líneas de la cotización: el FOB de Exporta Simple y la base de la comisión */
  mercaderiaUSD: number
  /** Flete/seguro cargado a mano */
  manualUSD: number
  /** Imp_total */
  totalUSD: number
}

/**
 * Totales en centavos enteros con el mismo armado que el servidor
 * (armarItemsExportacion): bruto = cantidad × precio, bonificación =
 * bruto × Dto % (MONTO), subtotal = bruto − bonificación.
 */
export function calcularFacturaE(filas: FilaItemFacturaE[], manuales: LineaManualFacturaE[]): CalculoFacturaE {
  let mercaderiaCent = 0
  let manualCent = 0
  let seleccionados = 0

  const resFilas = filas.map((f) => {
    if (!f.incluido) return { quoteItemId: f.quoteItemId, subtotalUSD: null, bonificacionUSD: 0, error: null }
    seleccionados++
    const cantidad = parseMontoForm(f.cantidad)
    const precio = parseMontoForm(f.precio)
    let error: string | null = null
    if (!(Number.isFinite(cantidad) && cantidad > 0)) error = 'La cantidad tiene que ser mayor a cero'
    else if (!hastaDosDecimales(cantidad)) error = 'La cantidad admite hasta 2 decimales'
    else if (cantidad > f.cantidadPendiente + 1e-9) error = `Máximo ${f.cantidadPendiente} (pendiente de facturar)`
    else if (!(Number.isFinite(precio) && precio > 0)) error = 'El precio tiene que ser mayor a cero'
    else if (!hastaDosDecimales(precio)) error = 'El precio admite hasta 2 decimales'
    if (error) return { quoteItemId: f.quoteItemId, subtotalUSD: null, bonificacionUSD: 0, error }
    const brutoCent = centavos(cantidad * precio)
    const bonifCent = centavos((cantidad * precio * f.descuentoPct) / 100)
    mercaderiaCent += brutoCent - bonifCent
    return { quoteItemId: f.quoteItemId, subtotalUSD: (brutoCent - bonifCent) / 100, bonificacionUSD: bonifCent / 100, error }
  })

  const resManuales = manuales.map((m) => {
    const importe = parseMontoForm(m.importe)
    let error: string | null = null
    if (!m.descripcion.trim()) error = 'Falta la descripción (ej. "Flete internacional")'
    else if (!(Number.isFinite(importe) && importe > 0)) error = 'El importe tiene que ser mayor a cero'
    else if (!hastaDosDecimales(importe)) error = 'El importe admite hasta 2 decimales'
    if (error) return { subtotalUSD: null, error }
    const cent = centavos(importe)
    manualCent += cent
    return { subtotalUSD: cent / 100, error }
  })

  return {
    filas: resFilas,
    manuales: resManuales,
    seleccionados,
    mercaderiaUSD: mercaderiaCent / 100,
    manualUSD: manualCent / 100,
    totalUSD: (mercaderiaCent + manualCent) / 100,
  }
}

// ---------------------------------------------------------------------------
// Validación previa (avisa antes; el servidor vuelve a validar)
// ---------------------------------------------------------------------------

export interface ValidacionFacturaE {
  calculo: CalculoFacturaE
  /** Bloquean la vista previa y la emisión */
  errores: string[]
  /** No bloquean */
  avisos: string[]
  /** FOB tipeado (NaN si no se cargó o es inválido) */
  fobUSD: number
  /** FOB − mercadería en USD (null si el FOB no es válido) */
  diferenciaFobUSD: number | null
}

const fmt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function validarFormularioFacturaE(form: FormFacturaE, incoterms: IncotermForm[]): ValidacionFacturaE {
  const calculo = calcularFacturaE(form.filas, form.manuales)
  const errores: string[] = []
  const avisos: string[] = []

  // Ítems
  if (calculo.seleccionados === 0) errores.push('Elegí al menos un ítem de la cotización')
  calculo.filas.forEach((r, i) => {
    if (r.error) errores.push(`Ítem ${form.filas[i].itemNumber}: ${r.error}`)
  })
  form.filas.forEach((f) => {
    if (!f.incluido) return
    const precio = parseMontoForm(f.precio)
    if (Number.isFinite(precio) && centavos(precio) !== centavos(f.precioOriginal)) {
      avisos.push(`Ítem ${f.itemNumber}: precio distinto al de la cotización (USD ${fmt(f.precioOriginal)} → USD ${fmt(precio)})`)
    }
  })
  if (form.manuales.length > MAX_LINEAS_MANUALES_FORM) errores.push(`Hasta ${MAX_LINEAS_MANUALES_FORM} líneas manuales (flete, seguro)`)
  calculo.manuales.forEach((r, i) => {
    if (r.error) errores.push(`Línea manual ${i + 1}: ${r.error}`)
  })

  // Incoterm y flete
  const inc = incoterms.find((x) => x.codigo === form.incoterm)
  const conFlete = incoterms.filter((x) => !x.sinFlete).map((x) => x.codigo)
  if (!inc) {
    errores.push('Elegí el Incoterm')
  } else if (inc.sinFlete && form.manuales.length > 0) {
    errores.push(
      `Con ${inc.codigo} el flete lo paga el cliente: sacá la línea de flete/seguro (solo corresponde con ${conFlete.join(', ')})`
    )
  } else if (!inc.sinFlete && form.manuales.length === 0) {
    avisos.push(
      `Con ${inc.codigo} el flete lo pagamos nosotros. Si se lo cobrás al cliente, agregá la línea de flete; ` +
        'si todavía no tenés el importe podés emitir sin ella (el total queda igual al FOB), pero después solo se agrega con una nota de débito E'
    )
  }
  if (form.incotermLugar.trim().length > MAX_INCOTERM_LUGAR) {
    errores.push(`El lugar del Incoterm admite hasta ${MAX_INCOTERM_LUGAR} caracteres`)
  } else if (!form.incotermLugar.trim()) {
    avisos.push('Falta el lugar del Incoterm (ej. "Santiago")')
  }

  // Condiciones
  const formaPago = form.formaPago.trim()
  if (!formaPago) errores.push('Falta la forma de pago')
  else if (formaPago.length > MAX_FORMA_PAGO) errores.push(`La forma de pago admite hasta ${MAX_FORMA_PAGO} caracteres (tiene ${formaPago.length})`)
  if (form.obsComerciales.trim().length > MAX_OBS_COMERCIALES) {
    errores.push(`Las observaciones comerciales admiten hasta ${MAX_OBS_COMERCIALES} caracteres`)
  }

  // Exporta Simple: DES y FOB
  const des = normalizarDesForm(form.desNumero)
  if (!des) errores.push('Falta el N° de DES (Exporta Simple)')
  else if (!DES_REGEX_FORM.test(des)) errores.push(`El N° de DES "${des}" no tiene el formato esperado (8 a 11 letras y números, sin guiones)`)

  const fobUSD = parseMontoForm(form.fob)
  let diferenciaFobUSD: number | null = null
  if (!form.fob.trim()) {
    errores.push('Falta el FOB del DES (USD)')
  } else if (!(Number.isFinite(fobUSD) && fobUSD > 0)) {
    errores.push('El FOB del DES tiene que ser un importe mayor a cero')
  } else if (!hastaDosDecimales(fobUSD)) {
    errores.push('El FOB del DES admite hasta 2 decimales')
  } else {
    const difCent = centavos(fobUSD) - centavos(calculo.mercaderiaUSD)
    diferenciaFobUSD = difCent / 100
    if (difCent !== 0 && calculo.seleccionados > 0) {
      errores.push(
        `El FOB del DES (USD ${fmt(fobUSD)}) no coincide con la mercadería facturada (USD ${fmt(calculo.mercaderiaUSD)}): ` +
          `diferencia USD ${fmt(difCent / 100)}. Tienen que ser iguales al centavo: corregí el DES en el portal o las cantidades/precios`
      )
    }
  }

  return { calculo, errores, avisos, fobUSD, diferenciaFobUSD }
}

// ---------------------------------------------------------------------------
// Pedido (body del POST /api/quotes/[id]/factura-exportacion)
// ---------------------------------------------------------------------------

export type CuerpoFacturaE = PedidoFacturaExportacion & { dryRun: boolean }

/**
 * Body del POST. La descripción solo viaja si el usuario la cambió (si no, el
 * servidor arma la suya con los adicionales); el Dto % es el de la cotización
 * (no se manda). Las líneas manuales van con cantidad 1. `dryRun` va siempre
 * explícito: el servidor solo emite con `dryRun: false`.
 */
export function armarPedidoFacturaE(
  form: FormFacturaE,
  opts: { cotizacionEsperada?: number | null; dryRun?: boolean } = {}
): CuerpoFacturaE {
  const fob = parseMontoForm(form.fob)
  return {
    items: form.filas
      .filter((f) => f.incluido)
      .map((f) => {
        const descripcion = f.descripcion.trim()
        return {
          quoteItemId: f.quoteItemId,
          cantidad: parseMontoForm(f.cantidad),
          precioUnitario: parseMontoForm(f.precio),
          ...(descripcion && descripcion !== f.descripcionOriginal.trim() ? { descripcion } : {}),
        }
      }),
    lineasManuales: form.manuales.map((m) => ({
      descripcion: m.descripcion.trim(),
      cantidad: 1,
      precioUnitario: parseMontoForm(m.importe),
    })),
    desNumero: normalizarDesForm(form.desNumero),
    ...(Number.isFinite(fob) ? { fobUSD: fob } : {}),
    incoterm: form.incoterm,
    incotermLugar: form.incotermLugar.trim(),
    formaPago: form.formaPago.trim(),
    ...(form.obsComerciales.trim() ? { obsComerciales: form.obsComerciales.trim() } : {}),
    cancelaEnMonedaExtranjera: form.cancelaEnMonedaExtranjera,
    ...(opts.cotizacionEsperada ? { cotizacionEsperada: opts.cotizacionEsperada } : {}),
    dryRun: opts.dryRun === true,
  }
}

// ---------------------------------------------------------------------------
// Presentación
// ---------------------------------------------------------------------------

/** "2026-10-01" o "20261001" → "01/10/2026"; otro formato, tal cual. */
export function formatearFechaArca(s: string | null | undefined): string {
  const t = (s ?? '').trim()
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t)
  if (m) return `${m[3]}/${m[2]}/${m[1]}`
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(t)
  if (m) return `${m[3]}/${m[2]}/${m[1]}`
  return t
}

/** Indenta un XML de una línea para mostrarlo (vista previa del request). */
export function indentarXml(xml: string): string {
  const partes = xml.trim().replace(/>\s*</g, '>\n<').split('\n')
  let nivel = 0
  return partes
    .map((p) => {
      if (p.startsWith('</')) nivel = Math.max(0, nivel - 1)
      const linea = '  '.repeat(nivel) + p
      const abre = /^<[^!?/][^>]*>$/.test(p) && !p.endsWith('/>')
      if (abre) nivel++
      return linea
    })
    .join('\n')
}

/** "Code: Msg" de los errores/observaciones de ARCA (o el texto tal cual). */
export function textoErrorArca(e: unknown): string {
  if (typeof e === 'string') return e
  if (e && typeof e === 'object') {
    const o = e as { Code?: unknown; Msg?: unknown }
    if (o.Msg !== undefined) return o.Code !== undefined ? `${String(o.Code)}: ${String(o.Msg)}` : String(o.Msg)
  }
  return JSON.stringify(e)
}
