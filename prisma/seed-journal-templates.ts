/**
 * Seed para Plantillas de Asientos Contables
 * 12 plantillas básicas para Val Arg
 */

import { PrismaClient, TriggerType, EntryLineSide, AmountType } from '@prisma/client';

const prisma = new PrismaClient();

interface TemplateLine {
  lineNumber: number;
  accountCode: string;
  side: EntryLineSide;
  amountType: AmountType;
  fixedAmount?: number;
  percentage?: number;
  description?: string;
}

interface TemplateDefinition {
  name: string;
  code: string;
  triggerType: TriggerType;
  description: string;
  lines: TemplateLine[];
}

const TEMPLATES: TemplateDefinition[] = [
  // 1. FACTURA DE VENTA TIPO A (Responsable Inscripto)
  {
    name: 'Factura de Venta Tipo A',
    code: 'SALE_INVOICE_A',
    triggerType: TriggerType.SALE_INVOICE,
    description: 'Factura de venta a Responsable Inscripto (discrimina IVA)',
    lines: [
      {
        lineNumber: 1,
        accountCode: '1.1.03',        // Deudores por Ventas
        side: EntryLineSide.DEBIT,
        amountType: AmountType.TOTAL,
        description: 'Deudores por Ventas',
      },
      {
        lineNumber: 2,
        accountCode: '4.1.01',        // Ventas de Mercaderías
        side: EntryLineSide.CREDIT,
        amountType: AmountType.SUBTOTAL,
        description: 'Ventas de Mercaderías',
      },
      {
        lineNumber: 3,
        accountCode: '2.1.04.001',    // IVA Débito Fiscal
        side: EntryLineSide.CREDIT,
        amountType: AmountType.TAX,
        description: 'IVA Débito Fiscal',
      },
    ],
  },

  // 2. FACTURA DE VENTA TIPO B (Consumidor Final)
  {
    name: 'Factura de Venta Tipo B',
    code: 'SALE_INVOICE_B',
    triggerType: TriggerType.SALE_INVOICE,
    description: 'Factura de venta a Consumidor Final (no discrimina IVA)',
    lines: [
      {
        lineNumber: 1,
        accountCode: '1.1.03',        // Deudores por Ventas
        side: EntryLineSide.DEBIT,
        amountType: AmountType.TOTAL,
        description: 'Deudores por Ventas',
      },
      {
        lineNumber: 2,
        accountCode: '4.1.01',        // Ventas de Mercaderías
        side: EntryLineSide.CREDIT,
        amountType: AmountType.TOTAL,
        description: 'Ventas de Mercaderías',
      },
    ],
  },

  // 3. FACTURA DE COMPRA TIPO A
  {
    name: 'Factura de Compra Tipo A',
    code: 'PURCHASE_INVOICE_A',
    triggerType: TriggerType.PURCHASE_INVOICE,
    description: 'Factura de compra de Responsable Inscripto',
    lines: [
      {
        lineNumber: 1,
        accountCode: '1.1.05.001',    // Mercaderías
        side: EntryLineSide.DEBIT,
        amountType: AmountType.SUBTOTAL,
        description: 'Compra de Mercaderías',
      },
      {
        lineNumber: 2,
        accountCode: '1.1.04.002',    // IVA Crédito Fiscal
        side: EntryLineSide.DEBIT,
        amountType: AmountType.TAX,
        description: 'IVA Crédito Fiscal',
      },
      {
        lineNumber: 3,
        accountCode: '2.1.01',        // Proveedores
        side: EntryLineSide.CREDIT,
        amountType: AmountType.TOTAL,
        description: 'Proveedores',
      },
    ],
  },

  // 4. COBRO A CLIENTE (efectivo)
  {
    name: 'Cobro a Cliente - Efectivo',
    code: 'CUSTOMER_PAYMENT_CASH',
    triggerType: TriggerType.CUSTOMER_PAYMENT,
    description: 'Cobro a cliente en efectivo',
    lines: [
      {
        lineNumber: 1,
        accountCode: '1.1.01.001',    // Caja
        side: EntryLineSide.DEBIT,
        amountType: AmountType.TOTAL,
        description: 'Cobro en efectivo',
      },
      {
        lineNumber: 2,
        accountCode: '1.1.03',        // Deudores por Ventas
        side: EntryLineSide.CREDIT,
        amountType: AmountType.TOTAL,
        description: 'Cancelación cuenta cliente',
      },
    ],
  },

  // 5. COBRO A CLIENTE (transferencia)
  {
    name: 'Cobro a Cliente - Transferencia',
    code: 'CUSTOMER_PAYMENT_TRANSFER',
    triggerType: TriggerType.CUSTOMER_PAYMENT,
    description: 'Cobro a cliente por transferencia bancaria',
    lines: [
      {
        lineNumber: 1,
        accountCode: '1.1.01.002',    // Banco
        side: EntryLineSide.DEBIT,
        amountType: AmountType.TOTAL,
        description: 'Cobro por transferencia',
      },
      {
        lineNumber: 2,
        accountCode: '1.1.03',        // Deudores por Ventas
        side: EntryLineSide.CREDIT,
        amountType: AmountType.TOTAL,
        description: 'Cancelación cuenta cliente',
      },
    ],
  },

  // 6. PAGO A PROVEEDOR (efectivo)
  {
    name: 'Pago a Proveedor - Efectivo',
    code: 'SUPPLIER_PAYMENT_CASH',
    triggerType: TriggerType.SUPPLIER_PAYMENT,
    description: 'Pago a proveedor en efectivo',
    lines: [
      {
        lineNumber: 1,
        accountCode: '2.1.01',        // Proveedores
        side: EntryLineSide.DEBIT,
        amountType: AmountType.TOTAL,
        description: 'Cancelación cuenta proveedor',
      },
      {
        lineNumber: 2,
        accountCode: '1.1.01.001',    // Caja
        side: EntryLineSide.CREDIT,
        amountType: AmountType.TOTAL,
        description: 'Pago en efectivo',
      },
    ],
  },

  // 7. PAGO A PROVEEDOR (transferencia)
  {
    name: 'Pago a Proveedor - Transferencia',
    code: 'SUPPLIER_PAYMENT_TRANSFER',
    triggerType: TriggerType.SUPPLIER_PAYMENT,
    description: 'Pago a proveedor por transferencia bancaria',
    lines: [
      {
        lineNumber: 1,
        accountCode: '2.1.01',        // Proveedores
        side: EntryLineSide.DEBIT,
        amountType: AmountType.TOTAL,
        description: 'Cancelación cuenta proveedor',
      },
      {
        lineNumber: 2,
        accountCode: '1.1.01.002',    // Banco
        side: EntryLineSide.CREDIT,
        amountType: AmountType.TOTAL,
        description: 'Pago por transferencia',
      },
    ],
  },

  // 8. PAGO DE SUELDO
  {
    name: 'Pago de Sueldo',
    code: 'SALARY_PAYMENT',
    triggerType: TriggerType.SALARY_PAYMENT,
    description: 'Pago de sueldo con retenciones',
    lines: [
      {
        lineNumber: 1,
        accountCode: '5.2.01.001',    // Sueldos y Jornales
        side: EntryLineSide.DEBIT,
        amountType: AmountType.TOTAL,
        description: 'Sueldos y jornales',
      },
      {
        lineNumber: 2,
        accountCode: '2.1.03.001',    // Retenciones a Depositar
        side: EntryLineSide.CREDIT,
        amountType: AmountType.RETENTION,
        description: 'Retenciones',
      },
      {
        lineNumber: 3,
        accountCode: '1.1.01.002',    // Banco
        side: EntryLineSide.CREDIT,
        amountType: AmountType.NET_PAYMENT,
        description: 'Pago neto al empleado',
      },
    ],
  },

  // 9. PRÉSTAMO RECIBIDO
  {
    name: 'Préstamo Recibido',
    code: 'LOAN_DISBURSEMENT',
    triggerType: TriggerType.LOAN_DISBURSEMENT,
    description: 'Recepción de préstamo bancario',
    lines: [
      {
        lineNumber: 1,
        accountCode: '1.1.01.002',    // Banco
        side: EntryLineSide.DEBIT,
        amountType: AmountType.TOTAL,
        description: 'Ingreso de préstamo',
      },
      {
        lineNumber: 2,
        accountCode: '2.2.01.001',    // Préstamos Bancarios
        side: EntryLineSide.CREDIT,
        amountType: AmountType.TOTAL,
        description: 'Préstamo bancario',
      },
    ],
  },

  // 10. PAGO CUOTA PRÉSTAMO
  {
    name: 'Pago Cuota de Préstamo',
    code: 'LOAN_PAYMENT',
    triggerType: TriggerType.LOAN_PAYMENT,
    description: 'Pago de cuota de préstamo (capital + intereses)',
    lines: [
      {
        lineNumber: 1,
        accountCode: '2.2.01.001',    // Préstamos Bancarios
        side: EntryLineSide.DEBIT,
        amountType: AmountType.PRINCIPAL,
        description: 'Amortización capital',
      },
      {
        lineNumber: 2,
        accountCode: '5.4.01.001',    // Intereses Perdidos
        side: EntryLineSide.DEBIT,
        amountType: AmountType.INTEREST,
        description: 'Intereses',
      },
      {
        lineNumber: 3,
        accountCode: '1.1.01.002',    // Banco
        side: EntryLineSide.CREDIT,
        amountType: AmountType.TOTAL,
        description: 'Pago de cuota',
      },
    ],
  },

  // 11. GASTO DE COMBUSTIBLE
  {
    name: 'Gasto de Combustible',
    code: 'EXPENSE_FUEL',
    triggerType: TriggerType.EXPENSE,
    description: 'Registro de gasto de combustible',
    lines: [
      {
        lineNumber: 1,
        accountCode: '5.2.02.005',    // Combustibles
        side: EntryLineSide.DEBIT,
        amountType: AmountType.TOTAL,
        description: 'Combustible',
      },
      {
        lineNumber: 2,
        accountCode: '1.1.01.001',    // Caja
        side: EntryLineSide.CREDIT,
        amountType: AmountType.TOTAL,
        description: 'Pago de combustible',
      },
    ],
  },

  // 12. COMISIÓN MERCADO PAGO
  {
    name: 'Comisión Mercado Pago',
    code: 'EXPENSE_MP_COMMISSION',
    triggerType: TriggerType.EXPENSE,
    description: 'Comisión cobrada por Mercado Pago',
    lines: [
      {
        lineNumber: 1,
        accountCode: '5.2.03.002',    // Comisiones Bancarias
        side: EntryLineSide.DEBIT,
        amountType: AmountType.TOTAL,
        description: 'Comisión Mercado Pago',
      },
      {
        lineNumber: 2,
        accountCode: '1.1.01.022',    // Mercado Pago
        side: EntryLineSide.CREDIT,
        amountType: AmountType.TOTAL,
        description: 'Descuento de comisión',
      },
    ],
  },
];

