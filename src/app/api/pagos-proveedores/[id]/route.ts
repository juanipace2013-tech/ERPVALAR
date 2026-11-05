/**
 * GET /api/pagos-proveedores/[id] — detalle de una orden de pago.
 * Roles: ADMIN, GERENTE, CONTADOR.
 */
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole, ROLES } from '@/lib/authz'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const forbidden = requireRole(session, ROLES.FINANZAS)
  if (forbidden) return forbidden

  const { id } = await params
  const o = await prisma.supplierPaymentOrder.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true, legalName: true, taxId: true } },
      createdBy: { select: { name: true } },
      applications: { orderBy: { invoiceNumber: 'asc' } },
      media: true,
    },
  })
  if (!o) return NextResponse.json({ error: 'Orden no encontrada' }, { status: 404 })
  return NextResponse.json({
    id: o.id,
    fecha: o.paymentDate.toISOString().slice(0, 10),
    estado: o.status,
    numero: o.paymentNumber,
    colppyPaymentId: o.colppyPaymentId,
    proveedor: { id: o.supplier.id, nombre: o.supplier.legalName || o.supplier.name, cuit: o.supplier.taxId },
    totalFacturas: Number(o.invoicesTotal),
    retencion: {
      regimen: o.retentionRegime,
      base: Number(o.retentionBase),
      importe: Number(o.retentionAmount),
      calculada: Number(o.retentionCalc),
    },
    totalPagado: Number(o.totalPaid),
    descripcion: o.description,
    error: o.lastError,
    registradaEl: o.registeredAt?.toISOString() ?? null,
    creadaPor: o.createdBy.name,
    creadaEl: o.createdAt.toISOString(),
    facturas: o.applications.map((a) => ({
      idFacturaColppy: a.colppyInvoiceId,
      numero: a.invoiceNumber,
      total: Number(a.invoiceTotal),
      saldoAnterior: Number(a.previousBalance),
      importe: Number(a.amount),
      neto: Number(a.netAmount),
      purchaseInvoiceId: a.purchaseInvoiceId,
    })),
    medios: o.media.map((m) => ({
      medio: m.method,
      cuenta: m.accountName,
      cuentaContable: m.accountCode,
      importe: Number(m.amount),
      cheque: m.chequeNumber ? { numero: m.chequeNumber, fecha: m.chequeDate?.toISOString().slice(0, 10) ?? null } : null,
    })),
  })
}
