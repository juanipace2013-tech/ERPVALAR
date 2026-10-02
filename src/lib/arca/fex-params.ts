/**
 * Parámetros de WSFEX (Factura E de exportación) y mapeo del cliente del
 * exterior del ERP al receptor que pide ARCA.
 *
 * Los códigos de abajo se verificaron en ARCA prod 2/10/2026 con llamadas de
 * solo lectura (FEXGetPARAM_*, FEXGetLast_CMP, FEXGetLast_ID). Si ARCA cambia
 * una tabla, scripts/arca-fex-check.ts params la vuelve a listar.
 */
import { esClienteExterior, paisCliente } from '@/lib/cliente-exterior'

// ---------------------------------------------------------------------------
// Tablas (verificado en ARCA prod 2/10/2026)
// ---------------------------------------------------------------------------

/** Tipos de comprobante de exportación (FEXGetPARAM_Cbte_Tipo) */
export const FEX_CBTE = {
  FACTURA_E: 19,
  NOTA_DEBITO_E: 20,
  NOTA_CREDITO_E: 21,
} as const
export type FexCbteTipo = (typeof FEX_CBTE)[keyof typeof FEX_CBTE]

export function esCbteExportacion(cbteTipo: number | null | undefined): boolean {
  return cbteTipo === FEX_CBTE.FACTURA_E || cbteTipo === FEX_CBTE.NOTA_DEBITO_E || cbteTipo === FEX_CBTE.NOTA_CREDITO_E
}

/**
 * PV "Comprobantes de Exportacion - Web Services" de VAL ARG en prod
 * (FEXGetPARAM_PtoVenta; Last_CMP 19/20/21 = 0 y Last_ID = 0 al 2/10/2026).
 * La emisión lo toma de ARCA_PUNTO_VENTA_EXPO; esta constante la usa el sync de
 * Colppy (que siempre es prod) para reconocer el talonario E 0010.
 */
export const FEX_PUNTO_VENTA_PROD = 10

/** Tipo de exportación (FEXGetPARAM_Tipo_Expo) */
export const TIPO_EXPO = {
  /** Exportación definitiva de Bienes (Exporta Simple usa siempre este) */
  BIENES: 1,
  SERVICIOS: 2,
  OTROS: 4,
} as const

/** Idioma del comprobante (FEXGetPARAM_Idiomas) */
export const IDIOMA = { ESPANOL: 1, INGLES: 2, PORTUGUES: 3 } as const

/** Unidades de medida (FEXGetPARAM_UMed, subset) */
export const UMED = {
  KILOGRAMOS: 1,
  METROS: 2,
  UNIDADES: 7,
  SENA_ANTICIPO: 97,
  OTRAS_UNIDADES: 98,
  BONIFICACION: 99,
} as const
export const UMED_UNIDADES = UMED.UNIDADES

/** Monedas (FEXGetPARAM_MON, subset) */
export const MONEDA_FEX = { DOLAR: 'DOL', PESOS: 'PES' } as const

/** Incoterms que acepta WSFEX (FEXGetPARAM_Incoterms) */
export const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DDP', 'DAP', 'DPU'] as const
export type Incoterm = (typeof INCOTERMS)[number]

/**
 * Incoterms habilitados en el ERP para Exporta Simple (plan, sección 2): sin
 * EXW (el exportador hace el DES) ni DDP (no recomendado: impuestos en destino).
 */
export const INCOTERMS_EXPORTA_SIMPLE: readonly Incoterm[] = ['FCA', 'FOB', 'CPT', 'CIP', 'DAP']

/**
 * Incoterms donde el flete principal NO lo paga el vendedor: la factura no
 * puede llevar línea de flete/seguro y el total tiene que ser igual al FOB.
 */
export const INCOTERMS_SIN_FLETE: readonly Incoterm[] = ['EXW', 'FCA', 'FAS', 'FOB']

