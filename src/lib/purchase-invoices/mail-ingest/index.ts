/**
 * Carga automática de facturas de compra desde la casilla de facturación.
 *
 * Barrido por polling (cron ingest-facturas-mail): lista los mails de los
 * últimos N días de FACTURACION_MAILBOX, se queda con los de remitentes
 * conocidos (senders.ts), baja cada PDF adjunto, lo pasa por el mismo OCR
 * que usa la carga manual y crea la factura con el usuario Sistema.
 *
 * Toda factura que entra por acá queda con requiresReview=true: alguien tiene
 * que abrirla, mirar el PDF y marcarla como revisada antes de mandarla a
 * Colppy. El motivo más específico gana (totales que no cierran > CUIT que no
 * matchea > jurisdicción IIBB > "cargada desde el mail").
 *
 * Cada (mail, adjunto) queda registrado en purchase_invoice_mail_ingests para
 * no procesarlo dos veces; los ERROR se reintentan hasta MAX_ATTEMPTS.
 */

import { mkdir, writeFile, unlink } from 'fs/promises'
import path from 'path'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { listMessagesSince, listAttachments, downloadAttachment, type GraphMessage } from '@/lib/inbox/graph-mail'
import { getSystemUserId } from '@/lib/system-user'
import { REVIEW_REASONS, type ReviewReason } from '@/lib/review-reasons'
import { extractPurchaseInvoice, OCR_MAX_FILE_BYTES } from '../ocr-extract'
import { buildCreateInputFromOcr } from '../from-ocr'
import { createPurchaseInvoice, buildInvoiceNumber, isDuplicateInvoiceError } from '../create'
import { generateSkuVariants, normalizeSkuForMatch } from '../sku-variants'
import { findTrustedSender, invoiceNumberFromFilename, type TrustedInvoiceSender } from './senders'

const MAX_ATTEMPTS = 3
const DEFAULT_LOOKBACK_DAYS = 7
const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'facturas-compra')

export type IngestStatus = 'PROCESSED' | 'DUPLICATE' | 'NO_PDF' | 'SUPPLIER_NOT_FOUND' | 'ERROR'

export interface IngestDetail {
  subject: string | null
  from: string
  receivedAt: string
  attachment: string
  status: IngestStatus | 'SKIPPED' | 'WOULD_CREATE'
  detail?: string
  invoiceNumber?: string
  purchaseInvoiceId?: string
  supplier?: string
  total?: number
  reviewReason?: string | null
  /** Solo en dryRun+recheck: la factura ya cargada a mano, para comparar. */
  existing?: { purchaseInvoiceId: string; total: number; itemCount: number; generalDiscount: number; perceptionsAmount: number }
}

export interface IngestRunResult {
  completedAt: string
  mailbox: string
  since: string
  dryRun: boolean
  recheck: boolean
  messagesScanned: number
  fromTrustedSenders: number
  created: number
  duplicates: number
  noPdf: number
  supplierNotFound: number
  errors: number
  skipped: number
  duration: string
  details: IngestDetail[]
}

export interface IngestOptions {
  lookbackDays?: number
  /** Hace todo (Graph + OCR + matcheo) pero no crea facturas ni registra el mail. */
  dryRun?: boolean
  /**
   * Solo con dryRun: ignora la deduplicación y pasa por OCR facturas que ya
   * están cargadas, devolviendo la existente al lado para comparar qué tan
   * bien lee el bot contra lo cargado a mano.
   */
  recheck?: boolean
  /** Solo con dryRun: procesar únicamente los N mails más nuevos. */
  limit?: number
}

