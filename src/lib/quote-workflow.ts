import { prisma } from '@/lib/prisma';
import { QuoteStatus, DeliveryNoteStatus } from '@prisma/client';
import { logger } from '@/lib/logger';

/**
 * Calcula la fecha de vencimiento según los días de la condición de pago del cliente.
 * Si no hay condición de pago, fecha vencimiento = fecha emisión (contado).
 */
export function calcDueDate(issueDate: Date, paymentTermsDays: number | null | undefined): Date {
  const days = paymentTermsDays && paymentTermsDays > 0 ? paymentTermsDays : 0;
  const dueDate = new Date(issueDate);
  dueDate.setDate(dueDate.getDate() + days);
  return dueDate;
}

// Transiciones permitidas de estado para cotizaciones
const ALLOWED_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  DRAFT: ['SENT', 'ACCEPTED', 'REJECTED', 'CANCELLED'],
  SENT: ['ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED'],
  ACCEPTED: ['CONVERTED', 'CANCELLED', 'DRAFT'],
  REJECTED: [],
  EXPIRED: [],
  CANCELLED: ['DRAFT'],
  CONVERTED: ['ACCEPTED'],
};

interface UpdateQuoteStatusData {
  customerResponse?: string;
  rejectionReason?: string;
  revertReason?: string;
}

/**
 * Actualiza el estado de una cotización con validación de transiciones
 */
export async function updateQuoteStatus(
  quoteId: string,
  newStatus: QuoteStatus,
  userId: string,
  data?: UpdateQuoteStatusData
) {
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId }
  });

  if (!quote) {
    throw new Error('Cotización no encontrada');
  }

  // Validar transición permitida
  if (!ALLOWED_TRANSITIONS[quote.status].includes(newStatus)) {
    throw new Error(
      `No se puede cambiar de ${quote.status} a ${newStatus}`
    );
  }

  // Determinar si es una reversión
  const isRevert = (
    (quote.status === 'CONVERTED' && newStatus === 'ACCEPTED') ||
    (quote.status === 'ACCEPTED' && newStatus === 'DRAFT') ||
    (quote.status === 'CANCELLED' && newStatus === 'DRAFT')
  );

  // Determinar notas para el historial
  const historyNotes = data?.revertReason || data?.customerResponse || data?.rejectionReason || null;

  // Construir datos de actualización
  const updateData: any = {
    status: newStatus,
    statusUpdatedAt: new Date(),
    statusUpdatedBy: userId,
  };

  // Campos estándar para transiciones normales
  if (newStatus === 'ACCEPTED' || newStatus === 'REJECTED') {
    if (!isRevert) {
      updateData.responseDate = new Date();
    }
  }
  if (data?.customerResponse) updateData.customerResponse = data.customerResponse;
  if (data?.rejectionReason) updateData.rejectionReason = data.rejectionReason;

  // Limpieza de campos en reversiones
  if (quote.status === 'CONVERTED' && newStatus === 'ACCEPTED') {
    // Revertir CONVERTED → ACCEPTED: limpiar campos de Colppy
    updateData.colppyInvoiceId = null;
    updateData.colppyDeliveryNoteId = null;
    updateData.colppySyncedAt = null;
  }

  if ((quote.status === 'ACCEPTED' || quote.status === 'CANCELLED') && newStatus === 'DRAFT') {
    // Revertir a DRAFT: limpiar respuesta del cliente
    updateData.responseDate = null;
    updateData.customerResponse = null;
  }

  // Actualizar estado en una transacción
  const updated = await prisma.$transaction(async (tx) => {
    // Crear registro en historial
    await tx.quoteStatusHistory.create({
      data: {
        quoteId,
        fromStatus: quote.status,
        toStatus: newStatus,
        changedBy: userId,
        notes: historyNotes,
      }
    });

    // Actualizar cotización
    return tx.quote.update({
      where: { id: quoteId },
      data: updateData,
      include: {
        customer: true,
        salesPerson: true,
        items: {
          include: {
            product: true
          }
        }
      }
    });
  });

  return updated;
}

