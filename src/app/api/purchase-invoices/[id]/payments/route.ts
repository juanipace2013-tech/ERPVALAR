import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import { registerPurchasePayment } from '@/lib/payment-accounting';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    const { amount, paymentDate, paymentMethod, reference, notes } = body;

    // Validations
    if (!amount || amount <= 0) {
      return NextResponse.json(
        { error: 'El monto debe ser mayor a cero' },
        { status: 400 }
      );
    }

    if (!paymentMethod) {
      return NextResponse.json(
        { error: 'El método de pago es requerido' },
        { status: 400 }
      );
    }

    // Register payment
    const result = await registerPurchasePayment({
      purchaseInvoiceId: id,
      amount: Number(amount),
      paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
      paymentMethod,
      reference,
      notes,
      userId: session.user.id,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error: any) {
    console.error('Error registering payment:', error);
    return NextResponse.json(
      { error: error.message || 'Error al registrar pago' },
      { status: 500 }
    );
  }
}
