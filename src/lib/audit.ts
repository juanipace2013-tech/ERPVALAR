import { prisma } from '@/lib/prisma'
import { headers } from 'next/headers'

interface AuditLogParams {
  userId: string
  userName: string
  userEmail: string
  action: string
  entity: string
  entityId?: string
  entityRef?: string
  description: string
}

/**
 * Registra un log de auditoría de forma asíncrona (no bloquea el response).
 * Si falla, solo loguea el error sin afectar la operación principal.
 */
export function logAudit(params: AuditLogParams) {
  // Capturar IP del request antes de ir async
  getClientIp().then((ip) => {
    prisma.auditLog
      .create({
        data: {
          userId: params.userId,
          userName: params.userName,
          userEmail: params.userEmail,
          action: params.action,
          entity: params.entity,
          entityId: params.entityId || null,
          entityRef: params.entityRef || null,
          description: params.description,
          ip,
        },
      })
      .catch((error) => {
        console.error('[Audit] Error al registrar log:', error)
      })
  })
}

async function getClientIp(): Promise<string | null> {
  try {
    const hdrs = await headers()
    return (
      hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      hdrs.get('x-real-ip') ||
      null
    )
  } catch {
    return null
  }
}