/**
 * Genera un número de remito secuencial.
 *
 * Si hay un CaiConfig activo (no vencido, con rango disponible):
 *   → Usa el PV del CAI (ej: 0006) y asigna el siguiente número del rango.
 *   → Incrementa lastUsedNumber atómicamente.
 *   → Devuelve { deliveryNumber, caiNumber }.
 *
 * Si NO hay CaiConfig activo (contingencia / legacy):
 *   → Usa PV 0002 con la numeración secuencial histórica.
 *   → Devuelve { deliveryNumber, caiNumber: null }.
 */
// Mínimo secuencial para continuar la numeración pre-ERP (PV 0002)
const DELIVERY_NUMBER_MIN = 11414;

export async function generateDeliveryNumber(): Promise<{ deliveryNumber: string; caiNumber: string | null }> {
  // Intentar usar CAI activo (si la tabla existe y hay config)
  try {
    if (prisma.caiConfig) {
      const caiConfig = await prisma.caiConfig.findFirst({
        where: { active: true },
        orderBy: { createdAt: 'desc' },
      });

      if (caiConfig) {
        const now = new Date();
        const notExpired = now <= caiConfig.caiExpirationDate;
        const nextNumber = caiConfig.lastUsedNumber + 1;
        const hasRange = nextNumber <= caiConfig.endNumber;

        if (notExpired && hasRange) {
          // Incrementar atómicamente
          await prisma.caiConfig.update({
            where: { id: caiConfig.id },
            data: { lastUsedNumber: nextNumber },
          });

          const pv = String(caiConfig.pointOfSale).padStart(4, '0');
          const num = String(nextNumber).padStart(8, '0');
          return {
            deliveryNumber: `RE ${pv}-${num}`,
            caiNumber: caiConfig.caiNumber,
          };
        }
      }
    }
  } catch (error) {
    // Si caiConfig no existe en el Prisma client o la tabla no existe,
    // continuar con fallback PV 0002 sin romper
    logger.warn('CAI config not available, falling back to PV 0002:', error instanceof Error ? error.message : error);
  }

  // Fallback: PV 0002 (legacy / contingencia) — wrapped in transaction to prevent race conditions
  const deliveryNumber = await prisma.$transaction(async (tx) => {
    const lastDeliveryNote = await tx.deliveryNote.findFirst({
      where: { deliveryNumber: { startsWith: 'RE 0002' } },
      orderBy: { createdAt: 'desc' },
      select: { deliveryNumber: true },
    });

    let lastNumber = 0;
    if (lastDeliveryNote) {
      const match = lastDeliveryNote.deliveryNumber.match(/(\d+)$/);
      lastNumber = match ? parseInt(match[1]) : 0;
    }

    const number = Math.max(lastNumber, DELIVERY_NUMBER_MIN) + 1;
    return `RE 0002-${String(number).padStart(8, '0')}`;
  });

  return { deliveryNumber, caiNumber: null };
}

/**
 * Genera un remito desde una cotización aceptada
 */
