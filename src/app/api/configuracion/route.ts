import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'

export async function GET(_request: NextRequest) {
  try {
    const session = await auth()

    if (!session) {
      return NextResponse.json(
        { error: 'No autorizado' },
        { status: 401 }
      )
    }

    const settings = await prisma.companySettings.findFirst()

    if (!settings) {
      return NextResponse.json(
        { error: 'No se encontró configuración de empresa' },
        { status: 404 }
      )
    }

    return NextResponse.json(settings)
  } catch (error) {
    console.error('Error fetching company settings:', error)
    return NextResponse.json(
      { error: 'Error al obtener configuración' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await auth()

    if (!session) {
      return NextResponse.json(
        { error: 'No autorizado' },
        { status: 401 }
      )
    }

    const body = await request.json()

    const settings = await prisma.companySettings.findFirst()

    if (!settings) {
      return NextResponse.json(
        { error: 'No se encontró configuración de empresa' },
        { status: 404 }
      )
    }

    const updated = await prisma.companySettings.update({
      where: { id: settings.id },
      data: body,
    })

    return NextResponse.json(updated)
  } catch (error) {
    console.error('Error updating company settings:', error)
    return NextResponse.json(
      { error: 'Error al actualizar configuración' },
      { status: 500 }
    )
  }
}
