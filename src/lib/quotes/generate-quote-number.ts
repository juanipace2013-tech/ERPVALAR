import type { PrismaClient } from "@prisma/client";

type TransactionClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export async function generateNextQuoteNumber(
  tx: PrismaClient | TransactionClient
): Promise<string> {
  const year = new Date().getFullYear();
  const yearPrefix = `VAL-${year}-`;

  const cotizacionesDelAnio = await tx.quote.findMany({
    where: { quoteNumber: { startsWith: yearPrefix } },
    select: { quoteNumber: true },
  });

  let maxNumber = 0;
  for (const cot of cotizacionesDelAnio) {
    const match = cot.quoteNumber.match(/^VAL-\d{4}-(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNumber) maxNumber = num;
    }
  }

  return `VAL-${year}-${String(maxNumber + 1).padStart(3, "0")}`;
}