export async function generateDeliveryNoteFromQuote(
  quoteId: string,
  data?: {
    deliveryAddress?: string;
    deliveryCity?: string;
    deliveryProvince?: string;
    deliveryPostalCode?: string;
    carrier?: string;
    transportAddress?: string;
    purchaseOrder?: string;
    customerInvoiceNumber?: string;
    bultos?: string;
    notes?: string;
  }
) {
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: {
      items: {
        include: {
          product: true,
          additionals: {
            include: {
              product: true
            },
            orderBy: { position: 'asc' }
          }
        }
      },
      customer: true
    }
  });

  if (!quote) {
    throw new Error('Cotización no encontrada');
  }

  if (quote.status !== 'ACCEPTED' && quote.status !== 'CONVERTED') {
    throw new Error('Solo se pueden generar remitos de cotizaciones aceptadas o convertidas');
  }

  // Generar número de remito (usa CAI si hay activo, sino PV 0002)
  const { deliveryNumber, caiNumber } = await generateDeliveryNumber();

  // Crear remito en transacción
  const deliveryNote = await prisma.$transaction(async (tx) => {
    // Calcular valor declarado: subtotal USD × tipo de cambio = ARS sin IVA
    const quoteExchangeRate = Number(quote.exchangeRate) || 1;
    const quoteSubtotal = Number(quote.subtotal);
    const calculatedTotalAmountARS = quote.currency === 'USD'
      ? quoteSubtotal * quoteExchangeRate
      : quoteSubtotal;

    // Armar items del remito: principales + adicionales de cada item
    const deliveryItems: Array<{
      productId: string | null;
      sku: string | null;
      description: string;
      quantity: number;
      unit: string;
    }> = [];

    for (const item of quote.items) {
      if (item.isAlternative) continue; // Solo items principales

      // Item principal
      deliveryItems.push({
        productId: item.productId || null,
        sku: item.product?.sku || item.manualSku || null,
        description: item.description || item.product?.name || 'Item',
        quantity: item.quantity,
        unit: item.product?.unit || 'UN',
      });

      // Adicionales del item
      if (item.additionals && item.additionals.length > 0) {
        for (const add of item.additionals) {
          deliveryItems.push({
            productId: add.productId || null,
            sku: add.product?.sku || null,
            description: add.description || add.product?.name || 'Adicional',
            quantity: item.quantity, // misma cantidad que el item principal
            unit: add.product?.unit || 'UN',
          });
        }
      }
    }

    const newDeliveryNote = await tx.deliveryNote.create({
      data: {
        deliveryNumber,
        ...(caiNumber ? { caiNumber } : {}),
        quoteId: quote.id,
        customerId: quote.customerId,
        date: new Date(),
        deliveryAddress: data?.deliveryAddress || quote.customer.address || null,
        deliveryCity: data?.deliveryCity || quote.customer.city || null,
        deliveryProvince: data?.deliveryProvince || quote.customer.province || null,
        deliveryPostalCode: data?.deliveryPostalCode || quote.customer.postalCode || null,
        carrier: data?.carrier || quote.customer.defaultTransportName || null,
        transportAddress: data?.transportAddress || quote.customer.defaultTransportAddress || null,
        purchaseOrder: data?.purchaseOrder || null,
        customerInvoiceNumber: data?.customerInvoiceNumber || null,
        bultos: data?.bultos || null,
        totalAmountARS: calculatedTotalAmountARS,
        exchangeRate: quoteExchangeRate,
        notes: data?.notes || null,
        status: 'PENDING',
        items: {
          create: deliveryItems
        }
      },
      include: {
        items: {
          include: {
            product: true
          }
        },
        customer: true,
        quote: true
      }
    });

    // Registrar en historial sin cambiar el status
    // (el status cambia a CONVERTED solo al enviar factura a Colppy)
    await tx.quoteStatusHistory.create({
      data: {
        quoteId,
        fromStatus: quote.status,
        toStatus: quote.status,
        changedBy: 'system',
        notes: `Remito ${deliveryNumber} generado`
      }
    });

    return newDeliveryNote;
  });

  return deliveryNote;
}

/**
 * Determina el tipo de factura según la condición IVA del cliente
 */
export function determineInvoiceType(taxCondition: string): 'A' | 'B' | 'C' | 'E' {
  switch (taxCondition) {
    case 'RESPONSABLE_INSCRIPTO':
      return 'A';
    case 'EXENTO':
      return 'C';
    case 'MONOTRIBUTO':
    case 'CONSUMIDOR_FINAL':
    case 'NO_RESPONSABLE':
    case 'RESPONSABLE_NO_INSCRIPTO':
      return 'B';
    default:
      return 'B';
  }
}

