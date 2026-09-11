/**
 * Usuario "Sistema" para registros que crean los procesos automáticos (hoy:
 * facturas de compra que entran desde el mail de facturación). Existe solo
 * porque createdBy es obligatorio; está INACTIVE así nadie puede loguearse
 * con él y no aparece en los selectores de vendedor.
 */

import { randomBytes } from 'crypto'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'

export const SYSTEM_USER_EMAIL = 'sistema@val-ar.com.ar'

let cachedId: string | null = null

export async function getSystemUserId(): Promise<string> {
  if (cachedId) return cachedId

  const existing = await prisma.user.findUnique({ where: { email: SYSTEM_USER_EMAIL }, select: { id: true } })
  if (existing) {
    cachedId = existing.id
    return existing.id
  }

  const created = await prisma.user.create({
    data: {
      name: 'Sistema (automático)',
      email: SYSTEM_USER_EMAIL,
      password: await bcrypt.hash(randomBytes(32).toString('hex'), 10),
      role: 'CONTADOR',
      status: 'INACTIVE',
      isVendedor: false,
    },
    select: { id: true },
  })
  cachedId = created.id
  return created.id
}
