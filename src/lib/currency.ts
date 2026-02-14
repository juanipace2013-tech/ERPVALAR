import { prisma } from './prisma'
import type { Currency } from '@prisma/client'

/**
 * Obtiene el tipo de cambio más reciente entre dos monedas
 */
export async function getExchangeRate(
  from: Currency,
  to: Currency
): Promise<number> {
  // Si son la misma moneda, el tipo de cambio es 1
  if (from === to) return 1

  // Buscar el tipo de cambio más reciente
  const rate = await prisma.exchangeRate.findFirst({
    where: {
      fromCurrency: from,
      toCurrency: to,
      OR: [
        { validUntil: null },
        { validUntil: { gte: new Date() } },
      ],
    },
    orderBy: {
      validFrom: 'desc',
    },
  })

  if (!rate) {
    throw new Error(`No exchange rate found for ${from} to ${to}`)
  }

  return Number(rate.rate)
}

/**
 * Convierte un monto de una moneda a otra
 */
export async function convertCurrency(
  amount: number,
  from: Currency,
  to: Currency
): Promise<number> {
  const rate = await getExchangeRate(from, to)
  return amount * rate
}

/**
 * Convierte un monto a múltiples monedas
 */
export async function convertToMultipleCurrencies(
  amount: number,
  from: Currency,
  targetCurrencies: Currency[]
): Promise<Record<Currency, number>> {
  const conversions: Record<string, number> = {}

  for (const targetCurrency of targetCurrencies) {
    conversions[targetCurrency] = await convertCurrency(amount, from, targetCurrency)
  }

  return conversions as Record<Currency, number>
}

/**
 * Obtiene todos los tipos de cambio actuales (para la misma fecha)
 */
export async function getAllCurrentRates(): Promise<
  Array<{ from: Currency; to: Currency; rate: number }>
> {
  const rates = await prisma.exchangeRate.findMany({
    where: {
      OR: [
        { validUntil: null },
        { validUntil: { gte: new Date() } },
      ],
    },
    orderBy: {
      validFrom: 'desc',
    },
  })

  // Agrupar por par de monedas y obtener el más reciente de cada uno
  const rateMap = new Map<string, typeof rates[0]>()

  for (const rate of rates) {
    const key = `${rate.fromCurrency}-${rate.toCurrency}`
    if (!rateMap.has(key)) {
      rateMap.set(key, rate)
    }
  }

  return Array.from(rateMap.values()).map((rate) => ({
    from: rate.fromCurrency,
    to: rate.toCurrency,
    rate: Number(rate.rate),
  }))
}

/**
 * Actualiza o crea un tipo de cambio
 */
export async function updateExchangeRate(
  from: Currency,
  to: Currency,
  rate: number,
  source: 'MANUAL' | 'BANCO_CENTRAL' | 'API' = 'MANUAL'
) {
  // Marcar los tipos de cambio anteriores como vencidos
  await prisma.exchangeRate.updateMany({
    where: {
      fromCurrency: from,
      toCurrency: to,
      validUntil: null,
    },
    data: {
      validUntil: new Date(),
    },
  })

  // Crear el nuevo tipo de cambio
  return await prisma.exchangeRate.create({
    data: {
      fromCurrency: from,
      toCurrency: to,
      rate,
      source,
      validFrom: new Date(),
    },
  })
}
