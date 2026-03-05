import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * POST /api/clientes/asignar-vendedores
 * Asignación masiva de vendedores a clientes por CUIT + email del vendedor.
 * Recibe un array de { cuit, vendedorEmail } y retorna resumen.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json()
    const assignments: { cuit: string; vendedorEmail: string }[] = body.assignments || []

    if (assignments.length === 0) {
      return NextResponse.json(
        { error: 'No se recibieron asignaciones' },
        { status: 400 }
      )
    }

    // Pre-cargar todos los usuarios en un Map por email (lowercase)
    const allUsers = await prisma.user.findMany({
      select: { id: true, name: true, email: true },
    })
    const usersByEmail = new Map(
      allUsers.map((u) => [u.email.toLowerCase(), u])
    )

    // Resultados
    let asignados = 0
    const noEncontrados: string[] = [] // CUITs sin cliente
    const vendedorNoEncontrado: string[] = [] // Emails sin usuario
    const errores: { cuit: string; error: string }[] = []

    for (const { cuit, vendedorEmail } of assignments) {
      try {
        // Normalizar CUIT
        const normalizedCuit = cuit.replace(/\D/g, '')
        if (normalizedCuit.length !== 11) {
          errores.push({ cuit, error: 'CUIT inválido (debe tener 11 dígitos)' })
          continue
        }

        // Buscar vendedor por email
        const user = usersByEmail.get(vendedorEmail.toLowerCase().trim())
        if (!user) {
          vendedorNoEncontrado.push(vendedorEmail)
          errores.push({ cuit, error: `Vendedor no encontrado: ${vendedorEmail}` })
          continue
        }

        // Buscar cliente por CUIT (ambos formatos)
        const formattedCuit = `${normalizedCuit.slice(0, 2)}-${normalizedCuit.slice(2, 10)}-${normalizedCuit.slice(10)}`

        let customer = await prisma.customer.findFirst({
          where: {
            OR: [
              { cuit: normalizedCuit },
              { cuit: formattedCuit },
              { cuit: { contains: normalizedCuit } },
            ],
          },
          select: { id: true },
        })

        if (customer) {
          // Actualizar vendedor
          await prisma.customer.update({
            where: { id: customer.id },
            data: { salesPersonId: user.id },
          })
          asignados++
        } else {
          // Crear registro mínimo
          await prisma.customer.create({
            data: {
              name: formattedCuit,
              cuit: normalizedCuit,
              taxCondition: 'RESPONSABLE_INSCRIPTO',
              salesPersonId: user.id,
            },
          })
          asignados++
        }
      } catch (err: any) {
        errores.push({ cuit, error: err.message || 'Error desconocido' })
      }
    }

    // Deduplicar vendedorNoEncontrado
    const uniqueVendedorNoEncontrado = [...new Set(vendedorNoEncontrado)]

    return NextResponse.json({
      total: assignments.length,
      asignados,
      noEncontrados,
      vendedorNoEncontrado: uniqueVendedorNoEncontrado,
      errores,
    })
  } catch (error: any) {
    console.error('Error bulk assigning salespersons:', error)
    return NextResponse.json(
      { error: error.message || 'Error al asignar vendedores' },
      { status: 500 }
    )
  }
}
