import { prisma } from '@/lib/prisma';

/**
 * Registra un pago a una factura de compra y genera el asiento contable
 */
export async function registerPurchasePayment(data: {
  purchaseInvoiceId: string;
  amount: number;
  paymentDate: Date;
  paymentMethod: string;
  reference?: string;
  notes?: string;
  userId: string;
}) {
  const { purchaseInvoiceId, amount, paymentDate, paymentMethod, reference, notes, userId } = data;

  // Get invoice
  const invoice = await prisma.purchaseInvoice.findUnique({
    where: { id: purchaseInvoiceId },
    include: {
      supplier: true,
    },
  });

  if (!invoice) {
    throw new Error('Factura no encontrada');
  }

  if (invoice.status === 'CANCELLED') {
    throw new Error('No se puede pagar una factura anulada');
  }

  if (Number(amount) <= 0) {
    throw new Error('El monto debe ser mayor a cero');
  }

  if (Number(amount) > Number(invoice.balance)) {
    throw new Error(
      `El monto excede el saldo pendiente de $${Number(invoice.balance).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    );
  }

  // Execute in transaction
  return await prisma.$transaction(async (tx) => {
    // 1. Create payment record
    const payment = await tx.purchasePayment.create({
      data: {
        purchaseInvoiceId,
        amount,
        paymentDate,
        paymentMethod,
        reference,
        notes,
      },
    });

    // 2. Update invoice balance and status
    const newBalance = Number(invoice.balance) - Number(amount);
    const isPaid = newBalance <= 0.01; // Consider paid if balance is less than 1 cent

    await tx.purchaseInvoice.update({
      where: { id: purchaseInvoiceId },
      data: {
        balance: newBalance,
        status: isPaid ? 'PAID' : invoice.status,
        paymentStatus: isPaid ? 'COMPLETED' : 'PENDING',
      },
    });

    // 3. Update supplier balance
    await tx.supplier.update({
      where: { id: invoice.supplierId },
      data: {
        balance: {
          decrement: amount,
        },
      },
    });

    // 4. Generate journal entry for payment
    const journalEntry = await generatePaymentJournalEntry({
      payment,
      invoice,
      userId,
      tx,
    });

    return {
      payment,
      journalEntry,
    };
  });
}

/**
 * Genera el asiento contable para un pago a proveedor
 */
async function generatePaymentJournalEntry(data: {
  payment: any;
  invoice: any;
  userId: string;
  tx: any;
}) {
  const { payment, invoice, userId, tx } = data;

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

  if (!proveedoresAccount) {
    throw new Error('Cuenta de proveedores no encontrada (211100)');
  }

  // Get payment method account
  let paymentAccountCode = '111100'; // Default: Caja
  switch (payment.paymentMethod) {
    case 'CASH':
      paymentAccountCode = '111100'; // Caja
      break;
    case 'TRANSFER':
    case 'DEBIT':
      paymentAccountCode = '111200'; // Banco cuenta corriente
      break;
    case 'CHECK':
      paymentAccountCode = '111300'; // Valores a depositar
      break;
    case 'CREDIT':
      paymentAccountCode = '111200'; // Banco cuenta corriente
      break;
  }

  const paymentAccount = await tx.chartOfAccount.findFirst({
    where: { code: paymentAccountCode },
  });

  if (!paymentAccount) {
    throw new Error(`Cuenta de pago no encontrada (${paymentAccountCode})`);
  }

  // Create journal entry
  // DEBE: Proveedores (reduce deuda)
  // HABER: Caja/Banco (sale dinero)
  const entry = await tx.journalEntry.create({
    data: {
      entryNumber: nextEntryNumber,
      date: payment.paymentDate,
      description: `Pago a proveedor ${invoice.supplier.name} - Factura ${invoice.invoiceNumber}`,
      reference: payment.reference || invoice.invoiceNumber,
      status: 'POSTED',
      userId: userId,
      lines: {
        create: [
          {
            accountId: proveedoresAccount.id,
            description: `Pago factura ${invoice.invoiceNumber}`,
            debit: Number(payment.amount),
            credit: 0,
          },
          {
            accountId: paymentAccount.id,
            description: `Pago ${payment.paymentMethod} - ${payment.reference || ''}`,
            debit: 0,
            credit: Number(payment.amount),
          },
        ],
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
  await tx.chartOfAccount.update({
    where: { id: proveedoresAccount.id },
    data: {
      debitBalance: {
        increment: Number(payment.amount),
      },
    },
  });

  await tx.chartOfAccount.update({
    where: { id: paymentAccount.id },
    data: {
      creditBalance: {
        increment: Number(payment.amount),
      },
    },
  });

  return entry;
}

/**
 * Registra un pago directo a proveedor (sin factura específica)
 */
export async function registerSupplierPayment(data: {
  supplierId: string;
  amount: number;
  paymentDate: Date;
  paymentMethod: string;
  reference?: string;
  notes?: string;
  userId: string;
  purchaseOrderId?: string;
}) {
  const { supplierId, amount, paymentDate, paymentMethod, reference, notes, userId, purchaseOrderId } = data;

  // Get supplier
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
  });

  if (!supplier) {
    throw new Error('Proveedor no encontrado');
  }

  if (Number(amount) <= 0) {
    throw new Error('El monto debe ser mayor a cero');
  }

  // Execute in transaction
  return await prisma.$transaction(async (tx) => {
    // 1. Create payment record
    const payment = await tx.supplierPayment.create({
      data: {
        supplierId,
        amount,
        paymentDate,
        method: paymentMethod,
        reference,
        notes,
        purchaseOrderId,
        userId,
        currency: 'ARS',
      },
    });

    // 2. Update supplier balance
    await tx.supplier.update({
      where: { id: supplierId },
      data: {
        balance: {
          decrement: amount,
        },
      },
    });

    // 3. If there's a purchase order, update paidAmount
    if (purchaseOrderId) {
      await tx.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: {
          paidAmount: {
            increment: amount,
          },
        },
      });
    }

    // 4. Generate journal entry for payment
    const journalEntry = await generateSupplierPaymentJournalEntry({
      payment,
      supplier,
      userId,
      tx,
    });

    return {
      payment,
      journalEntry,
    };
  });
}

/**
 * Genera el asiento contable para un pago directo a proveedor
 */
async function generateSupplierPaymentJournalEntry(data: {
  payment: any;
  supplier: any;
  userId: string;
  tx: any;
}) {
  const { payment, supplier, userId, tx } = data;

  // Get next entry number
  const lastEntry = await tx.journalEntry.findFirst({
    orderBy: { entryNumber: 'desc' },
    select: { entryNumber: true },
  });

  const nextEntryNumber = (lastEntry?.entryNumber || 0) + 1;

  // Get accounts
  const proveedoresAccount = await tx.chartOfAccount.findFirst({
    where: { code: '2.1.01.001' }, // Proveedores
  });

  if (!proveedoresAccount) {
    throw new Error('Cuenta de proveedores no encontrada (2.1.01.001)');
  }

  // Get payment method account
  let paymentAccountCode = '1.1.01.002'; // Default: Caja Chica
  switch (payment.method) {
    case 'CASH':
      paymentAccountCode = '1.1.01.002'; // Caja Chica
      break;
    case 'TRANSFER':
    case 'DEBIT':
      paymentAccountCode = '1.1.01.003'; // Banco Cuenta Corriente
      break;
    case 'CHECK':
      paymentAccountCode = '1.1.01.005'; // Valores a Depositar
      break;
    case 'CREDIT':
      paymentAccountCode = '1.1.01.003'; // Banco Cuenta Corriente
      break;
  }

  const paymentAccount = await tx.chartOfAccount.findFirst({
    where: { code: paymentAccountCode },
  });

  if (!paymentAccount) {
    throw new Error(`Cuenta de pago no encontrada (${paymentAccountCode})`);
  }

  // Create journal entry
  // DEBE: Proveedores (reduce deuda)
  // HABER: Caja/Banco (sale dinero)
  const entry = await tx.journalEntry.create({
    data: {
      entryNumber: nextEntryNumber,
      date: payment.paymentDate,
      description: `Pago a proveedor ${supplier.name}${payment.reference ? ` - Ref: ${payment.reference}` : ''}`,
      reference: payment.reference || payment.id,
      status: 'POSTED',
      userId: userId,
      lines: {
        create: [
          {
            accountId: proveedoresAccount.id,
            description: `Pago a ${supplier.name}`,
            debit: Number(payment.amount),
            credit: 0,
          },
          {
            accountId: paymentAccount.id,
            description: `Pago ${payment.method}${payment.reference ? ` - ${payment.reference}` : ''}`,
            debit: 0,
            credit: Number(payment.amount),
          },
        ],
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
  await tx.chartOfAccount.update({
    where: { id: proveedoresAccount.id },
    data: {
      debitBalance: {
        increment: Number(payment.amount),
      },
    },
  });

  await tx.chartOfAccount.update({
    where: { id: paymentAccount.id },
    data: {
      creditBalance: {
        increment: Number(payment.amount),
      },
    },
  });

  return entry;
}

/**
 * Registra un cobro a cliente
 */
export async function registerCustomerReceipt(data: {
  customerId: string;
  amount: number;
  receiptDate: Date;
  paymentMethod: string;
  reference?: string;
  notes?: string;
  userId: string;
  invoiceId?: string;
}) {
  const { customerId, amount, receiptDate, paymentMethod, reference, notes, userId, invoiceId } = data;

  // Get customer
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
  });

  if (!customer) {
    throw new Error('Cliente no encontrado');
  }

  if (Number(amount) <= 0) {
    throw new Error('El monto debe ser mayor a cero');
  }

  // Execute in transaction
  return await prisma.$transaction(async (tx) => {
    // 1. Create receipt record
    const receipt = await tx.customerReceipt.create({
      data: {
        customerId,
        amount,
        receiptDate,
        method: paymentMethod,
        reference,
        notes,
        invoiceId,
        userId,
        currency: 'ARS',
      },
    });

    // 2. Update customer balance
    await tx.customer.update({
      where: { id: customerId },
      data: {
        balance: {
          decrement: amount,
        },
      },
    });

    // 3. If there's an invoice, update its balance
    if (invoiceId) {
      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
      });

      if (invoice) {
        const newBalance = Number(invoice.balance || invoice.total) - Number(amount);
        const isPaid = newBalance <= 0.01;

        await tx.invoice.update({
          where: { id: invoiceId },
          data: {
            balance: newBalance,
            paymentStatus: isPaid ? 'PAID' : 'PARTIAL',
          },
        });
      }
    }

    // 4. Generate journal entry for receipt
    const journalEntry = await generateCustomerReceiptJournalEntry({
      receipt,
      customer,
      userId,
      tx,
    });

    return {
      receipt,
      journalEntry,
    };
  });
}

/**
 * Genera el asiento contable para un cobro a cliente
 */
async function generateCustomerReceiptJournalEntry(data: {
  receipt: any;
  customer: any;
  userId: string;
  tx: any;
}) {
  const { receipt, customer, userId, tx } = data;

  // Get next entry number
  const lastEntry = await tx.journalEntry.findFirst({
    orderBy: { entryNumber: 'desc' },
    select: { entryNumber: true },
  });

  const nextEntryNumber = (lastEntry?.entryNumber || 0) + 1;

  // Get accounts
  const deudoresAccount = await tx.chartOfAccount.findFirst({
    where: { code: '1.1.03' }, // Créditos por Ventas
  });

  if (!deudoresAccount) {
    throw new Error('Cuenta de deudores no encontrada (1.1.03)');
  }

  // Get payment method account
  let paymentAccountCode = '1.1.01.002'; // Default: Caja Chica
  switch (receipt.method) {
    case 'CASH':
      paymentAccountCode = '1.1.01.002'; // Caja Chica
      break;
    case 'TRANSFER':
    case 'DEBIT':
      paymentAccountCode = '1.1.01.003'; // Banco Cuenta Corriente
      break;
    case 'CHECK':
      paymentAccountCode = '1.1.01.005'; // Valores a Depositar
      break;
    case 'CREDIT':
      paymentAccountCode = '1.1.01.003'; // Banco Cuenta Corriente
      break;
  }

  const paymentAccount = await tx.chartOfAccount.findFirst({
    where: { code: paymentAccountCode },
  });

  if (!paymentAccount) {
    throw new Error(`Cuenta de cobro no encontrada (${paymentAccountCode})`);
  }

  // Create journal entry
  // DEBE: Caja/Banco (entra dinero)
  // HABER: Deudores por Ventas (reduce deuda del cliente)
  const entry = await tx.journalEntry.create({
    data: {
      entryNumber: nextEntryNumber,
      date: receipt.receiptDate,
      description: `Cobro a cliente ${customer.name}${receipt.reference ? ` - Ref: ${receipt.reference}` : ''}`,
      reference: receipt.reference || receipt.id,
      status: 'POSTED',
      userId: userId,
      lines: {
        create: [
          {
            accountId: paymentAccount.id,
            description: `Cobro ${receipt.method}${receipt.reference ? ` - ${receipt.reference}` : ''}`,
            debit: Number(receipt.amount),
            credit: 0,
          },
          {
            accountId: deudoresAccount.id,
            description: `Cobro de ${customer.name}`,
            debit: 0,
            credit: Number(receipt.amount),
          },
        ],
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
  await tx.chartOfAccount.update({
    where: { id: paymentAccount.id },
    data: {
      debitBalance: {
        increment: Number(receipt.amount),
      },
    },
  });

  await tx.chartOfAccount.update({
    where: { id: deudoresAccount.id },
    data: {
      creditBalance: {
        increment: Number(receipt.amount),
      },
    },
  });

  return entry;
}

/**
 * Obtiene el estado de cuenta de un proveedor
 */
export async function getSupplierAccountStatement(
  supplierId: string,
  startDate?: Date,
  endDate?: Date
) {
  const where: any = { supplierId };

  if (startDate || endDate) {
    where.invoiceDate = {};
    if (startDate) where.invoiceDate.gte = startDate;
    if (endDate) where.invoiceDate.lte = endDate;
  }

  // Get invoices
  const invoices = await prisma.purchaseInvoice.findMany({
    where,
    include: {
      payments: true,
    },
    orderBy: {
      invoiceDate: 'asc',
    },
  });

  // Get supplier
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
  });

  if (!supplier) {
    throw new Error('Proveedor no encontrado');
  }

  // Build statement
  const movements: any[] = [];
  let runningBalance = 0;

  for (const invoice of invoices) {
    // Add invoice
    runningBalance += Number(invoice.total);
    movements.push({
      date: invoice.invoiceDate,
      type: 'INVOICE',
      reference: invoice.invoiceNumber,
      description: `Factura ${invoice.invoiceNumber}`,
      debit: Number(invoice.total),
      credit: 0,
      balance: runningBalance,
      invoice: invoice,
    });

    // Add payments
    for (const payment of invoice.payments) {
      runningBalance -= Number(payment.amount);
      movements.push({
        date: payment.paymentDate,
        type: 'PAYMENT',
        reference: payment.reference || payment.id,
        description: `Pago ${payment.paymentMethod}`,
        debit: 0,
        credit: Number(payment.amount),
        balance: runningBalance,
        payment: payment,
      });
    }
  }

  return {
    supplier,
    movements,
    currentBalance: runningBalance,
    totalInvoices: invoices.reduce((sum, inv) => sum + Number(inv.total), 0),
    totalPayments: invoices.reduce(
      (sum, inv) =>
        sum + inv.payments.reduce((pSum, p) => pSum + Number(p.amount), 0),
      0
    ),
  };
}
