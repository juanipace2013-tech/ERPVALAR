/**
 * Endpoints administrativos para gestionar la subscription de mail con Graph.
 *
 * POST /api/inbox/graph/setup
 *   Crea una subscription nueva contra ventas@val-ar.com.ar (o el AZURE_MAIL_FROM).
 *   Body opcional: { userUpn?: string }
 *
 * GET  /api/inbox/graph/setup
 *   Devuelve las subscriptions registradas en nuestra BD (no consulta a Graph).
 *
 * DELETE /api/inbox/graph/setup?id=<subscriptionId>
 *   Borra la subscription en Graph y en nuestra BD.
 *
 * Requiere rol ADMIN.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import {
  createMailSubscription,
  deleteMailSubscription,
  defaultMailSubscriptionExpiration,
} from '@/lib/inbox/graph-mail'
import crypto from 'node:crypto'

function getNotificationUrl(): string {
  const base = process.env.APP_URL || 'http://localhost:3000'
  return `${base.replace(/\/$/, '')}/api/webhooks/microsoft-graph`
}

export async function GET() {
  const session = await auth()
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }
  const subs = await prisma.graphSubscription.findMany({
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({ subscriptions: subs })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const userUpn = (body.userUpn as string | undefined) ?? process.env.AZURE_MAIL_FROM
  if (!userUpn) {
    return NextResponse.json({ error: 'AZURE_MAIL_FROM no configurado' }, { status: 400 })
  }

  // clientState: usamos el de .env si está; si no, generamos uno y lo guardamos
  let clientState = process.env.GRAPH_WEBHOOK_CLIENT_STATE
  if (!clientState) {
    clientState = crypto.randomBytes(24).toString('hex')
    logger.warn(
      `[Graph Setup] GRAPH_WEBHOOK_CLIENT_STATE no estaba en .env — generé uno temporal: ${clientState}`
    )
  }

  const notificationUrl = getNotificationUrl()
  if (notificationUrl.startsWith('http://localhost')) {
    return NextResponse.json(
      {
        error:
          'Graph no acepta notificationUrl en localhost. Exponé el server con un túnel (ngrok / cloudflared) y setea APP_URL al URL público.',
      },
      { status: 400 }
    )
  }

  try {
    const created = await createMailSubscription({
      userUpn,
      notificationUrl,
      clientState,
    })

    const saved = await prisma.graphSubscription.create({
      data: {
        subscriptionId: created.id,
        resource: created.resource,
        changeType: created.changeType,
        notificationUrl: created.notificationUrl,
        clientState,
        expiresAt: new Date(created.expirationDateTime),
      },
    })

    return NextResponse.json({ subscription: saved })
  } catch (e) {
    logger.error('[Graph Setup] Error creando subscription', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error desconocido' },
      { status: 500 }
    )
  }
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }

  const url = new URL(req.url)
  const subscriptionId = url.searchParams.get('id')
  if (!subscriptionId) {
    return NextResponse.json({ error: 'Falta parámetro id' }, { status: 400 })
  }

  try {
    await deleteMailSubscription(subscriptionId)
  } catch (e) {
    logger.warn('[Graph Setup] Error borrando subscription en Graph (sigue en BD)', e)
  }
  await prisma.graphSubscription.deleteMany({ where: { subscriptionId } })
  return NextResponse.json({ ok: true })
}

/** Útil para llamarlo desde un cron antes que expire. No expuesto por ahora — TODO en Fase 1. */
export const dynamic = 'force-dynamic'
// suprimir warnings de unused imports
void defaultMailSubscriptionExpiration
