/**
 * API Endpoint: /api/contabilidad/plantillas
 * Gestión de plantillas de asientos contables
 */

import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validateTemplate } from '@/lib/contabilidad/apply-template';

/**
 * GET /api/contabilidad/plantillas
 * Listar todas las plantillas
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const isActive = searchParams.get('isActive');
    const triggerType = searchParams.get('triggerType');

    // Build filters
    const where: Record<string, unknown> = {};

    if (isActive !== null) {
      where.isActive = isActive === 'true';
    }

    if (triggerType) {
      where.triggerType = triggerType;
    }

    const templates = await prisma.journalEntryTemplate.findMany({
      where,
      include: {
        lines: {
          include: {
            account: {
              select: {
                id: true,
                code: true,
                name: true,
                accountType: true,
              },
            },
          },
          orderBy: { lineNumber: 'asc' },
        },
      },
      orderBy: {
        code: 'asc',
      },
    });

    return NextResponse.json({ templates });
  } catch (error) {
    console.error('Error fetching templates:', error);
    return NextResponse.json(
      { error: 'Error al obtener plantillas' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/contabilidad/plantillas
 * Crear nueva plantilla (para futuro)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    // TODO: Implementar creación de plantillas
    return NextResponse.json(
      { error: 'Funcionalidad no implementada aún' },
      { status: 501 }
    );
  } catch (error) {
    console.error('Error creating template:', error);
    return NextResponse.json(
      { error: 'Error al crear plantilla' },
      { status: 500 }
    );
  }
}
