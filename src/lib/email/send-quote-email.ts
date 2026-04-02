/**
 * Función para enviar emails de cotizaciones con PDF adjunto
 * Usa Microsoft Graph API (Azure / Microsoft 365)
 */

import { randomBytes } from 'crypto'
import { sendMail, getEmailConfig } from './microsoft-graph'
import { generateQuoteEmailHTML, generateQuoteEmailText } from './templates/quote-email'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

interface SendQuoteEmailOptions {
  quoteId: string
  recipientEmail: string
  ccEmails?: string[]
  message?: string
  additionalAttachments?: Array<{
    filename: string
    contentBase64: string
    contentType: string
  }>
}

/**
 * Envía una cotización por email al cliente, con el PDF adjunto
 */
export async function sendQuoteEmail(options: SendQuoteEmailOptions) {
  const { quoteId, recipientEmail, ccEmails, message, additionalAttachments } = options

  // Buscar cotización con datos completos
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: {
      customer: true,
      salesPerson: true,
      items: {
        include: {
          product: true,
          additionals: {
            include: {
              product: {
                select: { sku: true, name: true },
              },
            },
          },
        },
        orderBy: [{ itemNumber: 'asc' }, { isAlternative: 'asc' }],
      },
    },
  })

  if (!quote) {
    throw new Error('Cotización no encontrada')
  }

  // Generar token único para acceso público
  const publicToken = await generatePublicToken(quoteId)

  // URLs públicas
  const { appUrl } = getEmailConfig()
  const viewUrl = `${appUrl}/public/quotes/${publicToken}`
  const acceptUrl = `${appUrl}/public/quotes/${publicToken}?action=accept`
  const rejectUrl = `${appUrl}/public/quotes/${publicToken}?action=reject`

  // Formatear datos para el template
  const currencySymbol = quote.currency === 'USD' ? 'USD' : 'ARS'
  const formattedTotal = `${currencySymbol} ${Number(quote.total).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

  const formattedValidUntil = quote.validUntil
    ? new Date(quote.validUntil).toLocaleDateString('es-AR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      })
    : 'No especificada'

  // Preparar items para el email (solo principales, sin alternativas)
  const fmtPrice = (n: number) =>
    `${currencySymbol} ${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const emailItems = quote.items
    .filter((item) => !item.isAlternative)
    .map((item) => ({
      description: item.product?.name || item.description || 'Item',
      quantity: item.quantity,
      unitPrice: fmtPrice(Number(item.unitPrice)),
      totalPrice: fmtPrice(Number(item.totalPrice)),
      deliveryTime: item.deliveryTime || 'Consultar',
    }))

  const emailData = {
    quoteNumber: quote.quoteNumber,
    customerName: quote.customer.name,
    total: formattedTotal,
    currency: currencySymbol,
    validUntil: formattedValidUntil,
    viewUrl,
    acceptUrl,
    rejectUrl,
    companyName: 'Val Arg',
    message,
    items: emailItems,
  }

  // Generar HTML y texto plano
  const htmlContent = generateQuoteEmailHTML(emailData)
  const textContent = generateQuoteEmailText(emailData)

  // Generar PDF para adjuntar
  let pdfAttachment: { filename: string; contentBase64: string; contentType: string } | undefined
  try {
    const { generateQuotePDF } = await import('@/lib/pdf/quote-generator')

    const altCounters: Record<number, number> = {}
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
        phone: quote.salesPerson.phone || undefined,
      },
      items: quote.items.map((item) => {
        let displayNumber: string
        if (item.isAlternative) {
          if (!altCounters[item.itemNumber]) altCounters[item.itemNumber] = 0
          const letter = String.fromCharCode(65 + altCounters[item.itemNumber])
          altCounters[item.itemNumber]++
          displayNumber = `${item.itemNumber}${letter}`
        } else {
          displayNumber = item.itemNumber.toString()
        }

        let description = item.description || item.product?.name || 'Item manual'
        if (item.isAlternative) description = `Alternativa: ${description}`
        if (item.additionals.length > 0) {
          description +=
            '\n' +
            item.additionals
              .map((add) =>
                add.product ? `+ ${add.product.sku} - ${add.product.name}` : `+ ${add.description || 'Adicional'}`
              )
              .join('\n')
        }

        let code = item.product?.sku || item.manualSku || ''
        if (item.additionals.length > 0) {
          code += '\n' + item.additionals.map((add) => (add.product ? `+ ${add.product.sku}` : '+')).join('\n')
        }

        return {
          itemNumber: displayNumber,
          code,
          description,
          brand: item.product?.brand || item.manualBrand || '-',
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
          totalPrice: Number(item.totalPrice),
          deliveryTime: item.deliveryTime || 'Inmediato',
          isAlternative: item.isAlternative,
        }
      }),
      subtotal: Number(quote.subtotal),
      bonification: Number(quote.bonification || 0),
      total: Number(quote.total),
      exchangeRate: Number(quote.exchangeRate),
      paymentTerms: quote.terms || 'Cuenta corriente a 30 días fecha factura',
      validityDays: quote.validUntil
        ? Math.ceil((quote.validUntil.getTime() - quote.date.getTime()) / (1000 * 60 * 60 * 24))
        : 5,
      purchaseOrderNumber: quote.purchaseOrderNumber || undefined,
      purchaseOrderDate: quote.purchaseOrderDate || undefined,
      tenderNumber: quote.tenderNumber || undefined,
    }

    const pdfBlob = await generateQuotePDF(pdfData)
    const buffer = Buffer.from(await pdfBlob.arrayBuffer())
    const customerLabel = (quote.customer.businessName || quote.customer.name)
      .replace(/[/\\:*?"<>|]/g, '-')
      .trim()

    pdfAttachment = {
      filename: `Cotizacion-${quote.quoteNumber} ${customerLabel}.pdf`,
      contentBase64: buffer.toString('base64'),
      contentType: 'application/pdf',
    }

    logger.info(`[Mail] PDF generado: ${pdfAttachment.filename} (${buffer.length} bytes)`)
  } catch (pdfError) {
    logger.error('[Mail] Error generando PDF para adjuntar:', pdfError)
    // Continuar sin adjunto — el email tiene link para ver online
  }

  // Construir array de todos los adjuntos
  const allAttachments: Array<{ filename: string; contentBase64: string; contentType: string }> = []
  if (pdfAttachment) allAttachments.push(pdfAttachment)
  if (additionalAttachments) allAttachments.push(...additionalAttachments)

  const subject = `Cotización ${quote.quoteNumber} - Val Arg`

  // Enviar email via Microsoft Graph
  try {
    await sendMail({
      to: recipientEmail,
      subject,
      html: htmlContent,
      text: textContent,
      attachments: allAttachments.length > 0 ? allAttachments : undefined,
      cc: ccEmails,
      replyTo: quote.salesPerson.email || undefined,
    })

    // Registrar envío en la base de datos
    await prisma.quoteEmailLog.create({
      data: {
        quoteId,
        recipientEmail,
        subject,
        status: 'sent',
        emailId: null,
        publicToken,
      },
    })

    return {
      success: true,
      publicToken,
      viewUrl,
    }
  } catch (error) {
    logger.error('Error enviando email:', error)

    // Registrar error
    await prisma.quoteEmailLog.create({
      data: {
        quoteId,
        recipientEmail,
        subject,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Error desconocido',
      },
    })

    throw new Error(`Error al enviar email: ${error instanceof Error ? error.message : 'Error desconocido'}`)
  }
}

/**
 * Genera un token único para acceso público a la cotización
 */
async function generatePublicToken(quoteId: string): Promise<string> {
  const token = randomBytes(32).toString('hex')

  await prisma.quotePublicToken.upsert({
    where: { quoteId },
    update: {
      token,
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 días
    },
    create: {
      quoteId,
      token,
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    },
  })

  return token
}

/**
 * Verifica si un token es válido
 */
export async function verifyPublicToken(token: string) {
  const tokenData = await prisma.quotePublicToken.findUnique({
    where: { token },
    include: {
      quote: {
        include: {
          customer: true,
          salesPerson: true,
          items: {
            include: {
              product: true,
            },
          },
        },
      },
    },
  })

  if (!tokenData) {
    throw new Error('Token inválido')
  }

  if (tokenData.expiresAt < new Date()) {
    throw new Error('Token expirado')
  }

  return tokenData.quote
}
