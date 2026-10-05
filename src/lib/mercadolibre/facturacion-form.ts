/**
 * Facturación de ventas de Mercado Libre: reglas de la pantalla (dos pestañas,
 * A y B) y del borrador (src/app/(dashboard)/mercadolibre/facturacion/page.tsx
 * y src/components/mercadolibre/BorradorFacturaMlDialog.tsx).
 *
 * Lo usan componentes 'use client': no importa nada de servidor (Prisma, ARCA,
 * ML). De facturacion.ts solo toma TIPOS, que se borran al compilar. El
 * servidor sigue siendo la autoridad y vuelve a validar todo: estas reglas
 * solo avisan y habilitan el botón de emitir.
 */
import type {
  ClaseFacturaMl,
  CompradorMl,
  DomicilioComprador,
  TaxConditionMl,
  VentaMl,
} from './facturacion'
import { esCuitValido, normalizeCuit } from '@/lib/cuit-utils'
import { totalesFacturaADesdeFinal, totalesFacturaB } from '@/lib/facturacion/totales-factura'

/** Nombre de cada pestaña (también lo usan los 409 "va por la otra" del servidor). */
export const PESTANA_FACTURA_ML: Record<ClaseFacturaMl, string> = {
  A: 'Factura A — Responsables Inscriptos y Monotributistas',
  B: 'Factura B — Consumidores Finales',
}

export const RUTA_FACTURACION_ML = '/mercadolibre/facturacion'

/** ?tipo=a|b → pestaña (por defecto la A). */
export function claseDesdeTipo(tipo: string | null | undefined): ClaseFacturaMl {
  return (tipo ?? '').trim().toLowerCase() === 'b' ? 'B' : 'A'
}

/** Link directo a una pestaña. */
export function hrefPestanaMl(clase: ClaseFacturaMl): string {
  return `${RUTA_FACTURACION_ML}?tipo=${clase.toLowerCase()}`
}

// ---------------------------------------------------------------------------
// Listado
// ---------------------------------------------------------------------------

/**
 * Pendiente: ni factura del ERP ni factura adjunta en ML (= conteos del
 * servidor). Si ML no pudo confirmarlo (null) sigue pendiente.
 */
export function ventaPendiente(v: Pick<VentaMl, 'facturada' | 'facturaEnMl'>): boolean {
  return !v.facturada && !v.facturaEnMl
}

/** Factura adjunta en ML: aviso del listado y del borrador (null si no hay nada que avisar). */
export function avisoFacturaEnMl(facturaEnMl: boolean | null | undefined): { badge: string; texto: string; casilla: string } | null {
  if (facturaEnMl === true) {
    return {
      badge: 'Ya tiene factura en ML (p. ej. de Colppy)',
      texto:
        'Mercado Libre ya tiene una factura adjunta en esta venta. Si emitís otra, el comprador va a ver dos facturas: hacelo solo si la de ML no corresponde a esta venta.',
      casilla: 'Esta venta ya tiene una factura adjunta en ML (p. ej. hecha en Colppy). Emitir igual',
    }
  }
  if (facturaEnMl === null) {
    return {
      badge: 'ML no confirmó si tiene factura',
      texto: 'No se pudo verificar en Mercado Libre si la venta ya tiene factura; confirmalo en el borrador.',
      casilla: 'Revisé en Mercado Libre que la venta no tiene otra factura (o corresponde igual). Emitir',
    }
  }
  return null
}

/**
 * "Factura en ML" en el borrador: lo último que contestó el servidor
 * (/comprador o un 409 FACTURA_EN_ML) y la casilla de confirmación. Cada
 * pedido toma un turno al salir y gana la respuesta del pedido más nuevo (una
 * respuesta de un turno anterior al ya aplicado se descarta). Si el estado
 * cambia, la casilla se destilda: la confirmación vale solo para lo que se vio.
 */
export interface EstadoFacturaEnMlBorrador {
  /** true = tiene factura en ML, null = ML no lo pudo confirmar, false = no tiene */
  valor: boolean | null
  /** Turno del pedido cuya respuesta se aplicó (0 = el dato del listado) */
  turno: number
  /** Casilla "Emitir igual" / "Revisé en ML" tildada para `valor` */
  confirmado: boolean
}

