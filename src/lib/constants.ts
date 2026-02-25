// ========================================
// ROLES Y PERMISOS
// ========================================

export const USER_ROLES = {
  ADMIN: 'ADMIN',
  GERENTE: 'GERENTE',
  VENDEDOR: 'VENDEDOR',
  CONTADOR: 'CONTADOR',
} as const

export const ROLE_LABELS = {
  ADMIN: 'Administrador',
  GERENTE: 'Gerente',
  VENDEDOR: 'Vendedor',
  CONTADOR: 'Contador',
}

// ========================================
// DATOS ARGENTINOS
// ========================================

export const PROVINCIAS_ARGENTINA = [
  'Buenos Aires',
  'Catamarca',
  'Chaco',
  'Chubut',
  'Ciudad Autónoma de Buenos Aires',
  'Córdoba',
  'Corrientes',
  'Entre Ríos',
  'Formosa',
  'Jujuy',
  'La Pampa',
  'La Rioja',
  'Mendoza',
  'Misiones',
  'Neuquén',
  'Río Negro',
  'Salta',
  'San Juan',
  'San Luis',
  'Santa Cruz',
  'Santa Fe',
  'Santiago del Estero',
  'Tierra del Fuego',
  'Tucumán',
]

export const CONDICIONES_IVA = [
  { value: 'RESPONSABLE_INSCRIPTO', label: 'Responsable Inscripto' },
  { value: 'MONOTRIBUTO', label: 'Monotributo' },
  { value: 'EXENTO', label: 'Exento' },
  { value: 'CONSUMIDOR_FINAL', label: 'Consumidor Final' },
  { value: 'NO_RESPONSABLE', label: 'No Responsable' },
  { value: 'RESPONSABLE_NO_INSCRIPTO', label: 'Responsable No Inscripto' },
]

export const TIPOS_FACTURA = [
  { value: 'A', label: 'Factura A' },
  { value: 'B', label: 'Factura B' },
  { value: 'C', label: 'Factura C' },
  { value: 'E', label: 'Factura E (Exportación)' },
]

export const IVA_RATES = {
  GENERAL: 21,
  REDUCIDO: 10.5,
  EXENTO: 0,
}

// ========================================
// MONEDAS
// ========================================

export const CURRENCIES = [
  { value: 'ARS', label: 'Peso Argentino (ARS)', symbol: 'ARS' },
  { value: 'USD', label: 'Dólar Estadounidense (USD)', symbol: 'USD' },
  { value: 'EUR', label: 'Euro (EUR)', symbol: 'EUR' },
]

export const CURRENCY_SYMBOLS: Record<string, string> = {
  ARS: 'ARS',
  USD: 'USD',
  EUR: 'EUR',
}

// ========================================
// PRODUCTOS
// ========================================

export const PRICE_TYPES = [
  { value: 'COST', label: 'Costo' },
  { value: 'SALE', label: 'Venta' },
  { value: 'LIST', label: 'Lista' },
  { value: 'WHOLESALE', label: 'Mayorista' },
]

export const PRODUCT_STATUS = [
  { value: 'ACTIVE', label: 'Activo' },
  { value: 'INACTIVE', label: 'Inactivo' },
  { value: 'DISCONTINUED', label: 'Discontinuado' },
]

export const UNITS = [
  { value: 'UN', label: 'Unidad' },
  { value: 'KG', label: 'Kilogramo' },
  { value: 'LT', label: 'Litro' },
  { value: 'MT', label: 'Metro' },
  { value: 'M2', label: 'Metro Cuadrado' },
  { value: 'M3', label: 'Metro Cúbico' },
  { value: 'CAJA', label: 'Caja' },
  { value: 'PAQ', label: 'Paquete' },
  { value: 'DOC', label: 'Docena' },
]

// ========================================
// CRM - OPORTUNIDADES
// ========================================

export const OPPORTUNITY_STAGES = [
  { value: 'LEAD', label: 'Prospecto', color: 'gray' },
  { value: 'QUALIFIED', label: 'Calificado', color: 'blue' },
  { value: 'PROPOSAL', label: 'Propuesta', color: 'yellow' },
  { value: 'NEGOTIATION', label: 'Negociación', color: 'orange' },
  { value: 'CLOSED_WON', label: 'Ganada', color: 'green' },
  { value: 'CLOSED_LOST', label: 'Perdida', color: 'red' },
]

export const OPPORTUNITY_PRIORITIES = [
  { value: 'LOW', label: 'Baja', color: 'gray' },
  { value: 'MEDIUM', label: 'Media', color: 'blue' },
  { value: 'HIGH', label: 'Alta', color: 'orange' },
  { value: 'URGENT', label: 'Urgente', color: 'red' },
]

// ========================================
// ESTADOS
// ========================================

export const CUSTOMER_STATUS = [
  { value: 'ACTIVE', label: 'Activo', color: 'green' },
  { value: 'INACTIVE', label: 'Inactivo', color: 'gray' },
  { value: 'BLOCKED', label: 'Bloqueado', color: 'red' },
]

export const QUOTE_STATUS = [
  { value: 'DRAFT', label: 'Borrador', color: 'gray' },
  { value: 'SENT', label: 'Enviada', color: 'blue' },
  { value: 'ACCEPTED', label: 'Aceptada', color: 'green' },
  { value: 'REJECTED', label: 'Rechazada', color: 'red' },
  { value: 'EXPIRED', label: 'Vencida', color: 'orange' },
]

export const INVOICE_STATUS = [
  { value: 'DRAFT', label: 'Borrador', color: 'gray' },
  { value: 'PENDING', label: 'Pendiente', color: 'yellow' },
  { value: 'AUTHORIZED', label: 'Autorizada', color: 'blue' },
  { value: 'SENT', label: 'Enviada', color: 'blue' },
  { value: 'PAID', label: 'Pagada', color: 'green' },
  { value: 'OVERDUE', label: 'Vencida', color: 'red' },
  { value: 'CANCELLED', label: 'Cancelada', color: 'red' },
]

// ========================================
// PAGINACIÓN
// ========================================

export const ITEMS_PER_PAGE = 20
export const ITEMS_PER_PAGE_OPTIONS = [10, 20, 50, 100]

// ========================================
// CONFIGURACIÓN
// ========================================

export const APP_NAME = 'Valarg ERP/CRM'
export const APP_DESCRIPTION = 'Sistema de gestión empresarial para distribuidora industrial'
