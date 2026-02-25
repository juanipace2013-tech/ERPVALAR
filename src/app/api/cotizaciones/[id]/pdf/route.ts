import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { generateQuotePDF } from '@/lib/pdf/quote-generator'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { id } = await params

    const quote = await prisma.quote.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            name: true,
            businessName: true,
            cuit: true,
            address: true,
            city: true,
            province: true,
          },
        },
        salesPerson: {
          select: {
            name: true,
            email: true,
            phone: true,
          },
        },
        items: {
          include: {
            product: {
              select: {
                sku: true,
                name: true,
                brand: true,
              },
            },
            additionals: {
              include: {
                product: {
                  select: {
                    sku: true,
                    name: true,
                  },
                },
              },
            },
          },
          orderBy: [{ itemNumber: 'asc' }, { isAlternative: 'asc' }],
        },
      },
    })

    if (!quote) {
      return NextResponse.json({ error: 'Cotización no encontrada' }, { status: 404 })
    }

    // Preparar datos para el PDF
    const pdfData = {
      quoteNumber: quote.quoteNumber,
      date: quote.date,
      validUntil: quote.validUntil || new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      customer: {
        name: quote.customer.name,
        legalName: quote.customer.businessName || undefined,
        taxId: quote.customer.cuit || undefined,
        address: quote.customer.address
          ? `${quote.customer.address}${quote.customer.city ? ', ' + quote.customer.city : ''}${quote.customer.province ? ', ' + quote.customer.province : ''}`
          : undefined,
      },
      salesPerson: {
        name: quote.salesPerson.name,
        email: quote.salesPerson.email || 'ventas@val-ar.com.ar',
      },
      items: (() => {
        // Tracking de índices de alternativas por itemNumber padre
        const altCounters: Record<number, number> = {}

        return quote.items.map((item) => {
          // Calcular número de item para display
          let displayNumber: string
          if (item.isAlternative) {
            if (!altCounters[item.itemNumber]) altCounters[item.itemNumber] = 0
            const letter = String.fromCharCode(65 + altCounters[item.itemNumber])
            altCounters[item.itemNumber]++
            displayNumber = `${item.itemNumber}${letter}`
          } else {
            displayNumber = item.itemNumber.toString()
          }

          // Construir descripción con adicionales
          let description = item.description || item.product?.name
          if (item.isAlternative) {
            description = `Alternativa: ${description}`
          }

          if (item.additionals.length > 0) {
            description += '\n' + item.additionals
              .map((add) => `+ ${add.product.sku} - ${add.product.name}`)
              .join('\n')
          }

          return {
            itemNumber: displayNumber,
            code: item.product?.sku || '',
            description,
            brand: item.product?.brand || 'GENEBRE',
            quantity: item.quantity,
            unitPrice: Number(item.unitPrice),
            totalPrice: Number(item.totalPrice),
            deliveryTime: item.deliveryTime || 'Inmediato',
            isAlternative: item.isAlternative,
          }
        })
      })(),
      subtotal: Number(quote.subtotal),
      total: Number(quote.total),
      exchangeRate: Number(quote.exchangeRate),
      paymentTerms: quote.terms || 'Cuenta corriente a 30 días fecha factura',
      validityDays: quote.validUntil
        ? Math.ceil((quote.validUntil.getTime() - quote.date.getTime()) / (1000 * 60 * 60 * 24))
        : 5,
    }

    // Generar PDF
    const pdfBlob = await generateQuotePDF(pdfData)
    const buffer = Buffer.from(await pdfBlob.arrayBuffer())

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Cotizacion-${quote.quoteNumber}.pdf"`,
      },
    })
  } catch (error) {
    console.error('Error generando PDF:', error)
    return NextResponse.json(
      { error: 'Error al generar PDF', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