export function estadoFacturaEnMlInicial(valor: boolean | null | undefined): EstadoFacturaEnMlBorrador {
  return { valor: valor === undefined ? false : valor, turno: 0, confirmado: false }
}

export function aplicarRespuestaFacturaEnMl(
  actual: EstadoFacturaEnMlBorrador,
  respuesta: { valor: boolean | null; turno: number; destildar?: boolean }
): EstadoFacturaEnMlBorrador {
  if (respuesta.turno < actual.turno) return actual
  const cambia = respuesta.valor !== actual.valor
  return { valor: respuesta.valor, turno: respuesta.turno, confirmado: cambia || respuesta.destildar ? false : actual.confirmado }
}

/**
 * Ventas de una pestaña: las de su letra y las sin letra (candado sin factura:
 * "revisar", van en las dos). Pendientes primero; dentro de cada grupo, el
 * orden del servidor.
 */
export function ventasDePestana<T extends Pick<VentaMl, 'clase' | 'facturada' | 'facturaEnMl'>>(
  ventas: T[],
  clase: ClaseFacturaMl
): T[] {
  const deLaPestana = ventas.filter((v) => v.clase === clase || v.clase === null)
  return [...deLaPestana.filter(ventaPendiente), ...deLaPestana.filter((v) => !ventaPendiente(v))]
}

/** Documento a mostrar en el listado: el CUIT/CUIL o, si ML solo dio el DNI, el DNI. */
export function documentoListado(
  v: Pick<VentaMl, 'cuit' | 'documentoMl'>
): { texto: string; esDni: boolean } | null {
  if (v.cuit) return { texto: v.cuit, esDni: false }
  if (v.documentoMl?.tipo === 'DNI') return { texto: `DNI ${v.documentoMl.numero}`, esDni: true }
  return null
}

// ---------------------------------------------------------------------------
// Comprador (borrador)
// ---------------------------------------------------------------------------

export const ETIQUETA_CONDICION_IVA: Record<TaxConditionMl, string> = {
  RESPONSABLE_INSCRIPTO: 'IVA Responsable Inscripto',
  MONOTRIBUTO: 'Responsable Monotributo',
  EXENTO: 'IVA Exento',
  CONSUMIDOR_FINAL: 'Consumidor Final',
}

/** Tipos de documento del receptor en WSFE (= DOC_TIPO de src/lib/arca/wsfe.ts, más CDI). */
const ETIQUETA_DOC_TIPO: Record<number, string> = {
  80: 'CUIT',
  86: 'CUIL',
  87: 'CDI',
  96: 'DNI',
  99: 'Sin identificar',
}

/** "CUIL 20-12345678-6", "DNI 12345678": cómo se identifica al comprador ante ARCA. */
export function documentoReceptorTexto(r: { docTipo: number; docNro: string } | null | undefined): string | null {
  if (!r) return null
  const etiqueta = ETIQUETA_DOC_TIPO[r.docTipo] ?? `Doc. ${r.docTipo}`
  if (r.docTipo === 99) return etiqueta
  const conGuiones = r.docTipo === 80 || r.docTipo === 86 || r.docTipo === 87
  return `${etiqueta} ${conGuiones ? (normalizeCuit(r.docNro) ?? r.docNro) : r.docNro}`
}

/**
 * Qué dice ARCA de la condición del comprador cuando va por la B (debajo de la
 * letra en el borrador). null si no corresponde aclarar nada.
 */
export function textoCondicionArca(c: Pick<CompradorMl, 'clase' | 'padron' | 'condicionIva'>): string | null {
  if (c.clase !== 'B') return null
  if (c.padron === 'no-existe') return 'Sin inscripción impositiva en ARCA: va como Consumidor Final.'
  if (c.padron === 'encontrado' && c.condicionIva === 'CONSUMIDOR_FINAL') return 'ARCA no informa inscripción en IVA: consumidor final.'
  return null
}

