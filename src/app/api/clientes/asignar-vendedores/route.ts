import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Permitir body grande y timeout extendido para archivos con muchas filas
export const maxDuration = 60 // seconds (Vercel/serverless)

/**
 * POST /api/clientes/asignar-vendedores
 * Asignación masiva de vendedores a clientes por CUIT + email del vendedor.
 * Procesamiento en batch para soportar 1000+ filas sin timeout.
 *
 * Normalización de CUIT: quita TODOS los caracteres no numéricos tanto del
 * archivo como de la base de datos, para que "30-71774084-6", "30717740846",
 * "30.71774084.6" etc. todos matcheen correctamente.
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

    if (assignments.length > 5000) {
      return NextResponse.json(
        { error: 'Máximo 5000 filas por importación' },
        { status: 400 }
      )
    }

    // 1. Pre-cargar todos los usuarios en un Map por email (lowercase)
    const allUsers = await prisma.user.findMany({
      select: { id: true, name: true, email: true },
    })
    const usersByEmail = new Map(
      allUsers.map((u) => [u.email.toLowerCase(), u])
    )

    // 2. Pre-cargar TODOS los clientes y construir mapa por CUIT normalizado
    //    Con 476 customers esto es instantáneo y evita problemas de formato
    const allCustomers = await prisma.customer.findMany({
      select: { id: true, cuit: true, salesPersonId: true },
    })
    const customerByCuit = new Map<string, { id: string; cuit: string; salesPersonId: string | null }>()
    for (const customer of allCustomers) {
      if (customer.cuit) {
        // Normalizar: quitar todo lo que no sea dígito
        const normalized = customer.cuit.replace(/\D/g, '')
        customerByCuit.set(normalized, customer)
      }
    }

    // 3. Procesar asignaciones: validar y agrupar por vendedor
    const cuitInvalidos: string[] = []
    const vendedorNoEncontrado: string[] = []
    const vendedorNoEncontradoSet = new Set<string>()

    // Mapa: vendedorId → { customerIds a actualizar, ya asignados, no encontrados }
    const assignmentsByVendor = new Map<string, {
      customerIdsToUpdate: string[]
      alreadyAssigned: number
    }>()
    const cuitNoEncontrado: string[] = []
    let yaAsignados = 0

    for (const { cuit, vendedorEmail } of assignments) {
      // Normalizar CUIT del archivo: quitar todo lo que no sea dígito
      const normalizedCuit = cuit.replace(/\D/g, '')
      if (normalizedCuit.length !== 11) {
        cuitInvalidos.push(cuit)
        continue
      }

      // Buscar vendedor por email
      const email = vendedorEmail.toLowerCase().trim()
      const user = usersByEmail.get(email)
      if (!user) {
        if (!vendedorNoEncontradoSet.has(email)) {
          vendedorNoEncontrado.push(vendedorEmail)
          vendedorNoEncontradoSet.add(email)
        }
        continue
      }

      // Buscar cliente en el mapa normalizado
      const customer = customerByCuit.get(normalizedCuit)
      if (!customer) {
        cuitNoEncontrado.push(cuit)
        continue
      }

      // Si ya tiene el mismo vendedor asignado, no hacer nada
      if (customer.salesPersonId === user.id) {
        yaAsignados++
        continue
      }

      // Agrupar por vendedor para batch update
      if (!assignmentsByVendor.has(user.id)) {
        assignmentsByVendor.set(user.id, { customerIdsToUpdate: [], alreadyAssigned: 0 })
      }
      assignmentsByVendor.get(user.id)!.customerIdsToUpdate.push(customer.id)
    }

    // 4. Ejecutar batch updates: un updateMany por vendedor
    let asignados = 0
    const errores: { cuit: string; error: string }[] = []

    for (const [vendorId, data] of assignmentsByVendor.entries()) {
      if (data.customerIdsToUpdate.length > 0) {
        try {
          const result = await prisma.customer.updateMany({
            where: { id: { in: data.customerIdsToUpdate } },
            data: { salesPersonId: vendorId },
          })
          asignados += result.count
        } catch (err: any) {
          for (const id of data.customerIdsToUpdate) {
            const customer = allCustomers.find(c => c.id === id)
            errores.push({
              cuit: customer?.cuit || id,
              error: err.message || 'Error al actualizar',
            })
          }
        }
      }
    }

    return NextResponse.json({
      total: assignments.length,
      asignados,
      yaAsignados,
      cuitNoEncontrado,
      cuitInvalidos,
      vendedorNoEncontrado,
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
