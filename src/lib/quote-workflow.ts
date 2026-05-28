import { prisma } from '@/lib/prisma';
import { QuoteStatus, DeliveryNoteStatus, Prisma } from '@prisma/client';
import { logger } from '@/lib/logger';

/**
 * Ejecuta `fn` dentro de una transacción Serializable, con reintentos
 * automáticos ante fallos de concurrencia (CAI_CONCURRENT_UPDATE o
 * Postgres serialization_failure / Prisma P2034).
 *
 * Pensada para envolver "asignar número de remito + create del DeliveryNote"
 * en una única unidad atómica: si el create falla, el incremento del
 * contador (lastUsedNumber) se rollbackea y NO queda hueco en la numeración.
 */
export async function withDeliveryTx<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  const MAX_ATTEMPTS = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: 'Serializable',
        maxWait: 10000,
        timeout: 30000,
      });
    } catch (e: any) {
      lastError = e;
      const msg = String(e?.message ?? '');
      const code = e?.code;
      const retriable =
        msg.includes('CAI_CONCURRENT_UPDATE') ||
        msg.includes('could not serialize') ||
        code === 'P2034' || // write conflict / deadlock
        code === '40001'; // serialization_failure
      if (retriable && attempt < MAX_ATTEMPTS) {
        logger.warn(`withDeliveryTx retry ${attempt}/${MAX_ATTEMPTS}: ${msg}`);
        continue;
      }
      throw e;
    }
  }
  throw lastError;
}

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
  ACCEPTED: ['CONVERTED', 'FACTURADA_PARCIAL', 'CANCELLED', 'DRAFT'],
  REJECTED: [],
  EXPIRED: [],
  CANCELLED: ['DRAFT'],
  CONVERTED: ['ACCEPTED'],
  FACTURADA_PARCIAL: ['CONVERTED', 'FACTURADA_PARCIAL', 'ACCEPTED'],
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
  }, { maxWait: 10000, timeout: 30000 });

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

/**
 * Asigna el siguiente número de remito usando el `tx` provisto.
 *
 * Diseñado para correr DENTRO de una transacción Serializable más amplia
 * (la que también hace el `create` del DeliveryNote), de modo que si el
 * create falla, el incremento del contador se rollbackea y no quedan
 * huecos en la numeración.
 *
 * Tira `Error('CAI_CONCURRENT_UPDATE')` si otro proceso ya incrementó
 * el contador entre el read y el update — el caller (withDeliveryTx)
 * reintenta la transacción completa.
 */
