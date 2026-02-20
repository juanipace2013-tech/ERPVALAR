/**
 * API Endpoint: /api/contabilidad/plantillas/[code]
 * Gestión de plantilla específica
 */

import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import { getTemplateByCode, validateTemplate } from '@/lib/contabilidad/apply-template';

interface RouteParams {
  params: Promise<{
    code: string;
  }>;
}

/**
 * GET /api/contabilidad/plantillas/[code]
 * Obtener detalles de una plantilla
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const { code } = await params;
    const template = await getTemplateByCode(code);

    if (!template) {
      return NextResponse.json(
        { error: 'Plantilla no encontrada' },
        { status: 404 }
      );
    }

    // Validar plantilla
    const validation = await validateTemplate(code);

    return NextResponse.json({
      template,
      validation,
    });
  } catch (error) {
    console.error('Error fetching template:', error);
    return NextResponse.json(
      { error: 'Error al obtener plantilla' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/contabilidad/plantillas/[code]
 * Actualizar plantilla (activar/desactivar)
 */
export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const { code } = await params;
    const body = await request.json();

    const { prisma } = await import('@/lib/prisma');

    const template = await prisma.journalEntryTemplate.update({
      where: { code },
      data: {
        isActive: body.isActive,
      },
      include: {
        lines: {
          include: {
            account: true,
          },
          orderBy: { lineNumber: 'asc' },
        },
      },
    });

    return NextResponse.json({
      success: true,
      template,
    });
  } catch (error) {
    console.error('Error updating template:', error);
    return NextResponse.json(
      { error: 'Error al actualizar plantilla' },
      { status: 500 }
    );
  }
}
