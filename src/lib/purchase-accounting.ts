import { prisma } from '@/lib/prisma';

/**
 * Genera el asiento contable para una factura de compra
 */
export async function generatePurchaseInvoiceJournalEntry(invoiceId: string) {
  const invoice = await prisma.purchaseInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      supplier: true,
      items: {
        include: {
          product: true,
          account: true,
        },
      },
      taxes: true,
      perceptions: {
        include: {
          account: true,
        },
      },
    },
  });

  if (!invoice) {
    throw new Error('Factura no encontrada');
  }

  if (invoice.journalEntryId) {
    throw new Error('Esta factura ya tiene un asiento contable asociado');
  }

  // Obtener el siguiente número de asiento
  const lastEntry = await prisma.journalEntry.findFirst({
    orderBy: { entryNumber: 'desc' },
    select: { entryNumber: true },
  });

  const nextEntryNumber = (lastEntry?.entryNumber || 0) + 1;

  const lines: Array<{
    accountCode: string;
    description: string;
    debit: number;
    credit: number;
  }> = [];

  // 1. CRÉDITO: Proveedores en Cta Cte (total de la factura)
  const proveedoresAccount = await prisma.chartOfAccount.findFirst({
    where: { code: '211100' }, // Proveedores en Cta Cte
  });

  if (!proveedoresAccount) {
    throw new Error('Cuenta de proveedores no encontrada (211100)');
  }

  lines.push({
    accountCode: proveedoresAccount.id,
    description: `Factura ${invoice.invoiceNumber} - ${invoice.supplier.name}`,
    debit: 0,
    credit: Number(invoice.total),
  });

  // 2. DÉBITO: IVA Crédito Fiscal
  if (Number(invoice.taxAmount) > 0) {
    const ivaAccount = await prisma.chartOfAccount.findFirst({
      where: { code: '114102' }, // IVA Crédito Fiscal
    });

    if (ivaAccount) {
      lines.push({
        accountCode: ivaAccount.id,
        description: 'IVA Crédito Fiscal',
        debit: Number(invoice.taxAmount),
        credit: 0,
      });
    }
  }

  // 3. DÉBITO: Mercaderías o cuenta específica (por cada item)
  for (const item of invoice.items) {
    let accountId = item.accountId;

    // Si no tiene cuenta específica, usar Mercaderías por defecto
    if (!accountId) {
      const mercaderiasAccount = await prisma.chartOfAccount.findFirst({
        where: { code: '115100' }, // Mercaderías
      });
      accountId = mercaderiasAccount?.id || null;
    }

    if (accountId) {
      lines.push({
        accountCode: accountId,
        description: item.description,
        debit: Number(item.subtotal),
        credit: 0,
      });
    }
  }

  // 4. DÉBITO: Percepciones IIBB (por cada percepción)
  for (const perception of invoice.perceptions) {
    let accountId = perception.accountId;

    // Si no tiene cuenta específica, usar cuenta de percepciones por defecto
    if (!accountId) {
      const perceptionAccount = await prisma.chartOfAccount.findFirst({
        where: { code: '114301' }, // Ret y Percepciones Imp IIBB
      });
      accountId = perceptionAccount?.id || null;
    }

    if (accountId) {
      lines.push({
        accountCode: accountId,
        description: `Percepción ${perception.jurisdiction} ${perception.rate}%`,
        debit: Number(perception.amount),
        credit: 0,
      });
    }
  }

  // Validar que el asiento esté balanceado
  const totalDebit = lines.reduce((sum, line) => sum + line.debit, 0);
  const totalCredit = lines.reduce((sum, line) => sum + line.credit, 0);

  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(
      `Asiento desbalanceado: Debe ${totalDebit.toFixed(2)} vs Haber ${totalCredit.toFixed(2)}`
    );
  }

  // Crear asiento contable
  const entry = await prisma.journalEntry.create({
    data: {
      entryNumber: nextEntryNumber,
      date: invoice.invoiceDate,
      description: `Factura de compra ${invoice.invoiceNumber} - ${invoice.supplier.name}`,
      reference: invoice.invoiceNumber,
      status: 'POSTED',
      userId: invoice.createdBy,
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

  // Vincular asiento a la factura
  await prisma.purchaseInvoice.update({
    where: { id: invoiceId },
    data: { journalEntryId: entry.id },
  });

  // Actualizar saldos de las cuentas
  for (const line of entry.lines) {
    if (line.debit > 0) {
      await prisma.chartOfAccount.update({
        where: { id: line.accountId },
        data: {
          debitBalance: {
            increment: line.debit,
          },
        },
      });
    }
    if (line.credit > 0) {
      await prisma.chartOfAccount.update({
        where: { id: line.accountId },
        data: {
          creditBalance: {
            increment: line.credit,
          },
        },
      });
    }
  }

  return entry;
}

/**
 * Actualiza el inventario al aprobar una factura de compra
 */
export async function updateInventoryFromPurchase(invoiceId: string) {
  const invoice = await prisma.purchaseInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      supplier: true,
      items: {
        include: {
          product: true,
        },
      },
    },
  });

  if (!invoice) {
    throw new Error('Factura no encontrada');
  }

  if (invoice.stockImpact) {
    throw new Error('Esta factura ya impactó en el inventario');
  }

  for (const item of invoice.items) {
    if (item.productId) {
      // Actualizar stock del producto
      await prisma.product.update({
        where: { id: item.productId },
        data: {
          stockQuantity: {
            increment: Number(item.quantity),
          },
          // Actualizar último costo
          lastCost: Number(item.unitPrice),
        },
      });

      // Registrar movimiento de inventario
      await prisma.stockMovement.create({
        data: {
          productId: item.productId,
          type: 'COMPRA',
          quantity: Number(item.quantity),
          unitCost: Number(item.unitPrice),
          totalCost: Number(item.subtotal),
          currency: invoice.currency,
          reference: invoice.invoiceNumber,
          notes: `Compra ${invoice.invoiceNumber} - ${invoice.supplier.name}`,
          date: invoice.invoiceDate,
          userId: invoice.createdBy,
          stockBefore: item.product.stockQuantity,
          stockAfter: item.product.stockQuantity + Number(item.quantity),
        },
      });
    }
  }

  // Marcar como impactado
  await prisma.purchaseInvoice.update({
    where: { id: invoiceId },
    data: {
      stockImpact: true,
      stockImpactedAt: new Date(),
    },
  });
}

