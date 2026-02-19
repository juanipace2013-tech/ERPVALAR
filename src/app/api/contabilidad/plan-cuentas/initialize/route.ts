import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'


import { prisma } from '@/lib/prisma'
import { PLAN_CUENTAS_ARGENTINA } from '@/lib/contabilidad/plan-cuentas-argentina'
import { getParentCode } from '@/lib/contabilidad/validations'

// POST /api/contabilidad/plan-cuentas/initialize - Inicializar plan de cuentas
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    // Solo ADMIN o CONTADOR pueden inicializar
    if (!['ADMIN', 'CONTADOR'].includes(session.user.role)) {
      return NextResponse.json(
        { error: 'No tienes permisos para inicializar el plan de cuentas' },
        { status: 403 }
      )
    }

    // Verificar si ya existen cuentas
    const existingCount = await prisma.chartOfAccount.count()
    if (existingCount > 0) {
      return NextResponse.json(
        {
          error: 'Ya existen cuentas en el sistema',
          message: `Hay ${existingCount} cuentas registradas. Elimina las cuentas existentes si deseas reinicializar.`
        },
        { status: 400 }
      )
    }

    // Crear cuentas nivel por nivel para mantener la jerarquía
    const accountsByLevel = PLAN_CUENTAS_ARGENTINA.reduce((acc, account) => {
      if (!acc[account.level]) acc[account.level] = []
      acc[account.level].push(account)
      return acc
    }, {} as Record<number, typeof PLAN_CUENTAS_ARGENTINA>)

    const createdAccounts = new Map<string, string>() // Map de code -> id

    // Procesar nivel por nivel
    for (let level = 1; level <= 4; level++) {
      const accounts = accountsByLevel[level] || []

      if (accounts.length === 0) continue

      for (const account of accounts) {
        try {
          // Buscar el parent ID si es nivel > 1
          let parentId: string | null = null

          if (level > 1) {
            const parentCode = getParentCode(account.code)
            if (parentCode) {
              parentId = createdAccounts.get(parentCode) || null
            }
          }

          const created = await prisma.chartOfAccount.create({
            data: {
              code: account.code,
              name: account.name,
              accountType: account.accountType,
              level: account.level,
              acceptsEntries: account.acceptsEntries,
              parentId,
              isActive: true,
            },
          })

          createdAccounts.set(account.code, created.id)
        } catch (error) {
          console.error(`Error creando cuenta ${account.code} - ${account.name}:`, error)
        }
      }
    }

    const totalCreated = createdAccounts.size

    // Obtener resumen por tipo
    const summary = await prisma.chartOfAccount.groupBy({
      by: ['accountType'],
      _count: true,
    })

    return NextResponse.json({
      success: true,
      count: totalCreated,
      summary: summary.map(item => ({
        type: item.accountType,
        count: item._count,
      })),
      message: `Plan de cuentas creado exitosamente: ${totalCreated} cuentas`,
    })
  } catch (error) {
    console.error('Error initializing chart of accounts:', error)
    return NextResponse.json(
      { error: 'Error al inicializar plan de cuentas' },
      { status: 500 }
    )
  }
}
