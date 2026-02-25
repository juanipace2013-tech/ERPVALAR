import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding company settings...')

  // Verificar si ya existe configuración
  const existing = await prisma.companySettings.findFirst()

  if (existing) {
    console.log('✅ Company settings already exist, skipping...')
    return
  }

  // Crear configuración de VAL ARG S.R.L.
  const valargSettings = await prisma.companySettings.create({
    data: {
      // Datos generales
      name: 'VAL ARG S.R.L.',
      legalName: 'VAL ARG S.R.L.',
      address: '14 de Julio 175',
      city: 'CABA',
      province: 'CABA',
      postalCode: '1427',
      country: 'Argentina',
      phone: '011-4551-3343',
      email: 'ventas@val-ar.com.ar',
      taxId: '30-71537357-9',
      iibbNumber: '901-71537357-9',
      logoUrl: '/logo-valarg.png',

      // Datos impositivos
      taxCondition: 'RESPONSABLE_INSCRIPTO',
      fiscalDebitAccount: '214101',
      fiscalCreditAccount: '114102',

      // Agente de retención
      isWithholdingAgent: true,
      withholdingGananciasAccount: '114108',
      withholdingIIBB: false,
      withholdingIVA: false,
      withholdingARBA: false,
      autoCalculateAGIP: false,

      // Retenciones sufridas
      retentionGananciasAccount: '114101',
      retentionIVAAccount: '114105',
      retentionSUSSAccount: '213201',

      // Percepciones sufridas
      perceptionIVAAccount: '114106',

      // Clientes
      customerDefaultAccount: '113100',
      customerInterestAccount: '541001',
      customerDiscountAccount: '541002',
      customerExchangeAccount: '541004',

      // Proveedores
      supplierDefaultAccount: '211100',
      supplierAdvanceAccount: '115200',
      supplierInterestAccount: '541001',
      supplierDiscountAccount: '541002',
      supplierExchangeAccount: '541004',

      // Avisos de vencimiento
      invoiceReminder1Enabled: true,
      invoiceReminder1Days: 1,
      invoiceReminder1Before: false,
      invoiceReminder2Enabled: true,
      invoiceReminder2Days: 7,
      invoiceReminder2Before: false,
      invoiceReminder3Enabled: true,
      invoiceReminder3Days: 10,
      invoiceReminder3Before: false,

      // Email automático
      autoSendReceipts: true,
      autoSendPaymentOrders: false,
    }
  })

  console.log('✅ Created company settings:', valargSettings.name)

  // Crear talonarios iniciales
  console.log('🌱 Seeding invoice numbering...')

  const talonarios = [
    {
      description: 'FACTURA POR AFIP',
      prefix: '0001',
      numberFrom: 1,
      numberTo: 1000,
      currentNumber: 563,
      isSaleInvoice: true,
      isDefault: true,
    },
    {
      description: 'Facturas Electrónicas',
      prefix: '0003',
      numberFrom: 1,
      numberTo: 99999999,
      currentNumber: 1,
      isSaleInvoice: true,
      isElectronic: true,
    },
    {
      description: 'FACTURAS X',
      prefix: '0001',
      numberFrom: 0,
      numberTo: 99999999,
      currentNumber: 3,
      isSaleInvoice: true,
    },
    {
      description: 'NC/ND POR AFIP',
      prefix: '0001',
      numberFrom: 1,
      numberTo: 9999,
      currentNumber: 11,
      isCreditNote: true,
      isDebitNote: true,
    },
    {
      description: 'Orden de Pago',
      prefix: '0001',
      numberFrom: 1,
      numberTo: 99999999,
      currentNumber: 4879,
      isPaymentOrder: true,
    },
    {
      description: 'OTRAS FACTURAS',
      prefix: '0009',
      numberFrom: 1,
      numberTo: 99999999,
      currentNumber: 3,
      isSaleInvoice: true,
    },
    {
      description: 'PRUEBAS OPPEN',
      prefix: '0004',
      numberFrom: 1,
      numberTo: 99999999,
      currentNumber: 4,
      isSaleInvoice: true,
    },
    {
      description: 'RECIBOS',
      prefix: '0001',
      numberFrom: 1,
      numberTo: 99999999,
      currentNumber: 11157,
      isReceipt: true,
    },
    {
      description: 'REMITOS',
      prefix: '0002',
      numberFrom: 1,
      numberTo: 99999999,
      currentNumber: 1,
      isRemittance: true,
    },
  ]

  for (const talonario of talonarios) {
    await prisma.invoiceNumbering.create({
      data: talonario,
    })
  }

  console.log(`✅ Created ${talonarios.length} invoice numbering configurations`)
  console.log('✅ Seed completed successfully!')
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
