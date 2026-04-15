/**
 * GET    /api/leads/[id]   — detalle del lead
 * PATCH  /api/leads/[id]   — actualizar status, internalNotes y/o customerId
 * DELETE /api/leads/[id]   — eliminar el lead
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

const VALID_STATUS = new Set([
  'NUEVO',
  'CONTACTADO',
  'COTIZADO',
  'CONVERTIDO',
  'DESCARTADO',
])

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const { id } = await params
  const lead = await prisma.googleAdsLead.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, cuit: true, email: true } },
    },
  })

  if (!lead) {
    return NextResponse.json({ error: 'Lead no encontrado' }, { status: 404 })
  }

  return NextResponse.json(lead)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const { id } = await params
  const body = (await req.json()) as {
    status?: string
    internalNotes?: string | null
    customerId?: string | null
  }

  const data: Record<string, unknown> = {}

  if (body.status !== undefined) {
    if (!VALID_STATUS.has(body.status)) {
      return NextResponse.json({ error: 'Estado inválido' }, { status: 400 })
    }
    data.status = body.status
  }

  if (body.internalNotes !== undefined) {
    data.internalNotes = body.internalNotes
  }

  if (body.customerId !== undefined) {
    data.customerId = body.customerId
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nada para actualizar' }, { status: 400 })
  }

  try {
    const updated = await prisma.googleAdsLead.update({
      where: { id },
      data,
      include: {
        customer: { select: { id: true, name: true } },
      },
    })
    return NextResponse.json(updated)
  } catch {
    return NextResponse.json({ error: 'Lead no encontrado' }, { status: 404 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const { id } = await params
  try {
    await prisma.googleAdsLead.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Lead no encontrado' }, { status: 404 })
  }
}