/**
 * CUIT/CUIL del campo después de una consulta al servidor: el de la consulta
 * SOLO si el usuario no tocó el campo mientras tanto (si no, la respuesta
 * pisaría lo que está tipeando y lo daría por verificado). El número
 * verificado siempre es el que está en el campo.
 *
 * `soloSiVacio` (botón Reintentar): lo que ya está tipeado en el campo, válido
 * o no, cuenta como una edición: la consulta solo completa un campo vacío
 * (con el CUIT de ML o el CUIL del DNI).
 */
export function cuitTrasConsulta(a: {
  campo: string
  deLaConsulta: string | null
  editadoDuranteLaConsulta: boolean
  soloSiVacio?: boolean
}): string {
  if (a.editadoDuranteLaConsulta || !a.deLaConsulta) return a.campo
  if (a.soloSiVacio && a.campo.trim()) return a.campo
  return a.deLaConsulta
}

/**
 * CUIL para elegir en el borrador cuando ML solo dio el DNI y ARCA tiene más
 * de uno con ese número (DNI repetidos) sin que el nombre de ML permita elegir:
 * los que ARCA encontró, con su nombre. Vacío si no hay nada que elegir.
 */
export function opcionesCuilComprador(
  c: Pick<CompradorMl, 'origen' | 'candidatos'> | null | undefined
): Array<{ cuit: string; nombre: string | null }> {
  if (!c || c.origen !== 'manual-requerido') return []
  const encontrados = c.candidatos.filter((x) => x.resultado === 'encontrado')
  return encontrados.length > 1 ? encontrados.map((x) => ({ cuit: x.cuit, nombre: x.nombreArca ?? null })) : []
}

export type ValidacionCuit = { ok: true; cuit: string } | { ok: false; mensaje: string | null }

/**
 * CUIT/CUIL tipeado en el borrador: 11 dígitos y dígito verificador estricto
 * (el mismo esCuitValido que el servidor). Devuelve el número con guiones.
 * mensaje null = vacío.
 */
export function validarCuitIngresado(raw: string | null | undefined): ValidacionCuit {
  const digitos = (raw ?? '').replace(/\D/g, '')
  if (!digitos) return { ok: false, mensaje: null }
  if (digitos.length !== 11) {
    return { ok: false, mensaje: `El CUIT/CUIL tiene 11 dígitos (ingresaste ${digitos.length})` }
  }
  if (!esCuitValido(digitos)) return { ok: false, mensaje: 'El dígito verificador no corresponde: revisá el número' }
  return { ok: true, cuit: normalizeCuit(digitos)! }
}

/**
 * Aviso cuando ARCA dice que la venta va por la otra letra (null si coincide
 * o si todavía no se sabe). Mismo criterio que el 409 CLASE_INCORRECTA.
 */
export function avisoOtraClase(
  c: Pick<CompradorMl, 'clase' | 'condicionIva' | 'padron'>,
  clase: ClaseFacturaMl
): string | null {
  if (!c.clase || c.clase === clase) return null
  const condicion = c.condicionIva ? ETIQUETA_CONDICION_IVA[c.condicionIva] : null
  const situacion =
    c.clase === 'A'
      ? `En ARCA figura como ${condicion ?? 'Responsable Inscripto o Monotributista'}`
      : c.padron === 'encontrado'
        ? `En ARCA no es Responsable Inscripto ni Monotributista${condicion ? ` (${condicion})` : ''}`
        : 'No está inscripto en ARCA (consumidor final)'
  return `${situacion}: corresponde Factura ${c.clase}. Se factura desde la pestaña "${PESTANA_FACTURA_ML[c.clase]}".`
}

// ---------------------------------------------------------------------------
// Líneas y totales
// ---------------------------------------------------------------------------

/** Línea editable del borrador (precio FINAL con IVA, como en ML). */
export interface LineaBorradorMl {
  productId: string | null
  sku: string | null
  descripcion: string
  cantidad: string
  precioFinal: string
}

/** Número tipeado (acepta coma decimal). */
export const numeroBorrador = (s: string) => Number(String(s).replace(',', '.'))

export const redondear2 = (n: number) => Math.round(n * 100) / 100

export function lineasDesdeVenta(
  items: Array<{ quantity: number; unitPrice: number; productId: string | null; sku: string | null; productName: string | null; title: string }>
): LineaBorradorMl[] {
  return items.map((it) => ({
    productId: it.productId,
    sku: it.sku,
    descripcion: it.productName ?? it.title,
    cantidad: String(it.quantity),
    precioFinal: String(it.unitPrice),
  }))
}

