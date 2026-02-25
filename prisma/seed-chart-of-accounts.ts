/**
 * Seed para Plan de Cuentas de VAL ARG
 * Estructura jerárquica completa con 4 niveles
 */

import { PrismaClient, AccountType } from '@prisma/client';

const prisma = new PrismaClient();

interface AccountData {
  code: string;
  name: string;
  accountType: AccountType;
  category?: string;
  level: number;
  isDetailAccount: boolean;
  parentCode?: string;
}

const accounts: AccountData[] = [
  // ========================================
  // 1. ACTIVO
  // ========================================
  { code: '1', name: 'ACTIVO', accountType: 'ACTIVO', level: 1, isDetailAccount: false },

  // 1.1 ACTIVO CORRIENTE
  { code: '1.1', name: 'ACTIVO CORRIENTE', accountType: 'ACTIVO', level: 2, isDetailAccount: false, parentCode: '1' },

  // 1.1.1 CAJA Y BANCOS
  { code: '1.1.1', name: 'CAJA Y BANCOS', accountType: 'ACTIVO', category: 'CAJA_Y_BANCOS', level: 3, isDetailAccount: false, parentCode: '1.1' },
  { code: '1.1.1.001', name: 'Caja en Pesos', accountType: 'ACTIVO', category: 'CAJA_Y_BANCOS', level: 4, isDetailAccount: true, parentCode: '1.1.1' },
  { code: '1.1.1.002', name: 'Caja en Dólares', accountType: 'ACTIVO', category: 'CAJA_Y_BANCOS', level: 4, isDetailAccount: true, parentCode: '1.1.1' },
  { code: '1.1.1.003', name: 'Caja en Euros', accountType: 'ACTIVO', category: 'CAJA_Y_BANCOS', level: 4, isDetailAccount: true, parentCode: '1.1.1' },
  { code: '1.1.1.010', name: 'Banco Galicia Cuenta Corriente', accountType: 'ACTIVO', category: 'CAJA_Y_BANCOS', level: 4, isDetailAccount: true, parentCode: '1.1.1' },
  { code: '1.1.1.011', name: 'Banco Galicia Caja de Ahorro', accountType: 'ACTIVO', category: 'CAJA_Y_BANCOS', level: 4, isDetailAccount: true, parentCode: '1.1.1' },
  { code: '1.1.1.012', name: 'Banco Supervielle Cuenta Corriente', accountType: 'ACTIVO', category: 'CAJA_Y_BANCOS', level: 4, isDetailAccount: true, parentCode: '1.1.1' },
  { code: '1.1.1.020', name: 'Valores a Depositar', accountType: 'ACTIVO', category: 'CAJA_Y_BANCOS', level: 4, isDetailAccount: true, parentCode: '1.1.1' },
  { code: '1.1.1.021', name: 'Cheques Diferidos', accountType: 'ACTIVO', category: 'CAJA_Y_BANCOS', level: 4, isDetailAccount: true, parentCode: '1.1.1' },

  // 1.1.2 CRÉDITOS POR VENTAS
  { code: '1.1.2', name: 'CRÉDITOS POR VENTAS', accountType: 'ACTIVO', category: 'CREDITOS_VENTAS', level: 3, isDetailAccount: false, parentCode: '1.1' },
  { code: '1.1.2.001', name: 'Deudores por Ventas', accountType: 'ACTIVO', category: 'CREDITOS_VENTAS', level: 4, isDetailAccount: true, parentCode: '1.1.2' },
  { code: '1.1.2.002', name: 'Deudores Morosos', accountType: 'ACTIVO', category: 'CREDITOS_VENTAS', level: 4, isDetailAccount: true, parentCode: '1.1.2' },
  { code: '1.1.2.003', name: 'Previsión para Deudores Incobrables', accountType: 'ACTIVO', category: 'CREDITOS_VENTAS', level: 4, isDetailAccount: true, parentCode: '1.1.2' },
  { code: '1.1.2.010', name: 'Documentos a Cobrar', accountType: 'ACTIVO', category: 'CREDITOS_VENTAS', level: 4, isDetailAccount: true, parentCode: '1.1.2' },
  { code: '1.1.2.011', name: 'Tarjetas de Crédito a Cobrar', accountType: 'ACTIVO', category: 'CREDITOS_VENTAS', level: 4, isDetailAccount: true, parentCode: '1.1.2' },

  // 1.1.3 OTROS CRÉDITOS
  { code: '1.1.3', name: 'OTROS CRÉDITOS', accountType: 'ACTIVO', category: 'OTROS_CREDITOS', level: 3, isDetailAccount: false, parentCode: '1.1' },
  { code: '1.1.3.001', name: 'IVA Crédito Fiscal', accountType: 'ACTIVO', category: 'OTROS_CREDITOS', level: 4, isDetailAccount: true, parentCode: '1.1.3' },
  { code: '1.1.3.002', name: 'IVA Percepciones', accountType: 'ACTIVO', category: 'OTROS_CREDITOS', level: 4, isDetailAccount: true, parentCode: '1.1.3' },
  { code: '1.1.3.003', name: 'Retenciones Sufridas Impuesto a las Ganancias', accountType: 'ACTIVO', category: 'OTROS_CREDITOS', level: 4, isDetailAccount: true, parentCode: '1.1.3' },
  { code: '1.1.3.004', name: 'Retenciones Sufridas IIBB', accountType: 'ACTIVO', category: 'OTROS_CREDITOS', level: 4, isDetailAccount: true, parentCode: '1.1.3' },
  { code: '1.1.3.005', name: 'Retenciones Sufridas SUSS', accountType: 'ACTIVO', category: 'OTROS_CREDITOS', level: 4, isDetailAccount: true, parentCode: '1.1.3' },
  { code: '1.1.3.010', name: 'Anticipos a Proveedores', accountType: 'ACTIVO', category: 'OTROS_CREDITOS', level: 4, isDetailAccount: true, parentCode: '1.1.3' },
  { code: '1.1.3.011', name: 'Anticipos al Personal', accountType: 'ACTIVO', category: 'OTROS_CREDITOS', level: 4, isDetailAccount: true, parentCode: '1.1.3' },
  { code: '1.1.3.012', name: 'Gastos Pagados por Adelantado', accountType: 'ACTIVO', category: 'OTROS_CREDITOS', level: 4, isDetailAccount: true, parentCode: '1.1.3' },

  // 1.1.4 BIENES DE CAMBIO
  { code: '1.1.4', name: 'BIENES DE CAMBIO', accountType: 'ACTIVO', category: 'BIENES_CAMBIO', level: 3, isDetailAccount: false, parentCode: '1.1' },
  { code: '1.1.4.001', name: 'Mercaderías', accountType: 'ACTIVO', category: 'BIENES_CAMBIO', level: 4, isDetailAccount: true, parentCode: '1.1.4' },
  { code: '1.1.4.002', name: 'Mercaderías en Tránsito', accountType: 'ACTIVO', category: 'BIENES_CAMBIO', level: 4, isDetailAccount: true, parentCode: '1.1.4' },
  { code: '1.1.4.003', name: 'Mercaderías en Consignación', accountType: 'ACTIVO', category: 'BIENES_CAMBIO', level: 4, isDetailAccount: true, parentCode: '1.1.4' },

  // 1.2 ACTIVO NO CORRIENTE
  { code: '1.2', name: 'ACTIVO NO CORRIENTE', accountType: 'ACTIVO', level: 2, isDetailAccount: false, parentCode: '1' },

  // 1.2.1 BIENES DE USO
  { code: '1.2.1', name: 'BIENES DE USO', accountType: 'ACTIVO', category: 'BIENES_USO', level: 3, isDetailAccount: false, parentCode: '1.2' },
  { code: '1.2.1.001', name: 'Inmuebles', accountType: 'ACTIVO', category: 'BIENES_USO', level: 4, isDetailAccount: true, parentCode: '1.2.1' },
  { code: '1.2.1.002', name: 'Rodados', accountType: 'ACTIVO', category: 'BIENES_USO', level: 4, isDetailAccount: true, parentCode: '1.2.1' },
  { code: '1.2.1.003', name: 'Muebles y Útiles', accountType: 'ACTIVO', category: 'BIENES_USO', level: 4, isDetailAccount: true, parentCode: '1.2.1' },
  { code: '1.2.1.004', name: 'Equipos de Computación', accountType: 'ACTIVO', category: 'BIENES_USO', level: 4, isDetailAccount: true, parentCode: '1.2.1' },
  { code: '1.2.1.005', name: 'Instalaciones', accountType: 'ACTIVO', category: 'BIENES_USO', level: 4, isDetailAccount: true, parentCode: '1.2.1' },
  { code: '1.2.1.010', name: 'Amortización Acumulada Inmuebles', accountType: 'ACTIVO', category: 'BIENES_USO', level: 4, isDetailAccount: true, parentCode: '1.2.1' },
  { code: '1.2.1.011', name: 'Amortización Acumulada Rodados', accountType: 'ACTIVO', category: 'BIENES_USO', level: 4, isDetailAccount: true, parentCode: '1.2.1' },
  { code: '1.2.1.012', name: 'Amortización Acumulada Muebles y Útiles', accountType: 'ACTIVO', category: 'BIENES_USO', level: 4, isDetailAccount: true, parentCode: '1.2.1' },
  { code: '1.2.1.013', name: 'Amortización Acumulada Equipos de Computación', accountType: 'ACTIVO', category: 'BIENES_USO', level: 4, isDetailAccount: true, parentCode: '1.2.1' },
  { code: '1.2.1.014', name: 'Amortización Acumulada Instalaciones', accountType: 'ACTIVO', category: 'BIENES_USO', level: 4, isDetailAccount: true, parentCode: '1.2.1' },

  // ========================================
  // 2. PASIVO
  // ========================================
  { code: '2', name: 'PASIVO', accountType: 'PASIVO', level: 1, isDetailAccount: false },

  // 2.1 PASIVO CORRIENTE
  { code: '2.1', name: 'PASIVO CORRIENTE', accountType: 'PASIVO', level: 2, isDetailAccount: false, parentCode: '2' },

  // 2.1.1 DEUDAS COMERCIALES
  { code: '2.1.1', name: 'DEUDAS COMERCIALES', accountType: 'PASIVO', category: 'DEUDAS_COMERCIALES', level: 3, isDetailAccount: false, parentCode: '2.1' },
  { code: '2.1.1.001', name: 'Proveedores', accountType: 'PASIVO', category: 'DEUDAS_COMERCIALES', level: 4, isDetailAccount: true, parentCode: '2.1.1' },
  { code: '2.1.1.002', name: 'Proveedores del Exterior', accountType: 'PASIVO', category: 'DEUDAS_COMERCIALES', level: 4, isDetailAccount: true, parentCode: '2.1.1' },
  { code: '2.1.1.010', name: 'Documentos a Pagar', accountType: 'PASIVO', category: 'DEUDAS_COMERCIALES', level: 4, isDetailAccount: true, parentCode: '2.1.1' },

  // 2.1.2 DEUDAS FISCALES
  { code: '2.1.2', name: 'DEUDAS FISCALES', accountType: 'PASIVO', category: 'DEUDAS_FISCALES', level: 3, isDetailAccount: false, parentCode: '2.1' },
  { code: '2.1.2.001', name: 'IVA Débito Fiscal', accountType: 'PASIVO', category: 'DEUDAS_FISCALES', level: 4, isDetailAccount: true, parentCode: '2.1.2' },
  { code: '2.1.2.002', name: 'Retenciones Impuesto a las Ganancias a Depositar', accountType: 'PASIVO', category: 'DEUDAS_FISCALES', level: 4, isDetailAccount: true, parentCode: '2.1.2' },
  { code: '2.1.2.003', name: 'Retenciones SUSS a Depositar', accountType: 'PASIVO', category: 'DEUDAS_FISCALES', level: 4, isDetailAccount: true, parentCode: '2.1.2' },
  { code: '2.1.2.004', name: 'Retenciones IIBB a Depositar', accountType: 'PASIVO', category: 'DEUDAS_FISCALES', level: 4, isDetailAccount: true, parentCode: '2.1.2' },
  { code: '2.1.2.010', name: 'Impuesto a las Ganancias a Pagar', accountType: 'PASIVO', category: 'DEUDAS_FISCALES', level: 4, isDetailAccount: true, parentCode: '2.1.2' },
  { code: '2.1.2.011', name: 'Ingresos Brutos a Pagar', accountType: 'PASIVO', category: 'DEUDAS_FISCALES', level: 4, isDetailAccount: true, parentCode: '2.1.2' },
  { code: '2.1.2.012', name: 'IVA a Pagar', accountType: 'PASIVO', category: 'DEUDAS_FISCALES', level: 4, isDetailAccount: true, parentCode: '2.1.2' },

  // 2.1.3 DEUDAS SOCIALES
  { code: '2.1.3', name: 'DEUDAS SOCIALES', accountType: 'PASIVO', category: 'DEUDAS_SOCIALES', level: 3, isDetailAccount: false, parentCode: '2.1' },
  { code: '2.1.3.001', name: 'Sueldos a Pagar', accountType: 'PASIVO', category: 'DEUDAS_SOCIALES', level: 4, isDetailAccount: true, parentCode: '2.1.3' },
  { code: '2.1.3.002', name: 'Cargas Sociales a Pagar', accountType: 'PASIVO', category: 'DEUDAS_SOCIALES', level: 4, isDetailAccount: true, parentCode: '2.1.3' },
  { code: '2.1.3.003', name: 'Aportes y Contribuciones a Pagar', accountType: 'PASIVO', category: 'DEUDAS_SOCIALES', level: 4, isDetailAccount: true, parentCode: '2.1.3' },
  { code: '2.1.3.004', name: 'Provisión Aguinaldo', accountType: 'PASIVO', category: 'DEUDAS_SOCIALES', level: 4, isDetailAccount: true, parentCode: '2.1.3' },
  { code: '2.1.3.005', name: 'Provisión Vacaciones', accountType: 'PASIVO', category: 'DEUDAS_SOCIALES', level: 4, isDetailAccount: true, parentCode: '2.1.3' },

  // 2.1.4 OTRAS DEUDAS
  { code: '2.1.4', name: 'OTRAS DEUDAS', accountType: 'PASIVO', category: 'OTRAS_DEUDAS', level: 3, isDetailAccount: false, parentCode: '2.1' },
  { code: '2.1.4.001', name: 'Anticipos de Clientes', accountType: 'PASIVO', category: 'OTRAS_DEUDAS', level: 4, isDetailAccount: true, parentCode: '2.1.4' },
  { code: '2.1.4.002', name: 'Acreedores Varios', accountType: 'PASIVO', category: 'OTRAS_DEUDAS', level: 4, isDetailAccount: true, parentCode: '2.1.4' },

  // 2.2 PASIVO NO CORRIENTE
  { code: '2.2', name: 'PASIVO NO CORRIENTE', accountType: 'PASIVO', level: 2, isDetailAccount: false, parentCode: '2' },
  { code: '2.2.1', name: 'DEUDAS BANCARIAS', accountType: 'PASIVO', category: 'DEUDAS_BANCARIAS', level: 3, isDetailAccount: false, parentCode: '2.2' },
  { code: '2.2.1.001', name: 'Préstamos Bancarios a Largo Plazo', accountType: 'PASIVO', category: 'DEUDAS_BANCARIAS', level: 4, isDetailAccount: true, parentCode: '2.2.1' },

  // ========================================
  // 3. PATRIMONIO NETO
  // ========================================
  { code: '3', name: 'PATRIMONIO NETO', accountType: 'PATRIMONIO_NETO', level: 1, isDetailAccount: false },

  // 3.1 CAPITAL
  { code: '3.1', name: 'CAPITAL', accountType: 'PATRIMONIO_NETO', category: 'CAPITAL', level: 2, isDetailAccount: false, parentCode: '3' },
  { code: '3.1.1', name: 'APORTES', accountType: 'PATRIMONIO_NETO', category: 'CAPITAL', level: 3, isDetailAccount: false, parentCode: '3.1' },
  { code: '3.1.1.001', name: 'Capital Social', accountType: 'PATRIMONIO_NETO', category: 'CAPITAL', level: 4, isDetailAccount: true, parentCode: '3.1.1' },
  { code: '3.1.1.002', name: 'Aportes No Capitalizados', accountType: 'PATRIMONIO_NETO', category: 'CAPITAL', level: 4, isDetailAccount: true, parentCode: '3.1.1' },

  // 3.2 RESULTADOS
  { code: '3.2', name: 'RESULTADOS', accountType: 'PATRIMONIO_NETO', category: 'RESULTADOS', level: 2, isDetailAccount: false, parentCode: '3' },
  { code: '3.2.1', name: 'RESULTADOS ACUMULADOS', accountType: 'PATRIMONIO_NETO', category: 'RESULTADOS', level: 3, isDetailAccount: false, parentCode: '3.2' },
  { code: '3.2.1.001', name: 'Resultados Acumulados', accountType: 'PATRIMONIO_NETO', category: 'RESULTADOS', level: 4, isDetailAccount: true, parentCode: '3.2.1' },
  { code: '3.2.1.002', name: 'Resultado del Ejercicio', accountType: 'PATRIMONIO_NETO', category: 'RESULTADOS', level: 4, isDetailAccount: true, parentCode: '3.2.1' },

  // ========================================
  // 4. INGRESOS (POSITIVOS)
  // ========================================
  { code: '4', name: 'INGRESOS', accountType: 'INGRESO', level: 1, isDetailAccount: false },

  // 4.1 VENTAS
  { code: '4.1', name: 'VENTAS', accountType: 'INGRESO', category: 'VENTAS', level: 2, isDetailAccount: false, parentCode: '4' },
  { code: '4.1.1', name: 'VENTAS DE MERCADERÍAS', accountType: 'INGRESO', category: 'VENTAS', level: 3, isDetailAccount: false, parentCode: '4.1' },
  { code: '4.1.1.001', name: 'Ventas', accountType: 'INGRESO', category: 'VENTAS', level: 4, isDetailAccount: true, parentCode: '4.1.1' },
  { code: '4.1.1.002', name: 'Ventas Exportación', accountType: 'INGRESO', category: 'VENTAS', level: 4, isDetailAccount: true, parentCode: '4.1.1' },
  { code: '4.1.1.010', name: 'Descuentos Otorgados', accountType: 'INGRESO', category: 'VENTAS', level: 4, isDetailAccount: true, parentCode: '4.1.1' },
  { code: '4.1.1.011', name: 'Bonificaciones Otorgadas', accountType: 'INGRESO', category: 'VENTAS', level: 4, isDetailAccount: true, parentCode: '4.1.1' },
  { code: '4.1.1.012', name: 'Devoluciones sobre Ventas', accountType: 'INGRESO', category: 'VENTAS', level: 4, isDetailAccount: true, parentCode: '4.1.1' },

  // 4.2 OTROS INGRESOS
  { code: '4.2', name: 'OTROS INGRESOS', accountType: 'INGRESO', category: 'OTROS_INGRESOS', level: 2, isDetailAccount: false, parentCode: '4' },
  { code: '4.2.1', name: 'RESULTADOS FINANCIEROS POSITIVOS', accountType: 'INGRESO', category: 'OTROS_INGRESOS', level: 3, isDetailAccount: false, parentCode: '4.2' },
  { code: '4.2.1.001', name: 'Intereses Ganados', accountType: 'INGRESO', category: 'OTROS_INGRESOS', level: 4, isDetailAccount: true, parentCode: '4.2.1' },
  { code: '4.2.1.002', name: 'Diferencias de Cambio Positivas', accountType: 'INGRESO', category: 'OTROS_INGRESOS', level: 4, isDetailAccount: true, parentCode: '4.2.1' },
  { code: '4.2.1.003', name: 'Descuentos Obtenidos', accountType: 'INGRESO', category: 'OTROS_INGRESOS', level: 4, isDetailAccount: true, parentCode: '4.2.1' },

  // ========================================
  // 5. EGRESOS (NEGATIVOS)
  // ========================================
  { code: '5', name: 'EGRESOS', accountType: 'EGRESO', level: 1, isDetailAccount: false },

  // 5.1 COSTO DE VENTAS
  { code: '5.1', name: 'COSTO DE VENTAS', accountType: 'EGRESO', category: 'COSTO_VENTAS', level: 2, isDetailAccount: false, parentCode: '5' },
  { code: '5.1.1', name: 'COSTO DE MERCADERÍAS VENDIDAS', accountType: 'EGRESO', category: 'COSTO_VENTAS', level: 3, isDetailAccount: false, parentCode: '5.1' },
  { code: '5.1.1.001', name: 'Costo de Mercadería Vendida', accountType: 'EGRESO', category: 'COSTO_VENTAS', level: 4, isDetailAccount: true, parentCode: '5.1.1' },

  // 5.2 GASTOS DE ADMINISTRACIÓN
  { code: '5.2', name: 'GASTOS DE ADMINISTRACIÓN', accountType: 'EGRESO', category: 'GASTOS_ADMIN', level: 2, isDetailAccount: false, parentCode: '5' },
  { code: '5.2.1', name: 'GASTOS DE PERSONAL', accountType: 'EGRESO', category: 'GASTOS_ADMIN', level: 3, isDetailAccount: false, parentCode: '5.2' },
  { code: '5.2.1.001', name: 'Sueldos y Jornales', accountType: 'EGRESO', category: 'GASTOS_ADMIN', level: 4, isDetailAccount: true, parentCode: '5.2.1' },
  { code: '5.2.1.002', name: 'Cargas Sociales', accountType: 'EGRESO', category: 'GASTOS_ADMIN', level: 4, isDetailAccount: true, parentCode: '5.2.1' },
  { code: '5.2.1.003', name: 'Indemnizaciones', accountType: 'EGRESO', category: 'GASTOS_ADMIN', level: 4, isDetailAccount: true, parentCode: '5.2.1' },
  { code: '5.2.1.004', name: 'Capacitación', accountType: 'EGRESO', category: 'GASTOS_ADMIN', level: 4, isDetailAccount: true, parentCode: '5.2.1' },

  { code: '5.2.2', name: 'GASTOS GENERALES', accountType: 'EGRESO', category: 'GASTOS_ADMIN', level: 3, isDetailAccount: false, parentCode: '5.2' },
  { code: '5.2.2.001', name: 'Honorarios Profesionales', accountType: 'EGRESO', category: 'GASTOS_ADMIN', level: 4, isDetailAccount: true, parentCode: '5.2.2' },
  { code: '5.2.2.002', name: 'Alquileres', accountType: 'EGRESO', category: 'GASTOS_ADMIN', level: 4, isDetailAccount: true, parentCode: '5.2.2' },
  { code: '5.2.2.003', name: 'Servicios Públicos', accountType: 'EGRESO', category: 'GASTOS_ADMIN', level: 4, isDetailAccount: true, parentCode: '5.2.2' },
  { code: '5.2.2.004', name: 'Teléfono e Internet', accountType: 'EGRESO', category: 'GASTOS_ADMIN', level: 4, isDetailAccount: true, parentCode: '5.2.2' },
  { code: '5.2.2.005', name: 'Seguros', accountType: 'EGRESO', category: 'GASTOS_ADMIN', level: 4, isDetailAccount: true, parentCode: '5.2.2' },
  { code: '5.2.2.006', name: 'Impuestos y Tasas', accountType: 'EGRESO', category: 'GASTOS_ADMIN', level: 4, isDetailAccount: true, parentCode: '5.2.2' },
  { code: '5.2.2.007', name: 'Mantenimiento y Reparaciones', accountType: 'EGRESO', category: 'GASTOS_ADMIN', level: 4, isDetailAccount: true, parentCode: '5.2.2' },
  { code: '5.2.2.008', name: 'Librería y Papelería', accountType: 'EGRESO', category: 'GASTOS_ADMIN', level: 4, isDetailAccount: true, parentCode: '5.2.2' },
  { code: '5.2.2.009', name: 'Amortizaciones', accountType: 'EGRESO', category: 'GASTOS_ADMIN', level: 4, isDetailAccount: true, parentCode: '5.2.2' },
  { code: '5.2.2.010', name: 'Gastos Bancarios', accountType: 'EGRESO', category: 'GASTOS_ADMIN', level: 4, isDetailAccount: true, parentCode: '5.2.2' },

  // 5.3 GASTOS DE COMERCIALIZACIÓN
  { code: '5.3', name: 'GASTOS DE COMERCIALIZACIÓN', accountType: 'EGRESO', category: 'GASTOS_COMERCIALES', level: 2, isDetailAccount: false, parentCode: '5' },
  { code: '5.3.1', name: 'GASTOS DE VENTAS', accountType: 'EGRESO', category: 'GASTOS_COMERCIALES', level: 3, isDetailAccount: false, parentCode: '5.3' },
  { code: '5.3.1.001', name: 'Comisiones', accountType: 'EGRESO', category: 'GASTOS_COMERCIALES', level: 4, isDetailAccount: true, parentCode: '5.3.1' },
  { code: '5.3.1.002', name: 'Publicidad y Propaganda', accountType: 'EGRESO', category: 'GASTOS_COMERCIALES', level: 4, isDetailAccount: true, parentCode: '5.3.1' },
  { code: '5.3.1.003', name: 'Viajes y Viáticos', accountType: 'EGRESO', category: 'GASTOS_COMERCIALES', level: 4, isDetailAccount: true, parentCode: '5.3.1' },
  { code: '5.3.1.004', name: 'Gastos de Envío', accountType: 'EGRESO', category: 'GASTOS_COMERCIALES', level: 4, isDetailAccount: true, parentCode: '5.3.1' },
  { code: '5.3.1.005', name: 'Merchandising', accountType: 'EGRESO', category: 'GASTOS_COMERCIALES', level: 4, isDetailAccount: true, parentCode: '5.3.1' },

  // 5.4 OTROS EGRESOS
  { code: '5.4', name: 'OTROS EGRESOS', accountType: 'EGRESO', category: 'OTROS_EGRESOS', level: 2, isDetailAccount: false, parentCode: '5' },
  { code: '5.4.1', name: 'RESULTADOS FINANCIEROS NEGATIVOS', accountType: 'EGRESO', category: 'OTROS_EGRESOS', level: 3, isDetailAccount: false, parentCode: '5.4' },
  { code: '5.4.1.001', name: 'Intereses Perdidos', accountType: 'EGRESO', category: 'OTROS_EGRESOS', level: 4, isDetailAccount: true, parentCode: '5.4.1' },
  { code: '5.4.1.002', name: 'Diferencias de Cambio Negativas', accountType: 'EGRESO', category: 'OTROS_EGRESOS', level: 4, isDetailAccount: true, parentCode: '5.4.1' },
  { code: '5.4.1.003', name: 'Descuentos Perdidos', accountType: 'EGRESO', category: 'OTROS_EGRESOS', level: 4, isDetailAccount: true, parentCode: '5.4.1' },
];