export async function ingestFacturasMail(opts: IngestOptions = {}): Promise<IngestRunResult> {
  const startTime = Date.now()
  const mailbox = process.env.FACTURACION_MAILBOX
  if (!mailbox) throw new Error('FACTURACION_MAILBOX no configurada (UPN de la casilla de facturación)')

  const dryRun = Boolean(opts.dryRun)
  const recheck = dryRun && Boolean(opts.recheck)
  const lookbackDays = opts.lookbackDays ?? (Number(process.env.FACTURACION_MAIL_LOOKBACK_DAYS) || DEFAULT_LOOKBACK_DAYS)
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)

  const messages = await listMessagesSince(mailbox, since)
  let trusted = messages
    .map((m) => ({ message: m, sender: findTrustedSender(m.from?.emailAddress?.address) }))
    .filter((x): x is { message: GraphMessage; sender: TrustedInvoiceSender } => x.sender !== null)
    // Más viejos primero para que las facturas queden en orden de llegada
    .sort((a, b) => (a.message.receivedDateTime || '').localeCompare(b.message.receivedDateTime || ''))
  if (dryRun && opts.limit && opts.limit > 0) trusted = trusted.slice(-opts.limit)

  const details: IngestDetail[] = []
  const counts = { created: 0, duplicates: 0, noPdf: 0, supplierNotFound: 0, errors: 0, skipped: 0 }

  for (const { message, sender } of trusted) {
    try {
      await processMessage(mailbox, message, sender, { dryRun, recheck }, details, counts)
    } catch (err) {
      // Falló antes de llegar a un adjunto (ej. Graph al listar attachments): se
      // reintenta en la próxima corrida porque no quedó registro.
      counts.errors++
      const detail = err instanceof Error ? err.message : String(err)
      details.push(baseDetail(message, '', 'ERROR', detail))
      logger.error(`[ingest-facturas-mail] Error procesando mail "${message.subject}"`, err)
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1)
  const result: IngestRunResult = {
    completedAt: new Date().toISOString(),
    mailbox,
    since: since.toISOString(),
    dryRun,
    recheck,
    messagesScanned: messages.length,
    fromTrustedSenders: trusted.length,
    ...counts,
    duration: `${duration}s`,
    details,
  }

  logger.info(
    `[ingest-facturas-mail] Completado${dryRun ? ' (dry-run)' : ''}: scanned=${messages.length} trusted=${trusted.length} ` +
      `created=${counts.created} duplicates=${counts.duplicates} noPdf=${counts.noPdf} ` +
      `supplierNotFound=${counts.supplierNotFound} errors=${counts.errors} skipped=${counts.skipped} duration=${duration}s`
  )

  return result
}

function baseDetail(message: GraphMessage, attachment: string, status: IngestDetail['status'], detail?: string): IngestDetail {
  return {
    subject: message.subject ?? null,
    from: message.from?.emailAddress?.address ?? '',
    receivedAt: message.receivedDateTime ?? '',
    attachment,
    status,
    detail,
  }
}

type Counts = { created: number; duplicates: number; noPdf: number; supplierNotFound: number; errors: number; skipped: number }
type Mode = { dryRun: boolean; recheck: boolean }

async function processMessage(
  mailbox: string,
  message: GraphMessage,
  sender: TrustedInvoiceSender,
  mode: Mode,
  details: IngestDetail[],
  counts: Counts
) {
  const { dryRun } = mode
  const messageKey = message.internetMessageId || message.id
  const existing = dryRun
    ? []
    : await prisma.purchaseInvoiceMailIngest.findMany({
        where: { messageKey },
        select: { attachmentName: true, status: true, attempts: true },
      })

  const shouldRetry = (row?: { status: string; attempts: number }) =>
    !row || (row.status === 'ERROR' && row.attempts < MAX_ATTEMPTS)

  // Mail ya visto y sin nada para reintentar → ni consultamos los adjuntos
  if (existing.length > 0 && !existing.some((r) => shouldRetry(r))) {
    counts.skipped++
    return
  }

  const attachments = message.hasAttachments ? await listAttachments(mailbox, message.id) : []
  const pdfs = attachments.filter(
    (a) =>
      (a['@odata.type'] ?? '#microsoft.graph.fileAttachment') === '#microsoft.graph.fileAttachment' &&
      !a.isInline &&
      (a.contentType === 'application/pdf' || /\.pdf$/i.test(a.name))
  )

  if (pdfs.length === 0) {
    counts.noPdf++
    details.push(baseDetail(message, '', 'NO_PDF', 'El mail no tiene PDF adjunto'))
    if (!dryRun) await recordIngest(mailbox, message, messageKey, '', 'NO_PDF', 'El mail no tiene PDF adjunto')
    return
  }

  for (const pdf of pdfs) {
    const row = existing.find((r) => r.attachmentName === pdf.name)
    if (!shouldRetry(row)) {
      counts.skipped++
      continue
    }

    try {
      const outcome = await processPdf(mailbox, message, sender, pdf, mode)
      details.push({ ...baseDetail(message, pdf.name, outcome.status, outcome.detail), ...outcome.extra })
      if (outcome.status === 'PROCESSED' || outcome.status === 'WOULD_CREATE') counts.created++
      else if (outcome.status === 'DUPLICATE') counts.duplicates++
      else if (outcome.status === 'SUPPLIER_NOT_FOUND') counts.supplierNotFound++
      if (!dryRun && outcome.status !== 'WOULD_CREATE') {
        await recordIngest(mailbox, message, messageKey, pdf.name, outcome.status, outcome.detail, outcome.extra.purchaseInvoiceId)
      }
    } catch (err) {
      counts.errors++
      const detail = err instanceof Error ? err.message : String(err)
      details.push(baseDetail(message, pdf.name, 'ERROR', detail))
      logger.error(`[ingest-facturas-mail] Error con ${pdf.name} de "${message.subject}"`, err)
      if (!dryRun) await recordIngest(mailbox, message, messageKey, pdf.name, 'ERROR', detail)
    }
  }
}

