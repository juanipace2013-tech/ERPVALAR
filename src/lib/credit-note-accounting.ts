import { prisma } from '@/lib/prisma';

/**
 * Genera una nota de crédito desde una factura de compra (devolución)
 */
export async function createPurchaseCreditNote(data: {
  originalInvoiceId: string;
  creditNoteNumber: string;
  creditNoteDate: Date;
  items: Array<{
    originalItemId: string;
    quantity: number;
    reason?: string;
  }>;
  userId: string;
}) {
  const { originalInvoiceId, creditNoteNumber, creditNoteDate, items, userId } = data;

  // Get original invoice
  const originalInvoice = await prisma.purchaseInvoice.findUnique({
    where: { id: originalInvoiceId },
    include: {
      supplier: true,
      items: {
        include: {
          product: true,
          account: true,
        },
      },
    },
  });

  if (!originalInvoice) {
    throw new Error('Factura original no encontrada');
  }

  // Validate items
  for (const item of items) {
    const originalItem = originalInvoice.items.find((i) => i.id === item.originalItemId);
    if (!originalItem) {
      throw new Error(`Item ${item.originalItemId} no encontrado en factura original`);
    }
    if (item.quantity > Number(originalItem.quantity)) {
      throw new Error(
        `Cantidad a devolver (${item.quantity}) excede cantidad original (${originalItem.quantity})`
      );
    }
  }

  // Calculate totals for credit note
  let subtotal = 0;
  let taxAmount = 0;
  const creditNoteItems: any[] = [];

  for (const item of items) {
    const originalItem = originalInvoice.items.find((i) => i.id === item.originalItemId);
    if (!originalItem) continue;

    const itemSubtotal = Number(originalItem.unitPrice) * item.quantity;
    const itemTax = itemSubtotal * (Number(originalItem.taxRate) / 100);

    subtotal += itemSubtotal;
    taxAmount += itemTax;

    creditNoteItems.push({
      productId: originalItem.productId,
      description: `DEVOLUCIÓN: ${originalItem.description}${item.reason ? ` - ${item.reason}` : ''}`,
      unit: originalItem.unit,
      quantity: item.quantity,
      listPrice: originalItem.listPrice,
      discountPercent: originalItem.discountPercent,
      unitPrice: originalItem.unitPrice,
      subtotal: itemSubtotal,
      taxRate: originalItem.taxRate,
      taxAmount: itemTax,
      total: itemSubtotal + itemTax,
      accountId: originalItem.accountId,
    });
  }

  // Apply same discount percentage as original
  const discountAmount = subtotal * (Number(originalInvoice.generalDiscount) / 100);
  const netAmount = subtotal - discountAmount;

  // Recalculate tax on net amount
  taxAmount = 0;
  creditNoteItems.forEach((item) => {
    const itemProportion = item.subtotal / subtotal;
    const itemNet = netAmount * itemProportion;
    const itemTax = itemNet * (item.taxRate / 100);
    taxAmount += itemTax;
    item.taxAmount = itemTax;
    item.total = itemNet + itemTax;
  });

  const total = netAmount + taxAmount;

  // Execute in transaction
  return await prisma.$transaction(async (tx) => {
    // 1. Create credit note (as PurchaseInvoice with type NC)
    const creditNote = await tx.purchaseInvoice.create({
      data: {
        invoiceNumber: creditNoteNumber,
        supplierId: originalInvoice.supplierId,
        voucherType: originalInvoice.voucherType,
        invoiceType: 'NC', // Nota de Crédito
        invoiceDate: creditNoteDate,
        dueDate: creditNoteDate,
        pointOfSale: originalInvoice.pointOfSale,
        invoiceNumberSuffix: creditNoteNumber.split('-')[1] || creditNoteNumber,
        cae: null,
        generalDiscount: originalInvoice.generalDiscount,
        subtotal,
        discountAmount,
        netAmount,
        taxAmount,
        total,
        balance: 0, // Credit notes don't have balance
        currency: originalInvoice.currency,
        status: 'APPROVED', // Credit notes are auto-approved
        paymentStatus: 'COMPLETED', // Credit notes don't require payment
        createdBy: userId,
        description: `Nota de crédito por devolución - Ref: ${originalInvoice.invoiceNumber}`,
        items: {
          create: creditNoteItems,
        },
      },
      include: {
        supplier: true,
        items: {
          include: {
            product: true,
            account: true,
          },
        },
      },
    });

    // 2. Update supplier balance (reduce debt)
    await tx.supplier.update({
      where: { id: originalInvoice.supplierId },
      data: {
        balance: {
          decrement: total,
        },
      },
    });

    // 3. Update original invoice balance if applicable
    if (Number(originalInvoice.balance) > 0) {
      const newBalance = Math.max(0, Number(originalInvoice.balance) - total);
      await tx.purchaseInvoice.update({
        where: { id: originalInvoiceId },
        data: {
          balance: newBalance,
        },
      });
    }

    // 4. Generate journal entry
    const journalEntry = await generateCreditNoteJournalEntry({
      creditNote,
      originalInvoice,
      userId,
      tx,
    });

    // 5. Update inventory (reduce stock)
    await updateInventoryForCreditNote({
      creditNote,
      userId,
      tx,
    });

    return {
      creditNote,
      journalEntry,
    };
  });
}

