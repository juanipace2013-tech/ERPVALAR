import { prisma } from '@/lib/prisma'

/**
 * Búsqueda de clientes por CUIT con o sin guiones: si el texto son solo
 * números (y guiones/puntos/espacios) devuelve los ids cuyo CUIT, sin
 * separadores, contiene esos dígitos ("20184212553" ↔ "20-18421255-3").
 * Devuelve null si el texto no parece un CUIT (no aplica el filtro).
 */
export async function customerIdsPorCuit(texto: string): Promise<string[] | null> {
  const digits = texto.replace(/\D/g, '')
  if (!/^[\d\s.-]+$/.test(texto.trim()) || digits.length < 3) return null
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM customers WHERE regexp_replace(cuit, '[^0-9]', '', 'g') LIKE ${'%' + digits + '%'}
  `
  return rows.map((r) => r.id)
}
