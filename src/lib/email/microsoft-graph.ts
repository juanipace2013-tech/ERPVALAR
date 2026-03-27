/**
 * Microsoft Graph API — Envío de emails via Microsoft 365 / Azure AD
 *
 * Requiere en .env:
 *   AZURE_TENANT_ID     — Directory (tenant) ID
 *   AZURE_CLIENT_ID     — Application (client) ID
 *   AZURE_CLIENT_SECRET — Client secret
 *   AZURE_MAIL_FROM     — Email del remitente (ej: ventas@val-ar.com.ar)
 */

import { config } from 'dotenv'
config()

import { ConfidentialClientApplication } from '@azure/msal-node'

// ── Config ──────────────────────────────────────────────────────────────────

const TENANT_ID = process.env.AZURE_TENANT_ID || ''
const CLIENT_ID = process.env.AZURE_CLIENT_ID || ''
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET || ''
const MAIL_FROM = process.env.AZURE_MAIL_FROM || 'ventas@val-ar.com.ar'
const APP_URL = process.env.APP_URL || 'http://localhost:3000'

if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
  console.warn(
    '⚠️  Azure credentials no configuradas (AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET). Los emails no se enviarán.'
  )
}

// ── MSAL Client (singleton) ─────────────────────────────────────────────────

let msalClient: ConfidentialClientApplication | null = null

function getMsalClient(): ConfidentialClientApplication {
  if (!msalClient) {
    msalClient = new ConfidentialClientApplication({
      auth: {
        clientId: CLIENT_ID,
        authority: `https://login.microsoftonline.com/${TENANT_ID}`,
        clientSecret: CLIENT_SECRET,
      },
    })
  }
  return msalClient
}

/**
 * Obtiene un access token para Microsoft Graph (client credentials flow)
 */
async function getAccessToken(): Promise<string> {
  const client = getMsalClient()
  const result = await client.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  })

  if (!result?.accessToken) {
    throw new Error('No se pudo obtener access token de Azure AD')
  }

  return result.accessToken
}

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
 */
export async function sendMail(options: SendMailOptions): Promise<{ success: boolean; messageId?: string }> {
  const { to, subject, html, text, attachments, cc, replyTo } = options

  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error(
      'Azure credentials no configuradas. Configurar AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET en .env'
    )
  }

  const token = await getAccessToken()

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

  console.log(`[Mail] Enviando email a ${Array.isArray(to) ? to.join(', ') : to} desde ${MAIL_FROM}`)

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
    console.error(`[Mail] Error ${response.status}:`, errorText)
    throw new Error(`Error al enviar email via Graph API: ${response.status} - ${errorText}`)
  }

  console.log(`[Mail] Email enviado exitosamente a ${Array.isArray(to) ? to.join(', ') : to}`)

  return { success: true }
}

// ── Exports de config ───────────────────────────────────────────────────────

export const emailConfig = {
  from: MAIL_FROM,
  appUrl: APP_URL,
}
