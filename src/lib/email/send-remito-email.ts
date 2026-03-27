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

  // Formatear fecha
  const formattedDate = new Date(dn.date).toLocaleDateString('es-AR', {
    day: '2-digit',
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
    customerName: dn.customer.businessName || dn.customer.name,
    date: formattedDate,
    itemCount: dn.items.length,
    deliveryAddress,
    companyName: 'Val Arg',
    message,
    trackingNumber: dn.trackingNumber || undefined,
  }

  const htmlContent = generateRemitoEmailHTML(emailData)
  const textContent = generateRemitoEmailText(emailData)

  // ── Generar o leer el adjunto PDF ─────────────────────────────────────────
  let pdfAttachment: { filename: string; contentBase64: string; contentType: string } | undefined

  const customerLabel = (dn.customer.businessName || dn.customer.name)
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

        console.log(`[Mail] Usando remito firmado: ${signedName} (${signedBuffer.length} bytes)`)
      } else {
        console.warn(`[Mail] signedDocUrl existe pero archivo no encontrado: ${signedPath}`)
      }
    } catch (signedError) {
      console.error('[Mail] Error leyendo remito firmado:', signedError)
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
          name: dn.customer.name,
          businessName: dn.customer.businessName || undefined,
          cuit: dn.customer.cuit,
          taxCondition: dn.customer.taxCondition || undefined,
          address: dn.customer.address || undefined,
          city: dn.customer.city || undefined,
          province: dn.customer.province || undefined,
        },
        items: dn.items.map((item) => ({
          sku: item.sku || item.product?.sku || '',
          description: item.description || item.product?.name || '',
          quantity: item.quantity,
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

      console.log(`[Mail] PDF remito generado: ${pdfAttachment.filename} (${buffer.length} bytes)`)
    } catch (pdfError) {
      console.error('[Mail] Error generando PDF de remito:', pdfError)
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

    console.log(`[Mail] Remito ${dn.deliveryNumber} enviado a ${recipientEmail}`)

    return {
      success: true,
      deliveryNumber: dn.deliveryNumber,
      usedSignedDoc: !!dn.signedDocUrl,
    }
  } catch (error) {
    console.error('Error enviando email de remito:', error)
    throw new Error(`Error al enviar email: ${error instanceof Error ? error.message : 'Error desconocido'}`)
  }
}
