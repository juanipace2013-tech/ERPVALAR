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