export const INCOTERM_DESCRIPCION: Record<Incoterm, string> = {
  EXW: 'En fábrica',
  FCA: 'Franco transportista (el flete lo paga el cliente)',
  FAS: 'Franco al costado del buque',
  FOB: 'Franco a bordo (el flete lo paga el cliente)',
  CFR: 'Costo y flete',
  CIF: 'Costo, seguro y flete',
  CPT: 'Transporte pagado hasta (el flete lo pagamos nosotros)',
  CIP: 'Transporte y seguro pagados hasta',
  DDP: 'Entregado con derechos pagados',
  DAP: 'Entregado en lugar (el flete lo pagamos nosotros)',
  DPU: 'Entregado en lugar descargado',
}

export function esIncoterm(v: string | null | undefined): v is Incoterm {
  return !!v && (INCOTERMS as readonly string[]).includes(v)
}

/** Opcionales de WSFEX (FEXGetPARAM_Opcionales) */
export const FEX_OPCIONAL = {
  /** RÉGIMEN DE EXPORTACIÓN SIMPLIFICADA - Documento de Exportación Simple (N° de DES) */
  DES: '2401',
  /** RÉGIMEN DE EXPORTACIÓN SIMPLIFICADA - Valor FOB de la operación */
  FOB_DES: '2402',
} as const

/** Actividad de VAL ARG informada por FEXGetPARAM_Actividades (no se envía por default) */
export const FEX_ACTIVIDAD_PRINCIPAL = 477490

/** Código ARCA del país de destino (FEXGetPARAM_DST_pais) por ISO2 */
export const DST_PAIS: Record<string, number> = {
  CL: 208, // CHILE
  PY: 221, // PARAGUAY
  UY: 225, // URUGUAY
  BO: 202, // BOLIVIA
  BR: 203, // BRASIL
}

/** ISO2 del país a partir de su código Dst_cmp de ARCA (null si no está en DST_PAIS). */
export function isoDeDstPais(dstCmp: number | null | undefined): string | null {
  return Object.entries(DST_PAIS).find(([, codigo]) => codigo === dstCmp)?.[0] ?? null
}

export type TipoPersonaFex = 'FISICA' | 'JURIDICA' | 'OTRO'

/** Cómo nombra ARCA cada tipo de persona en FEXGetPARAM_DST_CUIT */
export const TIPO_PERSONA_LABEL: Record<TipoPersonaFex, string> = {
  FISICA: 'Persona Física',
  JURIDICA: 'Persona Jurídica',
  OTRO: 'Otro tipo de Entidad',
}

/**
 * "CUIT país" genérico del receptor (FEXGetPARAM_DST_CUIT) por ISO2 y tipo de
 * persona. Bolivia y Brasil no se verificaron: para esos va solo Id_impositivo.
 */
export const DST_CUIT: Record<string, Record<TipoPersonaFex, string>> = {
  CL: { FISICA: '50000000032', JURIDICA: '55000000034', OTRO: '51600000032' },
  PY: { FISICA: '50000000024', JURIDICA: '55000000026', OTRO: '51600000024' },
  UY: { FISICA: '50000000016', JURIDICA: '55000000018', OTRO: '51600000016' },
}

/**
 * true si es un "CUIT país" genérico de ARCA (50…/51…/55…, como los de
 * DST_CUIT): lo comparten todos los clientes de ese país, así que nunca
 * identifica a un cliente. Ningún CUIT argentino empieza con 5 (20/23/24/27/30/33/34).
 */
export function esCuitPaisArca(cuit: string | null | undefined): boolean {
  return /^5\d{10}$/.test((cuit ?? '').replace(/\D/g, ''))
}

