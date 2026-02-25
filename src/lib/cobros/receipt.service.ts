import { prisma } from '@/lib/prisma'
import { Prisma, ReceiptStatus } from '@prisma/client'
import { createReceiptJournalEntry } from './receipt-journal-entry.helper'

// ============================================================
// TIPOS DE INPUT
// ============================================================

export interface ReceiptWithholdingLineInput {
  withholdingType:   string   // 'IIBB_CABA', 'IVA', 'SUSS', 'GANANCIAS', etc.
  jurisdictionLabel?: string  // Solo para IIBB_OTRAS o display override
  certificateNumber?: string
  amount:            number
}

export interface ReceiptWithholdingGroupInput {
  groupType: string            // 'IIBB' | 'IVA' | 'SUSS' | 'GANANCIAS'
  lines:     ReceiptWithholdingLineInput[]
}

export interface ReceiptPaymentMethodInput {
  treasuryAccountId: string
  paymentType:       string   // 'TRANSFERENCIA' | 'CHEQUE' | 'EFECTIVO' | 'DEPOSITO' | 'OTROS'
  amount:            number
  checkNumber?:      string
  checkDate?:        string
  checkBank?:        string
  reference?:        string
  notes?:            string
}

export interface ReceiptInvoiceApplicationInput {
  invoiceId:     string
  appliedAmount: number
}

export interface CreateReceiptInput {
  customerId:          string
  userId:              string
  date:                Date
  description?:        string
  pointOfSale?:        string
  invoiceApplications: ReceiptInvoiceApplicationInput[]
  withholdingGroups:   ReceiptWithholdingGroupInput[]
  paymentMethods:      ReceiptPaymentMethodInput[]
}

// ============================================================
// CREAR RECIBO (en estado BORRADOR)
// ============================================================

export async function createReceipt(input: CreateReceiptInput) {
  return await prisma.$transaction(async (tx) => {

    // 1. Generar número de recibo correlativo
    const pointOfSale = input.pointOfSale ?? '0001'
    const receiptNumber = await generateReceiptNumber(pointOfSale, tx)

    // 2. Validar facturas
    await validateInvoiceApplications(input.customerId, input.invoiceApplications, tx)

    // 3. Validar cuentas de tesorería
    await validateTreasuryAccounts(input.paymentMethods, tx)

    // 4. Calcular totales
    const totalApplied = input.invoiceApplications.reduce((s, i) => s + i.appliedAmount, 0)
    const totalWithholdings = input.withholdingGroups.reduce(
      (s, g) => s + g.lines.reduce((ls, l) => ls + l.amount, 0), 0
    )
    const totalCobrado = input.paymentMethods.reduce((s, p) => s + p.amount, 0)
    const totalToCobrar = totalApplied - totalWithholdings

    // 5. Obtener snapshots de totales de facturas
    const invoiceTotals = await Promise.all(
      input.invoiceApplications.map(async (app) => {
        const inv = await tx.invoice.findUnique({
          where: { id: app.invoiceId },
          select: { total: true }
        })
        return { invoiceId: app.invoiceId, total: Number(inv!.total) }
      })
    )

    // 6. Crear el recibo con todas las relaciones anidadas
    const receipt = await tx.receipt.create({
      data: {
        receiptNumber,
        pointOfSale,
        customerId:       input.customerId,
        userId:           input.userId,
        date:             input.date,
        description:      input.description,
        status:           ReceiptStatus.BORRADOR,
        totalApplied,
        totalWithholdings,
        totalToCobrar,
        totalCobrado,
        invoiceApplications: {
          create: input.invoiceApplications.map((app) => {
            const snap = invoiceTotals.find(t => t.invoiceId === app.invoiceId)
            return {
              invoiceId:     app.invoiceId,
              invoiceTotal:  snap?.total ?? 0,
              appliedAmount: app.appliedAmount,
            }
          })
        },
        withholdingGroups: {
          create: input.withholdingGroups.map((grp) => ({
            groupType:   grp.groupType,
            totalAmount: grp.lines.reduce((s, l) => s + l.amount, 0),
            lines: {
              create: grp.lines.map((line) => ({
                withholdingType:   line.withholdingType,
                jurisdictionLabel: line.jurisdictionLabel,
                certificateNumber: line.certificateNumber,
                amount:            line.amount,
              }))
            }
          }))
        },
        paymentMethods: {
          create: input.paymentMethods.map((pm) => ({
            treasuryAccountId: pm.treasuryAccountId,
            paymentType:       pm.paymentType as any,
            amount:            pm.amount,
            checkNumber:       pm.checkNumber,
            checkDate:         pm.checkDate ? new Date(pm.checkDate) : undefined,
            checkBank:         pm.checkBank,
            reference:         pm.reference,
            notes:             pm.notes,
          }))
        }
      },
      include: receiptFullInclude()
    })

    return receipt

  }, { maxWait: 10000, timeout: 30000 })
}

