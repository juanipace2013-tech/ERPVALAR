/**
 * GET /api/clientes/export-google-ads
 *
 * Exporta los clientes activos en formato CSV listo para subir a
 * Google Ads → Audiencias → Lista de clientes (Customer Match).
 *
 * Headers requeridos por Google Ads (en inglés, exactos):
 *   Email, Phone, First Name, Last Name, Country, Zip
 *
 * Reglas:
 *   - Solo se exportan clientes con email (sin email no hay matching útil).
 *   - Email en minúsculas, sin espacios.
 *   - Phone normalizado a E.164 (+54...). Vacío si el cliente no tiene teléfono.
 *   - Country = "AR" para todos.
 */

import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const NAME_PREFIXES = new Set(['sr', 'sra', 'srta', 'sr.', 'sra.', 'srta.', 'don', 'dona', 'doña'])

/**
 * Convierte un teléfono a formato E.164 argentino (+54...).
 * Devuelve '' si no hay teléfono o no se puede normalizar.
 */
function toE164AR(phone: string | null | undefined): string {
  if (!phone) return ''
  const trimmed = phone.trim()
  if (!trimmed) return ''

  // Conservar info de '+' inicial, después limpiar todo lo no numérico.
  const hasPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return ''

  // Si ya viene con código de país (54...), respetar.
  if (hasPlus || digits.startsWith('54')) {
    const normalized = digits.startsWith('54') ? digits : `54${digits}`
    return `+${normalized}`
  }

  // Si arranca con 0 (formato local "011-...") sacar el 0.
  const local = digits.startsWith('0') ? digits.slice(1) : digits
  return `+54${local}`
}

/**
 * Toma el nombre/razón social y lo divide en First Name + Last Name,
 * sacando prefijos comunes (Sr/Sra/etc.) y normalizando a minúsculas.
 */
function splitName(name: string | null | undefined): { first: string; last: string } {
  if (!name) return { first: '', last: '' }
  const tokens = name
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t && !NAME_PREFIXES.has(t))

  if (tokens.length === 0) return { first: '', last: '' }
  if (tokens.length === 1) return { first: tokens[0], last: '' }
  return { first: tokens[0], last: tokens.slice(1).join(' ') }
}

/**
 * Escapa un valor para CSV: si contiene coma, comilla o salto de línea,
 * lo encierra en comillas y duplica las internas.
 */
function csvEscape(value: string): string {
  if (value === '') return ''
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const customers = await prisma.customer.findMany({
    where: {
      status: 'ACTIVE',
      email: { not: null },
    },
    select: {
      name: true,
      businessName: true,
      email: true,
      phone: true,
      mobile: true,
      postalCode: true,
    },
  })

  const headers = ['Email', 'Phone', 'First Name', 'Last Name', 'Country', 'Zip']
  const rows: string[] = [headers.join(',')]

  for (const c of customers) {
    const email = (c.email || '').trim().toLowerCase()
    if (!email) continue // Defensive: en teoría el filtro ya descartó vacíos.

    const phone = toE164AR(c.phone || c.mobile)
    const { first, last } = splitName(c.businessName || c.name)
    const zip = (c.postalCode || '').trim()

    rows.push(
      [email, phone, first, last, 'AR', zip].map(csvEscape).join(',')
    )
  }

  // Agregar BOM para que Excel detecte UTF-8 al abrir.
  const csv = '\uFEFF' + rows.join('\r\n') + '\r\n'

  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  const filename = `val-ar-customers-google-ads-${today}.csv`

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
