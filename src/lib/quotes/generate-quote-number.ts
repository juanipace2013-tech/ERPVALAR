import type { PrismaClient } from "@prisma/client";

type TransactionClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

const QUOTE_NUMBER_LOCK_KEY = 8472051;

export async function generateNextQuoteNumber(
  tx: PrismaClient | TransactionClient
): Promise<string> {
  // Advisory lock serializa la generación del número dentro de la transacción.
  // Se libera automáticamente al cerrar la transacción.
  await (tx as any).$executeRaw`SELECT pg_advisory_xact_lock(${QUOTE_NUMBER_LOCK_KEY})`;

  const year = new Date().getFullYear();
  const yearPrefix = `VAL-${year}-`;
  const likePattern = `${yearPrefix}%`;

  // Calcular el max correlativo del año en una sola query agregada en el
  // server, en vez de traer todas las filas y reducir en JS. Replica el patrón
  // de generateInvoiceNumber (quote-workflow.ts:513-528). Reduce el tiempo
  // dentro de la transacción serializada por el advisory lock, mitigando
  // P2028 en momentos de latencia alta contra la DB (Argentina↔Oregon).
  //
  // SPLIT_PART('VAL-2026-521', '-', 3) → '521' → CAST AS INTEGER → 521.
  // El formato VAL-YYYY-NNN se preserva idéntico al generador anterior.
  const result = await (tx as any).$queryRaw<{ max_num: number }[]>`
    SELECT COALESCE(
      MAX(CAST(SPLIT_PART("quoteNumber", '-', 3) AS INTEGER)),
      0
    ) AS max_num
    FROM quotes
    WHERE "quoteNumber" LIKE ${likePattern}
  `;

  const maxNumber = Number(result[0]?.max_num ?? 0);

  return `VAL-${year}-${String(maxNumber + 1).padStart(3, "0")}`;
}
