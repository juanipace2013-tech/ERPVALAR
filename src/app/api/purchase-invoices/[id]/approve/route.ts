import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import { approvePurchaseInvoice } from '@/lib/purchase-accounting';

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

    // Aprobar factura (genera asiento e impacta inventario)
    const approvedInvoice = await approvePurchaseInvoice(id);

    return NextResponse.json(approvedInvoice);
  } catch (error: any) {
    console.error('Error approving purchase invoice:', error);
    return NextResponse.json(
      { error: error.message || 'Error al aprobar factura de compra' },
      { status: 500 }
    );
  }
}