/**
 * Genera el asiento contable para una nota de crédito de compra
 */
async function generateCreditNoteJournalEntry(data: {
  creditNote: any;
  originalInvoice: any;
  userId: string;
  tx: any;
}) {
  const { creditNote, originalInvoice, userId, tx } = data;

  // Get next entry number
  const lastEntry = await tx.journalEntry.findFirst({
    orderBy: { entryNumber: 'desc' },
    select: { entryNumber: true },
  });

  const nextEntryNumber = (lastEntry?.entryNumber || 0) + 1;

  // Get accounts
  const proveedoresAccount = await tx.chartOfAccount.findFirst({
    where: { code: '211100' }, // Proveedores en Cta Cte
  });

  const ivaAccount = await tx.chartOfAccount.findFirst({
    where: { code: '114102' }, // IVA Crédito Fiscal
  });

  if (!proveedoresAccount) {
    throw new Error('Cuenta de proveedores no encontrada (211100)');
  }

  const lines: Array<{
    accountCode: string;
    description: string;
    debit: number;
    credit: number;
  }> = [];

  // NOTA DE CRÉDITO: Invierte el asiento original
  // 1. DÉBITO: Proveedores (reduce deuda)
  lines.push({
    accountCode: proveedoresAccount.id,
    description: `NC ${creditNote.invoiceNumber} - ${creditNote.supplier.name}`,
    debit: Number(creditNote.total),
    credit: 0,
  });

  // 2. CRÉDITO: IVA Crédito Fiscal (reduce crédito fiscal)
  if (Number(creditNote.taxAmount) > 0 && ivaAccount) {
    lines.push({
      accountCode: ivaAccount.id,
      description: 'Reversión IVA Crédito Fiscal',
      debit: 0,
      credit: Number(creditNote.taxAmount),
    });
  }

  // 3. CRÉDITO: Mercaderías o cuenta específica (reduce activo)
  for (const item of creditNote.items) {
    let accountId = item.accountId;

    if (!accountId) {
      const mercaderiasAccount = await tx.chartOfAccount.findFirst({
        where: { code: '115100' }, // Mercaderías
      });
      accountId = mercaderiasAccount?.id || null;
    }

    if (accountId) {
      lines.push({
        accountCode: accountId,
        description: `Devolución: ${item.description}`,
        debit: 0,
        credit: Number(item.subtotal),
      });
    }
  }

  // Validate balanced entry
  const totalDebit = lines.reduce((sum, line) => sum + line.debit, 0);
  const totalCredit = lines.reduce((sum, line) => sum + line.credit, 0);

  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(
      `Asiento desbalanceado: Debe ${totalDebit.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} vs Haber ${totalCredit.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    );
  }

  // Create journal entry
  const entry = await tx.journalEntry.create({
    data: {
      entryNumber: nextEntryNumber,
      date: creditNote.invoiceDate,
      description: `Nota de crédito ${creditNote.invoiceNumber} - ${creditNote.supplier.name}`,
      reference: creditNote.invoiceNumber,
      status: 'POSTED',
      userId: userId,
      lines: {
        create: lines.map((line) => ({
          accountId: line.accountCode,
          description: line.description,
          debit: line.debit,
          credit: line.credit,
        })),
      },
    },
    include: {
      lines: {
        include: {
          account: true,
        },
      },
    },
  });

  // Update account balances
  for (const line of entry.lines) {
    if (line.debit > 0) {
      await tx.chartOfAccount.update({
        where: { id: line.accountId },
        data: {
          debitBalance: {
            increment: line.debit,
          },
        },
      });
    }
    if (line.credit > 0) {
      await tx.chartOfAccount.update({
        where: { id: line.accountId },
        data: {
          creditBalance: {
            increment: line.credit,
          },
        },
      });
    }
  }

  // Link journal entry to credit note
  await tx.purchaseInvoice.update({
    where: { id: creditNote.id },
    data: { journalEntryId: entry.id },
  });

  return entry;
}

/**
 * Actualiza el inventario al procesar una nota de crédito (reduce stock)
 */
async function updateInventoryForCreditNote(data: {
  creditNote: any;
  userId: string;
  tx: any;
}) {
  const { creditNote, userId, tx } = data;

  for (const item of creditNote.items) {
    if (item.productId) {
      const product = await tx.product.findUnique({
        where: { id: item.productId },
      });

      if (!product) continue;

      // Reduce stock
      await tx.product.update({
        where: { id: item.productId },
        data: {
          stockQuantity: {
            decrement: Number(item.quantity),
          },
        },
      });

      // Create stock movement
      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          type: 'DEVOLUCION_PROVEEDOR',
          quantity: -Number(item.quantity), // Negative because it's a return
          unitCost: Number(item.unitPrice),
          totalCost: -Number(item.subtotal), // Negative cost
          currency: creditNote.currency,
          reference: creditNote.invoiceNumber,
          notes: `NC ${creditNote.invoiceNumber} - Devolución`,
          date: creditNote.invoiceDate,
          userId: userId,
          stockBefore: product.stockQuantity,
          stockAfter: product.stockQuantity - Number(item.quantity),
        },
      });
    }
  }

  // Mark as stock impacted
  await tx.purchaseInvoice.update({
    where: { id: creditNote.id },
    data: {
      stockImpact: true,
      stockImpactedAt: new Date(),
    },
  });
}
