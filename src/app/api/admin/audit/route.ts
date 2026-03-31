import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getLocalDateString } from '@/lib/utils'
import { logger } from '@/lib/logger'

/**
 * GET /api/admin/audit
 * Lista logs de auditoría con filtros y paginación (solo ADMIN)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const ALLOWED_EMAILS = ['stejedor@val-ar.com.ar', 'jpace@val-ar.com.ar']
    if (!ALLOWED_EMAILS.includes(session.user.email || '')) {
      return NextResponse.json({ error: 'Acceso restringido' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '50')
    const entity = searchParams.get('entity')
    const userId = searchParams.get('userId')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const search = searchParams.get('search')
    const format = searchParams.get('format') // 'csv' para exportar

    const where: Record<string, unknown> = {}

    if (entity && entity !== 'ALL') {
      where.entity = entity
    }

    if (userId && userId !== 'ALL') {
      where.userId = userId
    }

    if (dateFrom || dateTo) {
      const dateFilter: Record<string, Date> = {}
      if (dateFrom) dateFilter.gte = new Date(dateFrom)
      if (dateTo) {
        const endDate = new Date(dateTo)
        endDate.setHours(23, 59, 59, 999)
        dateFilter.lte = endDate
      }
      where.createdAt = dateFilter
    }

    if (search) {
      where.OR = [
        { description: { contains: search, mode: 'insensitive' } },
        { entityRef: { contains: search, mode: 'insensitive' } },
        { userName: { contains: search, mode: 'insensitive' } },
      ]
    }

    // Exportar CSV
    if (format === 'csv') {
      const allLogs = await prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 10000, // máximo 10k para CSV
      })

      const csvHeader = 'Fecha,Usuario,Email,Acción,Entidad,Referencia,Descripción,IP\n'
      const csvRows = allLogs.map((log) => {
        const date = new Date(log.createdAt).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })
        return [
          `"${date}"`,
          `"${log.userName}"`,
          `"${log.userEmail}"`,
          `"${log.action}"`,
          `"${log.entity}"`,
          `"${log.entityRef || ''}"`,
          `"${log.description.replace(/"/g, '""')}"`,
          `"${log.ip || ''}"`,
        ].join(',')
      })

      const csv = csvHeader + csvRows.join('\n')

      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="auditoria_${getLocalDateString()}.csv"`,
        },
      })
    }

    // Paginación normal
    const skip = (page - 1) * pageSize

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.auditLog.count({ where }),
    ])

    // Obtener usuarios únicos para el filtro
    const users = await prisma.auditLog.findMany({
      select: { userId: true, userName: true },
      distinct: ['userId'],
      orderBy: { userName: 'asc' },
    })

    return NextResponse.json({
      logs,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
      users,
    })
  } catch (error) {
    logger.error('Error fetching audit logs:', error)
    return NextResponse.json(
      { error: 'Error al obtener logs de auditoría' },
      { status: 500 }
    )
  }
}