async function seedJournalTemplates() {
  console.log('🌱 Seeding journal entry templates...');

  try {
    for (const templateDef of TEMPLATES) {
      console.log(`\n📝 Creating template: ${templateDef.name} (${templateDef.code})`);

      // Buscar las cuentas
      const accountIds: { [code: string]: string } = {};
      for (const line of templateDef.lines) {
        const account = await prisma.chartOfAccount.findUnique({
          where: { code: line.accountCode },
          select: { id: true, name: true, acceptsEntries: true, isDetailAccount: true },
        });

        if (!account) {
          console.log(`   ⚠️  Warning: Cuenta ${line.accountCode} no encontrada - omitiendo línea`);
          continue;
        }

        if (!account.acceptsEntries && !account.isDetailAccount) {
          console.log(
            `   ⚠️  Warning: Cuenta ${line.accountCode} (${account.name}) no acepta asientos - ajustar después`
          );
        }

        accountIds[line.accountCode] = account.id;
        console.log(`   ✓ Found account: ${line.accountCode} - ${account.name}`);
      }

      // Filtrar líneas con cuentas válidas
      const validLines = templateDef.lines.filter(
        (line) => accountIds[line.accountCode] !== undefined
      );

      if (validLines.length === 0) {
        console.log(`   ⚠️  Skipping template - no valid accounts found`);
        continue;
      }

      // Crear o actualizar plantilla
      const template = await prisma.journalEntryTemplate.upsert({
        where: { code: templateDef.code },
        update: {
          name: templateDef.name,
          description: templateDef.description,
          triggerType: templateDef.triggerType,
          isActive: true,
        },
        create: {
          code: templateDef.code,
          name: templateDef.name,
          description: templateDef.description,
          triggerType: templateDef.triggerType,
          isActive: true,
        },
      });

      // Eliminar líneas existentes
      await prisma.journalEntryTemplateLine.deleteMany({
        where: { templateId: template.id },
      });

      // Crear nuevas líneas
      for (const line of validLines) {
        await prisma.journalEntryTemplateLine.create({
          data: {
            templateId: template.id,
            lineNumber: line.lineNumber,
            accountId: accountIds[line.accountCode],
            side: line.side,
            amountType: line.amountType,
            fixedAmount: line.fixedAmount,
            percentage: line.percentage,
            description: line.description,
          },
        });
        console.log(
          `   ✓ Created line ${line.lineNumber}: ${line.accountCode} - ${line.side} - ${line.amountType}`
        );
      }

      console.log(`   ✅ Template created successfully`);
    }

    console.log('\n✅ Journal entry templates seeded successfully');
  } catch (error) {
    console.error('❌ Error seeding journal templates:', error);
    throw error;
  }
}

// Ejecutar si se llama directamente
if (require.main === module) {
  seedJournalTemplates()
    .then(() => {
      console.log('\n🎉 Seed completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Seed failed:', error);
      process.exit(1);
    });
}

export { seedJournalTemplates };
