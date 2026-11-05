'use client'

/**
 * Nueva factura de compra. El formulario vive en
 * src/components/proveedores/NuevaFacturaCompraForm.tsx (también se usa
 * embebido en el panel del proveedor).
 *
 * Deep link: ?proveedor=<supplierId> preselecciona el proveedor.
 */
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import NuevaFacturaCompraForm from '@/components/proveedores/NuevaFacturaCompraForm'

function NuevaFacturaConParametros() {
  const proveedorId = useSearchParams().get('proveedor') || undefined
  return <NuevaFacturaCompraForm key={proveedorId ?? ''} proveedorInicialId={proveedorId} />
}

export default function NewPurchaseInvoicePage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center p-12 text-muted-foreground">Cargando…</div>}>
      <NuevaFacturaConParametros />
    </Suspense>
  )
}
