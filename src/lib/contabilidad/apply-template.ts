/**
 * Journal Entry Template Application System
 * Sistema de aplicación de plantillas de asientos contables
 */

import { prisma } from '@/lib/prisma';
import { Prisma, TriggerType, AmountType, EntryLineSide, Currency } from '@prisma/client';

/**
 * Documento origen para generar el asiento
 */
export interface SourceDocument {
  id: string;
  type: TriggerType;
  date: Date;
  description: string;
  total: number;
  subtotal?: number;
  taxAmount?: number;
  tax21Amount?: number;      // IVA 21%
  tax10_5Amount?: number;    // IVA 10.5%
  perceptions?: Array<{ amount: number; description?: string }>;
  retention?: number;
  netPayment?: number;       // Pago neto después de retenciones
  principal?: number;        // Capital de préstamo
  interest?: number;         // Intereses
  currency?: Currency;
  customFields?: Record<string, number>;  // Campos personalizados
}

/**
 * Resultado de la aplicación de plantilla
 */
export interface TemplateApplicationResult {
  journalEntry: {
    id: string;
    entryNumber: number;
    description: string;
    date: Date;
    totalDebit: number;
    totalCredit: number;
  };
  lines: Array<{
    accountCode: string;
    accountName: string;
    debit: number;
    credit: number;
    description?: string;
  }>;
}

/**
 * Opciones para aplicar plantilla
 */
export interface ApplyTemplateOptions {
  autoPost?: boolean;        // Auto-confirmar el asiento (default: true)
  validateBalance?: boolean; // Validar balance Debe=Haber (default: true)
  tx?: Prisma.TransactionClient;  // Transacción existente
}

/**
 * Aplicar plantilla de asiento contable
 */
