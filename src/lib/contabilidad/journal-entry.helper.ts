/**
 * Journal Entry Helper
 * Helper functions for creating automatic accounting entries
 */

import { prisma } from '@/lib/prisma';
import { Prisma, Currency } from '@prisma/client';

/**
 * Account codes for CMV entries
 */
const ACCOUNT_CODES = {
  CMV: '5.1.01', // Costo de Mercaderías Vendidas (DEBE)
  MERCADERIAS: '1.1.05.001', // Mercaderías (HABER)
};

/**
 * Get account ID by code
 */
async function getAccountIdByCode(
  code: string,
  tx: Prisma.TransactionClient
): Promise<string> {
  const account = await tx.chartOfAccount.findUnique({
    where: { code },
    select: { id: true, name: true, acceptsEntries: true },
  });

  if (!account) {
    throw new Error(`Cuenta contable ${code} no encontrada en el plan de cuentas`);
  }

  if (!account.acceptsEntries) {
    throw new Error(`Cuenta contable ${code} (${account.name}) no acepta asientos directos`);
  }

  return account.id;
}

/**
 * Exchange rate type (for future use)
 */
interface ExchangeRateInfo {
  fromCurrency: Currency;
  toCurrency: Currency;
  rate: number;
}

/**
 * Get exchange rate between currencies
 * For now, returns 1 if both are ARS, otherwise throws error
 */
async function getExchangeRate(
  fromCurrency: Currency,
  toCurrency: Currency,
  date: Date,
  tx: Prisma.TransactionClient
): Promise<number> {
  if (fromCurrency === toCurrency) {
    return 1;
  }

  // Try to find exchange rate
  const exchangeRate = await tx.exchangeRate.findFirst({
    where: {
      fromCurrency,
      toCurrency,
      validFrom: { lte: date },
      OR: [{ validUntil: null }, { validUntil: { gte: date } }],
    },
    orderBy: { validFrom: 'desc' },
    select: { rate: true },
  });

  if (!exchangeRate) {
    throw new Error(
      `No se encontró tipo de cambio de ${fromCurrency} a ${toCurrency} ` +
        `para la fecha ${date.toISOString()}`
    );
  }

  return Number(exchangeRate.rate);
}

/**
 * Create CMV Journal Entry
 *
 * Accounting entry for Cost of Goods Sold:
 * - DEBIT: 5.1.01 (Costo de Mercaderías Vendidas)
 * - CREDIT: 1.1.05.001 (Mercaderías)
 */
export async function createCMVJournalEntry(
  tx: Prisma.TransactionClient,
  data: {
    invoiceId: string;
    invoiceNumber: string;
    issueDate: Date;
    cmvAmount: number;
    currency: Currency;
    userId: string;
  }
): Promise<any> {
  // Convert to ARS if needed
  let cmvAmountARS = data.cmvAmount;
  if (data.currency !== Currency.ARS) {
    const exchangeRate = await getExchangeRate(
      data.currency,
      Currency.ARS,
      data.issueDate,
      tx
    );
    cmvAmountARS = data.cmvAmount * exchangeRate;
  }

  // Get account IDs
  const cmvAccountId = await getAccountIdByCode(ACCOUNT_CODES.CMV, tx);
  const mercaderiasAccountId = await getAccountIdByCode(ACCOUNT_CODES.MERCADERIAS, tx);

  // Create journal entry
  const journalEntry = await tx.journalEntry.create({
    data: {
      date: data.issueDate,
      description: `CMV - Factura ${data.invoiceNumber}`,
      reference: data.invoiceNumber,
      invoiceId: data.invoiceId,
      userId: data.userId,
      status: 'POSTED', // Automatically posted
      lines: {
        create: [
          {
            accountId: cmvAccountId,
            debit: cmvAmountARS,
            credit: 0,
            description: `Costo de venta - Factura ${data.invoiceNumber}`,
          },
          {
            accountId: mercaderiasAccountId,
            debit: 0,
            credit: cmvAmountARS,
            description: `Salida de mercaderías - Factura ${data.invoiceNumber}`,
          },
        ],
      },
    },
    include: {
      lines: {
        include: {
          account: {
            select: {
              code: true,
              name: true,
            },
          },
        },
      },
    },
  });

  return journalEntry;
}

/**
 * Create Sales Journal Entry (for future use)
 * This would create the revenue side of the sale:
 * - DEBIT: Accounts Receivable
 * - CREDIT: Sales Revenue
 * - DEBIT/CREDIT: VAT accounts
 */
export async function createSalesJournalEntry(
  tx: Prisma.TransactionClient,
  data: {
    invoiceId: string;
    invoiceNumber: string;
    issueDate: Date;
    subtotal: number;
    taxAmount: number;
    total: number;
    currency: Currency;
    userId: string;
  }
): Promise<any> {
  // TODO: Implement sales accounting entry
  // This would require additional account codes:
  // - 1.1.02 (Deudores por Ventas / Accounts Receivable)
  // - 4.1.01 (Ventas / Sales Revenue)
  // - 1.1.08 (IVA Crédito Fiscal)
  throw new Error('Sales journal entry not implemented yet');
}

/**
 * Validate that required accounts exist in chart of accounts
 */
export async function validateCMVAccounts(
  tx: Prisma.TransactionClient
): Promise<{ valid: boolean; missingAccounts: string[] }> {
  const missingAccounts: string[] = [];

  for (const [key, code] of Object.entries(ACCOUNT_CODES)) {
    const account = await tx.chartOfAccount.findUnique({
      where: { code },
      select: { id: true, acceptsEntries: true },
    });

    if (!account) {
      missingAccounts.push(`${key} (${code})`);
    } else if (!account.acceptsEntries) {
      missingAccounts.push(`${key} (${code}) - no acepta asientos`);
    }
  }

  return {
    valid: missingAccounts.length === 0,
    missingAccounts,
  };
}

/**
 * Get CMV accounts summary (for verification)
 */
export async function getCMVAccountsSummary() {
  const accounts = await Promise.all(
    Object.entries(ACCOUNT_CODES).map(async ([key, code]) => {
      const account = await prisma.chartOfAccount.findUnique({
        where: { code },
        select: {
          id: true,
          code: true,
          name: true,
          accountType: true,
          acceptsEntries: true,
          isActive: true,
        },
      });

      return {
        key,
        code,
        found: !!account,
        account,
      };
    })
  );

  return accounts;
}
