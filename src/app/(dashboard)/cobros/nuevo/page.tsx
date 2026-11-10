import { redirect } from 'next/navigation'

/**
 * La carga de cobros vive en /cobros (lista de clientes + "Agregar cobro").
 * Se mantiene esta ruta para los enlaces viejos (?cliente=<id>).
 */
export default async function NuevoCobroPage({ searchParams }: { searchParams: Promise<{ cliente?: string }> }) {
  const { cliente } = await searchParams
  redirect(cliente ? `/cobros?cliente=${encodeURIComponent(cliente)}` : '/cobros')
}
