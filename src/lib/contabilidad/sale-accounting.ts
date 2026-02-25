/**
 * Sales Accounting Integration
 * Integración contable para facturas de venta usando sistema de plantillas
 */

import { Prisma, TriggerType, Currency } from '@prisma/client';
import { applyJournalTemplate, SourceDocument } from './apply-template';

/**
 * Datos de factura para contabilización
 */
export interface SaleInvoiceData {
  id: string;
  invoiceNumber: string;
  invoiceType: 'A' | 'B' | 'C' | 'E';
  customerId: string;
  customerName: string;
  issueDate: Date;
  subtotal: number;
  taxAmount: number;
  total: number;
  currency: Currency;
}

/**
 * Crear asiento contable de venta usando plantilla
 */
export async function createSaleJournalEntry(
  invoiceData: SaleInvoiceData,
  userId: string,
  tx?: Prisma.TransactionClient
): Promise<{
  id: string;
  entryNumber: number;
}> {
  // Determinar plantilla según tipo de factura
  const templateCode = getTemplateCodeForInvoiceType(invoiceData.invoiceType);

  // Preparar documento origen
  const sourceDocument: SourceDocument = {
    id: invoiceData.id,
    type: TriggerType.SALE_INVOICE,
    date: invoiceData.issueDate,
    description: `Factura ${invoiceData.invoiceType} ${invoiceData.invoiceNumber} - ${invoiceData.customerName}`,
    total: invoiceData.total,
    subtotal: invoiceData.subtotal,
    taxAmount: invoiceData.taxAmount,
    currency: invoiceData.currency,
  };

  // Aplicar plantilla
  const result = await applyJournalTemplate(
    templateCode,
    sourceDocument,
    userId,
    {
      autoPost: true,
      validateBalance: true,
      tx,
    }
  );

  return {
    id: result.journalEntry.id,
    entryNumber: result.journalEntry.entryNumber,
  };
}

/**
 * Obtener código de plantilla según tipo de factura
 */
function getTemplateCodeForInvoiceType(invoiceType: 'A' | 'B' | 'C' | 'E'): string {
  switch (invoiceType) {
    case 'A':
      return 'SALE_INVOICE_A';
    case 'B':
    case 'C':
      return 'SALE_INVOICE_B'; // B y C no discriminan IVA
    case 'E':
      return 'SALE_INVOICE_B'; // Exportación usa el mismo que B
    default:
      throw new Error(`Tipo de factura no soportado: ${invoiceType}`);
  }
}

/**
 * Validar que las plantillas de venta están configuradas
 */
export async function validateSaleTemplates(): Promise<{
  valid: boolean;
  errors: string[];
}> {
  const errors: string[] = [];

  // Validar plantillas necesarias
  const requiredTemplates = ['SALE_INVOICE_A', 'SALE_INVOICE_B'];

  const { prisma } = await import('@/lib/prisma');

  for (const code of requiredTemplates) {
    const template = await prisma.journalEntryTemplate.findUnique({
      where: { code },
      select: { id: true, isActive: true },
    });

    if (!template) {
      errors.push(`Plantilla ${code} no encontrada`);
    } else if (!template.isActive) {
      errors.push(`Plantilla ${code} está inactiva`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
