import { logger } from '@/lib/logger'
import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { VENDEDOR_SELECCIONABLE } from '@/lib/vendedores'

/**
 * GET /api/users
 * Listar usuarios activos (para selectores).
 *
 * ?vendedores=true limita el listado a vendedores seleccionables. Lo usan los
 * selectores y filtros de vendedor; sin el flag se devuelven todos los usuarios
 * activos (ej: el selector de "Comprador asignado" de proveedores, que no es un
 * vendedor).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const role = searchParams.get('role') || ''
    const soloVendedores = searchParams.get('vendedores') === 'true'

    const where: Record<string, unknown> = soloVendedores
      ? { ...VENDEDOR_SELECCIONABLE }
      : { status: 'ACTIVE' }

    if (role) {
      where.role = role
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
      orderBy: {
        name: 'asc',
      },
    })

    return NextResponse.json({ users })
  } catch (error) {
    logger.error('Error fetching users:', error)
    return NextResponse.json(
      { error: 'Error al obtener usuarios' },
      { status: 500 }
    )
  }
}
