/**
 * GET /api/google-ads/offline-conversions?key=<GOOGLE_ADS_WEBHOOK_KEY>
 *
 * CSV de conversiones offline para la subida programada de Google Ads
 * (Objetivos → Conversiones → Subidas → Programaciones, fuente HTTPS).
 *
 * Exporta los leads del webhook de Google Ads que tienen gclid y que el
 * equipo marcó como trabajados (CONTACTADO / COTIZADO / CONVERTIDO) como
 * conversiones "Lead ERP calificado". Google descarta filas duplicadas
 * (mismo gclid + nombre + hora), por eso la hora de conversión se deriva
 * de createdAt (estable entre corridas) y no de updatedAt.
 *
 * Formato: https://support.google.com/google-ads/answer/7014069
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

const CONVERSION_NAME = 'Lead ERP calificado'
const QUALIFIED_STATUSES = ['CONTACTADO', 'COTIZADO', 'CONVERTIDO']

/** Formatea una fecha como "yyyy-MM-dd HH:mm:ss" en hora argentina (GMT-3). */
function formatConversionTime(date: Date): string {
  const ar = new Date(date.getTime() - 3 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${ar.getUTCFullYear()}-${pad(ar.getUTCMonth() + 1)}-${pad(ar.getUTCDate())} ` +
    `${pad(ar.getUTCHours())}:${pad(ar.getUTCMinutes())}:${pad(ar.getUTCSeconds())}`
  )
}

export async function GET(req: NextRequest) {
  const expectedKey = process.env.GOOGLE_ADS_WEBHOOK_KEY
  const key = req.nextUrl.searchParams.get('key')

  // El Gestor de Datos de Google Ads se conecta con HTTP Basic Auth
  // (usuario "valarg", contraseña = GOOGLE_ADS_WEBHOOK_KEY). El query
  // param ?key= queda como alternativa para pruebas manuales.
  let basicOk = false
  const authHeader = req.headers.get('authorization')
  if (expectedKey && authHeader?.startsWith('Basic ')) {
    try {
      const [user, pass] = Buffer.from(authHeader.slice(6), 'base64')
        .toString('utf-8')
        .split(':')
      basicOk = user === 'valarg' && pass === expectedKey
    } catch {
      basicOk = false
    }
  }

  if (!expectedKey || (key !== expectedKey && !basicOk)) {
    return new NextResponse('No autorizado', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="google-ads"' },
    })
  }

  const leads = await prisma.googleAdsLead.findMany({
    where: {
      gclId: { not: null },
      status: { in: QUALIFIED_STATUSES },
    },
    select: { gclId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })

  const lines = [
    'Parameters:TimeZone=-0300',
    'Google Click ID,Conversion Name,Conversion Time',
  ]
  for (const lead of leads) {
    // +60s para garantizar que la conversión sea posterior al clic
    const time = formatConversionTime(new Date(lead.createdAt.getTime() + 60_000))
    lines.push(`${lead.gclId},${CONVERSION_NAME},${time}`)
  }

  logger.info(`[offline-conversions] Export para Google Ads: ${leads.length} conversiones`)

  return new NextResponse(lines.join('\n') + '\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