export function lineasValidas(lineas: LineaBorradorMl[]): boolean {
  return (
    lineas.length > 0 &&
    lineas.every((l) => l.descripcion.trim() && numeroBorrador(l.cantidad) > 0 && numeroBorrador(l.precioFinal) > 0)
  )
}

/**
 * Totales del borrador a partir de precios finales al 21%: EXACTAMENTE lo que
 * el servidor va a emitir (Colppy, ARCA y la Invoice del ERP salen de lo mismo).
 *  - B: "total primero" (totalesFacturaB). El IVA es el "IVA contenido" del
 *    Régimen de Transparencia Fiscal al Consumidor (Ley 27.743).
 *  - A: "neto primero", la rama A de sendQuoteToColppy (totalesFacturaADesdeFinal):
 *    $100 → 82,64 + 17,35 = 99,99.
 */
export function totalesBorrador(
  lineas: Array<Pick<LineaBorradorMl, 'cantidad' | 'precioFinal'>>,
  clase: ClaseFacturaMl = 'B'
): {
  total: number
  neto: number
  iva: number
} {
  const numericas = lineas.map((l) => ({ cantidad: numeroBorrador(l.cantidad) || 0, precioFinal: numeroBorrador(l.precioFinal) || 0 }))
  // A: el servidor redondea el precio final a 2 decimales al armar las líneas
  // (armarLineas) y después divide por 1,21 sin redondear
  return clase === 'A'
    ? totalesFacturaADesdeFinal(numericas.map((l) => ({ ...l, precioFinal: redondear2(l.precioFinal) })))
    : totalesFacturaB(numericas)
}

const pesos = (n: number) => n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })

/**
 * Factura A: aviso cuando el total que se emite difiere en centavos de lo que
 * cobró ML (la A discrimina el IVA y redondea neto e IVA por separado). null
 * en la B, si coincide, o si la diferencia es de un peso o más (eso ya lo avisa
 * "no coincide con lo cobrado").
 */
export function notaRedondeoFacturaA(clase: ClaseFacturaMl, totalFactura: number, totalMl: number | null | undefined): string | null {
  if (clase !== 'A' || totalMl === null || totalMl === undefined || !Number.isFinite(totalMl)) return null
  const dif = Math.abs(redondear2(totalFactura) - redondear2(totalMl))
  if (dif < 0.005 || dif >= 1) return null
  return `ML cobró ${pesos(totalMl)}: la Factura A discrimina IVA y redondea a ${pesos(totalFactura)}`
}

// ---------------------------------------------------------------------------
// Emisión
// ---------------------------------------------------------------------------

export interface EstadoBorradorMl {
  /** Pestaña / letra del borrador */
  clase: ClaseFacturaMl
  comprador: (Pick<CompradorMl, 'cuit' | 'clase' | 'motivo' | 'padron'> & Partial<Pick<CompradorMl, 'yaFacturada'>>) | null
  cuitIngresado: string
  /** Nombre para el alta (B, si ARCA no tiene al comprador) */
  nombre: string
  lineas: LineaBorradorMl[]
  /** La venta ya tiene una factura adjunta en ML (null = ML no lo pudo confirmar) */
  facturaEnMl: boolean | null
  /** Tildó "Emitir igual" / la confirmación */
  confirmaFacturaEnMl: boolean
}

/**
 * Por qué todavía no se puede emitir (null = se puede). El borrador lo muestra
 * al lado del botón. El CUIT/CUIL tiene que ser el verificado en ARCA.
 */
