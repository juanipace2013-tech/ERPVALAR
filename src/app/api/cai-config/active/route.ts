import { auth } from '@/auth'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const config = await prisma.caiConfig.findFirst({
      where: { active: true },
      orderBy: { createdAt: 'desc' },
    })

    if (!config) {
      return NextResponse.json({ config: null, warnings: [] })
    }

    const warnings: string[] = []
    const now = new Date()
    const daysToExpiration = Math.ceil(
      (config.caiExpirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    )
    const usedRange = config.lastUsedNumber - config.startNumber + 1
    const totalRange = config.endNumber - config.startNumber + 1
    const usagePercent = totalRange > 0 ? (usedRange / totalRange) * 100 : 0

    if (daysToExpiration < 0) {
      warnings.push(`CAI vencido desde hace ${Math.abs(daysToExpiration)} días`)
    } else if (daysToExpiration <= 30) {
      warnings.push(`CAI vence en ${daysToExpiration} días (${config.caiExpirationDate.toLocaleDateString('es-AR')})`)
    }

    if (config.lastUsedNumber >= config.endNumber) {
      warnings.push('Se agotó el rango de numeración del CAI')
    } else if (usagePercent >= 80) {
      warnings.push(`Se usó el ${usagePercent.toFixed(0)}% del rango de numeración (${config.lastUsedNumber}/${config.endNumber})`)
    }

    return NextResponse.json({
      config,
      warnings,
      daysToExpiration,
      usagePercent,
    })
  } catch (error) {
    console.error('Error fetching active CAI:', error)
    return NextResponse.json({ error: 'Error al obtener CAI activo' }, { status: 500 })
  }
}
