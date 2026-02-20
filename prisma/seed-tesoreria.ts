import { PrismaClient, BankAccountType, BankTransactionType } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🏦 Seeding tesorería (cuentas bancarias)...')

  // Verificar si ya existen cuentas
  const existing = await prisma.bankAccount.findFirst()

  if (existing) {
    console.log('✅ Bank accounts already exist, skipping...')
    return
  }

  // Crear cuentas bancarias de VAL ARG S.R.L.
  const cuentas = [
    {
      name: 'Cta Cte Galicia',
      type: BankAccountType.CHECKING_ACCOUNT,
      bank: 'Banco Galicia',
      currency: 'ARS',
      balance: 100867901.60,
      reconciledBalance: 34844616.70,
      isActive: true,
      accountNumber: '4149-9 089-5',
      cbu: '0070089420000004149953',
    },
    {
      name: 'Cta. Cte Supervielle',
      type: BankAccountType.CHECKING_ACCOUNT,
      bank: 'Banco Supervielle',
      currency: 'ARS',
      balance: 0,
      reconciledBalance: 0,
      isActive: true,
      accountNumber: '0510001920000006789012',
    },
    {
      name: 'Cuenta Corriente Especial USD GALICIA',
      type: BankAccountType.FOREIGN_CURRENCY,
      bank: 'Banco Galicia',
      currency: 'USD',
      currencyBalance: 10946.09,
      balance: 15811799.40,
      isActive: true,
      accountNumber: '4149-9 089-6',
      cbu: '0070089420000004149961',
    },
    {
      name: 'TARJETA GALICIA',
      type: BankAccountType.CREDIT_CARD,
      bank: 'Banco Galicia',
      currency: 'ARS',
      balance: 14918533.28,
      reconciledBalance: 0,
      isActive: true,
      accountNumber: '5155 **** **** 1234',
    },
    {
      name: 'Caja',
      type: BankAccountType.CASH,
      currency: 'ARS',
      balance: 0,
      isActive: true,
    },
  ]

  for (const cuenta of cuentas) {
    await prisma.bankAccount.create({
      data: cuenta,
    })
  }

  console.log(`✅ Created ${cuentas.length} bank accounts`)

  // Crear algunos movimientos de ejemplo para la cuenta principal
  console.log('💸 Creating sample transactions...')

  const ctaGalicia = await prisma.bankAccount.findFirst({
    where: { name: 'Cta Cte Galicia' }
  })

  if (ctaGalicia) {
    const transactions = [
      {
        bankAccountId: ctaGalicia.id,
        date: new Date('2024-02-03'),
        type: BankTransactionType.INCOME,
        voucherType: 'REC',
        voucherNumber: '00011157',
        entityType: 'CUSTOMER',
        entityName: 'TEKNIK S.R.L.',
        description: 'Recibo de cobro - Factura 0001-00000563',
        debit: 152500.00,
        credit: 0,
        balance: 100867901.60,
      },
      {
        bankAccountId: ctaGalicia.id,
        date: new Date('2024-02-03'),
        type: BankTransactionType.EXPENSE,
        voucherType: 'PAG',
        voucherNumber: '00004879',
        entityType: 'SUPPLIER',
        entityName: 'ANTONIO FASANO S.A.',
        description: 'Pago a proveedor - Orden de Pago 0001-00004879',
        debit: 0,
        credit: 689000.00,
        balance: 100178901.60,
      },
      {
        bankAccountId: ctaGalicia.id,
        date: new Date('2024-02-02'),
        type: BankTransactionType.INCOME,
        voucherType: 'DEP',
        voucherNumber: 'DEP-001',
        description: 'Depósito bancario',
        debit: 250000.00,
        credit: 0,
        balance: 100867901.60,
      },
      {
        bankAccountId: ctaGalicia.id,
        date: new Date('2024-02-01'),
        type: BankTransactionType.EXPENSE,
        voucherType: 'CHQ',
        checkNumber: '12345678',
        entityType: 'SUPPLIER',
        entityName: 'GENEBRE ARGENTINA S.A.',
        description: 'Pago con cheque diferido',
        debit: 0,
        credit: 1250000.00,
        balance: 100617901.60,
      },
      {
        bankAccountId: ctaGalicia.id,
        date: new Date('2024-01-31'),
        type: BankTransactionType.BANK_FEE,
        description: 'Comisión bancaria mantenimiento cuenta',
        debit: 0,
        credit: 3500.00,
        balance: 101867901.60,
      },
    ]

    for (const transaction of transactions) {
      await prisma.bankTransaction.create({
        data: transaction,
      })
    }

    console.log(`✅ Created ${transactions.length} sample transactions`)
  }

  console.log('✅ Tesorería seed completed successfully!')
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