async function generateDeliveryNumberInTx(
  tx: Prisma.TransactionClient
): Promise<{ deliveryNumber: string; caiNumber: string | null }> {
  // Intentar usar CAI activo (si la tabla existe y hay config)
  try {
    if ((tx as any).caiConfig) {
      const caiConfig = await tx.caiConfig.findFirst({
        where: { active: true },
        orderBy: { createdAt: 'desc' },
      });

      if (caiConfig) {
        const now = new Date();
        const notExpired = now <= caiConfig.caiExpirationDate;
        const nextNumber = caiConfig.lastUsedNumber + 1;
        const hasRange = nextNumber <= caiConfig.endNumber;

        if (notExpired && hasRange) {
          // Incrementar con atomic UPDATE + condición para evitar doble incremento
          const updated = await tx.$executeRaw`
            UPDATE cai_configs
            SET "lastUsedNumber" = "lastUsedNumber" + 1
            WHERE id = ${caiConfig.id} AND "lastUsedNumber" = ${caiConfig.lastUsedNumber}
          `;

          if (updated === 0) {
            // Otro proceso ya incrementó → withDeliveryTx reintenta la tx entera
            throw new Error('CAI_CONCURRENT_UPDATE');
          }

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
    // Concurrencia: bubble up para que withDeliveryTx reintente
    if (error instanceof Error && error.message === 'CAI_CONCURRENT_UPDATE') {
      throw error;
    }
    // Tabla/cliente no disponible: fallback a PV 0002
    logger.warn(
      'CAI config not available, falling back to PV 0002:',
      error instanceof Error ? error.message : error
    );
  }

  // Fallback: PV 0002 (legacy / contingencia)
  // FOR UPDATE lockea la fila para que otro proceso no lea el mismo número
  const result = await tx.$queryRaw<{ max_num: number }[]>`
    SELECT COALESCE(
      MAX(CAST(SUBSTRING("deliveryNumber" FROM '(\d+)$') AS INTEGER)),
      ${DELIVERY_NUMBER_MIN}
    ) as max_num
    FROM delivery_notes
    WHERE "deliveryNumber" LIKE 'RE 0002%'
    FOR UPDATE
  `;

  const lastNumber = result[0]?.max_num || DELIVERY_NUMBER_MIN;
  const number = lastNumber + 1;
  return {
    deliveryNumber: `RE 0002-${String(number).padStart(8, '0')}`,
    caiNumber: null,
  };
}

export async function generateDeliveryNumber(
  tx?: Prisma.TransactionClient
): Promise<{ deliveryNumber: string; caiNumber: string | null }> {
  // Si recibe tx, opera dentro de la transacción del caller
  // (el caller debe usar withDeliveryTx para tener reintentos).
  if (tx) {
    return generateDeliveryNumberInTx(tx);
  }

  // Standalone: abre su propia tx Serializable con reintentos
  return withDeliveryTx((innerTx) => generateDeliveryNumberInTx(innerTx));
}

/**
 * Carga una CotizacionFactura con sus items para armar el remito.
 */
async function loadCotizacionFactura(cotizacionFacturaId: string) {
  return prisma.cotizacionFactura.findUnique({
    where: { id: cotizacionFacturaId },
    include: { items: true },
  });
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
    deliveryType?: string;
    purchaseOrder?: string;
    customerInvoiceNumber?: string;
    bultos?: string;
    notes?: string;
    /** Si se provee, el remito se genera con SOLO los items y cantidades de
     *  esta CotizacionFactura (factura parcial), no con la cotización completa.
     *  El DeliveryNote queda vinculado a esa CotizacionFactura. */
    cotizacionFacturaId?: string;
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

  if (
    quote.status !== 'ACCEPTED' &&
    quote.status !== 'CONVERTED' &&
    quote.status !== 'FACTURADA_PARCIAL'
  ) {
    throw new Error('Solo se pueden generar remitos de cotizaciones aceptadas, parciales o convertidas');
  }

  // Si vino cotizacionFacturaId, validar que pertenezca a esta cotización
  // y cargar sus items para armar el remito de esa factura específica.
  let cotizacionFactura: Awaited<ReturnType<typeof loadCotizacionFactura>> | null = null;
  if (data?.cotizacionFacturaId) {
    cotizacionFactura = await loadCotizacionFactura(data.cotizacionFacturaId);
    if (!cotizacionFactura) {
      throw new Error('Factura parcial no encontrada');
    }
    if (cotizacionFactura.cotizacionId !== quote.id) {
      throw new Error('La factura parcial no pertenece a esta cotización');
    }
  }

  // Crear remito + asignar número en UNA sola transacción Serializable.
  // Si el create falla, el incremento de lastUsedNumber se rollbackea y no
  // queda hueco en la numeración.
  const deliveryNote = await withDeliveryTx(async (tx) => {
    const { deliveryNumber, caiNumber } = await generateDeliveryNumber(tx);

    // Calcular valor declarado: subtotal USD × tipo de cambio = ARS sin IVA
    const quoteExchangeRate = Number(quote.exchangeRate) || 1;
    const quoteSubtotal = Number(quote.subtotal);
    const calculatedTotalAmountARS = quote.currency === 'USD'
      ? quoteSubtotal * quoteExchangeRate
      : quoteSubtotal;

    // Armar items del remito: principales + adicionales de cada item.
    // Si vino cotizacionFactura, usar las CANTIDADES facturadas en esa factura
    // específica (no la cantidad original del QuoteItem).
    const deliveryItems: Array<{
      productId: string | null;
      sku: string | null;
      description: string;
      quantity: number;
      unit: string;
    }> = [];

    const cantidadPorItemId = new Map<string, number>();
    if (cotizacionFactura) {
      for (const cfItem of cotizacionFactura.items) {
        cantidadPorItemId.set(cfItem.cotizacionItemId, Number(cfItem.cantidad));
      }
    }

    for (const item of quote.items) {
      if (item.isAlternative) continue; // Solo items principales

      // Determinar cantidad para este item:
      // - Si hay CotizacionFactura: sólo incluir items que están en ella,
      //   y usar la cantidad facturada.
      // - Si no: comportamiento original (cantidad completa).
      let itemQuantity: number;
      if (cotizacionFactura) {
        const qty = cantidadPorItemId.get(item.id);
        if (qty == null || qty <= 0) continue; // este item no se facturó en esta factura
        itemQuantity = qty;
      } else {
        itemQuantity = item.quantity;
      }

      // Item principal
      deliveryItems.push({
        productId: item.productId || null,
        sku: item.product?.sku || item.manualSku || null,
        description: item.description || item.product?.name || 'Item',
        quantity: itemQuantity,
        unit: item.product?.unit || 'UN',
      });

      // Adicionales del item (misma cantidad que el principal)
      if (item.additionals && item.additionals.length > 0) {
        for (const add of item.additionals) {
          deliveryItems.push({
            productId: add.productId || null,
            sku: add.product?.sku || null,
            description: add.description || add.product?.name || 'Adicional',
            quantity: itemQuantity,
            unit: add.product?.unit || 'UN',
          });
        }
      }
    }

    if (deliveryItems.length === 0) {
      throw new Error('No hay items para incluir en el remito');
    }

    const newDeliveryNote = await tx.deliveryNote.create({
      data: {
        deliveryNumber,
        ...(caiNumber ? { caiNumber } : {}),
        quoteId: quote.id,
        cotizacionFacturaId: cotizacionFactura?.id || null,
        customerId: quote.customerId,
        date: new Date(),
        deliveryAddress: data?.deliveryAddress || quote.customer.address || null,
        deliveryCity: data?.deliveryCity || quote.customer.city || null,
        deliveryProvince: data?.deliveryProvince || quote.customer.province || null,
        deliveryPostalCode: data?.deliveryPostalCode || quote.customer.postalCode || null,
        carrier: data?.carrier || quote.customer.defaultTransportName || null,
        transportAddress: data?.transportAddress || quote.customer.defaultTransportAddress || null,
        deliveryType: data?.deliveryType || 'Retira en sucursal',
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
  // Serializable transaction + FOR UPDATE para evitar race conditions
  const invoiceNumber = await prisma.$transaction(async (tx) => {
    const prefix = `${pointOfSale}-%`;
    const result = await tx.$queryRaw<{ max_num: number }[]>`
      SELECT COALESCE(
        MAX(CAST(SPLIT_PART("invoiceNumber", '-', 2) AS INTEGER)),
        0
      ) as max_num
      FROM invoices
      WHERE "invoiceType" = ${invoiceType}
        AND "invoiceNumber" LIKE ${prefix}
      FOR UPDATE
    `;

    const nextNumber = (result[0]?.max_num || 0) + 1;
    return `${pointOfSale}-${String(nextNumber).padStart(8, '0')}`;
  }, { isolationLevel: 'Serializable', maxWait: 10000, timeout: 30000 });

  return invoiceNumber;
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

  // Crear factura en una $transaction EXPLÍCITA con timeout extendido.
  // Antes era un prisma.invoice.create directo: cuando la factura tiene muchos
  // items, la transacción IMPLÍCITA que Prisma arma para insertar la Invoice +
  // sus N InvoiceItem nested supera el default de 5s y tira P2028 con DB lenta.
  // No hay interacción con Colppy en este flujo, así que no aplica detección
  // COLPPY_ORPHAN — el cliente verá el error genérico del catch del endpoint.
  const invoice = await prisma.$transaction(
    async (tx) => {
      return tx.invoice.create({
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
    },
    { maxWait: 10000, timeout: 60000 }
  );

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

  // Calcular totales.
  // Si la cotización tiene pricesIncludeTax, los totalPrice YA incluyen IVA
  // → el total final es la suma directa, el subtotal neto sale de /1.21.
  // Si no, los totalPrice son netos y se suma 21% aparte (comportamiento legacy,
  // y el correcto para Factura A / Responsable Inscripto).
  const taxRate = 0.21;
  const sumTotals = quote.items
    .filter(item => !item.isAlternative)
    .reduce((sum, item) => sum + Number(item.totalPrice), 0);

  let subtotal: number;
  let taxAmount: number;
  let total: number;
  if (quote.pricesIncludeTax) {
    total = sumTotals;
    subtotal = total / (1 + taxRate);
    taxAmount = total - subtotal;
  } else {
    subtotal = sumTotals;
    taxAmount = subtotal * taxRate;
    total = subtotal + taxAmount;
  }

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
              // Los renglones de factura se guardan NETOS. Si la cotización
              // estaba en modo IVA-incluido, dividimos por 1.21 para obtener
              // el neto y que coincida con el subtotal/taxAmount calculados
              // más arriba.
              const rawUnit = Number(item.unitPrice);
              const rawTotal = Number(item.totalPrice);
              const netUnit = quote.pricesIncludeTax ? rawUnit / (1 + taxRate) : rawUnit;
              const netSubtotal = quote.pricesIncludeTax ? rawTotal / (1 + taxRate) : rawTotal;

              return {
                productId: item.productId,
                quoteItemId: item.id,
                description: item.description || item.product?.name,
                quantity: item.quantity,
                unitPrice: netUnit,
                discount: 0,
                taxRate: taxRate * 100,
                subtotal: netSubtotal
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
  }, { maxWait: 10000, timeout: 30000 });

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
