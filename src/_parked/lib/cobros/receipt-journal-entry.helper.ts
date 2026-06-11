import { Prisma } from '@prisma/client'
import { WITHHOLDING_ACCOUNT_MAPPING, ACCOUNTS_RECEIVABLE_CODE } from './withholding-account-mapping'

/**
 * Crea el asiento contable cuando se aprueba un recibo.
 *
 * Estructura del asiento tipo REC:
 *
 * HABER (crédito):
 *   113100  Deudores Por Ventas        totalApplied   ← cancela la deuda del cliente
 *
 * DEBE (débito):
 *   cuenta_tesoreria_N                amount_N        ← por cada medio de cobro
 *   114301  Ret y Percepciones IIBB   amount_iibb     ← suma de todas las jurisdicciones IIBB
 *   114105  IVA Retenciones           amount_iva
 *   114101  Ret Sufridas Ganancias    amount_ganancias
 *   213201  Retenciones Sufridas SUSS amount_suss
 */
export async function createReceiptJournalEntry(
  tx: Prisma.TransactionClient,
  receipt: ReceiptWithRelations
) {
  const lines: JournalLine[] = []

  // ------------------------------------------------------------------
  // 1. HABER: Deudores Por Ventas (cancela el crédito por las facturas)
  // ------------------------------------------------------------------
  const arAccount = await getAccountByCode(ACCOUNTS_RECEIVABLE_CODE, tx)
  lines.push({
    accountId:   arAccount.id,
    debit:       0,
    credit:      Number(receipt.totalApplied),
    description: `Cancelación facturas - Recibo ${receipt.receiptNumber}`,
  })

  // ------------------------------------------------------------------
  // 2. DEBE: Cuentas de Tesorería (por cada medio de cobro)
  // ------------------------------------------------------------------
  for (const pm of receipt.paymentMethods) {
    lines.push({
      accountId:   pm.treasuryAccount.chartOfAccount.id,
      debit:       Number(pm.amount),
      credit:      0,
      description: `${pm.paymentType} - ${pm.treasuryAccount.name} - Recibo ${receipt.receiptNumber}`,
    })
  }

  // ------------------------------------------------------------------
  // 3. DEBE: Retenciones sufridas (agrupadas por cuenta contable)
  //    IIBB: todas las jurisdicciones van a la misma cuenta 114301
  //    Las demás: una línea por tipo
  // ------------------------------------------------------------------

  // Acumular importes por código de cuenta para agrupar líneas del mismo tipo
  const withholdingByAccount: Record<string, { accountId: string; amount: number; labels: string[] }> = {}

  for (const group of receipt.withholdingGroups) {
    for (const line of group.lines) {
      const accountCode = WITHHOLDING_ACCOUNT_MAPPING[line.withholdingType]
      if (!accountCode) {
        throw new Error(
          `No hay cuenta contable mapeada para el tipo de retención: ${line.withholdingType}`
        )
      }

      if (!withholdingByAccount[accountCode]) {
        const account = await getAccountByCode(accountCode, tx)
        withholdingByAccount[accountCode] = {
          accountId: account.id,
          amount:    0,
          labels:    [],
        }
      }

      withholdingByAccount[accountCode].amount += Number(line.amount)

      // Label para la descripción del asiento
      const label = line.jurisdictionLabel
        ?? line.withholdingType
             .replace('IIBB_', '')
             .replace('_', ' ')
      withholdingByAccount[accountCode].labels.push(
        `${label}${line.certificateNumber ? ` (Cert. ${line.certificateNumber})` : ''}`
      )
    }
  }

  // Crear una línea por cuenta contable de retención
  for (const [accountCode, data] of Object.entries(withholdingByAccount)) {
    lines.push({
      accountId:   data.accountId,
      debit:       data.amount,
      credit:      0,
      description: `Retención ${accountCode} - ${data.labels.join(', ')} - Recibo ${receipt.receiptNumber}`,
    })
  }

  // ------------------------------------------------------------------
  // 4. Validar partida doble antes de crear
  // ------------------------------------------------------------------
  const totalDebit  = lines.reduce((s, l) => s + l.debit, 0)
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0)
  if (Math.abs(totalDebit - totalCredit) > 0.02) {
    throw new Error(
      `Asiento desbalanceado: Debe=${totalDebit.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, Haber=${totalCredit.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    )
  }

  // ------------------------------------------------------------------
  // 5. Crear el asiento en la base de datos
  // ------------------------------------------------------------------
  const journalEntry = await tx.journalEntry.create({
    data: {
      date:        receipt.date,
      description: `REC ${receipt.receiptNumber} - ${receipt.customer.name}`,
      reference:   receipt.receiptNumber,
      userId:      receipt.userId,
      status:      'POSTED',
      lines:       { create: lines },
    },
    include: {
      lines: {
        include: {
          account: { select: { code: true, name: true } }
        }
      }
    }
  })

  return journalEntry
}

// ============================================================
// HELPERS INTERNOS
// ============================================================

async function getAccountByCode(code: string, tx: Prisma.TransactionClient) {
  const account = await tx.chartOfAccount.findFirst({
    where: { code },
    select: { id: true, name: true, acceptsEntries: true }
  })

  if (!account) {
    throw new Error(`Cuenta contable con código "${code}" no encontrada en el plan de cuentas`)
  }
  if (!account.acceptsEntries) {
    throw new Error(`La cuenta "${code} - ${account.name}" no acepta asientos directos`)
  }

  return account
}

// ============================================================
// TIPOS
// ============================================================

interface JournalLine {
  accountId:   string
  debit:       number
  credit:      number
  description: string
}

// Tipo inferido del include usado en approveReceipt del service
type ReceiptWithRelations = {
  id:              string
  receiptNumber:   string
  date:            Date
  userId:          string
  totalApplied:    Prisma.Decimal | number
  customer:        { id: string; name: string }
  invoiceApplications: Array<{ invoice: { total: Prisma.Decimal } }>
  withholdingGroups: Array<{
    lines: Array<{
      withholdingType:   string
      jurisdictionLabel: string | null
      certificateNumber: string | null
      amount:            Prisma.Decimal | number
    }>
  }>
  paymentMethods: Array<{
    paymentType: string
    amount:      Prisma.Decimal | number
    treasuryAccount: {
      name:           string
      chartOfAccount: { id: string; code: string; name: string }
    }
  }>
}