interface PdfOutcome {
  status: IngestStatus | 'WOULD_CREATE'
  detail?: string
  extra: Partial<IngestDetail>
}

async function processPdf(
  mailbox: string,
  message: GraphMessage,
  sender: TrustedInvoiceSender,
  pdf: { id: string; name: string; size?: number },
  { dryRun, recheck }: Mode
): Promise<PdfOutcome> {
  // Duplicado por nombre de archivo: nos ahorra la llamada de OCR
  const numberFromName = invoiceNumberFromFilename(pdf.name)
  if (numberFromName && !recheck) {
    const dup = await prisma.purchaseInvoice.findUnique({ where: { invoiceNumber: numberFromName }, select: { id: true } })
    if (dup) {
      return {
        status: 'DUPLICATE',
        detail: `La factura ${numberFromName} ya estaba cargada`,
        extra: { invoiceNumber: numberFromName, purchaseInvoiceId: dup.id },
      }
    }
  }

  if (pdf.size && pdf.size > OCR_MAX_FILE_BYTES) {
    throw new Error(`El PDF pesa ${(pdf.size / 1024 / 1024).toFixed(1)}MB y el OCR acepta hasta 10MB`)
  }

  const buffer = await downloadAttachment(mailbox, message.id, pdf.id)
  const { data, truncated } = await extractPurchaseInvoice(buffer, 'application/pdf')

  const supplierMatch = await findSupplier(data.proveedor?.cuit, sender)
  if (!supplierMatch) {
    return {
      status: 'SUPPLIER_NOT_FOUND',
      detail: `Ningún proveedor del ERP coincide con CUIT "${data.proveedor?.cuit || ''}" / "${data.proveedor?.razonSocial || ''}" (${sender.label})`,
      extra: {},
    }
  }
  const { supplier, matchedBy } = supplierMatch

  const built = buildCreateInputFromOcr(data, { supplierId: supplier.id, supplierPaymentDays: supplier.paymentDays })
  const invoiceNumber = buildInvoiceNumber(built.input.voucherType, built.input.pointOfSale, built.input.invoiceNumberSuffix)

  const dup = await prisma.purchaseInvoice.findUnique({
    where: { invoiceNumber },
    select: { id: true, total: true, generalDiscount: true, perceptionsAmount: true, _count: { select: { items: true } } },
  })
  if (dup && !recheck) {
    return {
      status: 'DUPLICATE',
      detail: `La factura ${invoiceNumber} ya estaba cargada`,
      extra: { invoiceNumber, purchaseInvoiceId: dup.id, supplier: supplier.name },
    }
  }
  const existing: IngestDetail['existing'] = dup
    ? {
        purchaseInvoiceId: dup.id,
        total: Number(dup.total),
        itemCount: dup._count.items,
        generalDiscount: Number(dup.generalDiscount),
        perceptionsAmount: Number(dup.perceptionsAmount),
      }
    : undefined

  await linkItemsBySku(built.input.items, sender.brand)

  // Motivo de revisión: el más específico gana
  const notes = [...built.reviewNotes]
  let reviewReason: ReviewReason = built.reviewReason ?? REVIEW_REASONS.MAIL_INGEST
  if (truncated) {
    reviewReason = REVIEW_REASONS.AMOUNT_MISMATCH
    notes.unshift('La respuesta del OCR se cortó (max_tokens): pueden faltar items')
  }
  if (matchedBy === 'name') {
    if (reviewReason !== REVIEW_REASONS.AMOUNT_MISMATCH) reviewReason = REVIEW_REASONS.CUIT_MISMATCH
    notes.push(
      `El CUIT leído por el OCR (${data.proveedor?.cuit || 'vacío'}) no coincide con ningún proveedor; ` +
        `se asignó "${supplier.name}" por el remitente (${sender.label})`
    )
  }
  if (built.currency !== 'ARS') {
    notes.push(`La factura está en ${built.currency}${data.factura?.tipoCambio ? ` (TC ${data.factura.tipoCambio})` : ''}; el ERP la guarda en ARS`)
  }

  const receivedAt = message.receivedDateTime ? new Date(message.receivedDateTime) : new Date()
  const internalNotes = [
    `Cargada automáticamente desde el mail de facturación (${sender.label}).`,
    `Mail: "${message.subject || '(sin asunto)'}" de ${message.from?.emailAddress?.address || ''} recibido el ${receivedAt.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}.`,
    `Adjunto: ${pdf.name}.`,
    ...(notes.length > 0 ? ['', 'Para revisar:', ...notes.map((n) => `- ${n}`)] : []),
  ].join('\n')

  const linked = built.input.items.filter((i) => i.productId).length
  const extra: Partial<IngestDetail> = {
    invoiceNumber,
    supplier: supplier.name,
    total: built.computedTotal,
    reviewReason,
    existing,
  }

  if (dryRun) {
    return {
      status: 'WOULD_CREATE',
      detail:
        `${built.input.items.length} items (${linked} vinculados), desc. gral ${built.input.generalDiscount}%, ` +
        `percepciones ${(built.input.perceptions ?? []).reduce((s, p) => s + p.amount, 0).toFixed(2)}, ` +
        `total ${built.computedTotal.toFixed(2)}` +
        (notes.length > 0 ? ` — ${notes.join(' | ')}` : ''),
      extra,
    }
  }

  const sourceFileUrl = await savePdf(invoiceNumber, buffer)
  try {
    const { invoice } = await createPurchaseInvoice(
      { ...built.input, internalNotes, sourceFileUrl, requiresReview: true, reviewReason },
      await getSystemUserId()
    )
    logger.info(
      `[ingest-facturas-mail] Creada ${invoiceNumber} (${supplier.name}) total=${built.computedTotal.toFixed(2)} ` +
        `items=${built.input.items.length} linked=${linked} review=${reviewReason}`
    )
    return {
      status: 'PROCESSED',
      detail: `${built.input.items.length} items (${linked} vinculados)`,
      extra: { ...extra, purchaseInvoiceId: invoice.id },
    }
  } catch (err) {
    await unlink(path.join(process.cwd(), 'public', sourceFileUrl)).catch(() => {})
    if (isDuplicateInvoiceError(err)) {
      return { status: 'DUPLICATE', detail: `La factura ${invoiceNumber} ya estaba cargada`, extra }
    }
    throw err
  }
}

