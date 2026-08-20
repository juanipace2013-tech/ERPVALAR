/**
 * Repara GoogleAdsLead guardados sin datos de contacto: re-parsea el
 * rawPayload con el matching por column_id (el webhook viejo buscaba solo
 * por column_name y los payloads reales de Google venían con "Full Name",
 * "User Email", etc., dejando los campos en null).
 *
 * Uso (en el VPS): npx tsx scripts/fix-google-ads-leads.ts [--apply]
 * Sin --apply es dry-run.
 */

import { prisma } from '../src/lib/prisma'

interface UserColumnData {
  column_name?: string
  string_value?: string
  column_id?: string
}

function normalizeColumnKey(s: string): string {
  return s.trim().toUpperCase().replace(/[\s-]+/g, '_')
}

function pickColumn(
  columns: UserColumnData[] | undefined,
  name: string
): string | undefined {
  if (!columns) return undefined
  const wanted = normalizeColumnKey(name)
  const match = columns.find(
    (c) =>
      (c.column_id && normalizeColumnKey(c.column_id) === wanted) ||
      (c.column_name && normalizeColumnKey(c.column_name) === wanted)
  )
  return match?.string_value?.trim() || undefined
}

const STANDARD_COLUMN_IDS = new Set([
  'FULL_NAME',
  'FIRST_NAME',
  'LAST_NAME',
  'EMAIL',
  'WORK_EMAIL',
  'PHONE_NUMBER',
  'PHONE_NUMBER_VERIFIED',
  'COMPANY_NAME',
  'REGION',
  'CITY',
  'COUNTRY',
  'POSTAL_CODE',
  'JOB_TITLE',
  'MESSAGE',
  'COMMENTS',
])

function pickCustomQuestions(
  columns: UserColumnData[] | undefined
): string | undefined {
  if (!columns) return undefined
  const parts = columns
    .filter((c) => {
      const key = c.column_id ? normalizeColumnKey(c.column_id) : ''
      return key && !STANDARD_COLUMN_IDS.has(key) && c.string_value?.trim()
    })
    .map((c) =>
      c.column_name
        ? `${c.column_name.trim()}: ${c.string_value!.trim()}`
        : c.string_value!.trim()
    )
  return parts.length ? parts.join('\n') : undefined
}

async function main() {
  const apply = process.argv.includes('--apply')

  const leads = await prisma.googleAdsLead.findMany({
    where: { fullName: null, email: null, phone: null },
  })

  console.log(`${leads.length} leads sin datos de contacto${apply ? '' : ' (dry-run, usar --apply para escribir)'}`)

  for (const lead of leads) {
    const payload = lead.rawPayload as {
      user_column_data?: UserColumnData[]
    } | null
    const columns = payload?.user_column_data
    if (!columns?.length) {
      console.log(`- ${lead.id}: rawPayload sin user_column_data, se saltea`)
      continue
    }

    const fullName =
      pickColumn(columns, 'FULL_NAME') ||
      [pickColumn(columns, 'FIRST_NAME'), pickColumn(columns, 'LAST_NAME')]
        .filter(Boolean)
        .join(' ') ||
      undefined
    const email = (
      pickColumn(columns, 'EMAIL') || pickColumn(columns, 'WORK_EMAIL')
    )?.toLowerCase()
    const phone = pickColumn(columns, 'PHONE_NUMBER')
    const companyName = pickColumn(columns, 'COMPANY_NAME')
    const message =
      [
        pickColumn(columns, 'MESSAGE') || pickColumn(columns, 'COMMENTS'),
        pickCustomQuestions(columns),
      ]
        .filter(Boolean)
        .join('\n') || undefined

    if (!fullName && !email && !phone) {
      console.log(`- ${lead.id}: payload sin datos de contacto, se saltea`)
      continue
    }

    // Vincular a Customer existente igual que el webhook.
    let customerId = lead.customerId ?? undefined
    if (!customerId && (email || phone)) {
      const or: Array<Record<string, string>> = []
      if (email) or.push({ email })
      if (phone) or.push({ phone }, { mobile: phone })
      const existing = await prisma.customer.findFirst({
        where: { OR: or },
        select: { id: true },
      })
      customerId = existing?.id
    }

    console.log(
      `- ${lead.id}: ${fullName ?? '—'} | ${email ?? '—'} | ${phone ?? '—'} | ${companyName ?? '—'}${customerId ? ` | customer=${customerId}` : ''}`
    )

    if (apply) {
      await prisma.googleAdsLead.update({
        where: { id: lead.id },
        data: {
          fullName: fullName || null,
          email: email || null,
          phone: phone || null,
          companyName: companyName || null,
          message: message || null,
          customerId: customerId || null,
        },
      })
    }
  }

  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