export async function applyJournalTemplate(
  templateCode: string,
  sourceDocument: SourceDocument,
  createdBy: string,
  options: ApplyTemplateOptions = {}
): Promise<TemplateApplicationResult> {
  const {
    autoPost = true,
    validateBalance = true,
    tx: externalTx,
  } = options;

  const execute = async (tx: Prisma.TransactionClient) => {
    // 1. Buscar la plantilla
    const template = await tx.journalEntryTemplate.findUnique({
      where: { code: templateCode },
      include: {
        lines: {
          include: { account: true },
          orderBy: { lineNumber: 'asc' },
        },
      },
    });

    if (!template) {
      throw new Error(`Plantilla ${templateCode} no encontrada`);
    }

    if (!template.isActive) {
      throw new Error(`Plantilla ${templateCode} está inactiva`);
    }

    // 2. Calcular montos para cada línea según la plantilla
    const lines = [];
    let totalDebit = 0;
    let totalCredit = 0;

    for (const templateLine of template.lines) {
      const amount = calculateLineAmount(templateLine.amountType, sourceDocument, {
        fixedAmount: templateLine.fixedAmount ? Number(templateLine.fixedAmount) : undefined,
        percentage: templateLine.percentage ? Number(templateLine.percentage) : undefined,
      });

      // Validar que la cuenta acepta asientos
      if (!templateLine.account.acceptsEntries && !templateLine.account.isDetailAccount) {
        throw new Error(
          `La cuenta ${templateLine.account.code} - ${templateLine.account.name} no acepta asientos directos`
        );
      }

      const debit = templateLine.side === EntryLineSide.DEBIT ? amount : 0;
      const credit = templateLine.side === EntryLineSide.CREDIT ? amount : 0;

      totalDebit += debit;
      totalCredit += credit;

      lines.push({
        accountId: templateLine.accountId,
        accountCode: templateLine.account.code,
        accountName: templateLine.account.name,
        description: templateLine.description || sourceDocument.description,
        debit,
        credit,
        lineNumber: templateLine.lineNumber,
      });
    }

    // 3. Validar balance (debe = haber)
    if (validateBalance) {
      const difference = Math.abs(totalDebit - totalCredit);
      if (difference > 0.01) {
        throw new Error(
          `Asiento desbalanceado: Debe ${totalDebit.toFixed(2)} ≠ Haber ${totalCredit.toFixed(2)} ` +
          `(Diferencia: ${difference.toFixed(2)})`
        );
      }
    }

    // 4. Crear el asiento
    const journalEntry = await tx.journalEntry.create({
      data: {
        date: sourceDocument.date,
        description: sourceDocument.description,
        reference: sourceDocument.id,
        templateCode,
        triggerType: sourceDocument.type,
        isAutomatic: true,
        status: autoPost ? 'POSTED' : 'DRAFT',
        userId: createdBy,
        invoiceId: sourceDocument.type === TriggerType.SALE_INVOICE ? sourceDocument.id : undefined,
        lines: {
          create: lines.map(({ accountId, debit, credit, description }) => ({
            accountId,
            debit,
            credit,
            description,
          })),
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

    // 5. Actualizar saldos de cuentas si el asiento está confirmado
    if (autoPost) {
      await updateAccountBalances(
        lines.map((l) => l.accountId),
        tx
      );
    }

    return {
      journalEntry: {
        id: journalEntry.id,
        entryNumber: journalEntry.entryNumber,
        description: journalEntry.description,
        date: journalEntry.date,
        totalDebit,
        totalCredit,
      },
      lines: lines.map(({ accountCode, accountName, debit, credit, description }) => ({
        accountCode,
        accountName,
        debit,
        credit,
        description,
      })),
    };
  };

  // Ejecutar con transacción existente o crear una nueva
  if (externalTx) {
    return execute(externalTx);
  } else {
    return prisma.$transaction(execute);
  }
}

/**
 * Calcular monto de línea según tipo
 */
function calculateLineAmount(
  amountType: AmountType,
  sourceDocument: SourceDocument,
  options: { fixedAmount?: number; percentage?: number }
): number {
  switch (amountType) {
    case AmountType.TOTAL:
      return sourceDocument.total;

    case AmountType.SUBTOTAL:
      return sourceDocument.subtotal || 0;

    case AmountType.TAX:
      return sourceDocument.taxAmount || 0;

    case AmountType.TAX_21:
      return sourceDocument.tax21Amount || 0;

    case AmountType.TAX_10_5:
      return sourceDocument.tax10_5Amount || 0;

    case AmountType.PERCEPTION:
      return (
        sourceDocument.perceptions?.reduce((sum, p) => sum + p.amount, 0) || 0
      );

    case AmountType.RETENTION:
      return sourceDocument.retention || 0;

    case AmountType.NET_PAYMENT:
      return sourceDocument.netPayment || sourceDocument.total;

    case AmountType.PRINCIPAL:
      return sourceDocument.principal || 0;

    case AmountType.INTEREST:
      return sourceDocument.interest || 0;

    case AmountType.FIXED:
      if (options.fixedAmount === undefined) {
        throw new Error('Se requiere fixedAmount para AmountType.FIXED');
      }
      return options.fixedAmount;

    case AmountType.PERCENTAGE:
      if (options.percentage === undefined) {
        throw new Error('Se requiere percentage para AmountType.PERCENTAGE');
      }
      return (sourceDocument.total * options.percentage) / 100;

    case AmountType.BALANCE:
      // Calcular el balance restante (para casos especiales)
      return 0;

    case AmountType.CUSTOM:
      // Buscar en campos personalizados
      return 0;

    default:
      throw new Error(`AmountType no soportado: ${amountType}`);
  }
}

/**
 * Actualizar saldos de cuentas
 */
async function updateAccountBalances(
  accountIds: string[],
  tx: Prisma.TransactionClient
): Promise<void> {
  const uniqueAccountIds = [...new Set(accountIds)];

  for (const accountId of uniqueAccountIds) {
    const totals = await tx.journalEntryLine.aggregate({
      where: {
        accountId,
        journalEntry: { status: 'POSTED' },
      },
      _sum: { debit: true, credit: true },
    });

    await tx.chartOfAccount.update({
      where: { id: accountId },
      data: {
        debitBalance: totals._sum.debit || 0,
        creditBalance: totals._sum.credit || 0,
      },
    });
  }
}

/**
 * Obtener plantilla por código
 */
export async function getTemplateByCode(code: string) {
  return prisma.journalEntryTemplate.findUnique({
    where: { code },
    include: {
      lines: {
        include: { account: true },
        orderBy: { lineNumber: 'asc' },
      },
    },
  });
}

/**
 * Obtener plantillas por tipo de disparo
 */
export async function getTemplatesByTrigger(triggerType: TriggerType) {
  return prisma.journalEntryTemplate.findMany({
    where: {
      triggerType,
      isActive: true,
    },
    include: {
      lines: {
        include: { account: true },
        orderBy: { lineNumber: 'asc' },
      },
    },
  });
}

/**
 * Validar que una plantilla está correctamente configurada
 */
export async function validateTemplate(templateCode: string): Promise<{
  valid: boolean;
  errors: string[];
  warnings: string[];
}> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const template = await getTemplateByCode(templateCode);

  if (!template) {
    errors.push(`Plantilla ${templateCode} no encontrada`);
    return { valid: false, errors, warnings };
  }

  if (!template.isActive) {
    warnings.push('La plantilla está inactiva');
  }

  if (template.lines.length === 0) {
    errors.push('La plantilla no tiene líneas configuradas');
  }

  // Validar que todas las cuentas existen y aceptan asientos
  for (const line of template.lines) {
    if (!line.account.isActive) {
      warnings.push(`Cuenta ${line.account.code} está inactiva`);
    }

    if (!line.account.acceptsEntries && !line.account.isDetailAccount) {
      errors.push(
        `Cuenta ${line.account.code} - ${line.account.name} no acepta asientos`
      );
    }
  }

  // Validar que hay al menos una línea DEBIT y una CREDIT
  const hasDebit = template.lines.some((l) => l.side === EntryLineSide.DEBIT);
  const hasCredit = template.lines.some((l) => l.side === EntryLineSide.CREDIT);

  if (!hasDebit) {
    errors.push('La plantilla no tiene líneas de DEBE');
  }

  if (!hasCredit) {
    errors.push('La plantilla no tiene líneas de HABER');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
