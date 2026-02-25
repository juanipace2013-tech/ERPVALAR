import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'

// GET /api/proveedores/import - Descargar plantilla CSV
export async function GET(_request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    // Plantilla CSV para proveedores
    const template = [
      'name,legalName,taxId,email,phone,mobile,address,city,province,postalCode,discount,paymentDays,category,brands,notes',
      'GENEBRE ARGENTINA,Genebre Argentina S.A.,30712345678,ventas@genebre.com.ar,011-4321-5678,011-15-6789-1234,Av. Industrial 1234,Buenos Aires,Buenos Aires,B1640,15,30,Válvulas,GENEBRE,Proveedor de válvulas industriales',
      'WINTERS INSTRUMENTS,Winters Instruments Argentina S.R.L.,30723456789,info@winters.com.ar,011-4567-8901,011-15-7890-2345,Calle Medidores 567,San Martín,Buenos Aires,B1650,10,45,Instrumentos,"WINTERS,ASHCROFT",Especialista en instrumentos de medición',
    ].join('\n')

    return new NextResponse(template, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename=plantilla-proveedores.csv',
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

// POST /api/proveedores/import - Validar o importar proveedores
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const body = await request.json()
    const { suppliers, validateOnly } = body

    if (!Array.isArray(suppliers)) {
      return NextResponse.json(
        { error: 'Formato de datos inválido' },
        { status: 400 }
      )
    }

    const results = []
    let validCount = 0
    let errorCount = 0

    // Procesar cada proveedor
    for (let i = 0; i < suppliers.length; i++) {
      const row = i + 2 // +2 porque fila 1 es header y empezamos en índice 0
      const supplierData = suppliers[i]

      try {
        // Validaciones básicas
        if (!supplierData.name || !supplierData.name.trim()) {
          throw new Error('El nombre es obligatorio')
        }

        // Validar CUIT único si existe
        if (supplierData.taxId && supplierData.taxId.trim()) {
          const existingSupplier = await prisma.supplier.findUnique({
            where: { taxId: supplierData.taxId.trim() },
          })

          if (existingSupplier) {
            throw new Error(`CUIT ${supplierData.taxId} ya existe en el sistema`)
          }
        }

        // Parsear brands (puede venir como string separado por comas)
        let brands: string[] = []
        if (supplierData.brands && typeof supplierData.brands === 'string') {
          brands = supplierData.brands
            .split(',')
            .map((b: string) => b.trim())
            .filter((b: string) => b.length > 0)
        }

        // Preparar datos del proveedor
        const supplier = {
          name: supplierData.name.trim(),
          legalName: supplierData.legalName?.trim() || null,
          taxId: supplierData.taxId?.trim() || null,
          email: supplierData.email?.trim() || null,
          phone: supplierData.phone?.trim() || null,
          mobile: supplierData.mobile?.trim() || null,
          address: supplierData.address?.trim() || null,
          city: supplierData.city?.trim() || null,
          province: supplierData.province?.trim() || null,
          postalCode: supplierData.postalCode?.trim() || null,
          discount: supplierData.discount ? parseFloat(supplierData.discount) : 0,
          paymentDays: supplierData.paymentDays ? parseInt(supplierData.paymentDays) : 30,
          category: supplierData.category?.trim() || null,
          brands,
          notes: supplierData.notes?.trim() || null,
          status: 'ACTIVE' as const,
          isPreferred: false,
          balance: 0,
        }

        // Si solo validamos, no creamos
        if (!validateOnly) {
          await prisma.supplier.create({
            data: supplier,
          })
        }

        results.push({
          row,
          status: 'valid',
          supplier,
        })
        validCount++
      } catch (error) {
        results.push({
          row,
          status: 'error',
          supplier: {
            name: supplierData.name,
            taxId: supplierData.taxId,
            discount: supplierData.discount || 0,
          },
          error: error instanceof Error ? error.message : 'Error desconocido',
        })
        errorCount++
      }
    }

    return NextResponse.json({
      results,
      valid: validCount,
      errors: errorCount,
      success: validateOnly ? 0 : validCount,
    })
  } catch (error) {
    console.error('Error importing suppliers:', error)
    return NextResponse.json(
      { error: 'Error al procesar importación' },
      { status: 500 }
    )
  }
}
