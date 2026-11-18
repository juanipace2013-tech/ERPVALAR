import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { parseCivilDate } from '@/lib/date-helpers'
import { downloadAttachment } from '@/lib/inbox/graph-mail'
import { buscarMailsOC, buzonesOC } from '@/lib/quotes/oc-mail'
import { detectarTipoOC, guardarArchivoOC, OC_ESTADOS, OC_MAX_SIZE } from '@/lib/quotes/oc-archivo'

async function cargarQuote(id: string) {
  return prisma.quote.findUnique({
    where: { id },
    select: {
      id: true,
      quoteNumber: true,
      status: true,
      purchaseOrderNumber: true,
      salesPerson: { select: { email: true } },
      customer: { select: { email: true, contacts: { select: { email: true } } } },
    },
  })
}

/**
 * GET /api/quotes/[id]/oc-mail
 * Mails recientes del cliente con adjuntos que pueden ser la OC
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const { id } = await params
    const quote = await cargarQuote(id)
    if (!quote) return NextResponse.json({ error: 'Cotización no encontrada' }, { status: 404 })

    const mensajes = await buscarMailsOC({
      quoteNumber: quote.quoteNumber,
      purchaseOrderNumber: quote.purchaseOrderNumber,
      emailsCliente: [quote.customer.email, ...quote.customer.contacts.map((c) => c.email)],
      emailVendedor: quote.salesPerson?.email,
    })
    return NextResponse.json({ mensajes })
  } catch (error) {
    logger.error('Error buscando la OC en el mail:', error)
    return NextResponse.json({ error: 'No se pudo consultar el correo' }, { status: 502 })
  }
}

/**
 * POST /api/quotes/[id]/oc-mail  { buzon, messageId, attachmentId, purchaseOrderNumber?, purchaseOrderDate? }
 * Adjunta como OC un adjunto elegido de la lista del GET
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const { id } = await params
    const body = await request.json().catch(() => null)
    const { buzon, messageId, attachmentId, purchaseOrderNumber, purchaseOrderDate } = body ?? {}
    if (typeof buzon !== 'string' || typeof messageId !== 'string' || typeof attachmentId !== 'string') {
      return NextResponse.json({ error: 'Faltan datos del adjunto' }, { status: 400 })
    }

    const quote = await cargarQuote(id)
    if (!quote) return NextResponse.json({ error: 'Cotización no encontrada' }, { status: 404 })
    if (!OC_ESTADOS.includes(quote.status)) {
      return NextResponse.json({ error: 'Solo se puede adjuntar OC a cotizaciones aceptadas' }, { status: 400 })
    }
    // Solo los buzones donde busca el GET: el cliente no elige de qué casilla leer
    if (!buzonesOC(quote.salesPerson?.email).includes(buzon.toLowerCase())) {
      return NextResponse.json({ error: 'Buzón no permitido' }, { status: 400 })
    }

    const bytes = await downloadAttachment(buzon.toLowerCase(), messageId, attachmentId)
    if (bytes.length > OC_MAX_SIZE) {
      return NextResponse.json({ error: 'El archivo excede el límite de 10MB.' }, { status: 400 })
    }
    const tipo = detectarTipoOC(bytes)
    if (!tipo) {
      return NextResponse.json({ error: 'El adjunto no es un PDF, JPG o PNG válido.' }, { status: 400 })
    }

    const data: Record<string, unknown> = {
      purchaseOrderUrl: await guardarArchivoOC(quote.quoteNumber, bytes, tipo),
    }
    if (typeof purchaseOrderNumber === 'string' && purchaseOrderNumber.trim()) {
      data.purchaseOrderNumber = purchaseOrderNumber.trim()
    }
    if (typeof purchaseOrderDate === 'string' && purchaseOrderDate) {
      data.purchaseOrderDate = parseCivilDate(purchaseOrderDate)
    }

    const updated = await prisma.quote.update({
      where: { id },
      data,
      select: { purchaseOrderUrl: true, purchaseOrderNumber: true, purchaseOrderDate: true },
    })
    return NextResponse.json(updated)
  } catch (error) {
    logger.error('Error adjuntando la OC desde el mail:', error)
    return NextResponse.json({ error: 'No se pudo traer el adjunto del correo' }, { status: 502 })
  }
}