/**
 * Genera número de factura
 */
export async function generateInvoiceNumber(
  pointOfSale: string,
  invoiceType: 'A' | 'B' | 'C' | 'E'
): Promise<string> {
  const lastInvoice = await prisma.invoice.findFirst({
    where: {
      invoiceType,
      invoiceNumber: {
        startsWith: pointOfSale
      }
    },
    orderBy: { invoiceNumber: 'desc' },
    select: { invoiceNumber: true }
  });

  let nextNumber = 1;

  if (lastInvoice) {
    const parts = lastInvoice.invoiceNumber.split('-');
    if (parts.length === 2) {
      nextNumber = parseInt(parts[1]) + 1;
    }
  }

  return `${pointOfSale}-${String(nextNumber).padStart(8, '0')}`;
}

/**
 * Genera una factura desde un remito
 */
export async function generateInvoiceFromDeliveryNote(
  deliveryNoteId: string,
  userId: string,
  data?: {
    pointOfSale?: string;
    dueDate?: Date;
    notes?: string;
  }
) {
  const deliveryNote = await prisma.deliveryNote.findUnique({
    where: { id: deliveryNoteId },
    include: {
      items: {
        include: {
          product: true
        }
      },
      customer: true,
      quote: {
        include: {
          items: true
        }
      }
    }
  });

  if (!deliveryNote) {
    throw new Error('Remito no encontrado');
  }

  // Determinar tipo de factura
  const invoiceType = determineInvoiceType(deliveryNote.customer!.taxCondition);
  const pointOfSale = data?.pointOfSale || '0001';

  // Generar número de factura
  const invoiceNumber = await generateInvoiceNumber(pointOfSale, invoiceType);

  // Calcular totales
  const subtotal = deliveryNote.items.reduce((sum, item) => {
    // Buscar precio desde la cotización
    const quoteItem = deliveryNote.quote?.items.find(
      qi => qi.productId === item.productId
    );
    const unitPrice = quoteItem?.unitPrice || 0;
    return sum + (Number(unitPrice) * Number(item.quantity));
  }, 0);

  // IVA 21% aplica tanto a factura A como B (en B se incluye en el precio, en A se discrimina)
  const taxRate = 0.21;
  const taxAmount = subtotal * taxRate;
  const total = subtotal + taxAmount;

  // Crear factura
  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber,
      invoiceType,
      transactionType: 'SALE',
      quoteId: deliveryNote.quoteId,
      deliveryNoteId: deliveryNote.id,
      customerId: deliveryNote.customerId!,
      userId,
      status: 'DRAFT',
      currency: deliveryNote.quote?.currency || 'ARS',
      exchangeRate: deliveryNote.quote?.exchangeRate,
      subtotal,
      taxAmount,
      discount: 0,
      total,
      balance: total,
      issueDate: new Date(),
      dueDate: data?.dueDate || calcDueDate(new Date(), deliveryNote.customer!.paymentTerms),
      notes: data?.notes || null,
      afipStatus: 'PENDING',
      paymentStatus: 'UNPAID',
      items: {
        create: deliveryNote.items.map(item => {
          const quoteItem = deliveryNote.quote?.items.find(
            qi => qi.productId === item.productId
          );
          const unitPrice = Number(quoteItem?.unitPrice || 0);
          const itemSubtotal = unitPrice * Number(item.quantity);

          return {
            productId: item.productId,
            description: item.description,
            quantity: item.quantity,
            unitPrice,
            discount: 0,
            taxRate: taxRate * 100, // Guardar como porcentaje
            subtotal: itemSubtotal
          };
        })
      }
    },
    include: {
      items: {
        include: {
          product: true
        }
      },
      customer: true,
      deliveryNote: true,
      quote: true
    }
  });

  return invoice;
}

