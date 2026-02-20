/**
 * Helper para cálculo correcto de saldos contables
 * En contabilidad NO existen saldos negativos, solo deudores o acreedores
 */

import { AccountType } from '@prisma/client';

/**
 * Calcular el saldo de una cuenta según su naturaleza
 * @returns { amount: número absoluto, nature: 'DEUDOR' | 'ACREEDOR' }
 */
export function calculateAccountBalance(
  accountType: AccountType | string,
  debitBalance: number,
  creditBalance: number
): {
  amount: number;
  nature: 'DEUDOR' | 'ACREEDOR';
  isNormal: boolean; // true si el saldo es de la naturaleza normal de la cuenta
} {
  const debit = Number(debitBalance);
  const credit = Number(creditBalance);

  // Determinar naturaleza de la cuenta
  const isDebitNature = accountType === 'ACTIVO' || accountType === 'EGRESO';

  // Calcular diferencia
  const difference = debit - credit;

  // Determinar naturaleza del saldo
  let nature: 'DEUDOR' | 'ACREEDOR';
  let amount: number;

  if (difference >= 0) {
    // Saldo deudor (Debe > Haber)
    nature = 'DEUDOR';
    amount = Math.abs(difference);
  } else {
    // Saldo acreedor (Haber > Debe)
    nature = 'ACREEDOR';
    amount = Math.abs(difference);
  }

  // Determinar si es normal o anormal
  const isNormal = isDebitNature ? nature === 'DEUDOR' : nature === 'ACREEDOR';

  return {
    amount,
    nature,
    isNormal,
  };
}

/**
 * Calcular saldo acumulado para movimientos (Libro Mayor)
 * Retorna el saldo acumulado SIEMPRE positivo con su naturaleza
 */
export function calculateRunningBalance(
  accountType: AccountType | string,
  currentBalance: { amount: number; nature: 'DEUDOR' | 'ACREEDOR' },
  movementDebit: number,
  movementCredit: number
): {
  amount: number;
  nature: 'DEUDOR' | 'ACREEDOR';
} {
  // Convertir el saldo actual a formato con signo
  let signedBalance = currentBalance.nature === 'DEUDOR'
    ? currentBalance.amount
    : -currentBalance.amount;

  // Sumar movimiento
  signedBalance += Number(movementDebit) - Number(movementCredit);

  // Convertir de vuelta a formato contable (absoluto + naturaleza)
  return {
    amount: Math.abs(signedBalance),
    nature: signedBalance >= 0 ? 'DEUDOR' : 'ACREEDOR',
  };
}

/**
 * Formatear saldo para mostrar en UI
 */
export function formatBalance(
  amount: number,
  nature: 'DEUDOR' | 'ACREEDOR',
  options: {
    showNature?: boolean; // Mostrar (D) o (A)
    showSign?: boolean; // Mostrar - para acreedores
    colored?: boolean; // Retornar clase CSS para color
  } = {}
): string {
  const { showNature = true, showSign = false, colored = false } = options;

  let formatted = `$${amount.toFixed(2)}`;

  if (showNature) {
    formatted += ` (${nature === 'DEUDOR' ? 'D' : 'A'})`;
  }

  if (showSign && nature === 'ACREEDOR') {
    formatted = `-${formatted}`;
  }

  return formatted;
}

/**
 * Obtener clase CSS para colorear saldo
 */
export function getBalanceColorClass(
  nature: 'DEUDOR' | 'ACREEDOR',
  isNormal: boolean
): string {
  if (isNormal) {
    // Saldo normal: color neutral
    return 'text-gray-900';
  } else {
    // Saldo anormal: color de advertencia
    return nature === 'DEUDOR' ? 'text-amber-700' : 'text-amber-700';
  }
}

/**
 * Tipo para saldo contable
 */
export interface AccountingBalance {
  amount: number;
  nature: 'DEUDOR' | 'ACREEDOR';
  isNormal: boolean;
}