export function motivoNoEmitir(e: EstadoBorradorMl): string | null {
  const c = e.comprador
  if (!c) return 'Faltan los datos del comprador'
  // Candado del ERP (ya facturada / en emisión): ni "Emitir igual"
  if (c.yaFacturada) return c.motivo ?? 'Esta venta ya fue facturada desde el ERP'
  const v = validarCuitIngresado(e.cuitIngresado)
  if (!v.ok) return v.mensaje ?? 'Falta el CUIT/CUIL del comprador'
  if (v.cuit !== c.cuit) return 'Verificá el CUIT/CUIL en ARCA'
  if (!c.clase) return c.motivo ?? 'No se pudo determinar en ARCA qué factura corresponde'
  if (c.clase !== e.clase) return `Según ARCA va por Factura ${c.clase}`
  if (e.clase === 'B' && c.padron !== 'encontrado' && !e.nombre.trim()) return 'Falta el nombre del comprador'
  if (!lineasValidas(e.lineas)) return 'Revisá las líneas: descripción, cantidad y precio'
  if (e.facturaEnMl === true && !e.confirmaFacturaEnMl) {
    return 'La venta ya tiene una factura en ML: tildá "Emitir igual" si corresponde'
  }
  // ML no lo pudo confirmar: el servidor lo rechaza sin la confirmación
  if (e.facturaEnMl === null && !e.confirmaFacturaEnMl) {
    return 'No se pudo verificar en ML si la venta ya tiene factura: confirmalo (casilla) para emitir'
  }
  return null
}

/** Cuerpo del POST /api/mercadolibre/facturacion. */
export interface CuerpoFacturaMl {
  packId: string
  clase: ClaseFacturaMl
  cuit: string
  lineas: Array<{ productId: string | null; descripcion: string; cantidad: number; precioFinal: number }>
  confirmarFacturaEnMl?: true
  /** Lo que mostraba el borrador al confirmar: true = tiene factura en ML, null = ML no lo pudo verificar */
  estadoFacturaEnMlConfirmado?: boolean | null
  nombre?: string
  domicilio?: DomicilioComprador
}

/**
 * Arma el POST. confirmarFacturaEnMl va SOLO si ML ya tiene una factura (o no
 * pudo confirmarlo) y el usuario tildó la confirmación, junto con el estado que
 * se le mostraba (estadoFacturaEnMlConfirmado): el servidor exige confirmar de
 * nuevo si ahora ML dice que hay factura y lo confirmado era otra cosa. Nombre
 * y domicilio, solo en la B cuando ARCA no tiene al comprador (si lo tiene, el
 * alta usa los datos de ARCA).
 */
export function cuerpoFacturaMl(a: {
  packId: string
  clase: ClaseFacturaMl
  cuit: string
  lineas: LineaBorradorMl[]
  facturaEnMl: boolean | null
  confirmaFacturaEnMl: boolean
  padron: CompradorMl['padron']
  nombre: string
  domicilio: DomicilioComprador
}): CuerpoFacturaMl {
  const limpio = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim() || null
  return {
    packId: a.packId,
    clase: a.clase,
    cuit: a.cuit,
    lineas: a.lineas.map((l) => ({
      productId: l.productId,
      descripcion: l.descripcion.trim(),
      cantidad: numeroBorrador(l.cantidad),
      precioFinal: numeroBorrador(l.precioFinal),
    })),
    ...(a.facturaEnMl !== false && a.confirmaFacturaEnMl
      ? { confirmarFacturaEnMl: true as const, estadoFacturaEnMlConfirmado: a.facturaEnMl }
      : {}),
    ...(a.clase === 'B' && a.padron !== 'encontrado'
      ? {
          nombre: a.nombre.replace(/\s+/g, ' ').trim(),
          domicilio: {
            direccion: limpio(a.domicilio.direccion),
            localidad: limpio(a.domicilio.localidad),
            provincia: limpio(a.domicilio.provincia),
            codigoPostal: limpio(a.domicilio.codigoPostal),
          },
        }
      : {}),
  }
}

/** Provincias como las guarda el ERP (= selects de alta de clientes y padrón ARCA). */
export const PROVINCIAS_ERP = [
  'Buenos Aires', 'CABA', 'Catamarca', 'Chaco', 'Chubut', 'Córdoba', 'Corrientes',
  'Entre Ríos', 'Formosa', 'Jujuy', 'La Pampa', 'La Rioja', 'Mendoza', 'Misiones',
  'Neuquén', 'Río Negro', 'Salta', 'San Juan', 'San Luis', 'Santa Cruz', 'Santa Fe',
  'Santiago del Estero', 'Tierra del Fuego', 'Tucumán',
]