/**
 * Aprueba una factura de compra y genera automáticamente el asiento e impacto en inventario
 */
export async function approvePurchaseInvoice(invoiceId: string) {
  const invoice = await prisma.purchaseInvoice.findUnique({
    where: { id: invoiceId },
  });

  if (!invoice) {
    throw new Error('Factura no encontrada');
  }

  if (invoice.status === 'APPROVED' || invoice.status === 'PAID') {
    throw new Error('La factura ya está aprobada');
  }

  // Ejecutar en transacción
  await prisma.$transaction(async (tx) => {
    // 1. Actualizar estado de la factura
    await tx.purchaseInvoice.update({
      where: { id: invoiceId },
      data: {
        status: 'APPROVED',
      },
    });

    // 2. Generar asiento contable
    await generatePurchaseInvoiceJournalEntry(invoiceId);

    // 3. Actualizar inventario
    await updateInventoryFromPurchase(invoiceId);

    // 4. Actualizar balance del proveedor
    await tx.supplier.update({
      where: { id: invoice.supplierId },
      data: {
        balance: {
          increment: Number(invoice.total),
        },
      },
    });
  });

  return prisma.purchaseInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      supplier: true,
      items: {
        include: {
          product: true,
        },
      },
      journalEntry: {
        include: {
          lines: {
            include: {
              account: true,
            },
          },
        },
      },
    },
  });
}
