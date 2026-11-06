/**
 * Cuentas contables de Colppy para imputar líneas de facturas de compra que
 * no son mercadería (seguros, gastos bancarios, etc.).
 *
 * Es la lista que muestra el front de Colppy al cargar una factura de compra
 * (GL_PlanDeCuentas.php, PHP interno que la API no expone), copiada el
 * 6/11/2026. En `alta_facturacompra` la cuenta va POR NOMBRE en
 * `itemsFactura[].idPlanCuenta` (captura real: FC A 00031-00346507 de Visuar a
 * "Gastos Galpon"). Los nombres van tal cual están en Colppy, con sus
 * espacios finales ("Fletes y Transporte ").
 *
 * Si en Colppy se agrega o renombra una cuenta, hay que actualizar esta lista.
 */

export interface CuentaColppy {
  codigo: string
  nombre: string
}

/** Las que más se usan para gastos: van primero en el selector */
export const CUENTAS_GASTO_FRECUENTES = [
  'Seguros',
  'Gastos Bancarios',
  'Gastos Galpon',
  'Gastos de oficina',
  'Gastos Varios',
  'Fletes y Transporte ',
  'Comunicaciones',
  'Energía Eléctrica',
  'Honorarios',
  'Mantenimiento y Limpieza',
  'Papeleria y Utiles de Oficina',
  'Sistema Contable',
  'Impuestos y Tasas',
]

