import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import { getSupplierAccountStatement } from '@/lib/payment-accounting';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { id } = await params;
    const { searchParams } = new URL(request.url);

    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    const statement = await getSupplierAccountStatement(
      id,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined
    );

    return NextResponse.json(statement);
  } catch (error: any) {
    console.error('Error fetching account statement:', error);
    return NextResponse.json(
      { error: error.message || 'Error al cargar estado de cuenta' },
      { status: 500 }
    );
  }
}
