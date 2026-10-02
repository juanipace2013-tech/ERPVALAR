/**
 * Clientes del exterior (Chile, Paraguay, ...): se cargan solo en el ERP. No se
 * suben a Colppy ni se les emite Factura A/B: se facturan con Factura E de
 * exportación (WSFEX, src/lib/facturacion/factura-exportacion.ts), que en la
 * v1 se carga a mano en Colppy.
 *
 * Customer.cuit sigue siendo la clave única (NOT NULL @unique): para un
 * cliente del exterior guarda una clave canónica "<ISO2>-<ID en mayúsculas
 * sin separadores>" (CL-761234567, PY-800123456) o "<ISO2>-SN-<aleatorio>" si
 * no tiene ID fiscal. El ID tal como se escribió va en Customer.taxIdExterior.
 * Nunca se guarda el "CUIT país" genérico de ARCA: lo comparten todos los
 * clientes de un país y chocaría con el unique.
 */

export interface PaisCliente {
  nombre: string
  iso: string
  /** Cómo se llama el ID fiscal en ese país */
  idFiscal: string
  placeholder: string
}

export const PAISES_CLIENTE: PaisCliente[] = [
  { nombre: 'Argentina', iso: 'AR', idFiscal: 'CUIT', placeholder: '20-12345678-9' },
  { nombre: 'Chile', iso: 'CL', idFiscal: 'RUT', placeholder: '76.123.456-7' },
  { nombre: 'Paraguay', iso: 'PY', idFiscal: 'RUC', placeholder: '80012345-6' },
  { nombre: 'Uruguay', iso: 'UY', idFiscal: 'RUT', placeholder: '211234560018' },
  { nombre: 'Bolivia', iso: 'BO', idFiscal: 'NIT', placeholder: '1234567019' },
  { nombre: 'Brasil', iso: 'BR', idFiscal: 'CNPJ', placeholder: '12.345.678/0001-90' },
  { nombre: 'Perú', iso: 'PE', idFiscal: 'RUC', placeholder: '20123456789' },
  { nombre: 'Ecuador', iso: 'EC', idFiscal: 'RUC', placeholder: '1790012345001' },
  { nombre: 'Colombia', iso: 'CO', idFiscal: 'NIT', placeholder: '900123456-7' },
  { nombre: 'México', iso: 'MX', idFiscal: 'RFC', placeholder: 'ABC123456XYZ' },
  { nombre: 'Estados Unidos', iso: 'US', idFiscal: 'Tax ID', placeholder: '12-3456789' },
  { nombre: 'España', iso: 'ES', idFiscal: 'NIF', placeholder: 'B12345678' },
]

const normalizar = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()

export function paisCliente(nombre: string | null | undefined): PaisCliente | null {
  if (!nombre) return null
  const n = normalizar(nombre)
  return PAISES_CLIENTE.find((p) => normalizar(p.nombre) === n || p.iso.toLowerCase() === n) ?? null
}

export function esArgentina(country: string | null | undefined): boolean {
  return !country || paisCliente(country)?.iso === 'AR'
}

/** Cliente del exterior: condición CLIENTE_EXTERIOR o país distinto de Argentina. */
export function esClienteExterior(c: { taxCondition?: string | null; country?: string | null } | null | undefined): boolean {
  if (!c) return false
  return c.taxCondition === 'CLIENTE_EXTERIOR' || !esArgentina(c.country)
}

/** "RUT", "RUC", "CUIT"... según el país del cliente (default "ID fiscal" para países no listados). */
export function etiquetaIdFiscal(country: string | null | undefined): string {
  if (esArgentina(country)) return 'CUIT'
  return paisCliente(country)?.idFiscal ?? 'ID fiscal'
}

/** ISO2 del país; para países no listados, las dos primeras letras en mayúsculas. */
export function isoPais(country: string): string {
  return paisCliente(country)?.iso ?? (normalizar(country).replace(/[^a-z]/g, '').slice(0, 2).toUpperCase() || 'XX')
}

/** ID fiscal del exterior sin separadores, en mayúsculas (conserva la K del RUT chileno). */
export function normalizarIdExterior(raw: string | null | undefined): string {
  return (raw ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '')
}

/**
 * Clave única que va en Customer.cuit para un cliente del exterior.
 * Con ID: "CL-761234567". Sin ID: "CL-SN-<8 caracteres aleatorios>".
 */
export function claveClienteExterior(country: string, taxId: string | null | undefined, aleatorio?: string): string {
  const iso = isoPais(country)
  const id = normalizarIdExterior(taxId)
  if (id) return `${iso}-${id}`
  const sufijo = (aleatorio ?? Math.random().toString(36).slice(2, 10)).toUpperCase()
  return `${iso}-SN-${sufijo}`
}

/** Texto para mostrar el ID fiscal: el CUIT, el RUT/RUC tal como se cargó, o "Sin ID fiscal". */
export function idFiscalParaMostrar(c: {
  cuit: string
  taxIdExterior?: string | null
  taxCondition?: string | null
  country?: string | null
}): string {
  if (!esClienteExterior(c)) return c.cuit
  if (c.taxIdExterior) return c.taxIdExterior
  return /^[A-Z]{2}-SN-/.test(c.cuit) ? 'Sin ID fiscal' : c.cuit.replace(/^[A-Z]{2}-/, '')
}

/** Clave canónica de un cliente del exterior ("CL-761234567", "PY-SN-AB12CD34"). */
export function esClaveExterior(cuit: string | null | undefined): boolean {
  return /^[A-Z]{2}-/.test(cuit ?? '')
}

/**
 * Parámetro para /api/clientes/by-cuit/[cuit]: la clave exacta para un cliente
 * del exterior; los dígitos del CUIT para uno argentino (null si no alcanza).
 */
export function parametroBusquedaCliente(cuit: string | null | undefined): string | null {
  if (!cuit) return null
  if (esClaveExterior(cuit)) return encodeURIComponent(cuit)
  const digits = cuit.replace(/\D/g, '')
  return digits.length >= 7 ? digits : null
}
