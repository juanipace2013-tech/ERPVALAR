import { prisma } from '@/lib/prisma';
import { QuoteStatus, DeliveryNoteStatus } from '@prisma/client';

// Transiciones permitidas de estado para cotizaciones
const ALLOWED_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  DRAFT: ['SENT', 'CANCELLED'],
  SENT: ['ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED'],
  ACCEPTED: ['CONVERTED', 'CANCELLED'],
  REJECTED: [],
  EXPIRED: [],
  CANCELLED: [],
  CONVERTED: []
};

interface UpdateQuoteStatusData {
  customerResponse?: string;
  rejectionReason?: string;
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

  // Actualizar estado en una transacción
  const updated = await prisma.$transaction(async (tx) => {
    // Crear registro en historial
    await tx.quoteStatusHistory.create({
      data: {
        quoteId,
        fromStatus: quote.status,
        toStatus: newStatus,
        changedBy: userId,
        notes: data?.customerResponse || data?.rejectionReason || null
      }
    });

    // Actualizar cotización
    return tx.quote.update({
      where: { id: quoteId },
      data: {
        status: newStatus,
        statusUpdatedAt: new Date(),
        statusUpdatedBy: userId,
        responseDate:
          newStatus === 'ACCEPTED' || newStatus === 'REJECTED'
            ? new Date()
            : undefined,
        customerResponse: data?.customerResponse || undefined,
        rejectionReason: data?.rejectionReason || undefined
      },
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
 * Genera un número de remito secuencial
 */
async function generateDeliveryNumber(): Promise<string> {
  const lastDeliveryNote = await prisma.deliveryNote.findFirst({
    orderBy: { deliveryNumber: 'desc' },
    select: { deliveryNumber: true }
  });

  if (!lastDeliveryNote) {
    return '0001-00000001';
  }

  // Formato: 0001-00000001 (punto de venta - número)
  const [pointOfSale, numberStr] = lastDeliveryNote.deliveryNumber.split('-');
  const number = parseInt(numberStr) + 1;

  return `${pointOfSale}-${String(number).padStart(8, '0')}`;
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
    throw new Error('Solo se pueden generar remitos de cotizaciones aceptadas');
  }

  // Generar número de remito
  const deliveryNumber = await generateDeliveryNumber();

  // Crear remito en transacción
  const deliveryNote = await prisma.$transaction(async (tx) => {
    const newDeliveryNote = await tx.deliveryNote.create({
      data: {
        deliveryNumber,
        quoteId: quote.id,
        customerId: quote.customerId,
        date: new Date(),
        deliveryAddress: data?.deliveryAddress || quote.customer.address || null,
        deliveryCity: data?.deliveryCity || quote.customer.city || null,
        deliveryProvince: data?.deliveryProvince || quote.customer.province || null,
        deliveryPostalCode: data?.deliveryPostalCode || quote.customer.postalCode || null,
        carrier: data?.carrier || null,
        notes: data?.notes || null,
        status: 'PENDING',
        items: {
          create: quote.items
            .filter(item => !item.isAlternative) // Solo items principales
            .map(item => ({
              productId: item.productId,
              description: item.description || item.product?.name,
              quantity: item.quantity
            }))
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
        statusUpdatedBy: 'system'
      }
    });

    // Crear registro en historial
    await tx.quoteStatusHistory.create({
      data: {
        quoteId,
        fromStatus: 'ACCEPTED',
        toStatus: 'CONVERTED',
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
function determineInvoiceType(taxCondition: string): 'A' | 'B' | 'C' | 'E' {
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
async function generateInvoiceNumber(
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
  const invoiceType = determineInvoiceType(deliveryNote.customer.taxCondition);
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
    return sum + (Number(unitPrice) * item.quantity);
  }, 0);

  const taxRate = invoiceType === 'A' ? 0.21 : 0;
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
      customerId: deliveryNote.customerId,
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
      dueDate: data?.dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      notes: data?.notes || null,
      afipStatus: 'PENDING',
      paymentStatus: 'UNPAID',
      items: {
        create: deliveryNote.items.map(item => {
          const quoteItem = deliveryNote.quote?.items.find(
            qi => qi.productId === item.productId
          );
          const unitPrice = Number(quoteItem?.unitPrice || 0);
          const itemSubtotal = unitPrice * item.quantity;
          const itemTaxAmount = itemSubtotal * taxRate;

          return {
            productId: item.productId,
            description: item.description,
            quantity: item.quantity,
            unitPrice,
            discount: 0,
            taxRate: taxRate * 100, // Guardar como porcentaje
            subtotal: itemSubtotal + itemTaxAmount
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

  const taxRate = invoiceType === 'A' ? 0.21 : 0;
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
        dueDate: data?.dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        notes: data?.notes || null,
        afipStatus: 'PENDING',
        paymentStatus: 'UNPAID',
        items: {
          create: quote.items
            .filter(item => !item.isAlternative)
            .map(item => {
              const itemSubtotal = Number(item.totalPrice);
              const itemTaxAmount = itemSubtotal * taxRate;

              return {
                productId: item.productId,
                description: item.description || item.product?.name,
                quantity: item.quantity,
                unitPrice: Number(item.unitPrice),
                discount: 0,
                taxRate: taxRate * 100,
                subtotal: itemSubtotal + itemTaxAmount
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
