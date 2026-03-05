import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Permitir body grande (hasta 10MB) para archivos con muchas filas
export const maxDuration = 60 // seconds (Vercel/serverless)

/**
 * POST /api/clientes/asignar-vendedores
 * Asignación masiva de vendedores a clientes por CUIT + email del vendedor.
 * Procesamiento en batch para soportar 1000+ filas sin timeout.
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

    // 2. Normalizar CUITs y agrupar por vendedor
    const cuitInvalidos: string[] = []
    const vendedorNoEncontrado: string[] = []
    const vendedorNoEncontradoSet = new Set<string>()

    // Mapa: vendedorId → Set de CUITs normalizados
    const assignmentsByVendor = new Map<string, Set<string>>()
    // Mapa: CUIT normalizado → CUIT original (para feedback)
    const cuitOriginalMap = new Map<string, string>()

    for (const { cuit, vendedorEmail } of assignments) {
      // Normalizar CUIT: quitar todo lo que no sea dígito
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

      // Agrupar por vendedor
      if (!assignmentsByVendor.has(user.id)) {
        assignmentsByVendor.set(user.id, new Set())
      }
      assignmentsByVendor.get(user.id)!.add(normalizedCuit)
      cuitOriginalMap.set(normalizedCuit, cuit)
    }

    // 3. Recolectar TODOS los CUITs a buscar
    const allCuits = new Set<string>()
    for (const cuits of assignmentsByVendor.values()) {
      for (const c of cuits) allCuits.add(c)
    }

    if (allCuits.size === 0) {
      return NextResponse.json({
        total: assignments.length,
        asignados: 0,
        yaAsignados: 0,
        cuitNoEncontrado: [],
        cuitInvalidos,
        vendedorNoEncontrado,
        errores: [],
      })
    }

    // 4. Buscar TODOS los clientes en UNA sola query
    //    Buscar por CUIT normalizado (sin guiones) y también por formato con guiones
    const allCuitsArray = Array.from(allCuits)
    // Generar también los formatos con guiones: XX-XXXXXXXX-X
    const allCuitsFormatted = allCuitsArray.map(c =>
      `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}`
    )
    const allCuitsToSearch = [...allCuitsArray, ...allCuitsFormatted]

    const customers = await prisma.customer.findMany({
      where: {
        cuit: { in: allCuitsToSearch },
      },
      select: { id: true, cuit: true, salesPersonId: true },
    })

    // Mapa: CUIT normalizado → customer
    const customerByCuit = new Map<string, { id: string; cuit: string; salesPersonId: string | null }>()
    for (const customer of customers) {
      if (customer.cuit) {
        const normalized = customer.cuit.replace(/\D/g, '')
        customerByCuit.set(normalized, customer)
      }
    }

    // 5. Procesar en batch por vendedor usando $transaction
    let asignados = 0
    let yaAsignados = 0
    const cuitNoEncontrado: string[] = []
    const errores: { cuit: string; error: string }[] = []

    for (const [vendorId, cuits] of assignmentsByVendor.entries()) {
      // Separar CUITs encontrados vs no encontrados
      const customerIdsToUpdate: string[] = []
      const alreadyAssigned: string[] = []

      for (const cuit of cuits) {
        const customer = customerByCuit.get(cuit)
        if (!customer) {
          cuitNoEncontrado.push(cuitOriginalMap.get(cuit) || cuit)
          continue
        }

        // Si ya tiene el mismo vendedor asignado, no hacer nada
        if (customer.salesPersonId === vendorId) {
          alreadyAssigned.push(cuit)
          continue
        }

        customerIdsToUpdate.push(customer.id)
      }

      yaAsignados += alreadyAssigned.length

      // Batch update: un solo updateMany por vendedor
      if (customerIdsToUpdate.length > 0) {
        try {
          const result = await prisma.customer.updateMany({
            where: { id: { in: customerIdsToUpdate } },
            data: { salesPersonId: vendorId },
          })
          asignados += result.count
        } catch (err: any) {
          // Si falla el batch, registrar error para cada CUIT
          for (const id of customerIdsToUpdate) {
            const customer = customers.find(c => c.id === id)
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