export const CUENTAS_COLPPY: CuentaColppy[] = [
  { codigo: '114303', nombre: 'Activo por impuesto diferido' },
  { codigo: '521126', nombre: 'ACUERDOS EXTRAJUDICIALES' },
  { codigo: '114109', nombre: 'Adelantos al Personal' },
  { codigo: '521111', nombre: 'Agua' },
  { codigo: '521116', nombre: 'Alquileres' },
  { codigo: '521112', nombre: 'Amortizaciones' },
  { codigo: '114212', nombre: 'Anticipo IIGG' },
  { codigo: '115200', nombre: 'Anticipos a Proveedores' },
  { codigo: '440010', nombre: 'ATP Sueldos' },
  { codigo: '521101', nombre: 'Cargas Sociales' },
  { codigo: '541003', nombre: 'Comisiones Por Venta' },
  { codigo: '521107', nombre: 'Comunicaciones' },
  { codigo: '511100', nombre: 'Costo de Mercaderia Vendida' },
  { codigo: '511200', nombre: 'Costo de servicios' },
  { codigo: '116101', nombre: 'Cuenta Particular Socios' },
  { codigo: '114410', nombre: 'Deposito en garantia' },
  { codigo: '541002', nombre: 'Descuentos' },
  { codigo: '541004', nombre: 'Diferencia de Cambio' },
  { codigo: '511300', nombre: 'Diferencia de Invetario' },
  { codigo: '114305', nombre: 'DT.301/03-TUCUMAN' },
  { codigo: '521110', nombre: 'Energía Eléctrica' },
  { codigo: '521127', nombre: 'Fletes y Transporte ' },
  { codigo: '125202', nombre: 'Fondo de Amortiz Maquinarias' },
  { codigo: '125203', nombre: 'Fondo de Amortiz Muebles y Utiles' },
  { codigo: '125201', nombre: 'Fondo de Amortiz Rodados' },
  { codigo: '125204', nombre: 'Fondo de Amortiz. Hardware' },
  { codigo: '521113', nombre: 'Gastos Bancarios' },
  { codigo: '521128', nombre: 'Gastos de oficina' },
  { codigo: '521120', nombre: 'Gastos Galpon' },
  { codigo: '521115', nombre: 'Gastos Varios' },
  { codigo: '125104', nombre: 'Hardware' },
  { codigo: '521122', nombre: 'Herramientas ' },
  { codigo: '521102', nombre: 'Honorarios' },
  { codigo: '521125', nombre: 'Honorarios Gerencia' },
  { codigo: '114211', nombre: 'IIBB Saldo a Favor Bs. As.' },
  { codigo: '114210', nombre: 'IIBB Saldo a Favor CABA' },
  { codigo: '114213', nombre: 'IIBB Saldo a Favor Catamarca ' },
  { codigo: '114218', nombre: 'IIBB Saldo a favor Chaco' },
  { codigo: '114233', nombre: 'IIBB Saldo a Favor Chubut' },
  { codigo: '114217', nombre: 'IIBB Saldo a favor Cordoba' },
  { codigo: '114224', nombre: 'IIBB Saldo a favor Corrientes' },
  { codigo: '114219', nombre: 'IIBB Saldo a favor Entre Rios' },
  { codigo: '114223', nombre: 'IIBB Saldo a Favor Formosa' },
  { codigo: '114214', nombre: 'IIBB Saldo a favor Jujuy' },
  { codigo: '114226', nombre: 'IIBB Saldo a favor La Pampa' },
  { codigo: '114227', nombre: 'IIBB Saldo a favor La Rioja' },
  { codigo: '114225', nombre: 'IIBB Saldo a favor Mendoza' },
  { codigo: '114228', nombre: 'IIBB Saldo a favor Misiones' },
  { codigo: '114229', nombre: 'IIBB Saldo a favor Rio Negro' },
  { codigo: '114220', nombre: 'IIBB Saldo a favor Salta' },
  { codigo: '114230', nombre: 'IIBB Saldo a favor San Juan' },
  { codigo: '114232', nombre: 'IIBB Saldo a favor San Luis' },
  { codigo: '114216', nombre: 'IIBB Saldo a favor Santa Cruz' },
  { codigo: '114222', nombre: 'IIBB Saldo a Favor Santa Fe' },
  { codigo: '114215', nombre: 'IIBB Saldo a favor Santiago del Estero' },
  { codigo: '114231', nombre: 'IIBB Saldo a favor Tierra del Fuego' },
  { codigo: '114221', nombre: 'IIBB Saldo a favor Tucuman' },
  { codigo: '530200', nombre: 'Impuesto Autónomo Socios' },
  { codigo: '521114', nombre: 'Impuestos Deb/Cred CtaCte' },
  { codigo: '530300', nombre: 'Impuestos Ingresos Brutos' },
  { codigo: '521103', nombre: 'Impuestos y Tasas' },
  { codigo: '125100', nombre: 'Inmuebles' },
  { codigo: '541001', nombre: 'Intereses' },
  { codigo: '420010', nombre: 'Intereses Ganados' },
  { codigo: '114103', nombre: 'IVA CF DTO 814' },
  { codigo: '114203', nombre: 'IVA Saldo Tecnico a Favor' },
  { codigo: '521121', nombre: 'Mantenimiento Rodados' },
  { codigo: '521104', nombre: 'Mantenimiento y Limpieza' },
  { codigo: '125102', nombre: 'Maquinarias' },
  { codigo: '115100', nombre: 'Mercaderías' },
  { codigo: '125103', nombre: 'Muebles y Utiles' },
  { codigo: '521124', nombre: 'Multas' },
  { codigo: '521123', nombre: 'Otros egresos' },
  { codigo: '521105', nombre: 'Papeleria y Utiles de Oficina' },
  { codigo: '521119', nombre: 'Peajes' },
  { codigo: '521118', nombre: 'Publicidad' },
  { codigo: '541006', nombre: 'RECPAM' },
  { codigo: '541005', nombre: 'Redondeo' },
  { codigo: '114108', nombre: 'Ret Imp a las Ganancias a depositar' },
  { codigo: '114302', nombre: 'Ret SIRCREB' },
  { codigo: '114101', nombre: 'Ret Sufridas Imp Ganancias' },
  { codigo: '115101', nombre: 'Retención Impuesto Ley 25.413 ' },
  { codigo: '125101', nombre: 'Rodados' },
  { codigo: '115102', nombre: 'Saldo a favor IIGG' },
  { codigo: '999999', nombre: 'Saldos Iniciales' },
  { codigo: '521109', nombre: 'Seguridad' },
  { codigo: '521108', nombre: 'Seguros' },
  { codigo: '114304', nombre: 'SIRTAC' },
  { codigo: '521117', nombre: 'Sistema Contable' },
  { codigo: '521100', nombre: 'Sueldos' },
  { codigo: '521106', nombre: 'Viaticos y Movilidad' },
]

/**
 * Cuentas que se pueden elegir para una línea de gasto: todas menos
 * Mercaderías (esa es la línea de artículo de siempre, con stock).
 */
export const CUENTAS_GASTO: CuentaColppy[] = CUENTAS_COLPPY.filter((c) => c.codigo !== '115100')

const POR_NOMBRE = new Map(CUENTAS_GASTO.map((c) => [c.nombre, c]))

/** La cuenta de gasto con ese nombre exacto (como en Colppy), o null */
export function cuentaGasto(nombre: string | null | undefined): CuentaColppy | null {
  if (!nombre) return null
  return POR_NOMBRE.get(nombre) ?? null
}

/** Las frecuentes primero (en su orden) y después el resto alfabético */
export function cuentasGastoOrdenadas(): { frecuentes: CuentaColppy[]; resto: CuentaColppy[] } {
  const frecuentes = CUENTAS_GASTO_FRECUENTES.map((n) => POR_NOMBRE.get(n)).filter((c): c is CuentaColppy => !!c)
  const enFrecuentes = new Set(frecuentes.map((c) => c.codigo))
  const resto = CUENTAS_GASTO.filter((c) => !enFrecuentes.has(c.codigo)).sort((a, b) => a.nombre.trim().localeCompare(b.nombre.trim(), 'es'))
  return { frecuentes, resto }
}
