/**
 * Plan de Cuentas Contable Argentino
 * Estructura estándar para comercios y servicios
 */

export interface AccountTemplate {
  code: string
  name: string
  accountType: 'ACTIVO' | 'PASIVO' | 'PATRIMONIO_NETO' | 'INGRESO' | 'EGRESO'
  level: number
  acceptsEntries: boolean
}

export const PLAN_CUENTAS_ARGENTINA: AccountTemplate[] = [
  // ========================================
  // 1. ACTIVO
  // ========================================
  {
    code: '1',
    name: 'ACTIVO',
    accountType: 'ACTIVO',
    level: 1,
    acceptsEntries: false,
  },

  // 1.1 ACTIVO CORRIENTE
  {
    code: '1.1',
    name: 'ACTIVO CORRIENTE',
    accountType: 'ACTIVO',
    level: 2,
    acceptsEntries: false,
  },
  {
    code: '1.1.01',
    name: 'Caja y Bancos',
    accountType: 'ACTIVO',
    level: 3,
    acceptsEntries: false,
  },
  {
    code: '1.1.01.001',
    name: 'Caja',
    accountType: 'ACTIVO',
    level: 4,
    acceptsEntries: true,
  },
  {
    code: '1.1.01.002',
    name: 'Caja Chica',
    accountType: 'ACTIVO',
    level: 4,
    acceptsEntries: true,
  },
  {
    code: '1.1.01.003',
    name: 'Banco Cuenta Corriente',
    accountType: 'ACTIVO',
    level: 4,
    acceptsEntries: true,
  },
  {
    code: '1.1.01.004',
    name: 'Banco Caja de Ahorro',
    accountType: 'ACTIVO',
    level: 4,
    acceptsEntries: true,
  },
  {
    code: '1.1.01.005',
    name: 'Valores a Depositar',
    accountType: 'ACTIVO',
    level: 4,
    acceptsEntries: true,
  },

  {
    code: '1.1.02',
    name: 'Inversiones',
    accountType: 'ACTIVO',
    level: 3,
    acceptsEntries: false,
  },
  {
    code: '1.1.02.001',
    name: 'Plazo Fijo',
    accountType: 'ACTIVO',
    level: 4,
    acceptsEntries: true,
  },

  {
    code: '1.1.03',
    name: 'Créditos por Ventas',
    accountType: 'ACTIVO',
    level: 3,
    acceptsEntries: false,
  },
  {
    code: '1.1.03.001',
    name: 'Deudores por Ventas',
    accountType: 'ACTIVO',
    level: 4,
    acceptsEntries: true,
  },
  {
    code: '1.1.03.002',
    name: 'Documentos a Cobrar',
    accountType: 'ACTIVO',
    level: 4,
    acceptsEntries: true,
  },
  {
    code: '1.1.03.003',
    name: 'Tarjetas de Crédito a Cobrar',
    accountType: 'ACTIVO',
    level: 4,
    acceptsEntries: true,
  },
  {
    code: '1.1.03.004',
    name: 'Cheques de Terceros',
    accountType: 'ACTIVO',
    level: 4,
    acceptsEntries: true,
  },

  {
    code: '1.1.04',
    name: 'Otros Créditos',
    accountType: 'ACTIVO',
    level: 3,
    acceptsEntries: false,
  },
  {
    code: '1.1.04.001',
    name: 'IVA Crédito Fiscal',
    accountType: 'ACTIVO',
    level: 4,
    acceptsEntries: true,
  },
  {
    code: '1.1.04.002',
    name: 'Retenciones y Percepciones a Favor',
    accountType: 'ACTIVO',
    level: 4,
    acceptsEntries: true,
  },
  {
    code: '1.1.04.003',
    name: 'Anticipos a Proveedores',
    accountType: 'ACTIVO',
    level: 4,
    acceptsEntries: true,
  },

  {
    code: '1.1.05',
    name: 'Bienes de Cambio',
    accountType: 'ACTIVO',
    level: 3,
    acceptsEntries: false,
  },
  {
    code: '1.1.05.001',
    name: 'Mercaderías',
    accountType: 'ACTIVO',
    level: 4,
    acceptsEntries: true,
  },
  {
    code: '1.1.05.002',
    name: 'Materias Primas',
    accountType: 'ACTIVO',
    level: 4,
    acceptsEntries: true,
  },
  {
    code: '1.1.05.003',
    name: 'Productos en Proceso',
    accountType: 'ACTIVO',
    level: 4,
    acceptsEntries: true,
  },
  {
    code: '1.1.05.004',
    name: 'Productos Terminados',
    accountType: 'ACTIVO',
    level: 4,
    acceptsEntries: true,
  },

  // 1.2 ACTIVO NO CORRIENTE
  {
    code: '1.2',
    name: 'ACTIVO NO CORRIENTE',
    accountType: 'ACTIVO',
    level: 2,
    acceptsEntries: false,
  },
  {
    code: '1.2.01',
    name: 'Bienes de Uso',
    accountType: 'ACTIVO',
    level: 3,
    acceptsEntries: false,
  },
  {
    code: '1.2.01.001',
    name: 'Inmuebles',
    accountType: 'ACTIVO',
    level: 4,
    acceptsEntries: true,
  },
  {
    code: '1.2.01.002',
    name: 'Rodados',
    accountType: 'ACTIVO',
    level: 4,
    acceptsEntries: true,
  },
  {
    code: '1.2.01.003',
    name: 'Muebles y Útiles',
    accountType: 'ACTIVO',
    level: 4,
    acceptsEntries: true,
  },
  {
    code: '1.2.01.004',
    name: 'Máquinas y Equipos',
    accountType: 'ACTIVO',
    level: 4,
    acceptsEntries: true,
  },
  {
    code: '1.2.01.005',
    name: 'Equipos de Computación',
    accountType: 'ACTIVO',
    level: 4,
    acceptsEntries: true,
  },
  {
    code: '1.2.01.006',
    name: 'Instalaciones',
    accountType: 'ACTIVO',
    level: 4,
    acceptsEntries: true,
  },

  {
    code: '1.2.02',
    name: 'Depreciaciones',
    accountType: 'ACTIVO',
    level: 3,
    acceptsEntries: false,
  },
  {
    code: '1.2.02.001',
    name: 'Depreciación Acumulada Rodados',
    accountType: 'ACTIVO',
    level: 4,
    acceptsEntries: true,
  },
  {
    code: '1.2.02.002',
    name: 'Depreciación Acumulada Muebles y Útiles',
    accountType: 'ACTIVO',
    level: 4,
    acceptsEntries: true,
  },
  {
    code: '1.2.02.003',
    name: 'Depreciación Acumulada Máquinas y Equipos',
    accountType: 'ACTIVO',
    level: 4,
    acceptsEntries: true,
  },
  {
    code: '1.2.02.004',
    name: 'Depreciación Acumulada Equipos de Computación',
    accountType: 'ACTIVO',
    level: 4,
    acceptsEntries: true,
  },

  // ========================================
  // 2. PASIVO
  // ========================================
  {
    code: '2',
    name: 'PASIVO',
    accountType: 'PASIVO',
    level: 1,
    acceptsEntries: false,
  },

  // 2.1 PASIVO CORRIENTE
  {
    code: '2.1',
    name: 'PASIVO CORRIENTE',
    accountType: 'PASIVO',
    level: 2,
    acceptsEntries: false,
  },
  {
    code: '2.1.01',
    name: 'Deudas Comerciales',
    accountType: 'PASIVO',
    level: 3,
    acceptsEntries: false,
  },
  {
    code: '2.1.01.001',
    name: 'Proveedores',
    accountType: 'PASIVO',
    level: 4,
    acceptsEntries: true,
  },
  {
    code: '2.1.01.002',
    name: 'Documentos a Pagar',
    accountType: 'PASIVO',
    level: 4,
    acceptsEntries: true,
  },
  {
    code: '2.1.01.003',
    name: 'Anticipos de Clientes',
    accountType: 'PASIVO',
    level: 4,
    acceptsEntries: true,
  },

  {
    code: '2.1.02',
    name: 'Deudas Fiscales',
    accountType: 'PASIVO',
    level: 3,
    acceptsEntries: false,
  },
  {
    code: '2.1.02.001',
    name: 'IVA Débito Fiscal',
    accountType: 'PASIVO',
    level: 4,
    acceptsEntries: true,
  },
  {
    code: '2.1.02.002',
    name: 'IVA a Pagar',
    accountType: 'PASIVO',
    level: 4,
    acceptsEntries: true,
  },
  {
    code: '2.1.02.003',
    name: 'Retenciones a Pagar',
    accountType: 'PASIVO',
    level: 4,
    acceptsEntries: true,
  },
  {
    code: '2.1.02.004',
    name: 'Percepciones a Pagar',
    accountType: 'PASIVO',
    level: 4,
    acceptsEntries: true,
  },
  {
    code: '2.1.02.005',
    name: 'Ganancias a Pagar',
    accountType: 'PASIVO',
    level: 4,
    acceptsEntries: true,
  },
  {
    code: '2.1.02.006',
    name: 'IIBB a Pagar',
    accountType: 'PASIVO',
    level: 4,
    acceptsEntries: true,
  },

  {
    code: '2.1.03',
    name: 'Deudas Sociales',
    accountType: 'PASIVO',
    level: 3,
    acceptsEntries: false,
  },
  {
    code: '2.1.03.001',
    name: 'Sueldos a Pagar',
    accountType: 'PASIVO',
    level: 4,
    acceptsEntries: true,
  },
  {
    code: '2.1.03.002',
    name: 'Cargas Sociales a Pagar',
    accountType: 'PASIVO',
    level: 4,
    acceptsEntries: true,
  },
  {
    code: '2.1.03.003',
    name: 'Aportes y Contribuciones a Pagar',
    accountType: 'PASIVO',
    level: 4,
    acceptsEntries: true,
  },

  {
    code: '2.1.04',
    name: 'Deudas Bancarias y Financieras',
    accountType: 'PASIVO',
    level: 3,
    acceptsEntries: false,
  },
  {
    code: '2.1.04.001',
    name: 'Préstamos Bancarios',
    accountType: 'PASIVO',
    level: 4,
    acceptsEntries: true,
  },
  {
    code: '2.1.04.002',
    name: 'Descubierto Bancario',
    accountType: 'PASIVO',
    level: 4,
    acceptsEntries: true,
  },
  {
    code: '2.1.04.003',
    name: 'Tarjetas de Crédito',
    accountType: 'PASIVO',
    level: 4,
    acceptsEntries: true,
  },

  // 2.2 PASIVO NO CORRIENTE
  {
    code: '2.2',
    name: 'PASIVO NO CORRIENTE',
    accountType: 'PASIVO',
    level: 2,
    acceptsEntries: false,
  },
  {
    code: '2.2.01',
    name: 'Deudas a Largo Plazo',
    accountType: 'PASIVO',
    level: 3,
    acceptsEntries: false,
  },
  {
    code: '2.2.01.001',
    name: 'Préstamos a Largo Plazo',
    accountType: 'PASIVO',
    level: 4,
    acceptsEntries: true,
  },
  {
    code: '2.2.01.002',
    name: 'Hipotecas a Pagar',
    accountType: 'PASIVO',
    level: 4,
    acceptsEntries: true,
  },

  // ========================================
  // 3. PATRIMONIO NETO
  // ========================================
  {
    code: '3',
    name: 'PATRIMONIO NETO',
    accountType: 'PATRIMONIO_NETO',
    level: 1,
    acceptsEntries: false,
  },
  {
    code: '3.1',
    name: 'Capital',
    accountType: 'PATRIMONIO_NETO',
    level: 2,
    acceptsEntries: false,
  },
  {
    code: '3.1.01',
    name: 'Capital Social',
    accountType: 'PATRIMONIO_NETO',
    level: 3,
    acceptsEntries: true,
  },
  {
    code: '3.1.02',
    name: 'Aportes de Socios',
    accountType: 'PATRIMONIO_NETO',
    level: 3,
    acceptsEntries: true,
  },

  {
    code: '3.2',
    name: 'Resultados',
    accountType: 'PATRIMONIO_NETO',
    level: 2,
    acceptsEntries: false,
  },
  {
    code: '3.2.01',
    name: 'Resultados Acumulados',
    accountType: 'PATRIMONIO_NETO',
    level: 3,
    acceptsEntries: true,
  },
  {
    code: '3.2.02',
    name: 'Resultado del Ejercicio',
    accountType: 'PATRIMONIO_NETO',
    level: 3,
    acceptsEntries: true,
  },

  // ========================================
  // 4. INGRESOS
  // ========================================
  {
    code: '4',
    name: 'INGRESOS',
    accountType: 'INGRESO',
    level: 1,
    acceptsEntries: false,
  },
  {
    code: '4.1',
    name: 'Ingresos por Ventas',
    accountType: 'INGRESO',
    level: 2,
    acceptsEntries: false,
  },
  {
    code: '4.1.01',
    name: 'Ventas',
    accountType: 'INGRESO',
    level: 3,
    acceptsEntries: true,
  },
  {
    code: '4.1.02',
    name: 'Ventas Exportación',
    accountType: 'INGRESO',
    level: 3,
    acceptsEntries: true,
  },
  {
    code: '4.1.03',
    name: 'Servicios Prestados',
    accountType: 'INGRESO',
    level: 3,
    acceptsEntries: true,
  },

  {
    code: '4.2',
    name: 'Otros Ingresos',
    accountType: 'INGRESO',
    level: 2,
    acceptsEntries: false,
  },
  {
    code: '4.2.01',
    name: 'Intereses Ganados',
    accountType: 'INGRESO',
    level: 3,
    acceptsEntries: true,
  },
  {
    code: '4.2.02',
    name: 'Descuentos Obtenidos',
    accountType: 'INGRESO',
    level: 3,
    acceptsEntries: true,
  },
  {
    code: '4.2.03',
    name: 'Diferencias de Cambio Positivas',
    accountType: 'INGRESO',
    level: 3,
    acceptsEntries: true,
  },

  // ========================================
  // 5. EGRESOS
  // ========================================
  {
    code: '5',
    name: 'EGRESOS',
    accountType: 'EGRESO',
    level: 1,
    acceptsEntries: false,
  },

  {
    code: '5.1',
    name: 'Costo de Ventas',
    accountType: 'EGRESO',
    level: 2,
    acceptsEntries: false,
  },
  {
    code: '5.1.01',
    name: 'Costo de Mercaderías Vendidas',
    accountType: 'EGRESO',
    level: 3,
    acceptsEntries: true,
  },
  {
    code: '5.1.02',
    name: 'Compras',
    accountType: 'EGRESO',
    level: 3,
    acceptsEntries: true,
  },

  {
    code: '5.2',
    name: 'Gastos de Administración',
    accountType: 'EGRESO',
    level: 2,
    acceptsEntries: false,
  },
  {
    code: '5.2.01',
    name: 'Sueldos y Jornales',
    accountType: 'EGRESO',
    level: 3,
    acceptsEntries: true,
  },
  {
    code: '5.2.02',
    name: 'Cargas Sociales',
    accountType: 'EGRESO',
    level: 3,
    acceptsEntries: true,
  },
  {
    code: '5.2.03',
    name: 'Honorarios Profesionales',
    accountType: 'EGRESO',
    level: 3,
    acceptsEntries: true,
  },
  {
    code: '5.2.04',
    name: 'Servicios Públicos',
    accountType: 'EGRESO',
    level: 3,
    acceptsEntries: true,
  },
  {
    code: '5.2.05',
    name: 'Alquileres',
    accountType: 'EGRESO',
    level: 3,
    acceptsEntries: true,
  },
  {
    code: '5.2.06',
    name: 'Seguros',
    accountType: 'EGRESO',
    level: 3,
    acceptsEntries: true,
  },
  {
    code: '5.2.07',
    name: 'Impuestos y Tasas',
    accountType: 'EGRESO',
    level: 3,
    acceptsEntries: true,
  },
  {
    code: '5.2.08',
    name: 'Gastos de Oficina',
    accountType: 'EGRESO',
    level: 3,
    acceptsEntries: true,
  },
  {
    code: '5.2.09',
    name: 'Mantenimiento y Reparaciones',
    accountType: 'EGRESO',
    level: 3,
    acceptsEntries: true,
  },
  {
    code: '5.2.10',
    name: 'Depreciaciones',
    accountType: 'EGRESO',
    level: 3,
    acceptsEntries: true,
  },

  {
    code: '5.3',
    name: 'Gastos de Comercialización',
    accountType: 'EGRESO',
    level: 2,
    acceptsEntries: false,
  },
  {
    code: '5.3.01',
    name: 'Comisiones sobre Ventas',
    accountType: 'EGRESO',
    level: 3,
    acceptsEntries: true,
  },
  {
    code: '5.3.02',
    name: 'Publicidad y Propaganda',
    accountType: 'EGRESO',
    level: 3,
    acceptsEntries: true,
  },
  {
    code: '5.3.03',
    name: 'Gastos de Distribución',
    accountType: 'EGRESO',
    level: 3,
    acceptsEntries: true,
  },
  {
    code: '5.3.04',
    name: 'Fletes y Acarreos',
    accountType: 'EGRESO',
    level: 3,
    acceptsEntries: true,
  },

  {
    code: '5.4',
    name: 'Gastos Financieros',
    accountType: 'EGRESO',
    level: 2,
    acceptsEntries: false,
  },
  {
    code: '5.4.01',
    name: 'Intereses Perdidos',
    accountType: 'EGRESO',
    level: 3,
    acceptsEntries: true,
  },
  {
    code: '5.4.02',
    name: 'Gastos Bancarios',
    accountType: 'EGRESO',
    level: 3,
    acceptsEntries: true,
  },
  {
    code: '5.4.03',
    name: 'Diferencias de Cambio Negativas',
    accountType: 'EGRESO',
    level: 3,
    acceptsEntries: true,
  },
  {
    code: '5.4.04',
    name: 'Descuentos Otorgados',
    accountType: 'EGRESO',
    level: 3,
    acceptsEntries: true,
  },
]
