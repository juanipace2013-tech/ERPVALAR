import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim();

    if (!q || q.length < 2) {
      return NextResponse.json([]);
    }

    // Buscar en clientes y proveedores en paralelo
    const [customers, suppliers] = await Promise.all([
      prisma.customer.findMany({
        where: {
          status: 'ACTIVE',
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { businessName: { contains: q, mode: 'insensitive' } },
            { cuit: { contains: q, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          name: true,
          businessName: true,
          cuit: true,
        },
        take: 10,
        orderBy: { name: 'asc' },
      }),
      prisma.supplier.findMany({
        where: {
          status: 'ACTIVE',
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { legalName: { contains: q, mode: 'insensitive' } },
            { taxId: { contains: q, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          name: true,
          legalName: true,
          taxId: true,
        },
        take: 10,
        orderBy: { name: 'asc' },
      }),
    ]);

    // Unificar resultados con tipo
    const results = [
      ...customers.map((c) => ({
        id: c.id,
        name: c.name,
        legalName: c.businessName,
        taxId: c.cuit,
        type: 'CUSTOMER' as const,
      })),
      ...suppliers.map((s) => ({
        id: s.id,
        name: s.name,
        legalName: s.legalName,
        taxId: s.taxId,
        type: 'SUPPLIER' as const,
      })),
    ];

    // Ordenar: primero los que empiezan con la búsqueda, luego el resto
    results.sort((a, b) => {
      const aStartsWith = a.name.toLowerCase().startsWith(q.toLowerCase()) ? 0 : 1;
      const bStartsWith = b.name.toLowerCase().startsWith(q.toLowerCase()) ? 0 : 1;
      if (aStartsWith !== bStartsWith) return aStartsWith - bStartsWith;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json(results.slice(0, 10));
  } catch (error) {
    logger.error('Error searching entities:', error);
    return NextResponse.json(
      { error: 'Error al buscar' },
      { status: 500 }
    );
  }
}
