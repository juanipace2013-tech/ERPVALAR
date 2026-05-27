/**
 * Matching de teléfonos / emails entrantes contra Customers y Contacts del CRM.
 *
 * Los teléfonos del CRM no están normalizados (ver phone.ts). Hacemos el
 * match en memoria: traemos todos los teléfonos posibles y comparamos por
 * `phoneMatchKey`. Para escalas chicas (pocos miles de contactos) está bien;
 * si la base crece habrá que precomputar y persistir la key normalizada.
 */

import { prisma } from '@/lib/prisma'
import { phoneMatchKey } from './phone'

export interface MatchedContact {
  customerId: string | null
  contactId: string | null
  displayName: string | null
}

/** Matchea un email entrante con un Customer/Contact. */
export async function matchByEmail(email: string): Promise<MatchedContact> {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return { customerId: null, contactId: null, displayName: null }

  // Buscar primero en Contact (más específico)
  const contact = await prisma.contact.findFirst({
    where: { email: { equals: normalized, mode: 'insensitive' } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      customerId: true,
      customer: { select: { name: true } },
    },
  })
  if (contact) {
    return {
      customerId: contact.customerId,
      contactId: contact.id,
      displayName: `${contact.firstName} ${contact.lastName}`.trim() || contact.customer?.name || null,
    }
  }

  // Después en Customer
  const customer = await prisma.customer.findFirst({
    where: { email: { equals: normalized, mode: 'insensitive' } },
    select: { id: true, name: true },
  })
  if (customer) {
    return { customerId: customer.id, contactId: null, displayName: customer.name }
  }

  return { customerId: null, contactId: null, displayName: null }
}

/**
 * Matchea un teléfono entrante (formato libre — típicamente E.164 sin "+")
 * contra Customers/Contacts.
 *
 * NOTA: itera en memoria sobre todos los contactos con teléfono. Para
 * volúmenes grandes habría que persistir un `phoneKey` en BD y consultar
 * directamente.
 */
export async function matchByPhone(phone: string): Promise<MatchedContact> {
  const incomingKey = phoneMatchKey(phone)
  if (!incomingKey) return { customerId: null, contactId: null, displayName: null }

  // Contacts con cualquier número
  const contacts = await prisma.contact.findMany({
    where: {
      OR: [{ phone: { not: null } }, { mobile: { not: null } }],
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      mobile: true,
      customerId: true,
      customer: { select: { name: true } },
    },
  })

  for (const c of contacts) {
    const keys = [phoneMatchKey(c.phone), phoneMatchKey(c.mobile)]
    if (keys.includes(incomingKey)) {
      return {
        customerId: c.customerId,
        contactId: c.id,
        displayName: `${c.firstName} ${c.lastName}`.trim() || c.customer?.name || null,
      }
    }
  }

  // Customers
  const customers = await prisma.customer.findMany({
    where: {
      OR: [{ phone: { not: null } }, { mobile: { not: null } }],
    },
    select: { id: true, name: true, phone: true, mobile: true },
  })

  for (const c of customers) {
    const keys = [phoneMatchKey(c.phone), phoneMatchKey(c.mobile)]
    if (keys.includes(incomingKey)) {
      return { customerId: c.id, contactId: null, displayName: c.name }
    }
  }

  return { customerId: null, contactId: null, displayName: null }
}