async function findSupplier(
  cuit: string | undefined,
  sender: TrustedInvoiceSender
): Promise<{ supplier: { id: string; name: string; paymentDays: number }; matchedBy: 'cuit' | 'name' } | null> {
  const select = { id: true, name: true, legalName: true, paymentDays: true }
  const digits = (cuit || '').replace(/\D/g, '')

  if (digits.length === 11) {
    const formatted = `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`
    const byCuit = await prisma.supplier.findFirst({
      where: { taxId: { in: [digits, formatted] }, status: 'ACTIVE' },
      select,
    })
    if (byCuit) return { supplier: byCuit, matchedBy: 'cuit' }
  }

  // El CUIT no matcheó: buscamos por nombre entre los activos, pero solo
  // aceptamos el que corresponde al remitente (evita cargarle la factura a otro).
  const candidates = await prisma.supplier.findMany({
    where: { status: 'ACTIVE' },
    select,
  })
  const byName = candidates.find(
    (s) => sender.supplierNamePattern.test(s.name) || (s.legalName ? sender.supplierNamePattern.test(s.legalName) : false)
  )
  return byName ? { supplier: byName, matchedBy: 'name' } : null
}

/**
 * Vincula items al catálogo por SKU. Primero exacto probando las variantes
 * con/sin ceros iniciales (como la UI); lo que queda sin vincular se compara
 * sin espacios ni guiones dentro de la marca del remitente, y solo si hay un
 * único candidato.
 */
