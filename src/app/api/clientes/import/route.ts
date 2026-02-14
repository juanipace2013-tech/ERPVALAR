import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

// Schema de validación para importación
const importCustomerSchema = z.object({
  name: z.string().min(1, 'Nombre requerido'),
  businessName: z.string().optional(),
  type: z.enum(['BUSINESS', 'INDIVIDUAL']).default('BUSINESS'),
  cuit: z.string().min(11, 'CUIT debe tener al menos 11 caracteres'),
  taxCondition: z.enum(['RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO', 'CONSUMIDOR_FINAL', 'NO_RESPONSABLE', 'RESPONSABLE_NO_INSCRIPTO']),
  email: z.string().email('Email inválido').optional().nullable(),
  phone: z.string().optional().nullable(),
  mobile: z.string().optional().nullable(),
  website: z.string().url('URL inválida').optional().nullable().or(z.literal('')),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  province: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  country: z.string().default('Argentina'),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  creditLimit: z.number().optional().nullable(),
  creditCurrency: z.enum(['ARS', 'USD', 'EUR']).default('ARS'),
  paymentTerms: z.number().default(30),
  discount: z.number().min(0).max(100).default(0),
  priceMultiplier: z.number().positive().default(1.0),
  notes: z.string().optional().nullable(),
})

// POST /api/clientes/import - Importar clientes desde CSV
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const body = await request.json()
    const { customers, validateOnly = false } = body

    if (!Array.isArray(customers) || customers.length === 0) {
      return NextResponse.json(
        { error: 'Debe proporcionar un array de clientes' },
        { status: 400 }
      )
    }

    // Validar todos los clientes
    const validationResults = []
    const validCustomers = []

    for (let i = 0; i < customers.length; i++) {
      const customer = customers[i]
      const rowNumber = i + 2 // +2 porque fila 1 son los headers y los arrays empiezan en 0

      try {
        // Validar estructura
        const validatedData = importCustomerSchema.parse({
          ...customer,
          // Convertir strings vacíos a null
          email: customer.email?.trim() || null,
          phone: customer.phone?.trim() || null,
          mobile: customer.mobile?.trim() || null,
          website: customer.website?.trim() || null,
          address: customer.address?.trim() || null,
          city: customer.city?.trim() || null,
          province: customer.province?.trim() || null,
          postalCode: customer.postalCode?.trim() || null,
          notes: customer.notes?.trim() || null,
          // Convertir números
          creditLimit: customer.creditLimit ? Number(customer.creditLimit) : null,
          paymentTerms: customer.paymentTerms ? Number(customer.paymentTerms) : 30,
          discount: customer.discount ? Number(customer.discount) : 0,
          priceMultiplier: customer.priceMultiplier ? Number(customer.priceMultiplier) : 1.0,
        })

        // Verificar si el CUIT ya existe
        const existingCustomer = await prisma.customer.findUnique({
          where: { cuit: validatedData.cuit },
        })

        if (existingCustomer) {
          validationResults.push({
            row: rowNumber,
            status: 'error',
            customer: customer,
            error: `CUIT ${validatedData.cuit} ya existe`,
          })
        } else {
          validationResults.push({
            row: rowNumber,
            status: 'valid',
            customer: validatedData,
          })
          validCustomers.push(validatedData)
        }
      } catch (error) {
        if (error instanceof z.ZodError) {
          validationResults.push({
            row: rowNumber,
            status: 'error',
            customer: customer,
            error: error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          })
        } else {
          validationResults.push({
            row: rowNumber,
            status: 'error',
            customer: customer,
            error: 'Error de validación desconocido',
          })
        }
      }
    }

    // Si solo es validación, devolver resultados sin importar
    if (validateOnly) {
      return NextResponse.json({
        validated: true,
        total: customers.length,
        valid: validCustomers.length,
        errors: validationResults.filter((r) => r.status === 'error').length,
        results: validationResults,
      })
    }

    // Importar clientes válidos
    const importedCustomers = []
    const errors = []

    for (const result of validationResults) {
      if (result.status === 'valid' && result.customer) {
        try {
          const customer = await prisma.customer.create({
            data: {
              name: result.customer.name,
              businessName: result.customer.businessName || result.customer.name,
              type: result.customer.type,
              cuit: result.customer.cuit,
              taxCondition: result.customer.taxCondition,
              email: result.customer.email,
              phone: result.customer.phone,
              mobile: result.customer.mobile,
              website: result.customer.website,
              address: result.customer.address,
              city: result.customer.city,
              province: result.customer.province,
              postalCode: result.customer.postalCode,
              country: result.customer.country,
              status: result.customer.status,
              creditLimit: result.customer.creditLimit,
              creditCurrency: result.customer.creditCurrency,
              paymentTerms: result.customer.paymentTerms,
              discount: result.customer.discount,
              priceMultiplier: result.customer.priceMultiplier,
              notes: result.customer.notes,
            },
          })

          importedCustomers.push(customer)

          // Registrar actividad
          await prisma.activity.create({
            data: {
              type: 'CUSTOMER_CREATED',
              userId: session.user.id,
              entityType: 'customer',
              entityId: customer.id,
              customerId: customer.id,
              title: `Cliente importado: ${customer.name}`,
              description: `Cliente ${customer.name} (${customer.cuit}) importado desde CSV`,
            },
          })
        } catch (error) {
          console.error('Error creating customer:', error)
          errors.push({
            row: result.row,
            customer: result.customer,
            error: 'Error al crear el cliente en la base de datos',
          })
        }
      } else {
        errors.push(result)
      }
    }

    return NextResponse.json({
      imported: true,
      total: customers.length,
      success: importedCustomers.length,
      errors: errors.length,
      customers: importedCustomers,
      errorDetails: errors,
    })
  } catch (error) {
    console.error('Error importing customers:', error)
    return NextResponse.json(
      { error: 'Error al importar clientes' },
      { status: 500 }
    )
  }
}

// GET /api/clientes/import - Descargar plantilla CSV
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    // Crear plantilla CSV con headers y una fila de ejemplo
    const headers = [
      'name',
      'businessName',
      'type',
      'cuit',
      'taxCondition',
      'email',
      'phone',
      'mobile',
      'website',
      'address',
      'city',
      'province',
      'postalCode',
      'country',
      'status',
      'creditLimit',
      'creditCurrency',
      'paymentTerms',
      'discount',
      'priceMultiplier',
      'notes',
    ]

    const exampleRow = [
      'Empresa Ejemplo SA',
      'Empresa Ejemplo SA',
      'BUSINESS',
      '30-12345678-9',
      'RESPONSABLE_INSCRIPTO',
      'contacto@ejemplo.com',
      '011-4444-5555',
      '011-15-6666-7777',
      'https://www.ejemplo.com',
      'Av. Corrientes 1234',
      'CABA',
      'Buenos Aires',
      'C1043',
      'Argentina',
      'ACTIVE',
      '100000',
      'ARS',
      '30',
      '0',
      '1.0',
      'Cliente de ejemplo para importación',
    ]

    const csv = [headers.join(','), exampleRow.join(',')].join('\n')

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="plantilla-clientes.csv"',
      },
    })
  } catch (error) {
    console.error('Error generating template:', error)
    return NextResponse.json(
      { error: 'Error al generar plantilla' },
      { status: 500 }
    )
  }
}
