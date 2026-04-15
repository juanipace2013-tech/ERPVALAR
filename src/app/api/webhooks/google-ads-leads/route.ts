/**
 * Webhook receptor de Google Ads Lead Form Extensions.
 *
 * POST /api/webhooks/google-ads-leads
 *   Recibe el payload del form, valida `google_key`, persiste el lead
 *   e intenta vincularlo a un Customer existente por email o teléfono.
 *   Siempre responde 200 para evitar reintentos de Google: los errores
 *   internos se loguean pero no se propagan como 5xx.
 *
 * GET /api/webhooks/google-ads-leads
 *   Health check — Google lo usa para validar el endpoint.
 *
 * Docs: https://support.google.com/google-ads/answer/7434409
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { sendMail, getEmailConfig } from '@/lib/email/microsoft-graph'

const NOTIFY_EMAIL = 'stejedor@val-ar.com.ar'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function sendLeadNotification(lead: {
  id: string
  fullName: string | null
  email: string | null
  phone: string | null
  companyName: string | null
  message: string | null
  campaignId: string | null
}) {
  const { appUrl } = getEmailConfig()
  const url = `${appUrl}/leads/${lead.id}`
  const row = (label: string, value: string | null) =>
    `<tr><td style="padding:4px 8px;color:#666;">${label}</td><td style="padding:4px 8px;"><strong>${value ? escapeHtml(value) : '—'}</strong></td></tr>`

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;">
      <h2 style="color:#1d4ed8;">Nuevo lead de Google Ads</h2>
      <table style="border-collapse:collapse;font-size:14px;">
        ${row('Nombre', lead.fullName)}
        ${row('Email', lead.email)}
        ${row('Teléfono', lead.phone)}
        ${row('Empresa', lead.companyName)}
        ${row('Campaña', lead.campaignId)}
        ${row('Mensaje', lead.message)}
      </table>
      <p style="margin-top:16px;">
        <a href="${url}" style="background:#1d4ed8;color:#fff;padding:10px 16px;text-decoration:none;border-radius:6px;">
          Ver lead en el ERP
        </a>
      </p>
    </div>
  `

  await sendMail({
    to: NOTIFY_EMAIL,
    subject: `[Lead Google Ads] ${lead.fullName || lead.email || 'sin nombre'}`,
    html,
  })
}

interface UserColumnData {
  column_name?: string
  string_value?: string
  column_id?: string
}

interface GoogleAdsLeadPayload {
  lead_id?: string
  google_key?: string
  api_version?: string
  gcl_id?: string
  campaign_id?: string | number
  user_column_data?: UserColumnData[]
  [key: string]: unknown
}

/**
 * Extrae un valor de user_column_data por column_name.
 * Google usa nombres en mayúsculas tipo "FULL_NAME", "EMAIL", "PHONE_NUMBER".
 */
function pickColumn(
  columns: UserColumnData[] | undefined,
  name: string
): string | undefined {
  if (!columns) return undefined
  const match = columns.find(
    (c) => c.column_name?.toUpperCase() === name.toUpperCase()
  )
  return match?.string_value?.trim() || undefined
}

export async function GET() {
  return NextResponse.json({ status: 'ok' })
}

export async function POST(req: NextRequest) {
  let payload: GoogleAdsLeadPayload

  try {
    payload = (await req.json()) as GoogleAdsLeadPayload
  } catch (error) {
    logger.error('[google-ads-leads] JSON inválido en webhook:', error)
    // 200 igual — no queremos que Google reintente un payload malformado.
    return NextResponse.json({ status: 'ignored', reason: 'invalid_json' })
  }

  try {
    const expectedKey = process.env.GOOGLE_ADS_WEBHOOK_KEY

    if (!expectedKey) {
      logger.error('[google-ads-leads] GOOGLE_ADS_WEBHOOK_KEY no configurada')
      return NextResponse.json({ status: 'ignored', reason: 'not_configured' })
    }

    if (payload.google_key !== expectedKey) {
      logger.warn('[google-ads-leads] google_key inválida, payload descartado')
      // 200 para no dar pistas al atacante y evitar reintentos.
      return NextResponse.json({ status: 'ignored', reason: 'invalid_key' })
    }

    const columns = payload.user_column_data
    const fullName = pickColumn(columns, 'FULL_NAME')
    const email = pickColumn(columns, 'EMAIL')?.toLowerCase()
    const phone = pickColumn(columns, 'PHONE_NUMBER')
    const companyName = pickColumn(columns, 'COMPANY_NAME')
    const message =
      pickColumn(columns, 'MESSAGE') ||
      pickColumn(columns, 'COMMENTS') ||
      undefined

    // Intentar vincular a un Customer existente por email o teléfono.
    let customerId: string | undefined
    if (email || phone) {
      const or: Array<Record<string, string>> = []
      if (email) or.push({ email })
      if (phone) {
        or.push({ phone }, { mobile: phone })
      }

      const existing = await prisma.customer.findFirst({
        where: { OR: or },
        select: { id: true },
      })
      customerId = existing?.id
    }

    const lead = await prisma.googleAdsLead.create({
      data: {
        leadId: payload.lead_id || null,
        gclId: payload.gcl_id || null,
        campaignId: payload.campaign_id ? String(payload.campaign_id) : null,
        fullName: fullName || null,
        email: email || null,
        phone: phone || null,
        companyName: companyName || null,
        message: message || null,
        rawPayload: payload as never,
        customerId: customerId || null,
        processedAt: new Date(),
      },
    })

    logger.info(
      `[google-ads-leads] Lead recibido id=${lead.id} email=${email ?? '-'} customer=${customerId ?? 'none'}`
    )

    // Notificación por email — no bloquea ni rompe la respuesta al webhook.
    sendLeadNotification(lead).catch((err) => {
      logger.error('[google-ads-leads] Error enviando notificación email:', err?.message || err)
    })

    return NextResponse.json({ status: 'ok', id: lead.id })
  } catch (error: any) {
    // NUNCA devolver 500 — Google reintentaría.
    logger.error(
      '[google-ads-leads] Error procesando webhook:',
      error?.message || error,
      { payload }
    )
    return NextResponse.json({ status: 'error_logged' })
  }
}