/** País (ISO2) y tipo de persona de un CUIT país de DST_CUIT (null si no es uno de la tabla). */
export function infoCuitPais(cuitPais: string | null | undefined): { iso: string; tipoPersona: TipoPersonaFex } | null {
  if (!cuitPais) return null
  for (const [iso, porTipo] of Object.entries(DST_CUIT)) {
    for (const [tipo, cuit] of Object.entries(porTipo)) {
      if (cuit === cuitPais) return { iso, tipoPersona: tipo as TipoPersonaFex }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Receptor
// ---------------------------------------------------------------------------

/** Datos del receptor tal como van al Cmp de WSFEX */
export interface ReceptorExportacion {
  /** Cliente (razón social, máx. 200) */
  cliente: string
  /** Domicilio_cliente (máx. 300) */
  domicilio: string
  /** Dst_cmp: código ARCA del país de destino */
  dstCmp: number
  /** Cuit_pais_cliente: CUIT genérico del país (null si el país no tiene uno verificado) */
  cuitPais: string | null
  /** Id_impositivo: RUT/RUC/NIT tal como se cargó en el cliente */
  idImpositivo: string | null
}

/** Campos del Customer que se usan (subset del modelo Prisma) */
export interface ClienteParaExportacion {
  name: string
  businessName?: string | null
  type?: string | null // 'BUSINESS' | 'INDIVIDUAL'
  taxCondition?: string | null
  country?: string | null
  address?: string | null
  city?: string | null
  taxIdExterior?: string | null
}

export interface ReceptorExportacionResult {
  /** null si falta algún dato obligatorio (ver faltantes) */
  receptor: ReceptorExportacion | null
  /** Datos que hay que completar en el cliente antes de emitir */
  faltantes: string[]
  /** No bloquean, pero conviene revisarlos */
  advertencias: string[]
  iso: string | null
  pais: string | null
  tipoPersona: TipoPersonaFex
}

const limpiar = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

/**
 * Arma el receptor de la Factura E a partir del cliente del ERP:
 * Cliente = razón social, Domicilio = dirección + ciudad + país,
 * Dst_cmp y Cuit_pais_cliente por ISO del país + tipo de cliente
 * (BUSINESS → persona jurídica, INDIVIDUAL → persona física) e
 * Id_impositivo = Customer.taxIdExterior. Nunca tira: devuelve la lista de
 * datos faltantes para mostrar en el chequeo previo del diálogo.
 */
export function receptorExportacion(c: ClienteParaExportacion): ReceptorExportacionResult {
  const faltantes: string[] = []
  const advertencias: string[] = []
  const tipoPersona: TipoPersonaFex = c.type === 'INDIVIDUAL' ? 'FISICA' : 'JURIDICA'

  if (!esClienteExterior(c)) {
    faltantes.push('El cliente no es del exterior: cargalo como Cliente del exterior con su país')
  }

  const p = paisCliente(c.country)
  const iso = p?.iso ?? null
  const pais = p?.nombre ?? (limpiar(c.country) || null)

  const cliente = limpiar(c.businessName) || limpiar(c.name)
  if (!cliente) faltantes.push('Razón social')

  const address = limpiar(c.address)
  const city = limpiar(c.city)
  if (!address) faltantes.push('Domicilio')
  if (!city) faltantes.push('Ciudad')
  const domicilio = [address, city, pais ?? ''].filter(Boolean).join(', ')

  let dstCmp = 0
  if (!pais) {
    faltantes.push('País')
  } else if (!iso || !DST_PAIS[iso]) {
    faltantes.push(`País sin código de ARCA cargado en el ERP (${pais})`)
  } else {
    dstCmp = DST_PAIS[iso]
  }

  const cuitPais = (iso && DST_CUIT[iso]?.[tipoPersona]) || null
  const idImpositivo = limpiar(c.taxIdExterior) || null
  if (!cuitPais && !idImpositivo) {
    faltantes.push(`${p?.idFiscal ?? 'ID fiscal'} del cliente (${pais ?? 'el país'} no tiene CUIT país verificado)`)
  } else if (!idImpositivo) {
    advertencias.push(`Falta el ${p?.idFiscal ?? 'ID fiscal'} del cliente: la factura sale solo con el CUIT país`)
  }

  const receptor: ReceptorExportacion | null = faltantes.length
    ? null
    : { cliente, domicilio, dstCmp, cuitPais, idImpositivo }

  return { receptor, faltantes, advertencias, iso, pais, tipoPersona }
}