/**
 * Genera una factura directamente desde una cotización (sin remito)
 */
export async function generateInvoiceFromQuote(
  quoteId: string,
  userId: string,
  data?: {
    pointOfSale?: string;
    dueDate?: Date;
    notes?: string;
  }
) {
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: {
      items: {
        include: {
          product: true
        }
      },
      customer: true
    }
  });

  if (!quote) {
    throw new Error('Cotización no encontrada');
  }

  if (quote.status !== 'ACCEPTED') {
    throw new Error('Solo se pueden facturar cotizaciones aceptadas');
  }

  // Determinar tipo de factura
  const invoiceType = determineInvoiceType(quote.customer.taxCondition);
  const pointOfSale = data?.pointOfSale || '0001';

  // Generar número de factura
  const invoiceNumber = await generateInvoiceNumber(pointOfSale, invoiceType);

  // Calcular totales
  const subtotal = quote.items
    .filter(item => !item.isAlternative)
    .reduce((sum, item) => sum + Number(item.totalPrice), 0);

  // IVA 21% aplica tanto a factura A como B (en B se incluye en el precio, en A se discrimina)
  const taxRate = 0.21;
  const taxAmount = subtotal * taxRate;
  const total = subtotal + taxAmount;

  // Crear factura en transacción
  const invoice = await prisma.$transaction(async (tx) => {
    const newInvoice = await tx.invoice.create({
      data: {
        invoiceNumber,
        invoiceType,
        transactionType: 'SALE',
        quoteId: quote.id,
        customerId: quote.customerId,
        userId,
        status: 'DRAFT',
        currency: quote.currency,
        exchangeRate: quote.exchangeRate,
        subtotal,
        taxAmount,
        discount: 0,
        total,
        balance: total,
        issueDate: new Date(),
        dueDate: data?.dueDate || calcDueDate(new Date(), quote.customer.paymentTerms),
        notes: data?.notes || null,
        afipStatus: 'PENDING',
        paymentStatus: 'UNPAID',
        items: {
          create: quote.items
            .filter(item => !item.isAlternative)
            .map(item => {
              const itemSubtotal = Number(item.totalPrice);

              return {
                productId: item.productId,
                quoteItemId: item.id,
                description: item.description || item.product?.name,
                quantity: item.quantity,
                unitPrice: Number(item.unitPrice),
                discount: 0,
                taxRate: taxRate * 100,
                subtotal: itemSubtotal
              };
            })
        }
      },
      include: {
        items: {
          include: {
            product: true
          }
        },
        customer: true,
        quote: true
      }
    });

    // Marcar cotización como convertida
    await tx.quote.update({
      where: { id: quoteId },
      data: {
        status: 'CONVERTED',
        statusUpdatedAt: new Date(),
        statusUpdatedBy: userId
      }
    });

    // Crear registro en historial
    await tx.quoteStatusHistory.create({
      data: {
        quoteId,
        fromStatus: 'ACCEPTED',
        toStatus: 'CONVERTED',
        changedBy: userId,
        notes: `Factura ${invoiceNumber} generada`
      }
    });

    return newInvoice;
  });

  return invoice;
}

/**
 * Actualiza el estado de un remito
 */
export async function updateDeliveryNoteStatus(
  deliveryNoteId: string,
  newStatus: DeliveryNoteStatus,
  data?: {
    deliveryDate?: Date;
    receivedBy?: string;
    notes?: string;
  }
) {
  return prisma.deliveryNote.update({
    where: { id: deliveryNoteId },
    data: {
      status: newStatus,
      deliveryDate: data?.deliveryDate || (newStatus === 'DELIVERED' ? new Date() : undefined),
      receivedBy: data?.receivedBy || undefined,
      internalNotes: data?.notes || undefined
    },
    include: {
      items: {
        include: {
          product: true
        }
      },
      customer: true,
      quote: true
    }
  });
}
