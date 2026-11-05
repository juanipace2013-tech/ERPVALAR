'use client'

/**
 * Nueva orden de pago a proveedor. El formulario vive en
 * src/components/proveedores/NuevaOrdenPagoForm.tsx (también se usa embebido
 * en el panel del proveedor).
 *
 * Deep link: ?proveedor=<supplierId>&facturas=<idColppy,idColppy> preselecciona
 * el proveedor, trae sus impagas y tilda esas facturas.
 */
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import NuevaOrdenPagoForm, { type ProveedorInicialPago } from '@/components/proveedores/NuevaOrdenPagoForm'

function Cargando() {
  return (
    <div className="flex items-center justify-center p-12 text-muted-foreground">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
      Cargando…
    </div>
  )
}

function NuevaOrdenPagoConParametros() {
  const sp = useSearchParams()
  const proveedorId = sp.get('proveedor') || ''
  const facturas = (sp.get('facturas') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  // Proveedor del deep link: se lee una vez; si falla, se abre sin preseleccionar
  const [inicial, setInicial] = useState<{ id: string; proveedor: ProveedorInicialPago | null } | null>(null)

  useEffect(() => {
    if (!proveedorId) return
    let vigente = true
    fetch(`/api/proveedores/${encodeURIComponent(proveedorId)}`)
      .then(async (r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((d) => {
        if (!vigente) return
        const p =
          d && typeof d.id === 'string'
            ? { id: d.id as string, nombre: String(d.legalName || d.name || ''), cuit: (d.taxId as string | null) ?? null, colppyId: (d.colppyId as string | null) ?? null }
            : null
        setInicial({ id: proveedorId, proveedor: p })
      })
    return () => {
      vigente = false
    }
  }, [proveedorId])

  if (!proveedorId) return <NuevaOrdenPagoForm />
  if (!inicial || inicial.id !== proveedorId) return <Cargando />
  return (
    <NuevaOrdenPagoForm
      key={proveedorId}
      proveedorInicial={inicial.proveedor ?? undefined}
      facturasIniciales={inicial.proveedor ? facturas : undefined}
    />
  )
}

export default function NuevaOrdenPagoPage() {
  return (
    <Suspense fallback={<Cargando />}>
      <NuevaOrdenPagoConParametros />
    </Suspense>
  )
}
