import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    // Obtener todas las cuentas
    const allAccounts = await prisma.chartOfAccount.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });

    // Construir árbol jerárquico
    const buildTree = (parentId: string | null): any[] => {
      return allAccounts
        .filter(acc => acc.parentId === parentId)
        .map(acc => ({
          ...acc,
          debitBalance: Number(acc.debitBalance),
          creditBalance: Number(acc.creditBalance),
          children: buildTree(acc.id),
        }));
    };

    const tree = buildTree(null);
    return NextResponse.json(tree);
  } catch (error) {
    console.error('Error fetching chart of accounts:', error);
    return NextResponse.json(
      { error: 'Error al cargar el plan de cuentas' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await (await import('@/auth')).auth();
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const data = await request.json();

    // Verificar que el código no exista
    const existing = await prisma.chartOfAccount.findUnique({
      where: { code: data.code },
    });

    if (existing) {
      return NextResponse.json(
        { error: `Ya existe una cuenta con el código ${data.code}` },
        { status: 400 }
      );
    }

    // Calcular nivel basado en el código (contar puntos)
    const level = (data.code.match(/\./g) || []).length + 1;

    // Buscar cuenta padre si el código sugiere jerarquía
    let parentId = null;
    if (level > 1) {
      const parentCode = data.code.substring(0, data.code.lastIndexOf('.'));
      const parent = await prisma.chartOfAccount.findUnique({
        where: { code: parentCode },
        select: { id: true },
      });
      if (parent) {
        parentId = parent.id;
      }
    }

    const account = await prisma.chartOfAccount.create({
      data: {
        code: data.code,
        name: data.name,
        accountType: data.accountType,
        category: data.category || null,
        level,
        isDetailAccount: data.isDetailAccount || false,
        acceptsEntries: data.acceptsEntries !== undefined ? data.acceptsEntries : data.isDetailAccount,
        parentId: parentId || data.parentId,
        isActive: true,
        debitBalance: 0,
        creditBalance: 0,
      },
    });

    return NextResponse.json(account, { status: 201 });
  } catch (error) {
    console.error('Error creating account:', error);
    return NextResponse.json(
      { error: 'Error al crear la cuenta' },
      { status: 500 }
    );
  }
}
