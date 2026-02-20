import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

interface RouteParams {
  params: Promise<{
    id: string;
  }>;
}

/**
 * PATCH /api/contabilidad/plan-cuentas/[id]
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

    const { id } = await params;
    const data = await request.json();

    const account = await prisma.chartOfAccount.update({
      where: { id },
      data: {
        name: data.name,
        accountType: data.accountType,
        category: data.category || null,
        isDetailAccount: data.isDetailAccount,
        acceptsEntries: data.acceptsEntries,
      },
    });

    return NextResponse.json({ success: true, account });
  } catch (error) {
    console.error('Error updating account:', error);
    return NextResponse.json({ error: 'Error al actualizar cuenta' }, { status: 500 });
  }
}

/**
 * DELETE /api/contabilidad/plan-cuentas/[id]
 */
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const { id } = await params;

    const account = await prisma.chartOfAccount.findUnique({
      where: { id },
      include: {
        children: true,
        journalEntryLines: true,
        journalEntryTemplateLines: true,
      },
    });

    if (!account) {
      return NextResponse.json({ error: 'Cuenta no encontrada' }, { status: 404 });
    }

    if (account.children && account.children.length > 0) {
      return NextResponse.json(
        { error: 'No se puede eliminar una cuenta que tiene subcuentas' },
        { status: 400 }
      );
    }

    if (account.journalEntryLines && account.journalEntryLines.length > 0) {
      return NextResponse.json(
        { error: 'No se puede eliminar una cuenta que tiene asientos contables' },
        { status: 400 }
      );
    }

    if (account.journalEntryTemplateLines && account.journalEntryTemplateLines.length > 0) {
      return NextResponse.json(
        { error: 'No se puede eliminar una cuenta que está en plantillas' },
        { status: 400 }
      );
    }

    await prisma.chartOfAccount.delete({ where: { id } });

    return NextResponse.json({ success: true, message: 'Cuenta eliminada' });
  } catch (error) {
    console.error('Error deleting account:', error);
    return NextResponse.json({ error: 'Error al eliminar cuenta' }, { status: 500 });
  }
}