// ============================================================
// ACTUALIZAR RECIBO (solo BORRADOR)
// ============================================================

export async function updateReceipt(receiptId: string, input: CreateReceiptInput) {
  return await prisma.$transaction(async (tx) => {

    const existing = await tx.receipt.findUniqueOrThrow({
      where: { id: receiptId },
      select: { status: true, pointOfSale: true, receiptNumber: true }
    })

    if (existing.status !== ReceiptStatus.BORRADOR) {
      throw new Error('Solo se pueden editar recibos en estado BORRADOR')
    }

    await validateInvoiceApplications(input.customerId, input.invoiceApplications, tx)
    await validateTreasuryAccounts(input.paymentMethods, tx)

    const totalApplied = input.invoiceApplications.reduce((s, i) => s + i.appliedAmount, 0)
    const totalWithholdings = input.withholdingGroups.reduce(
      (s, g) => s + g.lines.reduce((ls, l) => ls + l.amount, 0), 0
    )
    const totalCobrado = input.paymentMethods.reduce((s, p) => s + p.amount, 0)
    const totalToCobrar = totalApplied - totalWithholdings

    // Borrar relaciones existentes y recrear
    await tx.receiptInvoiceApplication.deleteMany({ where: { receiptId } })
    await tx.receiptWithholdingGroup.deleteMany({ where: { receiptId } })
    await tx.receiptPaymentMethod.deleteMany({ where: { receiptId } })

    const invoiceTotals = await Promise.all(
      input.invoiceApplications.map(async (app) => {
        const inv = await tx.invoice.findUnique({
          where: { id: app.invoiceId },
          select: { total: true }
        })
        return { invoiceId: app.invoiceId, total: Number(inv!.total) }
      })
    )

    const receipt = await tx.receipt.update({
      where: { id: receiptId },
      data: {
        date:             input.date,
        description:      input.description,
        totalApplied,
        totalWithholdings,
        totalToCobrar,
        totalCobrado,
        invoiceApplications: {
          create: input.invoiceApplications.map((app) => {
            const snap = invoiceTotals.find(t => t.invoiceId === app.invoiceId)
            return {
              invoiceId:     app.invoiceId,
              invoiceTotal:  snap?.total ?? 0,
              appliedAmount: app.appliedAmount,
            }
          })
        },
        withholdingGroups: {
          create: input.withholdingGroups.map((grp) => ({
            groupType:   grp.groupType,
            totalAmount: grp.lines.reduce((s, l) => s + l.amount, 0),
            lines: {
              create: grp.lines.map((line) => ({
                withholdingType:   line.withholdingType,
                jurisdictionLabel: line.jurisdictionLabel,
                certificateNumber: line.certificateNumber,
                amount:            line.amount,
              }))
            }
          }))
        },
        paymentMethods: {
          create: input.paymentMethods.map((pm) => ({
            treasuryAccountId: pm.treasuryAccountId,
            paymentType:       pm.paymentType as any,
            amount:            pm.amount,
            checkNumber:       pm.checkNumber,
            checkDate:         pm.checkDate ? new Date(pm.checkDate) : undefined,
            checkBank:         pm.checkBank,
            reference:         pm.reference,
            notes:             pm.notes,
          }))
        }
      },
      include: receiptFullInclude()
    })

    return receipt

  }, { maxWait: 10000, timeout: 30000 })
}

// ============================================================
// APROBAR RECIBO (genera asiento contable)
// ============================================================

