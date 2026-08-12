/**
 * Microsoft Graph API — Envío de emails via Microsoft 365 / Azure AD
 *
 * Requiere en .env:
 *   AZURE_TENANT_ID     — Directory (tenant) ID
 *   AZURE_CLIENT_ID     — Application (client) ID
 *   AZURE_CLIENT_SECRET — Client secret
 *   AZURE_MAIL_FROM     — Email del remitente (ej: ventas@val-ar.com.ar)
 */

import { logger } from '@/lib/logger'
import { getGraphToken } from '@/lib/inbox/graph-mail'

// ── Tipos ───────────────────────────────────────────────────────────────────

export interface EmailAttachment {
  /** Nombre del archivo (ej: "Cotizacion-001.pdf") */
  filename: string
  /** Contenido en base64 */
  contentBase64: string
  /** MIME type (ej: "application/pdf") */
  contentType: string
}

export interface SendMailOptions {
  to: string | string[]
  subject: string
  html: string
  text?: string
  attachments?: EmailAttachment[]
  cc?: string | string[]
  replyTo?: string
}

// ── Función principal de envío ──────────────────────────────────────────────

/**
 * Envía un email usando Microsoft Graph API (sendMail).
 * Usa client credentials → Application permission Mail.Send.
 *
 * Las variables de entorno se leen en runtime (dentro de la función)
 * para evitar problemas con Next.js/Turbopack que resuelve process.env en build time.
 */
export async function sendMail(options: SendMailOptions): Promise<{ success: boolean; messageId?: string }> {
  const { to, subject, html, text, attachments, cc, replyTo } = options

  const MAIL_FROM = process.env.AZURE_MAIL_FROM || 'ventas@val-ar.com.ar'

  // Token cacheado en memoria (mismas credenciales y scope que el inbox).
  // Antes se creaba un cliente MSAL nuevo y se pedía un token a Azure AD
  // en CADA envío, sumando un round-trip externo por email.
  const token = await getGraphToken()

  // Construir recipients
  const toRecipients = (Array.isArray(to) ? to : [to]).map((email) => ({
    emailAddress: { address: email },
  }))

  const ccRecipients = cc
    ? (Array.isArray(cc) ? cc : [cc]).map((email) => ({
        emailAddress: { address: email },
      }))
    : undefined

  // Construir attachments para Graph API
  const graphAttachments = attachments?.map((att) => ({
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: att.filename,
    contentType: att.contentType,
    contentBytes: att.contentBase64,
  }))

  // Body del request a Graph
  const mailBody: Record<string, any> = {
    message: {
      subject,
      body: {
        contentType: 'HTML',
        content: html,
      },
      toRecipients,
      ...(ccRecipients && { ccRecipients }),
      ...(replyTo && {
        replyTo: [{ emailAddress: { address: replyTo } }],
      }),
      ...(graphAttachments &&
        graphAttachments.length > 0 && { attachments: graphAttachments }),
    },
    saveToSentItems: true,
  }

  // Enviar via Graph API
  const graphUrl = `https://graph.microsoft.com/v1.0/users/${MAIL_FROM}/sendMail`

  logger.info(`[Mail] Enviando email a ${Array.isArray(to) ? to.join(', ') : to} desde ${MAIL_FROM}`)

  const response = await fetch(graphUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(mailBody),
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[Mail] Error ${response.status}:`, errorText)
    throw new Error(`Error al enviar email via Graph API: ${response.status} - ${errorText}`)
  }

  logger.info(`[Mail] Email enviado exitosamente a ${Array.isArray(to) ? to.join(', ') : to}`)

  return { success: true }
}

// ── Exports de config ───────────────────────────────────────────────────────

export function getEmailConfig() {
  return {
    from: process.env.AZURE_MAIL_FROM || 'ventas@val-ar.com.ar',
    appUrl: process.env.APP_URL || 'http://localhost:3000',
  }
}
