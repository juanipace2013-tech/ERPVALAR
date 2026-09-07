import { NextResponse } from 'next/server'
import type { Session } from 'next-auth'

/**
 * Autorización por rol para las API routes.
 *
 * Uso típico, justo después del chequeo de sesión:
 *
 *   const forbidden = requireRole(session, ROLES.GESTION)
 *   if (forbidden) return forbidden
 *
 * Los grupos siguen el mapa de roles del Sidebar (src/components/layout/Sidebar.tsx).
 */
export type Role = 'ADMIN' | 'GERENTE' | 'VENDEDOR' | 'CONTADOR'

export const ROLES = {
  /** Solo administradores. */
  ADMIN: ['ADMIN'],
  /** Gerencia: configuración, comisiones, borrado de datos maestros y documentos. */
  GESTION: ['ADMIN', 'GERENTE'],
  /** Operación comercial: cotizaciones, remitos, logística, leads, herramientas. */
  OPERATIVOS: ['ADMIN', 'GERENTE', 'VENDEDOR'],
  /** Finanzas: tipo de cambio, contabilidad. */
  FINANZAS: ['ADMIN', 'GERENTE', 'CONTADOR'],
} as const satisfies Record<string, readonly Role[]>

export function hasRole(session: Session | null | undefined, roles: readonly Role[]): boolean {
  const role = session?.user?.role as Role | undefined
  return !!role && roles.includes(role)
}

/**
 * Devuelve una respuesta 403 si el usuario de la sesión no tiene alguno de
 * los roles pedidos, o null si puede continuar.
 */
export function requireRole(
  session: Session | null | undefined,
  roles: readonly Role[],
  mensaje = 'No tenés permisos para esta acción'
): NextResponse | null {
  if (hasRole(session, roles)) return null
  return NextResponse.json({ error: mensaje }, { status: 403 })
}
