/**
 * Import del stock semanal de WINTERS (planilla "Stock WINAR ...xlsx") desde
 * el mail que manda amarcon@winters.com todos los lunes a WINTERS_STOCK_MAILBOX.
 *
 * Barrido por polling (cron ingest-stock-winters): toma el mail más nuevo de
 * @winters.com con "stock winar" en el asunto y un xlsx adjunto. Si ya se
 * importó (winters_stock_imports) no hace nada; si es nuevo, reemplaza la
 * tabla winters_stock completa — la planilla es el stock disponible total,
 * así que un código ausente pasa a "sin stock local".
 *
 * La fecha "al DD/MM/YYYY" sale del asunto (el nombre del archivo a veces
 * viene con el año mal tipeado, ej. "Stock WINAR 2027-08-03.xlsx" en un mail
 * de agosto 2026).
 */

import * as XLSX from 'xlsx'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { listMessagesSince, listAttachments, downloadAttachment } from '@/lib/inbox/graph-mail'

const DEFAULT_LOOKBACK_DAYS = 30
const SENDER_DOMAIN = '@winters.com'
const SUBJECT_PATTERN = /stock\s+winar/i

// Encabezados esperados de la planilla (hoja única)
const COL_CODIGO = 'Número de artículo'
const COL_CANTIDAD = 'Cant. disponible'
const COL_DESCRIPCION = 'Descripción artículo'

export interface WintersIngestResult {
  completedAt: string
  mailbox: string
  since: string
  messagesScanned: number
  outcome: 'IMPORTED' | 'ALREADY_IMPORTED' | 'NO_MAIL' | 'NO_XLSX'
  subject?: string
  receivedAt?: string
  attachment?: string
  fechaLista?: string
  rows?: number
  matchedSkus?: number
  duration: string
}

export async function ingestStockWinters(opts: { lookbackDays?: number } = {}): Promise<WintersIngestResult> {
  const startTime = Date.now()
  const mailbox = process.env.WINTERS_STOCK_MAILBOX
  if (!mailbox) throw new Error('WINTERS_STOCK_MAILBOX no configurada (UPN de la casilla que recibe el stock WINAR)')

  const lookbackDays = opts.lookbackDays ?? (Number(process.env.WINTERS_STOCK_LOOKBACK_DAYS) || DEFAULT_LOOKBACK_DAYS)
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)

  const messages = await listMessagesSince(mailbox, since)
  const base = {
    mailbox,
    since: since.toISOString(),
    messagesScanned: messages.length,
  }
  const done = (extra: Omit<WintersIngestResult, 'completedAt' | 'duration' | keyof typeof base>): WintersIngestResult => ({
    completedAt: new Date().toISOString(),
    ...base,
    ...extra,
    duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
  })

  // Solo interesa el más nuevo: cada planilla reemplaza a la anterior entera
  const candidates = messages
    .filter(
      (m) =>
        (m.from?.emailAddress?.address || '').toLowerCase().endsWith(SENDER_DOMAIN) &&
        SUBJECT_PATTERN.test(m.subject || '') &&
        m.hasAttachments
    )
    .sort((a, b) => (b.receivedDateTime || '').localeCompare(a.receivedDateTime || ''))

  const message = candidates[0]
  if (!message) return done({ outcome: 'NO_MAIL' })

  const messageKey = message.internetMessageId || message.id
  const already = await prisma.wintersStockImport.findUnique({ where: { messageKey }, select: { status: true } })
  if (already?.status === 'OK') {
    return done({ outcome: 'ALREADY_IMPORTED', subject: message.subject ?? undefined, receivedAt: message.receivedDateTime })
  }

  const attachments = await listAttachments(mailbox, message.id)
  const xlsx = attachments.find(
    (a) =>
      (a['@odata.type'] ?? '#microsoft.graph.fileAttachment') === '#microsoft.graph.fileAttachment' &&
      !a.isInline &&
      /\.xlsx?$/i.test(a.name)
  )
  if (!xlsx) return done({ outcome: 'NO_XLSX', subject: message.subject ?? undefined, receivedAt: message.receivedDateTime })

  const receivedAt = message.receivedDateTime ? new Date(message.receivedDateTime) : new Date()
  const fechaLista = fechaFromSubject(message.subject) ?? receivedAt

  try {
    const buffer = await downloadAttachment(mailbox, message.id, xlsx.id)
    const rows = parseStockXlsx(buffer)
    if (rows.length === 0) throw new Error(`El xlsx "${xlsx.name}" no tiene filas con código y cantidad (¿cambió el formato?)`)

    await prisma.$transaction([
      prisma.wintersStock.deleteMany({}),
      prisma.wintersStock.createMany({
        data: rows.map((r) => ({ codigo: r.codigo, cantidad: r.cantidad, descripcion: r.descripcion, fechaLista })),
      }),
      prisma.wintersStockImport.upsert({
        where: { messageKey },
        create: {
          mailbox,
          messageKey,
          fromAddress: message.from?.emailAddress?.address?.toLowerCase() ?? '',
          subject: message.subject ?? null,
          receivedAt,
          attachmentName: xlsx.name,
          fechaLista,
          rows: rows.length,
          status: 'OK',
        },
        update: { attachmentName: xlsx.name, fechaLista, rows: rows.length, status: 'OK', detail: null },
      }),
    ])

    const matched = await prisma.product.count({ where: { sku: { in: rows.map((r) => r.codigo) } } })
    logger.info(
      `[ingest-stock-winters] Importada "${xlsx.name}" (${message.subject}): ${rows.length} códigos, ${matched} matchean SKU`
    )
    return done({
      outcome: 'IMPORTED',
      subject: message.subject ?? undefined,
      receivedAt: message.receivedDateTime,
      attachment: xlsx.name,
      fechaLista: fechaLista.toISOString(),
      rows: rows.length,
      matchedSkus: matched,
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    await prisma.wintersStockImport
      .upsert({
        where: { messageKey },
        create: {
          mailbox,
          messageKey,
          fromAddress: message.from?.emailAddress?.address?.toLowerCase() ?? '',
          subject: message.subject ?? null,
          receivedAt,
          attachmentName: xlsx.name,
          fechaLista,
          rows: 0,
          status: 'ERROR',
          detail,
        },
        update: { status: 'ERROR', detail },
      })
      .catch((e) => logger.error('[ingest-stock-winters] No se pudo registrar el error', e))
    throw err
  }
}

/** "WINTERS INSTRUMENTS SA // STOCK WINAR I al 14/09/2026" → 2026-09-14 (12:00 UTC, como fecha calendario) */
export function fechaFromSubject(subject: string | undefined | null): Date | null {
  const m = (subject || '').match(/al\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i)
  if (!m) return null
  const [, d, mo, y] = m
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), 12))
  return isNaN(date.getTime()) ? null : date
}

export function parseStockXlsx(buffer: Buffer): Array<{ codigo: string; cantidad: number; descripcion: string | null }> {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) return []
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null })

  const seen = new Set<string>()
  const rows: Array<{ codigo: string; cantidad: number; descripcion: string | null }> = []
  for (const r of raw) {
    const codigo = String(r[COL_CODIGO] ?? '').trim()
    const cantidad = Number(r[COL_CANTIDAD])
    if (!codigo || !Number.isFinite(cantidad) || seen.has(codigo)) continue
    seen.add(codigo)
    const descripcion = r[COL_DESCRIPCION] == null ? null : String(r[COL_DESCRIPCION]).trim() || null
    rows.push({ codigo, cantidad: Math.trunc(cantidad), descripcion })
  }
  return rows
}