async function main() {
  console.log('🌱 Seeding Chart of Accounts...');

  // Crear cuentas por niveles para respetar las relaciones padre-hijo
  for (let level = 1; level <= 4; level++) {
    const levelAccounts = accounts.filter(acc => acc.level === level);

    for (const account of levelAccounts) {
      // Buscar el ID del padre si existe
      let parentId = null;
      if (account.parentCode) {
        const parent = await prisma.chartOfAccount.findUnique({
          where: { code: account.parentCode }
        });
        if (parent) {
          parentId = parent.id;
        }
      }

      // Crear o actualizar la cuenta
      await prisma.chartOfAccount.upsert({
        where: { code: account.code },
        update: {
          name: account.name,
          accountType: account.accountType,
          category: account.category,
          level: account.level,
          isDetailAccount: account.isDetailAccount,
          parentId,
        },
        create: {
          code: account.code,
          name: account.name,
          accountType: account.accountType,
          category: account.category,
          level: account.level,
          isDetailAccount: account.isDetailAccount,
          parentId,
          isActive: true,
          acceptsEntries: account.isDetailAccount,
          debitBalance: 0,
          creditBalance: 0,
        },
      });
    }

    console.log(`✓ Nivel ${level}: ${levelAccounts.length} cuentas creadas`);
  }

  console.log('✓ Seed de Plan de Cuentas completado!');
  console.log(`Total: ${accounts.length} cuentas creadas`);
}

main()
  .catch((e) => {
    console.error('❌ Error seeding chart of accounts:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