async function linkItemsBySku(
  items: Array<{ supplierProductCode?: string | null; productId?: string | null }>,
  brand?: string
) {
  const variantsByItem = items.map((i) => generateSkuVariants(i.supplierProductCode || ''))
  const allVariants = [...new Set(variantsByItem.flat())]
  if (allVariants.length === 0) return

  const products = await prisma.product.findMany({
    where: { sku: { in: allVariants }, status: 'ACTIVE' },
    select: { id: true, sku: true },
  })
  const bySku = new Map(products.map((p) => [p.sku.toLowerCase().trim(), p.id]))

  items.forEach((item, idx) => {
    for (const v of variantsByItem[idx]) {
      const id = bySku.get(v.toLowerCase())
      if (id) {
        item.productId = id
        break
      }
    }
  })

  if (!brand) return
  const pending = items.filter((i) => !i.productId && i.supplierProductCode?.trim())
  const norms = [...new Set(pending.map((i) => normalizeSkuForMatch(i.supplierProductCode!)).filter(Boolean))]
  if (norms.length === 0) return

  const candidates: Array<{ id: string; norm: string }> = await prisma.$queryRaw`
    SELECT id, regexp_replace(lower(sku), '[^a-z0-9]', '', 'g') AS norm
    FROM products
    WHERE status = 'ACTIVE' AND brand ILIKE ${brand}
      AND regexp_replace(lower(sku), '[^a-z0-9]', '', 'g') IN (${Prisma.join(norms)})`

  const byNorm = new Map<string, string[]>()
  for (const c of candidates) byNorm.set(c.norm, [...(byNorm.get(c.norm) ?? []), c.id])

  for (const item of pending) {
    const ids = byNorm.get(normalizeSkuForMatch(item.supplierProductCode!))
    if (ids?.length === 1) item.productId = ids[0]
  }
}

async function savePdf(invoiceNumber: string, buffer: Buffer): Promise<string> {
  await mkdir(UPLOAD_DIR, { recursive: true })
  const safe = invoiceNumber.replace(/[^a-zA-Z0-9-_]/g, '-')
  const fileName = `${safe}_${Date.now()}.pdf`
  await writeFile(path.join(UPLOAD_DIR, fileName), buffer)
  return `/uploads/facturas-compra/${fileName}`
}

async function recordIngest(
  mailbox: string,
  message: GraphMessage,
  messageKey: string,
  attachmentName: string,
  status: IngestStatus,
  detail?: string,
  purchaseInvoiceId?: string
) {
  const data = {
    mailbox,
    graphMessageId: message.id,
    fromAddress: message.from?.emailAddress?.address?.toLowerCase() ?? '',
    subject: message.subject ?? null,
    receivedAt: message.receivedDateTime ? new Date(message.receivedDateTime) : new Date(),
    status,
    detail: detail ?? null,
    purchaseInvoiceId: purchaseInvoiceId ?? null,
  }
  await prisma.purchaseInvoiceMailIngest.upsert({
    where: { messageKey_attachmentName: { messageKey, attachmentName } },
    create: { ...data, messageKey, attachmentName },
    update: { ...data, attempts: { increment: 1 } },
  })
}
