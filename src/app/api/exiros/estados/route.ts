import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { requireExirosAgent } from '@/lib/exiros/agent-auth'

// GET /api/exiros/estados — licitaciones todavía gestionables (NUEVA o
// EN_PROCESO, con cierre futuro o sin cierre). El agente las contrasta contra
// el portal: si alguna fue declinada a mano en Exiros, lo reporta con el
// PATCH de /api/exiros/acciones para que el ERP refleje la realidad.
// Auth: Bearer EXIROS_AGENT_API_KEY.

export async function GET(req: NextRequest) {
  const authError = requireExirosAgent(req)
  if (authError) return authError

  try {
    const licitaciones = await prisma.exirosLicitacion.findMany({
      where: {
        // Solo EXIROS: el status_sync del agente verifica contra el portal
        // de Exiros; no sabe consultar Ariba.
        plataforma: 'EXIROS',
        estado: { in: ['NUEVA', 'EN_PROCESO'] },
        OR: [{ cierre: null }, { cierre: { gte: new Date() } }],
      },
      select: { numero: true, idInterno: true, estado: true },
      orderBy: { cierre: 'asc' },
    })
    return NextResponse.json(licitaciones)
  } catch (e) {
    logger.error('[exiros/estados] GET error', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
