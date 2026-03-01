import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/lib/prisma'

const companySettingsSchema = z.object({
  // Datos generales
  name: z.string().min(1).optional(),
  legalName: z.string().min(1).optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  province: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  cbu: z.string().nullable().optional(),
  taxId: z.string().optional(),
  iibbNumber: z.string().nullable().optional(),

  // Logo
  logoUrl: z.string().nullable().optional(),
  logoWidth: z.number().int().positive().nullable().optional(),
  logoHeight: z.number().int().positive().nullable().optional(),

  // Datos impositivos
  taxCondition: z.enum(['RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO', 'CONSUMIDOR_FINAL', 'NO_RESPONSABLE', 'RESPONSABLE_NO_INSCRIPTO']).optional(),
  fiscalDebitAccount: z.string().nullable().optional(),
  fiscalCreditAccount: z.string().nullable().optional(),

  // Agentes de retención
  isWithholdingAgent: z.boolean().optional(),
  withholdingGananciasAccount: z.string().nullable().optional(),
  withholdingIIBB: z.boolean().optional(),
  withholdingIIBBAccount: z.string().nullable().optional(),
  withholdingIVA: z.boolean().optional(),
  withholdingIVAAccount: z.string().nullable().optional(),
  withholdingARBA: z.boolean().optional(),
  autoCalculateAGIP: z.boolean().optional(),

  // Retenciones sufridas
  retentionGananciasAccount: z.string().nullable().optional(),
  retentionIVAAccount: z.string().nullable().optional(),
  retentionSUSSAccount: z.string().nullable().optional(),

  // Percepciones sufridas
  perceptionIVAAccount: z.string().nullable().optional(),

  // Clientes/Proveedores
  customerDefaultAccount: z.string().nullable().optional(),
  customerAdvanceAccount: z.string().nullable().optional(),
  customerInterestAccount: z.string().nullable().optional(),
  customerDiscountAccount: z.string().nullable().optional(),
  customerExchangeAccount: z.string().nullable().optional(),
  supplierDefaultAccount: z.string().nullable().optional(),
  supplierAdvanceAccount: z.string().nullable().optional(),
  supplierInterestAccount: z.string().nullable().optional(),
  supplierDiscountAccount: z.string().nullable().optional(),
  supplierExchangeAccount: z.string().nullable().optional(),

  // Avisos de vencimiento
  invoiceReminder1Enabled: z.boolean().optional(),
  invoiceReminder1Days: z.number().int().nonnegative().optional(),
  invoiceReminder1Before: z.boolean().optional(),
  invoiceReminder2Enabled: z.boolean().optional(),
  invoiceReminder2Days: z.number().int().nonnegative().optional(),
  invoiceReminder2Before: z.boolean().optional(),
  invoiceReminder3Enabled: z.boolean().optional(),
  invoiceReminder3Days: z.number().int().nonnegative().optional(),
  invoiceReminder3Before: z.boolean().optional(),

  autoSendReceipts: z.boolean().optional(),
  autoSendPaymentOrders: z.boolean().optional(),

  // Tesoreria
  valuesToDepositAccount: z.string().nullable().optional(),
  deferredChecksAccount: z.string().nullable().optional(),
}).strict()

export async function GET(_request: NextRequest) {
  try {
    const session = await auth()

    if (!session) {
      return NextResponse.json(
        { error: 'No autorizado' },
        { status: 401 }
      )
    }

    const settings = await prisma.companySettings.findFirst()

    if (!settings) {
      return NextResponse.json(
        { error: 'No se encontró configuración de empresa' },
        { status: 404 }
      )
    }

    return NextResponse.json(settings)
  } catch (error) {
    console.error('Error fetching company settings:', error)
    return NextResponse.json(
      { error: 'Error al obtener configuración' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await auth()

    if (!session) {
      return NextResponse.json(
        { error: 'No autorizado' },
        { status: 401 }
      )
    }

    const body = await request.json()

    // Validar y filtrar campos permitidos
    const validatedData = companySettingsSchema.parse(body)

    const settings = await prisma.companySettings.findFirst()

    if (!settings) {
      return NextResponse.json(
        { error: 'No se encontró configuración de empresa' },
        { status: 404 }
      )
    }

    const updated = await prisma.companySettings.update({
      where: { id: settings.id },
      data: validatedData,
    })

    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: error.issues },
        { status: 400 }
      )
    }

    console.error('Error updating company settings:', error)
    return NextResponse.json(
      { error: 'Error al actualizar configuración' },
      { status: 500 }
    )
  }
}
