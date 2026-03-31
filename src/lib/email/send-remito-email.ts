/**
 * Función para enviar remitos por email con PDF adjunto
 * Usa Microsoft Graph API (Azure / Microsoft 365)
 *
 * Prioridad de adjunto:
 *  1. Remito firmado/escaneado (signedDocUrl) si existe
 *  2. PDF generado por el sistema (fallback)
 */

import fs from 'fs'
import path from 'path'
import { sendMail, getEmailConfig } from './microsoft-graph'
import { generateRemitoEmailHTML, generateRemitoEmailText } from './templates/remito-email'
import { generateRemitoPDF, type RemitoPDFData } from '@/lib/pdf/remito-generator'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

interface SendRemitoEmailOptions {
  deliveryNoteId: string
  recipientEmail: string
  ccEmails?: string[]
  message?: string
}

/**
 * Envía un remito por email al cliente, con el PDF adjunto.
 * Si el remito tiene un documento firmado escaneado, se envía ese.
 * Si no, se genera el PDF del sistema.
 */
export async function sendRemitoEmail(options: SendRemitoEmailOptions) {
  const { deliveryNoteId, recipientEmail, ccEmails, message } = options

  // Buscar remito con datos completos
  const dn = await prisma.deliveryNote.findUnique({
    where: { id: deliveryNoteId },
    include: {
      customer: true,
      items: {
        include: {
          product: true,
        },
      },
    },
  })

  if (!dn) {
    throw new Error('Remito no encontrado')
  }

  if (!dn.customer) {
    throw new Error('Remito sin cliente asociado')
  }

  const customer = dn.customer

  // Fecha actual (cuando se envía el mail)
  const formattedDate = new Date().toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  // Dirección de entrega
  const deliveryAddress = [dn.deliveryAddress, dn.deliveryCity, dn.deliveryProvince]
    .filter(Boolean)
    .join(', ') || undefined

  // Datos para el template
  const emailData = {
    deliveryNumber: dn.deliveryNumber,
    customerName: customer.businessName || customer.name,
    date: formattedDate,
    deliveryAddress,
    companyName: 'Val Arg',
    message,
    trackingNumber: dn.trackingNumber || undefined,
  }

  const htmlContent = generateRemitoEmailHTML(emailData)
  const textContent = generateRemitoEmailText(emailData)

  // ── Generar o leer el adjunto PDF ─────────────────────────────────────────
  let pdfAttachment: { filename: string; contentBase64: string; contentType: string } | undefined

  const customerLabel = (customer.businessName || customer.name)
    .replace(/[/\\:*?"<>|]/g, '-')
    .trim()

  // 1) Intentar usar el remito firmado/escaneado si existe
  if (dn.signedDocUrl) {
    try {
      const signedPath = path.join(process.cwd(), 'public', dn.signedDocUrl)
      if (fs.existsSync(signedPath)) {
        const signedBuffer = fs.readFileSync(signedPath)

        // Detectar content type por extensión
        const ext = path.extname(signedPath).toLowerCase()
        const contentType =
          ext === '.pdf' ? 'application/pdf'
          : ext === '.png' ? 'image/png'
          : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
          : 'application/pdf'

        const signedName = dn.signedDocName || `Remito-${dn.deliveryNumber}-firmado${ext}`

        pdfAttachment = {
          filename: signedName,
          contentBase64: signedBuffer.toString('base64'),
          contentType,
        }

        logger.info(`[Mail] Usando remito firmado: ${signedName} (${signedBuffer.length} bytes)`)
      } else {
        logger.warn(`[Mail] signedDocUrl existe pero archivo no encontrado: ${signedPath}`)
      }
    } catch (signedError) {
      logger.error('[Mail] Error leyendo remito firmado:', signedError)
      // Fallback: generar PDF del sistema
    }
  }

  // 2) Fallback: generar PDF del sistema si no hay firmado
  if (!pdfAttachment) {
    try {
      let caiData = undefined
      try {
        const cai = await prisma.caiRegistration.findFirst({
          where: {
            active: true,
            expiresAt: { gt: new Date() },
          },
          orderBy: { createdAt: 'desc' },
        })
        if (cai) {
          caiData = {
            caiNumber: cai.caiNumber,
            expiresAt: cai.expiresAt,
            puntoVenta: cai.puntoVenta,
          }
        }
      } catch {
        // Sin CAI, continuar
      }

      const pdfData: RemitoPDFData = {
        deliveryNumber: dn.deliveryNumber,
        date: new Date(dn.date),
        customer: {
          name: customer.name,
          businessName: customer.businessName || undefined,
          cuit: customer.cuit,
          taxCondition: customer.taxCondition || undefined,
          address: customer.address || undefined,
          city: customer.city || undefined,
          province: customer.province || undefined,
        },
        items: dn.items.map((item) => ({
          sku: item.sku || item.product?.sku || '',
          description: item.description || item.product?.name || '',
          quantity: Number(item.quantity),
          unit: item.unit || item.product?.unit || 'UN',
        })),
        deliveryAddress: dn.deliveryAddress || undefined,
        deliveryCity: dn.deliveryCity || undefined,
        deliveryProvince: dn.deliveryProvince || undefined,
        carrier: dn.carrier || undefined,
        purchaseOrder: dn.purchaseOrder || undefined,
        notes: dn.notes || undefined,
        bultos: dn.bultos || undefined,
        preparedBy: dn.preparedBy || undefined,
        deliveredBy: dn.deliveredBy || undefined,
        cai: caiData,
      }

      const pdfBlob = generateRemitoPDF(pdfData)
      const pdfArrayBuffer = await pdfBlob.arrayBuffer()
      const buffer = Buffer.from(pdfArrayBuffer)

      pdfAttachment = {
        filename: `Remito-${dn.deliveryNumber} ${customerLabel}.pdf`,
        contentBase64: buffer.toString('base64'),
        contentType: 'application/pdf',
      }

      logger.info(`[Mail] PDF remito generado: ${pdfAttachment.filename} (${buffer.length} bytes)`)
    } catch (pdfError) {
      logger.error('[Mail] Error generando PDF de remito:', pdfError)
      throw new Error('Error al generar el PDF del remito para adjuntar')
    }
  }

  const subject = `Remito ${dn.deliveryNumber} - Val Arg`

  // Enviar email via Microsoft Graph
  try {
    await sendMail({
      to: recipientEmail,
      subject,
      html: htmlContent,
      text: textContent,
      attachments: pdfAttachment ? [pdfAttachment] : undefined,
      cc: ccEmails,
    })

    logger.info(`[Mail] Remito ${dn.deliveryNumber} enviado a ${recipientEmail}`)

    return {
      success: true,
      deliveryNumber: dn.deliveryNumber,
      usedSignedDoc: !!dn.signedDocUrl,
    }
  } catch (error) {
    logger.error('Error enviando email de remito:', error)
    throw new Error(`Error al enviar email: ${error instanceof Error ? error.message : 'Error desconocido'}`)
  }
}