export async function approveReceipt(receiptId: string, userId: string) {
  return await prisma.$transaction(async (tx) => {

    // 1. Cargar recibo con todas las relaciones
    const receipt = await tx.receipt.findUniqueOrThrow({
      where: { id: receiptId },
      include: {
        invoiceApplications: { include: { invoice: true } },
        withholdingGroups:   { include: { lines: true } },
        paymentMethods:      {
          include: {
            treasuryAccount: {
              include: { chartOfAccount: { select: { id: true, code: true, name: true } } }
            }
          }
        },
        customer: { select: { id: true, name: true } },
      }
    })

    // 2. Validar estado
    if (receipt.status !== ReceiptStatus.BORRADOR) {
      throw new Error('Solo se pueden aprobar recibos en estado BORRADOR')
    }

    // 3. Validar ecuación de cuadre
    const totalApplied     = Number(receipt.totalApplied)
    const totalCobrado     = Number(receipt.totalCobrado)
    const totalWithholdings = Number(receipt.totalWithholdings)
    const diff = Math.abs(totalApplied - (totalCobrado + totalWithholdings))
    if (diff > 0.02) {
      throw new Error(
        `El recibo no cuadra: Facturas aplicadas ($${totalApplied.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}) ` +
        `debe igualar Cobrado ($${totalCobrado.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}) + Retenciones ($${totalWithholdings.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}). ` +
        `Diferencia: $${diff.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      )
    }

    // 4. Crear asiento contable tipo REC
    const journalEntry = await createReceiptJournalEntry(tx, receipt)

    // 5. Actualizar estado del recibo y vincular asiento
    await tx.receipt.update({
      where: { id: receiptId },
      data: {
        status: ReceiptStatus.APROBADO,
        journalEntry: { connect: { id: journalEntry.id } }
      }
    })

    // 6. Actualizar paidAmount en cada factura aplicada
    for (const app of receipt.invoiceApplications) {
      const newPaidAmount = Number(app.invoice.paidAmount) + Number(app.appliedAmount)
      const newStatus = newPaidAmount >= Number(app.invoice.total) - 0.01 ? 'PAID' : app.invoice.status

      await tx.invoice.update({
        where: { id: app.invoiceId },
        data: {
          paidAmount: newPaidAmount,
          status:     newStatus as any,
          paidDate:   newStatus === 'PAID' ? new Date() : undefined,
        }
      })
    }

    // 7. Decrementar balance del cliente
    await tx.customer.update({
      where: { id: receipt.customerId },
      data: { balance: { decrement: totalApplied } }
    })

    return { receiptId, journalEntryId: journalEntry.id, entryNumber: journalEntry.entryNumber }

  }, { maxWait: 10000, timeout: 30000 })
}

// ============================================================
// HELPERS INTERNOS
// ============================================================

async function generateReceiptNumber(
  pointOfSale: string,
  tx: Prisma.TransactionClient
): Promise<string> {
  const lastReceipt = await tx.receipt.findFirst({
    where: { pointOfSale },
    orderBy: { receiptNumber: 'desc' },
    select: { receiptNumber: true }
  })

  let nextSequence = 1
  if (lastReceipt) {
    const parts = lastReceipt.receiptNumber.split('-')
    nextSequence = parseInt(parts[1] ?? '0') + 1
  }

  const pos = pointOfSale.padStart(4, '0')
  const seq = String(nextSequence).padStart(8, '0')
  return `${pos}-${seq}`
}

async function validateInvoiceApplications(
  customerId: string,
  applications: ReceiptInvoiceApplicationInput[],
  tx: Prisma.TransactionClient
) {
  if (!applications.length) {
    throw new Error('El recibo debe tener al menos una factura aplicada')
  }

  for (const app of applications) {
    const invoice = await tx.invoice.findUnique({
      where: { id: app.invoiceId },
      select: { customerId: true, total: true, paidAmount: true, status: true, invoiceNumber: true }
    })

    if (!invoice) {
      throw new Error(`Factura ${app.invoiceId} no encontrada`)
    }
    if (invoice.customerId !== customerId) {
      throw new Error(`La factura ${invoice.invoiceNumber} no pertenece al cliente seleccionado`)
    }
    if (['PAID', 'CANCELLED'].includes(invoice.status)) {
      throw new Error(`La factura ${invoice.invoiceNumber} ya está pagada o cancelada`)
    }

    const remaining = Number(invoice.total) - Number(invoice.paidAmount)
    if (app.appliedAmount > remaining + 0.02) {
      throw new Error(
        `El monto a aplicar ($${app.appliedAmount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}) supera el saldo ` +
        `de la factura ${invoice.invoiceNumber} ($${remaining.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`
      )
    }
  }
}

async function validateTreasuryAccounts(
  paymentMethods: ReceiptPaymentMethodInput[],
  tx: Prisma.TransactionClient
) {
  if (!paymentMethods.length) {
    throw new Error('El recibo debe tener al menos un medio de cobro')
  }

  for (const pm of paymentMethods) {
    const account = await tx.treasuryAccount.findUnique({
      where: { id: pm.treasuryAccountId },
      select: { isActive: true, name: true }
    })
    if (!account) {
      throw new Error(`Cuenta de tesorería no encontrada`)
    }
    if (!account.isActive) {
      throw new Error(`La cuenta de tesorería "${account.name}" está inactiva`)
    }
  }
}

/** Include estándar para retornar un recibo completo */
function receiptFullInclude() {
  return {
    customer:            { select: { id: true, name: true, cuit: true } },
    user:                { select: { id: true, name: true } },
    invoiceApplications: {
      include: {
        invoice: {
          select: {
            id: true, invoiceNumber: true, invoiceType: true,
            total: true, paidAmount: true, dueDate: true, issueDate: true, currency: true
          }
        }
      }
    },
    withholdingGroups:   { include: { lines: true } },
    paymentMethods:      {
      include: {
        treasuryAccount: {
          include: { chartOfAccount: { select: { id: true, code: true, name: true } } }
        }
      }
    },
    journalEntry: { select: { id: true, entryNumber: true, status: true } }
  } as const
}
