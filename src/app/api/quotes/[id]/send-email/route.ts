import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import { sendQuoteEmail } from '@/lib/email/send-quote-email';
import { updateQuoteStatus } from '@/lib/quote-workflow';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger'
import { readFile } from 'fs/promises'
import path from 'path'

const SHEET_CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
}

/**
 * Lee del disco las fichas técnicas de los productos seleccionados
 * (solo productos que pertenecen a la cotización) y las devuelve
 * como adjuntos base64 para el email.
 */
async function buildFichaAttachments(quoteId: string, productIds: string[]) {
  // El producto seleccionado puede ser el principal del ítem o un adicional
  // del conjunto (ej: actuador montado sobre la válvula).
  const items = await prisma.quoteItem.findMany({
    where: {
      quoteId,
      OR: [
        { productId: { in: productIds } },
        { additionals: { some: { productId: { in: productIds } } } },
      ],
    },
    select: {
      product: {
        select: {
          id: true,
          sku: true,
          technicalSheetUrl: true,
          technicalSheetName: true,
        },
      },
      additionals: {
        select: {
          product: {
            select: {
              id: true,
              sku: true,
              technicalSheetUrl: true,
              technicalSheetName: true,
            },
          },
        },
      },
    },
  })

  const attachments: Array<{ filename: string; contentBase64: string; contentType: string }> = []
  const selectedIds = new Set(productIds)
  const seenProducts = new Set<string>()
  // Productos de la misma familia comparten la ficha (mismo nombre de
  // archivo): adjuntarla una sola vez aunque vengan varios seleccionados.
  const seenFilenames = new Set<string>()

  for (const item of items) {
    const products = [item.product, ...item.additionals.map((a) => a.product)]

    for (const p of products) {
      // El ítem puede matchear por su adicional: filtrar por producto seleccionado
      if (!p || !selectedIds.has(p.id)) continue
      if (!p.technicalSheetUrl || seenProducts.has(p.id)) continue
      seenProducts.add(p.id)

      try {
        const filePath = path.join(process.cwd(), 'public', p.technicalSheetUrl)
        const ext = path.extname(p.technicalSheetUrl).toLowerCase()
        const filename = p.technicalSheetName || `Ficha-Tecnica-${p.sku}${ext}`
        if (seenFilenames.has(filename)) continue
        const buffer = await readFile(filePath)
        seenFilenames.add(filename)
        attachments.push({
          filename,
          contentBase64: buffer.toString('base64'),
          contentType: SHEET_CONTENT_TYPES[ext] || 'application/octet-stream',
        })
      } catch (err) {
        // Ficha faltante en disco: avisar en logs pero no frenar el envío
        logger.error(`[Mail] Ficha técnica no encontrada para producto ${p.sku}:`, err)
      }
    }
  }

  return attachments
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Parsea un string con emails separados por , o ; */
function parseEmails(raw: string): string[] {
  return raw.split(/[,;]/).map((e) => e.trim()).filter(Boolean);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { email, message, additionalAttachments, fichaProductIds } = body;

    // Validar que haya al menos un email
    if (!email || !email.trim()) {
      return NextResponse.json(
        { error: 'Email requerido' },
        { status: 400 }
      );
    }

    // Parsear y validar cada email
    const emails = parseEmails(email);
    if (emails.length === 0) {
      return NextResponse.json(
        { error: 'Email requerido' },
        { status: 400 }
      );
    }

    const invalid = emails.filter((e) => !EMAIL_REGEX.test(e));
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: `Email(s) inválido(s): ${invalid.join(', ')}` },
        { status: 400 }
      );
    }

    // Buscar cotización
    const quote = await prisma.quote.findUnique({
      where: { id },
      include: { customer: true }
    });

    if (!quote) {
      return NextResponse.json(
        { error: 'Cotización no encontrada' },
        { status: 404 }
      );
    }

    // Validar que la cotización no esté vencida
    if (quote.validUntil && new Date(quote.validUntil) < new Date()) {
      return NextResponse.json(
        { error: 'La cotización está vencida. Actualizá la fecha de validez antes de enviar.' },
        { status: 400 }
      );
    }

    // Cambiar estado a SENT si está en DRAFT
    if (quote.status === 'DRAFT') {
      await updateQuoteStatus(id, 'SENT', session.user.id);
    }

    // Fichas técnicas seleccionadas: leerlas del disco y sumarlas a los adjuntos
    let allAttachments = additionalAttachments as
      | Array<{ filename: string; contentBase64: string; contentType: string }>
      | undefined;

    if (Array.isArray(fichaProductIds) && fichaProductIds.length > 0) {
      const fichas = await buildFichaAttachments(id, fichaProductIds);
      if (fichas.length > 0) {
        allAttachments = [...fichas, ...(allAttachments || [])];
      }
    }

    // Enviar email — primer email como TO, resto como CC
    const [primaryEmail, ...ccEmails] = emails;

    const result = await sendQuoteEmail({
      quoteId: id,
      recipientEmail: primaryEmail,
      ccEmails: ccEmails.length > 0 ? ccEmails : undefined,
      message,
      additionalAttachments: allAttachments,
    });

    return NextResponse.json({
      message: emails.length === 1
        ? 'Email enviado correctamente'
        : `Email enviado a ${emails.length} destinatarios`,
      ...result
    });

  } catch (error) {
    logger.error('Error enviando email de cotización:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Error al enviar email',
        details: error instanceof Error ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}
